/* 既設PV＋後付け蓄電池。新設向けの収支とは独立した差分試算。 */
(function (root) {
  'use strict';
  const fields = [
    ['generation','既設PV 年間発電量','kWh/年',0,null,''],
    ['exportKwh','現在の年間売電量','kWh/年',0,null,''],
    ['importKwh','現在の年間買電量','kWh/年',0,null,''],
    ['bill','現在の年間買電料金','円/年',0,null,''],
    ['buyRate','放電時間帯の買電従量単価','円/kWh',0,null,''],
    ['sellRate','卒FIT後の売電単価','円/kWh',0,null,''],
    ['fitYears','FIT残存年数（卒FIT済みは0）','年',0,20,0],
    ['fitRate','FIT期間中の売電単価','円/kWh',0,null,0],
    ['capacity','蓄電池の実効容量（公称容量ではありません）','kWh',0,null,''],
    ['reserve','停電用に確保する容量割合','%',0,100,20],
    ['efficiency','充放電の往復効率（仮定）','%',1,100,90],
    ['matching','余剰電力のうち充電できる割合（仮定）','%',0,100,70],
    ['nightShare','買電量のうち放電で置換できる割合（仮定）','%',0,100,60],
    ['days','年間の稼働日数（1日1サイクル以内）','日',0,365,330],
    ['cost','蓄電池・工事・必要なPCS交換の税込総額','万円',0,null,''],
    ['subsidy','補助金（適用条件を確認した金額）','万円',0,null,0],
    ['years','試算期間（保証期間とは異なります）','年',1,30,15],
    ['degradation','年間の実効容量低下率（仮定）','%',0,20,2],
    ['maintenance','追加の年間維持費','円/年',0,null,0],
    ['replacementYear','交換費を計上する年（計上なしは0）','年',0,30,0],
    ['replacementCost','上記年の追加交換費','万円',0,null,0]
  ];
  const defaults = Object.fromEntries(fields.map(f => [f[0], f[5]]));
  const notes = '年次の概算です。発電・需要の時間差、天候、充放電出力制限は割合で簡略化しています。最終設計では30分値等で確認してください。買電・売電単価、既設PV発電量は一定と仮定し、夜間の系統充電・料金プラン変更・金利・税効果は含みません。基本料金は削減しません。既設PVの導入費・既存の直接自家消費効果は追加投資効果に含めません。';
  function calculate(raw) {
    const d = {}, errors = [];
    fields.forEach(([k,label,,min,max]) => {
      const n = Number(raw[k]);
      if (raw[k] === '' || raw[k] == null || !Number.isFinite(n) || n < min || (max !== null && n > max)) errors.push(label + 'を有効な範囲で入力してください。');
      d[k] = n;
    });
    for (const k of ['fitYears','years','days','replacementYear']) if (!Number.isInteger(d[k])) errors.push('年数・日数は整数で入力してください。');
    if (d.exportKwh > d.generation) errors.push('年間売電量は年間発電量以下にしてください。');
    if (d.generation <= 0) errors.push('既設PVの年間発電量を入力してください。');
    if (d.capacity <= 0) errors.push('蓄電池の実効容量は0より大きい値にしてください。');
    if (d.buyRate <= 0) errors.push('買電従量単価は0より大きい値にしてください。');
    if (d.subsidy > d.cost) errors.push('補助金が総工事費を超えています。');
    if (d.fitYears > 0 && d.fitRate <= 0) errors.push('FIT期間中の売電単価を入力してください。');
    if (d.replacementCost > 0 && (d.replacementYear < 1 || d.replacementYear > d.years)) errors.push('交換費を計上する年を試算期間内で指定してください。');
    if (errors.length) return {errors: [...new Set(errors)]};
    const efficiency = d.efficiency / 100;
    const initial = (d.cost - d.subsidy) * 10000;
    let cumulative = -initial, payback = initial === 0 ? 0 : null;
    const rows = [];
    for (let year = 1; year <= d.years; year++) {
      const sellRate = year <= d.fitYears ? d.fitRate : d.sellRate;
      const usable = d.capacity * (1 - d.reserve / 100) * Math.pow(1 - d.degradation / 100, year - 1);
      // AC側の充電電力量を基準に往復損失を1回だけ計上。
      const discharge = Math.min(d.exportKwh * d.matching / 100 * efficiency,
        usable * d.days * efficiency, d.importKwh * d.nightShare / 100, d.bill / d.buyRate);
      const charge = discharge / efficiency;
      const saving = discharge * d.buyRate, lostSales = charge * sellRate;
      const replacement = year === d.replacementYear ? d.replacementCost * 10000 : 0;
      const net = saving - lostSales - d.maintenance - replacement;
      const prev = cumulative;
      cumulative += net;
      if (payback === null && prev < 0 && cumulative >= 0 && net > 0) payback = year - 1 + (-prev / net);
      rows.push({year,sellRate,discharge,charge,loss: charge-discharge,saving,lostSales,net,cumulative,
        importAfter: d.importKwh-discharge,exportAfter:d.exportKwh-charge,
        billAfter:d.bill-saving, salesBefore:d.exportKwh*sellRate,salesAfter:(d.exportKwh-charge)*sellRate});
    }
    return {errors:[],input:d,initial,rows,first:rows[0],cumulative,payback,
      direct:d.generation-d.exportKwh,notes};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {calculate,defaults};
  if (!root.document) return;
  const doc = root.document;
  const money = n => Math.round(n).toLocaleString('ja-JP');
  const number = n => n.toLocaleString('ja-JP',{maximumFractionDigits:1});
  const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const card = doc.querySelector('.proposal-mode-card');
  const customer = doc.getElementById('cn').closest('.section-card');
  let sibling = card.nextElementSibling;
  while (sibling) {
    if (sibling !== customer && sibling.id !== 'hyp-lock-overlay') sibling.classList.add('retrofit-legacy');
    sibling = sibling.nextElementSibling;
  }
  const style = doc.createElement('style');
  style.textContent = `body.retrofit-mode .retrofit-legacy{display:none!important}#retrofit-panel{display:none}body.retrofit-mode #retrofit-panel{display:block}#retrofit-panel .rt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}#retrofit-panel h3{font-size:16px;color:var(--dg);margin:22px 0 12px}#retrofit-panel small{color:var(--muted);display:block;line-height:1.6}#retrofit-panel .rt-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}#retrofit-panel .rt-kpi{padding:15px;border:1px solid var(--border);border-radius:10px;background:var(--pg)}#retrofit-panel .rt-kpi strong{display:block;font-size:20px;margin-top:7px;color:var(--dg)}#retrofit-panel table{border-collapse:collapse;width:100%;font-size:12px}#retrofit-panel th,#retrofit-panel td{padding:9px;text-align:right;border-bottom:1px solid var(--border);white-space:nowrap}#retrofit-panel th:first-child,#retrofit-panel td:first-child{text-align:left}#retrofit-panel .rt-error{color:#b91c1c;background:#fef2f2;padding:12px;border-radius:8px;font-size:12px;line-height:1.7}#retrofit-panel .rt-actions{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}@media(max-width:650px){#retrofit-panel .rt-grid,#retrofit-panel .rt-kpis{grid-template-columns:1fr}#retrofit-panel .rt-kpi strong{font-size:18px}}`;
  doc.head.appendChild(style);
  const panel = doc.createElement('section');
  panel.id = 'retrofit-panel'; panel.className = 'section-card';
  const input = f => `<div class="field"><label for="rt-${f[0]}">${f[1]}（${f[2]}）</label><input id="rt-${f[0]}" type="number" min="${f[3]}" ${f[4]===null?'':`max="${f[4]}"`} step="${['fitYears','years','days','replacementYear'].includes(f[0])?'1':'any'}" value="${f[5]}" placeholder="実績・見積値を入力"></div>`;
  const group = (title,start,end) => `<h3>${title}</h3><div class="rt-grid">${fields.slice(start,end).map(input).join('')}</div>`;
  panel.innerHTML = `<div class="section-title">🔋 卒FIT・蓄電池後付けの追加効果</div><p style="font-size:13px;line-height:1.8">比較基準は「既設太陽光をそのまま使う場合」です。直近12か月の実績と、追加する蓄電池の条件を入力してください。</p><small>ロック解除中の検証用機能です。初期表示される割合・年数は試算上の仮定で、メーカー保証値ではありません。</small>${group('1. 既設太陽光と現在の買電・売電',0,8)}<small>買電量は太陽光導入済みの現在の実績を入力。買電単価には放電で回避できる従量料金・燃料費調整・再エネ賦課金を含め、基本料金を含めないでください。FIT残存年数は整数年の概算です。卒FIT後の単価は契約先の条件を確認して入力してください。</small>${group('2. 蓄電池の運転条件',8,14)}<small>実効容量はメーカー資料で確認した利用可能エネルギーを入力。ここでは充電側の容量として扱い、往復効率を1回適用します。放電側保証値を使う場合は計算基準を確認してください。停電用確保分を日常の節約計算から除外します。</small>${group('3. 追加費用と試算期間',14,21)}<small>既設太陽光の購入費用を加算しないでください。PCS交換が必要な場合は追加費用に含めてください。将来交換費を計上しても容量の回復は見込まない保守的な試算です。</small><h3>4. 導入前後の比較</h3><div id="rt-result" aria-live="polite"></div><div class="rt-actions"><button type="button" class="gen-btn" id="rt-pptx">後付け専用の提案書を出力</button><button type="button" class="gen-btn" id="rt-save">入力データを保存</button></div><details><summary>設置前に確認する項目</summary><ul style="padding:14px 20px;font-size:13px;line-height:1.9"><li>既設PV・PCSの型式、設置年、保証、蓄電池との接続可否</li><li>単機能型／ハイブリッド型、PCS交換範囲、既設保証への影響</li><li>全負荷／特定負荷、100V／200V、停電時の出力・使用可能機器</li><li>設置場所、配線経路、基礎、追加工事、系統連系手続き</li><li>FIT終了時期、売電契約、補助金条件、容量保証・交換費</li></ul></details><small>${notes}</small>`;
  customer.after(panel);
  function read() { return Object.fromEntries(fields.map(f => [f[0],doc.getElementById('rt-'+f[0]).value])); }
  function restore(data) { fields.forEach(f=>{doc.getElementById('rt-'+f[0]).value = data?.[f[0]] ?? defaults[f[0]];}); }
  function render() {
    const r = calculate(read());
    const el = doc.getElementById('rt-result');
    doc.getElementById('rt-pptx').disabled = !!r.errors.length;
    if (r.errors.length) {el.innerHTML='<div class="rt-error">'+r.errors.map(escape).join('<br>')+'</div>'; return r;}
    const f=r.first;
    const comparison = [
      ['年間買電量',number(r.input.importKwh)+' kWh',number(f.importAfter)+' kWh'],
      ['年間売電量',number(r.input.exportKwh)+' kWh',number(f.exportAfter)+' kWh'],
      ['年間買電料金',money(r.input.bill)+' 円',money(f.billAfter)+' 円'],
      ['年間売電収入',money(f.salesBefore)+' 円',money(f.salesAfter)+' 円'],
      ['年間エネルギー収支（買電料金−売電収入）',money(r.input.bill-f.salesBefore)+' 円',money(f.billAfter-f.salesAfter)+' 円']
    ];
    el.innerHTML=`<div class="rt-kpis"><div class="rt-kpi">初年度の追加メリット<strong>${money(f.net)} 円/年</strong><small>買電削減−売電減少−維持・交換費</small></div><div class="rt-kpi">${r.input.years}年間の投資差引収支<strong>${number(r.cumulative/10000)} 万円</strong><small>補助金控除後の初期費用を含む</small></div><div class="rt-kpi">累計収支の初回黒字化<strong>${r.payback===null?'期間内に回収なし':r.payback===0?'初期負担なし':number(r.payback)+' 年'}</strong><small>年内均等の概算。将来の交換費で再び赤字になる場合があります。</small></div></div><div style="overflow-x:auto"><table><thead><tr><th>初年度の比較</th><th>既設PVのみ</th><th>蓄電池追加後</th></tr></thead><tbody>${comparison.map(row=>'<tr>'+row.map((x,i)=>`<${i?'td':'th'}>${x}</${i?'td':'th'}>`).join('')+'</tr>').join('')}</tbody></table></div><p style="font-size:12px;line-height:1.9;margin:12px 0">買電削減 <b>${money(f.saving)}円</b> − 売電収入減少 <b>${money(f.lostSales)}円</b> − 維持・交換費 <b>${money(f.saving-f.lostSales-f.net)}円</b> ＝ <b>${money(f.net)}円/年</b><br>充電 ${number(f.charge)} kWh → 放電 ${number(f.discharge)} kWh（損失 ${number(f.loss)} kWh）<br>既存の直接自家消費 ${number(r.direct)} kWh/年は導入前後共通。実質追加投資 ${number(r.initial/10000)}万円。</p>${f.net<=0?'<div class="rt-error">この条件では初年度の経済メリットはありません。売電単価・利用量・容量・費用を確認し、停電対策の価値は金銭効果と分けて説明してください。</div>':''}<details><summary>年ごとの効果・累計収支</summary><div style="overflow-x:auto"><table><thead><tr><th>年</th><th>売電単価</th><th>放電 kWh</th><th>追加メリット 円</th><th>投資差引累計 円</th></tr></thead><tbody>${r.rows.map(y=>`<tr><th>${y.year}</th><td>${number(y.sellRate)}</td><td>${number(y.discharge)}</td><td>${money(y.net)}</td><td>${money(y.cumulative)}</td></tr>`).join('')}</tbody></table></div></details>`;
    return r;
  }
  async function pptx() {
    if (!isEditUnlocked()) {onWipModeClick('battery_only');return;}
    const r=render(); if(r.errors.length)return;
    const button=doc.getElementById('rt-pptx'); button.disabled=true;
    try {
      if (typeof root.pptxgen !== 'function') throw new Error('提案書生成ライブラリを読み込めません。通信を確認してください。');
      const p=new root.pptxgen();p.layout='LAYOUT_WIDE';p.author='株式会社アズマ';p.subject='既設太陽光への蓄電池後付け・年次概算';p.title='卒FIT 蓄電池後付け提案';p.lang='ja-JP';
      function slide(title, lines) {
        const s=p.addSlide();s.background={color:'FFFAF1'};
        s.addText(title,{x:.6,y:.4,w:12.1,h:.6,fontSize:24,bold:true,color:'166534',fontFace:'Meiryo'});
        lines.forEach((line,i)=>s.addText(line,{x:.7,y:1.3+i*.66,w:11.9,h:.55,fontSize:16,color:'1E293B',fontFace:'Meiryo',breakLine:false}));
        s.addText('株式会社アズマ｜じぶん電気　年次概算・効果を保証するものではありません',{x:.7,y:7.05,w:12,h:.2,fontSize:9,color:'64748B'});
        return s;
      }
      const d=r.input,f=r.first,name=doc.getElementById('cn').value || 'お客様';
      slide('蓄電池後付けのご提案',[
        name.slice(0,80),
        `既設PV 年間発電 ${number(d.generation)} kWh ／ 売電 ${number(d.exportKwh)} kWh`,
        `現在の年間買電 ${number(d.importKwh)} kWh ／ 買電料金 ${money(d.bill)} 円`,
        `買電従量単価 ${number(d.buyRate)} 円/kWh ／ 卒FIT後売電 ${number(d.sellRate)} 円/kWh`,
        `FIT残存 ${d.fitYears} 年 ／ FIT単価 ${number(d.fitRate)} 円/kWh`,
        `実効容量 ${number(d.capacity)} kWh ／ 停電用確保 ${d.reserve}%`,
        `追加工事費 ${number(d.cost)} 万円 − 補助金 ${number(d.subsidy)} 万円 = ${number(r.initial/10000)} 万円`,
        '比較基準：既設太陽光を継続利用。既設の自家消費効果は追加効果に含めません。'
      ]);
      slide('蓄電池追加による経済効果',[
        `初年度の買電削減 ${money(f.saving)} 円 − 売電収入減少 ${money(f.lostSales)} 円`,
        `維持・交換費控除後の初年度メリット：${money(f.net)} 円/年`,
        `買電量：${number(d.importKwh)} → ${number(f.importAfter)} kWh/年`,
        `売電量：${number(d.exportKwh)} → ${number(f.exportAfter)} kWh/年`,
        `${d.years}年間の投資差引収支：${number(r.cumulative/10000)} 万円`,
        `累計収支の初回黒字化：${r.payback===null?'試算期間内に回収なし':number(r.payback)+' 年（概算）'}`,
        `充電 ${number(f.charge)} → 放電 ${number(f.discharge)} kWh/年（往復損失を控除）`,
        '初回黒字化後も交換費で再び赤字になる場合があります。'
      ]);
      slide('試算条件と設置前の確認',[
        `効率 ${d.efficiency}% ／ 充電可能割合 ${d.matching}% ／ 買電置換可能割合 ${d.nightShare}%`,
        `稼働 ${d.days}日/年 ／ 容量低下 ${d.degradation}%/年 ／ 試算 ${d.years}年（保証期間ではありません）`,
        `維持費 ${money(d.maintenance)} 円/年 ／ ${d.replacementYear}年目の交換費 ${number(d.replacementCost)} 万円`,
        '単価・既設PV発電量は一定。金利・税効果・系統充電・プラン変更は含みません。',
        '年次概算です。天候・時間差・出力制限は割合で簡略化。最終設計では30分値等を確認。',
        '既設PV・PCS型式、保証、接続可否、PCS交換要否、追加工事を確認してください。',
        '停電時の使用機器・出力、全負荷／特定負荷、200V対応を確認してください。',
        '補助金・売電契約・保証を確認。停電対策の価値は経済効果と分けて説明します。'
      ]);
      for(let i=0;i<r.rows.length;i+=8){
        slide(`年次収支（${i+1}〜${Math.min(i+8,r.rows.length)}年）`,r.rows.slice(i,i+8).map(y=>`${y.year}年目｜売電 ${number(y.sellRate)}円｜追加メリット ${money(y.net)}円｜投資差引累計 ${money(y.cumulative)}円`));
      }
      await p.writeFile({fileName:name.replace(/[\\/:*?"<>|]/g,'_').slice(0,60)+'_卒FIT蓄電池後付け.pptx'});
      saveCustomer();toast('後付け専用の提案書を生成しました');
    } catch(e) {toast(e.message,'error');} finally {button.disabled=false;}
  }
  panel.addEventListener('input',()=>{render();autoSaveToCurrent();});
  doc.getElementById('rt-pptx').addEventListener('click',pptx);
  doc.getElementById('rt-save').addEventListener('click',()=>exportFormData());
  root.Retrofit={read,restore,render,pptx,calculate,toggle(active){doc.body.classList.toggle('retrofit-mode',active);}};
})(typeof window==='undefined'?globalThis:window);
