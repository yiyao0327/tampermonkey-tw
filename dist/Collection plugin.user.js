// ==UserScript==
// @name         收藏外掛
// @namespace    https://www.milkywayidle.com/
// @namespace    https://www.milkywayidlecn.com/
// @version      1.528
// @description  Alt+點選收藏市場商品和背包物品，區分鐵牛標準牛並顯示已收藏狀態；收錄了UI增強：強化等級美化和展開市場價格；市場快捷導航開關、預設跳轉等級與材料等級相容；裝備欄強化等級美化；掛單時間顯示最佳化；
// @author       baozhi
// @match        https://www.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://test.milkywayidle.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @icon         https://www.milkywayidle.com/favicon.svg
// @license MIT
// @run-at       document-start
// @downloadURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/Collection plugin.user.js
// @updateURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/Collection plugin.user.js
// ==/UserScript==

(function() {
    'use strict';

    let isUpdating = false;
    let favoriteUpdatePending = false;
    let pendingFavoriteContainers = [];
    let currentCharacterId = null;
    let pluginInitialized = false;
    let listingFilterInjected = false;
    let unifiedObserver = null;
    let itemObservers = new Map();
    let listingObserver = null;
    let observedListingTable = null;
    let listingFilterApplyTimer = null;
    let characterIdFallbackTimer = null;
    let settingsEscHandler = null;
    let runtimeCleanupFunctions = [];
    let marketSearchKeyword = '';
    let currentMainFilter = 'all';
    let extraFilters = { collectable: false };
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let characterSettingsCache = { id: null, values: new Map() };
    let webSocketHookedGetter = null;
    let originalMessageEventDataDescriptor = null;
    let enhancementPresetItemSpriteBase = null;
    let inventoryFavoriteMenuContext = null;
    let marketQuickLinksRenderFrame = null;
    let rangedWayIdleDisplayOptimizationFrame = null;
    let rangedWayIdleTimeTooltip = null;
    let rangedWayIdleTimeTooltipTarget = null;
    let rangedWayIdleTimeTooltipListenerCleanup = null;
    let marketQuickLinksDraggingId = null;
    let marketQuickLinksSuppressClick = false;
    let marketQuickLinksPopoverAnchor = null;
    let marketQuickLinksPopoverOutsideHandler = null;
    let marketQuickLinksPopoverKeyHandler = null;
    let marketQuickLinksPopoverViewportHandler = null;
    let marketQuickLinksFiberKeyName = null;
    let marketQuickLinksItemCatalogCache = null;
    let marketQuickLinksItemDetailMapsCache = null;
    const marketQuickLinksEnhanceabilityCache = new Map();
    const marketQuickLinksFiberKeyCache = new WeakMap();
    const MARKET_QUICK_LINKS_LIMIT = 24;
    const MARKET_QUICK_LINKS_BAR_ID = 'mwc-market-quick-links';
    const MARKET_QUICK_LINKS_BAR_SELECTOR = '.mwc-market-quick-links[data-mwc-market-quick-links="1"]';
    const MARKET_QUICK_LINKS_POPOVER_ID = 'mwc-market-quick-links-popover';
    const characterSettingKeys = [
        'mwc_favorite_shortcut',
        'mwc_favorites',
        'mwc_favorite_item_metadata',
        'mwc_market_quick_links',
        'mwc_market_quick_links_enabled',
        'mwc_market_quick_links_default_enhancement_level',
        'mwc_market_fav_enhance_highlight',
        'mwc_enhancement_level_enabled',
        'mwc_market_price_enabled',
        'mwc_ranged_way_idle_display_optimization_enabled',
        'mwc_action_queue_quick_order_enabled'
    ];
    const itemContainerSelector = [
        '.MarketplacePanel_marketItems__D4k7e .Item_itemContainer__x7kH1',
        '.Inventory_itemGrid__20YAH .Item_itemContainer__x7kH1',
        '.MarketplacePanel_itemSummaryTable__2g3gr .Item_itemContainer__x7kH1',
        '.MarketplacePanel_currentItem__3ercC .Item_itemContainer__x7kH1'
    ].join(', ');
    // 物品選單可從背包、倉庫及其它物品格開啟；不能只限製為 Inventory，
    // 否則倉庫的 Item_actionMenu 會沒有收藏按鈕。
    const itemActionMenuSourceSelector = '[class*="Item_itemContainer"]';
    const inventoryItemActionMenuSelector = [
        '[class*="Item_actionMenu"]',
        '[class*="Item_contextMenu"]'
    ].join(', ');
    const inventoryFavoriteMenuButtonClass = 'mwc-inventory-menu-favorite';

    // 全域性快捷鍵狀態追蹤
    let lastPressedKey = null;
    let lastPressedModifiers = { ctrl: false, shift: false, alt: false };

    function registerRuntimeCleanup(cleanup) {
        runtimeCleanupFunctions.push(cleanup);
        return cleanup;
    }

    function cleanupRuntime() {
        for (let i = runtimeCleanupFunctions.length - 1; i >= 0; i--) {
            try {
                runtimeCleanupFunctions[i]();
            } catch (error) {
                console.warn('[收藏外掛] 清理執行時資源失敗:', error);
            }
        }
        runtimeCleanupFunctions = [];
        if (listingFilterApplyTimer) {
            clearTimeout(listingFilterApplyTimer);
            listingFilterApplyTimer = null;
        }
        if (characterIdFallbackTimer) {
            clearTimeout(characterIdFallbackTimer);
            characterIdFallbackTimer = null;
        }
        inventoryFavoriteMenuContext = null;
        marketQuickLinksItemCatalogCache = null;
        marketQuickLinksItemDetailMapsCache = null;
        marketQuickLinksEnhanceabilityCache.clear();
        if (marketQuickLinksRenderFrame !== null) {
            cancelAnimationFrame(marketQuickLinksRenderFrame);
            marketQuickLinksRenderFrame = null;
        }
        if (rangedWayIdleDisplayOptimizationFrame !== null) {
            cancelAnimationFrame(rangedWayIdleDisplayOptimizationFrame);
            rangedWayIdleDisplayOptimizationFrame = null;
        }
        teardownRangedWayIdleTimeTooltip();
        closeMarketQuickLinksPopover();
        document.querySelectorAll(MARKET_QUICK_LINKS_BAR_SELECTOR).forEach(bar => bar.remove());
        if (settingsEscHandler) {
            document.removeEventListener('keydown', settingsEscHandler);
            settingsEscHandler = null;
        }
        if (webSocketHookedGetter && originalMessageEventDataDescriptor) {
            const messageEventPrototype = pageWindow.MessageEvent?.prototype;
            const currentDescriptor = messageEventPrototype &&
                Object.getOwnPropertyDescriptor(messageEventPrototype, 'data');
            if (currentDescriptor?.get === webSocketHookedGetter) {
                Object.defineProperty(messageEventPrototype, 'data', originalMessageEventDataDescriptor);
            }
        }
        webSocketHookedGetter = null;
        originalMessageEventDataDescriptor = null;
    }

    window.addEventListener('pagehide', cleanupRuntime, { once: true });

    // 獲取自定義收藏快捷鍵
    function getFavoriteShortcut() {
        const value = getCharacterSetting('mwc_favorite_shortcut', 'Alt');
        return typeof value === 'string' && value.length > 0 && value.length <= 20 ? value : 'Alt';
    }

    // 儲存自定義收藏快捷鍵
    function saveFavoriteShortcut(key) {
        const safeKey = typeof key === 'string' && key.length > 0 && key.length <= 20 ? key : 'Alt';
        saveCharacterSetting('mwc_favorite_shortcut', safeKey);
    }

    // 初始化快捷鍵監聽器
    function initShortcutKeyListeners() {
        const handleKeyDown = (e) => {
            // 對於修飾鍵（Ctrl, Shift, Alt），只更新修飾鍵狀態，不更新 lastPressedKey
            if (['Control', 'Shift', 'Alt'].includes(e.key)) {
                lastPressedModifiers = {
                    ctrl: e.ctrlKey && !e.metaKey,
                    shift: e.shiftKey,
                    alt: e.altKey
                };
                return;
            }

            // 對於非修飾鍵，同時更新按鍵和修飾鍵狀態
            lastPressedKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
            lastPressedModifiers = {
                ctrl: e.ctrlKey && !e.metaKey,
                shift: e.shiftKey,
                alt: e.altKey
            };
        };

        const handleKeyUp = (e) => {
            // 當釋放非修飾鍵時，重置 lastPressedKey
            if (!['Control', 'Shift', 'Alt'].includes(e.key)) {
                lastPressedKey = null;
            }

            // 無論釋放什麼鍵，都更新修飾鍵狀態
            lastPressedModifiers = {
                ctrl: e.ctrlKey && !e.metaKey,
                shift: e.shiftKey,
                alt: e.altKey
            };

            // 如果所有修飾鍵都釋放了，重置狀態
            if (!lastPressedModifiers.ctrl && !lastPressedModifiers.shift && !lastPressedModifiers.alt) {
                lastPressedKey = null;
            }
        };

        const handleBlur = () => {
            lastPressedKey = null;
            lastPressedModifiers = { ctrl: false, shift: false, alt: false };
        };
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, false);
        window.addEventListener('blur', handleBlur);
        registerRuntimeCleanup(() => {
            document.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('keyup', handleKeyUp, false);
            window.removeEventListener('blur', handleBlur);
        });
    }

    // 檢查是否按下了收藏快捷鍵
    function isFavoriteShortcutPressed() {
        const favoriteShortcut = getFavoriteShortcut();

        // 特殊處理：如果是單獨的修飾鍵（Ctrl, Shift, Alt）
        if (['Ctrl', 'Shift', 'Alt'].includes(favoriteShortcut)) {
            if (favoriteShortcut === 'Ctrl') return lastPressedModifiers.ctrl;
            if (favoriteShortcut === 'Shift') return lastPressedModifiers.shift;
            if (favoriteShortcut === 'Alt') return lastPressedModifiers.alt;
        }

        // 處理組合鍵（Ctrl+, Shift+, Alt+）
        const parts = favoriteShortcut.split('+');
        const modifierPart = parts.slice(0, -1).join('+');
        const mainKey = parts[parts.length - 1].toUpperCase();

        // 檢查修飾鍵
        const needCtrl = modifierPart.includes('Ctrl');
        const needShift = modifierPart.includes('Shift');
        const needAlt = modifierPart.includes('Alt');

        if (needCtrl !== lastPressedModifiers.ctrl) return false;
        if (needShift !== lastPressedModifiers.shift) return false;
        if (needAlt !== lastPressedModifiers.alt) return false;

        // 檢查主鍵是否匹配
        return lastPressedKey === mainKey || lastPressedKey === parts[parts.length - 1];
    }

    // 獲取鍵盤快捷鍵對應的鍵盤碼
    function getShortcutCode(key) {
        const keyCodeMap = {
            'A': 'KeyA', 'B': 'KeyB', 'C': 'KeyC', 'D': 'KeyD', 'E': 'KeyE',
            'F': 'KeyF', 'G': 'KeyG', 'H': 'KeyH', 'I': 'KeyI', 'J': 'KeyJ',
            'K': 'KeyK', 'L': 'KeyL', 'M': 'KeyM', 'N': 'KeyN', 'O': 'KeyO',
            'P': 'KeyP', 'Q': 'KeyQ', 'R': 'KeyR', 'S': 'KeyS', 'T': 'KeyT',
            'U': 'KeyU', 'V': 'KeyV', 'W': 'KeyW', 'X': 'KeyX', 'Y': 'KeyY', 'Z': 'KeyZ',
            '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4',
            '5': 'Digit5', '6': 'Digit6', '7': 'Digit7', '8': 'Digit8', '9': 'Digit9',
            'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6',
            'F7': 'F7', 'F8': 'F8', 'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12',
            'Space': 'Space',
            'Enter': 'Enter',
            'Escape': 'Escape',
            'Ctrl': 'Control',
            'Shift': 'ShiftLeft',
            'Alt': 'AltLeft'
        };
        return keyCodeMap[key] || 'Backquote';
    }

    // 使用Ranged Way Idle的方法：通過WebSocket監聽獲取角色ID
    function hookWebSocketForCharacterId() {
        if (webSocketHookedGetter) return;

        const messageEventPrototype = pageWindow.MessageEvent?.prototype;
        const webSocketConstructor = pageWindow.WebSocket;
        if (!messageEventPrototype || !webSocketConstructor) return;
        const originalDescriptor = Object.getOwnPropertyDescriptor(messageEventPrototype, "data");
        const originalGet = originalDescriptor?.get;
        if (typeof originalGet !== 'function') return;
        originalMessageEventDataDescriptor = originalDescriptor;

        function hookedGet() {
            const socket = this.currentTarget;
            if (!(socket instanceof webSocketConstructor) || !socket.url) {
                return originalGet.call(this);
            }
            const message = originalGet.call(this);
            if (typeof message !== 'string' || message[0] !== '{') {
                return message;
            }
            if (!/"type"\s*:\s*"init_character_data"/.test(message)) {
                return message;
            }
            try {
                const obj = JSON.parse(message);
                if (obj && obj.type === "init_character_data") {
                    updateCharacterFromWebSocket(obj);
                }
            } catch (err) {
            }
            return message;
        }

        webSocketHookedGetter = hookedGet;
        Object.defineProperty(messageEventPrototype, "data", {
            get: hookedGet,
            configurable: true,
            enumerable: true
        });
    }

    // 從WebSocket訊息更新角色資訊
    function updateCharacterFromWebSocket(obj) {
        if (obj && obj.character && obj.character.id) {
            const newCharacterId = obj.character.id.toString();

            if (newCharacterId !== currentCharacterId) {
                migrateDefaultCharacterValues(newCharacterId);
                currentCharacterId = newCharacterId;
                resetCharacterSettingsCache();
                marketQuickLinksItemCatalogCache = null;
                marketQuickLinksItemDetailMapsCache = null;
                marketQuickLinksEnhanceabilityCache.clear();

                if (pluginInitialized) {
                    applyCharacterSettings();
                    throttledMarkFavorites();
                    scheduleEnsureMarketQuickLinks();
                }
            }
        }

    }
    // 獲取角色ID
    function getCharacterId() {
        if (currentCharacterId && currentCharacterId !== 'default_character') {
            return currentCharacterId;
        }

        const urlCharacterId = new URL(window.location.href).searchParams.get('characterId');
        if (urlCharacterId) return urlCharacterId;

        const stateCharacterId = pageWindow.mwi?.character?.id
            ?? pageWindow.mwi?.game?.state?.character?.id
            ?? pageWindow.mwi?.game?.state?.characterInfo?.id
            ?? pageWindow.mwi?.game?.state?.characterInfo?.characterId;
        if (stateCharacterId) return stateCharacterId.toString();

        return currentCharacterId || 'default_character';
    }

    // 更新當前角色ID
    function updateCharacterId() {
        const newCharacterId = getCharacterId();
        if (newCharacterId !== currentCharacterId) {
            migrateDefaultCharacterValues(newCharacterId);
            currentCharacterId = newCharacterId;
            resetCharacterSettingsCache();
            marketQuickLinksItemCatalogCache = null;
            marketQuickLinksItemDetailMapsCache = null;
            marketQuickLinksEnhanceabilityCache.clear();
            if (pluginInitialized) {
                applyCharacterSettings();
                throttledMarkFavorites();
                scheduleEnsureMarketQuickLinks();
            }
        }
        return currentCharacterId;
    }

    function migrateDefaultCharacterValues(characterId) {
        if (!characterId || characterId === 'default_character') return;

        const existingKeys = new Set(GM_listValues());
        for (const baseKey of characterSettingKeys) {
            const legacyKey = `${baseKey}_default_character`;
            const targetKey = `${baseKey}_${characterId}`;
            if (existingKeys.has(legacyKey) && !existingKeys.has(targetKey)) {
                GM_setValue(targetKey, GM_getValue(legacyKey));
            }
        }
    }

    function resetCharacterSettingsCache() {
        characterSettingsCache = { id: currentCharacterId, values: new Map() };
    }

    function getCharacterSetting(baseKey, defaultValue) {
        updateCharacterId();
        if (characterSettingsCache.id !== currentCharacterId) {
            resetCharacterSettingsCache();
        }
        if (!characterSettingsCache.values.has(baseKey)) {
            characterSettingsCache.values.set(
                baseKey,
                GM_getValue(`${baseKey}_${currentCharacterId}`, defaultValue)
            );
        }
        return characterSettingsCache.values.get(baseKey);
    }

    function saveCharacterSetting(baseKey, value) {
        const characterKey = getCharacterKey(baseKey);
        GM_setValue(characterKey, value);
        if (characterSettingsCache.id === currentCharacterId) {
            characterSettingsCache.values.set(baseKey, value);
        }
    }

    // 獲取角色特定的儲存鍵
    function getCharacterKey(baseKey) {
        updateCharacterId();
        return `${baseKey}_${currentCharacterId}`;
    }

    // 獲取收藏列表
    function getFavorites() {
        const favorites = getCharacterSetting('mwc_favorites', []);
        if (!Array.isArray(favorites)) return [];
        return [...new Set(favorites.filter(item =>
            typeof item === 'string' && item.length > 0 && item.length <= 200
        ))];
    }

    // 儲存收藏列表
    function saveFavorites(favorites) {
        const safeFavorites = Array.isArray(favorites)
            ? [...new Set(favorites.filter(item =>
                typeof item === 'string' && item.length > 0 && item.length <= 200
            ))]
            : [];
        saveCharacterSetting('mwc_favorites', safeFavorites);
    }

    function getUseHref(node) {
        const useNode = node?.querySelector?.('use');
        if (!useNode) return null;
        const href = useNode.href?.baseVal || useNode.getAttribute?.('href') || '';
        return typeof href === 'string' && href.includes('#') ? href : null;
    }

    function normalizeFavoriteItemMetadata(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

        const metadata = {};
        for (const [itemKey, entry] of Object.entries(value)) {
            if (Object.keys(metadata).length >= 500) break;
            if (typeof itemKey !== 'string' || itemKey.length === 0 || itemKey.length > 200) continue;
            const spriteHref = typeof entry === 'string' ? entry : entry?.spriteHref;
            if (typeof spriteHref !== 'string' || spriteHref.length === 0 || spriteHref.length > 500 || !spriteHref.includes('#')) continue;
            metadata[itemKey] = { spriteHref };
        }
        return metadata;
    }

    function getFavoriteItemMetadata() {
        return normalizeFavoriteItemMetadata(getCharacterSetting('mwc_favorite_item_metadata', {}));
    }

    function saveFavoriteItemMetadata(metadata) {
        saveCharacterSetting('mwc_favorite_item_metadata', normalizeFavoriteItemMetadata(metadata));
    }

    function rememberFavoriteItemMetadata(itemKey, container) {
        if (!itemKey) return;
        const spriteHref = getUseHref(container);
        if (!spriteHref) return;

        const metadata = getFavoriteItemMetadata();
        if (metadata[itemKey]?.spriteHref === spriteHref) return;
        metadata[itemKey] = { spriteHref };
        saveFavoriteItemMetadata(metadata);
    }

    function removeFavoriteItemMetadata(itemKey) {
        if (!itemKey) return;
        const metadata = getFavoriteItemMetadata();
        if (!metadata[itemKey]) return;
        delete metadata[itemKey];
        saveFavoriteItemMetadata(metadata);
    }

    function hydrateFavoriteItemMetadata(favorites) {
        const favoriteSet = new Set(Array.isArray(favorites) ? favorites : getFavorites());
        if (!favoriteSet.size) return getFavoriteItemMetadata();

        const metadata = getFavoriteItemMetadata();
        let changed = false;
        document.querySelectorAll(itemContainerSelector).forEach(container => {
            const itemKey = getItemKey(container);
            if (!itemKey || !favoriteSet.has(itemKey) || metadata[itemKey]) return;
            const spriteHref = getUseHref(container);
            if (!spriteHref) return;
            metadata[itemKey] = { spriteHref };
            changed = true;
        });
        if (changed) saveFavoriteItemMetadata(metadata);
        return metadata;
    }

    function parseFavoriteItemKey(itemKey) {
        const value = typeof itemKey === 'string' ? itemKey.trim() : '';
        const match = value.match(/^(.*)\+(\d+)$/);
        return {
            itemKey: value,
            displayName: (match ? match[1] : value).trim(),
            enhancementLevel: match ? Math.max(0, parseInt(match[2], 10) || 0) : 0
        };
    }

    function normalizeMarketItemHrid(value) {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (!raw || raw.length > 220) return null;
        const normalized = raw.startsWith('/items/')
            ? raw
            : `/items/${raw.replace(/^\/+/, '')}`;
        return normalized === '/items/' ? null : normalized;
    }

    function getItemHridFromSpriteHref(spriteHref) {
        const href = typeof spriteHref === 'string' ? spriteHref.trim() : '';
        const hashIndex = href.lastIndexOf('#');
        if (hashIndex < 0 || hashIndex === href.length - 1) return null;
        return normalizeMarketItemHrid(href.slice(hashIndex + 1));
    }

    function getMarketQuickLinkIdentity(link) {
        const hrid = normalizeMarketItemHrid(link?.itemHrid);
        if (!hrid) return null;
        const level = Math.max(0, parseInt(link?.enhancementLevel, 10) || 0);
        return `${hrid}::${level}`;
    }

    function normalizeMarketQuickLink(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

        const parsed = parseFavoriteItemKey(value.itemKey || value.key || '');
        const spriteHref = typeof value.spriteHref === 'string' &&
            value.spriteHref.length <= 500 && value.spriteHref.includes('#')
            ? value.spriteHref
            : null;
        const itemHrid = normalizeMarketItemHrid(value.itemHrid) || getItemHridFromSpriteHref(spriteHref);
        if (!itemHrid) return null;

        const enhancementLevel = Number.isFinite(Number(value.enhancementLevel))
            ? Math.max(0, Math.min(99, parseInt(value.enhancementLevel, 10) || 0))
            : Math.min(99, parsed.enhancementLevel);
        const displayName = String(value.displayName || parsed.displayName || itemHrid.split('/').pop() || '')
            .trim()
            .slice(0, 200);
        if (!displayName) return null;

        return {
            itemKey: parsed.itemKey || `${displayName}${enhancementLevel > 0 ? `+${enhancementLevel}` : ''}`,
            itemHrid,
            enhancementLevel,
            displayName,
            spriteHref
        };
    }

    function getMarketQuickLinkItemDetailMaps() {
        if (marketQuickLinksItemDetailMapsCache) return marketQuickLinksItemDetailMapsCache;

        let mwi = null;
        let marketHost = null;
        try {
            mwi = pageWindow.mwi || window.mwi || null;
            marketHost = findMarketQuickLinksGameStateNode();
        } catch (error) {
        }

        const initDataCandidates = [
            mwi?.initClientData,
            mwi?.game?.initClientData,
            mwi?.game?.state?.initClientData,
            pageWindow.initClientData,
            marketHost?.props?.initClientData,
            marketHost?.state?.initClientData
        ];
        const itemDetailMaps = [];
        for (const initData of initDataCandidates) {
            const itemDetailMap = initData?.itemDetailMap;
            if (!itemDetailMap || typeof itemDetailMap !== 'object' || itemDetailMaps.includes(itemDetailMap)) continue;
            itemDetailMaps.push(itemDetailMap);
        }
        if (itemDetailMaps.length) marketQuickLinksItemDetailMapsCache = itemDetailMaps;
        return itemDetailMaps;
    }

    function getMarketQuickLinkItemDetail(itemHrid) {
        const hrid = normalizeMarketItemHrid(itemHrid);
        if (!hrid) return null;
        const alternateHrid = hrid.replace(/^\/items\//, '');

        for (const itemDetailMap of getMarketQuickLinkItemDetailMaps()) {
            for (const key of [hrid, alternateHrid]) {
                let detail = null;
                try {
                    detail = typeof itemDetailMap.get === 'function'
                        ? itemDetailMap.get(key)
                        : itemDetailMap[key];
                } catch (error) {
                }
                if (detail && typeof detail === 'object') return detail;
            }
        }
        return null;
    }

    // 遊戲原生以 enhancementCosts 是否非空判定物品能否強化；材料的該陣列為空。
    function getMarketQuickLinkEnhanceableState(itemHrid) {
        const hrid = normalizeMarketItemHrid(itemHrid);
        if (!hrid) return null;
        if (marketQuickLinksEnhanceabilityCache.has(hrid)) {
            return marketQuickLinksEnhanceabilityCache.get(hrid);
        }

        const detail = getMarketQuickLinkItemDetail(hrid);
        if (!detail) return null;

        let enhanceable = null;
        if (Object.prototype.hasOwnProperty.call(detail, 'enhancementCosts')) {
            enhanceable = Number(detail.enhancementCosts?.length || 0) >= 1;
        } else if (typeof detail.isEnhanceable === 'boolean') {
            enhanceable = detail.isEnhanceable;
        } else {
            const categoryHrid = String(detail.categoryHrid || detail.category || '').toLocaleLowerCase();
            if (categoryHrid && !categoryHrid.includes('equipment')) enhanceable = false;
        }

        if (enhanceable !== null) marketQuickLinksEnhanceabilityCache.set(hrid, enhanceable);
        return enhanceable;
    }

    function getMarketQuickLinkTargetEnhancementLevel(itemHrid) {
        return getMarketQuickLinkEnhanceableState(itemHrid) === false
            ? 0
            : getMarketQuickLinksDefaultEnhancementLevel();
    }

    function getMarketQuickLinks() {
        const raw = getCharacterSetting('mwc_market_quick_links', []);
        if (!Array.isArray(raw)) return [];

        const seen = new Set();
        const links = [];
        for (const value of raw) {
            const link = normalizeMarketQuickLinkForNavigation(value);
            const identity = getMarketQuickLinkIdentity(link);
            if (!link || !identity || seen.has(identity)) continue;
            seen.add(identity);
            links.push(link);
            if (links.length >= MARKET_QUICK_LINKS_LIMIT) break;
        }
        return links;
    }

    function saveMarketQuickLinks(values) {
        const seen = new Set();
        const links = [];
        for (const value of Array.isArray(values) ? values : []) {
            const link = normalizeMarketQuickLinkForNavigation(value);
            const identity = getMarketQuickLinkIdentity(link);
            if (!link || !identity || seen.has(identity)) continue;
            seen.add(identity);
            links.push(link);
            if (links.length >= MARKET_QUICK_LINKS_LIMIT) break;
        }
        saveCharacterSetting('mwc_market_quick_links', links);
        scheduleEnsureMarketQuickLinks();
        return links;
    }

    function getMarketQuickLinksEnabled() {
        const value = getCharacterSetting('mwc_market_quick_links_enabled', true);
        return typeof value === 'boolean' ? value : true;
    }

    function saveMarketQuickLinksEnabled(enabled) {
        saveCharacterSetting('mwc_market_quick_links_enabled', Boolean(enabled));
    }

    function getMarketQuickLinksDefaultEnhancementLevel() {
        const value = getCharacterSetting('mwc_market_quick_links_default_enhancement_level', 0);
        return Math.min(20, Math.max(0, parseInt(value, 10) || 0));
    }

    function saveMarketQuickLinksDefaultEnhancementLevel(level) {
        const safeLevel = Math.min(20, Math.max(0, parseInt(level, 10) || 0));
        saveCharacterSetting('mwc_market_quick_links_default_enhancement_level', safeLevel);
        return safeLevel;
    }

    // 快捷欄以統一的預設等級跳轉；不可強化物品始終進入 +0 市場。
    function normalizeMarketQuickLinkForNavigation(value) {
        const link = normalizeMarketQuickLink(value);
        if (!link) return null;
        return {
            ...link,
            enhancementLevel: getMarketQuickLinkTargetEnhancementLevel(link.itemHrid)
        };
    }

    function normalizeMarketQuickLinkLookupName(value) {
        return String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLocaleLowerCase();
    }

    function buildMarketQuickLinkNameToHridMap() {
        if (marketQuickLinksItemCatalogCache) return marketQuickLinksItemCatalogCache;
        const nameToHrid = new Map();
        const hridToDisplayName = new Map();
        const add = (name, hridValue, preferred = false) => {
            const displayName = String(name || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            const key = normalizeMarketQuickLinkLookupName(name);
            const hrid = normalizeMarketItemHrid(hridValue);
            if (!key || !hrid) return;
            if (!nameToHrid.has(key)) nameToHrid.set(key, hrid);
            if (displayName && (!hridToDisplayName.has(hrid) || preferred)) {
                hridToDisplayName.set(hrid, displayName);
            }
        };

        // 當前 DOM 是最可靠的本地化名稱來源，先放入以獲得最高優先順序。
        document.querySelectorAll('svg[aria-label]').forEach(svg => {
            add(svg.getAttribute('aria-label'), getItemHridFromSpriteHref(getUseHref(svg)), true);
        });

        const mwi = (() => {
            try { return pageWindow.mwi || window.mwi || null; } catch (error) { return null; }
        })();
        const directDict = mwi?.itemNameToHridDict;
        if (directDict instanceof Map) {
            directDict.forEach((hrid, name) => add(name, hrid, true));
        } else if (directDict && typeof directDict === 'object') {
            Object.entries(directDict).forEach(([name, hrid]) => add(name, hrid, true));
        }

        const stateNodes = [];
        const marketHost = findMarketQuickLinksGameStateNode();
        if (marketHost) stateNodes.push(marketHost);
        if (mwi?.game && !stateNodes.includes(mwi.game)) stateNodes.push(mwi.game);
        const gamePage = document.querySelector('[class^="GamePage"], [class*="GamePage_gamePage"]');
        const fiberKey = getMarketQuickLinksFiberKey(gamePage);
        let fiber = fiberKey && gamePage ? gamePage[fiberKey] : null;
        while (fiber) {
            if (fiber.stateNode && !stateNodes.includes(fiber.stateNode)) stateNodes.push(fiber.stateNode);
            fiber = fiber.return;
        }

        for (const stateNode of stateNodes) {
            const resources = stateNode?.props?.i18n?.options?.resources;
            if (!resources || typeof resources !== 'object') continue;
            let locale = '';
            try { locale = String(localStorage.getItem('i18nextLng') || '').toLocaleLowerCase(); } catch (error) {}
            if (!locale && /milkywayidlecn\.com/i.test(location.hostname)) locale = 'zh';
            for (const [language, resource] of Object.entries(resources)) {
                const itemNames = resource?.translation?.itemNames;
                if (!itemNames || typeof itemNames !== 'object') continue;
                const preferred = Boolean(locale) && String(language).toLocaleLowerCase().startsWith(locale.slice(0, 2));
                Object.entries(itemNames).forEach(([hrid, name]) => add(name, hrid, preferred));
            }
        }

        const initDataCandidates = [
            mwi?.initClientData,
            pageWindow.initClientData,
            marketHost?.props?.initClientData,
            marketHost?.state?.initClientData
        ];
        for (const initData of initDataCandidates) {
            const itemDetailMap = initData?.itemDetailMap;
            if (!itemDetailMap || typeof itemDetailMap !== 'object') continue;
            for (const [hrid, detail] of Object.entries(itemDetailMap)) {
                if (typeof detail?.name === 'string') {
                    add(detail.name, hrid);
                } else if (detail?.name && typeof detail.name === 'object') {
                    Object.values(detail.name).forEach(name => add(name, hrid));
                }
            }
        }
        Object.defineProperty(nameToHrid, 'hridToDisplayName', {
            value: hridToDisplayName,
            configurable: false,
            enumerable: false
        });
        if (nameToHrid.size >= 200) marketQuickLinksItemCatalogCache = nameToHrid;
        return nameToHrid;
    }

    function resolveMarketQuickLinkFavoriteHrid(displayName, nameToHrid) {
        const normalizedName = normalizeMarketQuickLinkLookupName(displayName);
        const exact = nameToHrid.get(normalizedName);
        if (exact) return exact;

        // 相容舊版收藏裡使用“裝備名（精）”表示精煉裝備的命名方式。
        const refinedPattern = /\s*(?:[（(]\s*精\s*[）)]|★|refined)\s*$/i;
        if (!refinedPattern.test(String(displayName || ''))) return null;
        const baseName = String(displayName || '').replace(refinedPattern, '').trim();
        const baseHrid = nameToHrid.get(normalizeMarketQuickLinkLookupName(baseName));
        if (!baseHrid) return null;
        return baseHrid.endsWith('_refined') ? baseHrid : `${baseHrid}_refined`;
    }

    function reconcileFavoritesWithGameCatalog() {
        const favorites = getFavorites();
        if (!favorites.length) return favorites;

        const catalog = buildMarketQuickLinkNameToHridMap();
        // 目錄不完整時只補全、不刪除，避免遊戲尚未載入完成時誤清收藏。
        if (catalog.size < 200) return favorites;

        const knownHrids = new Set(catalog.values());
        const hridToDisplayName = catalog.hridToDisplayName instanceof Map
            ? catalog.hridToDisplayName
            : new Map();
        const metadata = getFavoriteItemMetadata();
        const nextFavorites = [];
        const nextMetadata = {};
        const seenKeys = new Set();

        const isKnownHrid = hrid => Boolean(hrid) && (
            knownHrids.has(hrid) ||
            (hrid.endsWith('_refined') && knownHrids.has(hrid.replace(/_refined$/, '')))
        );

        for (const itemKey of favorites) {
            const parsed = parseFavoriteItemKey(itemKey);
            const metadataHrid = getItemHridFromSpriteHref(metadata[itemKey]?.spriteHref);
            let itemHrid = isKnownHrid(metadataHrid) ? metadataHrid : null;
            if (!itemHrid) {
                const resolved = resolveMarketQuickLinkFavoriteHrid(parsed.displayName, catalog);
                if (isKnownHrid(resolved)) itemHrid = resolved;
            }
            if (!itemHrid) continue;

            const currentName = hridToDisplayName.get(itemHrid) || parsed.displayName;
            const canonicalKey = `${currentName}${parsed.enhancementLevel > 0 ? `+${parsed.enhancementLevel}` : ''}`;
            if (!canonicalKey || seenKeys.has(canonicalKey)) continue;
            seenKeys.add(canonicalKey);
            nextFavorites.push(canonicalKey);

            const spriteHref = getItemSpriteHref(itemHrid) || metadata[itemKey]?.spriteHref || null;
            if (spriteHref) nextMetadata[canonicalKey] = { spriteHref };
        }

        const favoritesChanged = nextFavorites.length !== favorites.length ||
            nextFavorites.some((itemKey, index) => itemKey !== favorites[index]);
        const metadataChanged = JSON.stringify(normalizeFavoriteItemMetadata(metadata)) !==
            JSON.stringify(normalizeFavoriteItemMetadata(nextMetadata));
        if (favoritesChanged) saveFavorites(nextFavorites);
        if (metadataChanged) saveFavoriteItemMetadata(nextMetadata);
        if (favoritesChanged && pluginInitialized) markFavorites();
        return nextFavorites;
    }

    function getMarketQuickLinkChoices() {
        const favorites = reconcileFavoritesWithGameCatalog();
        const metadata = hydrateFavoriteItemMetadata(favorites);

        // 舊收藏可能沒有圖示後設資料；僅在使用者開啟選擇器時掃描一次當前可見物品補齊。
        const missingKeys = new Set(favorites.filter(itemKey => !metadata[itemKey]));
        if (missingKeys.size) {
            let metadataChanged = false;
            document.querySelectorAll('[class*="Item_itemContainer"]').forEach(container => {
                if (!missingKeys.size) return;
                const itemKey = getItemKey(container);
                if (!itemKey || !missingKeys.has(itemKey)) return;
                const spriteHref = getUseHref(container);
                if (!spriteHref) return;
                metadata[itemKey] = { spriteHref };
                missingKeys.delete(itemKey);
                metadataChanged = true;
            });
            if (metadataChanged) saveFavoriteItemMetadata(metadata);
        }

        // 仍缺失的舊收藏通過遊戲 i18n / initClientData 反查 HRID，並一次性補寫圖示後設資料。
        if (missingKeys.size) {
            const nameToHrid = buildMarketQuickLinkNameToHridMap();
            let metadataChanged = false;
            for (const itemKey of missingKeys) {
                const parsed = parseFavoriteItemKey(itemKey);
                const itemHrid = resolveMarketQuickLinkFavoriteHrid(parsed.displayName, nameToHrid);
                if (!itemHrid) continue;
                const spriteHref = getItemSpriteHref(itemHrid);
                if (!spriteHref) continue;
                metadata[itemKey] = { spriteHref };
                metadataChanged = true;
            }
            if (metadataChanged) saveFavoriteItemMetadata(metadata);
        }

        const links = getMarketQuickLinks();
        const choices = new Map();
        for (const link of links) {
            const identity = getMarketQuickLinkIdentity(link);
            choices.set(identity, { ...link, identity, selected: true, isFavorite: false, resolved: true });
        }

        for (const itemKey of favorites) {
            const parsed = parseFavoriteItemKey(itemKey);
            const spriteHref = metadata[itemKey]?.spriteHref || null;
            const itemHrid = getItemHridFromSpriteHref(spriteHref);
            const targetLevel = itemHrid ? getMarketQuickLinkTargetEnhancementLevel(itemHrid) : 0;
            const identity = itemHrid ? `${itemHrid}::${targetLevel}` : `missing::${itemKey}`;
            const existing = itemHrid
                ? choices.get(identity)
                : [...choices.values()].find(choice => choice.itemKey === itemKey);
            if (existing) {
                choices.set(existing.identity, {
                    ...existing,
                    itemKey,
                    displayName: parsed.displayName || existing.displayName,
                    spriteHref: spriteHref || existing.spriteHref,
                    isFavorite: true
                });
                continue;
            }
            choices.set(identity, {
                itemKey,
                itemHrid,
                enhancementLevel: targetLevel,
                displayName: parsed.displayName,
                spriteHref,
                identity,
                selected: false,
                isFavorite: true,
                resolved: Boolean(itemHrid)
            });
        }
        return [...choices.values()];
    }

    // 獲取市場強化裝備高亮開關狀態
    function getMarketFavoriteEnhanceHighlight() {
        const value = getCharacterSetting('mwc_market_fav_enhance_highlight', true);
        return typeof value === 'boolean' ? value : true;
    }

    // 儲存開關狀態
    function saveMarketFavoriteEnhanceHighlight(enabled) {
        saveCharacterSetting('mwc_market_fav_enhance_highlight', enabled);
    }

    // 獲取所有角色的收藏統計
    function getAllCharactersFavorites() {
        const favoritesByCharacter = {};

        for (const key of GM_listValues()) {
            if (key.startsWith('mwc_favorites_')) {
                const characterId = key.replace('mwc_favorites_', '');
                const value = GM_getValue(key, []);
                if (!Array.isArray(value)) continue;
                favoritesByCharacter[characterId] = {
                    favorites: value,
                    count: value.length
                };
            }
        }

        if (Object.keys(favoritesByCharacter).some(characterId => characterId !== 'default_character')) {
            delete favoritesByCharacter.default_character;
        }

        return favoritesByCharacter;
    }

    // 獲取強化等級美化開關狀態
    function getEnhancementLevelEnabled() {
        const value = getCharacterSetting('mwc_enhancement_level_enabled', true);
        return typeof value === 'boolean' ? value : true; // 預設開啟
    }

    // 儲存強化等級美化開關狀態
    function saveEnhancementLevelEnabled(enabled) {
        saveCharacterSetting('mwc_enhancement_level_enabled', enabled);
    }

    // 獲取展開市場價格開關狀態
    function getMarketPriceEnabled() {
        const value = getCharacterSetting('mwc_market_price_enabled', true);
        return typeof value === 'boolean' ? value : true; // 預設開啟
    }

    // 儲存展開市場價格開關狀態
    function saveMarketPriceEnabled(enabled) {
        saveCharacterSetting('mwc_market_price_enabled', enabled);
    }

    const RANGED_WAY_IDLE_TIME_CELL_SELECTOR = 'td.RangedWayIdleOrderBooksInfo';
    const RANGED_WAY_IDLE_BADGE_SELECTOR =
        '[class*="NavigationBar_navigationLinks"] > div:nth-child(4) [class*="NavigationBar_badges"]';

    function getRangedWayIdleDisplayOptimizationEnabled() {
        const value = getCharacterSetting('mwc_ranged_way_idle_display_optimization_enabled', false);
        return typeof value === 'boolean' ? value : false;
    }

    function saveRangedWayIdleDisplayOptimizationEnabled(enabled) {
        saveCharacterSetting('mwc_ranged_way_idle_display_optimization_enabled', Boolean(enabled));
    }

    function parseRangedWayIdleDuration(value) {
        const originalText = typeof value === 'string' ? value.trim() : '';
        if (!originalText || !/[天時分]/.test(originalText)) return null;

        const isNegative = originalText.includes('-');
        const days = parseInt(originalText.match(/(\d+)\s*天/)?.[1], 10) || 0;
        const hours = parseInt(originalText.match(/(\d+)\s*時/)?.[1], 10) || 0;
        const minutes = parseInt(originalText.match(/(\d+)\s*分/)?.[1], 10) || 0;
        return {
            originalText,
            totalMinutes: isNegative ? 0 : days * 24 * 60 + hours * 60 + minutes,
            isNegative
        };
    }

    function formatRangedWayIdleDuration(duration) {
        if (!duration) return null;
        if (duration.isNegative) return { text: '0m', color: '#00ff00' };
        const totalMinutes = Math.max(0, duration.totalMinutes || 0);
        const totalHours = totalMinutes / 60;
        let text = '';
        if (totalMinutes >= 24 * 60) {
            text = `${(totalMinutes / (24 * 60)).toFixed(1)}d`;
        } else if (totalMinutes >= 60) {
            text = `${totalHours.toFixed(1)}h`;
        } else {
            text = `${totalMinutes.toFixed(1)}m`;
        }

        let color = '#ff0000';
        if (totalHours < 12) color = '#00ff00';
        else if (totalHours < 24) color = '#ffffff';
        else if (totalHours < 48) color = '#a52a2a';
        return { text, color };
    }

    function formatRangedWayIdleCreationDate(totalMinutes, now = Date.now()) {
        const date = new Date(now - Math.max(0, totalMinutes || 0) * 60 * 1000);
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
            `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function getRangedWayIdleCreationTime(duration) {
        return formatRangedWayIdleCreationDate(duration.totalMinutes);
    }

    function getRangedWayIdleTimeCellFromNode(node) {
        return node instanceof Element
            ? node.closest('[data-mwc-rwi-creation-time]')
            : null;
    }

    function getOrCreateRangedWayIdleTimeTooltip() {
        if (rangedWayIdleTimeTooltip?.isConnected) return rangedWayIdleTimeTooltip;

        const tooltip = document.createElement('div');
        tooltip.className = 'mwc-rwi-time-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltip);
        rangedWayIdleTimeTooltip = tooltip;
        return tooltip;
    }

    function positionRangedWayIdleTimeTooltip(tooltip, clientX, clientY) {
        const margin = 10;
        tooltip.style.left = `${Math.round(clientX + 12)}px`;
        tooltip.style.top = `${Math.round(clientY + 16)}px`;

        const rect = tooltip.getBoundingClientRect();
        const maxLeft = Math.max(margin, document.documentElement.clientWidth - rect.width - margin);
        const maxTop = Math.max(margin, document.documentElement.clientHeight - rect.height - margin);
        tooltip.style.left = `${Math.round(Math.min(Math.max(margin, clientX + 12), maxLeft))}px`;
        tooltip.style.top = `${Math.round(Math.min(Math.max(margin, clientY + 16), maxTop))}px`;
    }

    function showRangedWayIdleTimeTooltip(cell, clientX, clientY) {
        const creationTime = cell?.dataset?.mwcRwiCreationTime;
        if (!creationTime) return;

        const tooltip = getOrCreateRangedWayIdleTimeTooltip();
        rangedWayIdleTimeTooltipTarget = cell;
        tooltip.textContent = creationTime;
        tooltip.classList.add('is-visible');
        positionRangedWayIdleTimeTooltip(tooltip, clientX, clientY);
    }

    function hideRangedWayIdleTimeTooltip() {
        rangedWayIdleTimeTooltipTarget = null;
        rangedWayIdleTimeTooltip?.classList.remove('is-visible');
    }

    function ensureRangedWayIdleTimeTooltipListeners() {
        if (rangedWayIdleTimeTooltipListenerCleanup) return;

        const handlePointerOver = event => {
            const cell = getRangedWayIdleTimeCellFromNode(event.target);
            if (!cell) {
                hideRangedWayIdleTimeTooltip();
                return;
            }
            if (cell === rangedWayIdleTimeTooltipTarget) return;
            if (event.relatedTarget instanceof Node && cell.contains(event.relatedTarget)) return;
            showRangedWayIdleTimeTooltip(cell, event.clientX, event.clientY);
        };
        const handlePointerOut = event => {
            const cell = getRangedWayIdleTimeCellFromNode(event.target);
            if (!cell || cell !== rangedWayIdleTimeTooltipTarget) return;
            if (event.relatedTarget instanceof Node && cell.contains(event.relatedTarget)) return;
            hideRangedWayIdleTimeTooltip();
        };
        const hideTooltip = () => hideRangedWayIdleTimeTooltip();

        document.addEventListener('pointerover', handlePointerOver);
        document.addEventListener('pointerout', handlePointerOut);
        document.addEventListener('scroll', hideTooltip, true);
        window.addEventListener('blur', hideTooltip);
        rangedWayIdleTimeTooltipListenerCleanup = () => {
            document.removeEventListener('pointerover', handlePointerOver);
            document.removeEventListener('pointerout', handlePointerOut);
            document.removeEventListener('scroll', hideTooltip, true);
            window.removeEventListener('blur', hideTooltip);
        };
    }

    function teardownRangedWayIdleTimeTooltip() {
        hideRangedWayIdleTimeTooltip();
        rangedWayIdleTimeTooltipListenerCleanup?.();
        rangedWayIdleTimeTooltipListenerCleanup = null;
        rangedWayIdleTimeTooltip?.remove();
        rangedWayIdleTimeTooltip = null;
    }

    function applyRangedWayIdleTimeCell(cell) {
        const duration = parseRangedWayIdleDuration(cell?.textContent);
        if (!duration) return false;

        if (!cell.hasAttribute('data-mwc-rwi-original-time')) {
            cell.dataset.mwcRwiOriginalColor = cell.style.color || '';
            cell.dataset.mwcRwiHadTitle = cell.hasAttribute('title') ? '1' : '0';
            cell.dataset.mwcRwiOriginalTitle = cell.getAttribute('title') || '';
        }
        cell.dataset.mwcRwiOriginalTime = duration.originalText;

        const formatted = formatRangedWayIdleDuration(duration);
        cell.textContent = formatted.text;
        cell.style.color = formatted.color;
        cell.dataset.mwcRwiCreationTime = getRangedWayIdleCreationTime(duration);
        cell.removeAttribute('title');
        return true;
    }

    function optimizeRangedWayIdleTable(table) {
        const headers = [...table.querySelectorAll('th')];
        if (!headers.length) return;

        for (const header of headers) {
            const originalText = header.dataset.mwcRwiOriginalHeader || header.textContent.trim();
            if (originalText === '估計建立時間') {
                if (!header.hasAttribute('data-mwc-rwi-original-header')) {
                    header.dataset.mwcRwiOriginalHeader = originalText;
                }
                if (header.textContent.trim() !== '時長') header.textContent = '時長';
            } else if (originalText === '掛單所有者') {
                if (!header.hasAttribute('data-mwc-rwi-original-header')) {
                    header.dataset.mwcRwiOriginalHeader = originalText;
                }
                if (header.textContent.trim() !== '掛單者') header.textContent = '掛單者';
            }
        }

        const ownerColumnIndex = headers.findIndex(header => {
            const originalText = header.dataset.mwcRwiOriginalHeader || header.textContent.trim();
            return originalText === '掛單所有者' || originalText === '掛單者';
        });
        if (ownerColumnIndex < 0) return;

        table.querySelectorAll('tbody tr').forEach(row => {
            const cell = row.querySelectorAll('td')[ownerColumnIndex];
            cell?.classList.add('mwc-rwi-owner-cell');
        });
    }

    function clearRangedWayIdleDisplayOptimization() {
        if (rangedWayIdleDisplayOptimizationFrame !== null) {
            cancelAnimationFrame(rangedWayIdleDisplayOptimizationFrame);
            rangedWayIdleDisplayOptimizationFrame = null;
        }
        teardownRangedWayIdleTimeTooltip();
        document.querySelectorAll('[data-mwc-rwi-original-time]').forEach(cell => {
            cell.textContent = cell.dataset.mwcRwiOriginalTime || '';
            cell.style.color = cell.dataset.mwcRwiOriginalColor || '';
            if (cell.dataset.mwcRwiHadTitle === '1') {
                cell.setAttribute('title', cell.dataset.mwcRwiOriginalTitle || '');
            } else {
                cell.removeAttribute('title');
            }
            delete cell.dataset.mwcRwiOriginalTime;
            delete cell.dataset.mwcRwiOriginalColor;
            delete cell.dataset.mwcRwiHadTitle;
            delete cell.dataset.mwcRwiOriginalTitle;
            delete cell.dataset.mwcRwiCreationTime;
        });
        document.querySelectorAll('[data-mwc-rwi-original-header]').forEach(header => {
            header.textContent = header.dataset.mwcRwiOriginalHeader || '';
            delete header.dataset.mwcRwiOriginalHeader;
        });
        document.querySelectorAll('.mwc-rwi-owner-cell').forEach(cell => {
            cell.classList.remove('mwc-rwi-owner-cell');
        });
        document.querySelectorAll('.mwc-rwi-hidden-badge').forEach(badge => {
            badge.classList.remove('mwc-rwi-hidden-badge');
        });
    }

    function applyRangedWayIdleDisplayOptimization() {
        if (!getRangedWayIdleDisplayOptimizationEnabled()) {
            clearRangedWayIdleDisplayOptimization();
            return;
        }

        ensureRangedWayIdleTimeTooltipListeners();
        const tables = new Set();
        document.querySelectorAll(RANGED_WAY_IDLE_TIME_CELL_SELECTOR).forEach(cell => {
            applyRangedWayIdleTimeCell(cell);
            const table = cell.closest('table');
            if (table) tables.add(table);
        });
        tables.forEach(optimizeRangedWayIdleTable);
        document.querySelectorAll(RANGED_WAY_IDLE_BADGE_SELECTOR).forEach(badge => {
            badge.classList.add('mwc-rwi-hidden-badge');
        });
    }

    function scheduleRangedWayIdleDisplayOptimization() {
        if (!getRangedWayIdleDisplayOptimizationEnabled() || rangedWayIdleDisplayOptimizationFrame !== null) return;
        if (typeof requestAnimationFrame !== 'function') {
            applyRangedWayIdleDisplayOptimization();
            return;
        }
        rangedWayIdleDisplayOptimizationFrame = requestAnimationFrame(() => {
            rangedWayIdleDisplayOptimizationFrame = null;
            applyRangedWayIdleDisplayOptimization();
        });
    }

    function applyCharacterSettings() {
        if (!currentCharacterId || !document.body) return;

        const enhancementEnabled = getCharacterSetting('mwc_enhancement_level_enabled', true);
        const priceEnabled = getCharacterSetting('mwc_market_price_enabled', true);

        if (enhancementEnabled) {
            document.body.setAttribute('data-enhancement', '1');
        } else {
            document.body.removeAttribute('data-enhancement');
        }
        if (priceEnabled) {
            document.body.setAttribute('data-price', '1');
        } else {
            document.body.removeAttribute('data-price');
        }
        document.querySelectorAll('.MarketplacePanel_price__hIzrY').forEach(element => {
            priceProcessed(element, priceEnabled);
        });

        scheduleEnsureMarketQuickLinks();
        if (getRangedWayIdleDisplayOptimizationEnabled()) {
            scheduleRangedWayIdleDisplayOptimization();
        } else {
            clearRangedWayIdleDisplayOptimization();
        }
        actionQueueQuickOrder.refresh();
    }

    // 嚴格檢查是否為市場列表容器（僅市場列表觸發模糊匹配）
    function isMarketListContainer(container) {
        return container.closest('.MarketplacePanel_marketItems__D4k7e') !== null;
    }

    // 獲取強化等級
    function getEnhancementLevel(container) {
        const enhancementEl = container.querySelector('.Item_enhancementLevel__19g-e');
        if (!enhancementEl) return null;

        const levelText = enhancementEl.textContent.trim();
        if (levelText === '' || levelText === '0') return null;

        const match = levelText.match(/\+?(\d+)/);
        return match ? parseInt(match[1]) : null;
    }

    // 生成收藏鍵名
    function getItemKey(container) {
        const itemName = getItemName(container);
        if (!itemName) return null;

        const enhancementLevel = getEnhancementLevel(container);
        return enhancementLevel !== null ? `${itemName}+${enhancementLevel}` : itemName;
    }

    // 獲取物品基礎名稱
    function getItemName(container) {
        const svg = container.querySelector('svg[aria-label]');
        return svg ? svg.getAttribute('aria-label') : null;
    }

    function getItemSpriteHref(itemValue, node = null) {
        const directHref = getUseHref(node);
        if (directHref) return directHref;

        const rawValue = String(itemValue || '');
        if (rawValue.includes('#') && rawValue.includes('items_sprite')) return rawValue;
        const itemId = rawValue.split(/[\/#]/).pop();
        if (!itemId) return null;

        if (!enhancementPresetItemSpriteBase) {
            try {
                const sampleUse = document.querySelector('use[href*="items_sprite"]');
                const sampleHref = sampleUse?.href?.baseVal || sampleUse?.getAttribute?.('href') || '';
                if (sampleHref.includes('#')) {
                    enhancementPresetItemSpriteBase = sampleHref.split('#')[0];
                }
            } catch (error) {
                enhancementPresetItemSpriteBase = null;
            }
        }

        const spriteBase = enhancementPresetItemSpriteBase || '/static/media/items_sprite.328d6606.svg';
        return `${spriteBase}#${itemId}`;
    }

    function createItemSpriteIcon(itemValue, className, label) {
        const wrapper = document.createElement('span');
        wrapper.className = className;
        wrapper.setAttribute('aria-hidden', 'true');

        const href = getItemSpriteHref(itemValue);
        if (!href || typeof document.createElementNS !== 'function') {
            wrapper.textContent = '⚒';
            return wrapper;
        }

        try {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', label || 'item');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.setAttribute('focusable', 'false');
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', href);
            svg.appendChild(use);
            wrapper.appendChild(svg);
        } catch (error) {
            wrapper.textContent = '⚒';
        }
        return wrapper;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>'"]/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        })[character]);
    }

    // 從收藏鍵獲取基礎物品名
    function getBaseItemName(itemKey) {
        return itemKey.includes('+') ? itemKey.split('+')[0] : itemKey;
    }

    // 檢查是否為強化裝備收藏（+1及以上）
    function isEnhancedFavorite(favKey) {
        const parts = favKey.split('+');
        return parts.length === 2 && !isNaN(parseInt(parts[1])) && parseInt(parts[1]) > 0;
    }

    // 新增/移除收藏
    function toggleFavorite(itemKey) {
        let favorites = getFavorites();
        const index = favorites.indexOf(itemKey);

        if (index > -1) {
            favorites.splice(index, 1);
        } else {
            favorites.push(itemKey);
        }

        saveFavorites(favorites);
        return index > -1; // 返回toggle前的收藏狀態
    }

    function toggleFavoriteFromItem(itemKey, itemContainer = null) {
        if (!itemKey) return null;

        const wasFavorited = toggleFavorite(itemKey);
        if (wasFavorited) {
            removeFavoriteItemMetadata(itemKey);
        } else {
            rememberFavoriteItemMetadata(itemKey, itemContainer);
        }

        // 收藏狀態跨背包、市場和詳情共用；使用者主動切換時完整重新整理當前可見物品。
        markFavorites();
        itemContainer?.classList?.toggle('favorited', !wasFavorited);
        return !wasFavorited;
    }

    function getActiveInventoryFavoriteMenuContext() {
        if (!inventoryFavoriteMenuContext) return null;
        if (Date.now() - inventoryFavoriteMenuContext.createdAt > 2000) {
            inventoryFavoriteMenuContext = null;
            return null;
        }
        return inventoryFavoriteMenuContext;
    }

    function getItemKeyFromActionMenu(menu) {
        const nameElement = menu?.querySelector?.('[class*="Item_name"]');
        const itemName = nameElement?.textContent?.trim();
        if (!itemName) return null;

        const enhancementLevel = getEnhancementLevel(menu);
        return enhancementLevel !== null ? `${itemName}+${enhancementLevel}` : itemName;
    }

    // 點選來源可提供最準確的圖示和強化等級；選單自身的名稱用於兜底，
    // 這樣倉庫等非同步掛載的物品選單也能正常注入。
    function resolveInventoryFavoriteMenuContext(menu) {
        const activeContext = getActiveInventoryFavoriteMenuContext();
        if (activeContext?.itemKey) return activeContext;

        const itemKey = getItemKeyFromActionMenu(menu);
        return itemKey ? { itemKey, itemContainer: menu } : null;
    }

    function updateInventoryFavoriteMenuButton(button, itemKey) {
        const isFavorited = getFavorites().includes(itemKey);
        button.textContent = isFavorited ? '★ 取消收藏' : '☆ 收藏';
        button.title = isFavorited ? '取消收藏當前物品' : '收藏當前物品';
        button.setAttribute('aria-pressed', String(isFavorited));
        button.dataset.favorited = String(isFavorited);
    }

    function injectInventoryFavoriteMenuButton(menu) {
        if (!menu || menu.querySelector(`.${inventoryFavoriteMenuButtonClass}`)) return;

        const context = resolveInventoryFavoriteMenuContext(menu);
        if (!context?.itemKey) return;

        const row = document.createElement('div');
        row.className = `${inventoryFavoriteMenuButtonClass}-row`;
        Object.assign(row.style, {
            display: 'flex',
            width: '100%',
            boxSizing: 'border-box'
        });

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `Button_button__1Fe9z Button_fullWidth__17pVU ${inventoryFavoriteMenuButtonClass}`;
        button.style.flex = '1 1 0';
        button.style.minWidth = '0';
        updateInventoryFavoriteMenuButton(button, context.itemKey);
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();

            const isFavorited = toggleFavoriteFromItem(context.itemKey, context.itemContainer);
            if (isFavorited === null) return;
            updateInventoryFavoriteMenuButton(button, context.itemKey);
            showKeyboardHint(`${isFavorited ? '已收藏' : '已取消收藏'}：${context.itemKey}`);
        });

        row.appendChild(button);
        menu.appendChild(row);
    }

    function processInventoryFavoriteMenuMutations(mutations) {
        // 有點選上下文時，選單有時會先被包在 Popper 根節點中再插入；
        // 僅在該短暫視窗掃描子樹，避免把全域性 body observer 變成高頻深度查詢。
        const hasActiveContext = Boolean(getActiveInventoryFavoriteMenuContext());
        for (const mutation of mutations) {
            if (mutation.type !== 'childList') continue;
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches?.(inventoryItemActionMenuSelector)) {
                    injectInventoryFavoriteMenuButton(node);
                }
                if (hasActiveContext) {
                    node.querySelectorAll?.(inventoryItemActionMenuSelector).forEach(injectInventoryFavoriteMenuButton);
                }
            }
        }
    }

    function rememberInventoryFavoriteMenuContext(event) {
        if (event.button !== 0) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('[data-mwc-action-queue-next]')) {
            inventoryFavoriteMenuContext = null;
            return;
        }
        if (isFavoriteShortcutPressed()) {
            inventoryFavoriteMenuContext = null;
            return;
        }
        const itemContainer = target?.closest(itemActionMenuSourceSelector);
        if (!itemContainer) {
            if (!target?.closest(inventoryItemActionMenuSelector)) {
                inventoryFavoriteMenuContext = null;
            }
            return;
        }

        const itemKey = getItemKey(itemContainer);
        if (!itemKey || !itemContainer.querySelector('svg[aria-label]')) return;
        inventoryFavoriteMenuContext = {
            itemKey,
            itemContainer,
            createdAt: Date.now()
        };
    }

    // 防抖函式
    function debounce(func, delay, immediate = false) {
        let timeoutId;
        let lastExecTime = 0;

        return function(...args) {
            const now = Date.now();
            clearTimeout(timeoutId);

            if (immediate && lastExecTime === 0) {
                lastExecTime = now;
                return func.apply(this, args);
            }

            timeoutId = setTimeout(() => {
                if (!immediate || now - lastExecTime >= delay) {
                    func.apply(this, args);
                    lastExecTime = Date.now();
                }
            }, delay);
        };
    }

    // 標記收藏函式
    function markFavorites(containers = null) {
        if (isUpdating) {
            favoriteUpdatePending = true;
            if (containers === null) {
                pendingFavoriteContainers = null;
            } else if (pendingFavoriteContainers !== null) {
                pendingFavoriteContainers = [
                    ...(pendingFavoriteContainers || []),
                    ...containers
                ];
            }
            return;
        }

        isUpdating = true;

        requestAnimationFrame(() => {
            const favorites = getFavorites();
            const favoriteSet = new Set(favorites);
            const enhancedFavoriteBases = new Set(
                favorites.filter(isEnhancedFavorite).map(getBaseItemName)
            );
            const marketEnhanceEnabled = getMarketFavoriteEnhanceHighlight();
            const targetContainers = containers === null
                ? [...document.querySelectorAll(itemContainerSelector)]
                : [...new Set(containers)].filter(container => container?.isConnected);

            // 直接遍歷目標節點，避免給逗號分隔的選擇器統一追加類名時只命中最後一項。
            targetContainers.forEach(container => container.classList.remove('favorited'));

            // 應用收藏樣式
            targetContainers.forEach(container => {
                const svg = container.querySelector('svg[aria-label]');
                if (!svg) return;

                const itemKey = getItemKey(container);
                if (!itemKey) return;

                let shouldHighlight = false;

                // 1. 精確匹配收藏（所有介面通用，優先順序最高）
                if (favoriteSet.has(itemKey)) {
                    shouldHighlight = true;
                }
                // 2. 模糊匹配：嚴格限制僅市場列表容器
                else if (marketEnhanceEnabled) {
                    // 必須是市場列表容器
                    if (isMarketListContainer(container)) {
                        // 當前物品必須是+0
                        if (getEnhancementLevel(container) === null) {
                            const baseItemName = getItemName(container);
                            // 檢查收藏列表中是否有該基礎物品的強化版本
                            if (enhancedFavoriteBases.has(baseItemName)) {
                                shouldHighlight = true;
                            }
                        }
                    }
                }

                if (shouldHighlight) {
                    container.classList.add('favorited');
                }
            });

            isUpdating = false;
            if (favoriteUpdatePending) {
                const pending = pendingFavoriteContainers;
                favoriteUpdatePending = false;
                pendingFavoriteContainers = null;
                markFavorites(pending);
            }
        });
    }

    const throttledMarkFavorites = debounce(markFavorites, 200);

    // 強化等級美化函式
    function enhancementProcessed(element) {
        if (element.classList.contains('enhancementProcessed')) return;
        const levelText = element.textContent.trim();
        const levelNumber = levelText.replace('+', '');
        if (!isNaN(levelNumber) && levelNumber >= 1) {
            element.classList.add('enhancementProcessed');
            element.classList.add(`enhancementLevel_${levelNumber}`);
        }
    }

    // 市場價格美化函式
    function priceProcessed(element, removeProcessed) {
        removeProcessed = removeProcessed || false;
        if (removeProcessed) element.classList.remove('price-processed');
        if (getMarketPriceEnabled()) {
            if (element.classList.contains('price-processed')) {
                if (element.querySelector('span span') !== null) {
                    element.classList.remove('price-processed');
                    priceProcessed(element)
                }
                return;
            }
            element.classList.add('price-processed');
            const span = element.querySelector('span');
            if (!span) return;
            const originalText = span.textContent.trim();

            // 儲存原始文本，用於還原時無損恢復
            element.dataset.originalPriceText = originalText;

            const match = originalText.match(/^(\d+\.?\d*)([KMB])$/i);

            let fullNumber;
            if (match) {
                const number = parseFloat(match[1]);
                const unit = match[2].toUpperCase();

                switch(unit) {
                    case 'K': fullNumber = number * 1000; break;
                    case 'M': fullNumber = number * 1000000; break;
                    case 'B': fullNumber = number * 1000000000; break;
                    default: return;
                }
            } else {
                fullNumber = originalText;
            }
            const formatted = fullNumber.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            const parts = formatted.split(',');
            let newHTML = '';

            if (parts.length >= 4) {
                newHTML = `<span class="price_b">${parts[0]},</span><span class="price_m">${parts[1]},</span><span class="price_k">${parts[2]},</span><span class="price_0">${parts.slice(3).join(',')}</span>`;
            } else if (parts.length === 3) {
                newHTML = `<span class="price_m">${parts[0]},</span><span class="price_k">${parts[1]},</span><span class="price_0">${parts[2]}</span>`;
            } else if (parts.length === 2) {
                newHTML = `<span class="price_k">${parts[0]},</span><span class="price_0">${parts[1]}</span>`;
            } else {
                newHTML = `<span class="price_0">${parts[0]}</span>`;
            }
            span.innerHTML = newHTML;
        } else {
            if (!element.classList.contains('price-processed')) return;
            element.classList.remove('price-processed');
            const span = element.querySelector('span');
            if (!span) return;

            // 從儲存的原始文本無損還原，避免 parseInt 精度丟失
            const savedOriginal = element.dataset.originalPriceText;
            if (savedOriginal) {
                span.textContent = savedOriginal;
                delete element.dataset.originalPriceText;
            } else {
                // 降級：如果沒有儲存的原始文本，嘗試從格式化內容重建
                const billionPart = span.querySelector('.price_b');
                const millionPart = span.querySelector('.price_m');
                const thousandPart = span.querySelector('.price_k');
                const zeroPart = span.querySelector('.price_0');
                let num = zeroPart ? parseFloat(zeroPart.textContent) : 0;
                if (billionPart) {
                    num += parseFloat(billionPart.textContent.replace(',', '')) * 1000000000;
                }
                if (millionPart) {
                    num += parseFloat(millionPart.textContent.replace(',', '')) * 1000000;
                }
                if (thousandPart) {
                    num += parseFloat(thousandPart.textContent.replace(',', '')) * 1000;
                }
                let text;
                if (num < 100000) {
                    text = num.toString();
                } else if (num < 10000000) {
                    text = (num / 1000) + 'K';
                } else if (num < 10000000000) {
                    text = (num / 1000000) + 'M';
                } else {
                    text = (num / 1000000000) + 'B';
                }
                span.textContent = text;
            }
        }
    }

   GM_addStyle(`
        button[data-mwc-action-queue-next] {
            position: relative;
            min-width: 26px;
        }
        button[data-mwc-action-queue-next]:disabled {
            cursor: default;
            opacity: 0.42;
            filter: saturate(0.35);
        }

        .Item_itemContainer__x7kH1.favorited {
            box-shadow: 0 0 0 3px var(--color-orange-300) !important;
            border-radius: 4px !important;
            transition: box-shadow 0.2s ease, background-color 0.2s ease;
        }
        .Item_itemContainer__x7kH1.favorited:hover {
            animation: favoritePulse 0.6s ease-in-out;
            box-shadow: 0 0 0 6px rgba(255, 165, 0, 0.3) !important;
        }
        @keyframes favoritePulse {
            0% { box-shadow: 0 0 0 3px var(--color-orange-300); }
            50% { box-shadow: 0 0 0 6px rgba(255, 165, 0, 0.3); }
            100% { box-shadow: 0 0 0 3px var(--color-orange-300); }
        }
        .Item_itemContainer__x7kH1.favorited .Item_item__2De2O {
            background: var(--color-orange-800) !important;
            border-radius: 4px;
        }
        .MarketplacePanel_itemSummaryTable__2g3gr .Item_itemContainer__x7kH1.favorited {
            box-shadow: 0 0 0 2px var(--color-orange-300) !important;
        }
        .MarketplacePanel_itemSummaryTable__2g3gr .Item_itemContainer__x7kH1.favorited .Item_item__2De2O {
            background: rgba(255, 165, 0, 0.1) !important;
            border: 1px solid var(--color-orange-300) !important;
        }

/* 強化等級美化 */
body[data-enhancement="1"] .enhancementLevel_1,
body[data-enhancement="1"] .enhancementLevel_2,
body[data-enhancement="1"] .enhancementLevel_3,
body[data-enhancement="1"] .enhancementLevel_4 {
    color: var(--color-neutral-200) !important;
}

body[data-enhancement="1"] .enhancementLevel_5,
body[data-enhancement="1"] .enhancementLevel_6,
body[data-enhancement="1"] .enhancementLevel_7 {
    color: var(--color-ocean-300) !important;
}

body[data-enhancement="1"] .enhancementLevel_8,
body[data-enhancement="1"] .enhancementLevel_9,
body[data-enhancement="1"] .enhancementLevel_10 {
    color: #c98cff !important;
}

body[data-enhancement="1"] .enhancementLevel_11,
body[data-enhancement="1"] .enhancementLevel_12,
body[data-enhancement="1"] .enhancementLevel_13 {
    color: var(--color-orange-500) !important;
}

/* 14 級：深橙色 */
body[data-enhancement="1"] .enhancementLevel_14 {
    color: #ff8c00 !important;
    text-shadow: 0 0 4px rgba(255, 140, 0, 0.5) !important;
}

/* 15 級：柔和金橙色 */
body[data-enhancement="1"] .enhancementLevel_15 {
    color: #ffb84d !important;
    text-shadow: 0 0 5px rgba(255, 184, 77, 0.5), 0 0 10px rgba(255, 184, 77, 0.3) !important;
    font-weight: 600;
}

/* 16 級：琥珀金 + 強光暈 */
body[data-enhancement="1"] .enhancementLevel_16 {
    color: #ff9500 !important;
    text-shadow: 0 0 8px rgba(255, 149, 0, 0.7), 0 0 16px rgba(255, 149, 0, 0.4) !important;
    font-weight: 600;
}

/* 17 級：烈焰橙紅 + 強光暈 */
body[data-enhancement="1"] .enhancementLevel_17 {
    color: #ff4500 !important;
    text-shadow: 0 0 10px rgba(255, 69, 0, 0.8), 0 0 20px rgba(255, 69, 0, 0.5) !important;
    font-weight: 600;
}

/* 18 級：深紅寶石 + 強光暈 */
body[data-enhancement="1"] .enhancementLevel_18 {
    color: #dc143c !important;
    text-shadow: 0 0 12px rgba(220, 20, 60, 0.9), 0 0 24px rgba(220, 20, 60, 0.6) !important;
    font-weight: 600;
}

/* 19 級：柔和粉彩漸變（靜態，弱化配色）+ 強光暈 */
body[data-enhancement="1"] .enhancementLevel_19 {
    background: linear-gradient(135deg,
        #ffb3ba,  /* 淡粉 */
        #ffdfb3,  /* 淡杏 */
        #ffffb3,  /* 淡黃 */
        #b3ffb3,  /* 淡綠 */
        #b3d9ff,  /* 淡藍 */
        #e0b3ff   /* 淡紫 */
    );
    -webkit-background-clip: text !important;
    background-clip: text !important;
    color: transparent !important;
    font-weight: 700;
    text-shadow: 0 0 8px rgba(255, 255, 255, 0.6), 0 0 12px rgba(200, 200, 255, 0.4) !important;
}

/* 20 級：高飽和動態旋轉彩虹漸變 + 光暈 */
body[data-enhancement="1"] .enhancementLevel_20 {
    position: relative;
    --gradient-angle: 0deg;
    background: linear-gradient(var(--gradient-angle),
        var(--color-burble-300) 10%,
        var(--color-space-400) 25%,
        var(--color-ocean-400) 50%,
        var(--color-jade-500) 75%,
        var(--color-orange-300) 87%,
        var(--color-coral-500));
    -webkit-background-clip: text !important;
    background-clip: text !important;
    color: transparent !important;
    font-weight: 700;
    text-shadow: 0 0 5px var(--color-neutral-0-opacity-25) !important;
    animation: rotateGradient 3s linear infinite;
}

@keyframes rotateGradient {
    to { --gradient-angle: 360deg; }
}

@property --gradient-angle {
    syntax: "<angle>";
    inherits: false;
    initial-value: 0deg;
}


        /* 展開市場價格 */
        body[data-price="1"] .MarketplacePanel_price__hIzrY span{color:var(--color-orange-400)!important}
        body[data-price="1"] .MarketplacePanel_price__hIzrY span.price_k{color:var(--color-orange-200)!important}
        body[data-price="1"] .MarketplacePanel_price__hIzrY span.price_m{color:var(--color-jade-300)!important}
        body[data-price="1"] .MarketplacePanel_price__hIzrY span.price_b{color:var(--color-ocean-300)!important}

        /* 掛單時間顯示最佳化 */
        .mwc-rwi-time-tooltip {
            display: none;
            position: fixed;
            z-index: 2147483647;
            pointer-events: none;
            padding: 4px 7px;
            border: 1px solid rgba(255, 255, 255, 0.22);
            border-radius: 3px;
            background: rgba(20, 24, 30, 0.96);
            color: #fff;
            font-size: 12px;
            font-variant-numeric: tabular-nums;
            line-height: 1.4;
            white-space: nowrap;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
        }
        .mwc-rwi-time-tooltip.is-visible { display: block; }
        .mwc-rwi-owner-cell {
            max-width: 7ch !important;
            white-space: normal !important;
            word-break: break-word !important;
            height: auto !important;
            padding: 2px 4px !important;
        }
        .mwc-rwi-hidden-badge { display: none !important; }

        /* 鍵盤快捷鍵提示樣式 */
        .keyboard-shortcut-hint {
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 5px 10px;
            border-radius: 4px;
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            font-size: 12px;
            animation: fadeInOut 3s ease-in-out;
            display: none;
        }

        @keyframes fadeInOut {
            0% { opacity: 0; transform: translateY(-10px); }
            10% { opacity: 1; transform: translateY(0); }
            90% { opacity: 1; transform: translateY(0); }
            100% { opacity: 0; transform: translateY(-10px); }
        }

        /* 設定面板樣式 */
        .mwc-settings {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        }
        .mwc-settings-content {
            background: var(--color-midnight-900); border: 2px solid var(--color-space-300);
            border-radius: 8px; padding: 20px; max-width: 600px; width: 90%;
            max-height: 80%; overflow-y: auto; color: var(--color-text-dark-mode);
            position: relative;
        }
        .mwc-settings h3 { margin-top: 0; color: var(--color-ocean-300); }
        .mwc-toggle {
            display: flex; align-items: center; gap: 10px; margin: 15px 0;
            padding: 12px; background: var(--color-midnight-600); border-radius: 6px;
            border-left: 3px solid var(--color-orange-400);
        }
        .mwc-toggle input[type="checkbox"] {
            width: 20px; height: 20px; accent-color: var(--color-orange-400);
        }
        .mwc-toggle label { color: var(--color-text-dark-mode); font-size: 14px; flex: 1; cursor: pointer; }
        .mwc-toggle-status { font-size: 12px; color: var(--color-orange-300); font-weight: bold; }
        .mwc-threshold-setting {
            display: flex; align-items: center; gap: 10px; margin: 10px 0 15px 30px;
            padding: 10px; background: var(--color-midnight-700); border-radius: 6px;
        }
        .mwc-threshold-setting label {
            font-size: 13px; color: var(--color-neutral-300); white-space: nowrap;
        }
        .mwc-threshold-input {
            background: var(--color-midnight-800); color: var(--color-text-dark-mode);
            border: 1px solid var(--color-space-300); border-radius: 4px;
            padding: 4px 8px; width: 60px; text-align: center;
            font-size: 13px;
        }
        .mwc-threshold-input:focus {
            outline: none; border-color: var(--color-orange-400);
        }
        .mwc-threshold-hint {
            font-size: 11px; color: var(--color-neutral-400); margin-left: 8px;
        }
        .mwc-favorites-list {
            max-height: 300px; overflow-y: auto; margin: 10px 0;
            padding: 10px; background: var(--color-midnight-700); border-radius: 4px;
        }
        .mwc-favorite-item {
            display: flex; justify-content: space-between; align-items: center;
            padding: 8px; margin: 4px 0; background: var(--color-midnight-600);
            border-radius: 4px; border-left: 3px solid var(--color-orange-400);
            gap: 8px;
        }
        .mwc-favorite-item-main {
            display: flex; align-items: center; gap: 8px; min-width: 0;
        }
        .mwc-favorite-item-icon {
            flex: 0 0 auto; width: 32px; height: 32px; display: inline-flex;
            align-items: center; justify-content: center; overflow: hidden;
            border-radius: 4px; background: var(--color-midnight-900);
            color: var(--color-neutral-400); font-size: 18px;
        }
        .mwc-favorite-item-icon svg {
            width: 100%; height: 100%; display: block;
        }
        .mwc-btn, .mwc-remove-fav, .mwc-close {
            border: none; color: white; border-radius: 4px; cursor: pointer;
            transition: background-color 0.2s ease;
        }
        .mwc-btn { background: var(--color-orange-500); padding: 8px 16px; margin: 5px; }
        .mwc-btn:hover { background: var(--color-orange-400); }
        .mwc-inline-action {
            flex: 0 0 auto; padding: 4px 8px;
            border: 1px solid var(--color-midnight-500); border-radius: 4px;
            background: var(--color-midnight-700); color: var(--color-neutral-200);
            cursor: pointer; font-size: 12px;
        }
        .mwc-inline-action:hover {
            background: var(--color-midnight-600); border-color: var(--color-ocean-400);
        }
        .mwc-remove-fav {
            background: var(--color-warning); padding: 4px 8px; font-size: 12px;
        }
        .mwc-remove-fav:hover { background: var(--color-scarlet-500); }
        .mwc-close {
            position: absolute; top: 10px; right: 10px;
            background: var(--color-scarlet-500); width: 30px; height: 30px; border-radius: 50%;
        }
        .level-tag { color: var(--color-orange-300) !important; font-weight: bold; margin-left: 8px; }
        .character-info {
            background: var(--color-midnight-700); padding: 10px; border-radius: 6px;
            margin: 10px 0; border-left: 3px solid var(--color-ocean-400);
        }
        .character-list {
            max-height: 200px; overflow-y: auto; margin: 10px 0;
            padding: 10px; background: var(--color-midnight-800); border-radius: 4px;
        }
        .character-item {
            padding: 8px; margin: 4px 0; background: var(--color-midnight-700);
            border-radius: 4px; display: flex; justify-content: space-between;
        }
        .character-item.current {
            border-left: 3px solid var(--color-orange-400);
            background: var(--color-midnight-600);
        }

        /* 懸浮提醒框樣式 - 不擠壓原生元素，位置在進度條下面 */
        .mwc-enhance-alert-overlay {
            position: fixed !important;
            top: 110px !important;
            left: 23% !important;
            transform: translateX(-50%) !important;
            z-index: 10000 !important;
            background: rgba(0, 0, 0, 0.9) !important;
            border: 3px solid #ff0000 !important;
            border-radius: 12px !important;
            padding: 0px 12px !important;
            box-shadow: 0 0 20px rgba(255, 0, 0, 0.6), 0 0 40px rgba(255, 0, 0, 0.3) !important;
            animation: alertPulse 1.5s infinite alternate !important;
            pointer-events: none !important;
            min-width: 340px !important;
            text-align: center !important;
        }

        .mwc-enhance-alert-overlay .alert-text {
            color: #ff0000 !important;
            font-size: 18px !important;
            font-weight: bold !important;
            text-shadow: 0 0 10px rgba(255, 0, 0, 0.8) !important;
            margin: 0 !important;
        }

        /* 懸浮大按鈕樣式 - 不擠壓原生元素，可拖拽 */
        .mwc-enhance-stop-button-overlay {
            position: fixed !important;
            z-index: 10001 !important;
            pointer-events: auto !important;
            user-select: none !important;
        }

        .mwc-enhance-stop-button-overlay button {
            padding: 0 !important;
            font-size: 24px !important;
            font-weight: bold !important;
            min-width: 180px !important;
            min-height: 70px !important;
            border-radius: 12px !important;
            background: linear-gradient(135deg, #ff0000, #ff4500) !important;
            border: 3px solid #ff0000 !important;
            box-shadow: 0 0 20px rgba(255, 0, 0, 0.7), 0 0 40px rgba(255, 0, 0, 0.4) !important;
            color: white !important;
            cursor: move !important;
            transition: all 0.3s ease !important;
            animation: buttonPulse 2s infinite ease-in-out !important;
            position: relative !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
            align-items: center !important;
        }

        .mwc-enhance-stop-button-overlay button:hover {
            box-shadow: 0 0 30px rgba(255, 0, 0, 0.9), 0 0 60px rgba(255, 0, 0, 0.6) !important;
            background: linear-gradient(135deg, #ff4500, #ff0000) !important;
        }

        .mwc-enhance-stop-button-overlay button:active {
            cursor: grabbing !important;
        }

        .mwc-enhance-stop-button-overlay.dragging button {
            animation: none !important;
            opacity: 0.9 !important;
            cursor: grabbing !important;
        }

        .mwc-enhance-stop-button-overlay .resize-handle {
            position: absolute !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 20px !important;
            height: 20px !important;
            cursor: se-resize !important;
            background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.5) 50%) !important;
            border-radius: 0 0 12px 0 !important;
            z-index: 10 !important;
        }

        .mwc-enhance-stop-button-overlay.resizing {
            opacity: 0.95 !important;
        }

        .mwc-enhance-stop-button-overlay .stop-info {
            display: flex !important;
            justify-content: center !important;
            align-items: center !important;
            gap: 8px !important;
            margin-bottom: 4px !important;
            font-size: 14px !important;
        }

        .mwc-enhance-stop-button-overlay .stop-level {
            color: #ffdd00 !important;
            font-weight: bold !important;
            text-shadow: 0 0 5px rgba(255, 221, 0, 0.8) !important;
        }

        .mwc-enhance-stop-button-overlay .stop-attempts {
            color: #ffffff !important;
        }

        @keyframes alertPulse {
            0% {
                border-color: #ff0000;
                box-shadow: 0 0 20px rgba(255, 0, 0, 0.6), 0 0 40px rgba(255, 0, 0, 0.3);
            }
            50% {
                border-color: #ff4500;
                box-shadow: 0 0 30px rgba(255, 0, 0, 0.8), 0 0 60px rgba(255, 0, 0, 0.5);
            }
            100% {
                border-color: #ff0000;
                box-shadow: 0 0 20px rgba(255, 0, 0, 0.6), 0 0 40px rgba(255, 0, 0, 0.3);
            }
        }

        @keyframes buttonPulse {
            0%, 100% {
                box-shadow: 0 0 20px rgba(255, 0, 0, 0.7), 0 0 40px rgba(255, 0, 0, 0.4);
            }
            50% {
                box-shadow: 0 0 30px rgba(255, 0, 0, 0.9), 0 0 60px rgba(255, 0, 0, 0.6);
            }
        }

        /* MWI Autopilot 風格的停止按鈕樣式 */
        #mwc-enhance-stop-button-overlay.dragging button,
        #mwc-enhance-stop-button-overlay.resizing button {
            animation: none !important;
            opacity: 0.85 !important;
            cursor: grabbing !important;
        }

        .mwc_bs_r1 {
            display: flex;
            align-items: baseline;
            justify-content: center;
            gap: 0.3em;
            line-height: 1;
            z-index: 1;
        }

        .mwc_bs_lv {
            font-size: 2.8em;
            font-weight: 900;
            color: #f8e0a0;
            text-shadow: 0 0 20px rgba(248, 224, 160, 0.6), 0 2px 6px rgba(0, 0, 0, 0.8);
        }

        .mwc_bs_dot {
            font-size: 2em;
            color: rgba(212, 175, 55, 0.4);
            margin: 0 0.1em;
        }

        .mwc_bs_att {
            font-size: 2.8em;
            font-weight: 900;
            color: #f0d478;
            text-shadow: 0 0 18px rgba(240, 212, 120, 0.5), 0 2px 6px rgba(0, 0, 0, 0.8);
        }

        .mwc_bs_u {
            font-size: 1.2em;
            color: rgba(240, 212, 120, 0.55);
            margin-left: 0.15em;
            font-weight: 600;
        }

        .mwc_bs_r2 {
            font-size: 0.85em;
            font-weight: 600;
            color: rgba(212, 175, 55, 0.3);
            letter-spacing: 0.15em;
            z-index: 1;
        }

        @keyframes mwc_bsp {
            0%, 100% {
                box-shadow: 0 0 20px rgba(212, 175, 55, 0.2), 0 0 50px rgba(212, 175, 55, 0.06), inset 0 1px 0 rgba(255, 225, 120, 0.18), inset 0 -1px 0 rgba(212, 175, 55, 0.06);
            }
            50% {
                box-shadow: 0 0 30px rgba(212, 175, 55, 0.35), 0 0 65px rgba(212, 175, 55, 0.1), inset 0 1px 0 rgba(255, 225, 120, 0.22), inset 0 -1px 0 rgba(212, 175, 55, 0.08);
            }
        }

        .script-filter-group button {
            cursor: pointer;
            transition: opacity 0.15s;
        }
        .script-filter-group button:hover {
            opacity: 0.85;
        }
        .script-filter-group button.active-filter {
            outline: 2px solid var(--color-neutral-100) !important;
            outline-offset: -2px;
        }

        .script-search-container {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin: 0 10px;
        }

        .script-search-input {
            width: 160px;
            padding: 4px 8px;
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 4px;
            background: rgba(255, 255, 255, 0.1);
            color: white;
            font-size: 12px;
            outline: none;
            transition: all 0.2s ease;
            box-sizing: border-box;
        }
        .script-search-input:focus {
            border-color: #4CAF50;
            background: rgba(255, 255, 255, 0.15);
        }

        .script-clear-search {
            background: rgba(255, 99, 71, 0.8);
            border: none;
            border-radius: 4px;
            color: white;
            width: 22px;
            height: 22px;
            cursor: pointer;
            font-size: 12px;
            display: none;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }
        .script-clear-search:hover {
            background: rgba(255, 99, 71, 1);
        }

        .mwc-market-quick-links-host {
            display: flex !important;
            align-items: center;
            gap: 6px;
            width: 100% !important;
            max-width: none !important;
            min-width: 0;
            box-sizing: border-box;
        }
        .mwc-market-quick-links-host > [class*="Input_inputContainer"] {
            flex: 0 0 18rem;
            width: 18rem;
            min-width: 18rem;
            max-width: 18rem;
        }
        .mwc-market-quick-links {
            display: flex;
            align-items: center;
            gap: 4px;
            flex: 1 1 auto;
            min-width: 38px;
            max-width: 60rem;
            height: 36px;
            box-sizing: border-box;
            letter-spacing: 0;
        }
        .mwc-market-quick-links-nav {
            flex: 0 1 auto;
            width: auto;
            max-width: min(60rem, 100%);
            margin-left: 4px;
        }
        .mwc-market-quick-links-strip {
            display: flex;
            align-items: center;
            gap: 4px;
            flex: 0 1 auto;
            min-width: 0;
            overflow-x: auto;
            overflow-y: hidden;
            padding: 1px;
            scrollbar-width: none;
        }
        .mwc-market-quick-links-strip::-webkit-scrollbar {
            width: 0;
            height: 0;
        }
        .mwc-market-quick-link-button,
        .mwc-market-quick-link-add {
            position: relative;
            width: 34px;
            height: 34px;
            min-width: 34px;
            min-height: 34px;
            flex: 0 0 34px;
            margin: 0;
            padding: 2px;
            border: 1px solid rgba(144, 166, 235, 0.55);
            border-radius: 4px;
            background: #282844;
            color: #eef1ff;
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            cursor: pointer;
            line-height: 1;
            letter-spacing: 0;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
            transition: border-color 0.15s ease, background-color 0.15s ease, opacity 0.15s ease;
        }
        .mwc-market-quick-link-button:hover,
        .mwc-market-quick-link-add:hover {
            border-color: rgba(255, 197, 92, 0.95);
            background: #343451;
        }
        .mwc-market-quick-link-button.is-active {
            border-color: #ffc55c;
            box-shadow: 0 0 0 2px rgba(255, 197, 92, 0.25);
        }
        .mwc-market-quick-link-button.is-dragging {
            opacity: 0.45;
        }
        .mwc-market-quick-link-button.is-drop-target {
            border-color: #7dd3fc;
            box-shadow: 0 0 0 2px rgba(125, 211, 252, 0.28);
        }
        .mwc-market-quick-link-button:disabled {
            cursor: wait;
            opacity: 0.65;
        }
        .mwc-market-quick-link-add {
            flex-shrink: 0;
            font-size: 24px;
            font-weight: 500;
            padding-bottom: 4px;
            border-color: rgba(144, 166, 235, 0.28);
            background: #1b1d2d;
            color: #8d96b2;
        }
        .mwc-market-quick-link-add:hover {
            border-color: rgba(144, 166, 235, 0.52);
            background: #25283b;
            color: #c5cbe0;
        }
        .mwc-market-quick-link-icon-frame {
            position: relative;
            width: 28px;
            height: 28px;
            min-width: 28px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
        }
        .mwc-market-quick-link-icon {
            width: 28px;
            height: 28px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #d7dbea;
            font-size: 18px;
            overflow: hidden;
        }
        .mwc-market-quick-link-icon svg {
            display: block;
            width: 100%;
            height: 100%;
        }
        .mwc-market-quick-link-picker {
            position: fixed;
            z-index: 2147483000;
            width: min(420px, calc(100vw - 16px));
            max-height: min(460px, calc(100vh - 16px));
            padding: 10px;
            border: 1px solid rgba(144, 166, 235, 0.58);
            border-radius: 6px;
            background: var(--color-midnight-900, #171827);
            color: var(--color-neutral-100, #eef1ff);
            box-sizing: border-box;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
            font: 12px/1.35 Arial, sans-serif;
            letter-spacing: 0;
        }
        .mwc-market-quick-link-picker-header {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 26px;
            margin-bottom: 8px;
        }
        .mwc-market-quick-link-picker-header strong {
            flex: 0 1 auto;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 14px;
            letter-spacing: 0;
        }
        .mwc-market-quick-link-picker-filter {
            display: inline-flex;
            align-items: center;
            flex: 0 0 auto;
            padding: 2px;
            border: 1px solid rgba(144, 166, 235, 0.4);
            border-radius: 4px;
            background: rgba(7, 9, 17, 0.45);
        }
        .mwc-market-quick-link-picker-filter-button {
            min-width: 48px;
            height: 22px;
            padding: 0 7px;
            border: 0;
            border-radius: 3px;
            background: transparent;
            color: var(--color-neutral-400, #9ca3af);
            cursor: pointer;
            font-size: 11px;
            line-height: 22px;
            letter-spacing: 0;
        }
        .mwc-market-quick-link-picker-filter-button:hover {
            color: #ffffff;
            background: rgba(255, 255, 255, 0.07);
        }
        .mwc-market-quick-link-picker-filter-button.is-active {
            background: #465174;
            color: #ffffff;
        }
        .mwc-market-quick-link-picker-count {
            margin-left: auto;
            color: var(--color-neutral-400, #9ca3af);
            font-variant-numeric: tabular-nums;
        }
        .mwc-market-quick-link-picker-close {
            width: 26px;
            height: 26px;
            padding: 0;
            border: 0;
            border-radius: 4px;
            background: transparent;
            color: #c7cbd7;
            cursor: pointer;
            font-size: 20px;
            line-height: 24px;
        }
        .mwc-market-quick-link-picker-close:hover {
            background: rgba(255, 255, 255, 0.09);
            color: #ffffff;
        }
        .mwc-market-quick-link-picker-search {
            width: 100%;
            height: 32px;
            margin: 0 0 9px;
            padding: 4px 8px;
            border: 1px solid rgba(144, 166, 235, 0.45);
            border-radius: 4px;
            background: rgba(9, 11, 20, 0.72);
            color: #ffffff;
            outline: none;
            box-sizing: border-box;
            font-size: 12px;
            letter-spacing: 0;
        }
        .mwc-market-quick-link-picker-search:focus {
            border-color: #7dd3fc;
        }
        .mwc-market-quick-link-picker-grid {
            display: grid;
            grid-template-columns: repeat(8, minmax(0, 1fr));
            gap: 4px;
            max-height: 365px;
            overflow-y: auto;
            overscroll-behavior: contain;
            padding: 1px;
            scrollbar-width: thin;
        }
        .mwc-market-quick-link-picker-item {
            position: relative;
            min-width: 0;
            height: 42px;
            padding: 3px;
            border: 1px solid rgba(144, 166, 235, 0.32);
            border-radius: 4px;
            background: #24253a;
            color: #e7eaf3;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-sizing: border-box;
            overflow: hidden;
            letter-spacing: 0;
        }
        .mwc-market-quick-link-picker-item:hover:not(:disabled) {
            border-color: #7dd3fc;
            background: #2d3048;
        }
        .mwc-market-quick-link-picker-item.is-selected {
            border-color: #ffc55c;
            background: #3a3024;
        }
        .mwc-market-quick-link-picker-item:disabled {
            opacity: 0.42;
            cursor: not-allowed;
        }
        .mwc-market-picker-icon-frame {
            width: 27px;
            height: 27px;
            min-width: 27px;
        }
        .mwc-market-picker-icon-frame .mwc-market-quick-link-icon {
            width: 27px;
            height: 27px;
        }
        .mwc-market-quick-link-picker-check {
            position: absolute;
            top: 3px;
            right: 4px;
            width: 13px;
            height: 13px;
            border-radius: 50%;
            background: #ffc55c;
            color: #21190d;
            font-size: 9px;
            font-weight: 800;
            line-height: 13px;
            text-align: center;
        }
        .mwc-market-quick-link-picker-empty {
            grid-column: 1 / -1;
            padding: 28px 10px;
            color: var(--color-neutral-400, #9ca3af);
            text-align: center;
        }
        @media (max-width: 800px) {
            .mwc-market-quick-links-host {
                flex-wrap: wrap;
            }
            .mwc-market-quick-links-host > [class*="Input_inputContainer"] {
                flex: 1 1 100%;
                width: 100%;
                min-width: 0;
                max-width: none;
            }
            .mwc-market-quick-links {
                flex: 1 1 100%;
                max-width: 100%;
            }
            .mwc-market-quick-links.mwc-market-quick-links-nav {
                flex: 0 1 auto;
                width: auto;
                max-width: 100%;
            }
        }
        @media (max-width: 480px) {
            .mwc-market-quick-link-picker-grid {
                grid-template-columns: repeat(7, minmax(0, 1fr));
            }
        }
        @media (max-width: 360px) {
            .mwc-market-quick-link-picker-grid {
                grid-template-columns: repeat(6, minmax(0, 1fr));
            }
        }

        .script-table-row-hidden {
            display: none !important;
        }
    `);

    function isCollectableItem(row) {
        try {
            const collectButton = row.querySelector('[class*="MarketplacePanel_claimsContainer"] button');
            const claimsContent = row.querySelector('[class*="MarketplacePanel_claims"]:not([class*="claimsContainer"])');
            return !!(collectButton &&
                     claimsContent &&
                     claimsContent.children.length > 0 &&
                     collectButton.textContent?.includes('收集'));
        } catch (error) {
            return false;
        }
    }

    function isRowSell(row) {
        const dataIsSell = row.getAttribute('data-is-sell');
        if (dataIsSell !== null) return dataIsSell === 'true';

        const typeCell = row.children[1];
        if (typeCell) {
            const cls = Array.from(typeCell.classList).join(' ').toLowerCase();
            const txt = (typeCell.textContent || '').toLowerCase();
            if (cls.includes('sell') || txt.includes('sell') || txt.includes('出售') || txt.includes('賣')) {
                return true;
            }
            if (cls.includes('buy') || txt.includes('buy') || txt.includes('購買') || txt.includes('買')) {
                return false;
            }
        }
        return null;
    }

    function applyListingFilters() {
        const table = document.querySelector('[class*="MarketplacePanel_myListingsTable"]');
        if (!table) return;

        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row => {
            const svg = row.querySelector('svg[aria-label]');
            const itemName = svg?.getAttribute('aria-label') || '';
            let show = !marketSearchKeyword ||
                itemName.toLowerCase().includes(marketSearchKeyword.toLowerCase());

            if (show && currentMainFilter === 'sell') {
                show = isRowSell(row) === true;
            } else if (show && currentMainFilter === 'buy') {
                show = isRowSell(row) === false;
            }

            if (show && extraFilters.collectable) {
                show = isCollectableItem(row);
            }
            row.classList.toggle('script-table-row-hidden', !show);
            row.style.display = '';
        });

        const filterGroup = document.querySelector('.script-filter-group');
        if (filterGroup) {
            filterGroup.querySelectorAll('button[data-filter-role="main"]').forEach(btn => {
                btn.classList.toggle('active-filter', btn.getAttribute('data-filter-type') === currentMainFilter);
            });
            filterGroup.querySelectorAll('button[data-filter-role="extra"]').forEach(btn => {
                const key = btn.getAttribute('data-filter-type');
                btn.classList.toggle('active-filter', extraFilters[key]);
            });
        }
    }

    function setMainFilter(type) {
        currentMainFilter = type;
        applyListingFilters();
    }

    function toggleExtraFilter(key) {
        extraFilters[key] = !extraFilters[key];
        applyListingFilters();
    }

    function filterMarketItems() {
        try {
            applyListingFilters();

            const clearBtn = document.querySelector('.script-clear-search');
            if (clearBtn) {
                clearBtn.style.display = marketSearchKeyword ? 'flex' : 'none';
            }
        } catch (error) {
            console.error('[收藏外掛] 過濾市場物品失敗:', error);
        }
    }

    function getMarketQuickLinksFiberKey(element) {
        if (!element) return null;
        const cached = marketQuickLinksFiberKeyCache.get(element);
        if (cached) return cached;
        if (marketQuickLinksFiberKeyName && marketQuickLinksFiberKeyName in element) {
            marketQuickLinksFiberKeyCache.set(element, marketQuickLinksFiberKeyName);
            return marketQuickLinksFiberKeyName;
        }
        for (const key of Reflect.ownKeys(element)) {
            if (typeof key === 'string' && key.startsWith('__reactFiber$')) {
                marketQuickLinksFiberKeyName = key;
                marketQuickLinksFiberKeyCache.set(element, key);
                return key;
            }
        }
        return null;
    }

    function findMarketQuickLinksGameStateNode() {
        const selectors = [
            '[class^="GamePage"]',
            '[class*="GamePage_gamePage"]',
            '[class*="GamePage"]'
        ];
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (!element) continue;
            const key = getMarketQuickLinksFiberKey(element);
            if (!key) continue;
            let fiber = element[key];
            while (fiber) {
                const node = fiber.stateNode;
                if (node && (
                    typeof node.handleGoToMarketplace === 'function' ||
                    typeof node.goToMarketplace === 'function' ||
                    typeof node.openMarketplace === 'function' ||
                    typeof node.handleOpenMarketplace === 'function'
                )) {
                    return node;
                }
                fiber = fiber.return;
            }
        }
        try {
            return pageWindow.mwi?.game || pageWindow.PGE?.core || null;
        } catch (error) {
            return null;
        }
    }

    function openMarketplaceQuickLinkByCore(link) {
        const host = findMarketQuickLinksGameStateNode();
        if (!host) return false;
        const openMarketplace = host.handleGoToMarketplace ||
            host.goToMarketplace ||
            host.openMarketplace ||
            host.handleOpenMarketplace;
        if (typeof openMarketplace !== 'function') return false;

        const level = Math.max(0, parseInt(link.enhancementLevel, 10) || 0);
        const argumentLists = [
            [link.itemHrid, level],
            [{ itemHrid: link.itemHrid, enhancementLevel: level }],
            [link.itemHrid]
        ];
        for (const argumentsList of argumentLists) {
            try {
                openMarketplace.call(host, ...argumentsList);
                return true;
            } catch (error) {
            }
        }
        return false;
    }

    function isMarketQuickLinkElementVisible(element) {
        if (!element || !(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            rect.width > 0 &&
            rect.height > 0;
    }

    function getMarketQuickLinkHridFromNode(node) {
        const href = getUseHref(node) || '';
        return getItemHridFromSpriteHref(href);
    }

    function getCurrentMarketplaceQuickLinkIdentity() {
        const currentItems = [...document.querySelectorAll('[class*="MarketplacePanel_currentItem"]')];
        const currentItem = currentItems.find(isMarketQuickLinkElementVisible) || currentItems[0] || null;
        if (!currentItem) return null;
        const itemHrid = getMarketQuickLinkHridFromNode(currentItem);
        if (!itemHrid) return null;
        return `${itemHrid}::${getEnhancementLevel(currentItem) || 0}`;
    }

    function findVisibleMarketQuickLinkItem(link) {
        const targetIdentity = getMarketQuickLinkIdentity(link);
        if (!targetIdentity) return null;
        const nodes = document.querySelectorAll('[class*="Item_itemContainer"]');
        for (const node of nodes) {
            if (node.closest(`${MARKET_QUICK_LINKS_BAR_SELECTOR}, #${MARKET_QUICK_LINKS_POPOVER_ID}`)) continue;
            if (!isMarketQuickLinkElementVisible(node)) continue;
            const itemHrid = getMarketQuickLinkHridFromNode(node);
            if (!itemHrid) continue;
            const identity = `${itemHrid}::${getEnhancementLevel(node) || 0}`;
            if (identity === targetIdentity) return node;
        }
        return null;
    }

    async function openMarketplaceQuickLinkByVisibleMenu(link) {
        const itemNode = findVisibleMarketQuickLinkItem(link);
        if (!itemNode) return false;
        try {
            itemNode.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            }));
        } catch (error) {
            return false;
        }

        const targetIdentity = getMarketQuickLinkIdentity(link);
        for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (getCurrentMarketplaceQuickLinkIdentity() === targetIdentity) return true;

            const menu = [...document.querySelectorAll(inventoryItemActionMenuSelector)]
                .find(isMarketQuickLinkElementVisible);
            if (!menu) continue;
            const marketButton = [...menu.querySelectorAll('button, [role="button"]')]
                .find(button => /前往市場|市場|market/i.test((button.textContent || '').trim()));
            if (!marketButton) return false;
            try {
                marketButton.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                }));
                return true;
            } catch (error) {
                return false;
            }
        }
        return false;
    }

    async function openMarketplaceForQuickLink(link) {
        const normalized = normalizeMarketQuickLink(link);
        if (!normalized) return false;
        return openMarketplaceQuickLinkByCore(normalized) ||
            await openMarketplaceQuickLinkByVisibleMenu(normalized);
    }

    function getMarketQuickLinkLabel(link) {
        const name = String(link?.displayName || link?.itemKey || link?.itemHrid || '').trim();
        const level = Math.max(0, parseInt(link?.enhancementLevel, 10) || 0);
        return `${name}${level > 0 ? ` +${level}` : ''}`;
    }

    function createMarketQuickLinkIconFrame(link, picker = false) {
        const frame = document.createElement('span');
        frame.className = picker
            ? 'mwc-market-quick-link-icon-frame mwc-market-picker-icon-frame'
            : 'mwc-market-quick-link-icon-frame';
        const icon = createItemSpriteIcon(
            link.itemHrid || link.spriteHref,
            'mwc-market-quick-link-icon',
            getMarketQuickLinkLabel(link)
        );
        frame.appendChild(icon);
        return frame;
    }

    function clearMarketQuickLinkDropStates() {
        document.querySelectorAll(`${MARKET_QUICK_LINKS_BAR_SELECTOR} .mwc-market-quick-link-button`)
            .forEach(button => button.classList.remove('is-dragging', 'is-drop-target'));
    }

    function reorderMarketQuickLinks(sourceIdentity, targetIdentity) {
        if (!sourceIdentity || !targetIdentity || sourceIdentity === targetIdentity) return;
        const links = getMarketQuickLinks();
        const sourceIndex = links.findIndex(link => getMarketQuickLinkIdentity(link) === sourceIdentity);
        if (sourceIndex < 0) return;
        const [moved] = links.splice(sourceIndex, 1);
        const targetIndex = links.findIndex(link => getMarketQuickLinkIdentity(link) === targetIdentity);
        if (targetIndex < 0) return;
        links.splice(targetIndex, 0, moved);
        saveMarketQuickLinks(links);
    }

    function createMarketQuickLinkButton(link, activeIdentity) {
        const identity = getMarketQuickLinkIdentity(link);
        const label = getMarketQuickLinkLabel(link);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mwc-market-quick-link-button';
        button.dataset.identity = identity;
        button.title = `前往市場：${label}（右鍵移除）`;
        button.setAttribute('aria-label', button.title);
        button.draggable = true;
        button.appendChild(createMarketQuickLinkIconFrame(link));

        if (identity === activeIdentity) {
            button.classList.add('is-active');
            button.setAttribute('aria-current', 'true');
        }

        button.addEventListener('dragstart', event => {
            marketQuickLinksDraggingId = identity;
            button.classList.add('is-dragging');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', identity);
            }
        });
        button.addEventListener('dragover', event => {
            if (!marketQuickLinksDraggingId || marketQuickLinksDraggingId === identity) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            button.classList.add('is-drop-target');
        });
        button.addEventListener('dragleave', () => {
            button.classList.remove('is-drop-target');
        });
        button.addEventListener('drop', event => {
            event.preventDefault();
            const sourceIdentity = marketQuickLinksDraggingId || event.dataTransfer?.getData('text/plain');
            marketQuickLinksSuppressClick = true;
            reorderMarketQuickLinks(sourceIdentity, identity);
            clearMarketQuickLinkDropStates();
        });
        button.addEventListener('dragend', () => {
            marketQuickLinksDraggingId = null;
            marketQuickLinksSuppressClick = true;
            clearMarketQuickLinkDropStates();
            setTimeout(() => {
                marketQuickLinksSuppressClick = false;
            }, 0);
        });
        button.addEventListener('contextmenu', event => {
            event.preventDefault();
            event.stopPropagation();
            const currentLinks = getMarketQuickLinks();
            const next = currentLinks.filter(linkValue =>
                getMarketQuickLinkIdentity(linkValue) !== identity
            );
            if (next.length === currentLinks.length) return;
            saveMarketQuickLinks(next);
            showKeyboardHint(`已移除市場快捷物品：${label}`);
        });
        button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            if (marketQuickLinksSuppressClick || button.dataset.busy === '1') return;

            button.dataset.busy = '1';
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            try {
                const opened = await openMarketplaceForQuickLink(link);
                if (!opened) {
                    showKeyboardHint(`無法跳轉到市場：${label}`);
                    return;
                }
                document.querySelectorAll(`${MARKET_QUICK_LINKS_BAR_SELECTOR} .mwc-market-quick-link-button.is-active`).forEach(activeButton => {
                    activeButton.classList.remove('is-active');
                    activeButton.removeAttribute('aria-current');
                });
                document.querySelectorAll(`${MARKET_QUICK_LINKS_BAR_SELECTOR} .mwc-market-quick-link-button`).forEach(linkButton => {
                    if (linkButton.dataset.identity !== identity) return;
                    linkButton.classList.add('is-active');
                    linkButton.setAttribute('aria-current', 'true');
                });
            } finally {
                if (button.isConnected) {
                    button.dataset.busy = '0';
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            }
        });
        return button;
    }

    function renderMarketQuickLinks(bar) {
        if (!bar?.isConnected) return;
        const links = getMarketQuickLinks();
        const activeIdentity = getCurrentMarketplaceQuickLinkIdentity();
        const signature = JSON.stringify({
            activeIdentity,
            links: links.map(link => ({
                identity: getMarketQuickLinkIdentity(link),
                itemKey: link.itemKey,
                name: link.displayName,
                sprite: link.spriteHref
            }))
        });
        if (bar.dataset.signature === signature) return;
        bar.dataset.signature = signature;
        bar.replaceChildren();

        const strip = document.createElement('div');
        strip.className = 'mwc-market-quick-links-strip';
        strip.setAttribute('role', 'toolbar');
        strip.setAttribute('aria-label', '市場快捷物品');
        for (const link of links) {
            const button = createMarketQuickLinkButton(link, activeIdentity);
            strip.appendChild(button);
        }
        if (!links.length) strip.hidden = true;
        bar.appendChild(strip);

        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'mwc-market-quick-link-add';
        addButton.textContent = '+';
        addButton.title = links.length >= MARKET_QUICK_LINKS_LIMIT
            ? `管理市場快捷物品（已達 ${MARKET_QUICK_LINKS_LIMIT} 個）`
            : '新增市場快捷物品';
        addButton.setAttribute('aria-label', addButton.title);
        addButton.setAttribute('aria-haspopup', 'dialog');
        addButton.setAttribute('aria-expanded', 'false');
        addButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openMarketQuickLinksPopover(addButton);
        });
        bar.appendChild(addButton);
    }

    function getMarketQuickLinkNavContainers() {
        const containers = [...document.querySelectorAll('[class*="MarketplacePanel_marketNavButtonContainer"]')];
        const visibleContainers = containers.filter(isMarketQuickLinkElementVisible);
        return visibleContainers.length ? visibleContainers : containers.slice(0, 1);
    }

    function findMarketQuickLinkNavAnchor(container) {
        const children = [...container.children];
        const copyButton = container.querySelector(':scope > .RangedWayIdleQuickCopyItemHridButton') ||
            children.find(element =>
                element.matches('button') && /^複製\s*itemHrid$/i.test((element.textContent || '').trim())
            );
        if (copyButton) return copyButton;

        const refreshButton = children.find(element =>
            element.matches('button') && /^(重新整理|refresh)$/i.test((element.textContent || '').trim())
        );
        if (refreshButton) return refreshButton;

        for (let index = children.length - 1; index >= 0; index--) {
            if (!children[index].classList.contains('mwc-market-quick-links-nav')) return children[index];
        }
        return null;
    }

    function createMarketQuickLinksBar(className = '') {
        const bar = document.createElement('div');
        bar.className = `mwc-market-quick-links${className ? ` ${className}` : ''}`;
        bar.dataset.mwcMarketQuickLinks = '1';
        return bar;
    }

    function ensureMarketQuickLinks() {
        if (!getMarketQuickLinksEnabled()) {
            closeMarketQuickLinksPopover();
            document.querySelectorAll(MARKET_QUICK_LINKS_BAR_SELECTOR).forEach(bar => bar.remove());
            document.querySelectorAll('.mwc-market-quick-links-host').forEach(host => {
                host.classList.remove('mwc-market-quick-links-host');
            });
            return false;
        }

        const desiredBars = new Set();
        const hosts = [...document.querySelectorAll('[class*="MarketplacePanel_itemFilterContainer"]')];
        const host = hosts.find(element => element.getClientRects().length > 0) || hosts[0] || null;

        if (host) {
            host.classList.add('mwc-market-quick-links-host');
            let bar = document.getElementById(MARKET_QUICK_LINKS_BAR_ID);
            if (bar && bar.parentElement !== host) {
                bar.remove();
                bar = null;
            }
            if (!bar) {
                bar = createMarketQuickLinksBar();
                bar.id = MARKET_QUICK_LINKS_BAR_ID;
                host.appendChild(bar);
            }
            desiredBars.add(bar);
        }

        for (const container of getMarketQuickLinkNavContainers()) {
            let bar = container.querySelector(':scope > .mwc-market-quick-links-nav');
            if (!bar) bar = createMarketQuickLinksBar('mwc-market-quick-links-nav');
            const anchor = findMarketQuickLinkNavAnchor(container);
            if (anchor && anchor.nextElementSibling !== bar) {
                anchor.insertAdjacentElement('afterend', bar);
            } else if (!bar.isConnected) {
                container.appendChild(bar);
            }
            desiredBars.add(bar);
        }

        document.querySelectorAll(MARKET_QUICK_LINKS_BAR_SELECTOR).forEach(bar => {
            if (!desiredBars.has(bar)) bar.remove();
        });
        desiredBars.forEach(renderMarketQuickLinks);
        if (marketQuickLinksPopoverAnchor && !marketQuickLinksPopoverAnchor.isConnected) {
            closeMarketQuickLinksPopover();
        }
        if (!desiredBars.size) closeMarketQuickLinksPopover();
        return desiredBars.size > 0;
    }

    function scheduleEnsureMarketQuickLinks() {
        if (marketQuickLinksRenderFrame !== null || typeof requestAnimationFrame !== 'function') return;
        marketQuickLinksRenderFrame = requestAnimationFrame(() => {
            marketQuickLinksRenderFrame = null;
            ensureMarketQuickLinks();
        });
    }

    function positionMarketQuickLinksPopover() {
        const popover = document.getElementById(MARKET_QUICK_LINKS_POPOVER_ID);
        const anchor = marketQuickLinksPopoverAnchor;
        if (!popover || !anchor?.isConnected) return;

        const viewportWidth = window.visualViewport?.width || window.innerWidth || 1024;
        const viewportHeight = window.visualViewport?.height || window.innerHeight || 768;
        const anchorRect = anchor.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();
        const edge = 8;
        let left = Math.min(anchorRect.left, viewportWidth - popoverRect.width - edge);
        left = Math.max(edge, left);
        let top = anchorRect.bottom + 6;
        if (top + popoverRect.height > viewportHeight - edge &&
            anchorRect.top - popoverRect.height - 6 >= edge) {
            top = anchorRect.top - popoverRect.height - 6;
        }
        popover.style.left = `${left}px`;
        popover.style.top = `${Math.max(edge, top)}px`;
    }

    function closeMarketQuickLinksPopover() {
        document.getElementById(MARKET_QUICK_LINKS_POPOVER_ID)?.remove();
        if (marketQuickLinksPopoverAnchor) {
            marketQuickLinksPopoverAnchor.setAttribute('aria-expanded', 'false');
        }
        if (marketQuickLinksPopoverOutsideHandler) {
            document.removeEventListener('pointerdown', marketQuickLinksPopoverOutsideHandler, true);
            marketQuickLinksPopoverOutsideHandler = null;
        }
        if (marketQuickLinksPopoverKeyHandler) {
            document.removeEventListener('keydown', marketQuickLinksPopoverKeyHandler, true);
            marketQuickLinksPopoverKeyHandler = null;
        }
        if (marketQuickLinksPopoverViewportHandler) {
            window.removeEventListener('resize', marketQuickLinksPopoverViewportHandler);
            window.removeEventListener('scroll', marketQuickLinksPopoverViewportHandler, true);
            marketQuickLinksPopoverViewportHandler = null;
        }
        marketQuickLinksPopoverAnchor = null;
    }

    function renderMarketQuickLinksPopover(popover) {
        if (!popover?.isConnected) return;
        const grid = popover.querySelector('.mwc-market-quick-link-picker-grid');
        const searchInput = popover.querySelector('.mwc-market-quick-link-picker-search');
        const counter = popover.querySelector('.mwc-market-quick-link-picker-count');
        if (!grid || !searchInput || !counter) return;

        const links = getMarketQuickLinks();
        const query = searchInput.value.trim().toLocaleLowerCase();
        const filterMode = popover.dataset.filterMode === 'selected' ? 'selected' : 'unselected';
        popover.querySelectorAll('.mwc-market-quick-link-picker-filter-button').forEach(button => {
            const active = button.dataset.filterMode === filterMode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
        });
        const allChoices = Array.isArray(popover._mwcMarketQuickLinkChoices)
            ? popover._mwcMarketQuickLinkChoices
            : getMarketQuickLinkChoices();
        const choices = allChoices.filter(choice => {
            const categoryMatches = filterMode === 'selected'
                ? choice.selected
                : !choice.selected && choice.resolved && Boolean(choice.itemHrid);
            if (!categoryMatches) return false;
            if (!query) return true;
            const searchValue = `${getMarketQuickLinkLabel(choice)} ${choice.itemHrid || ''}`.toLocaleLowerCase();
            return searchValue.includes(query);
        });
        counter.textContent = `${links.length}/${MARKET_QUICK_LINKS_LIMIT}`;
        grid.replaceChildren();

        if (!choices.length) {
            const empty = document.createElement('div');
            empty.className = 'mwc-market-quick-link-picker-empty';
            empty.textContent = query
                ? '沒有匹配的收藏物品'
                : filterMode === 'selected'
                    ? '快捷欄中暫無物品'
                    : '沒有可新增的收藏物品';
            grid.appendChild(empty);
            positionMarketQuickLinksPopover();
            return;
        }

        const atLimit = links.length >= MARKET_QUICK_LINKS_LIMIT;
        for (const choice of choices) {
            const label = getMarketQuickLinkLabel(choice);
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'mwc-market-quick-link-picker-item';
            if (choice.selected) tile.classList.add('is-selected');

            const unavailable = !choice.selected && (!choice.resolved || !choice.itemHrid);
            const blockedByLimit = !choice.selected && atLimit;
            tile.disabled = unavailable || blockedByLimit;
            tile.title = choice.selected
                ? `從快捷欄移除：${label}`
                : unavailable
                    ? `${label} 缺少物品資訊，請重新收藏一次`
                    : blockedByLimit
                        ? `最多新增 ${MARKET_QUICK_LINKS_LIMIT} 個快捷物品`
                        : `新增到快捷欄：${label}`;
            tile.setAttribute('aria-label', tile.title);
            tile.setAttribute('aria-pressed', String(Boolean(choice.selected)));

            tile.appendChild(createMarketQuickLinkIconFrame(choice, true));

            if (choice.selected) {
                const check = document.createElement('span');
                check.className = 'mwc-market-quick-link-picker-check';
                check.textContent = '✓';
                check.setAttribute('aria-hidden', 'true');
                tile.appendChild(check);
            }

            tile.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const currentLinks = getMarketQuickLinks();
                if (choice.selected) {
                    const next = currentLinks.filter(link =>
                        getMarketQuickLinkIdentity(link) !== choice.identity
                    );
                    closeMarketQuickLinksPopover();
                    saveMarketQuickLinks(next);
                    showKeyboardHint(`已移除市場快捷物品：${label}`);
                    return;
                }
                if (currentLinks.length >= MARKET_QUICK_LINKS_LIMIT) {
                    showKeyboardHint(`市場快捷物品最多 ${MARKET_QUICK_LINKS_LIMIT} 個`);
                    return;
                }
                const link = normalizeMarketQuickLink(choice);
                if (!link) {
                    showKeyboardHint(`無法識別物品：${label}`);
                    return;
                }
                closeMarketQuickLinksPopover();
                saveMarketQuickLinks([...currentLinks, link]);
                showKeyboardHint(`已新增市場快捷物品：${label}`);
            });
            grid.appendChild(tile);
        }
        positionMarketQuickLinksPopover();
    }

    function openMarketQuickLinksPopover(anchor) {
        const existing = document.getElementById(MARKET_QUICK_LINKS_POPOVER_ID);
        if (existing && marketQuickLinksPopoverAnchor === anchor) {
            closeMarketQuickLinksPopover();
            return;
        }
        closeMarketQuickLinksPopover();

        const popover = document.createElement('div');
        popover.id = MARKET_QUICK_LINKS_POPOVER_ID;
        popover.className = 'mwc-market-quick-link-picker';
        popover.dataset.filterMode = 'unselected';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', '選擇收藏物品');

        const header = document.createElement('div');
        header.className = 'mwc-market-quick-link-picker-header';
        const title = document.createElement('strong');
        title.textContent = '選擇收藏物品';
        const filter = document.createElement('div');
        filter.className = 'mwc-market-quick-link-picker-filter';
        filter.setAttribute('role', 'tablist');
        filter.setAttribute('aria-label', '快捷欄狀態');
        [
            { mode: 'selected', label: '已新增' },
            { mode: 'unselected', label: '可新增' }
        ].forEach(option => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mwc-market-quick-link-picker-filter-button';
            button.dataset.filterMode = option.mode;
            button.textContent = option.label;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', 'false');
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                popover.dataset.filterMode = option.mode;
                renderMarketQuickLinksPopover(popover);
            });
            filter.appendChild(button);
        });
        const counter = document.createElement('span');
        counter.className = 'mwc-market-quick-link-picker-count';
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'mwc-market-quick-link-picker-close';
        closeButton.textContent = '×';
        closeButton.title = '關閉';
        closeButton.setAttribute('aria-label', '關閉');
        closeButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            closeMarketQuickLinksPopover();
        });
        header.appendChild(title);
        header.appendChild(filter);
        header.appendChild(counter);
        header.appendChild(closeButton);
        popover.appendChild(header);

        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'mwc-market-quick-link-picker-search';
        searchInput.placeholder = '搜尋收藏物品';
        searchInput.maxLength = 200;
        searchInput.addEventListener('input', () => renderMarketQuickLinksPopover(popover));
        popover.appendChild(searchInput);

        const grid = document.createElement('div');
        grid.className = 'mwc-market-quick-link-picker-grid';
        popover.appendChild(grid);

        document.body.appendChild(popover);
        marketQuickLinksPopoverAnchor = anchor;
        popover._mwcMarketQuickLinkChoices = getMarketQuickLinkChoices();
        anchor.setAttribute('aria-expanded', 'true');
        renderMarketQuickLinksPopover(popover);
        positionMarketQuickLinksPopover();

        marketQuickLinksPopoverOutsideHandler = event => {
            if (popover.contains(event.target) || anchor.contains(event.target)) return;
            closeMarketQuickLinksPopover();
        };
        marketQuickLinksPopoverKeyHandler = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeMarketQuickLinksPopover();
            anchor.focus();
        };
        marketQuickLinksPopoverViewportHandler = () => {
            if (!anchor.isConnected) {
                closeMarketQuickLinksPopover();
                return;
            }
            positionMarketQuickLinksPopover();
        };
        document.addEventListener('keydown', marketQuickLinksPopoverKeyHandler, true);
        window.addEventListener('resize', marketQuickLinksPopoverViewportHandler);
        window.addEventListener('scroll', marketQuickLinksPopoverViewportHandler, true);
        setTimeout(() => {
            if (!popover.isConnected || !marketQuickLinksPopoverOutsideHandler) return;
            document.addEventListener('pointerdown', marketQuickLinksPopoverOutsideHandler, true);
            searchInput.focus({ preventScroll: true });
        }, 0);
    }

    function injectListingFilterButtons() {
        if (!getListingFilterEnabled()) return false;

        const container = document.querySelector('[class*="MarketplacePanel_buttonContainer"]');
        if (!container) return false;

        // 檢查是否已經注入過（只要有一個元素存在就認為已經注入）
        const existingFilterGroup = container.querySelector('.script-filter-group');
        const existingSearchContainer = container.querySelector('.script-search-container');
        if (existingFilterGroup && existingSearchContainer) {
            return true; // 已經注入完成，直接返回true
        }

        // 如果只存在部分元素，先清理掉
        container.querySelectorAll('.script-filter-group, .script-search-container').forEach(el => el.remove());

        const sampleBtn = container.querySelector('button');
        const btnBaseClass = sampleBtn ? sampleBtn.className : '';

        const filterGroup = document.createElement('div');
        filterGroup.className = 'script-filter-group';
        filterGroup.style.cssText = 'display: inline-flex; gap: 5px; margin: 0 10px;';

        const mainButtons = [
            { text: '全部', type: 'all', extraClass: '' },
            { text: '出售', type: 'sell', extraClass: 'Button_warning' },
            { text: '購買', type: 'buy', extraClass: 'Button_success' }
        ];

        const extraButtons = [
            { text: '可收集', type: 'collectable', extraClass: 'Button_success' }
        ];

        const divider = document.createElement('span');
        divider.textContent = '|';
        divider.style.cssText = 'color: rgba(255,255,255,0.3); margin: 0 2px; display: flex; align-items: center;';

        mainButtons.forEach(btnInfo => {
            const btn = document.createElement('button');
            let finalClass = btnBaseClass;
            if (btnInfo.extraClass) {
                finalClass += ` ${btnInfo.extraClass}`;
            }
            if (btnInfo.type === currentMainFilter) {
                finalClass += ' active-filter';
            }
            btn.className = finalClass;
            btn.textContent = btnInfo.text;
            btn.setAttribute('data-filter-type', btnInfo.type);
            btn.setAttribute('data-filter-role', 'main');
            btn.onclick = () => setMainFilter(btnInfo.type);
            filterGroup.appendChild(btn);
        });

        filterGroup.appendChild(divider);

        extraButtons.forEach(btnInfo => {
            const btn = document.createElement('button');
            let finalClass = btnBaseClass;
            if (btnInfo.extraClass) {
                finalClass += ` ${btnInfo.extraClass}`;
            }
            if (extraFilters[btnInfo.type]) {
                finalClass += ' active-filter';
            }
            btn.className = finalClass;
            btn.textContent = btnInfo.text;
            btn.setAttribute('data-filter-type', btnInfo.type);
            btn.setAttribute('data-filter-role', 'extra');
            btn.onclick = () => toggleExtraFilter(btnInfo.type);
            filterGroup.appendChild(btn);
        });

        const searchContainer = document.createElement('div');
        searchContainer.className = 'script-search-container';

        const searchInput = document.createElement('input');
        searchInput.className = 'script-search-input';
        searchInput.type = 'search';
        searchInput.placeholder = '🔍 物品搜尋';
        searchInput.value = marketSearchKeyword;

        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                marketSearchKeyword = e.target.value.trim();
                filterMarketItems();
            }, 150);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchInput.blur();
            }
        });

        const clearSearchBtn = document.createElement('button');
        clearSearchBtn.className = 'script-clear-search';
        clearSearchBtn.title = '清空搜尋';
        clearSearchBtn.textContent = '×';
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            marketSearchKeyword = '';
            clearSearchBtn.style.display = 'none';
            filterMarketItems();
        });

        searchContainer.appendChild(searchInput);
        searchContainer.appendChild(clearSearchBtn);

        const listingCount = document.querySelector('[class*="MarketplacePanel_listingCount"]');
        if (listingCount) {
            listingCount.after(filterGroup);
            listingCount.after(searchContainer);
        } else {
            container.prepend(filterGroup);
            container.prepend(searchContainer);
        }

        filterMarketItems();

        return true;
    }

    // 顯示鍵盤快捷鍵提示
    function showKeyboardHint(message) {
        let hintElement = document.getElementById('mwc-keyboard-hint');
        if (!hintElement) {
            hintElement = document.createElement('div');
            hintElement.id = 'mwc-keyboard-hint';
            hintElement.className = 'keyboard-shortcut-hint';
            document.body.appendChild(hintElement);
        }

        hintElement.textContent = message;
        hintElement.style.display = 'block';

        // 3秒後自動隱藏
        setTimeout(() => {
            hintElement.style.display = 'none';
        }, 3000);
    }

    // 行動佇列快捷前移（參考 Sunny's MWI Enhance 的 MIT 實現思路）。
    function getActionQueueQuickOrderEnabled() {
        const value = getCharacterSetting('mwc_action_queue_quick_order_enabled', true);
        return typeof value === 'boolean' ? value : true;
    }

    function saveActionQueueQuickOrderEnabled(enabled) {
        saveCharacterSetting('mwc_action_queue_quick_order_enabled', enabled !== false);
    }

    const actionQueueQuickOrder = (() => {
        const ROOT_SELECTOR = '[class*="QueuedActions_queuedActionsEditMenu"]';
        const ROW_SELECTOR = '[class*="QueuedActions_action__"][data-action-id]';
        const BUTTON_ATTRIBUTE = 'data-mwc-action-queue-next';
        const PAGE_COMMAND_ATTRIBUTE = 'data-mwc-action-queue-page-command';
        const PAGE_CURRENT_ID_ATTRIBUTE = 'data-mwc-action-queue-page-current-id';
        const PAGE_PENDING_IDS_ATTRIBUTE = 'data-mwc-action-queue-page-pending-ids';
        const PAGE_TARGET_ID_ATTRIBUTE = 'data-mwc-action-queue-page-target-id';
        const PAGE_RESULT_ATTRIBUTE = 'data-mwc-action-queue-page-result';
        const MOVE_TIMEOUT_MS = 3000;
        const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
        const BRIDGE_ERRORS = new Set([
            'current-action-advanced',
            'native-move-handler-contract-changed',
            'native-move-handler-failed',
            'queue-action-identity-ambiguous',
            'queue-dom-order-ambiguous',
            'queue-owner-ambiguous',
            'queue-page-bridge-unavailable',
            'queue-root-ambiguous',
            'queue-root-missing',
            'queue-order-drift',
            'target-disappeared'
        ]);

        let running = false;
        let syncFrame = null;
        let syncUsesAnimationFrame = false;
        let pendingMove = null;
        let nextMoveId = 0;

        function isPositiveActionId(value) {
            return Number.isSafeInteger(value) && value > 0;
        }

        function isObject(value) {
            return value !== null && typeof value === 'object';
        }

        function sameIdList(left, right) {
            return left.length === right.length && left.every((value, index) => value === right[index]);
        }

        function moveIdToFront(ids, targetId) {
            const index = ids.indexOf(targetId);
            if (index < 0) return null;
            if (index === 0) return [...ids];
            return [targetId, ...ids.slice(0, index), ...ids.slice(index + 1)];
        }

        function normalizeBridgeError(error) {
            return typeof error === 'string' && BRIDGE_ERRORS.has(error)
                ? error
                : 'queue-page-bridge-unavailable';
        }

        function getFailureMessage(error) {
            switch (error) {
                case 'current-action-advanced':
                    return '當前行動已推進，未調整佇列';
                case 'queue-order-drift':
                    return '佇列順序已變化，未調整佇列';
                case 'target-disappeared':
                    return '目標行動已離開佇列';
                case 'queue-move-confirm-timeout':
                    return '佇列調整等待超時';
                case 'native-move-handler-contract-changed':
                case 'native-move-handler-failed':
                    return '遊戲佇列介面已變化，未調整佇列';
                default:
                    return '無法讀取當前行動佇列，請重新開啟佇列面板';
            }
        }

        function reportFailure(error) {
            showKeyboardHint(getFailureMessage(error));
        }

        function actionQueuePageBridge() {
            'use strict';

            const commandAttribute = 'data-mwc-action-queue-page-command';
            const currentIdAttribute = 'data-mwc-action-queue-page-current-id';
            const pendingIdsAttribute = 'data-mwc-action-queue-page-pending-ids';
            const targetIdAttribute = 'data-mwc-action-queue-page-target-id';
            const resultAttribute = 'data-mwc-action-queue-page-result';
            const rootSelector = '[class*="QueuedActions_queuedActionsEditMenu"]';
            const rowSelector = '[class*="QueuedActions_action__"][data-action-id]';
            const trustedMoveHandlerPattern = /^\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\{\s*[A-Za-z_$][\w$]*\.sendMoveCharacterAction\(\s*\1\s*,\s*\2\s*\)\s*;?\s*\}$/;
            const request = document.currentScript;

            const finish = result => {
                if (request) request.setAttribute(resultAttribute, JSON.stringify(result));
            };

            const objectOrNull = value => value && typeof value === 'object' ? value : null;
            const actionId = action => {
                const value = Number(action?.id ?? action?.characterActionId ?? action?.actionId);
                return Number.isSafeInteger(value) && value > 0 ? value : null;
            };
            const sameIds = (left, right) =>
                left.length === right.length && left.every((value, index) => value === right[index]);

            const readState = () => {
                try {
                    const roots = Array.from(document.querySelectorAll(rootSelector))
                        .filter(root => root?.isConnected !== false);
                    if (roots.length !== 1) {
                        return { ok: false, error: roots.length ? 'queue-root-ambiguous' : 'queue-root-missing' };
                    }

                    const root = roots[0];
                    const fiberKey = Reflect.ownKeys(root).find(name =>
                        typeof name === 'string' &&
                        (name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'))
                    );
                    let fiber = fiberKey ? objectOrNull(root[fiberKey]) : null;
                    const owners = new Set();

                    for (let depth = 0; fiber && depth < 48; depth += 1) {
                        const instance = objectOrNull(fiber.stateNode);
                        const props = objectOrNull(instance?.props);
                        if (
                            instance &&
                            props &&
                            Array.isArray(props.characterActions) &&
                            typeof props.moveCharacterActionHandler === 'function' &&
                            typeof instance.moveCharacterActionToFrontClicked === 'function' &&
                            typeof instance.commitActionMove === 'function' &&
                            typeof instance.getPendingActions === 'function'
                        ) {
                            owners.add(instance);
                        }
                        fiber = objectOrNull(fiber.return);
                    }

                    if (owners.size !== 1) return { ok: false, error: 'queue-owner-ambiguous' };

                    const owner = Array.from(owners)[0];
                    const handler = owner.props.moveCharacterActionHandler;
                    if (!trustedMoveHandlerPattern.test(Function.prototype.toString.call(handler))) {
                        return { ok: false, error: 'native-move-handler-contract-changed' };
                    }

                    const actions = owner.props.characterActions;
                    const ids = actions.map(actionId);
                    if (
                        ids.length < 1 ||
                        ids.some(id => id === null) ||
                        new Set(ids).size !== ids.length
                    ) {
                        return { ok: false, error: 'queue-action-identity-ambiguous' };
                    }

                    const currentId = ids[0];
                    const pendingIds = actions
                        .slice(1)
                        .filter(action => !action?.partyID)
                        .map(actionId);
                    if (pendingIds.some(id => id === null)) {
                        return { ok: false, error: 'queue-action-identity-ambiguous' };
                    }

                    const rows = Array.from(root.querySelectorAll(rowSelector))
                        .filter(row => row.closest?.(rootSelector) === root);
                    const rowIds = rows.map(row => {
                        const value = Number(row.getAttribute('data-action-id'));
                        return Number.isSafeInteger(value) && value > 0 ? value : null;
                    });
                    if (
                        rowIds.length !== pendingIds.length ||
                        rowIds.some(id => id === null) ||
                        new Set(rowIds).size !== rowIds.length ||
                        !sameIds(rowIds, pendingIds)
                    ) {
                        return { ok: false, error: 'queue-dom-order-ambiguous' };
                    }

                    return { ok: true, currentId, handler, owner, pendingIds };
                } catch (error) {
                    return { ok: false, error: 'queue-page-bridge-unavailable' };
                }
            };

            if (!request) return;

            const state = readState();
            if (!state.ok) {
                finish(state);
                return;
            }

            const command = request.getAttribute(commandAttribute) || '';
            if (command === 'read') {
                finish({ ok: true, snapshot: { currentId: state.currentId, pendingIds: state.pendingIds } });
                return;
            }

            if (command !== 'move') {
                finish({ ok: false, error: 'queue-page-bridge-unavailable' });
                return;
            }

            const expectedCurrentId = Number(request.getAttribute(currentIdAttribute));
            const targetId = Number(request.getAttribute(targetIdAttribute));
            let expectedPendingIds;
            try {
                expectedPendingIds = JSON.parse(request.getAttribute(pendingIdsAttribute) || '');
            } catch (error) {
                finish({ ok: false, error: 'queue-page-bridge-unavailable' });
                return;
            }

            if (
                !Number.isSafeInteger(expectedCurrentId) ||
                expectedCurrentId <= 0 ||
                !Number.isSafeInteger(targetId) ||
                targetId <= 0 ||
                !Array.isArray(expectedPendingIds) ||
                expectedPendingIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
                new Set(expectedPendingIds).size !== expectedPendingIds.length
            ) {
                finish({ ok: false, error: 'queue-page-bridge-unavailable' });
                return;
            }

            if (state.currentId !== expectedCurrentId) {
                finish({ ok: false, error: 'current-action-advanced' });
                return;
            }

            if (!sameIds(state.pendingIds, expectedPendingIds)) {
                finish({
                    ok: false,
                    error: state.pendingIds.includes(targetId) ? 'queue-order-drift' : 'target-disappeared'
                });
                return;
            }

            const targetIndex = state.pendingIds.indexOf(targetId);
            if (targetIndex < 0) {
                finish({ ok: false, error: 'target-disappeared' });
                return;
            }

            if (targetIndex === 0) {
                finish({ ok: false, error: 'queue-order-drift' });
                return;
            }

            try {
                Reflect.apply(state.handler, state.owner, [targetId, 0]);
                finish({ ok: true, submitted: true });
            } catch (error) {
                finish({ ok: false, error: 'native-move-handler-failed' });
            }
        }

        function runPageBridge(attributes) {
            const host = document.head || document.documentElement || document.body;
            if (!host) return { ok: false, error: 'queue-page-bridge-unavailable' };

            const script = document.createElement('script');
            for (const [key, value] of Object.entries(attributes)) {
                script.setAttribute(key, value);
            }
            script.textContent = '(' + actionQueuePageBridge.toString() + ')();';

            let rawResult = null;
            try {
                host.appendChild(script);
                rawResult = script.getAttribute(PAGE_RESULT_ATTRIBUTE);
            } catch (error) {
                return { ok: false, error: 'queue-page-bridge-unavailable' };
            } finally {
                script.remove();
            }

            if (!rawResult) return { ok: false, error: 'queue-page-bridge-unavailable' };
            try {
                return JSON.parse(rawResult);
            } catch (error) {
                return { ok: false, error: 'queue-page-bridge-unavailable' };
            }
        }

        function isValidSnapshot(snapshot) {
            if (!isObject(snapshot) || !isPositiveActionId(snapshot.currentId)) return false;
            if (!Array.isArray(snapshot.pendingIds)) return false;
            return snapshot.pendingIds.every(isPositiveActionId) &&
                new Set(snapshot.pendingIds).size === snapshot.pendingIds.length;
        }

        function readPageSnapshot() {
            const result = runPageBridge({ [PAGE_COMMAND_ATTRIBUTE]: 'read' });
            if (!isObject(result) || result.ok !== true || !isValidSnapshot(result.snapshot)) {
                return { ok: false, error: normalizeBridgeError(result?.error) };
            }
            return {
                ok: true,
                snapshot: {
                    currentId: result.snapshot.currentId,
                    pendingIds: [...result.snapshot.pendingIds]
                }
            };
        }

        function movePageAction(expected, targetId) {
            const result = runPageBridge({
                [PAGE_COMMAND_ATTRIBUTE]: 'move',
                [PAGE_CURRENT_ID_ATTRIBUTE]: String(expected.currentId),
                [PAGE_PENDING_IDS_ATTRIBUTE]: JSON.stringify(expected.pendingIds),
                [PAGE_TARGET_ID_ATTRIBUTE]: String(targetId)
            });
            if (!isObject(result) || result.ok !== true || result.submitted !== true) {
                return { ok: false, error: normalizeBridgeError(result?.error) };
            }
            return { ok: true };
        }

        function getNativeTopControl(row) {
            const candidates = Array.from(row.querySelectorAll('button')).filter(button =>
                !button.hasAttribute(BUTTON_ATTRIBUTE) &&
                button.querySelector('svg[aria-label="top"]') !== null
            );
            if (candidates.length !== 1) return null;

            const button = candidates[0];
            const icon = button.querySelector('svg[aria-label="top"]');
            return icon ? { button, icon } : null;
        }

        function inspectQueue() {
            const roots = Array.from(document.querySelectorAll(ROOT_SELECTOR))
                .filter(root => root.isConnected !== false);
            if (roots.length !== 1) {
                return { ok: false, error: roots.length ? 'queue-root-ambiguous' : 'queue-root-missing' };
            }

            const root = roots[0];
            const pageState = readPageSnapshot();
            if (!pageState.ok) return pageState;

            const rows = Array.from(root.querySelectorAll(ROW_SELECTOR))
                .filter(row => row.closest(ROOT_SELECTOR) === root);
            const rowIds = rows.map(row => {
                const actionId = Number(row.getAttribute('data-action-id'));
                return isPositiveActionId(actionId) ? actionId : null;
            });
            if (
                rowIds.length !== pageState.snapshot.pendingIds.length ||
                rowIds.some(id => id === null) ||
                new Set(rowIds).size !== rowIds.length ||
                !sameIdList(rowIds, pageState.snapshot.pendingIds)
            ) {
                return { ok: false, error: 'queue-dom-order-ambiguous' };
            }

            const queueRows = [];
            for (let index = 0; index < rows.length; index += 1) {
                const nativeControl = getNativeTopControl(rows[index]);
                if (!nativeControl) {
                    return { ok: false, error: 'queue-native-controls-ambiguous' };
                }
                queueRows.push({
                    actionId: rowIds[index],
                    element: rows[index],
                    nativeIcon: nativeControl.icon,
                    nativeTop: nativeControl.button
                });
            }

            return {
                ok: true,
                state: {
                    currentId: pageState.snapshot.currentId,
                    pendingIds: pageState.snapshot.pendingIds,
                    root,
                    rows: queueRows
                }
            };
        }

        function createNextIcon(nativeIcon) {
            const icon = nativeIcon.cloneNode(false);
            icon.setAttribute('aria-label', 'next');
            icon.setAttribute('viewBox', '0 0 20 20');
            icon.removeAttribute('fill');

            const arrow = document.createElementNS(SVG_NAMESPACE, 'path');
            arrow.setAttribute('d', 'M10 9 0 19h20L10 9Z');
            arrow.setAttribute('fill', '#FEFEFE');

            const topLine = document.createElementNS(SVG_NAMESPACE, 'path');
            topLine.setAttribute('d', 'M0 1.5h20');
            topLine.setAttribute('stroke', '#FEFEFE');
            topLine.setAttribute('stroke-width', '3');
            topLine.setAttribute('stroke-linecap', 'butt');

            const middleLine = document.createElementNS(SVG_NAMESPACE, 'path');
            middleLine.setAttribute('d', 'M0 5.5h20');
            middleLine.setAttribute('stroke', '#FEFEFE');
            middleLine.setAttribute('stroke-width', '3');
            middleLine.setAttribute('stroke-linecap', 'butt');

            icon.replaceChildren(arrow, topLine, middleLine);
            return icon;
        }

        function removeOwnedControls() {
            document.querySelectorAll('button[' + BUTTON_ATTRIBUTE + ']').forEach(button => button.remove());
        }

        function cancelScheduledSync() {
            if (syncFrame === null) return;
            if (syncUsesAnimationFrame && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(syncFrame);
            } else {
                clearTimeout(syncFrame);
            }
            syncFrame = null;
            syncUsesAnimationFrame = false;
        }

        function cancelPendingMove() {
            if (pendingMove?.timer) clearTimeout(pendingMove.timer);
            pendingMove = null;
        }

        function finishPendingMove() {
            cancelPendingMove();
        }

        function failPendingMove(error) {
            cancelPendingMove();
            reportFailure(error);
        }

        function reconcilePendingMove(state) {
            if (!pendingMove) return;

            if (state.currentId === pendingMove.targetId) {
                finishPendingMove();
                return;
            }
            if (state.currentId !== pendingMove.currentId) {
                failPendingMove('current-action-advanced');
                return;
            }
            if (!state.pendingIds.includes(pendingMove.targetId)) {
                failPendingMove('target-disappeared');
                return;
            }
            if (sameIdList(state.pendingIds, pendingMove.pendingIds)) return;

            const expectedPendingIds = moveIdToFront(pendingMove.pendingIds, pendingMove.targetId);
            if (expectedPendingIds && sameIdList(state.pendingIds, expectedPendingIds)) {
                finishPendingMove();
            } else {
                failPendingMove('queue-order-drift');
            }
        }

        function renderQueue(state) {
            for (let index = 0; index < state.rows.length; index += 1) {
                const row = state.rows[index];
                const existingButtons = Array.from(
                    row.element.querySelectorAll('button[' + BUTTON_ATTRIBUTE + ']')
                );
                const button = existingButtons.shift() || document.createElement('button');
                existingButtons.forEach(extraButton => extraButton.remove());

                const disabled = index === 0 || pendingMove !== null;
                const title = pendingMove
                    ? '正在調整佇列'
                    : index === 0
                        ? '已經是下一個行動'
                        : '設為下一個行動';
                const renderKey = String(row.actionId) + ':' + String(disabled) + ':' + row.nativeTop.className;

                button.type = 'button';
                button.className = row.nativeTop.className;
                button.setAttribute(BUTTON_ATTRIBUTE, String(row.actionId));
                button.setAttribute('aria-label', title);
                button.title = title;
                button.disabled = disabled;

                if (button.dataset.mwcQueueRenderKey !== renderKey) {
                    button.dataset.mwcQueueRenderKey = renderKey;
                    button.replaceChildren(createNextIcon(row.nativeIcon));
                }

                if (button.parentElement !== row.element || button.previousElementSibling !== row.nativeTop) {
                    row.nativeTop.insertAdjacentElement('afterend', button);
                }
            }

            document.querySelectorAll('button[' + BUTTON_ATTRIBUTE + ']').forEach(button => {
                if (!state.root.contains(button)) button.remove();
            });
        }

        function syncNow() {
            syncFrame = null;
            syncUsesAnimationFrame = false;
            if (!running) return;

            if (!getActionQueueQuickOrderEnabled()) {
                cancelPendingMove();
                removeOwnedControls();
                return;
            }

            const inspection = inspectQueue();
            if (!inspection.ok) {
                removeOwnedControls();
                return;
            }

            reconcilePendingMove(inspection.state);
            renderQueue(inspection.state);
        }

        function requestSync() {
            if (!running || syncFrame !== null) return;

            if (typeof requestAnimationFrame === 'function') {
                syncUsesAnimationFrame = true;
                syncFrame = requestAnimationFrame(syncNow);
            } else {
                syncUsesAnimationFrame = false;
                syncFrame = setTimeout(syncNow, 0);
            }
        }

        function beginPendingMove(state, targetId) {
            const id = ++nextMoveId;
            const move = {
                currentId: state.currentId,
                id,
                pendingIds: [...state.pendingIds],
                targetId,
                timer: null
            };
            move.timer = setTimeout(() => {
                if (!running || pendingMove?.id !== id) return;
                pendingMove = null;
                reportFailure('queue-move-confirm-timeout');
                requestSync();
            }, MOVE_TIMEOUT_MS);
            pendingMove = move;
        }

        function moveActionToNext(targetId) {
            if (pendingMove) return;

            const inspection = inspectQueue();
            if (!inspection.ok) {
                reportFailure(inspection.error);
                requestSync();
                return;
            }

            const state = inspection.state;
            if (state.pendingIds.indexOf(targetId) <= 0) {
                requestSync();
                return;
            }

            const result = movePageAction(
                { currentId: state.currentId, pendingIds: state.pendingIds },
                targetId
            );
            if (!result.ok) {
                reportFailure(result.error);
                requestSync();
                return;
            }

            beginPendingMove(state, targetId);
            renderQueue(state);
            requestSync();
        }

        function onDocumentClick(event) {
            if (!running || !getActionQueueQuickOrderEnabled()) return;
            if (!(event.target instanceof Element)) return;
            if (
                event.isTrusted !== true ||
                (navigator.userActivation && navigator.userActivation.isActive !== true)
            ) {
                return;
            }

            const button = event.target.closest('button[' + BUTTON_ATTRIBUTE + ']');
            if (!button || !document.contains(button) || button.disabled) return;

            const targetId = Number(button.getAttribute(BUTTON_ATTRIBUTE));
            const row = button.closest(ROW_SELECTOR);
            if (
                !isPositiveActionId(targetId) ||
                !row ||
                Number(row.getAttribute('data-action-id')) !== targetId
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            moveActionToNext(targetId);
        }

        function elementIsInsideQueue(node) {
            return node instanceof Element && (
                node.matches(ROOT_SELECTOR) ||
                node.matches(ROW_SELECTOR) ||
                node.closest(ROOT_SELECTOR) !== null
            );
        }

        function nodeContainsQueue(node) {
            return node instanceof Element && (
                node.matches(ROOT_SELECTOR) ||
                node.matches(ROW_SELECTOR) ||
                node.querySelector(ROOT_SELECTOR + ', ' + ROW_SELECTOR) !== null
            );
        }

        function observeMutations(mutations) {
            if (!running || !getActionQueueQuickOrderEnabled()) return;

            for (const mutation of mutations) {
                if (mutation.type !== 'childList') continue;
                if (elementIsInsideQueue(mutation.target)) {
                    requestSync();
                    return;
                }
                for (const node of mutation.addedNodes) {
                    if (nodeContainsQueue(node)) {
                        requestSync();
                        return;
                    }
                }
                for (const node of mutation.removedNodes) {
                    if (nodeContainsQueue(node)) {
                        requestSync();
                        return;
                    }
                }
            }
        }

        return {
            observeMutations,
            refresh() {
                if (!running) return;
                if (!getActionQueueQuickOrderEnabled()) {
                    cancelPendingMove();
                    removeOwnedControls();
                    return;
                }
                requestSync();
            },
            start() {
                if (running) return;
                running = true;
                document.addEventListener('click', onDocumentClick, true);
                requestSync();
            },
            stop() {
                running = false;
                cancelScheduledSync();
                cancelPendingMove();
                document.removeEventListener('click', onDocumentClick, true);
                removeOwnedControls();
            }
        };
    })();

    // 設定面板
    function showSettings() {
        if (settingsEscHandler) {
            document.removeEventListener('keydown', settingsEscHandler);
            settingsEscHandler = null;
        }
        document.querySelectorAll('.mwc-settings').forEach(el => el.remove());
        const favorites = reconcileFavoritesWithGameCatalog();
        const favoriteMetadata = hydrateFavoriteItemMetadata(favorites);
        const marketEnhanceEnabled = getMarketFavoriteEnhanceHighlight();
        const marketQuickLinksEnabled = getMarketQuickLinksEnabled();
        const marketQuickLinksDefaultLevel = getMarketQuickLinksDefaultEnhancementLevel();
        const rangedWayIdleDisplayOptimizationEnabled = getRangedWayIdleDisplayOptimizationEnabled();
        const actionQueueQuickOrderEnabled = getActionQueueQuickOrderEnabled();
        const allCharactersFavorites = getAllCharactersFavorites();
        const settings = document.createElement('div');
        settings.className = 'mwc-settings';

        const formattedFavorites = favorites.map(key => {
            if (key.includes('+')) {
                const [name, level] = key.split('+');
                return {
                    name, level: parseInt(level),
                    display: `${escapeHtml(name)} <span class="level-tag">[+${parseInt(level)}]</span>`,
                    spriteHref: favoriteMetadata[key]?.spriteHref || null,
                    key
                };
            }
            return { name: key, level: null, display: escapeHtml(key), spriteHref: favoriteMetadata[key]?.spriteHref || null, key };
        });

        settings.innerHTML = `
            <div class="mwc-settings-content">
                <button class="mwc-close" title="關閉">×</button>
                <h3>⭐ 設定</h3>

                <div class="mwc-toggle">
                    <input type="checkbox" id="market-enhance-toggle" ${marketEnhanceEnabled ? 'checked' : ''}>
                    <label for="market-enhance-toggle">
                        🛒 收藏強化裝備時聯動收藏市場
                    </label>
                    <span class="mwc-toggle-status" id="market-enhance-status">
                        ${marketEnhanceEnabled ? '已開啟' : '已關閉'}
                    </span>
                </div>

                <div class="mwc-toggle" style="align-items: center; flex-wrap: wrap;">
                    <input type="checkbox" id="market-quick-links-toggle" ${marketQuickLinksEnabled ? 'checked' : ''} style="margin-right: 10px;">
                    <label for="market-quick-links-toggle" style="flex: 1; min-width: 160px; margin-right: 15px;">
                        🧭 市場快捷導航
                    </label>
                    <div style="display: flex; align-items: center; gap: 5px; ${marketQuickLinksEnabled ? '' : 'display: none;'}" id="market-quick-links-default-level-setting">
                        <label for="market-quick-links-default-level" style="margin: 0; font-size: 13px;">預設跳轉:</label>
                        <span style="font-size: 13px; color: var(--color-neutral-300);">+</span>
                        <input type="number" id="market-quick-links-default-level" class="mwc-threshold-input"
                               min="0" max="20" value="${marketQuickLinksDefaultLevel}" title="所有市場快捷圖示均會跳轉至該強化等級" style="width: 54px;">
                    </div>
                    <span class="mwc-toggle-status" id="market-quick-links-status" style="margin-left: auto;">
                        ${marketQuickLinksEnabled ? '已開啟' : '已關閉'}
                    </span>
                </div>

                <div class="mwc-toggle" style="align-items: center; flex-wrap: nowrap;">
                    <label for="favorite-shortcut" style="flex: 1; margin-right: 15px;">
                        🎯 收藏裝備快捷鍵
                    </label>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <label for="favorite-shortcut" style="margin: 0; font-size: 13px;">自定義快捷鍵:</label>
                        <input type="text" id="favorite-shortcut" class="mwc-threshold-input"
                               maxlength="10" value="${escapeHtml(getFavoriteShortcut())}" placeholder="例如: Alt, Ctrl, Shift, F1, Space"
                               style="width: 120px;">
                        <span class="mwc-shortcut-hint" style="font-size: 13px; color: var(--color-neutral-400);">+ 點選</span>
                    </div>
                </div>

                <div class="mwc-toggle">
                    <input type="checkbox" id="enhancement-level-toggle" ${getEnhancementLevelEnabled() ? 'checked' : ''}>
                    <label for="enhancement-level-toggle">
                        ✨ 強化等級美化（+1到+20等級不同顏色顯示，+20會動）
                    </label>
                    <span class="mwc-toggle-status" id="enhancement-level-status">
                        ${getEnhancementLevelEnabled() ? '已開啟' : '已關閉'}
                    </span>
                </div>

                <div class="mwc-toggle">
                    <input type="checkbox" id="market-price-toggle" ${getMarketPriceEnabled() ? 'checked' : ''}>
                    <label for="market-price-toggle">
                        💲 展開市場價格（將K/M/B轉換為完整數字並美化顯示）
                    </label>
                    <span class="mwc-toggle-status" id="market-price-status">
                        ${getMarketPriceEnabled() ? '已開啟' : '已關閉'}
                    </span>
                </div>

                <div class="mwc-toggle">
                    <input type="checkbox" id="ranged-way-idle-display-optimization-toggle" ${rangedWayIdleDisplayOptimizationEnabled ? 'checked' : ''}>
                    <label for="ranged-way-idle-display-optimization-toggle">
                        🕒 掛單時間顯示最佳化
                    </label>
                    <span class="mwc-toggle-status" id="ranged-way-idle-display-optimization-status">
                        ${rangedWayIdleDisplayOptimizationEnabled ? '已開啟' : '已關閉'}
                    </span>
                </div>

                <div class="mwc-toggle">
                    <input type="checkbox" id="action-queue-next-toggle" ${actionQueueQuickOrderEnabled ? 'checked' : ''}>
                    <label for="action-queue-next-toggle">
                        📌 行動佇列顯示“設為下一位”按鈕
                    </label>
                    <span class="mwc-toggle-status" id="action-queue-next-status">
                        ${actionQueueQuickOrderEnabled ? '已開啟' : '已關閉'}
                    </span>
                </div>

                <p style="color: var(--color-neutral-400); font-size: 12px; margin-bottom: 15px; line-height: 1.6;">
                    <strong>🎯 操作：</strong><kbd id="favorite-shortcut-hint">${escapeHtml(getFavoriteShortcut())} + 點選</kbd> 快速收藏/取消<br>
                    <strong>💡 特性：</strong>每個角色有獨立的收藏列表
                </p>

                <h4>我的收藏 (${favorites.length})</h4>
                <div class="mwc-favorites-list">
                    ${formattedFavorites.map(item => `
                        <div class="mwc-favorite-item">
                            <span class="mwc-favorite-item-main">
                                <span class="mwc-favorite-item-icon" aria-hidden="true">
                                    ${item.spriteHref
                                        ? `<svg role="img" aria-label="${escapeHtml(item.name)}" width="100%" height="100%" focusable="false"><use href="${escapeHtml(item.spriteHref)}"></use></svg>`
                                        : '⚒'}
                                </span>
                                <span style="word-break: break-word;">${item.display}</span>
                            </span>
                            <button class="mwc-remove-fav" data-item="${escapeHtml(item.key)}">移除</button>
                        </div>
                    `).join('') || '<p style="color: var(--color-neutral-400); text-align: center; padding: 20px;">暫無收藏物品</p>'}
                </div>

                ${Object.keys(allCharactersFavorites).length > 1 ? `
                <h4>所有角色收藏統計</h4>
                <div class="character-list">
                    ${Object.entries(allCharactersFavorites).map(([charId, data]) => `
                        <div class="character-item ${charId === currentCharacterId ? 'current' : ''}">
                            <span>${escapeHtml(charId)}</span>
                            <span>${data.count} 個收藏</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}

                <div style="text-align: center; margin-top: 20px;">
                    <button class="mwc-btn" id="close-settings">關閉</button>
                    ${favorites.length ? '<button class="mwc-btn" id="clear-favorites">清空當前角色收藏</button>' : ''}
                </div>
            </div>
        `;

        document.body.appendChild(settings);

        // 市場聯動開關事件
        const marketToggle = settings.querySelector('#market-enhance-toggle');
        const marketStatus = settings.querySelector('#market-enhance-status');
        marketToggle.addEventListener('change', () => {
            const enabled = marketToggle.checked;
            saveMarketFavoriteEnhanceHighlight(enabled);
            marketStatus.textContent = enabled ? '已開啟' : '已關閉';
            throttledMarkFavorites();
        });

        // 市場快捷導航開關和統一跳轉等級
        const marketQuickLinksToggle = settings.querySelector('#market-quick-links-toggle');
        const marketQuickLinksStatus = settings.querySelector('#market-quick-links-status');
        const marketQuickLinksDefaultLevelSetting = settings.querySelector('#market-quick-links-default-level-setting');
        const marketQuickLinksDefaultLevelInput = settings.querySelector('#market-quick-links-default-level');
        marketQuickLinksToggle.addEventListener('change', () => {
            const enabled = marketQuickLinksToggle.checked;
            saveMarketQuickLinksEnabled(enabled);
            marketQuickLinksStatus.textContent = enabled ? '已開啟' : '已關閉';
            marketQuickLinksDefaultLevelSetting.style.display = enabled ? 'flex' : 'none';
            ensureMarketQuickLinks();
        });
        marketQuickLinksDefaultLevelInput.addEventListener('input', () => {
            const safeLevel = saveMarketQuickLinksDefaultEnhancementLevel(marketQuickLinksDefaultLevelInput.value);
            marketQuickLinksDefaultLevelInput.value = safeLevel;
            ensureMarketQuickLinks();
        });

        // 收藏快捷鍵輸入事件
        const favoriteShortcutInput = settings.querySelector('#favorite-shortcut');
        const favoriteShortcutHint = settings.querySelector('#favorite-shortcut-hint');
        if (favoriteShortcutInput) {
            let capturingKey = false;

            // 點選輸入框時進入按鍵捕獲模式
            favoriteShortcutInput.addEventListener('focus', () => {
                capturingKey = true;
                favoriteShortcutInput.placeholder = '按任意鍵設定...';
                favoriteShortcutInput.select();
            });

            // 使用 mousedown 確保在 focus 之後立即生效
            favoriteShortcutInput.addEventListener('mousedown', (e) => {
                if (!capturingKey) {
                    e.preventDefault();
                    favoriteShortcutInput.focus();
                }
            }, true);

            // 監聽按鍵事件來設定快捷鍵
            favoriteShortcutInput.addEventListener('keydown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (!capturingKey) return;

                // 處理修飾鍵組合（顯示 "Ctrl+..." 等）
                let keyName = '';
                if (e.ctrlKey && e.key !== 'Control') {
                    keyName = 'Ctrl+';
                }
                if (e.shiftKey && e.key !== 'Shift') {
                    keyName = 'Shift+';
                }
                if (e.altKey && e.key !== 'Alt') {
                    keyName = 'Alt+';
                }

                // 獲取主鍵名
                let mainKey = e.key;
                if (mainKey === ' ') {
                    mainKey = 'Space';
                } else if (mainKey.length === 1) {
                    mainKey = mainKey.toUpperCase();
                }

                // 特殊處理：Ctrl/Shift/Alt 單獨按鍵
                if (['Control', 'Shift', 'Alt'].includes(e.key)) {
                    mainKey = e.key === 'Control' ? 'Ctrl' : e.key;
                    keyName = '';
                }

                const fullKeyName = keyName + mainKey;

                // 儲存並更新顯示
                saveFavoriteShortcut(fullKeyName);
                favoriteShortcutInput.value = fullKeyName;
                favoriteShortcutHint.textContent = `${fullKeyName} + 點選`;

                // 退出捕獲模式
                capturingKey = false;
                favoriteShortcutInput.blur();
            });

            // 失去焦點時退出捕獲模式
            favoriteShortcutInput.addEventListener('blur', () => {
                capturingKey = false;
                favoriteShortcutInput.placeholder = '例如: Alt, Ctrl, F1, Space';
            });
        }

        // 強化等級美化開關事件
        const enhancementLevelToggle = settings.querySelector('#enhancement-level-toggle');
        const enhancementLevelStatus = settings.querySelector('#enhancement-level-status');
        enhancementLevelToggle.addEventListener('change', () => {
            const enabled = enhancementLevelToggle.checked;
            saveEnhancementLevelEnabled(enabled);
            enhancementLevelStatus.textContent = enabled ? '已開啟' : '已關閉';

            // 應用設定到body屬性
            if (enabled) {
                document.body.setAttribute('data-enhancement', '1');
            } else {
                document.body.removeAttribute('data-enhancement');
            }

            // 重新處理所有強化等級
            document.querySelectorAll('.Item_enhancementLevel__19g-e').forEach(enhancementProcessed);
        });

        // 展開市場價格開關事件
        const marketPriceToggle = settings.querySelector('#market-price-toggle');
        const marketPriceStatus = settings.querySelector('#market-price-status');
        marketPriceToggle.addEventListener('change', () => {
            const enabled = marketPriceToggle.checked;
            saveMarketPriceEnabled(enabled);
            marketPriceStatus.textContent = enabled ? '已開啟' : '已關閉';

            // 應用設定到body屬性
            if (enabled) {
                document.body.setAttribute('data-price', '1');
            } else {
                document.body.removeAttribute('data-price');
            }

            // 重新處理所有市場價格
            document.querySelectorAll('.MarketplacePanel_price__hIzrY').forEach(priceProcessed);
        });

        // 掛單時間顯示最佳化開關
        const rangedWayIdleDisplayOptimizationToggle = settings.querySelector('#ranged-way-idle-display-optimization-toggle');
        const rangedWayIdleDisplayOptimizationStatus = settings.querySelector('#ranged-way-idle-display-optimization-status');
        rangedWayIdleDisplayOptimizationToggle.addEventListener('change', () => {
            const enabled = rangedWayIdleDisplayOptimizationToggle.checked;
            saveRangedWayIdleDisplayOptimizationEnabled(enabled);
            rangedWayIdleDisplayOptimizationStatus.textContent = enabled ? '已開啟' : '已關閉';
            if (enabled) {
                applyRangedWayIdleDisplayOptimization();
            } else {
                clearRangedWayIdleDisplayOptimization();
            }
        });

        const actionQueueNextToggle = settings.querySelector('#action-queue-next-toggle');
        const actionQueueNextStatus = settings.querySelector('#action-queue-next-status');
        actionQueueNextToggle.addEventListener('change', () => {
            const enabled = actionQueueNextToggle.checked;
            saveActionQueueQuickOrderEnabled(enabled);
            actionQueueNextStatus.textContent = enabled ? '已開啟' : '已關閉';
            actionQueueQuickOrder.refresh();
        });

        // 關閉事件
        const closeSettings = () => {
            settings.remove();
            document.removeEventListener('keydown', escHandler);
            if (settingsEscHandler === escHandler) settingsEscHandler = null;
        };

        settings.querySelector('.mwc-close').addEventListener('click', closeSettings);
        settings.querySelector('#close-settings')?.addEventListener('click', closeSettings);

        function escHandler(e) {
            if (e.key === 'Escape') closeSettings();
        }
        settingsEscHandler = escHandler;
        document.addEventListener('keydown', settingsEscHandler);

        // 移除收藏事件
        settings.querySelectorAll('.mwc-remove-fav').forEach(btn => {
            btn.addEventListener('click', () => {
                const itemKey = btn.dataset.item;
                let favorites = getFavorites().filter(fav => fav !== itemKey);
                saveFavorites(favorites);
                removeFavoriteItemMetadata(itemKey);
                btn.closest('.mwc-favorite-item').remove();
                throttledMarkFavorites();
                settings.querySelector('h4').textContent = `我的收藏 (${favorites.length})`;
            });
        });

        settings.querySelector('#clear-favorites')?.addEventListener('click', () => {
            if (confirm('確定清空當前角色的所有收藏嗎？')) {
                saveFavorites([]);
                saveFavoriteItemMetadata({});
                throttledMarkFavorites();
                closeSettings();
                setTimeout(showSettings, 100);
            }
        });
    }

    const itemRootSelectors = [
        '.MarketplacePanel_marketItems__D4k7e',
        '.Inventory_itemGrid__20YAH',
        '.MarketplacePanel_itemSummaryTable__2g3gr',
        '.MarketplacePanel_currentItem__3ercC',
        // 裝備欄獨立於背包根節點，切換裝備後需要由同一觀察器重新處理等級文字。
        '[class*="EquipmentPanel_equipmentPanel"]'
    ];

    function processItemMutations(mutations) {
        const enhancementEnabled = getEnhancementLevelEnabled();
        const priceEnabled = getMarketPriceEnabled();
        const itemContainers = new Set();

        for (const mutation of mutations) {
            if (mutation.type !== 'childList') continue;
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;

                if (node.matches?.('.Item_itemContainer__x7kH1')) {
                    itemContainers.add(node);
                }
                node.querySelectorAll?.('.Item_itemContainer__x7kH1').forEach(itemContainers.add, itemContainers);

                if (enhancementEnabled) {
                    if (node.matches?.('.Item_enhancementLevel__19g-e')) enhancementProcessed(node);
                    node.querySelectorAll?.('.Item_enhancementLevel__19g-e').forEach(enhancementProcessed);
                }
                if (priceEnabled) {
                    if (node.matches?.('.MarketplacePanel_price__hIzrY')) priceProcessed(node);
                    node.querySelectorAll?.('.MarketplacePanel_price__hIzrY').forEach(priceProcessed);
                }
            }
        }

        if (itemContainers.size && pluginInitialized) {
            throttledMarkFavorites([...itemContainers]);
        }
    }

    function processItemRoot(root) {
        if (getEnhancementLevelEnabled()) {
            root.querySelectorAll('.Item_enhancementLevel__19g-e').forEach(enhancementProcessed);
        }
        if (getMarketPriceEnabled()) {
            root.querySelectorAll('.MarketplacePanel_price__hIzrY').forEach(priceProcessed);
        }
        const itemContainers = root.querySelectorAll('.Item_itemContainer__x7kH1');
        if (itemContainers.length && pluginInitialized) {
            throttledMarkFavorites([...itemContainers]);
        }
    }

    function scheduleListingFilterApply() {
        if (listingFilterApplyTimer) clearTimeout(listingFilterApplyTimer);
        listingFilterApplyTimer = setTimeout(() => {
            listingFilterApplyTimer = null;
            if (listingFilterInjected) applyListingFilters();
        }, 100);
    }

    function syncScopedObservers() {
        const activeRoots = new Set();
        for (const selector of itemRootSelectors) {
            document.querySelectorAll(selector).forEach(root => activeRoots.add(root));
        }
        for (const root of activeRoots) {
            if ([...activeRoots].some(other => other !== root && other.contains(root))) {
                activeRoots.delete(root);
            }
        }

        for (const [root, observer] of itemObservers) {
            if (!activeRoots.has(root) || !root.isConnected) {
                observer.disconnect();
                itemObservers.delete(root);
            }
        }

        for (const root of activeRoots) {
            if (itemObservers.has(root)) continue;
            const observer = new MutationObserver(processItemMutations);
            observer.observe(root, { childList: true, subtree: true });
            itemObservers.set(root, observer);
            processItemRoot(root);
        }

        ensureMarketQuickLinks();
        scheduleRangedWayIdleDisplayOptimization();
    }

    function initScopedObservers() {
        syncScopedObservers();
        unifiedObserver = new MutationObserver(mutations => {
            syncScopedObservers();
            processInventoryFavoriteMenuMutations(mutations);
            actionQueueQuickOrder.observeMutations(mutations);
        });
        unifiedObserver.observe(document.body, { childList: true, subtree: true });

        registerRuntimeCleanup(() => {
            unifiedObserver?.disconnect();
            unifiedObserver = null;
            for (const observer of itemObservers.values()) observer.disconnect();
            itemObservers.clear();
        });
    }

    // 初始化外掛
    function initPlugin() {
        if (pluginInitialized) return;
        document.title = document.title.replace(/^\[\d+(?:\/\d+)?\]\s*/, '');
        try {
            delete pageWindow.mwcEnhancementPresetApi;
        } catch (error) {}
        // 初始化快捷鍵監聽器
        initShortcutKeyListeners();

        // 初始化設定
        if (getEnhancementLevelEnabled()) {
            document.body.setAttribute('data-enhancement', '1');
        }
        if (getMarketPriceEnabled()) {
            document.body.setAttribute('data-price', '1');
        }

        // 清理舊版本遺留的已移除控制元件，避免熱更新後繼續顯示。
        document.querySelectorAll([
            '.script-filter-group',
            '.script-search-container',
            '.mwi-combined-settings',
            '#mwc-enhance-alert-overlay',
            '#mwc-enhance-stop-button-overlay',
            '#mwiSkillButtonContainer',
            '#mwiProtectionButtonContainer',
            '#mwiCombinedLevelButtons',
            '#mwiRepeatCountButtonContainer',
            'button[id^="mwiRepeatCountButton"]',
            '#mwiTargetLevelBtnContainer',
            '#mwiProtectionLevelBtnContainer',
            '#mwi-dual-level-buttons-style',
            '#mwiEnhancementCartButtonContainer',
            '#mwiEnhancementCartButton',
            '[data-mwc-enhancement-cart-button="1"]',
            '#mwi-wide-enhancement-styles',
            '#enhancementStatsContainer .mwc-highlight-overlay'
        ].join(', ')).forEach(element => element.remove());

        // 設定事件監聽器
        document.addEventListener('click', rememberInventoryFavoriteMenuContext, true);
        registerRuntimeCleanup(() => {
            document.removeEventListener('click', rememberInventoryFavoriteMenuContext, true);
        });

        const handleFavoriteClick = (event) => {
            const eventTarget = event.target instanceof Element ? event.target : null;
            if (eventTarget?.closest('[data-mwc-action-queue-next]')) return;

            if (isFavoriteShortcutPressed() && event.button === 0) {
                const itemContainer = eventTarget?.closest(itemContainerSelector);
                if (itemContainer?.querySelector('svg[aria-label]')) {
                    event.preventDefault();
                    event.stopImmediatePropagation();

                    const itemKey = getItemKey(itemContainer);
                    if (itemKey) {
                        toggleFavoriteFromItem(itemKey, itemContainer);
                    }
                }
            }
        };
        document.addEventListener('click', handleFavoriteClick, true);
        registerRuntimeCleanup(() => {
            document.removeEventListener('click', handleFavoriteClick, true);
        });

        pluginInitialized = true;
        initScopedObservers();
        actionQueueQuickOrder.start();
        registerRuntimeCleanup(() => {
            actionQueueQuickOrder.stop();
        });

        // 初始處理頁面上已有的元素和收藏標記
        document.querySelectorAll('.Item_enhancementLevel__19g-e').forEach(enhancementProcessed);
        document.querySelectorAll('.MarketplacePanel_price__hIzrY').forEach(priceProcessed);
        throttledMarkFavorites();

    }

    // 註冊選單命令
    GM_registerMenuCommand('⭐ 收藏設定', showSettings);

    // 主初始化函式
    function main() {
        if (pluginInitialized) return;
        // 初始化外掛
        initPlugin();

        // 新增其他事件監聽器
        const handlePopState = () => {
            currentCharacterId = null;
            updateCharacterId();
            if (pluginInitialized) {
                throttledMarkFavorites();
                scheduleEnsureMarketQuickLinks();
                actionQueueQuickOrder.refresh();
            }
        };

        const handleVisibilityChange = () => {
            if (!document.hidden && pluginInitialized) {
                updateCharacterId();
                throttledMarkFavorites();
                scheduleEnsureMarketQuickLinks();
                actionQueueQuickOrder.refresh();
            }
        };
        window.addEventListener('popstate', handlePopState);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        registerRuntimeCleanup(() => {
            window.removeEventListener('popstate', handlePopState);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        });

        // 設定一個超時，如果WebSocket沒有及時返回資料，使用備用方法
        characterIdFallbackTimer = setTimeout(() => {
            characterIdFallbackTimer = null;
            if (!currentCharacterId || currentCharacterId === 'default_character') {
                updateCharacterId();
                if (pluginInitialized) {
                    throttledMarkFavorites();
                    scheduleEnsureMarketQuickLinks();
                }
            }
        }, 3000);
    }

    // 啟動外掛
    hookWebSocketForCharacterId();
    if (document.readyState === 'complete') {
        main();
    } else {
        window.addEventListener('load', main);
    }


})();
