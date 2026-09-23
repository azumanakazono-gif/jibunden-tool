#!/usr/bin/env node
// 九州電力・新電力の最新単価を取得し、data/electricity-rates.json と index.html の単価定数を更新する。
// GitHub Actions（.github/workflows/update-electricity-rates.yml）から毎週実行。手動実行: node scripts/update-electricity-rates.mjs
// 取得・解析に失敗した項目は前回値を維持し、警告のみ出す（誤った値で上書きしない）。
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT       = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH  = path.join(ROOT, 'data', 'electricity-rates.json');
const INDEX_PATH = path.join(ROOT, 'index.html');
const DRY_RUN    = process.argv.includes('--dry-run');

const BASE = 'https://customer.kyuden.co.jp/ja/electricity';
const URLS = {
  juuryoB:    `${BASE}/home-plan/jyuryo-b.html`,
  kiji:       `${BASE}/home-plan/kijibetsu.html`,
  ohisama:    `${BASE}/home-plan/ohisama.html`,
  denkaNight: `${BASE}/home-plan/denka-de-night.html`,
  fuel:       (yyyymm) => `${BASE}/system/adjustment-past/${yyyymm}.html`,
};

const warnings = [];
const warn = (msg) => { warnings.push(msg); console.log(`::warning::${msg}`); };

// ── 取得・解析ヘルパー ──
async function fetchText(url, { retries = 3 } = {}) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'jibunden-tool rate updater (+https://github.com/azumanakazono-gif/jibunden-tool)' },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i >= retries) throw new Error(`${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

// HTML → テキストトークン配列（セル・段落単位）
function tokenize(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&times;/g, '×').replace(/&nbsp;/g, ' ').replace(/&yen;/g, '円')
    .split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const NUM_RE = /^(-?[\d,]+\.\d+)円?$/;
const toNum  = (s) => parseFloat(s.replace(/,/g, ''));

// label を含むトークン（exact=true なら完全一致）以降の数値を count 個取得
function numbersAfter(tokens, label, count, { exact = false } = {}) {
  const start = tokens.findIndex(t => exact ? t === label : t.includes(label));
  if (start < 0) throw new Error(`「${label}」が見つかりません`);
  const out = [];
  for (let i = start + 1; i < tokens.length && out.length < count; i++) {
    const m = tokens[i].match(NUM_RE);
    if (m) out.push(toNum(m[1]));
  }
  if (out.length < count) throw new Error(`「${label}」以降の数値が不足（${out.length}/${count}）`);
  return out;
}

function assertRange(name, v, min, max) {
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${name}=${v} が想定範囲外（${min}〜${max}）`);
  return v;
}

const r2 = (v) => Math.round(v * 100) / 100;

// ── 各プランのパーサー ──
async function fetchJuuryoB() {
  const tokens = tokenize(await fetchText(URLS.juuryoB));
  const basicB = {};
  for (const amp of [10, 15, 20, 30, 40, 50, 60]) {
    const [v] = numbersAfter(tokens, `${amp}アンペア`, 1, { exact: true });
    basicB[amp] = assertRange(`基本料金${amp}A`, v, 100, 3000);
  }
  const steps = numbersAfter(tokens, '電力量料金', 3, { exact: true }).map((v, i) => assertRange(`従量電灯B 第${i + 1}段`, v, 5, 60));
  // 再エネ賦課金：計算例「4.18円×250kWh」から取得
  const levyTok = tokens.find((t, i) => /^[\d.]+円\s*×\s*[\d,]+kWh$/.test(t) && tokens.slice(Math.max(0, i - 3), i).some(p => p.includes('再エネ賦課金')));
  if (!levyTok) throw new Error('再エネ賦課金の計算例が見つかりません');
  const saieneLevy = assertRange('再エネ賦課金', parseFloat(levyTok), 0, 10);
  const fy = tokens.join('').match(/再エネ賦課金単価は、計算例では、(\d{4})年度単価/);
  return { basicB, steps, saieneLevy, saieneFiscalYear: fy ? Number(fy[1]) : null };
}

async function fetchKiji() {
  const t = numbersAfter(tokenize(await fetchText(URLS.kiji)), '電力量料金', 4, { exact: true }).map(v => assertRange('季時別電灯', v, 5, 60));
  return { daytimeSummer: t[0], daytimeOther: t[1], living: t[2], night: t[3] };
}

async function fetchOhisama() {
  const tokens = tokenize(await fetchText(URLS.ohisama));
  const [basic] = numbersAfter(tokens, '契約電力が10kW以下', 1);
  // 夏冬 / 春秋 はそれぞれ6ヶ月 → 年間単純平均でアプリの3区分へ集約
  const t = numbersAfter(tokens, '電力量料金', 5, { exact: true }).map(v => assertRange('おひさま昼トク', v, 5, 60));
  return {
    basic: assertRange('おひさま基本料金', basic, 500, 5000),
    raw: { ohisamaSummerWinter: t[0], ohisamaSpringFall: t[1], shiftSummerWinter: t[2], shiftSpringFall: t[3], danran: t[4] },
    tariff: { ohisama: r2((t[0] + t[1]) / 2), peak: r2((t[2] + t[3]) / 2), ngt: t[4] },
  };
}

async function fetchDenkaNight() {
  const t = numbersAfter(tokenize(await fetchText(URLS.denkaNight)), '電力量料金', 5, { exact: true }).map(v => assertRange('電化でナイト', v, 5, 60));
  return { weekdaySummerWinter: t[0], weekdaySpringFall: t[1], weekendSummerWinter: t[2], weekendSpringFall: t[3], night: t[4] };
}

// 燃料費調整単価：当月分（JST）→ 未掲載なら前月分
async function fetchFuel() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  for (let back = 0; back < 3; back++) {
    const d = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - back, 1));
    const yyyymm = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const html = await fetchText(URLS.fuel(yyyymm));
    if (!html) continue;
    const tokens = tokenize(html);
    const row = (label) => {
      const i = tokens.findIndex(t => t.includes(label));
      if (i < 0) throw new Error(`燃料費調整「${label}」が見つかりません`);
      const j = tokens.findIndex((t, k) => k > i && t === '1kWhにつき');
      const nums = [];
      for (let k = j + 1; k < tokens.length && NUM_RE.test(tokens[k]); k++) nums.push(toNum(tokens[k].match(NUM_RE)[1]));
      if (!nums.length) throw new Error(`燃料費調整「${label}」の単価が見つかりません`);
      // [燃料費調整, 国の支援割引, 計] or [燃料費調整]
      return { adjust: assertRange(label, nums[0], -15, 15), net: nums.length > 1 ? nums[nums.length - 1] : nums[0] };
    };
    return { month: yyyymm, url: URLS.fuel(yyyymm), juuryo: row('従量電灯A・B・C'), denka: row('電化でナイト') };
  }
  throw new Error('燃料費調整単価ページが見つかりません（直近3ヶ月）');
}

// ── index.html 置換ヘルパー（想定件数と一致しなければ中止）──
function replaceExact(src, re, replacer, expected, name) {
  const hits = src.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
  if (!hits || hits.length !== expected) throw new Error(`index.html: ${name} の置換対象が ${hits?.length ?? 0} 件（想定 ${expected} 件）`);
  return src.replace(re, replacer);
}

// const NAME = { ... tariff: { key: val, ... } } ブロック内の key を置換
function replaceTariff(src, constName, tariff) {
  const start = src.indexOf(`const ${constName} = {`);
  if (start < 0) throw new Error(`index.html: ${constName} が見つかりません`);
  const tStart = src.indexOf('tariff: {', start);
  const tEnd   = src.indexOf('}', tStart);
  let block = src.slice(tStart, tEnd);
  for (const [k, v] of Object.entries(tariff)) {
    const re = new RegExp(`(\\b${k}:\\s*)-?[\\d.]+`);
    if (!re.test(block)) throw new Error(`index.html: ${constName}.tariff.${k} が見つかりません`);
    block = block.replace(re, `$1${v.toFixed(2)}`);
  }
  return src.slice(0, tStart) + block + src.slice(tEnd);
}

function patchIndexHtml(src, d) {
  const k = d.kyushu;
  src = replaceExact(src, /(const SAIENE_LEVY\s*=\s*)[\d.]+(;\s*\/\/ 再エネ賦課金（)\d{4}(年度）)/,
    (_, a, b, c) => `${a}${k.saieneLevy.toFixed(2)}${b}${k.saieneFiscalYear ?? new Date().getFullYear()}${c}`, 1, 'SAIENE_LEVY');
  src = replaceExact(src, /(const FUEL_ADJUST\s*=\s*)-?[\d.]+/, `$1${k.fuelAdjust.toFixed(2)}`, 1, 'FUEL_ADJUST');
  const [s1, s2, s3] = k.juuryoB.steps;
  src = replaceExact(src, /s1\*[\d.]+ \+ s2\*[\d.]+ \+ s3\*[\d.]+/g,
    `s1*${s1.toFixed(2)} + s2*${s2.toFixed(2)} + s3*${s3.toFixed(2)}`, 3, '従量電灯B 段階単価');
  const basicB = Object.entries(k.juuryoB.basicB).map(([a, v]) => `${a}:${v.toFixed(2)}`).join(',');
  src = replaceExact(src, /basicB: \{[^}]*\}/, `basicB: {${basicB}}`, 1, 'KYUSHU_JUURYO.basicB');
  src = replaceExact(src, /(if \(kp === 'kyushu_denka_night' \|\| kp === 'kyushu_ohisama'\) return )[\d.]+;/,
    `$1${k.ohisama.basic.toFixed(2)};`, 1, 'おひさま/電化でナイト 基本料金');
  src = replaceTariff(src, 'KYUSHU_KIJI', k.kiji);
  src = replaceTariff(src, 'KYUSHU_OHISAMA', k.ohisama.tariff);
  src = replaceTariff(src, 'KYUSHU_DENKA_NIGHT', k.denkaNight);
  const shin = Object.entries(d.shinDenryoku.plans).map(([key, p]) => `'${key}': ${p.unitPrice.toFixed(2)}`).join(', ');
  src = replaceExact(src, /const SHIN_DENRYOKU_UP = \{[^}]*\}/, `const SHIN_DENRYOKU_UP = { ${shin} }`, 1, 'SHIN_DENRYOKU_UP');
  return src;
}

// 取得に失敗した項目は前回値を使う
async function tryOr(name, fn, prev) {
  try { return await fn(); }
  catch (e) {
    warn(`${name}: ${e.message} → 前回値を維持`);
    if (prev === undefined) throw new Error(`${name}: 前回値もないため更新できません`);
    return prev;
  }
}

async function main() {
  const prev = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  const pk = prev.kyushu;

  const jb    = await tryOr('従量電灯B', fetchJuuryoB, { basicB: pk.juuryoB.basicB, steps: pk.juuryoB.steps, saieneLevy: pk.saieneLevy, saieneFiscalYear: pk.saieneFiscalYear });
  const kiji  = await tryOr('季時別電灯', fetchKiji, pk.kiji);
  const ohi   = await tryOr('おひさま昼トク', fetchOhisama, pk.ohisama);
  const denka = await tryOr('電化でナイト・セレクト', fetchDenkaNight, pk.denkaNight);
  const fuel  = await tryOr('燃料費調整単価', fetchFuel, pk.fuel);
  if (warnings.length >= 5) throw new Error('全項目の取得に失敗しました（サイト構成変更の可能性）');

  // 国の支援割引は期間限定のため、長期シミュレーション用の FUEL_ADJUST には既定で含めない
  const applyDiscount = prev.settings?.applyGovernmentDiscount === true;
  const fuelAdjust = applyDiscount ? fuel.juuryo.net : fuel.juuryo.adjust;

  // おひさま昼トクは公式の時間帯区分がアプリの区分と異なるため、既定では公式値を記録のみ（settings.updateOhisama=true で反映）
  const ohisama = prev.settings?.updateOhisama === true ? ohi : { ...pk.ohisama, raw: ohi.raw, official: ohi.tariff };
  if (JSON.stringify(ohisama.tariff) !== JSON.stringify(ohi.tariff)) {
    warn(`おひさま昼トク: 公式単価（年間平均 ${Object.values(ohi.tariff).join(' / ')}）とアプリ値が異なります。時間帯区分を確認のうえ settings.updateOhisama を検討してください`);
  }

  const kyushu = {
    saieneLevy: jb.saieneLevy, saieneFiscalYear: jb.saieneFiscalYear,
    fuel, fuelAdjust,
    juuryoB: { basicB: jb.basicB, steps: jb.steps },
    kiji, ohisama, denkaNight: denka,
  };

  // 新電力：賦課金・燃調は九電と同水準で連動する前提。basePrice（燃調・賦課金抜き）+ 最新の賦課金 + 燃調
  const plans = {};
  for (const [key, p] of Object.entries(prev.shinDenryoku.plans)) {
    plans[key] = { ...p, unitPrice: r2(p.basePrice + kyushu.saieneLevy + fuelAdjust) };
  }

  const changed = JSON.stringify({ kyushu, plans }) !== JSON.stringify({ kyushu: prev.kyushu, plans: prev.shinDenryoku.plans });
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const next = {
    ...prev,
    lastChangedAt: changed ? today : prev.lastChangedAt,
    sources: { ...URLS, fuel: fuel.url },
    kyushu,
    shinDenryoku: { ...prev.shinDenryoku, plans },
  };

  const html = await readFile(INDEX_PATH, 'utf8');
  const patched = patchIndexHtml(html, next);

  const summary = [
    `## 電気料金単価 自動更新 (${today})`,
    changed ? '単価に変更あり' : '変更なし',
    '',
    '| 項目 | 前回 | 今回 |', '|---|---|---|',
    `| 再エネ賦課金 | ${pk.saieneLevy} | ${kyushu.saieneLevy} |`,
    `| 燃料費調整（${fuel.month}分・従量電灯） | ${pk.fuelAdjust} | ${fuelAdjust} |`,
    `| 従量電灯B 段階単価 | ${pk.juuryoB.steps.join(' / ')} | ${kyushu.juuryoB.steps.join(' / ')} |`,
    `| 季時別電灯 | ${Object.values(pk.kiji).join(' / ')} | ${Object.values(kiji).join(' / ')} |`,
    `| おひさま昼トク（アプリ反映値） | ${Object.values(pk.ohisama.tariff).join(' / ')} | ${Object.values(ohisama.tariff).join(' / ')} |`,
    `| 電化でナイト | ${Object.values(pk.denkaNight).join(' / ')} | ${Object.values(denka).join(' / ')} |`,
    ...Object.entries(plans).map(([k, p]) => `| 新電力 ${p.label} | ${prev.shinDenryoku.plans[k].unitPrice} | ${p.unitPrice} |`),
    ...(warnings.length ? ['', '### 警告', ...warnings.map(w => `- ${w}`)] : []),
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n');

  if (DRY_RUN) return;
  await writeFile(DATA_PATH, JSON.stringify(next, null, 2) + '\n');
  if (patched !== html) await writeFile(INDEX_PATH, patched);
}

main().catch(e => { console.error(`::error::${e.message}`); process.exit(1); });
