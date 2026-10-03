// じぶん電気ツール ⇄ スプレッドシート連携（Upsert / 一覧取得）
//
// 列は「1行目のヘッダー名」で対応付けます（列順がズレても正しい列へ書き込み）。
// 必要な列が無ければ右端に自動追加します。
//
// 合言葉（任意）: スクリプトプロパティ API_TOKEN を設定すると、
//   POST は body.token、GET は ?token= が一致しない限り拒否します。
//   （プロジェクトの設定 → スクリプト プロパティ → API_TOKEN）

const SHEET_NAME = '';           // 空なら先頭シート
const TZ = 'Asia/Tokyo';
const COLUMNS = [
  'id', 'updated_at', 'author', 'proposal_name', 'customer_name', 'category',
  'monthly_bill', 'monthly_usage', 'json_data', 'aiClosingComment'
];
const NUMBER_COLUMNS = ['monthly_bill', 'monthly_usage'];

function _sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return (SHEET_NAME && ss.getSheetByName(SHEET_NAME)) || ss.getSheets()[0];
}

function _tokenOk(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN') || '';
  return !expected || String(token || '') === expected;
}

function _nowJst() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

// 1行目ヘッダー → { 列名: 列番号(1始まり) }。不足列は右端に追加
function _headerMap(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const map = {};
  header.forEach((h, i) => { if (h) map[h] = i + 1; });
  let next = header.filter(h => h).length ? lastCol + 1 : 1;
  COLUMNS.forEach(c => {
    if (!map[c]) { sheet.getRange(1, next).setValue(c); map[c] = next++; }
  });
  return map;
}

function _toNumber(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^\d.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

// 数式インジェクション対策（= + - @ で始まる文字列は文字列として保存）
function _safeText(v) {
  const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const data = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (!_tokenOk(data.token)) return _json({ ok: false, status: 'error', error: 'unauthorized' });
    if (!data.id) return _json({ ok: false, status: 'error', error: 'id required' });

    const sheet = _sheet();
    const map = _headerMap(sheet);
    const width = Math.max(sheet.getLastColumn(), ...Object.values(map));

    // id で既存行を検索
    const lastRow = sheet.getLastRow();
    let target = -1;
    if (lastRow >= 2) {
      const ids = sheet.getRange(2, map.id, lastRow - 1, 1).getValues();
      const idx = ids.findIndex(r => String(r[0]) === String(data.id));
      if (idx !== -1) target = idx + 2;
    }
    const action = target === -1 ? 'inserted' : 'updated';
    if (target === -1) target = lastRow + 1;

    // 既存行を読み、管理列だけ上書き（他の手入力列は保持）
    const row = action === 'updated'
      ? sheet.getRange(target, 1, 1, width).getValues()[0]
      : new Array(width).fill('');
    COLUMNS.forEach(c => {
      let v = data[c];
      if (c === 'id') v = String(data.id);
      else if (c === 'updated_at') v = _nowJst();           // サーバー側でJST確定
      else if (NUMBER_COLUMNS.indexOf(c) !== -1) v = _toNumber(v);
      else v = _safeText(v);
      row[map[c] - 1] = v;
    });

    // id はテキスト書式（13桁の数値丸め・指数表記を防止）
    sheet.getRange(target, map.id).setNumberFormat('@');
    sheet.getRange(target, 1, 1, width).setValues([row]);
    return _json({ ok: true, status: 'success', action: action, row: target });
  } catch (err) {
    return _json({ ok: false, status: 'error', error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 全行を JSON で返す（他端末からの一覧読込用）
function doGet(e) {
  try {
    if (!_tokenOk(e && e.parameter && e.parameter.token)) {
      return _json({ ok: false, status: 'error', error: 'unauthorized' });
    }
    const sheet = _sheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return _json({ ok: true, status: 'success', rows: [] });

    const map = _headerMap(sheet);
    const width = sheet.getLastColumn();
    const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    const rows = values
      .filter(r => String(r[map.id - 1]).trim() !== '')
      .map(r => {
        const o = {};
        COLUMNS.forEach(c => {
          const v = r[map[c] - 1];
          o[c] = v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss') : v;
        });
        o.id = String(o.id);
        return o;
      });
    return _json({ ok: true, status: 'success', rows: rows });
  } catch (err) {
    return _json({ ok: false, status: 'error', error: String(err) });
  }
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
