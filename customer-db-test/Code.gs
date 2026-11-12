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
