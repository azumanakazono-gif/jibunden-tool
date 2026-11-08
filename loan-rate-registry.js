/* Shared loan rate master. No credentials or edits are stored in the browser.
 * A GAS deployment with action=loanRates and action=saveLoanRate must be deployed.
 */
(function () {
  'use strict';
  var ENDPOINT = window.JIBUNDEN_LOAN_RATE_GAS_URL || '';
  var PRODUCTS = {
    orico_reform: 'オリコ｜Webリフォームローン',
    jaccs_fixed: 'ジャックス｜固定金利',
    jaccs_variable: 'ジャックス｜変動金利'
  };
  var records = {};
  var loaded = false;
  var loadError = '';
  var bindings = [];
  function key(product, month) { return product + ':' + month; }
  function currentMonth() {
    var p = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit'}).formatToParts(new Date());
    return p.find(function (x) {return x.type === 'year';}).value + '-' +
      p.find(function (x) {return x.type === 'month';}).value;
  }
  function get(product, month, fallback, defaultSource) {
    var found = records[key(product, month)];
    if (found && Number.isFinite(Number(found.rate))) {
      return {rate: Number(found.rate), source: found.source, shared: true, updatedAt: found.updatedAt};
    }
    if (Number.isFinite(Number(fallback)) && fallback !== undefined && fallback !== null) {
      return {rate: Number(fallback), source: defaultSource || '添付の金利資料', shared: false};
    }
    return null;
  }
  function showButtons() {
    bindings.forEach(function (binding) {
      var selected = document.getElementById(binding.selector);
      var button = document.getElementById(binding.buttonId);
      var help = document.getElementById(binding.helpId);
      if (!selected || !button || !help) return;
      var item = selected.value;
      button.hidden = !PRODUCTS[item];
      help.textContent = loadError ? '共有DB未接続：' + loadError :
        (!loaded ? '共有金利マスタを読込中' : '共有金利マスタに接続済み');
    });
  }
  function refresh() {
    showButtons();
    bindings.forEach(function (b) { if (typeof b.recalculate === 'function') b.recalculate(); });
  }
  function load() {
    if (!ENDPOINT) {
      loadError = '金利管理APIの接続先が未設定です';
      loaded = false;
      showButtons();
      return Promise.resolve(false);
    }
    return fetch(ENDPOINT + '?action=loanRates', {method:'GET', redirect:'follow', cache:'no-store'})
      .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
      .then(function (data) {
        if (!data || data.ok !== true || !Array.isArray(data.rates)) throw new Error('GASの金利マスタAPIが未公開です');
        var next = {};
        data.rates.forEach(function (row) {
          if (PRODUCTS[row.product] && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month) &&
              Number(row.rate) > 0 && Number(row.rate) <= 30) {
            next[key(row.product, row.month)] = row;
          }
        });
        records = next;
        loaded = true;
        loadError = '';
        refresh();
        return true;
      })
      .catch(function (err) {
        loadError = String(err && err.message || err);
        loaded = false;
        refresh();
        return false;
      });
  }
  function modal(product, recalculate) {
    if (!PRODUCTS[product]) return;
    var existing = document.getElementById('loan-rate-registry-dialog');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'loan-rate-registry-dialog';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '金利マスタへ登録');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:14px;';
    var panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;color:#1f2937;border-radius:12px;padding:20px;max-width:440px;width:100%;box-sizing:border-box;max-height:90vh;overflow:auto;font-family:inherit;';
    panel.innerHTML = '<h3 style="margin:0 0 8px;font-size:18px;">共有ローン金利を登録・更新</h3>' +
      '<p data-field="product" style="font-size:13px;margin:0 0 10px;"></p>' +
      '<p style="font-size:12px;color:#6b7280;">確認済みの金融会社資料に基づいて入力してください。保存後は他の担当者の試算にも反映されます。</p>' +
      '<label style="display:block;margin-top:10px;">適用年月（日本時間）<input data-field="month" type="month" required style="display:block;width:100%;padding:8px;box-sizing:border-box;"></label>' +
      '<label style="display:block;margin-top:10px;">実質年率（%）<input data-field="rate" type="number" min="0.01" max="30" step="0.01" required style="display:block;width:100%;padding:8px;box-sizing:border-box;"></label>' +
      '<label style="display:block;margin-top:10px;">出典（通知書・資料名など）<input data-field="source" type="text" maxlength="200" required style="display:block;width:100%;padding:8px;box-sizing:border-box;"></label>' +
      '<label style="display:block;margin-top:10px;">登録者名（変更履歴用）<input data-field="author" type="text" maxlength="80" required style="display:block;width:100%;padding:8px;box-sizing:border-box;"></label>' +
      '<label style="display:block;margin-top:10px;">管理者用登録キー<input data-field="key" type="password" autocomplete="off" required style="display:block;width:100%;padding:8px;box-sizing:border-box;"></label>' +
      '<p style="font-size:11px;color:#6b7280;">キーは管理者から個別に受け取ってください。ブラウザには保存しません。</p>' +
      '<p data-field="message" role="status" aria-live="polite" style="font-size:12px;color:#9a3412;min-height:20px;"></p>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;"><button type="button" data-field="close" style="padding:9px 12px;">キャンセル</button><button type="button" data-field="save" style="padding:9px 14px;background:#2D6A4F;color:#fff;border:none;border-radius:6px;">共有DBへ保存</button></div>';
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    var q = function (name) {return panel.querySelector('[data-field="' + name + '"]');};
    var saved = get(product, currentMonth());
    q('product').textContent = PRODUCTS[product];
    q('month').value = currentMonth();
    if (saved) { q('rate').value = saved.rate; q('source').value = saved.source || ''; }
    q('close').addEventListener('click', function () {overlay.remove();});
    q('month').addEventListener('change', function () {
      var found = get(product, q('month').value);
      q('rate').value = found ? found.rate : '';
      q('source').value = found ? (found.source || '') : '';
    });
    q('save').addEventListener('click', function () {
      var month = q('month').value, rate = Number(q('rate').value);
      var src = q('source').value.trim(), author = q('author').value.trim();
      var adminKey = q('key').value;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !(rate > 0 && rate <= 30) ||
          !src || !author || !adminKey) {
        q('message').textContent = '適用年月・金利・出典・登録者名・登録キーを確認してください。';
        return;
      }
      if (!ENDPOINT) {
        q('message').textContent = '金利管理APIの接続先が未設定です。管理者に連絡してください。';
        return;
      }
      if (!loaded) {
        q('message').textContent = '共有DBに接続できません。GASの更新とデプロイを確認してください。';
        return;
      }
      q('save').disabled = true;
      q('message').textContent = '保存を確認中…';
      // 管理キーは送信時のみ使用し、localStorage等には保存しない。
      var payload = {action:'saveLoanRate', product:product, month:month,
        rate:rate, source:src, author:author, editorKey:adminKey};
      fetch(ENDPOINT, {method:'POST', redirect:'follow',
        headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload)})
        .then(function (response) {if (!response.ok) throw new Error('HTTP ' + response.status); return response.json();})
        .then(function (data) {
          if (!data || data.ok !== true) throw new Error((data && data.error) || '登録が拒否されました');
          // GASから再読込できた場合にのみ画面へ適用
          q('key').value = '';
          return load().then(function (success) {
            if (!success) throw new Error('保存しましたが共有DBの再読込に失敗しました。画面を再読込してください。');
            overlay.remove();
            if (typeof recalculate === 'function') recalculate();
          });
        })
        .catch(function (err) {q('message').textContent = '登録できませんでした：' + (err.message || err);})
        .finally(function () {q('save').disabled = false; q('key').value = '';});
    });
    q('month').focus();
  }
  function attach(opts) {
    var select = document.getElementById(opts.selector);
    var status = document.getElementById(opts.status);
    if (!select || !status) return;
    var button = document.createElement('button');
    var help = document.createElement('div');
    var id = opts.selector.replace(/[^a-z0-9-]/gi, '-');
    button.id = id + '-registry-open';
    help.id = id + '-registry-help';
    button.type = 'button';
    button.textContent = '金利を登録・更新';
    button.style.cssText = 'margin:7px 0 3px;padding:6px 11px;border:1px solid #2D6A4F;border-radius:6px;background:#fff;color:#2D6A4F;font-weight:700;font-size:12px;cursor:pointer;';
    help.style.cssText = 'font-size:10px;color:#6b7280;line-height:1.5;';
    status.insertAdjacentElement('afterend', help);
    help.insertAdjacentElement('beforebegin', button);
    button.addEventListener('click', function () { modal(select.value, opts.recalculate); });
    // Keep the registration control in sync when the user changes lender after initial load.
    select.addEventListener('change', showButtons);
    bindings.push({selector:opts.selector, status:opts.status, buttonId:button.id,
      helpId:help.id, recalculate:opts.recalculate});
    showButtons();
  }
  window.LoanRateRegistry = {attach:attach, get:get, load:load, currentMonth:currentMonth};
})();
