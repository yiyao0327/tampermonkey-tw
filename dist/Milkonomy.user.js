// ==UserScript==
// @name         利潤網助手 (Milkonomy Assistant)
// @namespace    https://polokikiki.github.io/Milkonomy
// @version      3.1.3
// @description  MWI -> 利潤網：資料一鍵匯出 + 市場即時價格眾包上報 + 採購成本臺賬（含強化等級）
// @author       Milkonomy
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://milkywayidlecn.com/*
// @match        https://www.milkonomy.top/*
// @match        https://milkonomy.top/*
// @match        https://polokikiki.github.io/Milkonomy/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/Milkonomy.user.js
// @updateURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/Milkonomy.user.js
// ==/UserScript==

(function() {
  'use strict';
  var W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  var DOMAIN = location.hostname.replace(/^www\./, '').replace(/\./g, '_');
  var CHAR_KEY = 'mkex_char_' + DOMAIN;
  var lastJson = null;

  // ============================================================
  // 模組一：即時價格上報（眾包）——逛市場即自動貢獻訂單簿最新價
  // ============================================================
  var RT_CFG_KEY = 'mk_rt_cfg';
  var RT_DEFAULTS = { on: true, url: 'https://rt.milkonomy.top', token: 'mk2026rt' };
  // TODO 域名生效後把 url 換成 https://rt.milkonomy.top
  var rtCfg = RT_DEFAULTS;
  try {
    var _saved = JSON.parse(localStorage.getItem(RT_CFG_KEY) || 'null');
    if (_saved && typeof _saved === 'object') rtCfg = Object.assign({}, RT_DEFAULTS, _saved);
  } catch(e) {}
  function rtSave() { try { localStorage.setItem(RT_CFG_KEY, JSON.stringify(rtCfg)); } catch(e) {} }

  var RT_BATCH_MS = 30 * 1000;
  var RT_MAX_KEYS = 200;
  var rtPending = {};   // k -> {k,a,b}，同 key 只留最新
  var rtSentCount = 0;

  // 直接解析 WS 訊息裡的訂單簿 JSON（mooket 同款方式，比掃 DOM 快且準）
  function rtHandleOrderBooks(obj) {
    try {
      var mio = obj.marketItemOrderBooks || obj.marketOrderBook;
      if (!mio || !mio.itemHrid) return;
      var hrid = mio.itemHrid;
      var obs = mio.orderBooks || mio.orderBook;
      if (!obs) return;
      var list = Array.isArray(obs) ? obs : Object.keys(obs).sort(function(a,b){return a-b;}).map(function(k){return obs[k];});
      var caught = 0;
      for (var lv = 0; lv < list.length; lv++) {
        var bk = list[lv];
        if (!bk) continue;
        var asks = bk.asks || bk.sellOrders || [];
        var bids = bk.bids || bk.buyOrders || [];
        var askArr = Array.isArray(asks) ? asks : Object.values(asks);
        var bidArr = Array.isArray(bids) ? bids : Object.values(bids);
        ledgerCaptureBook(hrid, lv, askArr);
        var ask = -1, bid = -1;
        for (var i = 0; i < askArr.length; i++) { var p = askArr[i] && askArr[i].price; if (typeof p === 'number' && (ask === -1 || p < ask)) ask = p; }
        for (var j = 0; j < bidArr.length; j++) { var q = bidArr[j] && bidArr[j].price; if (typeof q === 'number' && q > bid) bid = q; }
        if (ask > 0 || bid > 0) {
          rtPending[hrid + '@' + lv] = { k: hrid + '@' + lv, a: ask, b: bid };
          caught++;
        }
      }
      if (caught > 0) console.log('[MK助手·即時] 抓到訂單簿:', hrid, caught + ' 個等級');
    } catch(e) { console.warn('[MK助手·即時] 訂單簿解析異常', e); }
  }
  var rtBuffNext = null;   // 社群Buff待上報（全服共享，搭訂單簿上報順風車，每次進遊戲報一次）
  function rtFlush() {
    if (!rtCfg.on) return;
    var keys = Object.keys(rtPending);
    if (keys.length === 0 && !rtBuffNext) return;
    var items = keys.slice(0, RT_MAX_KEYS).map(function(k) { return rtPending[k]; });
    var payload = { items: items };
    if (rtBuffNext) payload.buffs = rtBuffNext;
    fetch(rtCfg.url + '/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-token': rtCfg.token },
      body: JSON.stringify(payload)
    }).then(function(r) { return r.json(); }).then(function(j) {
      if (j && j.ok) {
        items.forEach(function(it) { delete rtPending[it.k]; });
        if (payload.buffs) rtBuffNext = null;
        rtSentCount += items.length;
        console.log('[MK助手·即時] 批次 ' + items.length + ' 條成功，累計 ' + rtSentCount + '，服務端總量 ' + (j.total || '?'));
      } else {
        console.warn('[MK助手·即時] 上報被拒', j);
      }
    }).catch(function(e) {
      console.warn('[MK助手·即時] 網路錯誤（重試中）', e && e.message);
    });
  }
  setInterval(rtFlush, RT_BATCH_MS);

  // ============================================================
  // 模組二：WebSocket 訊息攔截（匯出 + 即時上報共用一套 hook）
  // ============================================================
  var _lastRaw = null;
  var _lastProfileRaw = null;   // 他人主頁資料，僅供主頁內「MK:複製」按鈕使用
  function _handleMsg(event) {
    try {
      var obj = JSON.parse(event.data);
      // 即時上報：訂單簿更新 → 直接解析訊息 JSON
      if (obj.type === 'market_item_order_books_updated' || obj.type === 'market_order_book_updated') {
        rtHandleOrderBooks(obj);
      }
      // 採購臺賬：自己的掛單狀態更新（收單=買入掛單 filledQuantity 增加）
      if (obj.type === 'market_listings_updated') {
        ledgerOnListings(obj.endMarketListings);
      } else if (obj.type === 'init_character_data') {
        ledgerOnListings(obj.myMarketListings);
      }
      var data = null;
      if (obj.type === 'init_character_data') {
        GM_setValue(CHAR_KEY, event.data);
        _lastRaw = obj;
        data = buildExport(obj);
        // 社群Buff（全服共享）→ 待上報，搭下次即時批次順風車
        try {
          var cbSrc = obj.communityBuffs || (obj.character && obj.character.communityBuffs);
          var cbOut = {};
          if (Array.isArray(cbSrc)) {
            cbSrc.forEach(function(b) { if (b && b.hrid) cbOut[b.hrid] = (typeof b.level === 'number' ? b.level : 0); });
          } else if (cbSrc && typeof cbSrc === 'object') {
            Object.keys(cbSrc).forEach(function(k) {
              var v = cbSrc[k];
              cbOut[k] = typeof v === 'number' ? v : (v && typeof v.level === 'number' ? v.level : 0);
            });
          }
          if (Object.keys(cbOut).length) rtBuffNext = cbOut;
        } catch(e2) {}
      } else if (obj.type === 'profile_shared' && obj.profile) {
        // 3.2.2 修復: 僅瀏覽他人主頁不寫入匯出快取，否則一鍵匯入會進他人資料；
        // 資料只暫存給主頁內「MK:複製」按鈕，點了按鈕才匯出
        _lastProfileRaw = obj.profile;
      }
      if (data) {
        var json = JSON.stringify(data);
        try { localStorage.setItem('milkonomy_last_export', json); } catch(e) {}
        try { GM_setValue('milkonomy_last_export', json); } catch(e) {}
        lastJson = json;
        scheduleShrinePatch();
      }
    } catch(e) { console.error('[MK助手] WS錯誤:', e); }
  }
  var _origAE = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function(type, listener, options) {
    if (type === 'message') {
      var self = this;
      return _origAE.call(this, type, function(event) {
        try { _handleMsg(event); } catch(e) {}
        return listener.apply(self, arguments);
      }, options);
    }
    return _origAE.call(this, type, listener, options);
  };

  // 同時攔截 onmessage 屬性賦值（每個 socket 只掛一次 wrapper，重複賦值不再累積監聽）
  var _msgHandlerMap = new WeakMap();
  var _msgWrapperMap = new WeakMap();
  var _origDesc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  if (_origDesc && _origDesc.configurable) {
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      get: function() { return _msgHandlerMap.get(this) || null; },
      set: function(fn) {
        _msgHandlerMap.set(this, fn);
        var self = this;
        if (!_msgWrapperMap.has(this)) {
          var wrapper = function(event) {
            try { _handleMsg(event); } catch(e) {}
            var h = _msgHandlerMap.get(self);
            if (h) h.call(self, event);
          };
          _msgWrapperMap.set(this, wrapper);
          _origAE.call(self, 'message', wrapper);
        }
      },
      configurable: true
    });
  }

  // 攔截 WS 傳送（採購臺賬：直接購買請求 → 按訂單簿階梯算實付價）
  var _origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function(data) {
    try { ledgerOnSend(data); } catch(e) {}
    return _origSend.apply(this, arguments);
  };

  // ============================================================
  // 模組二B：採購臺賬——自動記錄每一筆實際買入（掛單成交=精確，直接購買=按盤口階梯近似）
  // ============================================================
  var LEDGER_KEY = 'mk_purchase_ledger';
  var LSTATE_KEY = 'mk_listing_state';
  var DBG_KEY = 'mk_ws_send_log';
  var LEDGER_MAX = 5000;
  var _ledgerCache = null;   // {entries:[{ts,itemHrid,qty,price,src,lid}]}
  var _lstateCache = null;   // {listingId: lastFilled}

  function ledgerLoad() {
    if (_ledgerCache) return _ledgerCache;
    try {
      var v = GM_getValue(LEDGER_KEY, null);
      var o = v ? JSON.parse(v) : null;
      if (o && Array.isArray(o.entries)) { _ledgerCache = o; return o; }
    } catch(e) {}
    _ledgerCache = { entries: [] };
    return _ledgerCache;
  }
  function ledgerState() {
    if (_lstateCache) return _lstateCache;
    try {
      var v = GM_getValue(LSTATE_KEY, null);
      var o = v ? JSON.parse(v) : null;
      if (o && typeof o === 'object') { _lstateCache = o; return o; }
    } catch(e) {}
    _lstateCache = {};
    return _lstateCache;
  }
  function ledgerAdd(e) {
    var led = ledgerLoad();
    led.entries.push(e);
    if (led.entries.length > LEDGER_MAX) led.entries.splice(0, led.entries.length - LEDGER_MAX);
    try { GM_setValue(LEDGER_KEY, JSON.stringify(led)); } catch(err) {}
    console.log('[MK助手·臺賬] +' + e.qty + ' × ' + e.itemHrid + ' @' + e.price + ' (' + e.src + ')');
  }
  function ledgerSlice(n) {
    var es = ledgerLoad().entries;
    n = n || 2000;
    return es.length <= n ? es.slice() : es.slice(es.length - n);
  }

  // 路徑A（精確）：買入掛單的 filledQuantity 增量 = 實收數量 × 我掛的價
  function ledgerOnListings(listings) {
    if (!Array.isArray(listings)) return;
    var st = ledgerState();
    var changed = false;
    for (var i = 0; i < listings.length; i++) {
      var L = listings[i];
      if (!L || typeof L.id === 'undefined') continue;
      var status = L.status || '';
      if (L.isSell || status.indexOf('cancelled') >= 0) {
        if (st[L.id] !== undefined) { delete st[L.id]; changed = true; }
        continue;
      }
      var filled = L.filledQuantity || 0;
      var prev = st[L.id];
      if (prev === undefined) { st[L.id] = filled; changed = true; continue; } // 首見：只建基線不記賬
      if (filled > prev) {
        var qty = filled - prev;
        if (qty > 0 && L.price > 0 && L.itemHrid) {
          ledgerAdd({ ts: Date.now(), itemHrid: L.itemHrid, qty: qty, price: L.price, src: 'order', lid: L.id, lv: L.enhanceLevel || 0 });
        }
        st[L.id] = filled; changed = true;
      } else if (filled < prev) {
        st[L.id] = filled; changed = true; // 理論不發生，防禦性對齊
      }
    }
    if (changed) { try { GM_setValue(LSTATE_KEY, JSON.stringify(st)); } catch(err) {} }
  }

  // 訂單簿階梯快照（hrid@lv -> 賣單 [{p,c,id}] 按價格升序），直接購買算賬用
  var bookSnap = {};
  function ledgerCaptureBook(hrid, lv, askArr) {
    try {
      var tiers = [];
      for (var i = 0; i < askArr.length; i++) {
        var a = askArr[i];
        if (a && typeof a.price === 'number' && a.price > 0) {
          tiers.push({ p: a.price, c: (typeof a.count === 'number' && a.count > 0) ? a.count : 1, id: a.id, h: hrid, lv: lv });
        }
      }
      tiers.sort(function(x, y) { return x.p - y.p; });
      bookSnap[hrid + '@' + lv] = tiers;
    } catch(e) {}
  }

  // 除錯：所有 market_* 出站訊息留痕（未知訊息型別時用來看真實格式）
  function ledgerDebugLog(obj) {
    try {
      var raw = JSON.stringify(obj);
      if (raw.length > 800) raw = raw.slice(0, 800);
      var arr;
      try { arr = JSON.parse(GM_getValue(DBG_KEY, '[]')) || []; } catch(e2) { arr = []; }
      arr.push({ ts: Date.now(), t: obj.type, raw: raw });
      if (arr.length > 120) arr.splice(0, arr.length - 120);
      GM_setValue(DBG_KEY, JSON.stringify(arr));
    } catch(e) {}
  }

  // 路徑B（近似）：直接購買 = 出站請求 + 當時盤口階梯，從最低賣單價往上吃
  function ledgerOnSend(data) {
    if (typeof data !== 'string' || data.charAt(0) !== '{') return;
    var obj;
    try { obj = JSON.parse(data); } catch(e) { return; }
    var t = obj.type || '';
    if (t.indexOf('market') !== 0) return;
    ledgerDebugLog(obj);
    if (t === 'market_buy_item_from_listing' || (t.indexOf('buy') >= 0 && t.indexOf('sell') < 0)) {
      ledgerHandleBuy(obj);
    }
  }
  function ledgerHandleBuy(obj) {
    try {
      // 形態A：聚合購買 {itemHrid, count, enhanceLevel?}
      if (obj.itemHrid && typeof obj.count === 'number' && obj.count > 0) {
        ledgerSweep(obj.itemHrid, obj.enhanceLevel || 0, obj.count);
        return;
      }
      // 形態B：按單購買 {buyListings:[{id,count}]}——快照條目帶 id 時精確匹配
      if (Array.isArray(obj.buyListings) && obj.buyListings.length) {
        var byId = {};
        Object.keys(bookSnap).forEach(function(k) {
          (bookSnap[k] || []).forEach(function(tier) { if (tier.id !== undefined) byId[tier.id] = tier; });
        });
        for (var i = 0; i < obj.buyListings.length; i++) {
          var bl = obj.buyListings[i];
          var tier = bl && byId[bl.id !== undefined ? bl.id : bl.listingId];
          if (tier && bl.count > 0) {
            ledgerAdd({ ts: Date.now(), itemHrid: tier.h, qty: bl.count, price: tier.p, src: 'direct', lid: tier.id, lv: tier.lv || 0 });
          }
        }
      }
    } catch(e) { console.warn('[MK助手·臺賬] 直購解析異常', e); }
  }
  function ledgerSweep(hrid, lv, count) {
    var tiers = bookSnap[hrid + '@' + lv];
    if (!tiers || !tiers.length) {
      // 沒有盤口快照：數量照記、價格記0（站點側按"未知價"處理，回退市場價）
      ledgerAdd({ ts: Date.now(), itemHrid: hrid, qty: count, price: 0, src: 'direct-noBook' });
      return;
    }
    var remain = count;
    for (var i = 0; i < tiers.length && remain > 0; i++) {
      var take = Math.min(remain, tiers[i].c);
      ledgerAdd({ ts: Date.now(), itemHrid: hrid, qty: take, price: tiers[i].p, src: 'direct', lid: tiers[i].id });
      remain -= take;
    }
    if (remain > 0) {
      ledgerAdd({ ts: Date.now(), itemHrid: hrid, qty: remain, price: tiers[0].p, src: 'direct-noLiquidity' });
    }
  }

  // ============================================================
  // 模組三：DOM 補丁：神龕（WS 欄位不穩定，從公會面板 HTML 抓，中英文介面都支援）
  // ============================================================
  function shrineKeyFromName(name) {
    if (/力量|power|force/i.test(name)) return 'power';
    if (/節奏|tempo|rhythm/i.test(name)) return 'rhythm';
    if (/精神|spirit/i.test(name)) return 'spirit';
    if (/稀有|rare/i.test(name)) return 'rare';
    if (/學者|scholar/i.test(name)) return 'scholar';
    return null;
  }

  function scrapeShrineFromDOM() {
    var result = {};
    try {
      var tiles = document.querySelectorAll('[class*="GuildPanel_guildTile"]');
      for (var ti = 0; ti < tiles.length; ti++) {
        var nameEl = tiles[ti].querySelector('[class*="GuildPanel_tileName"]');
        var bottomEl = tiles[ti].querySelector('[class*="GuildPanel_tileBottom"]');
        if (!nameEl || !bottomEl) continue;
        var rawBottom = (bottomEl.textContent || '').trim();
        // 只取"生活/Skilling"域（神龕增益面板），排除"戰鬥"域和"等級 X/20"（建築面板）
        if (rawBottom.indexOf('生活') === -1 && !/skilling/i.test(rawBottom)) continue;
        var eng = shrineKeyFromName((nameEl.textContent || '').trim());
        if (!eng) continue;
        var m = rawBottom.match(/(?:等級|level)\s*(\d+)/i);
        result[eng] = m ? parseInt(m[1], 10) : 0;
      }
    } catch(e) {}
    return result;
  }

  // 3.1.2 神龕等級持久記憶：WS 欄位不穩定 + 重連重建快照會把已抓到的等級沖掉，
  // 記住每座最近一次的等級，構建快照時只補缺失項（WS/DOM 現值永遠優先），杜絕"丟神龕"
  var SHRINE_MEM_KEY = 'mk_shrine_mem';
  function shrineMemRead() {
    try {
      var v = JSON.parse(GM_getValue(SHRINE_MEM_KEY, '{}') || '{}');
      return (v && typeof v === 'object') ? v : {};
    } catch(e) { return {}; }
  }
  function shrineMemUpdate(vals) {
    try {
      var mem = shrineMemRead();
      var changed = false;
      for (var k in vals) {
        if (Object.prototype.hasOwnProperty.call(vals, k) && typeof vals[k] === 'number' && vals[k] >= 0 && mem[k] !== vals[k]) {
          mem[k] = vals[k];
          changed = true;
        }
      }
      if (changed) GM_setValue(SHRINE_MEM_KEY, JSON.stringify(mem));
    } catch(e) {}
  }

  // 抓到幾座返回幾座（空物件=沒抓到）；抓到時與已有資料合併而不是整體覆蓋，避免部分渲染時丟資料
  function patchExportShrine() {
    if (!lastJson) return null;
    var shrineResult = null;
    try {
      var data = JSON.parse(lastJson);
      shrineResult = scrapeShrineFromDOM();
      if (Object.keys(shrineResult).length > 0) {
        data.shrines = data.shrines || {};
        for (var k in shrineResult) data.shrines[k] = shrineResult[k];
        shrineMemUpdate(shrineResult);
        var json = JSON.stringify(data);
        try { localStorage.setItem('milkonomy_last_export', json); } catch(e) {}
        try { GM_setValue('milkonomy_last_export', json); } catch(e) {}
        lastJson = json;
        console.log('[MK助手] 神龕 DOM補丁:', JSON.stringify(shrineResult));
      }
    } catch(e) {}
    return shrineResult;
  }

  // WS訊息後先快速重試3次；公會面板通常要等使用者點開，再低頻監視2分鐘，抓滿5座即停
  var _shrineWatcher = null;
  var _shrineIdle = null;
  function scheduleShrinePatch() {
    setTimeout(patchExportShrine, 1000);
    setTimeout(patchExportShrine, 3000);
    setTimeout(patchExportShrine, 5000);
    if (_shrineWatcher) return;
    var attempts = 0;
    _shrineWatcher = setInterval(function() {
      attempts++;
      var res = patchExportShrine() || {};
      if (Object.keys(res).length >= 5 || attempts >= 40) {
        clearInterval(_shrineWatcher);
        _shrineWatcher = null;
        startShrineIdleWatch();
      }
    }, 3000);
  }

  // 3.1.2: 高頻視窗結束後保留 30s 低頻長駐監聽——使用者晚於 2 分鐘才打開公會面板也能補上
  // （querySelectorAll 開銷可忽略；lastJson 為空時 patchExportShrine 直接返回）
  function startShrineIdleWatch() {
    if (_shrineIdle) return;
    _shrineIdle = setInterval(function() { patchExportShrine(); }, 30000);
  }

  // ============================================================
  // 模組四：資料構建 (統一格式, 缺的填0)
  // ============================================================
  function buildExport(cd) {
    var r = { version: 1, exportedAt: new Date().toISOString(), name: '' };
    // name
    if (cd.sharableCharacter && cd.sharableCharacter.name) r.name = cd.sharableCharacter.name;
    else if (cd.character && cd.character.name) r.name = cd.character.name;
    // skills
    r.skills = {};
    (cd.characterSkills||[]).forEach(function(s) { r.skills[s.skillHrid] = s.level; });
    // equipment — 匯出身上全部穿戴(生活裝備在通用槽位+主手工具), 只排除飾品和背包; 戰鬥裝備匯出後由利潤網自動過濾
    r.equipment = {};
    // 3.1.1 修復: 生活裝備就穿在 off_hand/head/body/hands/feet/legs/back/neck/ring/charm/pouch 這些通用槽位,
    // 之前把它們全當戰鬥位排除,導致身上實際穿戴(含強化等級)從不匯出、利潤網只能從背包自動挑低階貨
    // 3.2.2 修復: 生活工具(錘/剪/斧等)穿在 main_hand/two_hand, 之前被當戰鬥位排除,
    // 導致實際穿戴的工具(含強化等級)從不匯出、利潤網只能按背包最高強化等級挑工具
    var COMBAT_LOCS = ['/item_locations/trinket','/item_locations/inventory'];
    function isSkillLoc(loc) { for (var i=0;i<COMBAT_LOCS.length;i++) { if(loc===COMBAT_LOCS[i]) return false; } return true; }
    var wim = cd.wearableItemMap || cd.characterItems || {};
    if (Array.isArray(wim)) { wim.forEach(function(it) { if(it.itemLocationHrid && isSkillLoc(it.itemLocationHrid)) r.equipment[it.itemLocationHrid] = {hrid:it.itemHrid||'',enhanceLevel:it.enhancementLevel||0}; }); }
    else { Object.keys(wim).forEach(function(loc) { if(isSkillLoc(loc)) r.equipment[loc] = {hrid:wim[loc].itemHrid||'',enhanceLevel:wim[loc].enhancementLevel||0}; }); }
    // 以下欄位統一填預設值
    r.houses = {}; (Object.keys(cd.characterHouseRoomMap||{})).forEach(function(h) { r.houses[h] = cd.characterHouseRoomMap[h].level; });
    // Community buffs — 他人資料沒有則從自己快取取（社群buff全服共享）
    r.communityBuffs = {};
    var cb = cd.communityBuffs;
    if (!cb || (Array.isArray(cb) && !cb.length) || (typeof cb === 'object' && !Object.keys(cb).length)) {
      try {
        var selfStr = GM_getValue(CHAR_KEY, null);
        if (selfStr) { var selfData = JSON.parse(selfStr); cb = selfData.communityBuffs || (selfData.character && selfData.character.communityBuffs); }
      } catch(e) {}
    }
    if (cb) {
      if (Array.isArray(cb)) { cb.forEach(function(b) { r.communityBuffs[b.hrid] = b.level; }); }
      else if (typeof cb === 'object') { Object.keys(cb).forEach(function(k) { r.communityBuffs[k] = typeof cb[k]==='number' ? cb[k] : (cb[k]&&cb[k].level||0); }); }
    }
    // 哞卡 — mooPassBuffs 表示 Moo Pass 啟用中
    r.communityBuffs['/community_buff_types/moo_card'] = (cd.mooPassBuffs && cd.mooPassBuffs.length > 0) ? 1 : 0;
    r.achievements = [];
    if (cd.characterAchievements) { r.achievements = Array.isArray(cd.characterAchievements) ? cd.characterAchievements : Object.values(cd.characterAchievements); }
    r.achievementPoints = cd.characterAchievementPoints || 0;
    r.achievementTierMap = cd.characterAchievementTierMap || cd.characterAchievementTiers || {};
    // Shrines — 先從 characterGuildBuffMap 讀（相容 {level:N} 和純數字兩種形狀），DOM 抓到後由補丁合併覆蓋
    r.shrines = {};
    var cgb2 = cd.characterGuildBuffMap || {};
    var SM2 = {'/guild_buffs/force_skilling':'power','/guild_buffs/tempo_skilling':'rhythm','/guild_buffs/spirit_skilling':'spirit','/guild_buffs/rare_skilling':'rare','/guild_buffs/scholar_skilling':'scholar'};
    Object.keys(cgb2).forEach(function(k) {
      var m = SM2[k];
      if (!m) return;
      var v = cgb2[k];
      var lvl = (typeof v === 'number') ? v : (v && typeof v.level === 'number' ? v.level : undefined);
      if (typeof lvl === 'number') r.shrines[m] = lvl;
    });
    // 3.1.2: WS 有值=權威現值，寫入記憶；缺失項用記憶補上（只補缺，不覆蓋現值）
    if (Object.keys(r.shrines).length) shrineMemUpdate(r.shrines);
    var smem = shrineMemRead();
    for (var sk in smem) {
      if (Object.prototype.hasOwnProperty.call(smem, sk) && !(sk in r.shrines)) r.shrines[sk] = smem[sk];
    }
    r.actionTeas = {};
    var ATM={'/action_types/milking':'milking','/action_types/foraging':'foraging','/action_types/woodcutting':'woodcutting','/action_types/cheesesmithing':'cheesesmithing','/action_types/crafting':'crafting','/action_types/tailoring':'tailoring','/action_types/cooking':'cooking','/action_types/brewing':'brewing','/action_types/alchemy':'alchemy','/action_types/enhancing':'enhancing'};
    var dm=cd.actionTypeDrinkSlotsMap||cd.consumableActionTypeSlotsMap||{}; Object.keys(dm).forEach(function(a){var act=ATM[a];if(!act)return;var ts=[];(dm[a]||[]).forEach(function(sl){if(sl&&sl.itemHrid)ts.push(sl.itemHrid);});if(ts.length)r.actionTeas[act]=ts;});
    // 掃描倉庫 + 穿戴中的全部裝備，取最高強化等級
    var inventoryEnhanceMap = {};
    function scanItems(src) {
      if (!src) return;
      var arr = Array.isArray(src) ? src : Object.values(src);
      for (var ii = 0; ii < arr.length; ii++) {
        var item = arr[ii];
        if (item.itemHrid && typeof item.enhancementLevel === 'number') {
          var cur = inventoryEnhanceMap[item.itemHrid] || -1;
          if (item.enhancementLevel > cur) inventoryEnhanceMap[item.itemHrid] = item.enhancementLevel;
        }
      }
    }
    scanItems(cd.characterItems);
    scanItems(cd.wearableItemMap);
    r.inventoryMap = inventoryEnhanceMap;
    // 倉庫數量（堆疊資源帶 count，含背包/倉庫/穿戴中的物品，同物品多格自動累加）
    var warehouseMap = {};
    var ciArr = Array.isArray(cd.characterItems) ? cd.characterItems : Object.values(cd.characterItems || {});
    for (var ci = 0; ci < ciArr.length; ci++) {
      var whIt = ciArr[ci];
      if (whIt && whIt.itemHrid && typeof whIt.count === 'number' && whIt.count > 0) {
        warehouseMap[whIt.itemHrid] = (warehouseMap[whIt.itemHrid] || 0) + whIt.count;
      }
    }
    r.warehouseMap = warehouseMap;
    // 倉庫分級明細（裝備類按強化等級拆分）：hrid -> {等級: 數量}，有該表的物品站點按等級分別估值
    var warehouseDetailMap = {};
    for (var wd = 0; wd < ciArr.length; wd++) {
      var wdIt = ciArr[wd];
      if (wdIt && wdIt.itemHrid && typeof wdIt.enhancementLevel === 'number' && wdIt.count > 0) {
        if (!warehouseDetailMap[wdIt.itemHrid]) warehouseDetailMap[wdIt.itemHrid] = {};
        var lvKey = String(wdIt.enhancementLevel);
        warehouseDetailMap[wdIt.itemHrid][lvKey] = (warehouseDetailMap[wdIt.itemHrid][lvKey] || 0) + wdIt.count;
      }
    }
    r.warehouseDetailMap = warehouseDetailMap;
    // 採購臺賬（3.2+）：隨匯出一起帶給利潤網
    r.purchaseLedger = ledgerSlice(2000);

    // 配裝匯出
    var rawLoadouts = cd.characterLoadoutMap;
    if (rawLoadouts && typeof rawLoadouts === 'object' && !Array.isArray(rawLoadouts)) {
      rawLoadouts = Object.values(rawLoadouts);
    }
    r.loadouts = [];
    if (rawLoadouts && Array.isArray(rawLoadouts)) {
      for (let li = 0; li < rawLoadouts.length; li++) {
        const ld = rawLoadouts[li];
        const eq = {};
        const items = ld.wearableMap || {};
        Object.keys(items).forEach(function(loc) {
          if (isSkillLoc(loc) && items[loc] && items[loc].itemHrid) {
            const hrid = items[loc].itemHrid;
            const realLevel = inventoryEnhanceMap[hrid];
            const finalLevel = realLevel !== undefined && realLevel > (items[loc].enhancementLevel || 0)
              ? realLevel : (items[loc].enhancementLevel || 0);
            eq[loc] = { hrid: hrid, enhanceLevel: finalLevel };
          }
        });
        if (Object.keys(eq).length > 1) {
          r.loadouts.push({ name: ld.name || ('Loadout ' + (li + 1)), equipment: eq });
        }
      }
    }
    return r;
  }

  // ============================================================
  // 模組五：Milkonomy bridge（利潤網頁面自動接收）
  // ============================================================
  if (location.hostname.indexOf('github.io')>=0||location.hostname.indexOf('localhost')>=0||location.hostname.indexOf('127.0.0.1')>=0||location.hostname.indexOf('milkonomy.top')>=0) {
    console.log('[MK助手] 橋接已啟動, hostname:', location.hostname);
    setInterval(function() {
      var d = GM_getValue('milkonomy_last_export', null);
      localStorage.setItem('milkonomy_bridge_alive', Date.now().toString());
      if (d) { localStorage.setItem('milkonomy_last_export', d); W.__milkonomy_data__ = d; }
    }, 1000);
  }

  // ============================================================
  // 選單
  // ============================================================
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand((rtCfg.on ? '即時上報：已開啟（點選關閉）' : '即時上報：已關閉（點選開啟）'), function() {
      rtCfg.on = !rtCfg.on;
      rtSave();
      alert('即時上報已' + (rtCfg.on ? '開啟' : '關閉') + '。');
      location.reload();
    });
    GM_registerMenuCommand('複製採購臺賬JSON', function() {
      var es = ledgerSlice(5000);
      navigator.clipboard.writeText(JSON.stringify({ entries: es }, null, 2)).then(function() {
        alert('已複製 ' + es.length + ' 條採購記錄。');
      }, function() { alert('複製失敗，請在遊戲頁操作。'); });
    });
    GM_registerMenuCommand('清空採購臺賬', function() {
      if (confirm('確定清空全部採購記錄和掛單跟蹤狀態？此操作不可恢復。')) {
        try { GM_deleteValue(LEDGER_KEY); GM_deleteValue(LSTATE_KEY); } catch(e) {}
        _ledgerCache = null; _lstateCache = null;
        alert('已清空採購臺賬。');
      }
    });
    GM_registerMenuCommand('清除匯出快取', function() {
      try {
        var keys = GM_listValues();
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].indexOf('mkex_') === 0 || keys[i] === 'milkonomy_last_export') GM_deleteValue(keys[i]);
        }
      } catch(e) {}
      try { localStorage.removeItem('milkonomy_last_export'); } catch(e) {}
      try { localStorage.removeItem('milkonomy_bridge_alive'); } catch(e) {}
      lastJson = null;
      _lastRaw = null;
      _lastProfileRaw = null;
      alert('已清除匯出快取。\n重新開啟遊戲頁面後會生成新資料。');
    });
  }

  // ============================================================
  // 遊戲頁：只看別人主頁內嵌按鈕
  // ============================================================
  setInterval(function() {
    var c = document.querySelector('div[class*="SharableProfile_overviewTab"]');
    if (!c || document.getElementById('mkex-prof')) return;
    var b = document.createElement('button'); b.id = 'mkex-prof';
    b.textContent = 'MK:複製'; b.style.cssText = 'border-radius:5px;height:30px;background:#16ab1b;color:#fff;border:0;cursor:pointer;margin-left:8px;font-size:13px;font-weight:bold;';
    b.onclick = function(e) {
      e.stopPropagation();
      if (!_lastProfileRaw) { alert('暫無資料，請重新開啟該玩家主頁'); return; }
      var data = buildExport(_lastProfileRaw);
      var json = JSON.stringify(data);
      try { localStorage.setItem('milkonomy_last_export', json); } catch(e) {}
      try { GM_setValue('milkonomy_last_export', json); } catch(e) {}
      navigator.clipboard.writeText(json).then(function(){b.textContent='MK:OK';setTimeout(function(){b.textContent='MK:複製';},1500);});
    };
    c.appendChild(b);
  }, 1000);

  console.log('[MK助手] v3.1.2 已載入 | 匯出:開 | 即時上報:' + (rtCfg.on ? '開' : '關') + ' -> ' + rtCfg.url + ' | 採購臺賬:開 | 社群Buff上報:開 | 神龕記憶:開');

})();
