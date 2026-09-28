// ==UserScript==
// @name         MWI Combat Simulator 主站一鍵匯入
// @name:zh      MWI Combat Simulator 主站一鍵匯入
// @name:zh-CN   MWI Combat Simulator 主站一鍵匯入
// @namespace    https://azhu949.github.io/MWICombatSimulator
// @version      0.1.49
// @license      ISC
// @description  Import the current Milky Way Idle character or cached team into the combat simulator, enhancement simulator, or skilling planner.
// @description:zh      將 Milky Way Idle 主站當前角色或快取隊伍匯入戰鬥模擬器、強化模擬器或生活技能規劃器。
// @description:zh-CN   將 Milky Way Idle 主站當前角色或快取隊伍匯入戰鬥模擬器、強化模擬器或生活技能規劃器。
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://milkywayidlecn.com/*
// @match        https://azhu949.github.io/MWICombatSimulator/*
// @match        https://mwi-combatsi-mulator.pages.dev/*
// @match        http://localhost:5173/*
// @match        http://127.0.0.1:5173/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @run-at       document-start
// @downloadURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/MWI Combat Simulator.user.js
// @updateURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/MWI Combat Simulator.user.js
// ==/UserScript==

(function () {
  'use strict';

  const REQUEST_KEY = 'mwi.tm.import.request.v1';
  const RESPONSE_KEY = 'mwi.tm.import.response.v1';
  const APP_BRIDGE_CHANNEL = 'mwi-tm-bridge';
  const BUTTON_ID = 'mwi-tm-import-button';
  const CONTROL_ID = 'mwi-tm-import-control';
  const STATUS_ID = 'mwi-tm-import-status';
  const TEAM_ROSTER_CACHE_KEY = 'mwi.tm.import.teamRosterCache.v1';
  const PROFILE_CACHE_KEY = 'mwi.tm.import.profileCache.v1';
  const DEBUG_STORAGE_KEY = 'mwi.tm.import.debug';
  const DEBUG_QUERY_PARAM = 'mwiImportDebug';
  const MAIN_SITE_SHORTCUT_ID = 'mwi-tm-main-site-simulator-link';
  const PROFILE_COPY_BUTTON_ID = 'mwi-tm-profile-copy-button';
  const SIMULATOR_GITHUB_PAGES_URL = 'https://azhu949.github.io/MWICombatSimulator/';
  const SIMULATOR_CLOUDFLARE_URL = 'https://mwi-combatsi-mulator.pages.dev/';
  const SIMULATOR_FALLBACK_URL = SIMULATOR_GITHUB_PAGES_URL;
  const SIMULATOR_MIRROR_MODAL_ID = 'mwi-tm-simulator-mirror-modal';
  const REQUEST_TIMEOUT_MS = 12000;
  const APP_IMPORT_TIMEOUT_MS = 8000;
  const STORAGE_POLL_INTERVAL_MS = 250;
  const TEAM_ROSTER_CACHE_BUCKET_LIMIT = 24;
  const RECENT_PARTY_MESSAGE_LIMIT = 20;
  // 合成行情（零操作兜底）：主站公開端點 game_data/marketplace.json 提供全物品
  // per-level 行情（{a: ask, b: bid}），MWITools 以相同週期（生產 6 小時）主動拉取。
  // 官方估算（WS market_item_values_updated 為全量快照，另有 localStorage 鍵主通道）
  // 只在主站側可得，模擬器頁自身無行情來源，
  // 因此用該端點合成中價估值作兜底，與官方估算合併透傳（真實值優先）。
  const SYNTHETIC_MARKET_REFRESH_MS = 6 * 60 * 60 * 1000;
  // 合成行情拉取超時（N5，2026-08-31）：無超時則掛起的 fetch 會永久佔住 inFlight
  // 守衛，使 N2 的「下次匯入請求退避重試」入口形同虛設。
  const SYNTHETIC_MARKET_FETCH_TIMEOUT_MS = 15000;
  // 官方估算的另一來源：主站自己把全量官方估算寫入 localStorage 鍵 "marketItemValues"
  //（MWITools 的 loadMarketItemValuesFromStorage 即讀此鍵，可能是 LZString 壓縮串）。
  // 該鍵由主站登入/連線時寫入，讀取它即可在 WS 推送到達前就獲得全量官方估算。
  const MARKET_ITEM_VALUES_STORAGE_KEY = 'marketItemValues';
  // 否則，WebSocket 隊伍名單在發生不會更新當前戰鬥動作的靜默離隊/解散後，
  // 仍可能繼續自我授權。
  const RECENT_PARTY_MESSAGE_MAX_AGE_MS = 10 * 60 * 1000;
  const PROFILE_CACHE_LIMIT = 50;
  const TEAM_IMPORT_PLAYER_IDS = ['1', '2', '3', '4', '5'];
  const UI_TEXT = {
    en: {
      button: 'Import from Main Site',
      enhancementButton: 'Import Character Setup',
      skillingButton: 'Import Skilling Snapshot',
      waitingMainSite: 'Waiting for main-site response…',
      importingSimulator: 'Importing into simulator…',
      importSuccess: 'Import successful.',
      importFailed: 'Import failed.',
      noMainSiteData:
        'No importable data was received from the main-site tab. Please make sure a logged-in main-site tab is open.',
      simulatorImportFailed: 'The simulator page could not finish the import.',
      pageBridgeTimeout: 'Timed out waiting for page bridge response.',
      mainSiteTabTimeout: 'Timed out waiting for the main-site tab response.',
      currentCharacterNotInitialized: 'Current character not initialized. Refresh the main-site tab once.',
      unableToReadCurrentProfile: 'Unable to read the current profile.',
      openProfileInGameFirst: 'Open profile in game first.',
      mainSiteShortcut: 'Combat Simulator',
      mainSiteShortcutTitle: 'Open MWI Combat Simulator',
      mirrorModalTitle: 'Open Combat Simulator',
      mirrorModalDescription: 'Choose which address you want to open.',
      mirrorModalGithub: 'GitHub Pages',
      mirrorModalCloudflare: 'Global (Cloudflare)',
      mirrorModalCancel: 'Cancel',
      mainSiteNews: 'News',
      copyProfileButton: 'Copy Character Data',
      copyProfileButtonTitle: 'Copy this character data as JSON for the combat simulator',
      copyProfileSuccess: 'Character data copied.',
      copyProfileFailed: 'Copy failed.',
      marketValuesStatusReady: 'Official estimates transferred: {count} items.',
      marketValuesStatusSynthetic:
        'Synthetic mid-price estimates forwarded: {count} items (not official; ~4-5% deviation vs MWITools).',
      marketValuesStatusMixed:
        'Official estimates forwarded: {officialCount} items + synthetic mid-price estimates: {syntheticCount} items (synthetic part not official; ~4-5% deviation vs MWITools).',
      marketValuesStatusEmpty: 'Official estimates: 0 items (asset score falls back to order-book prices).',
      labyrinthUpgradesStatusApplied:
        'Labyrinth shop upgrade levels overwritten by main-site data: {count} level(s) (was {previous}).',
      labyrinthUpgradesStatusCleared:
        'Labyrinth shop upgrade levels reset by main-site data (main site shows no purchases): {previous} manual level(s) cleared.',
    },
    zh: {
      button: '從主站匯入',
      enhancementButton: '匯入角色強化配置',
      skillingButton: '匯入生活技能快照',
      waitingMainSite: '等待主站響應…',
      importingSimulator: '正在匯入到模擬器…',
      importSuccess: '匯入成功。',
      importFailed: '匯入失敗。',
      noMainSiteData: '未從主站收到可匯入的資料。請確認主站標籤頁已開啟並已登入。',
      simulatorImportFailed: '模擬器頁面未能完成匯入。',
      pageBridgeTimeout: '等待頁面橋接響應超時。',
      mainSiteTabTimeout: '等待主站標籤頁響應超時。',
      currentCharacterNotInitialized: '當前角色尚未初始化，請重新整理一次主站標籤頁。',
      unableToReadCurrentProfile: '無法讀取當前角色資料。',
      openProfileInGameFirst: '需要先在遊戲中手動開啟資料。',
      mainSiteShortcut: '戰鬥模擬器',
      mainSiteShortcutTitle: '開啟 MWI Combat Simulator',
      mirrorModalTitle: '開啟戰鬥模擬器',
      mirrorModalDescription: '請選擇要跳轉的地址。',
      mirrorModalGithub: 'GitHub Pages',
      mirrorModalCloudflare: '全球地址（Cloudflare）',
      mirrorModalCancel: '取消',
      mainSiteNews: '新聞',
      copyProfileButton: '複製角色資料',
      copyProfileButtonTitle: '複製該角色資料（JSON）用於戰鬥模擬器',
      copyProfileSuccess: '角色資料已複製。',
      copyProfileFailed: '複製失敗。',
      marketValuesStatusReady: '官方估值已透傳：{count} 個物品。',
      marketValuesStatusSynthetic: '合成中價估值已透傳：{count} 個物品（非官方估算，與 MWITools 口徑或有 4-5% 偏差）。',
      marketValuesStatusMixed:
        '官方估值已透傳：{officialCount} 個物品 + 合成中價估值：{syntheticCount} 個物品（合成部分非官方估算，與 MWITools 口徑或有 4-5% 偏差）。',
      marketValuesStatusEmpty: '官方估值：0 個物品（資產分將使用掛單價）。',
      labyrinthUpgradesStatusApplied: '迷宮商店升級等級已按主站資料覆蓋：{count} 項（原 {previous} 項）。',
      labyrinthUpgradesStatusCleared:
        '迷宮商店升級等級已按主站資料清零（主站顯示未購買）：原有 {previous} 項手動等級已被清除。',
    },
  };
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const mainSiteState = {
    isInstalled: false,
    sockets: new Set(),
    currentCharacterName: '',
    characterActions: [],
    recentPartyMessages: [],
    latestSharedProfile: null,
    profileCopyButton: null,
    // findOpenProfileDialog 全量掃描的冷卻截止時間戳（見 initMainSiteProfileCopyButton）。
    profileDialogScanCooldownUntil: 0,
    currentCombatAction: null,
    actionTypeFoodSlotsMap: {},
    actionTypeDrinkSlotsMap: {},
    consumableCombatTriggersMap: {},
    abilityCombatTriggersMap: {},
    currentCharacterSnapshot: null,
    // 官方估算市場價值快照（WS market_item_values_updated / 訂單簿增量合併），
    // 形如 { [itemHrid]: { [強化等級字串]: 價值 } }，隨匯入載荷透傳給模擬器。
    marketItemValues: {},
    // 合成行情快取（來自公開端點 marketplace.json 的中價估值），與 WS 真實官方估算
    // 分開儲存：真實值在合併時優先覆蓋，合成值只補缺。僅記憶體，重新整理後重新拉取。
    syntheticMarketItemValues: {},
    syntheticMarketFetchedAt: 0,
    syntheticMarketFetchInFlight: false,
    currentCharacterFoodSlotsReady: false,
    currentCharacterDrinkSlotsReady: false,
    currentCharacterConsumableTriggersReady: false,
    currentCharacterAbilityTriggersReady: false,
  };
  const COMBAT_ACTION_TYPE_HRID = '/action_types/combat';
  const CURRENT_CHARACTER_SNAPSHOT_KEYS = [
    'character',
    // 迷宮商店「永久 BUFF 升級」等級在 characterInfo 上（init_character_data 與
    // character_info_updated 下發，不在 init_client_data）；快照攜帶後隨匯入載荷
    // 透傳給模擬器（模擬器側從 payload.characterInfo 提取戰鬥 5 項等級）。
    // 快照側按頂層欄位級合併累積（【一般-2】），見 mergeCharacterInfoSnapshotField。
    'characterInfo',
    'characterSkills',
    'characterItems',
    'combatUnit',
    'characterHouseRoomMap',
    'characterAchievements',
    'characterGuildBuffMap',
    'guildBuildingLevelMap',
    'communityBuffs',
    'houseActionTypeBuffsMap',
    'communityActionTypeBuffsMap',
    'achievementActionTypeBuffsMap',
    'personalActionTypeBuffsMap',
    'mooPassActionTypeBuffsMap',
    'actionTypeFoodSlotsMap',
    'actionTypeDrinkSlotsMap',
    'consumableCombatTriggersMap',
    'abilityCombatTriggersMap',
  ];
  const REQUIRED_CURRENT_CHARACTER_SNAPSHOT_KEYS = ['character', 'characterSkills', 'characterItems', 'combatUnit'];

  function isCombatActionHrid(actionHrid) {
    return String(actionHrid || '').startsWith('/actions/combat/');
  }

  function normalizeDifficultyTier(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 0;
    }

    return Math.max(0, Math.floor(parsed));
  }

  function sortTrackedCharacterActions(actions) {
    return [...actions].sort((left, right) => {
      const leftPartyId = Number(left?.partyID ?? left?.partyId ?? 0);
      const rightPartyId = Number(right?.partyID ?? right?.partyId ?? 0);
      if (leftPartyId !== 0 && rightPartyId === 0) {
        return -1;
      }
      if (leftPartyId === 0 && rightPartyId !== 0) {
        return 1;
      }

      return Number(left?.ordinal || 0) - Number(right?.ordinal || 0);
    });
  }

  function refreshCurrentCombatAction() {
    const previousPartyId = Number(mainSiteState.currentCombatAction?.partyId || 0);
    const currentAction =
      mainSiteState.characterActions.find((action) => isCombatActionHrid(action?.actionHrid)) || null;
    if (!currentAction) {
      mainSiteState.currentCombatAction = null;
      if (previousPartyId !== 0) {
        clearStaleTeamRosterState(mainSiteState.currentCharacterName);
      }
      return;
    }

    const partyId = Number(currentAction?.partyID ?? currentAction?.partyId ?? 0);
    const nextPartyId = Number.isFinite(partyId) ? partyId : 0;

    mainSiteState.currentCombatAction = {
      actionHrid: String(currentAction.actionHrid || '').trim(),
      difficultyTier: normalizeDifficultyTier(currentAction.difficultyTier),
      partyId: nextPartyId,
    };

    if (previousPartyId !== 0 && nextPartyId === 0) {
      clearStaleTeamRosterState(mainSiteState.currentCharacterName);
    }
  }

  function replaceTrackedCharacterActions(nextActions) {
    mainSiteState.characterActions = sortTrackedCharacterActions(
      Array.isArray(nextActions) ? nextActions.filter((action) => action && typeof action === 'object') : [],
    );
    refreshCurrentCombatAction();
  }

  function mergeTrackedCharacterActions(endCharacterActions) {
    if (!Array.isArray(endCharacterActions) || endCharacterActions.length === 0) {
      return;
    }

    const nextActions = [...mainSiteState.characterActions];
    for (const action of endCharacterActions) {
      if (!action || typeof action !== 'object') {
        continue;
      }

      const actionId = Number(action.id || 0);
      const existingIndex = nextActions.findIndex((entry) => Number(entry?.id || 0) === actionId);
      if (action.isDone === true) {
        if (existingIndex >= 0) {
          nextActions.splice(existingIndex, 1);
        }
        continue;
      }

      if (existingIndex >= 0) {
        nextActions[existingIndex] = action;
      } else {
        nextActions.push(action);
      }
    }

    replaceTrackedCharacterActions(nextActions);
  }

  // 僅用於克隆「純 JSON 物件」（來自 socket 訊息或 JSON 載荷）。JSON 往返會丟失
  // undefined / 函式，並對 BigInt、迴圈引用拋錯——不要複用於其它非 JSON 結構。
  function clonePlainObject(value) {
    if (!value || typeof value !== 'object') {
      return {};
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      // 防禦：若未來載荷含 BigInt / 迴圈引用導致 JSON 往返拋錯，降級為深複製
      // （structuredClone 優先，遞迴兜底），避免淺複製與原始載荷共享巢狀引用。
      if (typeof structuredClone === 'function') {
        try {
          return structuredClone(value);
        } catch (_error) {
          // structuredClone 失敗（如含函式）時繼續走遞迴兜底。
        }
      }
      return deepClonePlainObject(value);
    }
  }

  function deepClonePlainObject(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object') {
      return value;
    }
    if (seen.has(value)) {
      // 迴圈引用防禦性妥協：返回原始引用，克隆結果與原始共享該巢狀物件。
      // 主站載荷經 JSON 序列化，正常不會出現迴圈引用；此分支僅防止極端輸入
      // 導致無限遞迴。若未來需要完全獨立的克隆，可改為拋錯或返回佔位值。
      return value;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map((item) => deepClonePlainObject(item, seen));
    }
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = deepClonePlainObject(value[key], seen);
    }
    return result;
  }

  function hasOwnKey(source, key) {
    return Boolean(source) && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, key);
  }

  function normalizeComparableText(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function normalizeCharacterName(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function normalizeCharacterNameList(rawNames, maxCount = 5) {
    const list = Array.isArray(rawNames) ? rawNames : [];
    const deduped = new Map();
    for (const entry of list) {
      const name = normalizeCharacterName(entry);
      if (!name) {
        continue;
      }

      const key = normalizeComparableText(name);
      if (!key || deduped.has(key)) {
        continue;
      }

      deduped.set(key, name);
      if (deduped.size >= maxCount) {
        break;
      }
    }

    return Array.from(deduped.values());
  }

  function isLikelyCharacterName(value) {
    const normalized = normalizeCharacterName(value);
    if (!normalized) {
      return false;
    }

    if (normalized.startsWith('/')) {
      return false;
    }

    // 純數字是合法角色名（如「123456」），不得當作數字 ID / 計數噪聲過濾掉，
    // 否則這類角色會在隊伍名單解析（readCharacterNameCandidate）中被靜默剔除，
    // 導致一鍵匯入（含團隊匯入）失敗或降級。僅拒絕明顯非名字的結構化文本。
    if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z$/i.test(normalized)) {
      return false;
    }

    if (/^\{.+\}$/.test(normalized) || /^\[.+\]$/.test(normalized)) {
      return false;
    }

    if (/^systemchatmessage\./i.test(normalized)) {
      return false;
    }

    return true;
  }

  function normalizeDetectedCharacterName(value) {
    return isLikelyCharacterName(value) ? normalizeCharacterName(value) : '';
  }

  function readCharacterNameCandidate(source) {
    if (!source || typeof source !== 'object') {
      return '';
    }

    const candidates = [
      source.characterName,
      source.name,
      source.displayName,
      source.playerName,
      source.character?.name,
      source.character?.characterName,
      source.player?.name,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeDetectedCharacterName(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  function buildTeamRosterContext() {
    return {
      currentCharacterName: normalizeCharacterName(mainSiteState.currentCharacterName),
      partyId: Number(mainSiteState.currentCombatAction?.partyId || 0),
      actionHrid: String(mainSiteState.currentCombatAction?.actionHrid || '').trim(),
      difficultyTier: normalizeDifficultyTier(mainSiteState.currentCombatAction?.difficultyTier),
    };
  }

  function buildTeamRosterExactCacheKey(context) {
    const currentCharacterName = normalizeComparableText(context?.currentCharacterName);
    const actionHrid = String(context?.actionHrid || '').trim();
    const difficultyTier = normalizeDifficultyTier(context?.difficultyTier);
    const partyId = Number(context?.partyId || 0);
    if (!currentCharacterName || !actionHrid) {
      return '';
    }

    return `${currentCharacterName}|${partyId}|${actionHrid}|${difficultyTier}`;
  }

  function buildTeamRosterLooseCacheKey(context) {
    const currentCharacterName = normalizeComparableText(context?.currentCharacterName);
    const actionHrid = String(context?.actionHrid || '').trim();
    const difficultyTier = normalizeDifficultyTier(context?.difficultyTier);
    if (!currentCharacterName || !actionHrid) {
      return '';
    }

    return `${currentCharacterName}|${actionHrid}|${difficultyTier}`;
  }

  function sanitizeTeamRosterCacheEntry(value) {
    const characterNames = normalizeCharacterNameList(value?.characterNames ?? value?.names ?? [], 5);
    if (characterNames.length < 2) {
      return null;
    }

    return {
      characterNames,
      updatedAt: Number(value?.updatedAt || Date.now()),
    };
  }

  function loadTeamRosterCacheStore() {
    const rawValue = GM_getValue(TEAM_ROSTER_CACHE_KEY, null);
    const exactSource = rawValue?.exact && typeof rawValue.exact === 'object' ? rawValue.exact : {};
    const looseSource = rawValue?.loose && typeof rawValue.loose === 'object' ? rawValue.loose : {};
    const exact = {};
    const loose = {};

    for (const [key, value] of Object.entries(exactSource)) {
      const normalized = sanitizeTeamRosterCacheEntry(value);
      if (normalized) {
        exact[key] = normalized;
      }
    }

    for (const [key, value] of Object.entries(looseSource)) {
      const normalized = sanitizeTeamRosterCacheEntry(value);
      if (normalized) {
        loose[key] = normalized;
      }
    }

    return { exact, loose };
  }

  function pruneTeamRosterCacheBucket(bucket) {
    const entries = Object.entries(bucket || {})
      .sort((left, right) => Number(right?.[1]?.updatedAt || 0) - Number(left?.[1]?.updatedAt || 0))
      .slice(0, TEAM_ROSTER_CACHE_BUCKET_LIMIT);
    return Object.fromEntries(entries);
  }

  function readTeamRosterCache(context) {
    const store = loadTeamRosterCacheStore();
    const exactKey = buildTeamRosterExactCacheKey(context);
    const looseKey = buildTeamRosterLooseCacheKey(context);
    const exactEntry = exactKey ? sanitizeTeamRosterCacheEntry(store.exact?.[exactKey]) : null;
    const looseEntry = looseKey ? sanitizeTeamRosterCacheEntry(store.loose?.[looseKey]) : null;

    return {
      exactKey,
      looseKey,
      exactCharacterNames: exactEntry?.characterNames ?? [],
      looseCharacterNames: looseEntry?.characterNames ?? [],
    };
  }

  function persistTeamRosterCache(context, characterNames) {
    const normalizedNames = normalizeCharacterNameList(characterNames, 5);
    if (normalizedNames.length < 2) {
      return false;
    }

    const exactKey = buildTeamRosterExactCacheKey(context);
    const looseKey = buildTeamRosterLooseCacheKey(context);
    if (!exactKey && !looseKey) {
      return false;
    }

    const store = loadTeamRosterCacheStore();
    const entry = {
      characterNames: normalizedNames,
      updatedAt: Date.now(),
    };

    if (exactKey) {
      store.exact[exactKey] = entry;
    }

    if (looseKey) {
      store.loose[looseKey] = entry;
    }

    GM_setValue(TEAM_ROSTER_CACHE_KEY, {
      exact: pruneTeamRosterCacheBucket(store.exact),
      loose: pruneTeamRosterCacheBucket(store.loose),
    });

    return true;
  }

  function clearRecentPartyMessages() {
    mainSiteState.recentPartyMessages = [];
  }

  function hasStructuredPartyInfoFieldHints(rawValue) {
    return (
      typeof rawValue === 'string' && rawValue.includes('"partySlotMap"') && rawValue.includes('"sharableCharacterMap"')
    );
  }

  function getFreshRecentPartyMessages(now = Date.now()) {
    const currentTime = Number(now);
    const messages = Array.isArray(mainSiteState.recentPartyMessages) ? mainSiteState.recentPartyMessages : [];
    const freshMessages = messages.filter((message) => {
      const receivedAt = Number(message?.receivedAt || 0);
      if (!Number.isFinite(currentTime) || !Number.isFinite(receivedAt) || receivedAt <= 0) {
        return false;
      }

      const age = currentTime - receivedAt;
      return age >= 0 && age <= RECENT_PARTY_MESSAGE_MAX_AGE_MS;
    });

    if (freshMessages.length !== messages.length) {
      mainSiteState.recentPartyMessages = freshMessages;
    }

    return freshMessages;
  }

  function clearTeamRosterCacheForCharacter(characterName) {
    const comparableCharacterName = normalizeComparableText(characterName);
    if (!comparableCharacterName) {
      return false;
    }

    const store = loadTeamRosterCacheStore();
    let changed = false;
    const cacheKeyPrefix = `${comparableCharacterName}|`;

    for (const bucket of ['exact', 'loose']) {
      for (const key of Object.keys(store[bucket] || {})) {
        if (!String(key || '').startsWith(cacheKeyPrefix)) {
          continue;
        }

        delete store[bucket][key];
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    GM_setValue(TEAM_ROSTER_CACHE_KEY, {
      exact: pruneTeamRosterCacheBucket(store.exact),
      loose: pruneTeamRosterCacheBucket(store.loose),
    });

    return true;
  }

  function clearStaleTeamRosterState(characterName = mainSiteState.currentCharacterName) {
    clearRecentPartyMessages();
    clearTeamRosterCacheForCharacter(characterName);
  }

  function countPartyInfoMembers(partyInfo) {
    if (!partyInfo || typeof partyInfo !== 'object' || Array.isArray(partyInfo)) {
      return 0;
    }

    return readCollectionEntries(partyInfo?.partySlotMap).filter((entry) => entry && typeof entry === 'object').length;
  }

  function collectStructuredPartyInfoSources(source, path, depth, results, visited) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || depth > 3) {
      return;
    }

    if (visited.has(source)) {
      return;
    }

    visited.add(source);

    // 隊伍資料載荷按結構而非鍵名識別，因為主站並不總是將它們巢狀在
    // 字面量 `partyInfo` 鍵名下。
    const hasPartySlotMap =
      source?.partySlotMap && typeof source.partySlotMap === 'object' && !Array.isArray(source.partySlotMap);
    const hasSharableCharacterMap =
      source?.sharableCharacterMap &&
      typeof source.sharableCharacterMap === 'object' &&
      !Array.isArray(source.sharableCharacterMap);
    if (hasPartySlotMap && hasSharableCharacterMap) {
      results.push({
        path: path || 'message',
        value: source,
      });
    }

    if (depth >= 3) {
      return;
    }

    Object.keys(source).forEach((key) => {
      const value = source[key];
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }

      const nextPath = path ? `${path}.${key}` : key;
      collectStructuredPartyInfoSources(value, nextPath, depth + 1, results, visited);
    });
  }

  function getStructuredPartyInfoSources(source, path = '') {
    const results = [];
    collectStructuredPartyInfoSources(source, path, 0, results, new WeakSet());
    return Array.from(new Map(results.map((entry) => [entry.path, entry])).values());
  }

  function rememberRecentPartyMessage(message, receivedAt = Date.now()) {
    const structuredSources = getStructuredPartyInfoSources(message);
    if (structuredSources.length === 0) {
      return;
    }

    const snapshots = structuredSources
      .map((entry) => clonePlainObject(entry.value))
      .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      .map((partyInfo) => ({
        partyInfo,
        receivedAt,
      }));
    if (snapshots.length === 0) {
      return;
    }

    // 空/單人隊伍快照是明確的 \"left the party\" 訊號，因此會丟棄過期的名單狀態。
    // 快照本身不會被保留：成員不足 2 人的名單在下游永遠無法產生候選。
    const hasActiveRoster = snapshots.some((snapshot) => countPartyInfoMembers(snapshot.partyInfo) >= 2);
    if (!hasActiveRoster) {
      clearStaleTeamRosterState(mainSiteState.currentCharacterName);
      return;
    }

    mainSiteState.recentPartyMessages = [...snapshots, ...getFreshRecentPartyMessages(receivedAt)].slice(
      0,
      RECENT_PARTY_MESSAGE_LIMIT,
    );
  }

  function getMainSiteGameState() {
    const candidates = [pageWindow?.mwi, pageWindow?.MWI, pageWindow?.Mwi];

    for (const candidate of candidates) {
      const state = candidate?.game?.state;
      if (state && typeof state === 'object') {
        return state;
      }
    }

    return null;
  }

  function toCollectionValues(source) {
    if (Array.isArray(source)) {
      return source;
    }

    if (source instanceof Map || source instanceof Set) {
      return Array.from(source.values());
    }

    return null;
  }

  function readCollectionEntries(source) {
    const collectionValues = toCollectionValues(source);
    if (Array.isArray(collectionValues)) {
      return collectionValues;
    }

    if (source && typeof source === 'object' && !Array.isArray(source)) {
      return Object.values(source);
    }

    return [];
  }

  function readCollectionValue(source, key) {
    if (!source || typeof source !== 'object') {
      return null;
    }

    if (source instanceof Map) {
      return source.get(key) ?? source.get(String(key)) ?? null;
    }

    return source[key] ?? source[String(key)] ?? null;
  }

  function buildCurrentCharacterLookup(gameState) {
    const rawCurrentCharacterId = Number(gameState?.character?.id || 0);
    return {
      currentCharacterId: Number.isFinite(rawCurrentCharacterId) ? rawCurrentCharacterId : 0,
      currentCharacterName: normalizeCharacterName(gameState?.character?.name || mainSiteState.currentCharacterName),
      comparableCurrentCharacterName: normalizeComparableText(
        gameState?.character?.name || mainSiteState.currentCharacterName,
      ),
    };
  }

  function sortResolvedTeamMembers(members) {
    return [...members].sort((left, right) => {
      if (Boolean(left?.isCurrent) !== Boolean(right?.isCurrent)) {
        return left?.isCurrent ? -1 : 1;
      }

      if (Boolean(left?.isLeader) !== Boolean(right?.isLeader)) {
        return left?.isLeader ? -1 : 1;
      }

      if (Boolean(left?.isReady) !== Boolean(right?.isReady)) {
        return left?.isReady ? -1 : 1;
      }

      const leftSortId = Number.isFinite(Number(left?.sortId)) ? Number(left.sortId) : Number.MAX_SAFE_INTEGER;
      const rightSortId = Number.isFinite(Number(right?.sortId)) ? Number(right.sortId) : Number.MAX_SAFE_INTEGER;
      if (leftSortId !== rightSortId) {
        return leftSortId - rightSortId;
      }

      const leftOrderIndex = Number.isFinite(Number(left?.orderIndex))
        ? Number(left.orderIndex)
        : Number.MAX_SAFE_INTEGER;
      const rightOrderIndex = Number.isFinite(Number(right?.orderIndex))
        ? Number(right.orderIndex)
        : Number.MAX_SAFE_INTEGER;
      if (leftOrderIndex !== rightOrderIndex) {
        return leftOrderIndex - rightOrderIndex;
      }

      return String(left?.name || '').localeCompare(String(right?.name || ''));
    });
  }

  function buildStructuredRosterCandidate(path, members) {
    const normalizedMembers = Array.isArray(members)
      ? members.filter((entry) => entry && typeof entry === 'object')
      : [];
    const orderedMembers = sortResolvedTeamMembers(normalizedMembers);
    const includesCurrentCharacter = orderedMembers.some((entry) => {
      return entry.isCurrent === true && normalizeCharacterName(entry?.name || '').length > 0;
    });
    if (!includesCurrentCharacter) {
      return null;
    }

    const normalizedEntries = orderedMembers
      .map((entry) => {
        const name = normalizeCharacterName(entry?.name || '');
        if (!name) {
          return null;
        }

        const rawCharacterId = Number(entry?.characterId || 0);
        return {
          characterId: Number.isFinite(rawCharacterId) ? rawCharacterId : 0,
          characterName: name,
          isCurrent: entry?.isCurrent === true,
        };
      })
      .filter((entry) => entry !== null);

    const names = normalizeCharacterNameList(
      normalizedEntries.map((entry) => entry.characterName),
      5,
    );
    if (names.length < 2) {
      return null;
    }

    return {
      path,
      names,
      members: normalizedEntries
        .filter((entry) =>
          names.some((name) => normalizeComparableText(name) === normalizeComparableText(entry.characterName)),
        )
        .slice(0, 5),
    };
  }

  function resolvePartyInfoRosterCandidate(partyInfo, path, currentCharacterLookup) {
    if (!partyInfo || typeof partyInfo !== 'object' || Array.isArray(partyInfo)) {
      return null;
    }

    const partySlotEntries = readCollectionEntries(partyInfo?.partySlotMap).filter(
      (entry) => entry && typeof entry === 'object',
    );
    if (partySlotEntries.length < 2) {
      return null;
    }

    const sharableCharacterMap = partyInfo?.sharableCharacterMap;
    if (!sharableCharacterMap || typeof sharableCharacterMap !== 'object') {
      return null;
    }

    const currentCharacterId = Number(currentCharacterLookup?.currentCharacterId || 0);
    const currentCharacterName = normalizeCharacterName(currentCharacterLookup?.currentCharacterName || '');
    const comparableCurrentCharacterName = normalizeComparableText(
      currentCharacterLookup?.comparableCurrentCharacterName || currentCharacterName,
    );

    const members = partySlotEntries.map((partySlot, index) => {
      const rawCharacterId = Number(partySlot?.characterID ?? partySlot?.characterId ?? 0);
      const characterId = Number.isFinite(rawCharacterId) ? rawCharacterId : 0;
      const sharedCharacter = characterId !== 0 ? readCollectionValue(sharableCharacterMap, characterId) : null;
      const nameFromSharedCharacter = readCharacterNameCandidate(sharedCharacter);
      const comparableName = normalizeComparableText(nameFromSharedCharacter);
      const isCurrentById = currentCharacterId !== 0 && characterId === currentCharacterId;
      const isCurrentByName = comparableCurrentCharacterName
        ? comparableName === comparableCurrentCharacterName
        : false;
      const rawSlotId = Number(partySlot?.id || 0);

      return {
        name: nameFromSharedCharacter || (isCurrentById || isCurrentByName ? currentCharacterName : ''),
        characterId,
        isCurrent: isCurrentById || isCurrentByName,
        isLeader: partySlot?.isLeader === true,
        isReady: partySlot?.isReady === true,
        sortId: Number.isFinite(rawSlotId) ? rawSlotId : Number.MAX_SAFE_INTEGER,
        orderIndex: index,
      };
    });

    return buildStructuredRosterCandidate(path, members);
  }

  function getGameStatePartyInfoSources(gameState) {
    const directPartyInfo = gameState?.partyInfo ?? null;
    const sources = [
      ...(directPartyInfo ? [{ path: 'mwi.game.state.partyInfo', value: directPartyInfo }] : []),
      ...getStructuredPartyInfoSources(gameState, 'mwi.game.state'),
    ];
    const seenPaths = new Set();

    return sources.filter((entry) => {
      const path = String(entry?.path || '');
      if (!path || seenPaths.has(path)) {
        return false;
      }

      seenPaths.add(path);
      return true;
    });
  }

  function resolveTeamMemberNamesFromGameState() {
    const gameState = getMainSiteGameState();
    const currentCharacterLookup = buildCurrentCharacterLookup(gameState);
    const directPartyInfo = gameState?.partyInfo ?? null;
    const partyInfoSources = getGameStatePartyInfoSources(gameState);

    let partyInfoCandidate = null;
    let resolvedPartyInfo = directPartyInfo;
    for (const entry of partyInfoSources) {
      const candidate = resolvePartyInfoRosterCandidate(entry.value, entry.path, currentCharacterLookup);
      if (candidate) {
        partyInfoCandidate = candidate;
        resolvedPartyInfo = entry.value;
        break;
      }

      if (countPartyInfoMembers(entry.value) > countPartyInfoMembers(resolvedPartyInfo)) {
        resolvedPartyInfo = entry.value;
      }
    }

    const partyInfoMemberCount = partyInfoSources.reduce((maxCount, entry) => {
      return Math.max(maxCount, countPartyInfoMembers(entry.value));
    }, 0);

    return {
      partyInfoNames: partyInfoCandidate?.names ?? [],
      partyInfoMembers: partyInfoCandidate?.members ?? [],
      partyInfo: resolvedPartyInfo,
      partyInfoMemberCount,
      partyInfoResolvedFromPath: partyInfoCandidate?.path || '',
    };
  }

  function resolveTeamMemberNamesFromRecentPartyMessages(now = Date.now()) {
    const messages = getFreshRecentPartyMessages(now);
    const currentCharacterLookup = buildCurrentCharacterLookup(getMainSiteGameState());

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
      const candidate = resolvePartyInfoRosterCandidate(
        messages[messageIndex]?.partyInfo,
        `wsPartyMessages[${messageIndex}].partyInfo`,
        currentCharacterLookup,
      );
      if (candidate) {
        return {
          names: candidate.names,
          members: candidate.members ?? [],
          messages,
          resolvedFromPath: candidate.path,
        };
      }
    }

    return {
      names: [],
      members: [],
      messages,
      resolvedFromPath: '',
    };
  }

  function selectAutoDetectedTeamRoster({ gameStateResult, wsPartyResult, cacheMatch, allowFallbackSources = false }) {
    const candidates = [
      {
        source: 'game-state:partyInfo',
        names: gameStateResult?.partyInfoNames ?? [],
        members: gameStateResult?.partyInfoMembers ?? [],
        resolvedFromPath: gameStateResult?.partyInfoResolvedFromPath || '',
      },
    ];

    if (allowFallbackSources) {
      candidates.push(
        {
          source: 'ws-party',
          names: wsPartyResult?.names ?? [],
          members: wsPartyResult?.members ?? [],
          resolvedFromPath: wsPartyResult?.resolvedFromPath || '',
        },
        {
          source: 'cache',
          names: cacheMatch?.exactCharacterNames ?? [],
          members: [],
          resolvedFromPath: '',
        },
      );
    }

    for (const candidate of candidates) {
      if (Array.isArray(candidate.names) && candidate.names.length >= 2) {
        return candidate;
      }
    }

    return {
      source: 'request',
      names: [],
      members: [],
      resolvedFromPath: '',
    };
  }

  function debugTeamRosterAutoDetection(details) {
    try {
      console.debug('[MWI TM] Team roster auto-detect', details);
    } catch (_error) {}
  }

  function isDomElement(value) {
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      Number(value.nodeType) === 1 &&
      typeof value.querySelector === 'function'
    );
  }

  function pickCurrentCharacterSnapshotFields(message) {
    const snapshot = {};
    for (const key of CURRENT_CHARACTER_SNAPSHOT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(message || {}, key)) {
        continue;
      }

      snapshot[key] = clonePlainObject(message[key]);
    }

    return snapshot;
  }

  // characterInfo 頂層欄位級合併（【一般-2】前向相容加固，2026-09-16）：
  // 現狀依據：既有程式碼一致按「官方 character_info_updated 頂層整包下發 characterInfo」處理
  // （該前提來自實包觀測，程式碼內無從自動校驗）；此前提下本函式與整包替換完全等價。但若官方
  // 改為「僅下發變更欄位」，整包替換會把快照的 characterInfo 縮成部分物件，而模擬器側
  // extractMainSiteLabyrinthUpgrades 只要任一等級欄位攜帶即整包採用（缺失欄位落空 = 未購買），
  // 未出現在下發載荷中的迷宮商店升級等級會被靜默清零。合併下發物件的頂層自有鍵即可消除對
  // 「整包下發」的前向依賴，且不改變模擬器側口徑（顯式 0 仍能清零，見 importExportMapper 用例）。
  // 語義：升級等級均為頂層標量，頂層淺合併即欄位級語義；巢狀物件按欄位整體替換（與官方
  // 「欄位級下發」一致）；跳過 '__proto__'——JSON.parse 會為該鍵建立自有鍵，而普通賦值會
  // 命中 __proto__ 訪問器改寫目標物件原型（與 mergeStoredMarketItemValues 同款防禦）。
  // 邊界：shouldMerge 為假時直接採用下發物件——首次收到 / reset 重建快照，或下發值不是普通物件；
  // 陣列等異形下發照整包採用，與原實現同形。下發值為非物件標量（null / 字串 / 數字，經
  // clonePlainObject 歸一為 {}）時合併結果即既有值——不縮容也不清空（舊實現會把快照替換成 {}，
  // 等於丟棄快照內容；本層不復用「{} = 未攜帶」這條消費側判斷，避免快照被靜默掏空）。
  // 未覆蓋的殘留：官方若改用「欄位級 null」表達「該項未下發」，欄位級 null 仍會照寫進快照，並在
  // 混合載荷下被模擬器按落空清零——該口徑屬【一般-1】範圍（消費側現鎖 null = 無資料 ≠ 0 級），
  // 本函式不在此層再發明第二套 null 規則。
  // 【欄位級刪除無回滾路徑】本函式只服務於 characterInfo（呼叫點見 updateCurrentCharacterSnapshot），
  // 不是可複用的通用合併工具，勿挪用到其它快照欄位（用例「合併只對 characterInfo 生效」已錨定此邊界）：
  // 合併語義只增不減——結果鍵集恆為 existing ∪ incoming，characterInfo 的欄位一旦進入快照，除 reset
  // （init_character_data 重建快照，或 character_updated 身份變更觸發 resetCurrentCharacterTracking）外
  // 沒有任何刪除路徑。若官方把某個等級欄位從下發載荷中整體移除（升級下線 / 欄位改名——本層既無從區分二者，
  // 也區分不了「下線」與「部分下發」），該欄位的陳舊值會一直留在快照裡，並隨匯入載荷送達模擬器：
  // 快照側殘留壽命 = 當前頁面會話（至下次快照重建為止；快照物件僅存記憶體、不落 GM 儲存，橋接派生載荷雖會
  // 寫入 GM 的 response 記錄，但按 requestId 匹配消費，不構成跨會話回放），但載荷一旦被匯入即成為模擬器側
  // 持久配置（simulatorStorage 的 labyrinthUpgrades 落盤），不再受快照重建回收。
  // 消費側 extractMainSiteLabyrinthUpgrades 只提取戰鬥 5 項，對其中任一項「欄位攜帶即整包採用、缺失欄位
  // 落空 = 未購買」，故殘留值會被當作有效等級，匯入後繼續按已下線的升級模擬（生活向 4 項不被提取，其殘留
  // 無消費方）。
  // 持久側殘留的回收路徑（複核修正：上面的「沒有任何刪除路徑」只指快照側；持久側並非「沒有任何回收路徑」，
  // 而是「取決於攜帶門是否還會通過」）：
  // ① 快照重建（新頁面會話）後該鍵不再進入載荷 → 下次匯入的載荷攜帶門通過（至少一項等級欄位 level >= 0）
  //    時，匯入只對映目錄 5 項、缺失鍵落空 ⇒ 整包覆蓋把該鍵一併丟棄；
  // ② 使用者在 UI 手工改這 5 項（setLabyrinthUpgrade，改成 0 級即從持久配置裡消失）；
  // ③ 匯入模擬器原生格式/備份（simulationSettings.labyrinthUpgrades 按「全量替換/恢復備份」契約生效，
  //    機制見 importExportMapper 的 normalizeImportedSimulationSettings，該契約有用例錨定）。
  // 於是攜帶門不再通過（下稱「永不回收」情形）時，持久殘留就只剩 ②③ 兩條回收路徑。觸發條件有兩條：
  // 其一，官方把戰鬥 5 項欄位全部下掉、或全部改名而目錄未同步；其二，官方改用「省略未購買鍵」表達 0
  // （當前實包觀測為顯式下發 0，程式碼內無從校驗）而該玩家其餘項也均為 0。此時攜帶門
  // （level !== undefined && level >= 0）對 5 項全部落空
  // ⇒ ① 永不發生。改名另有映象失效：新欄位名讀不到 = 缺失 = 未購買，目錄同步之前的那次匯入會把該 key
  // 靜默清零（前提同樣是攜帶門通過；5 項同時全部改名即落進上面的「永不回收」一側），目錄同步官方欄位名
  // 後的下一次匯入即自愈。
  // 取捨說明：這是與「部分下發誤清零」（本函式要修的問題）之間的有意權衡，兩個方向都缺少協議訊號
  // （無法判定某次載荷是整包還是部分），故本層不做刪除推斷——欄位白名單 / 缺席水位線之類的啟發式會引入
  // 「誤刪有效等級」這一新失效模式，代價高於殘留本身；「欄位級 null」的表達仍屬消費側【一般-1】範圍。
  // 【操作要求】官方等級欄位改名/下線時，改目錄裡的官方欄位名（單點在 shared/labyrinthShopUpgrades.js，見
  // 其頭註釋）不算修完——本層既無欄位表也無刪除路徑，幫不上忙：改名須與目錄同步同批發布；下線須同時給出
  // 使用者已落盤 labyrinthUpgrades 的清理路徑（storage 版本號 / 一次性遷移 / UI 提示核對）。持久殘留不在本層
  // 與消費側【一般-1】口徑的覆蓋範圍內（後者只鎖「欄位級 null」）。
  function mergeCharacterInfoSnapshotField(existing, incoming) {
    const shouldMerge =
      Boolean(existing) &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      Boolean(incoming) &&
      typeof incoming === 'object' &&
      !Array.isArray(incoming);
    if (!shouldMerge) {
      return incoming;
    }

    const merged = clonePlainObject(existing);
    for (const key of Object.keys(incoming)) {
      if (key === '__proto__') {
        continue;
      }
      merged[key] = incoming[key];
    }

    return merged;
  }

  function updateCurrentCharacterSnapshot(message, reset = false) {
    const nextFields = pickCurrentCharacterSnapshotFields(message);
    const type = String(message?.type || '');

    if (reset || type === 'guild_buffs_updated') {
      nextFields.characterGuildBuffMap = hasOwnKey(message, 'characterGuildBuffMap')
        ? clonePlainObject(message.characterGuildBuffMap)
        : {};
    }
    if (reset || type === 'guild_updated') {
      nextFields.guildBuildingLevelMap = hasOwnKey(message, 'guildBuildingLevelMap')
        ? clonePlainObject(message.guildBuildingLevelMap)
        : {};
    }

    const nextKeys = Object.keys(nextFields);
    if (nextKeys.length === 0) {
      return;
    }

    const baseSnapshot =
      reset || !mainSiteState.currentCharacterSnapshot ? {} : clonePlainObject(mainSiteState.currentCharacterSnapshot);

    for (const key of nextKeys) {
      // characterInfo 走頂層欄位級合併（【一般-2】前向相容，見 mergeCharacterInfoSnapshotField）；
      // 其餘欄位維持整欄位替換。
      baseSnapshot[key] =
        key === 'characterInfo' ? mergeCharacterInfoSnapshotField(baseSnapshot[key], nextFields[key]) : nextFields[key];
    }

    mainSiteState.currentCharacterSnapshot = baseSnapshot;
  }

  function readSnapshotEntryIdentity(entry, identityKeys, fallbackIndex = -1) {
    if (!entry || typeof entry !== 'object') {
      return fallbackIndex >= 0 ? `index:${fallbackIndex}` : '';
    }

    for (const key of identityKeys) {
      const value = entry[key];
      if (value == null || String(value).trim() === '') {
        continue;
      }

      return `${key}:${String(value)}`;
    }

    return fallbackIndex >= 0 ? `index:${fallbackIndex}` : '';
  }

  function mergeCurrentCharacterSnapshotEntries(field, updates, identityKeys, removeWhen = null) {
    if (!Array.isArray(updates) || updates.length === 0) {
      return;
    }

    const snapshot = mainSiteState.currentCharacterSnapshot;
    if (!snapshot || typeof snapshot !== 'object') {
      return;
    }

    const existingEntries = Array.isArray(snapshot[field])
      ? snapshot[field].map((entry) => clonePlainObject(entry))
      : snapshot[field] && typeof snapshot[field] === 'object'
        ? Object.values(snapshot[field]).map((entry) => clonePlainObject(entry))
        : [];

    for (const rawUpdate of updates) {
      if (!rawUpdate || typeof rawUpdate !== 'object') {
        continue;
      }

      const update = clonePlainObject(rawUpdate);
      const identity = readSnapshotEntryIdentity(update, identityKeys);
      const index = identity
        ? existingEntries.findIndex(
            (entry, entryIndex) => readSnapshotEntryIdentity(entry, identityKeys, entryIndex) === identity,
          )
        : -1;

      if (removeWhen && removeWhen(update)) {
        if (index >= 0) {
          existingEntries.splice(index, 1);
        }
        continue;
      }

      if (index >= 0) {
        existingEntries[index] = update;
      } else {
        existingEntries.push(update);
      }
    }

    snapshot[field] = existingEntries;
  }

  function captureCurrentCharacterDataUpdate(message) {
    const type = String(message?.type || '');
    if (!mainSiteState.currentCharacterSnapshot || typeof mainSiteState.currentCharacterSnapshot !== 'object') {
      return;
    }

    if (type === 'skills_updated') {
      mergeCurrentCharacterSnapshotEntries('characterSkills', message.endCharacterSkills, ['skillHrid']);
      return;
    }

    if (type === 'items_updated') {
      mergeCurrentCharacterSnapshotEntries(
        'characterItems',
        message.endCharacterItems,
        ['hash', 'id'],
        (entry) => Number(entry.count) === 0,
      );
      return;
    }

    if (type === 'house_rooms_updated') {
      updateCurrentCharacterSnapshot(message);
      return;
    }

    if (type === 'achievements_updated') {
      mergeCurrentCharacterSnapshotEntries('characterAchievements', message.achievements, ['achievementHrid']);
      updateCurrentCharacterSnapshot(message);
      return;
    }

    if (type === 'character_info_updated') {
      // 整包替換 characterInfo（迷宮商店升級等級所在欄位）；message 頂層即帶
      // characterInfo，pickCurrentCharacterSnapshotFields 會整包克隆。快照落盤走頂層欄位級
      // 合併（【一般-2】mergeCharacterInfoSnapshotField）：整包下發下與整包替換等價，官方若
      // 改為部分欄位下發也不會把未下發的等級從快照裡抹掉。
      updateCurrentCharacterSnapshot(message);
      return;
    }

    if (
      type === 'achievement_buffs_updated' ||
      type === 'community_buffs_updated' ||
      type === 'personal_buffs_updated' ||
      type === 'moo_pass_buffs_updated' ||
      type === 'guild_buffs_updated' ||
      type === 'guild_updated'
    ) {
      updateCurrentCharacterSnapshot(message);
      return;
    }

    if (CURRENT_CHARACTER_SNAPSHOT_KEYS.some((key) => hasOwnKey(message, key))) {
      updateCurrentCharacterSnapshot(message);
    }
  }

  function syncCurrentCharacterConsumableSlotMaps(message, reset = false) {
    const hasFoodMap = hasOwnKey(message, 'actionTypeFoodSlotsMap');
    const hasDrinkMap = hasOwnKey(message, 'actionTypeDrinkSlotsMap');
    if (!reset && !hasFoodMap && !hasDrinkMap) {
      return;
    }

    if (reset) {
      mainSiteState.actionTypeFoodSlotsMap = clonePlainObject(hasFoodMap ? message.actionTypeFoodSlotsMap : {});
      mainSiteState.actionTypeDrinkSlotsMap = clonePlainObject(hasDrinkMap ? message.actionTypeDrinkSlotsMap : {});
      mainSiteState.currentCharacterFoodSlotsReady = hasFoodMap;
      mainSiteState.currentCharacterDrinkSlotsReady = hasDrinkMap;
      return;
    }

    if (hasFoodMap) {
      mainSiteState.actionTypeFoodSlotsMap = clonePlainObject(message.actionTypeFoodSlotsMap);
      mainSiteState.currentCharacterFoodSlotsReady = true;
    }

    if (hasDrinkMap) {
      mainSiteState.actionTypeDrinkSlotsMap = clonePlainObject(message.actionTypeDrinkSlotsMap);
      mainSiteState.currentCharacterDrinkSlotsReady = true;
    }
  }

  function syncCurrentCharacterCombatTriggerMaps(message, reset = false) {
    const hasConsumableTriggerMap = hasOwnKey(message, 'consumableCombatTriggersMap');
    const hasAbilityTriggerMap = hasOwnKey(message, 'abilityCombatTriggersMap');
    if (!reset && !hasConsumableTriggerMap && !hasAbilityTriggerMap) {
      return;
    }

    if (reset) {
      mainSiteState.consumableCombatTriggersMap = clonePlainObject(
        hasConsumableTriggerMap ? message.consumableCombatTriggersMap : {},
      );
      mainSiteState.abilityCombatTriggersMap = clonePlainObject(
        hasAbilityTriggerMap ? message.abilityCombatTriggersMap : {},
      );
      mainSiteState.currentCharacterConsumableTriggersReady = hasConsumableTriggerMap;
      mainSiteState.currentCharacterAbilityTriggersReady = hasAbilityTriggerMap;
      return;
    }

    if (hasConsumableTriggerMap) {
      mainSiteState.consumableCombatTriggersMap = clonePlainObject(message.consumableCombatTriggersMap);
      mainSiteState.currentCharacterConsumableTriggersReady = true;
    }

    if (hasAbilityTriggerMap) {
      mainSiteState.abilityCombatTriggersMap = clonePlainObject(message.abilityCombatTriggersMap);
      mainSiteState.currentCharacterAbilityTriggersReady = true;
    }
  }

  function readCurrentCharacterIdentity(source) {
    return {
      characterId: String(source?.character?.id || '').trim(),
      characterName: normalizeCharacterName(source?.character?.name || ''),
    };
  }

  function hasSnapshotField(snapshot, key) {
    return Boolean(snapshot) && typeof snapshot === 'object' && Object.prototype.hasOwnProperty.call(snapshot, key);
  }

  function hasCharacterIdentityChanged(message) {
    const incomingIdentity = readCurrentCharacterIdentity(message);
    if (!incomingIdentity.characterId && !incomingIdentity.characterName) {
      return false;
    }

    const existingIdentity = readCurrentCharacterIdentity(mainSiteState.currentCharacterSnapshot);
    if (!existingIdentity.characterId && !existingIdentity.characterName) {
      return false;
    }

    if (
      incomingIdentity.characterId &&
      existingIdentity.characterId &&
      incomingIdentity.characterId !== existingIdentity.characterId
    ) {
      return true;
    }

    if (
      incomingIdentity.characterName &&
      existingIdentity.characterName &&
      normalizeComparableText(incomingIdentity.characterName) !==
        normalizeComparableText(existingIdentity.characterName)
    ) {
      return true;
    }

    return false;
  }

  function resetCurrentCharacterTracking(previousCharacterName = '') {
    clearStaleTeamRosterState(previousCharacterName || mainSiteState.currentCharacterName);
    mainSiteState.currentCharacterSnapshot = null;
    mainSiteState.currentCharacterFoodSlotsReady = false;
    mainSiteState.currentCharacterDrinkSlotsReady = false;
    mainSiteState.currentCharacterConsumableTriggersReady = false;
    mainSiteState.currentCharacterAbilityTriggersReady = false;
    replaceTrackedCharacterActions([]);
    replaceConsumableSlotMaps({}, {});
    replaceCombatTriggerMaps({}, {});
  }

  function hasCurrentCharacterSnapshot() {
    const snapshot = mainSiteState.currentCharacterSnapshot;
    return Boolean(
      snapshot &&
      typeof snapshot === 'object' &&
      snapshot.character &&
      typeof snapshot.character === 'object' &&
      Array.isArray(snapshot.characterSkills) &&
      REQUIRED_CURRENT_CHARACTER_SNAPSHOT_KEYS.every((key) => hasSnapshotField(snapshot, key)),
    );
  }

  function hasCurrentCharacterConsumableSlots() {
    return (
      mainSiteState.currentCharacterFoodSlotsReady === true && mainSiteState.currentCharacterDrinkSlotsReady === true
    );
  }

  function hasCurrentCharacterConsumableTriggerSnapshot() {
    return mainSiteState.currentCharacterConsumableTriggersReady === true;
  }

  function hasCurrentCharacterAbilityTriggerSnapshot() {
    return mainSiteState.currentCharacterAbilityTriggersReady === true;
  }

  function hasCurrentCharacterCombatTriggerSnapshot() {
    return hasCurrentCharacterConsumableTriggerSnapshot() || hasCurrentCharacterAbilityTriggerSnapshot();
  }

  function buildCurrentCharacterPayload() {
    if (!hasCurrentCharacterSnapshot() || !hasCurrentCharacterConsumableSlots()) {
      return null;
    }

    const snapshot = clonePlainObject(mainSiteState.currentCharacterSnapshot);
    snapshot.actionTypeFoodSlotsMap = clonePlainObject(mainSiteState.actionTypeFoodSlotsMap);
    snapshot.actionTypeDrinkSlotsMap = clonePlainObject(mainSiteState.actionTypeDrinkSlotsMap);
    if (hasCurrentCharacterConsumableTriggerSnapshot()) {
      snapshot.consumableCombatTriggersMap = clonePlainObject(mainSiteState.consumableCombatTriggersMap);
    } else {
      delete snapshot.consumableCombatTriggersMap;
    }

    if (hasCurrentCharacterAbilityTriggerSnapshot()) {
      snapshot.abilityCombatTriggersMap = clonePlainObject(mainSiteState.abilityCombatTriggersMap);
    } else {
      delete snapshot.abilityCombatTriggersMap;
    }
    const mergedMarketItemValues = getMergedMarketItemValues();
    if (Object.keys(mergedMarketItemValues).length > 0) {
      snapshot.marketItemValues = mergedMarketItemValues;
      // N5 來源標記：描述的是「本載荷所攜數值」的來源，僅在載荷實際攜帶市場資料時
      // 掛載——空載荷無來源可言，無條件掛 'synthetic' 屬冗餘標記。
      snapshot.marketEstimateSource =
        Object.keys(mainSiteState.marketItemValues ?? {}).length > 0 ? 'official' : 'synthetic';
      // #18（2026-08-31）：官方快取非空 ≠ 載荷全部官方——merged 以合成行情為基底、
      // 官方按物品覆蓋，官方 1 件 + 合成 871 件的混合載荷會被整體標 'official'，
      // 逐件真實來源丟失。載荷級標記為 official 且存在合成獨有物品時附
      // syntheticItemHrids 清單（app 側按 hrid 精確標註）；純 official / 純 synthetic
      // 載荷清單為空不掛（零體積增量，舊載荷向後相容）。
      // 【一般-5】（2026-09-02）：混合物品（官方僅覆蓋部分等級）的等級級來源由
      // syntheticLevelKeys 清單表達（僅列官方快取未覆蓋、由合成補齊的等級鍵），
      // app 側據此建立等級級來源覆蓋；非空才掛（舊版模擬器忽略未知欄位，向後相容）。
      if (snapshot.marketEstimateSource === 'official') {
        const syntheticOnlyItemHrids = collectSyntheticOnlyItemHrids(mergedMarketItemValues);
        if (syntheticOnlyItemHrids.length > 0) {
          snapshot.syntheticItemHrids = syntheticOnlyItemHrids;
        }
        const syntheticLevelKeys = collectSyntheticLevelKeys(mergedMarketItemValues);
        if (Object.keys(syntheticLevelKeys).length > 0) {
          snapshot.syntheticLevelKeys = syntheticLevelKeys;
        }
      }
    }
    snapshot.mainSiteCombat = mainSiteState.currentCombatAction
      ? {
          actionHrid: String(mainSiteState.currentCombatAction.actionHrid || ''),
          difficultyTier: normalizeDifficultyTier(mainSiteState.currentCombatAction.difficultyTier),
        }
      : null;
    return snapshot;
  }

  function buildCachedProfilePayload(profile, includeCurrentCombat = true, includeMarket = true) {
    if (!profile || typeof profile !== 'object') {
      return null;
    }

    const payload = {
      profile: clonePlainObject(profile),
    };

    if (includeMarket) {
      // N3（2026-08-31）：快取條目傳 includeMarket=false 剝離全量市場快照——
      // GM 儲存 50 條快取各自掛一份 merged 快照造成 ×50 冗餘序列化；快取條目的
      // marketItemValues 零消費方（讀取點只取 .profile 並在響應時重建載荷）。
      // 響應側（buildTeamMemberResponse 等）保持預設 true，透傳行為不變。
      const mergedMarketItemValues = getMergedMarketItemValues();
      if (Object.keys(mergedMarketItemValues).length > 0) {
        payload.marketItemValues = mergedMarketItemValues;
        // N5 來源標記：同 buildCurrentCharacterPayload——僅在載荷實際攜帶市場資料時
        // 掛載，空載荷無來源可言。
        payload.marketEstimateSource =
          Object.keys(mainSiteState.marketItemValues ?? {}).length > 0 ? 'official' : 'synthetic';
        // #18（2026-08-31）：同 buildCurrentCharacterPayload——混合載荷附合成獨有物品清單。
        // 【一般-5】（2026-09-02）：同上——混合物品的等級級來源清單（syntheticLevelKeys）。
        if (payload.marketEstimateSource === 'official') {
          const syntheticOnlyItemHrids = collectSyntheticOnlyItemHrids(mergedMarketItemValues);
          if (syntheticOnlyItemHrids.length > 0) {
            payload.syntheticItemHrids = syntheticOnlyItemHrids;
          }
          const syntheticLevelKeys = collectSyntheticLevelKeys(mergedMarketItemValues);
          if (Object.keys(syntheticLevelKeys).length > 0) {
            payload.syntheticLevelKeys = syntheticLevelKeys;
          }
        }
      }
    }

    if (includeCurrentCombat) {
      payload.mainSiteCombat = mainSiteState.currentCombatAction
        ? {
            actionHrid: String(mainSiteState.currentCombatAction.actionHrid || ''),
            difficultyTier: normalizeDifficultyTier(mainSiteState.currentCombatAction.difficultyTier),
          }
        : null;
    }

    return payload;
  }

  function sanitizeProfileCacheEntry(value) {
    const payload = value?.payload && typeof value.payload === 'object' ? value.payload : null;
    const profile =
      payload?.profile && typeof payload.profile === 'object'
        ? payload.profile
        : value?.profile && typeof value.profile === 'object'
          ? value.profile
          : null;
    if (!profile) {
      return null;
    }

    const characterId = String(value?.characterId || extractSharedProfileCharacterId(profile) || '').trim();
    const characterName = normalizeCharacterName(
      value?.characterName || profile?.sharableCharacter?.name || profile?.name || '',
    );
    if (!characterId && !characterName) {
      return null;
    }

    return {
      characterId,
      characterName,
      comparableCharacterName: normalizeComparableText(characterName),
      payload: buildCachedProfilePayload(profile, false, false),
      updatedAt: Number(value?.updatedAt || Date.now()),
    };
  }

  function loadProfileCacheEntries() {
    const rawValue = GM_getValue(PROFILE_CACHE_KEY, null);
    const rawEntries = Array.isArray(rawValue?.entries) ? rawValue.entries : Array.isArray(rawValue) ? rawValue : [];

    return rawEntries
      .map((entry) => sanitizeProfileCacheEntry(entry))
      .filter((entry) => entry && entry.payload)
      .sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))
      .slice(0, PROFILE_CACHE_LIMIT);
  }

  function persistProfileCacheEntry(profile) {
    const entry = sanitizeProfileCacheEntry({ profile, updatedAt: Date.now() });
    if (!entry) {
      return null;
    }

    const nextEntries = loadProfileCacheEntries().filter((candidate) => {
      if (entry.characterId && candidate.characterId) {
        return candidate.characterId !== entry.characterId;
      }

      if (entry.comparableCharacterName && candidate.comparableCharacterName) {
        return candidate.comparableCharacterName !== entry.comparableCharacterName;
      }

      return true;
    });

    nextEntries.unshift(entry);
    GM_setValue(PROFILE_CACHE_KEY, {
      entries: nextEntries.slice(0, PROFILE_CACHE_LIMIT).map((candidate) => ({
        characterId: candidate.characterId,
        characterName: candidate.characterName,
        updatedAt: candidate.updatedAt,
        payload: candidate.payload,
      })),
    });

    return entry;
  }

  function findCachedProfileEntry(characterId, characterName) {
    const normalizedCharacterId = String(characterId || '').trim();
    const comparableCharacterName = normalizeComparableText(characterName);
    const entries = loadProfileCacheEntries();

    if (normalizedCharacterId) {
      const exactIdMatch = entries.find((entry) => entry.characterId === normalizedCharacterId);
      if (exactIdMatch) {
        return exactIdMatch;
      }
    }

    if (!comparableCharacterName) {
      return null;
    }

    return entries.find((entry) => entry.comparableCharacterName === comparableCharacterName) || null;
  }

  function replaceConsumableSlotMaps(foodMap, drinkMap) {
    mainSiteState.actionTypeFoodSlotsMap = clonePlainObject(foodMap);
    mainSiteState.actionTypeDrinkSlotsMap = clonePlainObject(drinkMap);
  }

  function replaceCombatTriggerMaps(consumableMap, abilityMap) {
    mainSiteState.consumableCombatTriggersMap = clonePlainObject(consumableMap);
    mainSiteState.abilityCombatTriggersMap = clonePlainObject(abilityMap);
  }

  function updateCombatTriggerMap(message) {
    const triggerTypeHrid = String(message?.combatTriggerTypeHrid || '').trim();
    const combatTriggers = Array.isArray(message?.combatTriggers) ? message.combatTriggers : [];
    if (triggerTypeHrid === '/combat_trigger_types/consumable') {
      const itemHrid = String(message?.itemHrid || '').trim();
      if (itemHrid) {
        mainSiteState.consumableCombatTriggersMap[itemHrid] = JSON.parse(JSON.stringify(combatTriggers));
        mainSiteState.currentCharacterConsumableTriggersReady = true;
      }
      return;
    }

    if (triggerTypeHrid === '/combat_trigger_types/ability') {
      const abilityHrid = String(message?.abilityHrid || '').trim();
      if (abilityHrid) {
        mainSiteState.abilityCombatTriggersMap[abilityHrid] = JSON.parse(JSON.stringify(combatTriggers));
        mainSiteState.currentCharacterAbilityTriggersReady = true;
      }
    }
  }

  const MAIN_SITE_HOSTNAMES = new Set([
    'www.milkywayidle.com',
    'milkywayidle.com',
    'www.milkywayidlecn.com',
    'milkywayidlecn.com',
  ]);

  function isMainSitePage() {
    return MAIN_SITE_HOSTNAMES.has(
      String(window.location.hostname || '')
        .trim()
        .toLowerCase(),
    );
  }

  function isSimulatorPage() {
    const origin = window.location.origin;
    return (
      origin === 'https://azhu949.github.io' ||
      origin === 'https://mwi-combatsi-mulator.pages.dev' ||
      origin === 'http://localhost:5173' ||
      origin === 'http://127.0.0.1:5173'
    );
  }

  function normalizeUiLanguage(value) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (normalized.startsWith('zh')) {
      return 'zh';
    }
    if (normalized.startsWith('en')) {
      return 'en';
    }
    return '';
  }

  function resolveUiLanguage(preferredLanguage = '') {
    const explicitLanguage = normalizeUiLanguage(preferredLanguage);
    if (explicitLanguage) {
      return explicitLanguage;
    }

    try {
      const storedLanguage = normalizeUiLanguage(window.localStorage?.getItem('i18nextLng'));
      if (storedLanguage) {
        return storedLanguage;
      }
    } catch (_error) {}

    const documentLanguage = normalizeUiLanguage(document.documentElement?.lang);
    if (documentLanguage) {
      return documentLanguage;
    }

    // 專案預設語言為中文：非中/英環境（如 ja、fr 等）統一回退到 zh 而非 en。
    // 這是刻意行為（指令碼 UI 以中文為主），與 index.html 的 lang="zh" 保持一致。
    return normalizeUiLanguage(navigator.language) || 'zh';
  }

  function getUiText(key, preferredLanguage = '') {
    const language = resolveUiLanguage(preferredLanguage);
    return UI_TEXT[language]?.[key] || UI_TEXT.en[key] || '';
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isVisibleElement(element) {
    if (!element || !element.isConnected) {
      return false;
    }

    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    // 現代瀏覽器走原生 checkVisibility：一次呼叫遍歷祖先鏈，覆蓋 display:none、
    // visibility:hidden 以及自身或任一祖先 opacity 計算值為 0 的情況。
    // opacity 不繼承：動畫作用在包裝層（如 MUI Fade 的過渡 div）時，紙面/彈窗自身
    // opacity 仍為 1，只看自身的 getComputedStyle 會漏檢整條祖先鏈的 opacity: 0。
    // 有意不做閾值判定（如 < 0.5 視為不可見）：淡入動畫中間值（0 → 1）期間彈窗/選單
    // 會被誤殺導致掛載漏檢（G1 的冷卻重試不覆蓋此視窗）；淡出中間值（0.3）仍視為
    // 可見，代價僅是按鈕可能掛進正在消亡的彈窗（隨後隨彈窗拆除，自愈且影響輕微）。
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }

    // 舊瀏覽器回退：保持與快速路徑一致的語義。
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    for (let node = element; node; node = node.parentElement) {
      if (parseFloat(window.getComputedStyle(node).opacity) === 0) {
        return false;
      }
    }
    return true;
  }

  function getMainSiteNewsLabels() {
    return [UI_TEXT.en.mainSiteNews, UI_TEXT.zh.mainSiteNews].map((value) => normalizeText(value)).filter(Boolean);
  }

  function getElementSearchText(element) {
    if (!isDomElement(element)) {
      return '';
    }

    const values = [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title')];

    return normalizeText(values.filter((value) => String(value || '').trim()).join(' '));
  }

  function getElementSemanticText(element) {
    if (!isDomElement(element)) {
      return '';
    }

    const className = typeof element.className === 'string' ? element.className : element.getAttribute('class');

    const values = [
      element.tagName,
      element.getAttribute('role'),
      element.getAttribute('id'),
      className,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
    ];

    return normalizeText(values.filter((value) => String(value || '').trim()).join(' '));
  }

  function hasMainSiteNavigationContext(element) {
    if (!isDomElement(element)) {
      return false;
    }

    if (element.closest("nav, header, aside, [role='navigation'], [role='tablist'], [role='menu']")) {
      return true;
    }

    const semanticText = [getElementSemanticText(element), getElementSemanticText(element.parentElement)]
      .filter(Boolean)
      .join(' ');

    return /(^|[\s_-])(nav|menu|sidebar|drawer|tab|tabs|toolbar)([\s_-]|$)/.test(semanticText);
  }

  function getMainSiteMenuItemElement(element) {
    if (!isDomElement(element)) {
      return null;
    }

    const interactiveAncestor = element.closest(
      "a, button, [role='button'], [role='link'], [role='tab'], [role='menuitem']",
    );
    if (interactiveAncestor && isVisibleElement(interactiveAncestor)) {
      return interactiveAncestor;
    }

    return isVisibleElement(element) ? element : null;
  }

  function scoreMainSiteNewsCandidate(menuItem, text, labels) {
    const rect = menuItem.getBoundingClientRect();
    const roleText = normalizeText(menuItem.getAttribute('role'));
    const semanticText = [
      getElementSemanticText(menuItem),
      getElementSemanticText(menuItem.parentElement),
      getElementSemanticText(
        menuItem.closest("nav, header, aside, [role='navigation'], [role='tablist'], [role='menu']"),
      ),
    ]
      .filter(Boolean)
      .join(' ');

    let score = 0;
    if (/^(A|BUTTON)$/.test(menuItem.tagName)) {
      score += 120;
    }
    if (/(^|[\s_-])(button|link|tab|menuitem)([\s_-]|$)/.test(`${roleText} ${semanticText}`)) {
      score += 80;
    }
    if (hasMainSiteNavigationContext(menuItem)) {
      score += 160;
    }
    if (labels.includes(text)) {
      score += 60;
    }
    if (rect.width >= 36) {
      score += 20;
    }
    if (rect.width >= 60 && rect.width < 140) {
      score += 35;
    } else if (rect.width >= 140 && rect.width < 320) {
      score += 20;
    }
    if (rect.height >= 20 && rect.height <= 112) {
      score += 30;
    }
    if (rect.top >= 0 && rect.top < Math.max(window.innerHeight * 0.65, 320)) {
      score += 20;
    }
    if (rect.width > Math.max(window.innerWidth * 0.8, 480)) {
      score -= 120;
    }
    if (rect.height > 140) {
      score -= 120;
    }

    return { rect, score };
  }

  function textMatchesLabel(text, labels) {
    const normalized = normalizeText(text);
    return labels.some(
      (label) =>
        normalized === label ||
        normalized.startsWith(`${label} `) ||
        normalized.endsWith(` ${label}`) ||
        normalized.includes(` ${label} `),
    );
  }

  function detectMainSiteMenuLanguage(referenceItem) {
    const text = normalizeText(referenceItem?.textContent);
    if (textMatchesLabel(text, [normalizeText(UI_TEXT.zh.mainSiteNews)])) {
      return 'zh';
    }
    if (textMatchesLabel(text, [normalizeText(UI_TEXT.en.mainSiteNews)])) {
      return 'en';
    }
    return resolveUiLanguage();
  }

  function updateShortcutLabel(root, nextLabel) {
    const newsLabels = [UI_TEXT.en.mainSiteNews, UI_TEXT.zh.mainSiteNews];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let didReplace = false;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const currentValue = String(node.nodeValue || '');
      if (!currentValue.trim()) {
        continue;
      }

      let nextValue = currentValue;
      for (const label of newsLabels) {
        nextValue = nextValue.replace(label, nextLabel);
      }

      if (nextValue !== currentValue) {
        node.nodeValue = nextValue;
        didReplace = true;
      }
    }

    if (!didReplace) {
      const textContainer = root.querySelector('span, div, p') || root;
      textContainer.appendChild(document.createTextNode(nextLabel));
    }
  }

  function findMainSiteNewsMenuItem() {
    const newsLabels = getMainSiteNewsLabels();
    const dedupedCandidates = new Map();

    for (const element of Array.from(
      document.querySelectorAll("a, button, [role='button'], [role='link'], [role='tab'], [role='menuitem'], div"),
    )) {
      if (!isVisibleElement(element)) {
        continue;
      }

      const menuItem = getMainSiteMenuItemElement(element);
      if (!menuItem || !menuItem.parentElement) {
        continue;
      }

      const text = getElementSearchText(menuItem) || getElementSearchText(element);
      if (!text || !textMatchesLabel(text, newsLabels)) {
        continue;
      }

      const { rect, score } = scoreMainSiteNewsCandidate(menuItem, text, newsLabels);
      if (rect.width < 28 || rect.height < 18) {
        continue;
      }

      const existingCandidate = dedupedCandidates.get(menuItem);
      if (!existingCandidate || score > existingCandidate.score) {
        dedupedCandidates.set(menuItem, {
          menuItem,
          rect,
          score,
        });
      }
    }

    const bestCandidate = Array.from(dedupedCandidates.values()).sort(
      (left, right) =>
        right.score - left.score ||
        left.rect.top - right.rect.top ||
        left.rect.left - right.rect.left ||
        left.menuItem.querySelectorAll('*').length - right.menuItem.querySelectorAll('*').length,
    )[0];

    return bestCandidate?.menuItem || null;
  }

  function openSimulatorPage(preferredLanguage = '') {
    if (!document?.body) {
      window.open(SIMULATOR_FALLBACK_URL, '_blank', 'noopener,noreferrer');
      return;
    }

    const existingModal = document.getElementById(SIMULATOR_MIRROR_MODAL_ID);
    if (existingModal && existingModal.isConnected) {
      const preferredButton = existingModal.querySelector('[data-mwi-tm-mirror="cloudflare"]');
      if (preferredButton && typeof preferredButton.focus === 'function') {
        preferredButton.focus();
      }
      return;
    }

    const previousFocus = document.activeElement;
    const titleId = `${SIMULATOR_MIRROR_MODAL_ID}-title`;
    const descriptionId = `${SIMULATOR_MIRROR_MODAL_ID}-desc`;

    const overlay = document.createElement('div');
    overlay.id = SIMULATOR_MIRROR_MODAL_ID;
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '24px';
    overlay.style.background = 'rgba(2, 6, 23, 0.72)';
    overlay.style.backdropFilter = 'blur(8px)';
    overlay.style.WebkitBackdropFilter = 'blur(8px)';
    overlay.style.boxSizing = 'border-box';

    function closeModal() {
      document.removeEventListener('keydown', handleKeydown, true);
      overlay.remove();
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
    }

    function handleKeydown(event) {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    }

    document.addEventListener('keydown', handleKeydown, true);
    overlay.addEventListener('click', (event) => {
      if (event.target !== overlay) {
        return;
      }
      closeModal();
    });

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.setAttribute('aria-describedby', descriptionId);
    dialog.style.width = 'min(460px, 100%)';
    dialog.style.borderRadius = '16px';
    dialog.style.padding = '18px 18px 14px';
    dialog.style.background = 'linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.92))';
    dialog.style.border = '1px solid rgba(148, 163, 184, 0.22)';
    dialog.style.boxShadow = '0 24px 80px rgba(0, 0, 0, 0.65)';
    dialog.style.color = '#e2e8f0';
    dialog.style.boxSizing = 'border-box';
    dialog.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'flex-start';
    header.style.justifyContent = 'space-between';
    header.style.gap = '12px';

    const title = document.createElement('div');
    title.id = titleId;
    title.textContent = getUiText('mirrorModalTitle', preferredLanguage);
    title.style.fontSize = '16px';
    title.style.fontWeight = '750';
    title.style.letterSpacing = '0.01em';
    title.style.lineHeight = '1.25';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', getUiText('mirrorModalCancel', preferredLanguage));
    closeButton.style.border = '1px solid rgba(148, 163, 184, 0.22)';
    closeButton.style.background = 'rgba(30, 41, 59, 0.48)';
    closeButton.style.color = '#e2e8f0';
    closeButton.style.width = '34px';
    closeButton.style.height = '34px';
    closeButton.style.borderRadius = '12px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.display = 'inline-flex';
    closeButton.style.alignItems = 'center';
    closeButton.style.justifyContent = 'center';
    closeButton.style.fontSize = '20px';
    closeButton.style.lineHeight = '1';
    closeButton.style.padding = '0';
    closeButton.style.flexShrink = '0';
    closeButton.addEventListener('click', closeModal);

    const description = document.createElement('div');
    description.id = descriptionId;
    description.textContent = getUiText('mirrorModalDescription', preferredLanguage);
    description.style.marginTop = '8px';
    description.style.fontSize = '13px';
    description.style.color = 'rgba(148, 163, 184, 0.95)';
    description.style.lineHeight = '1.45';

    const options = document.createElement('div');
    options.style.display = 'grid';
    options.style.gap = '10px';
    options.style.marginTop = '16px';

    function createOptionButton({ id, label, url, accentColor }) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-mwi-tm-mirror', id);
      button.style.width = '100%';
      button.style.textAlign = 'left';
      button.style.cursor = 'pointer';
      button.style.border = `1px solid ${accentColor}`;
      button.style.background = 'rgba(2, 6, 23, 0.25)';
      button.style.borderRadius = '14px';
      button.style.padding = '12px 12px';
      button.style.display = 'flex';
      button.style.alignItems = 'center';
      button.style.justifyContent = 'space-between';
      button.style.gap = '12px';
      button.style.color = '#e2e8f0';
      button.style.boxShadow = 'inset 0 1px 0 rgba(255, 255, 255, 0.04)';
      button.style.transition = 'transform 80ms ease, background 120ms ease, border-color 120ms ease';
      button.addEventListener('mouseenter', () => {
        button.style.background = 'rgba(30, 41, 59, 0.45)';
        button.style.transform = 'translateY(-1px)';
        button.style.borderColor = accentColor;
      });
      button.addEventListener('mouseleave', () => {
        button.style.background = 'rgba(2, 6, 23, 0.25)';
        button.style.transform = '';
        button.style.borderColor = accentColor;
      });
      button.addEventListener('click', () => {
        window.open(url, '_blank', 'noopener,noreferrer');
        closeModal();
      });

      const labelBlock = document.createElement('div');
      labelBlock.style.display = 'flex';
      labelBlock.style.flexDirection = 'column';
      labelBlock.style.gap = '4px';
      labelBlock.style.minWidth = '0';

      const labelRow = document.createElement('div');
      labelRow.textContent = label;
      labelRow.style.fontSize = '14px';
      labelRow.style.fontWeight = '750';
      labelRow.style.letterSpacing = '0.01em';
      labelRow.style.color = '#e2e8f0';

      const urlRow = document.createElement('div');
      urlRow.textContent = url.replace(/^https?:\/\//, '');
      urlRow.style.fontSize = '12px';
      urlRow.style.color = 'rgba(148, 163, 184, 0.95)';
      urlRow.style.overflow = 'hidden';
      urlRow.style.textOverflow = 'ellipsis';
      urlRow.style.whiteSpace = 'nowrap';

      labelBlock.appendChild(labelRow);
      labelBlock.appendChild(urlRow);

      const arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↗';
      arrow.style.fontSize = '16px';
      arrow.style.fontWeight = '700';
      arrow.style.color = accentColor;
      arrow.style.flexShrink = '0';

      button.appendChild(labelBlock);
      button.appendChild(arrow);
      return button;
    }

    const cloudflareButton = createOptionButton({
      id: 'cloudflare',
      label: getUiText('mirrorModalCloudflare', preferredLanguage),
      url: SIMULATOR_CLOUDFLARE_URL,
      accentColor: 'rgba(249, 115, 22, 0.72)',
    });

    const githubButton = createOptionButton({
      id: 'github',
      label: getUiText('mirrorModalGithub', preferredLanguage),
      url: SIMULATOR_GITHUB_PAGES_URL,
      accentColor: 'rgba(56, 189, 248, 0.78)',
    });

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '10px';
    footer.style.marginTop = '14px';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = getUiText('mirrorModalCancel', preferredLanguage);
    cancelButton.style.cursor = 'pointer';
    cancelButton.style.border = '1px solid rgba(148, 163, 184, 0.22)';
    cancelButton.style.background = 'rgba(30, 41, 59, 0.25)';
    cancelButton.style.color = '#e2e8f0';
    cancelButton.style.borderRadius = '12px';
    cancelButton.style.padding = '10px 14px';
    cancelButton.style.fontSize = '13px';
    cancelButton.style.fontWeight = '700';
    cancelButton.addEventListener('click', closeModal);

    header.appendChild(title);
    header.appendChild(closeButton);

    options.appendChild(cloudflareButton);
    options.appendChild(githubButton);

    footer.appendChild(cancelButton);

    dialog.appendChild(header);
    dialog.appendChild(description);
    dialog.appendChild(options);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    window.setTimeout(() => {
      cloudflareButton.focus();
    }, 0);
  }

  function createMainSiteShortcutIcon() {
    const iconWrapper = document.createElement('span');
    iconWrapper.setAttribute('aria-hidden', 'true');
    iconWrapper.style.display = 'inline-flex';
    iconWrapper.style.alignItems = 'center';
    iconWrapper.style.justifyContent = 'center';
    iconWrapper.style.width = '24px';
    iconWrapper.style.height = '24px';
    iconWrapper.style.flexShrink = '0';
    iconWrapper.style.borderRadius = '7px';
    iconWrapper.style.background = 'linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(20, 184, 166, 0.14))';
    iconWrapper.style.boxShadow = 'inset 0 0 0 1px rgba(103, 232, 249, 0.22)';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', '#67e8f9');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    for (const attrs of [
      { cx: '12', cy: '12', r: '4.5' },
      { d: 'M12 2.75V5.5' },
      { d: 'M12 18.5v2.75' },
      { d: 'M2.75 12H5.5' },
      { d: 'M18.5 12h2.75' },
      { d: 'M5.9 5.9l1.95 1.95' },
      { d: 'M16.15 16.15l1.95 1.95' },
      { d: 'M18.1 5.9l-1.95 1.95' },
      { d: 'M7.85 16.15 5.9 18.1' },
    ]) {
      const element = attrs.cx ? document.createElementNS(svgNS, 'circle') : document.createElementNS(svgNS, 'path');
      for (const [key, value] of Object.entries(attrs)) {
        element.setAttribute(key, value);
      }
      svg.appendChild(element);
    }

    iconWrapper.appendChild(svg);
    return iconWrapper;
  }

  function createMainSiteShortcutLabel(preferredLanguage) {
    const label = document.createElement('span');
    label.textContent = getUiText('mainSiteShortcut', preferredLanguage);
    label.style.color = '#fbbf24';
    label.style.fontWeight = '700';
    label.style.letterSpacing = '0.01em';
    label.style.textShadow = '0 0 10px rgba(251, 191, 36, 0.16)';
    return label;
  }

  function isCompactMainSiteMenuItem(referenceItem) {
    if (!isVisibleElement(referenceItem)) {
      return false;
    }

    const rect = referenceItem.getBoundingClientRect();
    return rect.width > 0 && rect.width < 120;
  }

  function createMainSiteShortcut(referenceItem) {
    const shortcut = referenceItem.cloneNode(true);
    const preferredLanguage = detectMainSiteMenuLanguage(referenceItem);
    const compactLayout = isCompactMainSiteMenuItem(referenceItem);

    shortcut.id = MAIN_SITE_SHORTCUT_ID;
    shortcut.setAttribute('data-mwi-tm-main-shortcut', 'simulator');
    shortcut.removeAttribute('aria-current');
    shortcut.setAttribute('aria-label', getUiText('mainSiteShortcut', preferredLanguage));
    shortcut.title = getUiText('mainSiteShortcutTitle', preferredLanguage);
    shortcut.style.textDecoration = 'none';

    shortcut.querySelectorAll('[id]').forEach((element) => {
      element.removeAttribute('id');
    });

    if (shortcut.tagName === 'A') {
      shortcut.href = SIMULATOR_FALLBACK_URL;
      shortcut.target = '_blank';
      shortcut.rel = 'noopener noreferrer';
      shortcut.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSimulatorPage(preferredLanguage);
      });
      shortcut.addEventListener('keydown', (event) => {
        if (event.key !== ' ') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openSimulatorPage(preferredLanguage);
      });
    } else {
      shortcut.setAttribute('role', 'link');
      shortcut.tabIndex = 0;
      shortcut.style.cursor = 'pointer';
      shortcut.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSimulatorPage(preferredLanguage);
      });
      shortcut.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openSimulatorPage(preferredLanguage);
      });
    }

    shortcut.replaceChildren();

    const content = document.createElement('span');
    content.style.display = 'flex';
    content.style.alignItems = 'center';
    content.style.justifyContent = compactLayout ? 'center' : 'flex-start';
    content.style.gap = compactLayout ? '0' : '12px';
    content.style.width = '100%';
    content.style.minWidth = '0';

    const icon = createMainSiteShortcutIcon();

    content.appendChild(icon);
    if (!compactLayout) {
      const label = createMainSiteShortcutLabel(preferredLanguage);
      content.appendChild(label);
    }
    shortcut.appendChild(content);
    return shortcut;
  }

  function mountMainSiteSimulatorShortcut() {
    const existingShortcut = document.getElementById(MAIN_SITE_SHORTCUT_ID);
    if (existingShortcut && existingShortcut.isConnected) {
      return;
    }

    const referenceItem = findMainSiteNewsMenuItem();
    if (!referenceItem || !referenceItem.parentElement) {
      return;
    }

    const shortcut = createMainSiteShortcut(referenceItem);
    referenceItem.parentElement.insertBefore(shortcut, referenceItem);
  }

  function initMainSiteSimulatorShortcut() {
    const observer = new MutationObserver(() => {
      mountMainSiteSimulatorShortcut();
    });

    function attachObserver() {
      mountMainSiteSimulatorShortcut();
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', attachObserver, { once: true });
    } else {
      attachObserver();
    }
  }

  // —— 純決策函式（可注入 vm 沙箱單測，見 scripts/__tests__/mwi-main-site-import.test.js）——
  //
  // pickBestProfileDialogCandidate：從掃描候選（{ element, area, hasTablist }）中選出目標
  // 彈窗。資料彈窗通常帶 tablist（角色/技能/裝備等頁籤），優先選擇含 tablist 的候選；
  // 同組內再按面積降序，避免被更大的非資料彈窗（設定彈窗、確認框）搶佔。
  function pickBestProfileDialogCandidate(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }
    return [...candidates].sort((left, right) => {
      if (left.hasTablist !== right.hasTablist) {
        return left.hasTablist ? -1 : 1;
      }
      return right.area - left.area;
    })[0];
  }

  // resolveProfileCopyMountAction：把「按鈕狀態 + 分享快照 + 掃描到的彈窗」對映為動作。
  //   keep          —— 按鈕已掛載（呼叫方直接返回，不掃描）
  //   skip          —— 無分享快照（呼叫方直接返回，不掃描——保持懶掃描語義）
  //   arm-cooldown  —— 無彈窗、或彈窗名字校驗失敗（呼叫方武裝冷卻並返回）
  //   mount         —— 校驗通過（呼叫方繼續掛載流程）
  function resolveProfileCopyMountAction({ hasConnectedButton, profile, dialog }) {
    if (hasConnectedButton) {
      return { action: 'keep' };
    }
    if (!profile || typeof profile !== 'object') {
      return { action: 'skip' };
    }
    if (!dialog) {
      return { action: 'arm-cooldown' };
    }
    if (!isLikelyProfileDialog(dialog, profile)) {
      return { action: 'arm-cooldown' };
    }
    return { action: 'mount' };
  }

  // resolveProfileDialogScanGate：冷卻狀態機。返回 'cooling'（冷卻中，retryAfterMs 後應
  // 排程一次兜底重試，對應「冷卻視窗吞掉彈窗開啟事件」的修復）或 'scan'（可執行掃描）。
  function resolveProfileDialogScanGate(now, cooldownUntil) {
    if (now < cooldownUntil) {
      return { state: 'cooling', retryAfterMs: cooldownUntil - now };
    }
    return { state: 'scan' };
  }

  // 在主站「玩家資料彈窗」裡注入「複製角色資料」按鈕，把該玩家的分享資料
  // 複製為 JSON，供模擬器「匯入匯出」彈窗貼上匯入（Solo Import To Player）。
  function findOpenProfileDialog() {
    // 5 組選擇器合併為單條組合選擇器：單次 querySelectorAll 即返回全部候選（去重文件序），
    // 與逐組遍歷 + seen 去重得到相同候選集合。分享啟用 + 彈窗未開期間每 500ms 一次掃描
    // （冷卻節流），主站 DOM 高頻變化時把每次掃描的 5 次全文件遍歷收斂為 1 次。
    // 注意：此處可安全合併（候選最終統一排序）；findProfileTablist / findCloseButtonWithin
    // 的組順序帶優先順序語義（返回第一個命中），保持逐組查詢。
    const selectors = [
      "[role='dialog'], [role='alertdialog'], [class*='modal' i], [class*='dialog' i], [class*='overlay' i]",
    ];
    const debug = shouldInstallDebugInterface();
    const candidates = [];
    const seen = new Set();
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        if (!isVisibleElement(element)) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        // 尺寸判定用佈局尺寸（offsetWidth/offsetHeight）而非視口裁剪後的 rect：
        // 彈窗在滾動容器內部分滾出視口時，rect 寬高會被裁剪而誤判為過小。
        // isVisibleElement 已過濾 display:none 等不可見元素，offsetWidth 為 0 的
        // 可見元素（空佈局）本就應跳過。
        const layoutWidth = element.offsetWidth || rect.width;
        const layoutHeight = element.offsetHeight || rect.height;
        if (layoutWidth < 240 || layoutHeight < 160) {
          continue;
        }

        const role = String(element.getAttribute?.('role') || '').toLowerCase();
        const isRoleDialog = role === 'dialog' || role === 'alertdialog';
        // 近全屏判定同樣用佈局尺寸：彈窗在滾動容器內部分滾出視口時，rect 會被裁剪，
        // 全屏遮罩可能因此漏判而未被跳過（與上方尺寸判定保持一致）。
        const isNearFullscreen =
          viewportWidth > 0 &&
          layoutWidth > viewportWidth * 0.98 &&
          viewportHeight > 0 &&
          layoutHeight > viewportHeight * 0.98;

        // 跳過全屏遮罩，讓按鈕落在內層的資料面板上；但近全屏的 role=dialog/alertdialog
        // 是真正的資料彈窗（移動端/最大化），不應被當作遮罩排除。
        if (isNearFullscreen && !isRoleDialog) {
          if (debug) {
            console.debug('[mwi-tm] findOpenProfileDialog: skip fullscreen overlay', element);
          }
          continue;
        }

        candidates.push({
          element,
          area: layoutWidth * layoutHeight,
          hasTablist: Boolean(findProfileTablist(element)),
        });
      }
    }

    const bestCandidate = pickBestProfileDialogCandidate(candidates);
    if (debug) {
      console.debug(
        '[mwi-tm] findOpenProfileDialog: candidates',
        candidates.map((entry) => ({
          tag: entry.element.tagName,
          role: String(entry.element.getAttribute?.('role') || ''),
          area: entry.area,
        })),
      );
    }
    return bestCandidate?.element || null;
  }

  function findCloseButtonWithin(dialog) {
    if (!dialog) {
      return null;
    }
    const selectors = [
      "[class*='closeButton' i]",
      "[class*='close-button' i]",
      "[class*='close' i][role='button']",
      "button[aria-label*='close' i]",
      "button[aria-label*='關閉' i]",
      "[aria-label*='關閉' i]",
    ];
    const seen = new Set();
    for (const selector of selectors) {
      for (const element of dialog.querySelectorAll(selector)) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        if (isVisibleElement(element)) {
          return element;
        }
      }
    }
    return null;
  }

  function findProfileTablist(dialog) {
    if (!dialog) {
      return null;
    }
    const selectors = [
      "[role='tablist']",
      "[class*='tabsContainer' i]",
      "[class*='tabs-container' i]",
      "[class*='flexContainer' i]",
      "[class*='tabList' i]",
      "[class*='tab-list' i]",
    ];
    for (const selector of selectors) {
      for (const element of dialog.querySelectorAll(selector)) {
        if (!isVisibleElement(element)) {
          continue;
        }
        // role=tablist 本身即 tab 語義；class 回退（含寬泛的 flexContainer）必須
        // 含 tab 語義元素才認可，避免把操作欄/頁尾等普通 flex 容器誤當作 tablist。
        // 用 :scope > 限定直接子元素：若內層嵌套了真正的 tablist（tablist 是其
        // 子元素），外層容器不會被後代查詢誤判，按鈕仍追加到內層 tablist 行內末尾。
        const isSemanticTablist = element.getAttribute?.('role') === 'tablist';
        const hasTabSemantics = Boolean(element.querySelector(":scope > [role='tab'], :scope > [aria-selected]"));
        if (isSemanticTablist || hasTabSemantics) {
          return element;
        }
      }
    }
    return null;
  }

  // 有選擇地讀取真實 tab 的計算樣式作為按鈕基線：只取「外觀尺寸/字型/圓角/字距」等安全
  // 屬性，不迭代全部計算屬性——站點 tab 雜湊類裡常有 flex:1 1 0%（等寬分欄）、
  // overflow:hidden、text-overflow:ellipsis 等佈局屬性，整份複製會把按鈕壓成與 tab 等寬的
  // 窄條，「複製角色資料」這類更長的文字會被裁掉。letter-spacing 需顯式帶上：tab 雜湊類
  // 若覆蓋了字距，預設會退化為 MUI 預設 0.02857em，與真實 tab 產生細微字距差異。
  function readTabComputedStyles(tablist) {
    const tab = tablist ? tablist.querySelector("button, [role='tab']") : null;
    if (!tab) {
      return null;
    }
    const cs = window.getComputedStyle(tab);
    return {
      'min-height': cs.minHeight,
      'min-width': cs.minWidth,
      padding: cs.padding,
      margin: cs.margin,
      'font-size': cs.fontSize,
      'font-weight': cs.fontWeight,
      'font-family': cs.fontFamily,
      'line-height': cs.lineHeight,
      'letter-spacing': cs.letterSpacing,
      'border-radius': cs.borderRadius,
    };
  }

  function setProfileCopyButtonFeedback(button, feedbackKey) {
    if (button._mwiTmProfileCopyTimer) {
      window.clearTimeout(button._mwiTmProfileCopyTimer);
      button._mwiTmProfileCopyTimer = null;
    }
    button.textContent = getUiText(feedbackKey);
    button._mwiTmProfileCopyTimer = window.setTimeout(() => {
      button._mwiTmProfileCopyTimer = null;
      if (button.isConnected) {
        button.textContent = getUiText('copyProfileButton');
      }
    }, 1600);
  }

  function formatUiText(template, replacements) {
    let result = String(template || '');
    for (const [key, value] of Object.entries(replacements || {})) {
      result = result.split(`{${key}}`).join(String(value));
    }
    return result;
  }

  // 分享彈窗「複製角色資料」的匯出載荷：只透傳角色資料本身，不攜帶市場資料。
  // 歷史：早期版本直接 JSON.stringify(profile)（無市場欄位）→ 第 11 輪起在此合併
  // marketItemValues + mwiMarketDiag → 第 19 輪改回乾淨載荷（通道分離）、第 20 輪
  // 拆除全部診斷設施：分享彈窗「複製角色資料」= 純角色資料；模擬器頁「從主站匯入」
  // 按鈕攜帶全量市場資料（buildCurrentCharacterPayload / buildCachedProfilePayload），
  // 故需要資產分與 MWITools 對齊時請用「從主站匯入」按鈕，而非複製貼上。
  // 模擬站貼上匯入對無市場欄位的 payload 保持相容（marketItemValues: null，UI 顯示
  // 「官方估值：0 個物品」，屬預期現象而非異常）。
  function buildProfileExportPayload(profile) {
    return { ...profile };
  }

  // 橋接匯入成功後的狀態列補充文案：數匯入載荷頂層實際攜帶的官方估值物品數。
  // 必須傳載荷而不是數本頁快取——模擬器頁尾本例項與主站不同源，本頁 merged 快取
  // 恆為空（localStorage 不互通、主站 WS 也不經過本頁），數本地必然誤報 0；
  // 真正的透傳資料在主站頁構建的 payload.marketItemValues 裡。
  // 歷史：曾有「無參時數本頁 merged 快取」的分支（本想供主站頁橋接狀態使用），
  // 但主站頁從未呼叫過它，屬於死程式碼，第 21 輪拆除。
  function describeMarketItemValuesStatus(payload) {
    const itemCount = Object.keys(payload?.marketItemValues ?? {}).length;
    if (itemCount <= 0) {
      return getUiText('marketValuesStatusEmpty');
    }
    // #18（2026-08-31）：混合載荷——載荷級標記 'official' 但附 syntheticItemHrids 清單
    // （官方與合成中價並存）時如實分列計數；把合成部分混入「官方估值已透傳」正是
    // 混合載荷逐件真值丟失的使用者面失真。標記本身為 'synthetic' 時全部物品均為合成、
    // 清單冗餘（矛盾載荷）不進入混合分支。
    const syntheticItemHrids = Array.isArray(payload?.syntheticItemHrids) ? payload.syntheticItemHrids : [];
    if (payload?.marketEstimateSource !== 'synthetic' && syntheticItemHrids.length > 0) {
      return formatUiText(getUiText('marketValuesStatusMixed'), {
        officialCount: Math.max(0, itemCount - syntheticItemHrids.length),
        syntheticCount: syntheticItemHrids.length,
      });
    }
    // 合成中價兜底場景：載荷非空但官方估算缺位（LS 空 + WS 未推），如實標註來源，
    // 避免使用者把合成中價（與官方估算差約 4-5%）誤當官方估算對賬（N5，2026-08-31）。
    // 舊載荷/複製貼上載荷無 marketEstimateSource 欄位時落 official 分支（向後相容）。
    if (payload?.marketEstimateSource === 'synthetic') {
      return formatUiText(getUiText('marketValuesStatusSynthetic'), { count: itemCount });
    }
    return formatUiText(getUiText('marketValuesStatusReady'), { count: itemCount });
  }

  // 迷宮商店升級等級的覆蓋提示（2026-09-16）：等級是破壞性整包覆蓋欄位——主站角色
  // 未購買任何升級（characterInfo 全 0）時匯入會把使用者在模擬器裡手填的等級整包清零，
  // 而匯入反饋此前只報格式與官方估值計數 ⇒ 配置無聲消失。摘要由 app 側 mapper 單點
  // 判定（src/services/importExportMapper.js describeLabyrinthUpgradesImport，隨橋接響應
  // labyrinthUpgradesImport 回傳，見 HomePage.vue），此處只做本地化措辭——禁止在本指令碼
  // 重算 characterInfo（重複口徑遲早與匯入門口徑分叉，與「目錄 key 單點維護」同一教訓）。
  // 未攜帶（null/缺失 = 載荷無 characterInfo，等級保持原樣）或覆蓋前後一致
  //（changed=false）時返回空串（呼叫方過濾空段），避免每次匯入都刷同一行噪音；
  // 清零單獨措辭：那是使用者最需要當場知道的一類覆蓋。
  // 注意：估值句 describeMarketItemValuesStatus 恆 zh 是既有行為（不在本次改動內）。
  function describeLabyrinthUpgradesStatus(labyrinthUpgradesImport, preferredLanguage = '') {
    const info =
      labyrinthUpgradesImport && typeof labyrinthUpgradesImport === 'object' ? labyrinthUpgradesImport : null;
    if (!info || info.changed !== true) {
      return '';
    }

    if (info.cleared === true) {
      return formatUiText(getUiText('labyrinthUpgradesStatusCleared', preferredLanguage), {
        previous: Math.max(0, Number(info.previousLevelCount) || 0),
      });
    }

    return formatUiText(getUiText('labyrinthUpgradesStatusApplied', preferredLanguage), {
      count: Math.max(0, Number(info.levelCount) || 0),
      previous: Math.max(0, Number(info.previousLevelCount) || 0),
    });
  }

  // 團隊匯入逐 member 累積迷宮商店升級覆蓋摘要（2026-09-16）。
  // 為什麼必須「保留最近一次非空摘要」而不是直接取最後一個成員：團隊裡只有**當前角色
  // member** 的載荷攜帶 characterInfo（buildTeamMemberResponse 的 isCurrent 分支走
  // buildCurrentMainSiteResponse → 模擬器側整包覆蓋等級），其餘 member 是快取分享檔
  // （format 'shareable-profile' → 模擬器側保留現有等級，摘要為 null）。而當前角色通常
  // 不是最後一個成功匯入的成員 ⇒ 若用「最後一個成員的結果」覆蓋，清理提示會被 null 沖掉，
  // 團隊匯入重新變成「配置無聲消失」。因至多一個 member 攜帶 characterInfo，最近一次非空
  // 摘要恰好就是那次有效寫入，且其 changed 是對「匯入前」狀態算的 ⇒ 聚合語義準確。
  function mergeLabyrinthUpgradesImportSummary(currentSummary, nextSummary) {
    return nextSummary || currentSummary || null;
  }

  // 單人匯入成功反饋文案拼接（#22 同款：把接線可測化）。段序固定為
  // 成功文案 → 官方估值計數 → 迷宮商店升級覆蓋提示；空段被過濾，
  // 無覆蓋提示時輸出與舊實現（`${importSuccess} ${marketValuesStatus}`）逐位元組一致。
  function buildSingleImportFeedbackText({ uiLanguage, payload, labyrinthUpgradesImport }) {
    return [
      getUiText('importSuccess', uiLanguage),
      describeMarketItemValuesStatus(payload),
      describeLabyrinthUpgradesStatus(labyrinthUpgradesImport, uiLanguage),
    ]
      .filter(Boolean)
      .join(' ');
  }

  // 團隊匯入成功反饋文案拼接（#22 從深層閉包 importTeamMainSiteResponse 提取為頂層
  // 可注入純函式，使該接線可用行為斷言測試，替代鎖原始碼字串的 scriptSource.toContain）：
  // summary 為空 = 全部成功（importSuccess + 估值文案）；非空 = 部分成功
  //（匯入完成/Import finished + summary + 估值文案）。firstSuccessPayload 取任一
  // 成功 member 載荷即可（各 member 掛同一份 merged 快照）。
  // labyrinthUpgradesImport 由呼叫方用 mergeLabyrinthUpgradesImportSummary 累積得到
  //（團隊裡只有當前角色 member 的載荷攜帶等級，其餘 member 的摘要為 null，不能被沖掉）。
  function buildTeamImportFeedbackText({ uiLanguage, summary, firstSuccessPayload, labyrinthUpgradesImport = null }) {
    const marketValuesStatusText = describeMarketItemValuesStatus(firstSuccessPayload);
    const labyrinthUpgradesStatusText = describeLabyrinthUpgradesStatus(labyrinthUpgradesImport, uiLanguage);
    const baseText = summary
      ? uiLanguage === 'zh'
        ? `匯入完成：${summary}`
        : `Import finished: ${summary}`
      : getUiText('importSuccess', uiLanguage);

    return [baseText, marketValuesStatusText, labyrinthUpgradesStatusText].filter(Boolean).join(' ');
  }

  // 團隊匯入部分成功摘要拼裝（#22 P3① 從深層閉包 importTeamMainSiteResponse 提取為
  // 頂層可注入純函式，配合 buildTeamImportFeedbackText 一併行為測試）：失敗 >0 時返回
  // 「成功 N 人，失敗 N 人（預覽…）」；無失敗返回空串。uiLanguage 由呼叫方傳入
  //（原實現讀深層閉包 state.uiLanguage）。
  function formatTeamImportSummary(successCount, failureEntries = [], uiLanguage = 'zh') {
    const failures = Array.isArray(failureEntries) ? failureEntries : [];
    const failedCount = failures.length;
    if (failedCount <= 0) {
      return '';
    }

    const preview = failures
      .slice(0, 2)
      .map((entry) => {
        const name = normalizeCharacterName(entry?.name || '') || '-';
        const message = normalizeCharacterName(entry?.message || '') || getUiText('importFailed', uiLanguage);
        return `${name}: ${message}`;
      })
      .join(uiLanguage === 'zh' ? '；' : '; ');

    const suffix =
      failedCount > 2 ? (uiLanguage === 'zh' ? `……另有 ${failedCount - 2} 個失敗` : `… +${failedCount - 2} more`) : '';

    if (uiLanguage === 'zh') {
      return `成功 ${successCount} 人，失敗 ${failedCount} 人（${preview}${suffix}）。`;
    }

    return `${successCount} succeeded, ${failedCount} failed (${preview}${suffix}).`;
  }

  function copyTextViaExecCommand(text) {
    // 防禦：指令碼 @run-at document-start 時 body 可能尚不存在；按鈕點選路徑下
    // body 必然存在，但獨立呼叫（如未來快捷鍵）仍需防護。
    if (!document.body) {
      return false;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);

    const selection = document.getSelection();
    const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    // 記錄原焦點元素：focus() 可能觸發主站頁面的 blur 監聽（自動儲存、UI 狀態切換），
    // 複製完成後恢復焦點，避免把焦點留在已移除的 textarea 上。
    const previouslyFocused = document.activeElement;
    // iOS Safari 上 select()/setSelectionRange() 常需元素先獲得焦點，否則可能靜默失敗。
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    let succeeded = false;
    try {
      succeeded = document.execCommand('copy');
    } catch (_error) {
      succeeded = false;
    }

    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
    // finally 保證異常路徑也清理 textarea，避免殘留。
    try {
      if (textarea.isConnected) {
        document.body.removeChild(textarea);
      }
    } catch (_error) {
      // 清理失敗不影響複製結果。
    }
    // 恢復原焦點（textarea 已移除，activeElement 已回落為 body；僅當原焦點元素仍可聚焦時恢復）。
    if (previouslyFocused && previouslyFocused !== document.body && typeof previouslyFocused.focus === 'function') {
      try {
        previouslyFocused.focus();
      } catch (_error) {
        // 焦點恢復失敗不影響複製結果。
      }
    }
    return succeeded;
  }

  async function copyLatestSharedProfileToClipboard(button) {
    // 優先讀取按鈕繫結的本次分享快照，避免依賴單一全域性槽而複製到「最後一次分享」。
    const profile = button?._mwiTmProfileSnapshot || mainSiteState.latestSharedProfile;
    if (!profile || typeof profile !== 'object') {
      setProfileCopyButtonFeedback(button, 'copyProfileFailed');
      return;
    }

    let text;
    try {
      text = JSON.stringify(buildProfileExportPayload(profile));
    } catch (_error) {
      // clonePlainObject 的兜底路徑（structuredClone/遞迴）可能保留 BigInt 或迴圈引用，
      // 此時 JSON.stringify 會拋 TypeError。失敗時走失敗反饋，避免 async 函式變成
      // unhandled rejection 且按鈕無任何反饋。
      setProfileCopyButtonFeedback(button, 'copyProfileFailed');
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        setProfileCopyButtonFeedback(button, 'copyProfileSuccess');
        return;
      } catch (_error) {
        // 非同步剪貼簿 API 失敗時，回落到 execCommand 兜底。
      }
    }

    const fallbackSucceeded = copyTextViaExecCommand(text);
    if (fallbackSucceeded) {
      setProfileCopyButtonFeedback(button, 'copyProfileSuccess');
    } else {
      setProfileCopyButtonFeedback(button, 'copyProfileFailed');
    }
  }

  function createProfileCopyButton(tablist, profile) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = PROFILE_COPY_BUTTON_ID;
    button.setAttribute('data-mwi-tm-profile-copy', '1');
    button._mwiTmProfileSnapshot = profile;
    button.textContent = getUiText('copyProfileButton');
    button.title = getUiText('copyProfileButtonTitle');
    // 固定可訪問名稱：反饋階段 textContent 會臨時變為「已複製」等狀態文本，
    // aria-label 保持穩定，避免讀屏器把反饋文本當作按鈕名稱。
    button.setAttribute('aria-label', getUiText('copyProfileButton'));

    // 複用 MUI 的穩定全域性類名（繼承 hover/focus/ripple 等類級行為），並刻意不帶
    // css-xxxx / __hash 這類每次構建都可能變的雜湊類名——tab 雜湊類帶來的外觀差異
    // 由下方 readTabComputedStyles 補齊（只取安全屬性，見該函式註釋）。
    button.className = 'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary';

    // 以真實 tab 的關鍵計算樣式為基線（尺寸/字型/圓角/字距），再疊加「顏色覆蓋」，
    // 使按鈕與其餘 tab 視覺一致、僅背景漸變與白字不同（使用者要求保留）。
    const shapeStyles = readTabComputedStyles(tablist) || {
      'min-height': '40px',
      'min-width': '90px',
      padding: '6px 16px',
      margin: '0',
      'font-size': '13px',
      'font-weight': '600',
      'font-family': 'inherit',
      'line-height': '1.5',
      'border-radius': '8px',
      'letter-spacing': '0.02857em',
    };

    const styleMap = {
      ...shapeStyles,
      'box-sizing': 'border-box',
      cursor: 'pointer',
      'white-space': 'nowrap',
      'text-transform': 'none',
      // tablist 行內末尾的獨立按鈕：inline-flex 保持與 tabs 同排且垂直居中；flex 按內容
      // 自適應（只禁收縮、不復制主站等寬分欄的 flex-basis），保證文字完整顯示。
      display: 'inline-flex',
      'align-items': 'center',
      'flex-shrink': '0',
      'align-self': 'center',
      'margin-left': '4px',
      // 保留按鈕顏色（青藍漸變背景 + 白字），其餘與 tab 一致。
      border: 'none',
      background: 'linear-gradient(135deg, rgba(14,165,233,0.92), rgba(13,148,136,0.92))',
      color: '#fff',
      'box-shadow': 'none',
    };

    button.style.cssText = Object.entries(styleMap)
      .map(([key, value]) => `${key}:${value}`)
      .join(';');

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyLatestSharedProfileToClipboard(button);
    });
    return button;
  }

  function extractSharedProfileCharacterId(profile) {
    const sharable = profile?.sharableCharacter;
    return String(sharable?.id || sharable?.characterID || sharable?.characterId || profile?.characterId || '').trim();
  }

  function extractSharedProfileName(profile) {
    return String(profile?.sharableCharacter?.name || profile?.name || '').trim();
  }

  function isLikelyProfileDialog(dialog, profile = mainSiteState.latestSharedProfile) {
    // 彈窗 DOM 一般不暴露 characterId，因此 DOM 側校驗只能用名字子串；
    // characterId 精確比對用於「新分享到達時作廢舊按鈕」的身份判定（見 handleProfileSharedMessage）。
    // 若未來主站彈窗暴露 data-* 角色標識，優先改用 characterId 精確校驗替代名稱匹配。
    const expectedName = normalizeComparableText(extractSharedProfileName(profile));
    const normalizedName = expectedName.replace(/\s+/g, '');
    if (!normalizedName || normalizedName.length < 2) {
      // 未捕獲到角色名或名字過短（單字元）時無法可靠校驗：保守跳過注入，
      // 避免「A」這類單字元名誤匹配到 Attack 等任意含該字母的彈窗。
      return false;
    }
    const dialogText = normalizeComparableText(dialog?.textContent || '');
    if (normalizedName.length === 2) {
      // 2 字元名啟用詞邊界匹配（在保留空白的文本上執行，normalizeComparableText 已把空白
      // 壓為單空格）：名字前後不得緊鄰字母/數字/下劃線（含 CJK），「Mo」只有獨立出現
      // 才算命中，不再匹配 Monster 這類僅含子串的彈窗（S5 已知邊界）。
      const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const boundaryPattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapedName}(?![\\p{L}\\p{N}_])`, 'u');
      return boundaryPattern.test(dialogText);
    }
    // ≥3 字元名維持子串匹配：長名誤配機率低，且避免主站正文粘連渲染（如「莫凡的裝備」）
    // 導致漏掛——漏掛（功能不可用）比低頻錯位更不可接受。
    return dialogText.replace(/\s+/g, '').includes(normalizedName);
  }

  // 回退路徑曾把彈窗臨時改為 relative（見 mountProfileCopyButton 的 fallback 分支）；
  // 彈窗關閉或按鈕因身份變化被移除時恢復其原始 inline position，避免陳舊樣式殘留。
  function restoreProfileCopyDialogPosition(button) {
    const dialog = button?._mwiTmProfileDialog;
    const originalPosition = button?._mwiTmRestoreDialogPosition;
    if (dialog && originalPosition !== undefined) {
      dialog.style.position = originalPosition;
    }
  }

  function mountProfileCopyButton() {
    // 上一次掛載的按鈕已隨彈窗關閉而脫離 DOM：清理按鈕引用並恢復彈窗樣式。
    // latestSharedProfile 不在關閉時清空——同角色重開彈窗應恢復按鈕，
    // 快照延續到下一次分享覆蓋為止（詳見下方 previousButton 分支註釋）。
    const previousButton = mainSiteState.profileCopyButton;
    if (previousButton && !previousButton.isConnected) {
      // 上一次掛載的按鈕已隨彈窗關閉而脫離 DOM：清理按鈕引用並恢復彈窗樣式。
      // 刻意不清空 latestSharedProfile：同一角色重開彈窗（未重新分享）時按鈕應能恢復，
      // 快照一直延續到下一次分享覆蓋為止；開啟其它角色彈窗時由 isLikelyProfileDialog
      // 的名字校驗阻止掛載（若舊角色名恰好是新彈窗文本的子串，理論上可能誤掛——
      // 已知限制，名字校驗已擋住絕大多數跨角色場景）。
      restoreProfileCopyDialogPosition(previousButton);
      mainSiteState.profileCopyButton = null;
      // 注意：此處不 return。若彈窗 A（角色 X）關閉後已開啟彈窗 B（角色 Y），
      // latestSharedProfile 保留為 Y，繼續走下方掛載邏輯可立即為彈窗 B 掛載按鈕，
      // 無需等待下一次 DOM 變化（彈窗內容靜態時按鈕可能一直不出現）。
    }

    const existingButton = document.getElementById(PROFILE_COPY_BUTTON_ID);
    if (existingButton && existingButton.isConnected) {
      return;
    }

    const profile = mainSiteState.latestSharedProfile;
    if (!profile || typeof profile !== 'object') {
      return;
    }

    const dialog = findOpenProfileDialog();
    // 決策函式與 DOM 膠水分離：無彈窗 / 名字校驗失敗 → arm-cooldown；校驗通過 → mount。
    // keep / skip 不會在此出現（按鈕已連線與無快照已在上面短路返回）。
    const decision = resolveProfileCopyMountAction({ hasConnectedButton: false, profile, dialog });
    if (decision.action === 'arm-cooldown') {
      // 未找到彈窗 / 彈窗存在但名字校驗失敗（名字為空/過短/與彈窗內容不匹配）：
      // 記錄冷卻，避免主站 React 應用頻繁 DOM 變化時持續觸發全量掃描
      // （見 initMainSiteProfileCopyButton 的 scheduleMount 冷卻判斷）。
      mainSiteState.profileDialogScanCooldownUntil = Date.now() + PROFILE_DIALOG_SCAN_COOLDOWN_MS;
      return;
    }
    if (decision.action !== 'mount') {
      return;
    }

    const tablist = findProfileTablist(dialog);
    const button = createProfileCopyButton(tablist, profile);
    button._mwiTmProfileDialog = dialog;

    // 作為獨立操作按鈕追加到 tablist 行內末尾（即最後一個 tab 的右側）。曾用
    // insertAdjacentElement('afterend') 放在 tablist 之後——主站資料彈窗裡 tablist 的父容器
    // 不是 flex 行佈局，按鈕會被換到下一行；只有放入行內才能與 tabs 保持同一排。
    // 代價是 tablist 混入非 tab 子元素（ARIA 語義不純）：按鈕不帶 role=tab，讀屏器仍按普通
    // 按鈕播報，視覺正確性優先。按鈕 click 已 stopPropagation（不觸發主站 tab 切換），無
    // tabindex 不參與主站 tab 鍵序；React 重渲染移除按鈕時由 existingButton 檢查重新掛載。
    if (tablist) {
      tablist.appendChild(button);
      mainSiteState.profileCopyButton = button;
      return;
    }

    // 找不到 tablist 時回退：絕對定位在彈窗右上角（關閉按鈕正下方、右對齊）。
    // 記錄原始 inline position，待彈窗關閉/按鈕移除時恢復（見 restoreProfileCopyDialogPosition）。
    // 注意：若彈窗或其祖先帶 overflow:hidden，右上角按鈕理論上可能被裁剪；目前主站資料彈窗
    // 右上角位於其內容邊界內，暫未做通用反裁剪處理。
    const position = window.getComputedStyle(dialog).position;
    if (position === 'static') {
      button._mwiTmRestoreDialogPosition = dialog.style.position;
      dialog.style.position = 'relative';
    }

    let topPx = '12px';
    let rightPx = '12px';
    const closeButton = findCloseButtonWithin(dialog);
    if (closeButton) {
      const dialogRect = dialog.getBoundingClientRect();
      const closeRect = closeButton.getBoundingClientRect();
      if (dialogRect.width > 0 && closeRect.width > 0 && closeRect.height > 0) {
        topPx = `${Math.round(Math.max(12, closeRect.bottom - dialogRect.top + 8))}px`;
        rightPx = `${Math.round(Math.max(12, dialogRect.right - closeRect.right))}px`;
      }
    }

    button.style.position = 'absolute';
    button.style.top = topPx;
    button.style.right = rightPx;
    button.style.zIndex = '2147483647';
    dialog.appendChild(button);
    mainSiteState.profileCopyButton = button;
  }

  // findOpenProfileDialog 全量掃描的冷卻時長：彈窗關閉後 500ms 內不再重複掃描，
  // 避免主站 React 應用頻繁 DOM 變化時持續觸發 querySelectorAll + 佈局讀取。
  const PROFILE_DIALOG_SCAN_COOLDOWN_MS = 500;

  function initMainSiteProfileCopyButton() {
    let scheduled = false;
    // 冷卻視窗兜底重試定時器：冷卻期內被跳過的掃描在此留下一次性重試（見 scheduleMount），
    // 保證冷卻結束後必有最後一次掛載嘗試。mountProfileCopyButton 內部會自然短路
    // （latestSharedProfile 為空 / 按鈕已掛載 / 彈窗仍未開啟），因此不會形成輪詢。
    let mountRetryTimer = null;

    function scheduleMount() {
      if (scheduled) {
        return;
      }
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        // 冷卻期內跳過掃描：彈窗剛關閉（或從未開啟）時，findOpenProfileDialog 的
        // 全量掃描沒有意義，直接跳過直到冷卻結束，避免持續掃描開銷。
        const gate = resolveProfileDialogScanGate(Date.now(), mainSiteState.profileDialogScanCooldownUntil);
        if (gate.state === 'cooling') {
          // 關鍵兜底：彈窗開啟產生的 DOM 變化若恰好落在冷卻視窗內，會被上面的跳過
          // 直接吞掉；資料彈窗內容靜態、之後可能再無 DOM 變化，按鈕將永不掛載。
          // 因此排程冷卻結束後的最後一次重試。重試是一次性的：若屆時彈窗仍未開啟，
          // 掃描會重新武裝冷卻並返回，重試不迴圈，等待下一次 DOM 變化觸發。
          if (mountRetryTimer === null) {
            mountRetryTimer = window.setTimeout(() => {
              mountRetryTimer = null;
              mountProfileCopyButton();
            }, gate.retryAfterMs);
          }
          return;
        }
        mountProfileCopyButton();
      });
    }

    // 觀察者保持常駐（不做 disconnect）：它同時承擔「彈窗關閉後清理臨時狀態」的檢測
    // （見 mountProfileCopyButton 裡 previousButton.isConnected 分支）。回撥本身 O(1)，
    // 且 mountProfileCopyButton 在 latestSharedProfile 為空時會先短路返回，不會觸發
    // findOpenProfileDialog 的全量掃描；latestSharedProfile 非空但彈窗未開啟時，
    // 由 profileDialogScanCooldownUntil 冷卻節流，避免每次 DOM 變化都全量掃描。
    const observer = new MutationObserver(scheduleMount);

    function attachObserver() {
      mountProfileCopyButton();
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', attachObserver, { once: true });
    } else {
      attachObserver();
    }
  }

  function createRequestId() {
    return `mwi-tm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeErrorMessage(error, fallbackMessage) {
    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    const message = String(error?.message || '').trim();
    return message || fallbackMessage;
  }

  function isTrustedBridgeMessageSource(source) {
    if (!source) {
      return false;
    }

    // 使用者指令碼沙箱暴露的是代理 `window`，而頁面使用真實的（不安全的）window
    // 作為 `event.source` 傳送訊息。此處必須同時接受兩者。
    return source === window || source === pageWindow;
  }

  function isTrustedBridgeMessageEvent(event) {
    return isTrustedBridgeMessageSource(event?.source) && event?.origin === window.location.origin;
  }

  function waitForWindowMessage(channel, type, requestId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener('message', handleWindowMessage);
        reject(new Error(getUiText('pageBridgeTimeout')));
      }, timeoutMs);

      function handleWindowMessage(event) {
        if (!isTrustedBridgeMessageEvent(event)) {
          return;
        }

        const data = event.data;
        if (!data || typeof data !== 'object') {
          return;
        }

        if (data.channel !== channel || data.type !== type || data.requestId !== requestId) {
          return;
        }

        window.clearTimeout(timeoutId);
        window.removeEventListener('message', handleWindowMessage);
        resolve(data);
      }

      window.addEventListener('message', handleWindowMessage);
    });
  }

  function waitForSharedValue(key, requestId, timeoutMs) {
    return new Promise((resolve, reject) => {
      let listenerId = null;
      let intervalId = null;
      const timeoutId = window.setTimeout(() => {
        if (listenerId != null) {
          GM_removeValueChangeListener(listenerId);
        }
        if (intervalId != null) {
          window.clearInterval(intervalId);
        }
        reject(new Error(getUiText('mainSiteTabTimeout')));
      }, timeoutMs);

      function maybeResolve(rawValue) {
        if (!rawValue || typeof rawValue !== 'object') {
          return false;
        }

        if (String(rawValue.requestId || '') !== requestId) {
          return false;
        }

        window.clearTimeout(timeoutId);
        if (listenerId != null) {
          GM_removeValueChangeListener(listenerId);
        }
        if (intervalId != null) {
          window.clearInterval(intervalId);
        }
        resolve(rawValue);
        return true;
      }

      const initialValue = GM_getValue(key, null);
      if (maybeResolve(initialValue)) {
        return;
      }

      listenerId = GM_addValueChangeListener(key, (_name, _oldValue, newValue) => {
        maybeResolve(newValue);
      });

      intervalId = window.setInterval(() => {
        maybeResolve(GM_getValue(key, null));
      }, STORAGE_POLL_INTERVAL_MS);
    });
  }

  function parseMainSiteJsonPayload(rawValue) {
    if (typeof rawValue !== 'string') {
      return null;
    }

    try {
      return JSON.parse(rawValue);
    } catch (error) {
      return null;
    }
  }

  function isMainSiteGameMessage(message) {
    return Boolean(message && typeof message === 'object' && typeof message.type === 'string');
  }

  function captureCurrentCharacterState(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    const type = String(message.type || '');
    if (type !== 'init_character_data' && type !== 'character_updated') {
      return;
    }

    const previousCharacterName = normalizeCharacterName(mainSiteState.currentCharacterName);
    const shouldResetSnapshot = type === 'character_updated' && hasCharacterIdentityChanged(message);
    if (shouldResetSnapshot) {
      resetCurrentCharacterTracking(previousCharacterName);
    }

    const characterName = String(message.character?.name || '').trim();
    if (characterName) {
      mainSiteState.currentCharacterName = characterName;
    }

    if (type === 'init_character_data') {
      updateCurrentCharacterSnapshot(message, true);
      replaceTrackedCharacterActions(message.characterActions);
      syncCurrentCharacterConsumableSlotMaps(message, true);
      syncCurrentCharacterCombatTriggerMaps(message, true);
      return;
    }

    if (type === 'character_updated') {
      updateCurrentCharacterSnapshot(message, shouldResetSnapshot);
      syncCurrentCharacterConsumableSlotMaps(message, shouldResetSnapshot);
      syncCurrentCharacterCombatTriggerMaps(message, shouldResetSnapshot);
    }
  }

  function captureCharacterActionsUpdate(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    const type = String(message.type || '');
    if (type === 'actions_updated' || type === 'action_completed') {
      mergeTrackedCharacterActions(message.endCharacterActions);
      return;
    }

    if (type === 'action_type_consumable_slots_updated') {
      syncCurrentCharacterConsumableSlotMaps(message);
      return;
    }

    if (type === 'all_combat_triggers_updated') {
      syncCurrentCharacterCombatTriggerMaps(message);
      return;
    }

    if (type === 'combat_triggers_updated') {
      updateCombatTriggerMap(message);
    }
  }

  // —— 市場估值透傳（F12 診斷已隨第 20 輪拆除；捕獲邏輯見 captureMarketItemValues）——
  // 訂單簿形狀漂移告警去重標記：會話內只告警一次（見下方【一般-2】註釋）。
  let marketOrderBookShapeWarned = false;
  function captureMarketItemValues(message) {
    const type = String(message?.type || '');
    if (type === 'market_item_values_updated') {
      const values = message?.marketItemValues;
      if (values && typeof values === 'object' && !Array.isArray(values)) {
        mainSiteState.marketItemValues = clonePlainObject(values);
      }
      return;
    }
    if (type === 'market_item_order_books_updated') {
      // 訂單簿訊息為單物品增量（對齊 MWITools applyMarketOrderBooks）：欄位在
      // message.marketItemOrderBooks 下（itemHrid + marketValues{等級:估值}），
      // 需按物品合併進快取；早期實現誤讀頂層 marketValues 且把單物品形狀
      // spread 到頂層，導致官方估值快取始終為空、匯入後資產分降級為掛單價。
      // 合併成本約定（2026-08-31 審計【效能 #6】）：頂層淺複製（物品鍵引用複製）
      // + 僅深克隆本物品的 marketValues（≤21 檔）——不得回退為
      // clonePlainObject(existingByItem) 全量深克隆（單物品增量每條訊息
      // JSON 往返整張 ~872 物品快取，市場頁活躍期逐條阻塞主執行緒）。非目標
      // 物品的 levels 對映與上一代快取共享引用是安全的：本狀態全部寫點均
      // 構建新物件、不變更已釋出物件，getMergedMarketItemValues 亦只讀展開——與
      // mergeStoredMarketItemValues（【一般-1】後同為淺複製構建新物件）同款
      // 結構共享；頂層引用仍按事件整體替換，N3 記憶化失效訊號約定不變。
      const rawOrderBooks = message?.marketItemOrderBooks;
      // 【一般-2】形狀防禦與全量分支（marketItemValues 的 !Array.isArray）對齊：
      // typeof 不排陣列，契約漂移為陣列形狀時 itemHrid 取值必為空、合併必然靜默
      // no-op——官方估值停止增量更新、資產分無聲降級為掛單價鏈，且 F12 診斷已
      // 隨第 20 輪拆除，全程無任何可觀測訊號。故形狀漂移（陣列/非物件）時會話內
      // 告警一次（訂單簿增量為高頻訊息，逐條告警會刷屏），並維持既有頂層
      // message 回退路徑不變（與缺欄位時同路徑，不新增解析分支）。
      if (rawOrderBooks != null && (typeof rawOrderBooks !== 'object' || Array.isArray(rawOrderBooks))) {
        if (!marketOrderBookShapeWarned) {
          marketOrderBookShapeWarned = true;
          console.warn(
            '[MWI TM] market_item_order_books_updated.marketItemOrderBooks 形狀異常（預期 {itemHrid, marketValues} 單物品物件），官方估值增量合併已停止：',
            rawOrderBooks,
          );
        }
      }
      const orderBook =
        rawOrderBooks && typeof rawOrderBooks === 'object' && !Array.isArray(rawOrderBooks) ? rawOrderBooks : message;
      const itemHrid = String(orderBook?.itemHrid || '');
      const values = orderBook?.marketValues;
      if (itemHrid && values && typeof values === 'object' && !Array.isArray(values)) {
        const existingByItem = mainSiteState.marketItemValues ?? {};
        mainSiteState.marketItemValues = {
          ...existingByItem,
          [itemHrid]: {
            ...(existingByItem[itemHrid] ?? {}),
            ...clonePlainObject(values),
          },
        };
      }
    }
  }

  function handleProfileSharedMessage(message) {
    if (String(message?.type || '') !== 'profile_shared' || !message?.profile) {
      return;
    }

    const nextProfile = clonePlainObject(message.profile);

    // 新分享到達：作廢繫結到其它角色的舊按鈕，避免陳舊快照殘留；同一角色則重新整理快照。
    // 注意：ID 缺失（如舊版主站載荷無 characterId）時無法確認身份，保守移除舊按鈕，
    // 交由 mountProfileCopyButton 依據最新分享重新掛載，避免按鈕誤掛舊彈窗。
    const previousButton = mainSiteState.profileCopyButton;
    if (previousButton && previousButton._mwiTmProfileSnapshot) {
      const previousId = extractSharedProfileCharacterId(previousButton._mwiTmProfileSnapshot);
      const nextId = extractSharedProfileCharacterId(nextProfile);
      const isSameCharacter = Boolean(previousId && nextId && previousId === nextId);
      if (isSameCharacter) {
        // 同一角色：重新整理按鈕快照（全域性槽由下方統一賦值）。
        previousButton._mwiTmProfileSnapshot = nextProfile;
      } else {
        // 另一角色，或 ID 缺失無法確認身份：移除舊按鈕，交由掛載邏輯重新掛載。
        if (previousButton.isConnected) {
          previousButton.remove();
        }
        restoreProfileCopyDialogPosition(previousButton);
        mainSiteState.profileCopyButton = null;
      }
    }

    // 統一使用克隆後的 nextProfile 持久化，避免與原始 message.profile 混用。
    persistProfileCacheEntry(nextProfile);
    mainSiteState.latestSharedProfile = nextProfile;
  }

  function instrumentMainSiteSocket(socket) {
    if (!socket || socket.__mwiTmBridgeInstrumented === true) {
      return socket;
    }

    socket.__mwiTmBridgeInstrumented = true;
    mainSiteState.sockets.add(socket);

    socket.addEventListener('message', (event) => {
      const parsed = parseMainSiteJsonPayload(event.data);
      if (hasStructuredPartyInfoFieldHints(event.data)) {
        rememberRecentPartyMessage(parsed);
      }

      if (!isMainSiteGameMessage(parsed)) {
        return;
      }

      captureCurrentCharacterState(parsed);
      captureCurrentCharacterDataUpdate(parsed);
      captureCharacterActionsUpdate(parsed);
      captureMarketItemValues(parsed);
      handleProfileSharedMessage(parsed);
    });

    socket.addEventListener('close', () => {
      mainSiteState.sockets.delete(socket);
      if (mainSiteState.sockets.size === 0) {
        // 這裡只丟棄記憶體中的名單。套接字關閉並不能證明隊伍已結束：重連會短暫
        // 關閉所有套接字，若清空持久化快取，則在新隊伍訊息到達前，導入團隊成員
        // 將降級為僅當前角色。持久化快取的失效交由真正的 \"left the party\"
        // 訊號（空隊伍快照 / partyId -> 0）處理。
        clearRecentPartyMessages();
      }
    });

    return socket;
  }

  function installMainSiteSocketBridge() {
    if (mainSiteState.isInstalled === true) {
      return true;
    }

    const NativeWebSocket = pageWindow?.WebSocket;
    if (typeof NativeWebSocket !== 'function') {
      return false;
    }

    if (NativeWebSocket.__mwiTmWrapped === true) {
      mainSiteState.isInstalled = true;
      return true;
    }

    function WrappedWebSocket(url, protocols) {
      const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      return instrumentMainSiteSocket(socket);
    }

    WrappedWebSocket.prototype = NativeWebSocket.prototype;
    Object.defineProperty(WrappedWebSocket, 'CONNECTING', { value: NativeWebSocket.CONNECTING });
    Object.defineProperty(WrappedWebSocket, 'OPEN', { value: NativeWebSocket.OPEN });
    Object.defineProperty(WrappedWebSocket, 'CLOSING', { value: NativeWebSocket.CLOSING });
    Object.defineProperty(WrappedWebSocket, 'CLOSED', { value: NativeWebSocket.CLOSED });
    WrappedWebSocket.__mwiTmWrapped = true;
    WrappedWebSocket.__mwiTmNative = NativeWebSocket;
    pageWindow.WebSocket = WrappedWebSocket;

    mainSiteState.isInstalled = true;
    return true;
  }

  // —— 合成行情（零操作兜底）——
  // 官方估算（WS market_item_values_updated 為全量快照；localStorage 鍵為主通道）
  // 只在主站側可得，模擬器頁拿不到。主站公開端點 game_data/marketplace.json 提供
  // 全物品 per-level 行情，MWITools 也主動拉取它（生產 6 小時一次）並在官方估算
  // 缺失時用其 (a+b)/2 作為 fair 值。這裡拉取後合成中價估值，與官方估算合併透傳
  //（真實值優先覆蓋）。
  function isMainSiteHostname(hostname = pageWindow?.location?.hostname ?? '') {
    return /(^|\.)(milkywayidle\.com|milkywayidlecn\.com)$/.test(String(hostname || ''));
  }

  // —— 官方估算的 localStorage 來源（第 13 輪）——
  // 主站自己將全量官方估算（含 marketValuesVersion）寫入 localStorage 鍵
  // "marketItemValues"，可能為明文 JSON 或 LZString 壓縮串（UTF16 / Base64 形態）。
  // MWITools 啟動即讀此鍵（loadMarketItemValuesFromStorage），這就是它不瀏覽市場
  // 也有官方估算的原因。優先走主站自帶的 localStorageUtil.getMarketItemValues()，
  // 失敗再按明文 → UTF16 → Base64 依次嘗試解壓。以下為內嵌的 LZString 解壓器
  //（lz-string 1.5.0 的 _decompress 忠實移植，僅風格現代化）。
  //
  // 第三方元件許可宣告（依 MIT 許可證條款保留）：
  //   lz-string v1.5.0 —— https://github.com/pieroxy/lz-string
  //   Copyright (c) 2013 Pieroxy
  //   本檔案包含該軟體的實質性部分副本；MIT 許可證全文見
  //   https://raw.githubusercontent.com/pieroxy/lz-string/master/LICENSE.md
  //   （歷史註釋中的「WTFPL」系筆誤：2026-08-31 經 npm registry 後設資料
  //   https://registry.npmjs.org/lz-string/1.5.0 與上游 LICENSE.md 雙源核證，
  //   lz-string 1.5.0 的許可證均為 MIT，本宣告塊即保留條款的履行。）
  function createLzStringDecompressor() {
    const fromCharCode = String.fromCharCode;
    const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    const baseReverseDic = {};

    function getBaseValue(alphabet, character) {
      if (!baseReverseDic[alphabet]) {
        baseReverseDic[alphabet] = {};
        for (let i = 0; i < alphabet.length; i += 1) {
          baseReverseDic[alphabet][alphabet.charAt(i)] = i;
        }
      }
      return baseReverseDic[alphabet][character];
    }

    function lzDecompress(length, resetValue, getNextValue) {
      const dictionary = [];
      let enlargeIn = 4;
      let dictSize = 4;
      let numBits = 3;
      let entry = '';
      const result = [];
      let w;
      let bits;
      let resb;
      let maxpower;
      let power;
      let c;
      let next;
      const data = { val: getNextValue(0), position: resetValue, index: 1 };

      for (let i = 0; i < 3; i += 1) {
        dictionary[i] = i;
      }

      bits = 0;
      maxpower = Math.pow(2, 2);
      power = 1;
      while (power != maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position == 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }

      switch ((next = bits)) {
        case 0:
          bits = 0;
          maxpower = Math.pow(2, 8);
          power = 1;
          while (power != maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          c = fromCharCode(bits);
          break;
        case 1:
          bits = 0;
          maxpower = Math.pow(2, 16);
          power = 1;
          while (power != maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          c = fromCharCode(bits);
          break;
        case 2:
          return '';
      }
      dictionary[3] = c;
      w = c;
      result.push(c);
      while (true) {
        if (data.index > length) {
          return '';
        }

        bits = 0;
        maxpower = Math.pow(2, numBits);
        power = 1;
        while (power != maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position == 0) {
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }

        switch ((c = bits)) {
          case 0:
            bits = 0;
            maxpower = Math.pow(2, 8);
            power = 1;
            while (power != maxpower) {
              resb = data.val & data.position;
              data.position >>= 1;
              if (data.position == 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
              }
              bits |= (resb > 0 ? 1 : 0) * power;
              power <<= 1;
            }

            dictionary[dictSize++] = fromCharCode(bits);
            c = dictSize - 1;
            enlargeIn--;
            break;
          case 1:
            bits = 0;
            maxpower = Math.pow(2, 16);
            power = 1;
            while (power != maxpower) {
              resb = data.val & data.position;
              data.position >>= 1;
              if (data.position == 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
              }
              bits |= (resb > 0 ? 1 : 0) * power;
              power <<= 1;
            }
            dictionary[dictSize++] = fromCharCode(bits);
            c = dictSize - 1;
            enlargeIn--;
            break;
          case 2:
            return result.join('');
        }

        if (enlargeIn == 0) {
          enlargeIn = Math.pow(2, numBits);
          numBits++;
        }

        if (dictionary[c]) {
          entry = dictionary[c];
        } else {
          if (c === dictSize) {
            entry = w + w.charAt(0);
          } else {
            return null;
          }
        }
        result.push(entry);

        // Add w+entry[0] to the dictionary.
        dictionary[dictSize++] = w + entry.charAt(0);
        enlargeIn--;

        w = entry;

        if (enlargeIn == 0) {
          enlargeIn = Math.pow(2, numBits);
          numBits++;
        }
      }
    }

    function decompressFromUTF16(compressed) {
      if (compressed == null) return '';
      if (compressed == '') return null;
      return lzDecompress(compressed.length, 16384, (index) => compressed.charCodeAt(index) - 32);
    }

    function decompress(compressed) {
      if (compressed == null) return '';
      if (compressed == '') return null;
      return lzDecompress(compressed.length, 32768, (index) => compressed.charCodeAt(index));
    }

    function decompressFromBase64(input) {
      if (input == null) return '';
      if (input == '') return null;
      return lzDecompress(input.length, 32, (index) => getBaseValue(BASE64_ALPHABET, input.charAt(index)));
    }

    return { decompressFromUTF16, decompress, decompressFromBase64 };
  }

  // 讀取主站 localStorage 中的官方估算（對齊 MWITools loadMarketItemValuesFromStorage）：
  // 優先主站自帶 localStorageUtil.getMarketItemValues()（主站自己維護的解析封裝），
  // 失敗再讀裸鍵並按 明文 JSON → UTF16 → 原生 → Base64 依次解壓。返回形如
  // { marketValuesVersion, marketItemValues } 或 null。
  function readStoredMarketItemValues() {
    try {
      const viaUtil = pageWindow?.localStorageUtil?.getMarketItemValues?.();
      if (viaUtil && typeof viaUtil === 'object' && viaUtil.marketItemValues) {
        return viaUtil;
      }
    } catch (_error) {
      // localStorageUtil 不可用時回落到裸鍵。
    }

    let rawValue = null;
    try {
      rawValue = pageWindow?.localStorage?.getItem?.(MARKET_ITEM_VALUES_STORAGE_KEY) ?? null;
    } catch (_error) {
      return null;
    }
    if (!rawValue || typeof rawValue !== 'string') {
      return null;
    }

    const decompressor = createLzStringDecompressor();
    // 候選惰性求值、命中即停（2026-08-31 審計【效能 #7】）：陣列字面量會立即
    // 求值全部元素，首個候選命中時其餘 LZString 全量解壓被無謂執行（且解壓器
    // 對形態不匹配輸入無 fail-fast，仍是全串逐位遍歷）。候選順序與語義不變：
    // 明文 → UTF16 → 原生 → Base64（對齊 MWITools parseStoredMarketItemValues）。
    const candidateProviders = [
      () => rawValue,
      () => decompressor.decompressFromUTF16(rawValue),
      () => decompressor.decompress(rawValue),
      () => decompressor.decompressFromBase64(rawValue),
    ];
    for (const provideCandidate of candidateProviders) {
      const candidate = provideCandidate();
      if (!candidate || typeof candidate !== 'string') {
        continue;
      }
      try {
        const parsed = JSON.parse(candidate);
        if (parsed?.marketItemValues) {
          return parsed;
        }
      } catch (_error) {
        // 該形態不是合法 JSON，嘗試下一種。
      }
    }
    return null;
  }

  // 把 localStorage 中的官方估算合併進 WS 捕獲快取（物品/等級粒度，WS 已捕獲值優先）。
  // 冪等：值無變化時不產生新物件引用；變更時整體替換 mainSiteState.marketItemValues
  // 引用（N3，2026-08-31：對已釋出快取物件原地寫入，對 getMergedMarketItemValues
  // 記憶化的引用失效訊號不可見，故構建新物件 + 末次整體賦值，為記憶化提供可靠失效訊號）。
  // 【一般-1】（2026-09-02）：不再逐物品累積 spread——原寫法下每次變更都整體複製累積
  // 物件，872 物品空快取首合併為 O(n²)（~38 萬次屬性複製，主執行緒阻塞 ~50ms）；改為
  // 一次性頂層淺複製構建新物件，遍歷中僅寫該新物件，末次整體賦值，首合併降為 O(n)。
  function mergeStoredMarketItemValues() {
    const stored = readStoredMarketItemValues();
    if (!stored?.marketItemValues || typeof stored.marketItemValues !== 'object') {
      return false;
    }
    // 一次性頂層淺複製（【一般-1】）：next 為全新物件，原地寫不會觸碰已釋出的快取
    // 物件；未變更物品的 levels 對映與舊快取共享引用（與訂單簿合併分支同款），變更
    // 物品一律以新物件（mergedLevels / { ...levels }）整體替換該鍵。
    const next = { ...(mainSiteState.marketItemValues ?? {}) };
    let changed = false;
    for (const [itemHrid, levels] of Object.entries(stored.marketItemValues)) {
      // 跳過 '__proto__'（【一般-1】複核）：頂層寫入由計算鍵改為普通賦值後，該鍵會
      // 命中 __proto__ 訪問器改寫快取物件原型而非建立自有鍵（舊累積寫法的計算鍵為
      // CreateDataProperty 語義）；物品 hrid 恆為 '/items/...' 形態，無合法資料損失。
      if (!itemHrid || itemHrid === '__proto__' || typeof levels !== 'object' || levels === null) {
        continue;
      }
      const existingLevels = next[itemHrid];
      if (existingLevels) {
        const mergedLevels = { ...existingLevels };
        let levelChanged = false;
        for (const [level, value] of Object.entries(levels)) {
          if (existingLevels[level] === undefined) {
            mergedLevels[level] = value;
            levelChanged = true;
          }
        }
        if (levelChanged) {
          next[itemHrid] = mergedLevels;
          changed = true;
        }
      } else {
        next[itemHrid] = { ...levels };
        changed = true;
      }
    }
    // 變更時整體替換引用（N3 記憶化的失效訊號依賴此約定）；冪等時保持原引用。
    if (changed) {
      mainSiteState.marketItemValues = next;
    }
    return changed;
  }

  function getMarketplaceApiUrl(hostname = pageWindow?.location?.hostname ?? '') {
    const normalized = String(hostname || '');
    if (normalized.startsWith('test.')) {
      return 'https://test.milkywayidle.com/game_data/marketplace.json';
    }
    if (normalized.endsWith('milkywayidlecn.com')) {
      return 'https://milkywayidlecn.com/game_data/marketplace.json';
    }
    return 'https://www.milkywayidle.com/game_data/marketplace.json';
  }

  // 與 MWITools getFairValue 的行情 fallback 同口徑：雙邊取 (ask+bid)/2，單邊取單邊；
  // 負值（無掛單哨兵 -1）與零視為缺失。等級鍵統一為非負整數字串。
  function convertMarketDataToItemValues(marketData) {
    const converted = {};
    for (const [itemHrid, levels] of Object.entries(marketData ?? {})) {
      if (!itemHrid || typeof levels !== 'object' || levels === null) {
        continue;
      }
      const byLevel = {};
      for (const [level, record] of Object.entries(levels)) {
        const ask = Number(record?.a);
        const bid = Number(record?.b);
        const validAsk = Number.isFinite(ask) && ask > 0 ? ask : 0;
        const validBid = Number.isFinite(bid) && bid > 0 ? bid : 0;
        const mid = validAsk > 0 && validBid > 0 ? (validAsk + validBid) / 2 : Math.max(validAsk, validBid);
        if (mid > 0) {
          const levelNumber = Math.max(0, Math.floor(Number(level) || 0));
          byLevel[String(levelNumber)] = mid;
        }
      }
      if (Object.keys(byLevel).length > 0) {
        converted[itemHrid] = byLevel;
      }
    }
    return converted;
  }

  // 合併透傳用：WS 真實官方估算優先，合成行情只補缺失的物品/等級。
  // 記憶化（N3，2026-08-31）：輸入僅 mainSiteState.syntheticMarketItemValues 與
  // mainSiteState.marketItemValues 兩個狀態，二者變更均為整體替換新引用
  //（captureMarketItemValues 全量/訂單簿兩分支、fetchSyntheticMarketItemValues
  // 整體賦值、mergeStoredMarketItemValues 變更分支——按分支名標註，不寫死行號），
  // 故以引用同一性作失效訊號。返回共享快取物件，呼叫方只讀、不得修改。
  let mergedMarketItemValuesCache = null;
  let mergedCacheSyntheticRef = null;
  let mergedCacheOfficialRef = null;
  function getMergedMarketItemValues() {
    const syntheticRef = mainSiteState.syntheticMarketItemValues ?? null;
    const officialRef = mainSiteState.marketItemValues ?? null;
    if (
      mergedMarketItemValuesCache &&
      mergedCacheSyntheticRef === syntheticRef &&
      mergedCacheOfficialRef === officialRef
    ) {
      return mergedMarketItemValuesCache;
    }
    const merged = clonePlainObject(syntheticRef ?? {});
    for (const [itemHrid, levels] of Object.entries(officialRef ?? {})) {
      merged[itemHrid] = { ...(merged[itemHrid] ?? {}), ...(levels ?? {}) };
    }
    mergedMarketItemValuesCache = merged;
    mergedCacheSyntheticRef = syntheticRef;
    mergedCacheOfficialRef = officialRef;
    return merged;
  }

  // #18（2026-08-31）：混合載荷的逐件來源真值——merged 的鍵中不在官方估算快取裡的
  // 物品，其數值完全來自合成中價（合併優先順序官方優先，官方覆蓋的物品取官方值）。
  // 返回合成獨有物品的 hrid 陣列（只讀）；僅載荷級標記為 'official' 時呼叫——
  // 標記 'synthetic' 時全部物品均為合成，清單冗餘不掛。
  function collectSyntheticOnlyItemHrids(mergedMarketItemValues) {
    const officialKeys = new Set(Object.keys(mainSiteState.marketItemValues ?? {}));
    const syntheticOnly = [];
    for (const itemHrid of Object.keys(mergedMarketItemValues)) {
      if (!officialKeys.has(itemHrid)) {
        syntheticOnly.push(itemHrid);
      }
    }
    return syntheticOnly;
  }

  // 【一般-5】（2026-09-02）：等級級來源真值——物品級清單 syntheticItemHrids 只覆蓋
  // 「整件合成」物品；混合物品（官方快取命中該 hrid、但部分等級不在官方快取內）的
  // 逐等級來源只能由本清單表達：{ [itemHrid]: [levelKey, ...] }，僅列出該物品中由
  // 合成行情補齊（官方快取未覆蓋）的等級鍵（合併語義官方優先，官方覆蓋的等級取官方
  // 值、不會出現在清單中）。app 側據此在 marketItemValueSourcesByLevel 建立等級級
  // 來源覆蓋，tooltip / 可複製明細對合成補齊等級如實標「合成中價」。返回只讀物件；
  // 僅載荷級標記為 'official' 時呼叫——純 synthetic 載荷全部等級均為合成，清單冗餘不掛。
  function collectSyntheticLevelKeys(mergedMarketItemValues) {
    const officialValues = mainSiteState.marketItemValues ?? {};
    const syntheticLevelKeys = {};
    for (const [itemHrid, levels] of Object.entries(mergedMarketItemValues ?? {})) {
      const officialLevels = officialValues[itemHrid];
      if (!officialLevels || typeof officialLevels !== 'object') {
        continue; // 整件合成物品已由 syntheticItemHrids 物品級清單覆蓋
      }
      const levelKeys = [];
      for (const levelKey of Object.keys(levels ?? {})) {
        if (!Object.prototype.hasOwnProperty.call(officialLevels, levelKey)) {
          levelKeys.push(levelKey);
        }
      }
      if (levelKeys.length > 0) {
        syntheticLevelKeys[itemHrid] = levelKeys;
      }
    }
    return syntheticLevelKeys;
  }

  async function fetchSyntheticMarketItemValues(force = false) {
    if (!isMainSiteHostname()) {
      return false;
    }
    const now = Date.now();
    if (mainSiteState.syntheticMarketFetchInFlight === true) {
      // 掛起中：不可視為「已就緒」（N5 語義修正——舊實現返回 true 會謊報成功，
      // 使基於返回值的重試判定失效）。重複請求由本守衛擋下，不會雙發。
      return false;
    }
    if (
      !force &&
      mainSiteState.syntheticMarketFetchedAt > 0 &&
      now - mainSiteState.syntheticMarketFetchedAt < SYNTHETIC_MARKET_REFRESH_MS
    ) {
      return true;
    }
    if (typeof pageWindow.fetch !== 'function') {
      return false;
    }

    mainSiteState.syntheticMarketFetchInFlight = true;
    // 使用頁面 realm 的 AbortController（pageWindow.AbortController）：其 signal 與
    // pageWindow.fetch 同 realm，避免 TM 沙箱 AbortSignal 跨上下文傳給頁面 fetch
    // 的相容性隱患（#16）。typeof 門控保留：頁面無 AbortController 時降級為無超時
    //（超時失效但不崩潰，與 catch/finally 結構自愈一致）。
    // 控制器/定時器建立放入 try 內：typeof 門控只確認是函式、不確認可構造，頁面若
    // 把 AbortController 覆蓋成不可 new 的實現，構造拋錯也會被 catch 兜住並復位
    // inFlight（守衛不鎖死，功能自愈；見下方降級契約測試）。
    let controller = null;
    let timeoutId = null;
    try {
      controller = typeof pageWindow.AbortController === 'function' ? new pageWindow.AbortController() : null;
      timeoutId =
        controller && typeof setTimeout === 'function'
          ? setTimeout(() => controller.abort(), SYNTHETIC_MARKET_FETCH_TIMEOUT_MS)
          : null;
      const url = getMarketplaceApiUrl();
      const response = await pageWindow.fetch(url, controller ? { signal: controller.signal } : undefined);
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
      }
      const text = await response.text();
      const converted = convertMarketDataToItemValues(JSON.parse(text)?.marketData);
      const itemCount = Object.keys(converted).length;
      if (itemCount === 0) {
        throw new Error('marketData 為空');
      }
      mainSiteState.syntheticMarketItemValues = converted;
      mainSiteState.syntheticMarketFetchedAt = now;
      return true;
    } catch (_error) {
      return false;
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      mainSiteState.syntheticMarketFetchInFlight = false;
    }
  }

  function buildCurrentMainSiteResponse(requestId, preferredLanguage = '') {
    const normalizedRequestId = String(requestId || '').trim();
    const payload = buildCurrentCharacterPayload();
    const characterName = normalizeCharacterName(payload?.character?.name || mainSiteState.currentCharacterName);
    const characterId = String(payload?.character?.id || '').trim();

    if (!payload || !characterName) {
      return {
        requestId: normalizedRequestId,
        ok: false,
        format: 'main-site-current-character',
        characterId: '',
        characterName: normalizeCharacterName(mainSiteState.currentCharacterName),
        message: getUiText('currentCharacterNotInitialized', preferredLanguage),
      };
    }

    return {
      requestId: normalizedRequestId,
      ok: true,
      format: 'main-site-current-character',
      characterId,
      characterName,
      payload,
    };
  }

  function buildTeamMemberResponse(member, preferredLanguage = '') {
    const rawCharacterId = Number(member?.characterId || 0);
    const characterId = Number.isFinite(rawCharacterId) && rawCharacterId > 0 ? String(rawCharacterId) : '';
    const characterName = normalizeCharacterName(member?.characterName || member?.name || '');
    const comparableCharacterName = normalizeComparableText(characterName);
    const isCurrent =
      member?.isCurrent === true ||
      (comparableCharacterName &&
        comparableCharacterName === normalizeComparableText(mainSiteState.currentCharacterName));

    if (isCurrent) {
      const currentResponse = buildCurrentMainSiteResponse('', preferredLanguage);
      return {
        format: String(currentResponse?.format || 'main-site-current-character'),
        characterName: normalizeCharacterName(currentResponse?.characterName || characterName) || characterName,
        characterId: String(currentResponse?.characterId || characterId).trim(),
        ok: currentResponse?.ok === true && currentResponse?.payload && typeof currentResponse.payload === 'object',
        message:
          currentResponse?.ok === true
            ? ''
            : normalizeErrorMessage(
                currentResponse?.message,
                getUiText('currentCharacterNotInitialized', preferredLanguage),
              ),
        payload: currentResponse?.ok === true ? currentResponse.payload : null,
      };
    }

    const cachedEntry = findCachedProfileEntry(characterId, characterName);
    if (!cachedEntry || !cachedEntry.payload) {
      return {
        characterName,
        characterId,
        ok: false,
        message: getUiText('openProfileInGameFirst', preferredLanguage),
        payload: null,
      };
    }

    return {
      format: 'shareable-profile',
      characterName: normalizeCharacterName(cachedEntry.characterName || characterName) || characterName,
      characterId: String(cachedEntry.characterId || characterId).trim(),
      ok: true,
      message: '',
      payload: buildCachedProfilePayload(cachedEntry.payload?.profile),
    };
  }

  function buildTeamProfilesResponse(
    requestIdPrefix,
    rosterSource,
    rosterMembers,
    preferredLanguage = '',
    extraPayload = {},
  ) {
    const normalizedMembers = (Array.isArray(rosterMembers) ? rosterMembers : [])
      .map((member) => {
        if (!member || typeof member !== 'object') {
          return null;
        }

        const characterName = normalizeCharacterName(member?.characterName || member?.name || '');
        if (!characterName) {
          return null;
        }

        const rawCharacterId = Number(member?.characterId || 0);
        return {
          characterId: Number.isFinite(rawCharacterId) ? rawCharacterId : 0,
          characterName,
          isCurrent: member?.isCurrent === true,
        };
      })
      .filter((member) => member !== null)
      .slice(0, 5);

    const members = normalizedMembers.map((member) => buildTeamMemberResponse(member, preferredLanguage));
    const hasSuccess = members.some((member) => member.ok === true);
    const firstFailure = members.find((member) => member?.ok !== true && String(member?.message || '').trim());
    const firstFailureName = normalizeCharacterName(firstFailure?.characterName || '');
    return {
      ok: hasSuccess,
      message: hasSuccess
        ? ''
        : firstFailure
          ? `${firstFailureName || '-'}: ${String(firstFailure.message || '').trim()}`
          : getUiText('noMainSiteData', preferredLanguage),
      payload: {
        rosterSource,
        members,
        ...extraPayload,
      },
    };
  }

  async function requestTeamProfiles(requestId, preferredLanguage = '') {
    const requestIdPrefix = String(requestId || '').trim();
    if (!requestIdPrefix) {
      return null;
    }

    const teamContext = buildTeamRosterContext();
    const cacheMatch = readTeamRosterCache(teamContext);
    const gameStateResult = resolveTeamMemberNamesFromGameState();
    const wsPartyResult = resolveTeamMemberNamesFromRecentPartyMessages();
    // 已解析的 WebSocket 隊伍名單本身就是隊伍處於活動狀態的有效證據：
    // 主站並不總是可靠地暴露 `mwi.game.state.partyInfo`，而且隊伍戰鬥動作
    // 也不總是攜帶非零的 partyId。
    const hasActivePartyEvidence =
      Number(gameStateResult?.partyInfoMemberCount || 0) >= 2 ||
      Number(teamContext?.partyId || 0) > 0 ||
      (Array.isArray(wsPartyResult?.names) && wsPartyResult.names.length >= 2);
    const selectedAutoDetectedRoster = selectAutoDetectedTeamRoster({
      gameStateResult,
      wsPartyResult,
      cacheMatch,
      allowFallbackSources: hasActivePartyEvidence,
    });

    debugTeamRosterAutoDetection({
      context: teamContext,
      hasActivePartyEvidence,
      selectedSource: selectedAutoDetectedRoster.source,
      resolvedFromPath: selectedAutoDetectedRoster.resolvedFromPath,
      partyInfoResolvedRoster: gameStateResult.partyInfoNames,
      partyInfoMemberCount: gameStateResult.partyInfoMemberCount,
      gameStatePartyInfo: gameStateResult.partyInfo,
      wsPartyResolvedRoster: wsPartyResult.names,
      wsPartyMessages: wsPartyResult.messages,
      cacheExactRoster: cacheMatch.exactCharacterNames,
    });

    if (selectedAutoDetectedRoster.names.length < 2 || selectedAutoDetectedRoster.source === 'request') {
      clearStaleTeamRosterState(teamContext.currentCharacterName);
      return null;
    }

    const extraPayload = {
      context: teamContext,
    };
    if (selectedAutoDetectedRoster.source !== 'cache') {
      extraPayload.resolvedFromPath = selectedAutoDetectedRoster.resolvedFromPath;
    }

    const rosterMembers =
      Array.isArray(selectedAutoDetectedRoster.members) && selectedAutoDetectedRoster.members.length > 0
        ? selectedAutoDetectedRoster.members
        : selectedAutoDetectedRoster.names.map((name) => ({
            characterId: 0,
            characterName: name,
            isCurrent: normalizeComparableText(name) === normalizeComparableText(teamContext.currentCharacterName),
          }));

    return buildTeamProfilesResponse(
      requestIdPrefix,
      selectedAutoDetectedRoster.source,
      rosterMembers,
      preferredLanguage,
      extraPayload,
    );
  }

  function writeMainSiteImportResponse(requestId, format, response, preferredLanguage = '') {
    const isTeamResponse = format === 'shareable-profile-team';
    const payload = response?.payload;
    GM_setValue(RESPONSE_KEY, {
      version: isTeamResponse ? 2 : 1,
      requestId,
      source: 'milkywayidle',
      format,
      ok: response?.ok === true,
      message:
        response?.ok === true
          ? ''
          : normalizeErrorMessage(response?.message, getUiText('unableToReadCurrentProfile', preferredLanguage)),
      characterId: isTeamResponse ? '' : String(response?.characterId || ''),
      characterName: isTeamResponse ? '' : String(response?.characterName || ''),
      exportedAt: Date.now(),
      payload: payload && typeof payload === 'object' ? payload : null,
    });
  }

  function initMainSiteBridge() {
    if (!installMainSiteSocketBridge()) {
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initMainSiteBridge, { once: true });
      }
      return;
    }

    // 官方估算優先走主站 localStorage（與 MWITools 同源，登入後即有全量）；
    // 該來源無值時再拉公開 marketplace.json 合成中價估值兜底。
    // 後續每次匯入請求經 ensureMarketEstimatesFresh 惰性重新整理（N2，2026-08-31）。
    // merge 返回 false 有雙義（LS 無鍵 / 資料已全部存在）——與 ensureMarketEstimatesFresh
    // 同款雙守衛（#19）：僅當官方估算快取整體為空時才需要合成行情兜底，避免 WS 已捕獲
    // 且 LS 全覆蓋（merge 冪等返 false）時白拉一次合成行情。
    if (!mergeStoredMarketItemValues() && Object.keys(mainSiteState.marketItemValues ?? {}).length === 0) {
      fetchSyntheticMarketItemValues();
    }

    const handledRequestIds = new Set();

    // 每次匯入請求時惰性重新整理官方估算（N2，2026-08-31）：
    // 1) 主站 LS 鍵可能在 document-start 之後才寫入（登入晚於指令碼啟動），每次請求補一次
    //    merge（冪等：無新增時不產生新引用、不觸發下游失效）。
    // 2) merge 返回 false 有雙義（LS 無鍵 / 資料已全部存在）——僅當官方估算快取整體為空時
    //    才需要合成行情兜底，避免誤觸發 fetch。
    // 3) fetch 為 fire-and-forget：本次載荷可能仍缺合成行情，下一次匯入請求（250ms 輪詢窗
    //    之後）攜帶；fetch 失敗後 syntheticMarketFetchedAt 不寫，下次請求自然重試（退避 =
    //    匯入頻率），成功後 6 小時節流（SYNTHETIC_MARKET_REFRESH_MS）真實生效。
    function ensureMarketEstimatesFresh() {
      if (mergeStoredMarketItemValues()) {
        return;
      }
      if (Object.keys(mainSiteState.marketItemValues ?? {}).length === 0) {
        fetchSyntheticMarketItemValues();
      }
    }

    function processImportRequest(rawValue) {
      const request = rawValue && typeof rawValue === 'object' ? rawValue : null;
      const requestId = String(request?.requestId || '').trim();
      if (!requestId || handledRequestIds.has(requestId)) {
        return false;
      }

      handledRequestIds.add(requestId);
      // 請求驅動的惰性重新整理（N2）：在響應構建前執行，單人分支同步構建的載荷
      // 即可攜帶本次 merge 結果；舊 requestId 已被去重邏輯擋下，不會重複觸發。
      ensureMarketEstimatesFresh();

      const preferredLanguage = resolveUiLanguage(request?.language);
      const target = String(request?.target || 'active-player')
        .trim()
        .toLowerCase();

      if (target === 'auto') {
        requestTeamProfiles(requestId, preferredLanguage).then((teamResponse) => {
          if (Array.isArray(teamResponse?.payload?.members) && teamResponse.payload.members.length > 0) {
            writeMainSiteImportResponse(requestId, 'shareable-profile-team', teamResponse, preferredLanguage);
            return;
          }

          writeMainSiteImportResponse(
            requestId,
            'main-site-current-character',
            buildCurrentMainSiteResponse(requestId, preferredLanguage),
            preferredLanguage,
          );
        });
        return true;
      }

      writeMainSiteImportResponse(
        requestId,
        'main-site-current-character',
        buildCurrentMainSiteResponse(requestId, preferredLanguage),
        preferredLanguage,
      );

      return true;
    }

    GM_addValueChangeListener(REQUEST_KEY, (_name, _oldValue, newValue) => {
      processImportRequest(newValue);
    });

    processImportRequest(GM_getValue(REQUEST_KEY, null));
    window.setInterval(() => {
      processImportRequest(GM_getValue(REQUEST_KEY, null));
    }, STORAGE_POLL_INTERVAL_MS);
  }

  function initSimulatorImportButton() {
    const state = {
      isRequestPending: false,
      uiLanguage: resolveUiLanguage(),
      statusTone: 'idle',
      statusText: '',
      statusTextKey: '',
    };

    function getControlElements() {
      const button = document.getElementById(BUTTON_ID);
      const status = document.getElementById(STATUS_ID);
      return { button, status };
    }

    function renderControlState() {
      const { button, status } = getControlElements();
      if (!status || !button) {
        return;
      }

      const importMode = String(button.dataset.importMode || 'player');
      const buttonTextKey =
        importMode === 'enhancement' ? 'enhancementButton' : importMode === 'skilling' ? 'skillingButton' : 'button';
      button.textContent = getUiText(buttonTextKey, state.uiLanguage);
      status.textContent = state.statusTextKey
        ? getUiText(state.statusTextKey, state.uiLanguage)
        : String(state.statusText || '');
      status.className =
        state.statusTone === 'error'
          ? 'text-xs text-destructive'
          : state.statusTone === 'success'
            ? 'text-xs text-success'
            : 'text-xs text-muted-foreground';
      button.disabled = state.isRequestPending;
    }

    function setStatus(text, tone = 'idle') {
      state.statusTone = tone;
      state.statusText = String(text || '');
      state.statusTextKey = '';
      renderControlState();
    }

    function setStatusKey(statusTextKey, tone = 'idle') {
      state.statusTone = tone;
      state.statusText = '';
      state.statusTextKey = String(statusTextKey || '');
      renderControlState();
    }

    function syncControlLanguage(force = false) {
      const nextLanguage = resolveUiLanguage();
      if (!force && nextLanguage === state.uiLanguage) {
        return;
      }

      state.uiLanguage = nextLanguage;
      renderControlState();
    }

    async function requestMainSiteImport(requestId, target = 'auto') {
      GM_setValue(REQUEST_KEY, {
        version: 2,
        requestId,
        createdAt: Date.now(),
        target,
        language: state.uiLanguage,
      });

      return waitForSharedValue(RESPONSE_KEY, requestId, REQUEST_TIMEOUT_MS);
    }

    async function importPayloadIntoSimulator(requestId, payload, options = {}) {
      const responsePromise = waitForWindowMessage(
        APP_BRIDGE_CHANNEL,
        'mwi-tm-import-result',
        requestId,
        APP_IMPORT_TIMEOUT_MS,
      );
      const safeOptions = options && typeof options === 'object' ? options : {};
      const format = String(safeOptions.format || 'shareable-profile').trim() || 'shareable-profile';
      const { format: _ignoredFormat, ...messageOptions } = safeOptions;

      pageWindow.postMessage(
        {
          ...messageOptions,
          channel: APP_BRIDGE_CHANNEL,
          type: 'mwi-tm-import',
          requestId,
          format,
          payload,
        },
        window.location.origin,
      );

      return responsePromise;
    }

    function isTeamImportResponse(response) {
      return (
        String(response?.format || '') === 'shareable-profile-team' &&
        response?.payload &&
        typeof response.payload === 'object'
      );
    }

    function persistImportedTeamRoster(teamPayload, members) {
      const cacheContext = teamPayload?.context;
      const cacheNames = (Array.isArray(members) ? members : [])
        .map((member) => normalizeCharacterName(member?.characterName || ''))
        .filter(Boolean);
      if (cacheNames.length < 2) {
        return;
      }

      persistTeamRosterCache(cacheContext, cacheNames);
    }

    async function importSingleMainSiteResponse(mainSiteResponse, requestId) {
      if (!mainSiteResponse || mainSiteResponse.ok !== true || !mainSiteResponse.payload) {
        throw new Error(mainSiteResponse?.message || getUiText('noMainSiteData', state.uiLanguage));
      }

      setStatusKey('importingSimulator', 'idle');
      const appResponse = await importPayloadIntoSimulator(requestId, mainSiteResponse.payload, {
        clearOtherPlayers: true,
        resetTeamSelection: true,
        selectAfterImport: true,
        activateAfterImport: true,
        format: String(mainSiteResponse?.format || 'shareable-profile'),
      });
      if (!appResponse || appResponse.ok !== true) {
        throw new Error(appResponse?.message || getUiText('simulatorImportFailed', state.uiLanguage));
      }

      // 成功反饋附帶官方估值計數：必須數匯入載荷實際攜帶的數量，不能數本頁快取——
      // 模擬器頁尾本例項與主站不同源，本頁 merged 快取恆為空，會誤報「0 個物品」。
      // 0 個物品時使用者能立刻發現透傳為空（資產分將降級掛單價），
      // 而不是等到 tooltip 全是掛單價才排查。
      // 迷宮商店升級等級的覆蓋提示同樣在此拼接（appResponse 回傳摘要，純函式見上方
      // buildSingleImportFeedbackText）：等級被主站資料覆蓋/清零必須當場可見。
      setStatus(
        buildSingleImportFeedbackText({
          uiLanguage: state.uiLanguage,
          payload: mainSiteResponse.payload,
          labyrinthUpgradesImport: appResponse.labyrinthUpgradesImport,
        }),
        'success',
      );
    }

    async function importEnhancementMainSiteResponse(mainSiteResponse, requestId) {
      if (!mainSiteResponse || mainSiteResponse.ok !== true || !mainSiteResponse.payload) {
        throw new Error(mainSiteResponse?.message || getUiText('noMainSiteData', state.uiLanguage));
      }

      setStatusKey('importingSimulator', 'idle');
      const appResponse = await importPayloadIntoSimulator(requestId, mainSiteResponse.payload, {
        importTarget: 'enhancement',
        format: String(mainSiteResponse?.format || 'main-site-current-character'),
      });
      if (!appResponse || appResponse.ok !== true) {
        throw new Error(appResponse?.message || getUiText('simulatorImportFailed', state.uiLanguage));
      }

      setStatusKey('importSuccess', 'success');
    }

    async function importSkillingMainSiteResponse(mainSiteResponse, requestId) {
      if (!mainSiteResponse || mainSiteResponse.ok !== true || !mainSiteResponse.payload) {
        throw new Error(mainSiteResponse?.message || getUiText('noMainSiteData', state.uiLanguage));
      }

      setStatusKey('importingSimulator', 'idle');
      const appResponse = await importPayloadIntoSimulator(requestId, mainSiteResponse.payload, {
        importTarget: 'skilling',
        format: String(mainSiteResponse?.format || 'main-site-current-character'),
      });
      if (!appResponse || appResponse.ok !== true) {
        throw new Error(appResponse?.message || getUiText('simulatorImportFailed', state.uiLanguage));
      }

      setStatusKey('importSuccess', 'success');
    }

    async function importTeamMainSiteResponse(mainSiteResponse) {
      const payload = mainSiteResponse?.payload;
      const members = Array.isArray(payload?.members) ? payload.members : [];
      if (members.length === 0) {
        throw new Error(mainSiteResponse?.message || getUiText('noMainSiteData', state.uiLanguage));
      }

      const failureEntries = [];
      for (const member of members) {
        if (!member || typeof member !== 'object' || member.ok === true) {
          continue;
        }

        failureEntries.push({
          name: String(member.characterName || '').trim() || '-',
          message: String(member.message || '').trim() || getUiText('importFailed', state.uiLanguage),
        });
      }

      const successfulMembers = members.filter((member) => {
        return (
          member &&
          typeof member === 'object' &&
          member.ok === true &&
          member.payload &&
          typeof member.payload === 'object'
        );
      });

      if (successfulMembers.length === 0) {
        const firstFailure = failureEntries[0];
        throw new Error(
          firstFailure
            ? `${firstFailure.name}: ${firstFailure.message}`
            : mainSiteResponse?.message || getUiText('noMainSiteData', state.uiLanguage),
        );
      }

      setStatusKey('importingSimulator', 'idle');

      let importedCount = 0;
      const teamTargetPlayerIds = [...TEAM_IMPORT_PLAYER_IDS];
      let didClearTeamSlots = false;
      let didResetTeamSelection = false;
      // 迷宮商店升級等級是全域性（非按玩家）模擬設定，團隊匯入只有「當前角色」那個 member
      // 的載荷攜帶 characterInfo（會整包覆蓋等級），其餘 member 是快取分享檔（保留等級 ⇒
      // 摘要為 null）。故必須用 mergeLabyrinthUpgradesImportSummary 累積「最近一次非空摘要」，
      // 不能被後續 member 的 null 沖掉（否則清理提示靜默消失，見該函式註釋）。
      let lastLabyrinthUpgradesImport = null;
      for (const member of successfulMembers.slice(0, TEAM_IMPORT_PLAYER_IDS.length)) {
        const targetPlayerId = TEAM_IMPORT_PLAYER_IDS[importedCount] || String(importedCount + 1);
        const appRequestId = createRequestId();
        const clearPlayerIds = didClearTeamSlots ? [] : teamTargetPlayerIds;

        // eslint-disable-next-line no-await-in-loop
        const appResponse = await importPayloadIntoSimulator(appRequestId, member.payload, {
          targetPlayerId,
          clearPlayerIds,
          resetTeamSelection: !didResetTeamSelection,
          selectAfterImport: true,
          activateAfterImport: false,
          format: String(member?.format || 'shareable-profile'),
        });

        if (!appResponse || appResponse.ok !== true) {
          failureEntries.push({
            name: String(member.characterName || '').trim() || `Player ${targetPlayerId}`,
            message: String(appResponse?.message || '').trim() || getUiText('simulatorImportFailed', state.uiLanguage),
          });
          continue;
        }

        didClearTeamSlots = true;
        didResetTeamSelection = true;
        importedCount += 1;
        lastLabyrinthUpgradesImport = mergeLabyrinthUpgradesImportSummary(
          lastLabyrinthUpgradesImport,
          appResponse.labyrinthUpgradesImport,
        );
      }

      if (importedCount <= 0) {
        const firstFailure = failureEntries[0];
        throw new Error(
          firstFailure ? `${firstFailure.name}: ${firstFailure.message}` : getUiText('importFailed', state.uiLanguage),
        );
      }

      persistImportedTeamRoster(payload, members);

      // 團隊匯入成功反饋同樣附帶官方估值計數，與單人路徑（importSingleMainSiteResponse）
      // 口徑一致：數匯入載荷實際攜帶的 marketItemValues——各成功 member 載荷掛的是
      // 同一份 merged 快照（getMergedMarketItemValues 記憶化共享快取），取任一成功
      // member 計數即可；merged 為空時全部 member 都不帶該欄位，如實顯示「0 個物品
      // （資產分將使用掛單價）」，讓透傳故障（指令碼未登入 / LS 無鍵 / fetch 失敗）在
      // 匯入瞬間可見，而非等 tooltip 全是掛單價才排查（第 20 輪修復目標，團隊路徑
      // 此前缺失該反饋）。文案拼接收斂到頂層可注入純函式 buildTeamImportFeedbackText
      //（#22），此處僅接線呼叫，行為斷言在測試側覆蓋；summary 為空 = 全部成功。
      const feedbackText = buildTeamImportFeedbackText({
        uiLanguage: state.uiLanguage,
        summary:
          failureEntries.length === 0 ? '' : formatTeamImportSummary(importedCount, failureEntries, state.uiLanguage),
        firstSuccessPayload: successfulMembers[0]?.payload,
        labyrinthUpgradesImport: lastLabyrinthUpgradesImport,
      });
      setStatus(feedbackText, 'success');
    }

    async function handleImportButtonClick(importMode = 'player') {
      if (state.isRequestPending) {
        return;
      }

      const requestId = createRequestId();
      state.isRequestPending = true;
      setStatusKey('waitingMainSite', 'idle');

      try {
        const normalizedImportMode = importMode === 'enhancement' || importMode === 'skilling' ? importMode : 'player';
        const mainSiteResponse = await requestMainSiteImport(
          requestId,
          normalizedImportMode === 'player' ? 'auto' : 'active-player',
        );
        if (normalizedImportMode === 'enhancement') {
          await importEnhancementMainSiteResponse(mainSiteResponse, requestId);
        } else if (normalizedImportMode === 'skilling') {
          await importSkillingMainSiteResponse(mainSiteResponse, requestId);
        } else if (isTeamImportResponse(mainSiteResponse)) {
          await importTeamMainSiteResponse(mainSiteResponse);
        } else {
          await importSingleMainSiteResponse(mainSiteResponse, requestId);
        }
      } catch (error) {
        setStatus(normalizeErrorMessage(error, getUiText('importFailed', state.uiLanguage)), 'error');
      } finally {
        state.isRequestPending = false;
        const { button } = getControlElements();
        if (button) {
          button.disabled = false;
        }
        renderControlState();
      }
    }

    function mountImportControl() {
      const skillingActionBar = document.querySelector('[data-tm-import-anchor="skilling-actions"]');
      const enhancementActionBar = document.querySelector('[data-tm-import-anchor="enhancement-actions"]');
      const actionBar =
        skillingActionBar ||
        enhancementActionBar ||
        document.querySelector('[data-tm-import-anchor="simulator-home-actions"]');
      if (!actionBar) {
        return;
      }

      const importMode = skillingActionBar ? 'skilling' : enhancementActionBar ? 'enhancement' : 'player';
      const referenceButton = actionBar.querySelector(
        importMode === 'enhancement'
          ? '[data-tm-import-reference="enhancement-refresh"]'
          : importMode === 'skilling'
            ? '[data-tm-import-reference="skilling-refresh"]'
            : '[data-tm-import-reference="import-export"]',
      );
      if (document.getElementById(CONTROL_ID)) {
        return;
      }

      const wrapper = document.createElement('span');
      wrapper.id = CONTROL_ID;
      wrapper.className = 'inline-flex items-center gap-2';

      const button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      button.dataset.importMode = importMode;
      const buttonTextKey =
        importMode === 'enhancement' ? 'enhancementButton' : importMode === 'skilling' ? 'skillingButton' : 'button';
      button.textContent = getUiText(buttonTextKey, state.uiLanguage);
      button.className = 'button-tool';
      button.addEventListener('click', () => handleImportButtonClick(importMode));

      const status = document.createElement('span');
      status.id = STATUS_ID;
      status.className = 'text-xs text-muted-foreground';
      status.textContent = '';

      wrapper.appendChild(button);
      wrapper.appendChild(status);

      if (referenceButton && referenceButton.nextSibling) {
        actionBar.insertBefore(wrapper, referenceButton.nextSibling);
      } else {
        actionBar.appendChild(wrapper);
      }

      syncControlLanguage(true);
      setStatus('', 'idle');
    }

    function startObserving() {
      const observer = new MutationObserver(() => {
        mountImportControl();
      });

      function attachObserver() {
        mountImportControl();
        window.setInterval(() => {
          syncControlLanguage();
        }, 500);
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true });
        }
      }

      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', attachObserver, { once: true });
      } else {
        attachObserver();
      }
    }

    startObserving();
  }

  function cloneDebugValue(value) {
    return value == null ? null : JSON.parse(JSON.stringify(value));
  }

  function isTruthyDebugFlag(value) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  function shouldInstallDebugInterface() {
    try {
      const searchParams = new URLSearchParams(String(window.location?.search || ''));
      if (isTruthyDebugFlag(searchParams.get(DEBUG_QUERY_PARAM))) {
        return true;
      }
    } catch (_error) {}

    try {
      if (isTruthyDebugFlag(window.localStorage?.getItem(DEBUG_STORAGE_KEY))) {
        return true;
      }
    } catch (_error) {}

    const hostname = String(window.location?.hostname || '')
      .trim()
      .toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1';
  }

  function installDebugInterface() {
    if (!shouldInstallDebugInterface()) {
      return;
    }

    const debugApi = {
      getProfileCache() {
        return cloneDebugValue(GM_getValue(PROFILE_CACHE_KEY, null));
      },
      getTeamRosterCache() {
        return cloneDebugValue(GM_getValue(TEAM_ROSTER_CACHE_KEY, null));
      },
      getCurrentCharacterState() {
        return cloneDebugValue({
          currentCharacterName: mainSiteState.currentCharacterName,
          currentCharacterSnapshot: mainSiteState.currentCharacterSnapshot,
          actionTypeFoodSlotsMap: mainSiteState.actionTypeFoodSlotsMap,
          actionTypeDrinkSlotsMap: mainSiteState.actionTypeDrinkSlotsMap,
          consumableCombatTriggersMap: mainSiteState.consumableCombatTriggersMap,
          abilityCombatTriggersMap: mainSiteState.abilityCombatTriggersMap,
          readiness: {
            snapshot: hasCurrentCharacterSnapshot(),
            consumableSlots: hasCurrentCharacterConsumableSlots(),
            combatTriggers: hasCurrentCharacterCombatTriggerSnapshot(),
            foodSlots: mainSiteState.currentCharacterFoodSlotsReady === true,
            drinkSlots: mainSiteState.currentCharacterDrinkSlotsReady === true,
            consumableTriggers: mainSiteState.currentCharacterConsumableTriggersReady === true,
            abilityTriggers: mainSiteState.currentCharacterAbilityTriggersReady === true,
          },
          importPayloadPreview: buildCurrentCharacterPayload(),
        });
      },
    };

    const frozenDebugApi = Object.freeze(debugApi);
    const targets = [window];
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow !== window) {
      targets.push(unsafeWindow);
    }

    for (const target of targets) {
      try {
        Object.defineProperty(target, '__mwiImportDebug', {
          configurable: true,
          value: frozenDebugApi,
          writable: false,
        });
      } catch (_error) {}
    }
  }

  installDebugInterface();

  if (isMainSitePage()) {
    initMainSiteBridge();
    initMainSiteSimulatorShortcut();
    initMainSiteProfileCopyButton();
  }

  if (isSimulatorPage()) {
    initSimulatorImportButton();
  }
})();
