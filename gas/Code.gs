// じぶん電気ツール → スプレッドシート Upsert 受け口
// 列: A:id B:updated_at C:author D:proposal_name E:customer_name F:category
//     G:monthly_bill H:monthly_usage I:json_data J:aiClosingComment
const SHEET_NAME = ''; // 空なら先頭シート
const COLUMNS = [
  'id', 'updated_at', 'author', 'proposal_name', 'customer_name', 'category',
  'monthly_bill', 'monthly_usage', 'json_data', 'aiClosingComment'
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const data = JSON.parse(e.postData.contents || '{}');
    if (!data.id) return _json({ ok: false, error: 'id required' });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = (SHEET_NAME && ss.getSheetByName(SHEET_NAME)) || ss.getSheets()[0];

    // ヘッダー未整備なら補完（J列 aiClosingComment 追加含む）
    const header = sheet.getRange(1, 1, 1, COLUMNS.length).getValues()[0];
    if (COLUMNS.some((c, i) => header[i] !== c)) {
      sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    }

    const row = COLUMNS.map(k => {
      const v = data[k];
      return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v);
    });

    // A列の id で既存行を検索 → 上書き / なければ追記
    const lastRow = sheet.getLastRow();
    let target = -1;
    if (lastRow >= 2) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      const idx = ids.findIndex(r => String(r[0]) === String(data.id));
      if (idx !== -1) target = idx + 2;
    }
    if (target === -1) target = lastRow + 1;

    sheet.getRange(target, 1, 1, COLUMNS.length).setValues([row]);
    return _json({ ok: true, row: target });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
