// じぶん電気ツール ⇄ スプレッドシート連携（Upsert / 一覧取得）
//
// 列は「1行目のヘッダー名」で対応付けます（列順がズレても正しい列へ書き込み）。
// 必要な列が無ければ右端に自動追加します。
//
// 合言葉（任意）: スクリプトプロパティ API_TOKEN を設定すると、
//   POST は body.token、GET は ?token= が一致しない限り拒否します。
//   （プロジェクトの設定 → スクリプト プロパティ → API_TOKEN）
//
// CORS: GASは ContentService の応答に Access-Control-Allow-Origin: * を自動付与する
//   （独自ヘッダーは設定不可）。条件は「実行ユーザー=自分 / アクセス=全員」で公開し、
//   doGet・doPost が必ず JSON を返すこと。関数が無い・例外で HTML エラーページになると
//   ヘッダーが付かずブラウザでは CORS エラー（Failed to fetch）になる。
//   フロントは Content-Type: text/plain で送りプリフライト（OPTIONS）を回避している。
//   デプロイ確認: <URL>?action=ping → {"ok":true,"version":"…"} が返れば正常

const VERSION = '2026-10-10';

const SHEET_NAME = '';           // 空なら先頭シート
const TZ = 'Asia/Tokyo';
const COLUMNS = [
  'id', 'updated_at', 'author', 'proposal_name', 'customer_name', 'category',
  'monthly_bill', 'monthly_usage', 'json_data', 'aiClosingComment'
];
const NUMBER_COLUMNS = ['monthly_bill', 'monthly_usage'];

// 使用者ログ（保存のたびに1行追記する別シート）
const LOG_SHEET_NAME = '使用者ログ';
const LOG_HEADER = ['タイムスタンプ', '使用者', '取得元', '操作内容', '提案名', '顧客名', '区分', 'id', '行番号'];
const GUEST_USER = 'ゲストユーザー';

function _sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return (SHEET_NAME && ss.getSheetByName(SHEET_NAME)) || ss.getSheets()[0];
}

// 使用者の特定: Googleアカウント → 画面の担当者名 → ゲストユーザー
// ※ ウェブアプリを「自分として実行・全員アクセス可」で公開している場合、
//    getActiveUser() は同一Workspaceドメイン外だと空文字になるためフォールバック必須
function _resolveUser(data) {
  let email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (err) { email = ''; }
  if (email) return { user: email, source: 'Googleアカウント' };
  const author = String((data && data.author) || '').trim();
  if (author && author !== GUEST_USER) return { user: author, source: '画面の担当者名' };
  return { user: GUEST_USER, source: 'フォールバック' };
}

function _logSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sh) {
    // 末尾に追加（先頭シート＝メインデータの位置を崩さない）
    sh = ss.insertSheet(LOG_SHEET_NAME, ss.getSheets().length);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ログ追記の失敗はメイン保存を失敗扱いにしない
function _appendLog(who, operation, data, row) {
  try {
    _logSheet().appendRow([
      _nowJst(), _safeText(who.user), who.source, _safeText(operation),
      _safeText(data.proposal_name), _safeText(data.customer_name), _safeText(data.category),
      "'" + String(data.id), row
    ]);
    return true;
  } catch (err) {
    console.error('使用者ログ追記失敗: ' + err);
    return false;
  }
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

// シート内で重複しない数値ID（ミリ秒ベース）
function _newId(sheet, map, lastRow) {
  const used = lastRow >= 2
    ? sheet.getRange(2, map.id, lastRow - 1, 1).getValues().map(r => String(r[0]))
    : [];
  let id = Date.now();
  while (used.indexOf(String(id)) !== -1) id++;
  return String(id);
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

    const who = _resolveUser(data);
    // 使用者が特定できない（ゲスト）保存は拒否：データもログも書き込まない
    if (who.user === GUEST_USER) return _json({ ok: false, status: 'error', error: 'user required' });
    const sheet = _sheet();
    if (sheet.getName() === LOG_SHEET_NAME) throw new Error('メインデータシートが見つかりません');
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
    let action = target === -1 ? 'inserted' : 'updated';

    // 上書き保護：既存行の作成者が保存者と異なる場合は上書きせず、新しいIDで新規行として追加
    const requester = String(data.author || '').trim() || who.user;
    if (action === 'updated') {
      const owner = String(sheet.getRange(target, map.author).getValue() || '').replace(/^'/, '').trim();
      if (owner && owner !== requester) {
        data.id = _newId(sheet, map, lastRow);
        target = -1;
        action = 'forked';
      }
    }
    if (target === -1) target = lastRow + 1;

    // 既存行を読み、管理列だけ上書き（他の手入力列は保持）
    const row = action === 'updated'
      ? sheet.getRange(target, 1, 1, width).getValues()[0]
      : new Array(width).fill('');
    COLUMNS.forEach(c => {
      let v = data[c];
      if (c === 'id') v = String(data.id);
      else if (c === 'author') v = _safeText(requester); // 未入力なら使用者で補完
      else if (c === 'updated_at') v = _nowJst();           // サーバー側でJST確定
      else if (NUMBER_COLUMNS.indexOf(c) !== -1) v = _toNumber(v);
      else v = _safeText(v);
      row[map[c] - 1] = v;
    });

    // id はテキスト書式（13桁の数値丸め・指数表記を防止）
    sheet.getRange(target, map.id).setNumberFormat('@');
    sheet.getRange(target, 1, 1, width).setValues([row]);

    const opLabel = { inserted: '新規保存', updated: '上書き保存', forked: '新規保存（他担当者データから分岐）' }[action]
      + (data.operation ? '（' + data.operation + '）' : '');
    const logged = _appendLog(who, opLabel, data, target);
    return _json({ ok: true, status: 'success', action: action, id: String(data.id), row: target, user: who.user, logged: logged });
  } catch (err) {
    return _json({ ok: false, status: 'error', error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 全行を JSON で返す（他端末からの一覧読込用）
// ?action=whoami のときは現在の使用者だけを返す（画面ヘッダー表示用）
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (!_tokenOk(p.token)) {
      return _json({ ok: false, status: 'error', error: 'unauthorized' });
    }
    if (p.action === 'ping') {
      return _json({ ok: true, status: 'success', version: VERSION, sheet: _sheet().getName() });
    }
    if (p.action === 'whoami') {
      const who = _resolveUser({ author: p.author });
      return _json({ ok: true, status: 'success', user: who.user, source: who.source });
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
