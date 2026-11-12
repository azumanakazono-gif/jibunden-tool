/**
 * じぶん電気ツール 顧客DBクラウド検証専用
 * PR #318 の保存・復元テスト専用。既存の本番顧客DBには接続しない。
 * Webアプリとしてデプロイし、実行ユーザーはオーナー、アクセスは組織ポリシーに合わせて設定する。
 */
const TEST_SPREADSHEET_ID = '1eVVaZI_a0LQCq1gLpFhftQg_OMQek8r75tKDKGnspAE';
const TEST_CUSTOMER_ID = 'TEST-LOAN-20261111';
const CUSTOMER_SHEET = '顧客データ';
const LOG_SHEET = '保存・復元テストログ';
const HEADERS = ['id','updated_at','author','proposal_name','customer_name','category','monthly_bill','monthly_usage','json_data','aiClosingComment','operation'];

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  if (e && e.parameter && e.parameter.view === 'test') {
    return HtmlService.createHtmlOutput(testPageHtml_()).setTitle('顧客DB・検証専用画面');
  }
  try {
    const ss = SpreadsheetApp.openById(TEST_SPREADSHEET_ID);
    const sh = ss.getSheetByName(CUSTOMER_SHEET);
    if (!sh) throw new Error('顧客データシートがありません');
    const values = sh.getDataRange().getDisplayValues();
    const rows = values.slice(1).filter(r => r[0] === TEST_CUSTOMER_ID).map(r => {
      const o = {};
      HEADERS.forEach((h,i) => o[h] = r[i] || '');
      return o;
    });
    return json_({ok:true, rows:rows});
  } catch (err) {
    return json_({ok:false,error:String(err.message || err),rows:[]});
  }
}
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (String(payload.id || '') !== TEST_CUSTOMER_ID) {
      throw new Error('この検証APIは専用テストID以外を更新できません');
    }
    if (!payload.json_data || typeof payload.json_data !== 'string') {
      throw new Error('json_data がありません');
    }
    const parsed = JSON.parse(payload.json_data);
    if (String(parsed.id || '') !== TEST_CUSTOMER_ID || !parsed.paymentPlan || parsed.paymentPlan.version !== 1) {
      throw new Error('保存対象の支払条件データが不正です');
    }
    const ss = SpreadsheetApp.openById(TEST_SPREADSHEET_ID);
    const sh = ss.getSheetByName(CUSTOMER_SHEET);
    const log = ss.getSheetByName(LOG_SHEET);
    if (!sh || !log) throw new Error('検証用シートがありません');
    const values = sh.getDataRange().getDisplayValues();
    const rowIndex = values.findIndex((r,i) => i > 0 && r[0] === TEST_CUSTOMER_ID);
    if (rowIndex < 1) throw new Error('専用テストレコードが見つかりません');
    const old = values[rowIndex];
    if (old[2] && old[2] !== '検証用') throw new Error('検証用レコードの所有者が一致しません');
    const row = [
      TEST_CUSTOMER_ID,
      payload.updated_at || new Date().toISOString(),
      '検証用',
      '検証用ローン保存復元',
      '検証専用',
      'ローン保存・復元テスト',
      '',
      '',
      JSON.stringify(parsed),
      '',
      '導入手段保存'
    ];
    sh.getRange(rowIndex + 1, 1, 1, HEADERS.length).setValues([row]);
    log.appendRow([new Date(), TEST_CUSTOMER_ID, '保存', '成功',
      'paymentPlan v' + parsed.paymentPlan.version + ' / ' + parsed.paymentPlan.lender + ' / ' + parsed.paymentPlan.inputs['po-lc'] + '回']);
    return json_({ok:true,id:TEST_CUSTOMER_ID,action:'updated'});
  } catch (err) {
    try {
      const ss = SpreadsheetApp.openById(TEST_SPREADSHEET_ID);
      const log = ss.getSheetByName(LOG_SHEET);
      if (log) log.appendRow([new Date(), TEST_CUSTOMER_ID, '保存', '失敗', String(err.message || err)]);
    } catch (_) {}
    return json_({ok:false,error:String(err.message || err)});
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/**
 * エディタから実行するクラウド保存→再読込の検証。
 * 本番顧客DBは参照せず、TEST_CUSTOMER_ID だけを更新する。
 */
function testCloudSaveAndRestore() {
  const inputs = {
    'po-mb':'', 'po-cost':'338', 'po-dp':'0',
    'po-lender':'orico_solar_variable', 'po-lr':'4.5', 'po-lc':'180',
    'po-official-monthly':'', 'po-official-first':'',
    'po-la-m':'', 'po-lr-m':'', 'po-lc-m':'', 'po-monthly-m':''
  };
  const paymentPlan = {
    version:1,selectedPayment:'loan',mode:'preset',
    lender:'orico_solar_variable',method:'kinri',inputs:inputs,
    officialResult:null,
    calculatedMonthlyPayment:25857,
    calculatedLoanCount:180,
    calculatedPrincipal:3380000,
    updatedAt:new Date().toISOString()
  };
  const payload = {
    id:TEST_CUSTOMER_ID,
    updated_at:new Date().toISOString(),
    json_data:JSON.stringify({id:TEST_CUSTOMER_ID,testRecord:true,paymentPlan:paymentPlan})
  };
  const result = JSON.parse(doPost({postData:{contents:JSON.stringify(payload)}}).getContent());
  if (!result.ok || result.id !== TEST_CUSTOMER_ID || result.action !== 'updated') {
    throw new Error('保存に失敗: '+JSON.stringify(result));
  }
  const fetched = JSON.parse(doGet().getContent());
  if (!fetched.ok || !Array.isArray(fetched.rows)) throw new Error('再取得に失敗');
  const row = fetched.rows.find(r=>r.id===TEST_CUSTOMER_ID);
  if (!row) throw new Error('保存したテストIDが見つかりません');
  const actual = JSON.parse(row.json_data || '{}').paymentPlan;
  if (!actual || actual.lender!==paymentPlan.lender ||
      actual.inputs['po-lr']!==paymentPlan.inputs['po-lr'] ||
      actual.inputs['po-lc']!==paymentPlan.inputs['po-lc'] ||
      actual.calculatedMonthlyPayment!==paymentPlan.calculatedMonthlyPayment ||
      actual.calculatedPrincipal!==paymentPlan.calculatedPrincipal) {
    throw new Error('保存前後の値に差があります: '+JSON.stringify(actual));
  }
  console.log('PASS：検証専用DBへの保存と再取得が一致しました / '
    +actual.lender+' / '+actual.inputs['po-lr']+'% / '
    +actual.inputs['po-lc']+'回 / 月額'+actual.calculatedMonthlyPayment+'円');
}

/**
 * Apps Scriptと同一オリジンで動作する検証用画面。
 * 「自分のみ」設定を維持し、google.script.runで通信する。
 * 本番ツール・本番DBには一切接続しない。
 */
function loadTestPaymentPlan() {
  const response = JSON.parse(doGet().getContent());
  if (!response.ok) throw new Error(response.error || 'データ取得失敗');
  const row = (response.rows || []).find(r => r.id === TEST_CUSTOMER_ID);
  if (!row) throw new Error('検証レコードがありません');
  const data = JSON.parse(row.json_data || '{}');
  return {id: TEST_CUSTOMER_ID, paymentPlan: data.paymentPlan || null, updated_at: row.updated_at || ''};
}

function saveTestPaymentPlan(input) {
  if (!input || typeof input !== 'object') throw new Error('入力データが不正です');
  const lender = String(input.lender || '');
  const interestRate = Number(input.interestRate);
  const loanCount = Number(input.loanCount);
  const loanAmount = Number(input.loanAmount);
  const monthlyPayment = Number(input.monthlyPayment);
  if (lender !== 'orico_solar_variable') throw new Error('検証用ローン会社以外は保存できません');
  if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 20 ||
      !Number.isInteger(loanCount) || loanCount < 1 || loanCount > 240 ||
      !Number.isInteger(loanAmount) || loanAmount < 1 || loanAmount > 100000000 ||
      !Number.isInteger(monthlyPayment) || monthlyPayment < 0 || monthlyPayment > 10000000) {
    throw new Error('数値の入力範囲を確認してください');
  }
  const inputs = {
    'po-mb':'',
    'po-cost':String(loanAmount / 10000),
    'po-dp':'0',
    'po-lender':lender,
    'po-lr':String(interestRate),
    'po-lc':String(loanCount),
    'po-official-monthly':'',
    'po-official-first':'',
    'po-la-m':'',
    'po-lr-m':'',
    'po-lc-m':'',
    'po-monthly-m':''
  };
  const paymentPlan = {
    version:1,
    selectedPayment:'loan',
    mode:'preset',
    lender:lender,
    method:'kinri',
    inputs:inputs,
    officialResult:null,
    calculatedMonthlyPayment:monthlyPayment,
    calculatedLoanCount:loanCount,
    calculatedPrincipal:loanAmount,
    updatedAt:new Date().toISOString()
  };
  const payload = {
    id: TEST_CUSTOMER_ID,
    updated_at: new Date().toISOString(),
    json_data: JSON.stringify({id:TEST_CUSTOMER_ID, testRecord:true, paymentPlan:paymentPlan})
  };
  const response = JSON.parse(doPost({postData:{contents:JSON.stringify(payload)}}).getContent());
  if (!response.ok) throw new Error(response.error || '保存失敗');
  return loadTestPaymentPlan();
}

function testPageHtml_() {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>じぶん電気・検証専用</title>
<style>
body{font-family:system-ui,"Noto Sans JP",sans-serif;background:#f4f7f8;color:#19333b;margin:0;padding:24px}
main{max-width:660px;margin:auto;background:white;padding:28px;border-radius:14px;box-shadow:0 3px 22px #142b3414}
h1{font-size:1.25rem;margin:0 0 8px}
.note{background:#edf5f6;padding:12px;border-radius:8px;font-size:.9rem;margin:18px 0}
label{display:block;margin:15px 0 4px;font-weight:600}
input,select{width:100%;box-sizing:border-box;padding:11px;font:inherit;border:1px solid #a9b8bc;border-radius:7px}
.actions{display:flex;gap:10px;margin:22px 0 8px;flex-wrap:wrap}
button{padding:11px 18px;background:#086882;color:white;border:0;border-radius:7px;font:inherit;cursor:pointer}
button.secondary{background:#e3eaed;color:#15343c}
button:disabled{opacity:.5;cursor:wait}
#message{min-height:55px;padding:12px;background:#f4f7f8;border-radius:8px;white-space:pre-wrap}
small{color:#4e6570}
</style></head><body><main>
<h1>じぶん電気｜クラウド保存・復元 検証専用</h1>
<small>TEST-LOAN-20261111 / 本番顧客データとは切り離されています</small>
<div class="note">この画面は検証用GAS内で動作します。Googleアカウント本人だけがアクセス可能な設定のまま、データの保存と復元を確認します。月額は計算し直さず、検証用の記録値を保持します。</div>
<label for="lender">ローン会社</label>
<select id="lender"><option value="orico_solar_variable">オリコ 太陽光・蓄電池用変動（検証値）</option></select>
<label for="interestRate">適用金利（%）</label><input id="interestRate" type="number" min="0" max="20" step="0.01" value="4.5">
<label for="loanCount">返済回数（回）</label><input id="loanCount" type="number" min="1" max="240" step="1" value="180">
<label for="loanAmount">借入額（円）</label><input id="loanAmount" type="number" min="1" max="100000000" step="1" value="3380000">
<label for="monthlyPayment">月額返済（円・検証用の保存値）</label><input id="monthlyPayment" type="number" min="0" max="10000000" step="1" value="25857">
<div class="actions"><button id="save">クラウドDBに保存</button><button id="load" class="secondary">クラウドDBから復元</button></div>
<div id="message" role="status">まず「クラウドDBから復元」を押して、保存済みのデータを確認してください。</div>
<small>※ 本画面は検証用であり、実際のお客様への返済額提案には使用しません。</small>
</main><script>
(function () {
  'use strict';
  var names=['lender','interestRate','loanCount','loanAmount','monthlyPayment'];
  var $=function(id){return document.getElementById(id);};
  var setBusy=function(b){$('save').disabled=b;$('load').disabled=b;};
  var message=function(v){$('message').textContent=v;};
  var format=function(p){
    if(!p) return '検証レコードに支払条件がありません';
    return 'ローン会社：'+p.lender+'\\n金利：'+p.inputs['po-lr']+
      '% / 返済：'+p.inputs['po-lc']+'回\\n借入額：'+p.calculatedPrincipal+
      '円 / 月額：'+p.calculatedMonthlyPayment+'円';
  };
  var restore=function(data){
    if(!data||!data.paymentPlan){message('クラウドDBに保存された支払条件がありません');return;}
    var p=data.paymentPlan;
    $('lender').value=p.lender;
    $('interestRate').value=p.inputs['po-lr'];
    $('loanCount').value=p.inputs['po-lc'];
    $('loanAmount').value=p.calculatedPrincipal;
    $('monthlyPayment').value=p.calculatedMonthlyPayment;
    message('クラウドDBから復元しました。\\n'+format(p));
  };
  $('load').addEventListener('click',function(){
    setBusy(true);message('クラウドDBから取得中…');
    google.script.run.withSuccessHandler(function(d){setBusy(false);restore(d);})
      .withFailureHandler(function(e){setBusy(false);message('復元失敗：'+e.message);})
      .loadTestPaymentPlan();
  });
  $('save').addEventListener('click',function(){
    var data={};names.forEach(function(k){data[k]=$(k).value;});
    setBusy(true);message('検証専用DBに保存中…');
    google.script.run.withSuccessHandler(function(d){
      setBusy(false);message('クラウドDBへの保存に成功しました。\\n'+format(d.paymentPlan));
    }).withFailureHandler(function(e){setBusy(false);message('保存失敗：'+e.message);})
      .saveTestPaymentPlan(data);
  });
}());
</script></body></html>`;
}
