// じぶん電気ツール ローン金利専用API（顧客データ管理APIとは完全分離）

// このApps Scriptは専用のローン金利管理スプレッドシートに紐づけて使用する。

// Webアプリ: 実行ユーザー=自分 / アクセス=全員。書込はLOAN_RATE_ADMIN_KEYで認証。

const TZ = 'Asia/Tokyo';

const GUEST_USER = 'ゲストユーザー';

function _json(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function _nowJst() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

// 1行目ヘッダー → { 列名: 列番号(1始まり) }。不足列は右端に追加


function _safeText(v) {
  const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// ── ローン会社別金利マスタ（顧客履歴と分離） ──
// 編集権限は画面表示名・メール欄ではなくスクリプトプロパティ
// LOAN_RATE_ADMIN_KEY による認証で判定する。未設定なら書込み不可。
// 編集キーはHTML/ログ/スプレッドシートに保存しない。
const LOAN_RATE_SHEET = 'ローン金利マスタ';
const LOAN_RATE_AUDIT = 'ローン金利変更履歴';
const LOAN_RATE_HEADERS = [
  '商品ID','適用年月','年率(%)','出典','登録者名(申告)','登録日時(JST)','更新日時(JST)'
];
const LOAN_RATE_AUDIT_HEADERS = [
  '変更日時(JST)','商品ID','適用年月','変更前金利(%)','変更後金利(%)',
  '変更前出典','変更後出典','登録者名(申告)','操作'
];
const LOAN_RATE_PRODUCTS = ['orico_reform','jaccs_fixed','jaccs_variable'];


function _rateSheet(name, headers, create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh && create) {
    sh = ss.insertSheet(name);
    sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}


function _rateAuthorized(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('LOAN_RATE_ADMIN_KEY');
  // Never allow edits without an administrator-configured secret.
  if (!expected || String(expected).length < 32 || typeof provided !== 'string') return false;
  // Constant-work comparison to avoid short-circuit prefix checks.
  let mismatch = expected.length ^ provided.length;
  const len = Math.max(expected.length, provided.length);
  for (let i = 0; i < len; i++) {
    mismatch |= (expected.charCodeAt(i) || 0) ^ (provided.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}


function _readLoanRates() {
  const sh = _rateSheet(LOAN_RATE_SHEET, LOAN_RATE_HEADERS, false);
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2,1,sh.getLastRow()-1,LOAN_RATE_HEADERS.length).getValues();
  return rows.filter(row => LOAN_RATE_PRODUCTS.indexOf(String(row[0])) >= 0 &&
      /^\d{4}-(0[1-9]|1[0-2])$/.test(String(row[1])) &&
      Number(row[2]) > 0 && Number(row[2]) <= 30).map(row => ({
        product:String(row[0]),month:String(row[1]),rate:Number(row[2]),
        source:String(row[3]),author:String(row[4]),updatedAt:String(row[6] || row[5])
      }));
}


function _saveLoanRate(data) {
  if (!_rateAuthorized(data.editorKey)) {
    return _json({ok:false,status:'error',error:'unauthorized'});
  }

  const product = String(data.product || '');
  const month = String(data.month || '');
  const rate = Number(data.rate);
  const source = String(data.source || '').trim();
  const author = String(data.author || '').trim();

  if (LOAN_RATE_PRODUCTS.indexOf(product) < 0 ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      !Number.isFinite(rate) || rate <= 0 || rate > 30 ||
      rate !== Math.round(rate * 100) / 100 ||
      !source || source.length > 200 ||
      !author || author.length > 80 || author === GUEST_USER) {
    return _json({ok:false,status:'error',error:'invalid loan rate data'});
  }

  const sh = _rateSheet(LOAN_RATE_SHEET, LOAN_RATE_HEADERS, true);
  const audit = _rateSheet(LOAN_RATE_AUDIT, LOAN_RATE_AUDIT_HEADERS, true);
  let existing = -1;
  let prior = null;

  if (sh.getLastRow() >= 2) {
    const rows = sh.getRange(2,1,sh.getLastRow()-1,LOAN_RATE_HEADERS.length).getValues();
    const offset = rows.findIndex(row =>
      String(row[0]) === product && String(row[1]) === month
    );
    if (offset >= 0) {
      existing = offset + 2;
      prior = rows[offset];
    }
  }

  const timestamp = _nowJst();
  const destination = existing < 0 ? sh.getLastRow() + 1 : existing;
  const previousAuditLastRow = audit.getLastRow();
  let masterWriteAttempted = false;

  try {
    // 金利マスタを先に書き込み、履歴追記に失敗した場合は補償ロールバックする。
    sh.getRange(destination,2).setNumberFormat('@');
    masterWriteAttempted = true;
    sh.getRange(destination,1,1,LOAN_RATE_HEADERS.length).setValues([[
      product, month, rate, _safeText(source), _safeText(author),
      existing < 0 ? timestamp : (prior[5] || timestamp), timestamp
    ]]);
    SpreadsheetApp.flush();

    audit.appendRow([
      timestamp,product,month,prior ? Number(prior[2]) : '',
      rate,prior ? _safeText(prior[3]) : '',_safeText(source),
      _safeText(author),existing < 0 ? '新規登録' : '更新'
    ]);
    SpreadsheetApp.flush();

  } catch (err) {
    const rollbackErrors = [];
    if (masterWriteAttempted) {
      try {
        if (existing >= 0 && prior) {
          sh.getRange(destination,1,1,LOAN_RATE_HEADERS.length).setValues([prior]);
        } else if (sh.getLastRow() >= destination) {
          sh.deleteRow(destination);
        }
        SpreadsheetApp.flush();
      } catch (rollbackErr) {
        rollbackErrors.push('金利マスタ復旧失敗: ' + String(rollbackErr));
      }
    }
    try {
      while (audit.getLastRow() > previousAuditLastRow) {
        audit.deleteRow(audit.getLastRow());
      }
      SpreadsheetApp.flush();
    } catch (rollbackErr) {
      rollbackErrors.push('変更履歴復旧失敗: ' + String(rollbackErr));
    }
    const detail = rollbackErrors.length
      ? ' / 補償処理要確認: ' + rollbackErrors.join(' / ')
      : '金利マスタと変更履歴を更新前の状態へ戻しました。';
    return _json({
      ok:false,status:'error',
      error:'金利登録に失敗しました: ' + String(err) + detail
    });
  }

  return _json({
    ok:true,status:'success',
    action:existing < 0 ? 'inserted' : 'updated',
    product:product,month:month,rate:rate,updatedAt:timestamp
  });
}

function doGet(e) {

  try {

    const p = (e && e.parameter) || {};

    if (p.action === 'loanRates') return _json({ok:true,status:'success',rates:_readLoanRates()});

    if (p.action === 'ping') return _json({ok:true,status:'success',service:'loan-rate-registry',timeZone:TZ});

    return _json({ok:false,status:'error',error:'unknown action'});

  } catch (err) { return _json({ok:false,status:'error',error:String(err)}); }

}

function doPost(e) {

  const lock = LockService.getScriptLock();

  try {

    lock.waitLock(10000);

    const data = JSON.parse((e.postData && e.postData.contents) || '{}');

    if (data.action !== 'saveLoanRate') return _json({ok:false,status:'error',error:'unknown action'});

    return _saveLoanRate(data);

  } catch (err) { return _json({ok:false,status:'error',error:String(err)}); }

  finally { try { lock.releaseLock(); } catch (ignored) {} }

}