import Anthropic from '@anthropic-ai/sdk';

const ALLOWED_ORIGINS = new Set([
  'https://azumanakazono-gif.github.io',
]);

const PROPOSAL_MODE_LABEL = {
  pv_battery: '太陽光＋蓄電池',
  pv_only: '太陽光のみ',
  battery_only: '蓄電池のみ',
};

function setCORS(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function buildPrompt(d) {
  const modeLabel = PROPOSAL_MODE_LABEL[d.proposalMode] || '太陽光＋蓄電池';
  const costDiffMan = Number(d.costDiffMan) || 0;
  const isNegative = costDiffMan < 0;
  const NUMBER_RULE = '・金額や年数などの数値を本文に書く場合は、上記【試算結果】または【お客様情報】に記載した数値だけを、記載どおりの桁でそのまま使うこと。それ以外の金額・kWh・%・年数などの数値を新たに計算したり、書き加えたり、推測したりしないこと';

  if (isNegative) {
    return `あなたは太陽光発電・蓄電池の提案営業をサポートするアシスタントです。
以下の試算では、${d.warrantyYears || 20}年間のコスト差が電力会社よりも高くなる結果（マイナス）になりました。
これは提案書に載せる顧客向け文章ではなく、担当スタッフ向けの「注意喚起メモ」です。

【試算結果】
・お客様名：${d.customerName || '記載なし'}
・家族構成：${d.familyComposition || '記載なし'}
・現在の月間電気代：${d.monthlyElectricBill || 0}円
・${d.warrantyYears || 20}年間のコスト差：約${Math.abs(costDiffMan)}万円のマイナス（電力会社より高くなる試算）
・提案モード：${modeLabel}

【必ず含める内容】
・このままの条件ではコスト差がマイナスになり、プラン内容やシステム構成（太陽光容量・蓄電池容量・工事費・補助金条件など）の見直しが必要であること
・スタッフがお客様へどのように慎重にご案内・ご提案すべきか（数値を断定的に伝えない、前提条件次第で結果が変わる旨を丁寧に説明する、必要なら再シミュレーションを提案する、等）の具体的な助言

【条件】
・宛先はお客様ではなく社内スタッフである（お客様向けの共感・クロージング表現は使わない）
${NUMBER_RULE}
・日本語で120〜180文字程度
・出力は本文のみ。説明や見出し、鉤括弧は付けない`;
  }

  return `あなたは太陽光発電・蓄電池の提案営業をサポートするアシスタントです。
以下のお客様情報をもとに、提案書の最終ページに掲載する「共感＆クロージングコメント」を1つ作成してください。

【お客様情報】
・お客様名：${d.customerName || '記載なし'}
・家族構成：${d.familyComposition || '記載なし'}
・ライフスタイル：${d.lifestyleNote || '記載なし'}
・現在の月間電気代：${d.monthlyElectricBill || 0}円
・じぶん電気導入後の月間電気代の削減目安：${d.monthlySaving || 0}円/月
・${d.warrantyYears || 20}年間のコスト差：約${costDiffMan}万円（電力会社より安い）
・提案モード：${modeLabel}

【条件】
・お客様の家族構成や暮らしに寄り添う共感の一言から始め、最後は導入への後押し・ご検討のお願いで締めくくる
${NUMBER_RULE}
・日本語で100〜150文字程度（厳守）
・絵文字は1つまで使用可（任意）
・出力はコメント本文のみ。説明や見出し、鉤括弧は付けない`;
}

// コメント中の金額・年数トークン（例: 「123万円」「4,500円」「20年」）を抽出
function extractAmountTokens(text) {
  const re = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(万円|円|kWh|kwh|%|年)/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text))) {
    tokens.push({ value: parseFloat(m[1].replace(/,/g, '')), unit: m[2] === 'kwh' ? 'kWh' : m[2] });
  }
  return tokens;
}

// 送信元データから「使ってよい数値」を単位ごとに列挙（画面の実測値のみを許可）
function buildAllowedAmounts(d) {
  const costDiffMan = Math.abs(Number(d.costDiffMan) || 0);
  const monthlySaving = Math.abs(Number(d.monthlySaving) || 0);
  const monthlyElectricBill = Math.abs(Number(d.monthlyElectricBill) || 0);
  const warrantyYears = Number(d.warrantyYears) || 20;
  return {
    '万円': new Set([costDiffMan]),
    '円': new Set([monthlySaving, monthlyElectricBill]),
    '年': new Set([warrantyYears]),
  };
}

// AI出力に、渡していない数値（架空の削減額・コスト差など）が混入していないか検証
function hasHallucinatedNumbers(comment, d) {
  const allowed = buildAllowedAmounts(d);
  return extractAmountTokens(comment).some(t => {
    const set = allowed[t.unit];
    if (!set || set.size === 0) return true; // 許可していない単位・数値は不正とみなす
    return ![...set].some(v => Math.abs(v - t.value) < 0.5);
  });
}

// AIが数値の整合性を保てなかった場合の、数値だけは確実に正しいフォールバック文
function buildFallbackComment(d, isNegative) {
  const warrantyYears = d.warrantyYears || 20;
  const costDiffMan = Number(d.costDiffMan) || 0;
  if (isNegative) {
    return `⚠️【スタッフ向け注意】${warrantyYears}年間のコスト差が約${Math.abs(costDiffMan)}万円のマイナス（電力会社より高くなる試算）です。プラン内容やシステム構成の見直しをご検討のうえ、お客様には数値を断定せず、前提条件次第で結果が変わる旨を丁寧にご説明ください。`;
  }
  const family = d.familyComposition ? `${d.familyComposition}の皆さまの暮らしに寄り添う` : '毎日の暮らしに寄り添う';
  return `${family}じぶん電気。${warrantyYears}年間で約${costDiffMan}万円、電力会社よりおトクになる見込みです。この機会にぜひご検討ください。`;
}

export default async function handler(req, res) {
  setCORS(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[generate-comment] ANTHROPIC_API_KEY が設定されていません');
    return res.status(500).json({ error: 'サーバー設定エラーが発生しました' });
  }

  try {
    const d = req.body || {};
    const isNegative = (Number(d.costDiffMan) || 0) < 0;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = buildPrompt(d);
    const clean = (text) => (text || '').trim().replace(/^[「"']|[」"']$/g, '');

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    let comment = clean(message.content[0].text);
    if (!comment) throw new Error('AI応答が空です');

    // 渡していない数値（架空の削減額・コスト差など）が混じっていたら、一度だけ厳格な指示で再生成
    if (hasHallucinatedNumbers(comment, d)) {
      console.warn('[generate-comment] 数値の不一致を検知、再生成します');
      const retryMessage = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `${prompt}\n\n【再生成の注意】前回の出力には、ここで指定していない数値が含まれていました。文中に数値を書く場合は上記に記載した数値だけを、記載どおりの桁でそのまま使い、他の数値は一切書かないでください。`,
        }],
      });
      const retryComment = clean(retryMessage.content[0].text);
      comment = (retryComment && !hasHallucinatedNumbers(retryComment, d))
        ? retryComment
        : buildFallbackComment(d, isNegative);
    }

    if (isNegative && !comment.startsWith('⚠️')) comment = `⚠️【スタッフ向け注意】${comment}`;

    return res.status(200).json({ comment, isNegative });
  } catch (err) {
    console.error('[generate-comment] error:', err?.status, err?.message ?? err);
    if (err?.status === 401) return res.status(500).json({ error: 'API認証エラー: ANTHROPIC_API_KEYを確認してください' });
    if (err?.status === 400) return res.status(400).json({ error: 'コメントを生成できませんでした' });
    return res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}
