// ==UserScript==
// @name         [銀河奶牛]食用工具
// @name:en      Edible Tools
// @namespace    http://tampermonkey.net/
// @version      0.513
// @description  開箱記錄、箱子期望、離線統計、公會釘釘、食物警察、掉落追蹤、強化統計、地牢計算
// @description:en  Chest log, chest value, offline stats, guild XP, food monitor, drop tracking, enhancement stats
// @author       Truth_Light
// @license      CC-BY-NC-SA-4.0
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://test.milkywayidlecn.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @connect      raw.githubusercontent.com
// @connect      www.milkywayidlecn.com
// @grant        GM.xmlHttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js
// @downloadURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/Edible Tools.user.js
// @updateURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/Edible Tools.user.js
// ==/UserScript==

(async function() {
    'use strict';
    const currentHostname = window.location.hostname;
    let isCN = !['en'].some(lang =>localStorage.getItem("i18nextLng")?.toLowerCase()?.startsWith(lang));
    let lastWs = null;
    const itemSelector = '.ItemDictionary_drop__24I5f';
    const iconSelector = '.Icon_icon__2LtL_ use';
    const chestNameSelector = "#root > div > div > div.ItemDictionary_modalWrapper__1Ywn2 > div > div.Modal_modal__1Jiep > div.Modal_modalContent__3FKyF > div > div.ItemDictionary_itemAndDescription__28_he > div.Item_itemContainer__x7kH1 > div > div > div > div > svg > use"

    const DEFAULT_EDIBLE_TOOLS_SET = {
        enableCloakPrice: true,
        enableRareItemExpectPrice: true,
        enableHideOldVersionChestData: true,
        enableHideChestExpectation: false,
        enableMarketTaxCalculation: false,
        enablePointCombatLevel: true,
        enableCowbellPrice: true,
        marketApiSource: 'official',
        forceLanguage: 'none',
        foodWarningThreshold: 12,
        enableShowToast: true
    };

    const rawSet = JSON.parse(localStorage.getItem('Edible_Tools_Set')) || {};
    let Edible_Tools_Set = Object.assign({}, DEFAULT_EDIBLE_TOOLS_SET, rawSet);
    if (Edible_Tools_Set.forceLanguage === 'zh') {
        isCN = true;
    } else if (Edible_Tools_Set.forceLanguage === 'en') {
        isCN = false;
    }
    let formattedChestDropData = {};
    let battlePlayerFood = {};
    let battlePlayerLoot = {};
    let battlePlayerData = {};
    let battlePlayerFoodConsumable = {};
    let battleDuration;
    let battleRunCount;
    let battleDifficultyTier;
    let needTestFood = true;
    let DungeonData = {};
    let now_battle_map;
    let enhancementLevel;
    let currentEnhancingIndex = 1;
    let enhancementData = {
        [currentEnhancingIndex]: { "強化資料": {}, "其他資料": {} }
    };
    let currentPlayerID = null;
    let currentPlayerName = null;
    let item_icon_url

    let processCombatConsumablesRunCount = 0;

    let marketData = JSON.parse(localStorage.getItem('Edible_Tools_marketAPI_json'));

    const init_Client_Data = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem('initClientData')));

    if (!init_Client_Data) return;
    if (init_Client_Data.type !== 'init_client_data') return;
    const xp_table = init_Client_Data.levelExperienceTable;
    const item_hrid_to_name = {};
    for (const key in init_Client_Data.itemDetailMap) {
        const item = init_Client_Data.itemDetailMap[key];
        if (item && typeof item === 'object' && item.name) {
            item_hrid_to_name[key] = item.name;
        }
    }
    //console.log(item_hrid_to_name)
    const item_name_to_hrid = Object.fromEntries(
        Object.entries(item_hrid_to_name).map(([key, value]) => [value, key])
    );

    function formatmwiToolsMarketData(mwiToolsMarketData, item_hrid_to_name) {
        const result = { market: {} };

        if (!mwiToolsMarketData || !mwiToolsMarketData.marketData) {
            console.error('無效的 MWITools 市場資料');
            return result;
        }

        for (const itemPath in mwiToolsMarketData.marketData) {
            const priceEntry = mwiToolsMarketData.marketData[itemPath]?.["0"];

            if (!priceEntry || typeof priceEntry.a !== 'number' || typeof priceEntry.b !== 'number') {
                continue;
            }

            let itemName = item_hrid_to_name[itemPath];
            if (!itemName) { continue; }

            result.market[itemName] = {
                ask: priceEntry.a,
                bid: priceEntry.b
            };
        }

        return result;
    }

    /**
     * 計算食物單次消耗間隔（秒）
     * @param {string} itemName - 食物名稱
     * @param {number} drinkConcentration - 飲料濃度加成
     * @param {object|null} statsData - 統計資料 { Food: {hrid: count}, Time: seconds }
     * @param {string|null} itemHrid - 食物hrid，用於查統計資料
     * @returns {number} 單次消耗間隔（秒）
     */
    function getFoodUnitTime(itemName, drinkConcentration, statsData, itemHrid) {
        if (itemName.includes('Coffee')) {
            return 300 / (1 + drinkConcentration);
        }
        if (statsData?.Time != null && itemHrid && statsData.Food?.[itemHrid] != null) {
            return statsData.Time / statsData.Food[itemHrid];
        }
        if (itemName.includes('Donut') || itemName.includes('Cake') || itemName.includes('cake')) return 75;
        if (itemName.includes('Gummy') || itemName.includes('Yogurt')) return 67;
        return 60;
    }

    const toastQueues = Array.from({ length: 3 }, () => []);
    const maxVisibleToasts = 8;
    let isToastVisible = Array(3).fill(false);

    function showToast(message, duration = 5000) {
        if (!Edible_Tools_Set.enableShowToast) return;
        const queueIndex = findBestQueue();
        if (queueIndex === -1) return;

        toastQueues[queueIndex].push({ message, duration });
        displayNextToast(queueIndex);
    }

    function findBestQueue() {
        let minLength = Infinity;
        let bestQueue = -1;

        for (let i = 0; i < toastQueues.length; i++) {
            if (toastQueues[i].length < minLength) {
                minLength = toastQueues[i].length;
                bestQueue = i;
            }
        }

        const totalToasts = toastQueues.reduce((sum, queue) => sum + queue.length, 0);
        return totalToasts < maxVisibleToasts ? bestQueue : -1;
    }

    function displayNextToast(queueIndex) {
        if (isToastVisible[queueIndex] || toastQueues[queueIndex].length === 0) return;

        const { message, duration } = toastQueues[queueIndex].shift();
        isToastVisible[queueIndex] = true;

        const toast = createToastElement(message, queueIndex);

        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        }, 10);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-1.25rem)';

            setTimeout(() => {
                if (document.body.contains(toast)) {
                    document.body.removeChild(toast);
                }
                isToastVisible[queueIndex] = false;
                displayNextToast(queueIndex);
            }, 500);
        }, duration);
    }

    function createToastElement(message, queueIndex) {
        const toast = document.createElement('div');
        toast.className = 'food-warning-toast';

        // 基礎樣式
        toast.style.cssText = `
        position: fixed;
        left: 50%;
        transform: translateX(-50%) translateY(1.25rem);
        background: linear-gradient(135deg, #ff6b6b, #ee5a52);
        color: white;
        padding: 0.75rem 1.25rem;
        border-radius: 0.5rem;
        z-index: 10000;
        text-align: center;
        opacity: 0;
        transition: all 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        box-shadow: 0 0.25rem 0.9375rem rgba(255, 107, 107, 0.3);
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 0.75rem;
        font-weight: 500;
        line-height: 1.4;
        max-width: 18.75rem;
        word-wrap: break-word;
        white-space: normal;
        border: 0.0625rem solid rgba(255, 255, 255, 0.2);
    `;

        const baseBottom = 1.25;
        const verticalSpacing = 5;
        toast.style.bottom = `${baseBottom + queueIndex * verticalSpacing}rem`;

        toast.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
            <span style="font-size: 0.75rem;">⚠️</span>
            <span>${message}</span>
        </div>
    `;

        document.body.appendChild(toast);
        return toast;
    }
    const e2c = {
        "Coin": "金幣",
        "Task Token": "任務代幣",
        "Labyrinth Token": "迷宮代幣",
        "Chimerical Token": "奇幻代幣",
        "Sinister Token": "陰森代幣",
        "Enchanted Token": "秘法代幣",
        "Pirate Token": "海盜代幣",
        "Guild Token": "公會代幣",
        "Green Guild Credit": "綠色公會信用點",
        "Brown Guild Credit": "棕色公會信用點",
        "White Guild Credit": "白色公會信用點",
        "Blue Guild Credit": "藍色公會信用點",
        "Purple Guild Credit": "紫色公會信用點",
        "Red Guild Credit": "紅色公會信用點",
        "Silver Guild Credit": "銀色公會信用點",
        "Gold Guild Credit": "金色公會信用點",
        "Cowbell": "牛鈴",
        "Bag Of 10 Cowbells": "牛鈴袋 (10個)",
        "Purple's Gift": "小紫牛的禮物",
        "Small Meteorite Cache": "小隕石艙",
        "Medium Meteorite Cache": "中隕石艙",
        "Large Meteorite Cache": "大隕石艙",
        "Small Artisan's Crate": "小工匠匣",
        "Medium Artisan's Crate": "中工匠匣",
        "Large Artisan's Crate": "大工匠匣",
        "Small Treasure Chest": "小寶箱",
        "Medium Treasure Chest": "中寶箱",
        "Large Treasure Chest": "大寶箱",
        "Chimerical Chest": "奇幻寶箱",
        "Chimerical Refinement Chest": "奇幻精煉寶箱",
        "Sinister Chest": "陰森寶箱",
        "Sinister Refinement Chest": "陰森精煉寶箱",
        "Enchanted Chest": "秘法寶箱",
        "Enchanted Refinement Chest": "秘法精煉寶箱",
        "Pirate Chest": "海盜寶箱",
        "Pirate Refinement Chest": "海盜精煉寶箱",
        "Purdora's Box (Skilling)": "紫多拉之盒（生活）",
        "Purdora's Box (Combat)": "紫多拉之盒（戰鬥）",
        "Labyrinth Refinement Chest": "迷宮精煉寶箱",
        "Scroll Of Gathering": "採集卷軸",
        "Scroll Of Gourmet": "美食卷軸",
        "Scroll Of Processing": "加工卷軸",
        "Scroll Of Efficiency": "效率卷軸",
        "Scroll Of Action Speed": "行動速度卷軸",
        "Scroll Of Combat Drop": "戰鬥掉落卷軸",
        "Scroll Of Attack Speed": "攻擊速度卷軸",
        "Scroll Of Cast Speed": "施法速度卷軸",
        "Scroll Of Damage": "傷害卷軸",
        "Scroll Of Critical Rate": "暴擊率卷軸",
        "Scroll Of Wisdom": "經驗卷軸",
        "Scroll Of Rare Find": "稀有發現卷軸",
        "Blue Key Fragment": "藍色鑰匙碎片",
        "Green Key Fragment": "綠色鑰匙碎片",
        "Purple Key Fragment": "紫色鑰匙碎片",
        "White Key Fragment": "白色鑰匙碎片",
        "Orange Key Fragment": "橙色鑰匙碎片",
        "Brown Key Fragment": "棕色鑰匙碎片",
        "Stone Key Fragment": "石頭鑰匙碎片",
        "Dark Key Fragment": "黑暗鑰匙碎片",
        "Burning Key Fragment": "燃燒鑰匙碎片",
        "Chimerical Entry Key": "奇幻鑰匙",
        "Chimerical Chest Key": "奇幻寶箱鑰匙",
        "Sinister Entry Key": "陰森鑰匙",
        "Sinister Chest Key": "陰森寶箱鑰匙",
        "Enchanted Entry Key": "秘法鑰匙",
        "Enchanted Chest Key": "秘法寶箱鑰匙",
        "Pirate Entry Key": "海盜鑰匙",
        "Pirate Chest Key": "海盜寶箱鑰匙",
        "Donut": "甜甜圈",
        "Blueberry Donut": "藍莓甜甜圈",
        "Blackberry Donut": "黑莓甜甜圈",
        "Strawberry Donut": "草莓甜甜圈",
        "Mooberry Donut": "哞莓甜甜圈",
        "Marsberry Donut": "火星莓甜甜圈",
        "Spaceberry Donut": "太空莓甜甜圈",
        "Cupcake": "紙杯蛋糕",
        "Blueberry Cake": "藍莓蛋糕",
        "Blackberry Cake": "黑莓蛋糕",
        "Strawberry Cake": "草莓蛋糕",
        "Mooberry Cake": "哞莓蛋糕",
        "Marsberry Cake": "火星莓蛋糕",
        "Spaceberry Cake": "太空莓蛋糕",
        "Gummy": "軟糖",
        "Apple Gummy": "蘋果軟糖",
        "Orange Gummy": "橙子軟糖",
        "Plum Gummy": "李子軟糖",
        "Peach Gummy": "桃子軟糖",
        "Dragon Fruit Gummy": "火龍果軟糖",
        "Star Fruit Gummy": "楊桃軟糖",
        "Yogurt": "酸奶",
        "Apple Yogurt": "蘋果酸奶",
        "Orange Yogurt": "橙子酸奶",
        "Plum Yogurt": "李子酸奶",
        "Peach Yogurt": "桃子酸奶",
        "Dragon Fruit Yogurt": "火龍果酸奶",
        "Star Fruit Yogurt": "楊桃酸奶",
        "Milking Tea": "擠奶茶",
        "Foraging Tea": "採摘茶",
        "Woodcutting Tea": "伐木茶",
        "Cooking Tea": "烹飪茶",
        "Brewing Tea": "沖泡茶",
        "Alchemy Tea": "鍊金茶",
        "Enhancing Tea": "強化茶",
        "Cheesesmithing Tea": "乳酪鍛造茶",
        "Crafting Tea": "製作茶",
        "Tailoring Tea": "縫紉茶",
        "Super Milking Tea": "超級擠奶茶",
        "Super Foraging Tea": "超級採摘茶",
        "Super Woodcutting Tea": "超級伐木茶",
        "Super Cooking Tea": "超級烹飪茶",
        "Super Brewing Tea": "超級沖泡茶",
        "Super Alchemy Tea": "超級鍊金茶",
        "Super Enhancing Tea": "超級強化茶",
        "Super Cheesesmithing Tea": "超級乳酪鍛造茶",
        "Super Crafting Tea": "超級製作茶",
        "Super Tailoring Tea": "超級縫紉茶",
        "Ultra Milking Tea": "究極擠奶茶",
        "Ultra Foraging Tea": "究極採摘茶",
        "Ultra Woodcutting Tea": "究極伐木茶",
        "Ultra Cooking Tea": "究極烹飪茶",
        "Ultra Brewing Tea": "究極沖泡茶",
        "Ultra Alchemy Tea": "究極鍊金茶",
        "Ultra Enhancing Tea": "究極強化茶",
        "Ultra Cheesesmithing Tea": "究極乳酪鍛造茶",
        "Ultra Crafting Tea": "究極製作茶",
        "Ultra Tailoring Tea": "究極縫紉茶",
        "Gathering Tea": "採集茶",
        "Gourmet Tea": "美食茶",
        "Wisdom Tea": "經驗茶",
        "Processing Tea": "加工茶",
        "Efficiency Tea": "效率茶",
        "Artisan Tea": "工匠茶",
        "Catalytic Tea": "催化茶",
        "Blessed Tea": "福氣茶",
        "Stamina Coffee": "耐力咖啡",
        "Intelligence Coffee": "智力咖啡",
        "Defense Coffee": "防禦咖啡",
        "Attack Coffee": "攻擊咖啡",
        "Melee Coffee": "近戰咖啡",
        "Ranged Coffee": "遠端咖啡",
        "Magic Coffee": "魔法咖啡",
        "Super Stamina Coffee": "超級耐力咖啡",
        "Super Intelligence Coffee": "超級智力咖啡",
        "Super Defense Coffee": "超級防禦咖啡",
        "Super Attack Coffee": "超級攻擊咖啡",
        "Super Melee Coffee": "超級近戰咖啡",
        "Super Ranged Coffee": "超級遠端咖啡",
        "Super Magic Coffee": "超級魔法咖啡",
        "Ultra Stamina Coffee": "究極耐力咖啡",
        "Ultra Intelligence Coffee": "究極智力咖啡",
        "Ultra Defense Coffee": "究極防禦咖啡",
        "Ultra Attack Coffee": "究極攻擊咖啡",
        "Ultra Melee Coffee": "究極近戰咖啡",
        "Ultra Ranged Coffee": "究極遠端咖啡",
        "Ultra Magic Coffee": "究極魔法咖啡",
        "Wisdom Coffee": "經驗咖啡",
        "Lucky Coffee": "幸運咖啡",
        "Swiftness Coffee": "迅捷咖啡",
        "Channeling Coffee": "吟唱咖啡",
        "Critical Coffee": "暴擊咖啡",
        "Poke": "破膽之刺",
        "Impale": "透骨之刺",
        "Puncture": "破甲之刺",
        "Penetrating Strike": "貫心之刺",
        "Scratch": "爪影斬",
        "Cleave": "分裂斬",
        "Maim": "血刃斬",
        "Crippling Slash": "致殘斬",
        "Smack": "重碾",
        "Sweep": "重掃",
        "Stunning Blow": "重錘",
        "Fracturing Impact": "碎裂衝擊",
        "Shield Bash": "盾擊",
        "Quick Shot": "快速射擊",
        "Aqua Arrow": "流水箭",
        "Flame Arrow": "烈焰箭",
        "Rain Of Arrows": "箭雨",
        "Silencing Shot": "沉默之箭",
        "Steady Shot": "穩定射擊",
        "Pestilent Shot": "疫病射擊",
        "Penetrating Shot": "貫穿射擊",
        "Water Strike": "流水衝擊",
        "Ice Spear": "冰槍術",
        "Frost Surge": "冰霜爆裂",
        "Mana Spring": "法力噴泉",
        "Entangle": "纏繞",
        "Toxic Pollen": "劇毒粉塵",
        "Nature's Veil": "自然菌幕",
        "Life Drain": "生命吸取",
        "Fireball": "火球",
        "Flame Blast": "熔岩爆裂",
        "Firestorm": "火焰風暴",
        "Smoke Burst": "煙爆滅影",
        "Minor Heal": "初級自愈術",
        "Heal": "自愈術",
        "Quick Aid": "快速治療術",
        "Rejuvenate": "群體治療術",
        "Taunt": "嘲諷",
        "Provoke": "挑釁",
        "Toughness": "堅韌",
        "Elusiveness": "閃避",
        "Precision": "精確",
        "Berserk": "狂暴",
        "Elemental Affinity": "元素增幅",
        "Frenzy": "狂速",
        "Spike Shell": "尖刺防護",
        "Retribution": "懲戒",
        "Vampirism": "吸血",
        "Revive": "復活",
        "Insanity": "瘋狂",
        "Invincible": "無敵",
        "Speed Aura": "速度光環",
        "Guardian Aura": "守護光環",
        "Fierce Aura": "物理光環",
        "Critical Aura": "暴擊光環",
        "Mystic Aura": "元素光環",
        "Gobo Stabber": "哥布林長劍",
        "Gobo Slasher": "哥布林關刀",
        "Gobo Smasher": "哥布林狼牙棒",
        "Spiked Bulwark": "尖刺重盾",
        "Werewolf Slasher": "狼人關刀",
        "Griffin Bulwark": "獅鷲重盾",
        "Griffin Bulwark ★": "獅鷲重盾 ★",
        "Gobo Shooter": "哥布林彈弓",
        "Vampiric Bow": "吸血弓",
        "Cursed Bow": "咒怨之弓",
        "Cursed Bow ★": "咒怨之弓 ★",
        "Gobo Boomstick": "哥布林火棍",
        "Cheese Bulwark": "乳酪重盾",
        "Verdant Bulwark": "翠綠重盾",
        "Azure Bulwark": "蔚藍重盾",
        "Burble Bulwark": "深紫重盾",
        "Crimson Bulwark": "絳紅重盾",
        "Rainbow Bulwark": "彩虹重盾",
        "Holy Bulwark": "神聖重盾",
        "Wooden Bow": "木弓",
        "Birch Bow": "樺木弓",
        "Cedar Bow": "雪松弓",
        "Purpleheart Bow": "紫心弓",
        "Ginkgo Bow": "銀杏弓",
        "Redwood Bow": "紅杉弓",
        "Arcane Bow": "神秘弓",
        "Stalactite Spear": "石鍾長槍",
        "Granite Bludgeon": "花崗岩大棒",
        "Furious Spear": "狂怒長槍",
        "Furious Spear ★": "狂怒長槍 ★",
        "Regal Sword": "君王之劍",
        "Regal Sword ★": "君王之劍 ★",
        "Chaotic Flail": "混沌連枷",
        "Chaotic Flail ★": "混沌連枷 ★",
        "Soul Hunter Crossbow": "靈魂獵手弩",
        "Sundering Crossbow": "裂空之弩",
        "Sundering Crossbow ★": "裂空之弩 ★",
        "Frost Staff": "冰霜法杖",
        "Infernal Battlestaff": "煉獄法杖",
        "Jackalope Staff": "鹿角兔之杖",
        "Rippling Trident": "漣漪三叉戟",
        "Rippling Trident ★": "漣漪三叉戟 ★",
        "Blooming Trident": "綻放三叉戟",
        "Blooming Trident ★": "綻放三叉戟 ★",
        "Blazing Trident": "熾焰三叉戟",
        "Blazing Trident ★": "熾焰三叉戟 ★",
        "Cheese Sword": "乳酪劍",
        "Verdant Sword": "翠綠劍",
        "Azure Sword": "蔚藍劍",
        "Burble Sword": "深紫劍",
        "Crimson Sword": "絳紅劍",
        "Rainbow Sword": "彩虹劍",
        "Holy Sword": "神聖劍",
        "Cheese Spear": "乳酪長槍",
        "Verdant Spear": "翠綠長槍",
        "Azure Spear": "蔚藍長槍",
        "Burble Spear": "深紫長槍",
        "Crimson Spear": "絳紅長槍",
        "Rainbow Spear": "彩虹長槍",
        "Holy Spear": "神聖長槍",
        "Cheese Mace": "乳酪釘頭錘",
        "Verdant Mace": "翠綠釘頭錘",
        "Azure Mace": "蔚藍釘頭錘",
        "Burble Mace": "深紫釘頭錘",
        "Crimson Mace": "絳紅釘頭錘",
        "Rainbow Mace": "彩虹釘頭錘",
        "Holy Mace": "神聖釘頭錘",
        "Wooden Crossbow": "木弩",
        "Birch Crossbow": "樺木弩",
        "Cedar Crossbow": "雪松弩",
        "Purpleheart Crossbow": "紫心弩",
        "Ginkgo Crossbow": "銀杏弩",
        "Redwood Crossbow": "紅杉弩",
        "Arcane Crossbow": "神秘弩",
        "Wooden Water Staff": "木製水法杖",
        "Birch Water Staff": "樺木水法杖",
        "Cedar Water Staff": "雪松水法杖",
        "Purpleheart Water Staff": "紫心水法杖",
        "Ginkgo Water Staff": "銀杏水法杖",
        "Redwood Water Staff": "紅杉水法杖",
        "Arcane Water Staff": "神秘水法杖",
        "Wooden Nature Staff": "木製自然法杖",
        "Birch Nature Staff": "樺木自然法杖",
        "Cedar Nature Staff": "雪松自然法杖",
        "Purpleheart Nature Staff": "紫心自然法杖",
        "Ginkgo Nature Staff": "銀杏自然法杖",
        "Redwood Nature Staff": "紅杉自然法杖",
        "Arcane Nature Staff": "神秘自然法杖",
        "Wooden Fire Staff": "木製火法杖",
        "Birch Fire Staff": "樺木火法杖",
        "Cedar Fire Staff": "雪松火法杖",
        "Purpleheart Fire Staff": "紫心火法杖",
        "Ginkgo Fire Staff": "銀杏火法杖",
        "Redwood Fire Staff": "紅杉火法杖",
        "Arcane Fire Staff": "神秘火法杖",
        "Eye Watch": "掌上監工",
        "Snake Fang Dirk": "蛇牙短劍",
        "Vision Shield": "視覺盾",
        "Gobo Defender": "哥布林防禦者",
        "Vampire Fang Dirk": "吸血鬼短劍",
        "Knight's Aegis": "騎士盾",
        "Knight's Aegis ★": "騎士盾 ★",
        "Treant Shield": "樹人盾",
        "Manticore Shield": "蠍獅盾",
        "Tome Of Healing": "治療之書",
        "Tome Of The Elements": "元素之書",
        "Watchful Relic": "警戒遺物",
        "Bishop's Codex": "主教法典",
        "Bishop's Codex ★": "主教法典 ★",
        "Cheese Buckler": "乳酪圓盾",
        "Verdant Buckler": "翠綠圓盾",
        "Azure Buckler": "蔚藍圓盾",
        "Burble Buckler": "深紫圓盾",
        "Crimson Buckler": "絳紅圓盾",
        "Rainbow Buckler": "彩虹圓盾",
        "Holy Buckler": "神聖圓盾",
        "Wooden Shield": "木盾",
        "Birch Shield": "樺木盾",
        "Cedar Shield": "雪松盾",
        "Purpleheart Shield": "紫心盾",
        "Ginkgo Shield": "銀杏盾",
        "Redwood Shield": "紅杉盾",
        "Arcane Shield": "神秘盾",
        "Gatherer Cape": "採集者披風",
        "Gatherer Cape ★": "採集者披風 ★",
        "Artificer Cape": "工匠披風",
        "Artificer Cape ★": "工匠披風 ★",
        "Culinary Cape": "廚師披風",
        "Culinary Cape ★": "廚師披風 ★",
        "Chance Cape": "機緣披風",
        "Chance Cape ★": "機緣披風 ★",
        "Sinister Cape": "陰森披風",
        "Sinister Cape ★": "陰森披風 ★",
        "Chimerical Quiver": "奇幻箭袋",
        "Chimerical Quiver ★": "奇幻箭袋 ★",
        "Enchanted Cloak": "秘法披風",
        "Enchanted Cloak ★": "秘法披風 ★",
        "Red Culinary Hat": "紅色廚師帽",
        "Snail Shell Helmet": "蝸牛殼頭盔",
        "Vision Helmet": "視覺頭盔",
        "Fluffy Red Hat": "蓬鬆紅帽子",
        "Corsair Helmet": "掠奪者頭盔",
        "Corsair Helmet ★": "掠奪者頭盔 ★",
        "Acrobatic Hood": "雜技師兜帽",
        "Acrobatic Hood ★": "雜技師兜帽 ★",
        "Magician's Hat": "魔術師帽",
        "Magician's Hat ★": "魔術師帽 ★",
        "Cheese Helmet": "乳酪頭盔",
        "Verdant Helmet": "翠綠頭盔",
        "Azure Helmet": "蔚藍頭盔",
        "Burble Helmet": "深紫頭盔",
        "Crimson Helmet": "絳紅頭盔",
        "Rainbow Helmet": "彩虹頭盔",
        "Holy Helmet": "神聖頭盔",
        "Rough Hood": "粗糙兜帽",
        "Reptile Hood": "爬行動物兜帽",
        "Gobo Hood": "哥布林兜帽",
        "Beast Hood": "野獸兜帽",
        "Umbral Hood": "暗影兜帽",
        "Cotton Hat": "棉帽",
        "Linen Hat": "亞麻帽",
        "Bamboo Hat": "竹帽",
        "Silk Hat": "絲帽",
        "Radiant Hat": "光輝帽",
        "Dairyhand's Top": "擠奶工上衣",
        "Forager's Top": "採摘者上衣",
        "Lumberjack's Top": "伐木工上衣",
        "Cheesemaker's Top": "乳酪師上衣",
        "Crafter's Top": "工匠上衣",
        "Tailor's Top": "裁縫上衣",
        "Chef's Top": "廚師上衣",
        "Brewer's Top": "飲品師上衣",
        "Alchemist's Top": "鍊金師上衣",
        "Enhancer's Top": "強化師上衣",
        "Gator Vest": "鱷魚馬甲",
        "Turtle Shell Body": "龜殼胸甲",
        "Colossus Plate Body": "巨像胸甲",
        "Demonic Plate Body": "惡魔胸甲",
        "Anchorbound Plate Body": "錨定胸甲",
        "Anchorbound Plate Body ★": "錨定胸甲 ★",
        "Maelstrom Plate Body": "怒濤胸甲",
        "Maelstrom Plate Body ★": "怒濤胸甲 ★",
        "Marine Tunic": "海洋皮衣",
        "Revenant Tunic": "亡靈皮衣",
        "Griffin Tunic": "獅鷲皮衣",
        "Kraken Tunic": "克拉肯皮衣",
        "Kraken Tunic ★": "克拉肯皮衣 ★",
        "Icy Robe Top": "冰霜袍服",
        "Flaming Robe Top": "烈焰袍服",
        "Luna Robe Top": "月神袍服",
        "Royal Water Robe Top": "皇家水系袍服",
        "Royal Water Robe Top ★": "皇家水系袍服 ★",
        "Royal Nature Robe Top": "皇家自然系袍服",
        "Royal Nature Robe Top ★": "皇家自然系袍服 ★",
        "Royal Fire Robe Top": "皇家火系袍服",
        "Royal Fire Robe Top ★": "皇家火系袍服 ★",
        "Cheese Plate Body": "乳酪胸甲",
        "Verdant Plate Body": "翠綠胸甲",
        "Azure Plate Body": "蔚藍胸甲",
        "Burble Plate Body": "深紫胸甲",
        "Crimson Plate Body": "絳紅胸甲",
        "Rainbow Plate Body": "彩虹胸甲",
        "Holy Plate Body": "神聖胸甲",
        "Rough Tunic": "粗糙皮衣",
        "Reptile Tunic": "爬行動物皮衣",
        "Gobo Tunic": "哥布林皮衣",
        "Beast Tunic": "野獸皮衣",
        "Umbral Tunic": "暗影皮衣",
        "Cotton Robe Top": "棉袍服",
        "Linen Robe Top": "亞麻袍服",
        "Bamboo Robe Top": "竹袍服",
        "Silk Robe Top": "絲綢袍服",
        "Radiant Robe Top": "光輝袍服",
        "Dairyhand's Bottoms": "擠奶工下裝",
        "Forager's Bottoms": "採摘者下裝",
        "Lumberjack's Bottoms": "伐木工下裝",
        "Cheesemaker's Bottoms": "乳酪師下裝",
        "Crafter's Bottoms": "工匠下裝",
        "Tailor's Bottoms": "裁縫下裝",
        "Chef's Bottoms": "廚師下裝",
        "Brewer's Bottoms": "飲品師下裝",
        "Alchemist's Bottoms": "鍊金師下裝",
        "Enhancer's Bottoms": "強化師下裝",
        "Turtle Shell Legs": "龜殼腿甲",
        "Colossus Plate Legs": "巨像腿甲",
        "Demonic Plate Legs": "惡魔腿甲",
        "Anchorbound Plate Legs": "錨定腿甲",
        "Anchorbound Plate Legs ★": "錨定腿甲 ★",
        "Maelstrom Plate Legs": "怒濤腿甲",
        "Maelstrom Plate Legs ★": "怒濤腿甲 ★",
        "Marine Chaps": "航海皮褲",
        "Revenant Chaps": "亡靈皮褲",
        "Griffin Chaps": "獅鷲皮褲",
        "Kraken Chaps": "克拉肯皮褲",
        "Kraken Chaps ★": "克拉肯皮褲 ★",
        "Icy Robe Bottoms": "冰霜袍裙",
        "Flaming Robe Bottoms": "烈焰袍裙",
        "Luna Robe Bottoms": "月神袍裙",
        "Royal Water Robe Bottoms": "皇家水系袍裙",
        "Royal Water Robe Bottoms ★": "皇家水系袍裙 ★",
        "Royal Nature Robe Bottoms": "皇家自然系袍裙",
        "Royal Nature Robe Bottoms ★": "皇家自然系袍裙 ★",
        "Royal Fire Robe Bottoms": "皇家火系袍裙",
        "Royal Fire Robe Bottoms ★": "皇家火系袍裙 ★",
        "Cheese Plate Legs": "乳酪腿甲",
        "Verdant Plate Legs": "翠綠腿甲",
        "Azure Plate Legs": "蔚藍腿甲",
        "Burble Plate Legs": "深紫腿甲",
        "Crimson Plate Legs": "絳紅腿甲",
        "Rainbow Plate Legs": "彩虹腿甲",
        "Holy Plate Legs": "神聖腿甲",
        "Rough Chaps": "粗糙皮褲",
        "Reptile Chaps": "爬行動物皮褲",
        "Gobo Chaps": "哥布林皮褲",
        "Beast Chaps": "野獸皮褲",
        "Umbral Chaps": "暗影皮褲",
        "Cotton Robe Bottoms": "棉袍裙",
        "Linen Robe Bottoms": "亞麻袍裙",
        "Bamboo Robe Bottoms": "竹袍裙",
        "Silk Robe Bottoms": "絲綢袍裙",
        "Radiant Robe Bottoms": "光輝袍裙",
        "Enchanted Gloves": "附魔手套",
        "Pincer Gloves": "蟹鉗手套",
        "Panda Gloves": "熊貓手套",
        "Magnetic Gloves": "磁力手套",
        "Dodocamel Gauntlets": "渡渡駝護手",
        "Dodocamel Gauntlets ★": "渡渡駝護手 ★",
        "Sighted Bracers": "瞄準護腕",
        "Marksman Bracers": "神射護腕",
        "Marksman Bracers ★": "神射護腕 ★",
        "Chrono Gloves": "時空手套",
        "Cheese Gauntlets": "乳酪護手",
        "Verdant Gauntlets": "翠綠護手",
        "Azure Gauntlets": "蔚藍護手",
        "Burble Gauntlets": "深紫護手",
        "Crimson Gauntlets": "絳紅護手",
        "Rainbow Gauntlets": "彩虹護手",
        "Holy Gauntlets": "神聖護手",
        "Rough Bracers": "粗糙護腕",
        "Reptile Bracers": "爬行動物護腕",
        "Gobo Bracers": "哥布林護腕",
        "Beast Bracers": "野獸護腕",
        "Umbral Bracers": "暗影護腕",
        "Cotton Gloves": "棉手套",
        "Linen Gloves": "亞麻手套",
        "Bamboo Gloves": "竹手套",
        "Silk Gloves": "絲手套",
        "Radiant Gloves": "光輝手套",
        "Collector's Boots": "收藏家靴",
        "Shoebill Shoes": "鯨頭鸛鞋",
        "Black Bear Shoes": "黑熊鞋",
        "Grizzly Bear Shoes": "棕熊鞋",
        "Polar Bear Shoes": "北極熊鞋",
        "Pathbreaker Boots": "開路者靴",
        "Pathbreaker Boots ★": "開路者靴 ★",
        "Centaur Boots": "半人馬靴",
        "Pathfinder Boots": "探路者靴",
        "Pathfinder Boots ★": "探路者靴 ★",
        "Sorcerer Boots": "巫師靴",
        "Pathseeker Boots": "尋路者靴",
        "Pathseeker Boots ★": "尋路者靴 ★",
        "Cheese Boots": "乳酪靴",
        "Verdant Boots": "翠綠靴",
        "Azure Boots": "蔚藍靴",
        "Burble Boots": "深紫靴",
        "Crimson Boots": "絳紅靴",
        "Rainbow Boots": "彩虹靴",
        "Holy Boots": "神聖靴",
        "Rough Boots": "粗糙靴",
        "Reptile Boots": "爬行動物靴",
        "Gobo Boots": "哥布林靴",
        "Beast Boots": "野獸靴",
        "Umbral Boots": "暗影靴",
        "Cotton Boots": "棉靴",
        "Linen Boots": "亞麻靴",
        "Bamboo Boots": "竹靴",
        "Silk Boots": "絲靴",
        "Radiant Boots": "光輝靴",
        "Small Pouch": "小袋子",
        "Medium Pouch": "中袋子",
        "Large Pouch": "大袋子",
        "Giant Pouch": "巨大袋子",
        "Gluttonous Pouch": "貪食之袋",
        "Guzzling Pouch": "暴飲之囊",
        "Necklace Of Efficiency": "效率項鍊",
        "Fighter Necklace": "戰士項鍊",
        "Ranger Necklace": "射手項鍊",
        "Wizard Necklace": "巫師項鍊",
        "Necklace Of Wisdom": "經驗項鍊",
        "Necklace Of Speed": "速度項鍊",
        "Philosopher's Necklace": "賢者項鍊",
        "Earrings Of Gathering": "採集耳環",
        "Earrings Of Essence Find": "精華髮現耳環",
        "Earrings Of Armor": "護甲耳環",
        "Earrings Of Regeneration": "恢復耳環",
        "Earrings Of Resistance": "抗性耳環",
        "Earrings Of Rare Find": "稀有發現耳環",
        "Earrings Of Critical Strike": "暴擊耳環",
        "Philosopher's Earrings": "賢者耳環",
        "Ring Of Gathering": "採集戒指",
        "Ring Of Essence Find": "精華髮現戒指",
        "Ring Of Armor": "護甲戒指",
        "Ring Of Regeneration": "恢復戒指",
        "Ring Of Resistance": "抗性戒指",
        "Ring Of Rare Find": "稀有發現戒指",
        "Ring Of Critical Strike": "暴擊戒指",
        "Philosopher's Ring": "賢者戒指",
        "Trainee Milking Charm": "實習擠奶護符",
        "Basic Milking Charm": "基礎擠奶護符",
        "Advanced Milking Charm": "高階擠奶護符",
        "Expert Milking Charm": "專家擠奶護符",
        "Master Milking Charm": "大師擠奶護符",
        "Grandmaster Milking Charm": "宗師擠奶護符",
        "Trainee Foraging Charm": "實習採摘護符",
        "Basic Foraging Charm": "基礎採摘護符",
        "Advanced Foraging Charm": "高階採摘護符",
        "Expert Foraging Charm": "專家採摘護符",
        "Master Foraging Charm": "大師採摘護符",
        "Grandmaster Foraging Charm": "宗師採摘護符",
        "Trainee Woodcutting Charm": "實習伐木護符",
        "Basic Woodcutting Charm": "基礎伐木護符",
        "Advanced Woodcutting Charm": "高階伐木護符",
        "Expert Woodcutting Charm": "專家伐木護符",
        "Master Woodcutting Charm": "大師伐木護符",
        "Grandmaster Woodcutting Charm": "宗師伐木護符",
        "Trainee Cheesesmithing Charm": "實習乳酪鍛造護符",
        "Basic Cheesesmithing Charm": "基礎乳酪鍛造護符",
        "Advanced Cheesesmithing Charm": "高階乳酪鍛造護符",
        "Expert Cheesesmithing Charm": "專家乳酪鍛造護符",
        "Master Cheesesmithing Charm": "大師乳酪鍛造護符",
        "Grandmaster Cheesesmithing Charm": "宗師乳酪鍛造護符",
        "Trainee Crafting Charm": "實習製作護符",
        "Basic Crafting Charm": "基礎製作護符",
        "Advanced Crafting Charm": "高階製作護符",
        "Expert Crafting Charm": "專家制作護符",
        "Master Crafting Charm": "大師製作護符",
        "Grandmaster Crafting Charm": "宗師製作護符",
        "Trainee Tailoring Charm": "實習縫紉護符",
        "Basic Tailoring Charm": "基礎縫紉護符",
        "Advanced Tailoring Charm": "高階縫紉護符",
        "Expert Tailoring Charm": "專家縫紉護符",
        "Master Tailoring Charm": "大師縫紉護符",
        "Grandmaster Tailoring Charm": "宗師縫紉護符",
        "Trainee Cooking Charm": "實習烹飪護符",
        "Basic Cooking Charm": "基礎烹飪護符",
        "Advanced Cooking Charm": "高階烹飪護符",
        "Expert Cooking Charm": "專家烹飪護符",
        "Master Cooking Charm": "大師烹飪護符",
        "Grandmaster Cooking Charm": "宗師烹飪護符",
        "Trainee Brewing Charm": "實習沖泡護符",
        "Basic Brewing Charm": "基礎沖泡護符",
        "Advanced Brewing Charm": "高階沖泡護符",
        "Expert Brewing Charm": "專家沖泡護符",
        "Master Brewing Charm": "大師沖泡護符",
        "Grandmaster Brewing Charm": "宗師沖泡護符",
        "Trainee Alchemy Charm": "實習鍊金護符",
        "Basic Alchemy Charm": "基礎鍊金護符",
        "Advanced Alchemy Charm": "高階鍊金護符",
        "Expert Alchemy Charm": "專家鍊金護符",
        "Master Alchemy Charm": "大師鍊金護符",
        "Grandmaster Alchemy Charm": "宗師鍊金護符",
        "Trainee Enhancing Charm": "實習強化護符",
        "Basic Enhancing Charm": "基礎強化護符",
        "Advanced Enhancing Charm": "高階強化護符",
        "Expert Enhancing Charm": "專家強化護符",
        "Master Enhancing Charm": "大師強化護符",
        "Grandmaster Enhancing Charm": "宗師強化護符",
        "Trainee Stamina Charm": "實習耐力護符",
        "Basic Stamina Charm": "基礎耐力護符",
        "Advanced Stamina Charm": "高階耐力護符",
        "Expert Stamina Charm": "專家耐力護符",
        "Master Stamina Charm": "大師耐力護符",
        "Grandmaster Stamina Charm": "宗師耐力護符",
        "Trainee Intelligence Charm": "實習智力護符",
        "Basic Intelligence Charm": "基礎智力護符",
        "Advanced Intelligence Charm": "高階智力護符",
        "Expert Intelligence Charm": "專家智力護符",
        "Master Intelligence Charm": "大師智力護符",
        "Grandmaster Intelligence Charm": "宗師智力護符",
        "Trainee Attack Charm": "實習攻擊護符",
        "Basic Attack Charm": "基礎攻擊護符",
        "Advanced Attack Charm": "高階攻擊護符",
        "Expert Attack Charm": "專家攻擊護符",
        "Master Attack Charm": "大師攻擊護符",
        "Grandmaster Attack Charm": "宗師攻擊護符",
        "Trainee Defense Charm": "實習防禦護符",
        "Basic Defense Charm": "基礎防禦護符",
        "Advanced Defense Charm": "高階防禦護符",
        "Expert Defense Charm": "專家防禦護符",
        "Master Defense Charm": "大師防禦護符",
        "Grandmaster Defense Charm": "宗師防禦護符",
        "Trainee Melee Charm": "實習近戰護符",
        "Basic Melee Charm": "基礎近戰護符",
        "Advanced Melee Charm": "高階近戰護符",
        "Expert Melee Charm": "專家近戰護符",
        "Master Melee Charm": "大師近戰護符",
        "Grandmaster Melee Charm": "宗師近戰護符",
        "Trainee Ranged Charm": "實習遠端護符",
        "Basic Ranged Charm": "基礎遠端護符",
        "Advanced Ranged Charm": "高階遠端護符",
        "Expert Ranged Charm": "專家遠端護符",
        "Master Ranged Charm": "大師遠端護符",
        "Grandmaster Ranged Charm": "宗師遠端護符",
        "Trainee Magic Charm": "實習魔法護符",
        "Basic Magic Charm": "基礎魔法護符",
        "Advanced Magic Charm": "高階魔法護符",
        "Expert Magic Charm": "專家魔法護符",
        "Master Magic Charm": "大師魔法護符",
        "Grandmaster Magic Charm": "宗師魔法護符",
        "Basic Task Badge": "基礎任務徽章",
        "Advanced Task Badge": "高階任務徽章",
        "Expert Task Badge": "專家任務徽章",
        "Celestial Brush": "星空刷子",
        "Cheese Brush": "乳酪刷子",
        "Verdant Brush": "翠綠刷子",
        "Azure Brush": "蔚藍刷子",
        "Burble Brush": "深紫刷子",
        "Crimson Brush": "絳紅刷子",
        "Rainbow Brush": "彩虹刷子",
        "Holy Brush": "神聖刷子",
        "Celestial Shears": "星空剪刀",
        "Cheese Shears": "乳酪剪刀",
        "Verdant Shears": "翠綠剪刀",
        "Azure Shears": "蔚藍剪刀",
        "Burble Shears": "深紫剪刀",
        "Crimson Shears": "絳紅剪刀",
        "Rainbow Shears": "彩虹剪刀",
        "Holy Shears": "神聖剪刀",
        "Celestial Hatchet": "星空斧頭",
        "Cheese Hatchet": "乳酪斧頭",
        "Verdant Hatchet": "翠綠斧頭",
        "Azure Hatchet": "蔚藍斧頭",
        "Burble Hatchet": "深紫斧頭",
        "Crimson Hatchet": "絳紅斧頭",
        "Rainbow Hatchet": "彩虹斧頭",
        "Holy Hatchet": "神聖斧頭",
        "Celestial Hammer": "星空錘子",
        "Cheese Hammer": "乳酪錘子",
        "Verdant Hammer": "翠綠錘子",
        "Azure Hammer": "蔚藍錘子",
        "Burble Hammer": "深紫錘子",
        "Crimson Hammer": "絳紅錘子",
        "Rainbow Hammer": "彩虹錘子",
        "Holy Hammer": "神聖錘子",
        "Celestial Chisel": "星空鑿子",
        "Cheese Chisel": "乳酪鑿子",
        "Verdant Chisel": "翠綠鑿子",
        "Azure Chisel": "蔚藍鑿子",
        "Burble Chisel": "深紫鑿子",
        "Crimson Chisel": "絳紅鑿子",
        "Rainbow Chisel": "彩虹鑿子",
        "Holy Chisel": "神聖鑿子",
        "Celestial Needle": "星空針",
        "Cheese Needle": "乳酪針",
        "Verdant Needle": "翠綠針",
        "Azure Needle": "蔚藍針",
        "Burble Needle": "深紫針",
        "Crimson Needle": "絳紅針",
        "Rainbow Needle": "彩虹針",
        "Holy Needle": "神聖針",
        "Celestial Spatula": "星空鍋鏟",
        "Cheese Spatula": "乳酪鍋鏟",
        "Verdant Spatula": "翠綠鍋鏟",
        "Azure Spatula": "蔚藍鍋鏟",
        "Burble Spatula": "深紫鍋鏟",
        "Crimson Spatula": "絳紅鍋鏟",
        "Rainbow Spatula": "彩虹鍋鏟",
        "Holy Spatula": "神聖鍋鏟",
        "Celestial Pot": "星空壺",
        "Cheese Pot": "乳酪壺",
        "Verdant Pot": "翠綠壺",
        "Azure Pot": "蔚藍壺",
        "Burble Pot": "深紫壺",
        "Crimson Pot": "絳紅壺",
        "Rainbow Pot": "彩虹壺",
        "Holy Pot": "神聖壺",
        "Celestial Alembic": "星空蒸餾器",
        "Cheese Alembic": "乳酪蒸餾器",
        "Verdant Alembic": "翠綠蒸餾器",
        "Azure Alembic": "蔚藍蒸餾器",
        "Burble Alembic": "深紫蒸餾器",
        "Crimson Alembic": "絳紅蒸餾器",
        "Rainbow Alembic": "彩虹蒸餾器",
        "Holy Alembic": "神聖蒸餾器",
        "Celestial Enhancer": "星空強化器",
        "Cheese Enhancer": "乳酪強化器",
        "Verdant Enhancer": "翠綠強化器",
        "Azure Enhancer": "蔚藍強化器",
        "Burble Enhancer": "深紫強化器",
        "Crimson Enhancer": "絳紅強化器",
        "Rainbow Enhancer": "彩虹強化器",
        "Holy Enhancer": "神聖強化器",
        "Milk": "牛奶",
        "Verdant Milk": "翠綠牛奶",
        "Azure Milk": "蔚藍牛奶",
        "Burble Milk": "深紫牛奶",
        "Crimson Milk": "絳紅牛奶",
        "Rainbow Milk": "彩虹牛奶",
        "Holy Milk": "神聖牛奶",
        "Cheese": "乳酪",
        "Verdant Cheese": "翠綠乳酪",
        "Azure Cheese": "蔚藍乳酪",
        "Burble Cheese": "深紫乳酪",
        "Crimson Cheese": "絳紅乳酪",
        "Rainbow Cheese": "彩虹乳酪",
        "Holy Cheese": "神聖乳酪",
        "Log": "原木",
        "Birch Log": "白樺原木",
        "Cedar Log": "雪松原木",
        "Purpleheart Log": "紫心原木",
        "Ginkgo Log": "銀杏原木",
        "Redwood Log": "紅杉原木",
        "Arcane Log": "神秘原木",
        "Lumber": "木板",
        "Birch Lumber": "白樺木板",
        "Cedar Lumber": "雪松木板",
        "Purpleheart Lumber": "紫心木板",
        "Ginkgo Lumber": "銀杏木板",
        "Redwood Lumber": "紅杉木板",
        "Arcane Lumber": "神秘木板",
        "Rough Hide": "粗糙獸皮",
        "Reptile Hide": "爬行動物皮",
        "Gobo Hide": "哥布林皮",
        "Beast Hide": "野獸皮",
        "Umbral Hide": "暗影皮",
        "Rough Leather": "粗糙皮革",
        "Reptile Leather": "爬行動物皮革",
        "Gobo Leather": "哥布林皮革",
        "Beast Leather": "野獸皮革",
        "Umbral Leather": "暗影皮革",
        "Cotton": "棉花",
        "Flax": "亞麻",
        "Bamboo Branch": "竹子",
        "Cocoon": "蠶繭",
        "Radiant Fiber": "光輝纖維",
        "Cotton Fabric": "棉花布料",
        "Linen Fabric": "亞麻布料",
        "Bamboo Fabric": "竹子布料",
        "Silk Fabric": "絲綢",
        "Radiant Fabric": "光輝布料",
        "Egg": "雞蛋",
        "Wheat": "小麥",
        "Sugar": "糖",
        "Blueberry": "藍莓",
        "Blackberry": "黑莓",
        "Strawberry": "草莓",
        "Mooberry": "哞莓",
        "Marsberry": "火星莓",
        "Spaceberry": "太空莓",
        "Apple": "蘋果",
        "Orange": "橙子",
        "Plum": "李子",
        "Peach": "桃子",
        "Dragon Fruit": "火龍果",
        "Star Fruit": "楊桃",
        "Arabica Coffee Bean": "低階咖啡豆",
        "Robusta Coffee Bean": "中級咖啡豆",
        "Liberica Coffee Bean": "高階咖啡豆",
        "Excelsa Coffee Bean": "特級咖啡豆",
        "Fieriosa Coffee Bean": "火山咖啡豆",
        "Spacia Coffee Bean": "太空咖啡豆",
        "Green Tea Leaf": "綠茶葉",
        "Black Tea Leaf": "黑茶葉",
        "Burble Tea Leaf": "紫茶葉",
        "Moolong Tea Leaf": "哞龍茶葉",
        "Red Tea Leaf": "紅茶葉",
        "Emp Tea Leaf": "虛空茶葉",
        "Catalyst Of Coinification": "點金催化劑",
        "Catalyst Of Decomposition": "分解催化劑",
        "Catalyst Of Transmutation": "轉化催化劑",
        "Prime Catalyst": "至高催化劑",
        "Snake Fang": "蛇牙",
        "Shoebill Feather": "鯨頭鸛羽毛",
        "Snail Shell": "蝸牛殼",
        "Crab Pincer": "蟹鉗",
        "Turtle Shell": "烏龜殼",
        "Marine Scale": "海洋鱗片",
        "Treant Bark": "樹皮",
        "Centaur Hoof": "半人馬蹄",
        "Luna Wing": "月神翼",
        "Gobo Rag": "哥布林抹布",
        "Goggles": "護目鏡",
        "Magnifying Glass": "放大鏡",
        "Eye Of The Watcher": "觀察者之眼",
        "Icy Cloth": "冰霜織物",
        "Flaming Cloth": "烈焰織物",
        "Sorcerer's Sole": "魔法師鞋底",
        "Chrono Sphere": "時空球",
        "Frost Sphere": "冰霜球",
        "Panda Fluff": "熊貓絨",
        "Black Bear Fluff": "黑熊絨",
        "Grizzly Bear Fluff": "棕熊絨",
        "Polar Bear Fluff": "北極熊絨",
        "Red Panda Fluff": "小熊貓絨",
        "Magnet": "磁鐵",
        "Stalactite Shard": "鐘乳石碎片",
        "Living Granite": "花崗岩",
        "Colossus Core": "巨像核心",
        "Vampire Fang": "吸血鬼之牙",
        "Werewolf Claw": "狼人之爪",
        "Revenant Anima": "亡者之魂",
        "Soul Fragment": "靈魂碎片",
        "Infernal Ember": "地獄餘燼",
        "Demonic Core": "惡魔核心",
        "Griffin Leather": "獅鷲之皮",
        "Manticore Sting": "蠍獅之刺",
        "Jackalope Antler": "鹿角兔之角",
        "Dodocamel Plume": "渡渡駝之翎",
        "Griffin Talon": "獅鷲之爪",
        "Chimerical Refinement Shard": "奇幻精煉碎片",
        "Acrobat's Ribbon": "雜技師綵帶",
        "Magician's Cloth": "魔術師織物",
        "Chaotic Chain": "混沌鎖鏈",
        "Cursed Ball": "詛咒之球",
        "Sinister Refinement Shard": "陰森精煉碎片",
        "Royal Cloth": "皇家織物",
        "Knight's Ingot": "騎士之錠",
        "Bishop's Scroll": "主教卷軸",
        "Regal Jewel": "君王寶石",
        "Sundering Jewel": "裂空寶石",
        "Enchanted Refinement Shard": "秘法精煉碎片",
        "Marksman Brooch": "神射胸針",
        "Corsair Crest": "掠奪者徽章",
        "Damaged Anchor": "破損船錨",
        "Maelstrom Plating": "怒濤甲片",
        "Kraken Leather": "克拉肯皮革",
        "Kraken Fang": "克拉肯之牙",
        "Pirate Refinement Shard": "海盜精煉碎片",
        "Pathbreaker Lodestone": "開路者磁石",
        "Pathfinder Lodestone": "探路者磁石",
        "Pathseeker Lodestone": "尋路者磁石",
        "Labyrinth Refinement Shard": "迷宮精煉碎片",
        "Butter Of Proficiency": "精通之油",
        "Thread Of Expertise": "專精之線",
        "Branch Of Insight": "洞察之枝",
        "Gluttonous Energy": "貪食能量",
        "Guzzling Energy": "暴飲能量",
        "Milking Essence": "擠奶精華",
        "Foraging Essence": "採摘精華",
        "Woodcutting Essence": "伐木精華",
        "Cheesesmithing Essence": "乳酪鍛造精華",
        "Crafting Essence": "製作精華",
        "Tailoring Essence": "縫紉精華",
        "Cooking Essence": "烹飪精華",
        "Brewing Essence": "沖泡精華",
        "Alchemy Essence": "鍊金精華",
        "Enhancing Essence": "強化精華",
        "Swamp Essence": "沼澤精華",
        "Aqua Essence": "海洋精華",
        "Jungle Essence": "叢林精華",
        "Gobo Essence": "哥布林精華",
        "Eyessence": "眼精華",
        "Sorcerer Essence": "法師精華",
        "Bear Essence": "熊熊精華",
        "Golem Essence": "魔像精華",
        "Twilight Essence": "暮光精華",
        "Abyssal Essence": "地獄精華",
        "Chimerical Essence": "奇幻精華",
        "Sinister Essence": "陰森精華",
        "Enchanted Essence": "秘法精華",
        "Pirate Essence": "海盜精華",
        "Labyrinth Essence": "迷宮精華",
        "Task Crystal": "任務水晶",
        "Star Fragment": "星光碎片",
        "Pearl": "珍珠",
        "Amber": "琥珀",
        "Garnet": "石榴石",
        "Jade": "翡翠",
        "Amethyst": "紫水晶",
        "Moonstone": "月亮石",
        "Sunstone": "太陽石",
        "Philosopher's Stone": "賢者之石",
        "Crushed Pearl": "珍珠碎片",
        "Crushed Amber": "琥珀碎片",
        "Crushed Garnet": "石榴石碎片",
        "Crushed Jade": "翡翠碎片",
        "Crushed Amethyst": "紫水晶碎片",
        "Crushed Moonstone": "月亮石碎片",
        "Crushed Sunstone": "太陽石碎片",
        "Crushed Philosopher's Stone": "賢者之石碎片",
        "Shard Of Protection": "保護碎片",
        "Mirror Of Protection": "保護之鏡",
        "Philosopher's Mirror": "賢者之鏡",
        "Basic Torch": "基礎火把",
        "Advanced Torch": "進階火把",
        "Expert Torch": "專家火把",
        "Basic Shroud": "基礎斗篷",
        "Advanced Shroud": "進階斗篷",
        "Expert Shroud": "專家斗篷",
        "Basic Beacon": "基礎探照燈",
        "Advanced Beacon": "進階探照燈",
        "Expert Beacon": "專家探照燈",
        "Basic Food Crate": "基礎食物箱",
        "Advanced Food Crate": "進階食物箱",
        "Expert Food Crate": "專家食物箱",
        "Basic Tea Crate": "基礎茶葉箱",
        "Advanced Tea Crate": "進階茶葉箱",
        "Expert Tea Crate": "專家茶葉箱",
        "Basic Coffee Crate": "基礎咖啡箱",
        "Advanced Coffee Crate": "進階咖啡箱",
        "Expert Coffee Crate": "專家咖啡箱"
    }
    const specialItemPrices = {
        'Coin': {
            ask: 1,
            bid: 1
        },
        'Cowbell': {
            ask: Edible_Tools_Set.enableCowbellPrice ? (marketData?.market?.['Bag Of 10 Cowbells']?.ask ?? 210000) / 10 : -1,
            bid: Edible_Tools_Set.enableCowbellPrice ? (marketData?.market?.['Bag Of 10 Cowbells']?.bid ?? 205000) / 10 : -1
        },
        'Chimerical Token': {
            ask: marketData?.market?.['Chimerical Essence']?.ask ?? 600,
            bid: marketData?.market?.['Chimerical Essence']?.bid ?? 600
        },
        'Sinister Token': {
            ask: marketData?.market?.['Sinister Essence']?.ask ?? 900,
            bid: marketData?.market?.['Sinister Essence']?.bid ?? 900
        },
        'Enchanted Token': {
            ask: marketData?.market?.['Enchanted Essence']?.ask ?? 2000,
            bid: marketData?.market?.['Enchanted Essence']?.bid ?? 2000
        },
        'Pirate Token': {
            ask: marketData?.market?.['Pirate Essence']?.ask ?? 4000,
            bid: marketData?.market?.['Pirate Essence']?.bid ?? 4000
        },
        'Chimerical Quiver': {
            ask: Edible_Tools_Set.enableCloakPrice ? (marketData?.market?.['Mirror Of Protection']?.ask ?? 12500000) : -1,
            bid: Edible_Tools_Set.enableCloakPrice ? (marketData?.market?.['Mirror Of Protection']?.bid ?? 12000000) : -1
        },
        'Sinister Cape': {
            ask: Edible_Tools_Set.enableCloakPrice ? (marketData?.market?.['Mirror Of Protection']?.ask ?? 12500000) : -1,
            bid: Edible_Tools_Set.enableCloakPrice ? (marketData?.market?.['Mirror Of Protection']?.bid ?? 12000000) : -1
        },
        'Enchanted Cloak': {
            ask: Edible_Tools_Set.enableCloakPrice ? (marketData?.market?.['Mirror Of Protection']?.ask ?? 12500000) : -1,
            bid: Edible_Tools_Set.enableCloakPrice ? (marketData?.market?.['Mirror Of Protection']?.bid ?? 12000000) : -1
        }
    };

    const chestCosts = {
        "Chimerical Chest": {
            keyAsk: marketData?.market?.['Chimerical Chest Key']?.ask ?? 3000e3,
            keyBid: marketData?.market?.['Chimerical Chest Key']?.bid ?? 3000e3,
            entryAsk: marketData?.market?.['Chimerical Entry Key']?.ask ?? 280e3,
            entryBid: marketData?.market?.['Chimerical Entry Key']?.bid ?? 280e3
        },
        "Sinister Chest": {
            keyAsk: marketData?.market?.['Sinister Chest Key']?.ask ?? 5600e3,
            keyBid: marketData?.market?.['Sinister Chest Key']?.bid ?? 5400e3,
            entryAsk: marketData?.market?.['Sinister Entry Key']?.ask ?? 300e3,
            entryBid: marketData?.market?.['Sinister Entry Key']?.bid ?? 280e3
        },
        "Enchanted Chest": {
            keyAsk: marketData?.market?.['Enchanted Chest Key']?.ask ?? 7600e3,
            keyBid: marketData?.market?.['Enchanted Chest Key']?.bid ?? 7200e3,
            entryAsk: marketData?.market?.['Enchanted Entry Key']?.ask ?? 360e3,
            entryBid: marketData?.market?.['Enchanted Entry Key']?.bid ?? 360e3
        },
        "Pirate Chest": {
            keyAsk: marketData?.market?.['Pirate Chest Key']?.ask ?? 9400e3,
            keyBid: marketData?.market?.['Pirate Chest Key']?.bid ?? 92000e3,
            entryAsk: marketData?.market?.['Pirate Entry Key']?.ask ?? 460e3,
            entryBid: marketData?.market?.['Pirate Entry Key']?.bid ?? 440e3
        },
        "Chimerical Refinement Chest": {
            keyAsk: marketData?.market?.['Chimerical Chest Key']?.ask ?? 3000e3,
            keyBid: marketData?.market?.['Chimerical Chest Key']?.bid ?? 3000e3,
            entryAsk: marketData?.market?.['Chimerical Entry Key']?.ask ?? 280e3,
            entryBid: marketData?.market?.['Chimerical Entry Key']?.bid ?? 280e3
        },
        "Sinister Refinement Chest": {
            keyAsk: marketData?.market?.['Sinister Chest Key']?.ask ?? 5600e3,
            keyBid: marketData?.market?.['Sinister Chest Key']?.bid ?? 5400e3,
            entryAsk: marketData?.market?.['Sinister Entry Key']?.ask ?? 300e3,
            entryBid: marketData?.market?.['Sinister Entry Key']?.bid ?? 280e3
        },
        "Enchanted Refinement Chest": {
            keyAsk: marketData?.market?.['Enchanted Chest Key']?.ask ?? 7600e3,
            keyBid: marketData?.market?.['Enchanted Chest Key']?.bid ?? 7200e3,
            entryAsk: marketData?.market?.['Enchanted Entry Key']?.ask ?? 360e3,
            entryBid: marketData?.market?.['Enchanted Entry Key']?.bid ?? 360e3
        },
        "Pirate Refinement Chest": {
            keyAsk: marketData?.market?.['Pirate Chest Key']?.ask ?? 9400e3,
            keyBid: marketData?.market?.['Pirate Chest Key']?.bid ?? 92000e3,
            entryAsk: marketData?.market?.['Pirate Entry Key']?.ask ?? 460e3,
            entryBid: marketData?.market?.['Pirate Entry Key']?.bid ?? 440e3
        },
    };

    const auraAbilities = new Set([
        'revive',
        'insanity',
        'invincible',
        'fierce_aura',
        'mystic_aura',
        'speed_aura',
        'critical_aura',
        'guardian_aura',
    ]);

    //公會部分程式碼
    const updataDealy = 24*60*60*1000; //資料更新時限
    let rateXPDayMap = {};

    async function fetchMarketData() {
        let MARKET_API_URL = "";
        let needFormat = false;

        if (Edible_Tools_Set.marketApiSource === 'official') {
            if (currentHostname == "www.milkywayidlecn.com" || currentHostname == "test.milkywayidlecn.com") {
                MARKET_API_URL = "https://www.milkywayidlecn.com/game_data/marketplace.json";
            } else {
                MARKET_API_URL = "https://www.milkywayidle.com/game_data/marketplace.json";
            }
            needFormat = true;
        } else if (Edible_Tools_Set.marketApiSource === 'github1') {
            MARKET_API_URL = "https://raw.githubusercontent.com/holychikenz/MWIApi/main/medianmarket.json";
        } else if (Edible_Tools_Set.marketApiSource === 'github2') {
            MARKET_API_URL = "https://raw.githubusercontent.com/holychikenz/MWIApi/refs/heads/main/milkyapi.json";
        }
        return new Promise((resolve, reject) => {
            GM.xmlHttpRequest({
                method: 'GET',
                url: MARKET_API_URL,
                responseType: 'json',
                timeout: 5000,
                onload: function(response) {
                    if (response.status === 200) {
                        let data = JSON.parse(response.responseText);
                        if (needFormat) {
                            data = formatmwiToolsMarketData(data, item_hrid_to_name);
                            console.log(data)
                        }
                        data.market.Coin = {ask: 1,bid: 1}
                        localStorage.setItem('Edible_Tools_marketAPI_json', JSON.stringify(data));
                        resolve(data);
                    } else {
                        console.error('獲取資料失敗。狀態碼:', response.status);
                        reject(new Error('資料獲取失敗'));
                    }
                },
                ontimeout: function() {
                    console.error('請求超時：超過5秒未能獲取到資料');
                    reject(new Error('請求超時'));
                },
                onerror: function(error) {
                    console.error('獲取資料時發生錯誤:', error);
                    reject(error);
                }
            });
        });
    }

    hookWS();
    initObserver();

    try {
        // 嘗試從 API 獲取資料
        marketData = await fetchMarketData();
        console.log(`從 ${Edible_Tools_Set.marketApiSource} API 獲取到的資料 ${marketData}`)
    } catch (error) {
        console.error('從 API 獲取資料失敗，嘗試從本地儲存獲取資料。', error);
        const edibleMarketDataStr = localStorage.getItem('Edible_Tools_marketAPI_json');
        if (edibleMarketDataStr) {
            marketData = JSON.parse(edibleMarketDataStr);
            console.log('從 Edible_Tools_marketAPI_json 獲取到的資料:', marketData);
        } else {
            const mwiMarketDataStr = localStorage.getItem('MWITools_marketAPI_json');
            if (mwiMarketDataStr) {
                marketData = formatmwiToolsMarketData(JSON.parse(mwiMarketDataStr), item_hrid_to_name);
                console.log('從 MWITools_marketAPI_json 獲取並格式化的資料:', marketData);
            } else {
                alert('無法獲取 market 資料');
            }
        }
    }

    function getSpecialItemPrice(itemName, priceType) {
        if (marketData?.market?.[itemName]) {
            const itemPrice = marketData.market[itemName][priceType];
            if (itemPrice !== undefined && itemPrice !== -1) {
                return itemPrice;
            } else if (specialItemPrices?.[itemName]) {
                const itemPrice = specialItemPrices[itemName][priceType];
                if (itemPrice !== undefined && itemPrice !== -1) {
                    return itemPrice;
                }
            }
        } else if (specialItemPrices?.[itemName]) {
            const itemPrice = specialItemPrices[itemName][priceType];
            if (itemPrice !== undefined && itemPrice !== -1) {
                return itemPrice;
            }
        }
        console.error(`未找到物品 ${itemName} 的 ${priceType} 價格資訊`);
        return null;
    }

    function getItemNameFromElement(element) {
        const itemNameRaw = element.getAttribute('href').split('#').pop();
        return formatItemName(itemNameRaw);
    }

    function formatItemName(itemNameRaw) {
        return item_hrid_to_name[`/items/${itemNameRaw}`]
    }

    function formatPrice(value,n = 1) {
        const isNegative = value < 0;
        value = Math.abs(value);
        if (value >= 1e13 / n) {
            return (isNegative ? '-' : '') + (value / 1e12).toFixed(1) + 'T';
        } else if (value >= 1e10 / n) {
            return (isNegative ? '-' : '') + (value / 1e9).toFixed(1) + 'B';
        } else if (value >= 1e7 / n) {
            return (isNegative ? '-' : '') + (value / 1e6).toFixed(1) + 'M';
        } else if (value >= 1e4 / n) {
            return (isNegative ? '-' : '') + (value / 1e3).toFixed(1) + 'K';
        } else {
            return (isNegative ? '-' : '') + value.toFixed(0);
        }
    }

    function formatSeconds(seconds) {
        seconds = Math.floor(seconds);
        if (seconds < 0) {
            return "0s";
        }
        if (seconds < 3600) {
            let minutes = Math.floor(seconds / 60);
            let secs = seconds % 60;
            return `${minutes}m${secs}s`;
        } else if (seconds < 86400) {
            let hours = Math.floor(seconds / 3600);
            let minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h${minutes}m`;
        } else {
            let days = Math.floor(seconds / 86400);
            let hours = Math.floor((seconds % 86400) / 3600);
            return `${days}d${hours}h`;
        }
    }

    function parseQuantityString(quantityStr) {
        const suffix = quantityStr.slice(-1);
        const base = parseFloat(quantityStr.slice(0, -1));
        if (suffix === 'K') {
            return base * 1000;
        } else if (suffix === 'M') {
            return base * 1000000;
        } else if (suffix === 'B') {
            return base * 1000000000;
        } else {
            return parseFloat(quantityStr);
        }
    }

    function recordChestOpening(modalElement) {
        if (document.querySelector('.ChestStatistics')) {
            return;
        }

        // 從本地儲存讀取資料
        let edibleTools = JSON.parse(localStorage.getItem('Edible_Tools')) || {};
        edibleTools.Chest_Open_Data = edibleTools.Chest_Open_Data || {};

        // 確保當前玩家的開箱資料結構存在
        if (!currentPlayerID || !currentPlayerName) {
            console.error("無法獲取當前玩家的 ID 或暱稱");
            return;
        }
        edibleTools.Chest_Open_Data[currentPlayerID] = edibleTools.Chest_Open_Data[currentPlayerID] || {
            玩家暱稱: currentPlayerName,
            開箱資料: {}
        };

        let chestOpenData = edibleTools.Chest_Open_Data[currentPlayerID].開箱資料;
        const chestDropData = edibleTools.Chest_Drop_Data;
        const chestNameElement = modalElement.querySelector("div.Modal_modal__1Jiep > div.Modal_modalContent__3FKyF > div > div.Item_itemContainer__x7kH1 > div > div > div > div.Item_iconContainer__5z7j4 > svg > use");
        const chestCountElement = modalElement.querySelector("div.Modal_modal__1Jiep > div.Modal_modalContent__3FKyF > div > div.Item_itemContainer__x7kH1 > div > div > div > div.Item_count__1HVvv");

        if (chestNameElement && chestCountElement) {
            const chestName = getItemNameFromElement(chestNameElement);
            chestOpenData[chestName] = chestOpenData[chestName] || {};
            let chestData = chestOpenData[chestName];
            const chestCount = parseQuantityString(chestCountElement.textContent.trim());
            chestData["總計開箱數量"] = (chestData["總計開箱數量"] || 0) + chestCount;
            chestData["獲得物品"] = chestData["獲得物品"] || {};
            const itemsContainer = modalElement.querySelector('.Inventory_gainedItems___e9t9');
            const itemElements = itemsContainer.querySelectorAll('.Item_itemContainer__x7kH1');

            let totalAskValue = 0;
            let totalBidValue = 0;

            itemElements.forEach(itemElement => {
                const itemNameElement = itemElement.querySelector('.Item_iconContainer__5z7j4 use');
                const itemQuantityElement = itemElement.querySelector('.Item_count__1HVvv');

                if (itemNameElement && itemQuantityElement) {
                    const itemName = getItemNameFromElement(itemNameElement);
                    const itemQuantity = parseQuantityString(itemQuantityElement.textContent.trim());

                    const itemData = chestDropData[chestName].item[itemName] || {};
                    const itemAskValue = itemData["出售單價"] || 0;
                    const itemBidValue = itemData["收購單價"] || 0;
                    const color = itemData.Color || '';

                    itemQuantityElement.style.color = color;
                    const taxFactor = Edible_Tools_Set.enableMarketTaxCalculation && !(itemName in specialItemPrices) ? 0.95 : 1;
                    const itemOpenTotalAskValue = itemAskValue * itemQuantity * taxFactor;
                    const itemOpenTotalBidValue = itemBidValue * itemQuantity * taxFactor;

                    chestData["獲得物品"][itemName] = chestData["獲得物品"][itemName] || {};
                    chestData["獲得物品"][itemName]["數量"] = (chestData["獲得物品"][itemName]["數量"] || 0) + itemQuantity;
                    chestData["獲得物品"][itemName]["總計Ask價值"] = (chestData["獲得物品"][itemName]["總計Ask價值"] || 0) + itemOpenTotalAskValue;
                    chestData["獲得物品"][itemName]["總計Bid價值"] = (chestData["獲得物品"][itemName]["總計Bid價值"] || 0) + itemOpenTotalBidValue;

                    totalAskValue += itemOpenTotalAskValue;
                    totalBidValue += itemOpenTotalBidValue;
                }
            });

            chestData["總計開箱Ask"] = (chestData["總計開箱Ask"] || 0) + totalAskValue;
            chestData["總計開箱Bid"] = (chestData["總計開箱Bid"] || 0) + totalBidValue;

            // 計算本次開箱的偏差值
            const differenceValue = totalBidValue - chestDropData[chestName]["期望產出Bid"] * chestCount;

            // 更新累計偏差值
            chestData["累計偏差值"] = (chestData["累計偏差值"] || 0) + differenceValue;

            // 地牢開箱
            let profitRange = null;
            let profitColor = 'lime'; // 預設顏色

            if (chestCosts[chestName]) {
                const { keyAsk, keyBid, entryAsk, entryBid } = chestCosts[chestName];
                const minProfit = totalBidValue - (keyAsk + entryAsk || 0) * chestCount;
                const maxProfit = totalAskValue - (keyBid + entryBid || 0) * chestCount;
                profitRange = `${formatPrice(minProfit)}～${formatPrice(maxProfit)}`;

                chestData["總計最高利潤"] = (chestData["總計最高利潤"] || 0) + maxProfit;
                chestData["總計最低利潤"] = (chestData["總計最低利潤"] || 0) + minProfit;

                if (minProfit > 0 && maxProfit > 0) {
                    profitColor = 'lime';
                } else if (minProfit < 0 && maxProfit < 0) {
                    profitColor = 'red';
                } else {
                    profitColor = 'orange';
                }
            }

            let totalProfitRange = null;
            let totalProfitColor = 'lime';
            if (chestData["總計最低利潤"] !== undefined && chestData["總計最高利潤"] !== undefined) {
                if (chestData["總計最低利潤"] > 0 && chestData["總計最高利潤"] > 0) {
                    totalProfitColor = 'lime';
                } else if (chestData["總計最低利潤"] < 0 && chestData["總計最高利潤"] < 0) {
                    totalProfitColor = 'red';
                } else {
                    totalProfitColor = 'orange';
                }
                totalProfitRange = `${formatPrice(chestData["總計最低利潤"])}～${formatPrice(chestData["總計最高利潤"])}`;
            }
            // 顯示
            const openChestElement = document.querySelector('.Inventory_modalContent__3ObSx');

            const displayElement = document.createElement('div');
            displayElement.classList.add('ChestStatistics');
            displayElement.style.position = 'absolute';
            displayElement.style.left = `${openChestElement.offsetLeft}px`;
            displayElement.style.top = `${openChestElement.offsetTop}px`;
            displayElement.style.fontSize = '0.75rem';
            displayElement.innerHTML = `
                ${isCN ? "總計開箱次數" : "Total Openings"}:<br>
                ${chestData["總計開箱數量"]}<br>
                ${isCN ? "本次開箱價值" : "Current Value"}:<br>
                ${formatPrice(totalAskValue)}/${formatPrice(totalBidValue)}<br>
                ${isCN ? "總計開箱價值" : "Total Value"}:<br>
                ${formatPrice(chestData["總計開箱Ask"])}/${formatPrice(chestData["總計開箱Bid"])}<br>
            `;

            const expectedOutputElement = document.createElement('div');
            expectedOutputElement.classList.add('ExpectedOutput');
            expectedOutputElement.style.position = 'absolute';
            expectedOutputElement.style.left = `${openChestElement.offsetLeft}px`;
            expectedOutputElement.style.bottom = `${openChestElement.offsetTop}px`;
            expectedOutputElement.style.fontSize = '0.75rem';
            expectedOutputElement.innerHTML = `
                ${!Edible_Tools_Set.enableHideChestExpectation ?
                `${isCN ? "預計產出價值" : "Expected Value"}:<br>
                ${formatPrice(chestDropData[chestName]["期望產出Ask"]*chestCount)}/${formatPrice(chestDropData[chestName]["期望產出Bid"]*chestCount)}<br>`
                : `<br><br>`}
            `;

            const differenceOutputElement = document.createElement('div');
            differenceOutputElement.classList.add('DifferenceOutput');
            differenceOutputElement.style.position = 'absolute';
            differenceOutputElement.style.right = `${openChestElement.offsetLeft}px`;
            differenceOutputElement.style.bottom = `${openChestElement.offsetTop}px`;
            differenceOutputElement.style.fontSize = '0.75rem';
            differenceOutputElement.style.color = differenceValue > 0 ? 'lime' : 'red';
            differenceOutputElement.innerHTML = `
                ${!Edible_Tools_Set.enableHideChestExpectation ?
                `${differenceValue > 0
                ? (isCN ? '高於期望價值:' : 'Above Expected:')
            : (isCN ? '低於期望價值:' : 'Below Expected:')
        }<br>
                ${formatPrice(Math.abs(differenceValue))}<br>`
                : `<br><br>`}
            `;

            // 建立並顯示累計偏差值的元素
            const cumulativeDifferenceElement = document.createElement('div');
            cumulativeDifferenceElement.classList.add('CumulativeDifference');
            cumulativeDifferenceElement.style.position = 'absolute';
            cumulativeDifferenceElement.style.right = `${openChestElement.offsetLeft}px`;
            cumulativeDifferenceElement.style.top = `${openChestElement.offsetTop}px`;
            cumulativeDifferenceElement.style.fontSize = '0.75rem';
            cumulativeDifferenceElement.style.color = chestData["累計偏差值"] > 0 ? 'lime' : 'red';
            cumulativeDifferenceElement.innerHTML = `
                <br><br>
                <span style="color: ${profitColor};">${isCN ? "本次開箱利潤" : "Current Profit"}</span><br>
                ${profitRange ? `<span style="color: ${profitColor};">${profitRange}</span>` : `<span style="color: ${profitColor};">${formatPrice(totalAskValue)}/${formatPrice(totalBidValue)}</span>`}<br>
                ${!Edible_Tools_Set.enableHideChestExpectation ?
                `${isCN ? '累計' : 'Cumulative '}${chestData["累計偏差值"] > 0
                ? (isCN ? '高於期望:' : 'Above:')
            : (isCN ? '低於期望:' : 'Below:')
        }<br>
                    ${formatPrice(Math.abs(chestData["累計偏差值"]))}<br>`
                    : `<span style="color: ${totalProfitColor};">${isCN ? "總計利潤" : "Total Profit"}</span><br>
                    ${totalProfitRange ? `<span style="color: ${totalProfitColor};">${totalProfitRange}</span>` : `<span style="color: ${totalProfitColor};">${formatPrice(chestData["總計開箱Ask"])}/${formatPrice(chestData["總計開箱Bid"])}</span>`}<br>`
                }
            `;

            openChestElement.appendChild(displayElement);
            openChestElement.appendChild(expectedOutputElement);
            openChestElement.appendChild(differenceOutputElement);
            openChestElement.appendChild(cumulativeDifferenceElement);

            // 儲存更新的資料到本地儲存
            localStorage.setItem('Edible_Tools', JSON.stringify(edibleTools));
        }
    }


    function calculateTotalValues(itemElements) {
        let totalAskValue = 0;
        let totalBidValue = 0;

        itemElements.forEach(itemElement => {
            const itemNameElement = itemElement.querySelector('.Item_iconContainer__5z7j4 use');
            const itemQuantityElement = itemElement.querySelector('.Item_count__1HVvv');

            if (itemNameElement && itemQuantityElement) {
                const itemName = getItemNameFromElement(itemNameElement);
                const itemQuantity = parseQuantityString(itemQuantityElement.textContent.trim());

                let askPrice = 0;
                let bidPrice = 0;
                let priceColor = '';

                // 獲取價格
                if (specialItemPrices[itemName] && specialItemPrices[itemName].ask) {
                    askPrice = parseFloat(specialItemPrices[itemName].ask);
                    bidPrice = parseFloat(specialItemPrices[itemName].bid);
                    priceColor = '';
                } else if (marketData?.market?.[itemName]) {
                    bidPrice = marketData.market[itemName].bid;
                    askPrice = marketData.market[itemName].ask;
                } else {
                    console.log(`${itemName} 的價格未找到`);
                }
                const itemTotalAskValue = askPrice * itemQuantity;
                const itemTotalBidValue = bidPrice * itemQuantity;
                totalAskValue += itemTotalAskValue;
                totalBidValue += itemTotalBidValue;
            }
        });

        //console.log(totalAskValue);
        return { totalAskValue, totalBidValue };
    }

    //更詳細的戰鬥等級顯示
    const updateCombatLevel = () => {
        const elements = document.querySelectorAll(".NavigationBar_currentExperience__3GDeX");

        if (elements.length === 17) {
            const levels = Array.from(elements).slice(10, 17).map(el => {
                const levelText = parseInt(el.parentNode.parentNode.querySelector(".NavigationBar_textContainer__7TdaI .NavigationBar_level__3C7eR").textContent);
                const decimalPart = parseFloat(el.style.width) / 100;
                return {
                    integerPart: levelText,
                    decimalPart: decimalPart
                };
            });
            const [endurance, intelligence, attack, defense, melee, ranged, magic] = levels;

            const combatTypeMax = Math.max(melee.integerPart, ranged.integerPart, magic.integerPart);
            const primaryMax = Math.max(attack.integerPart, defense.integerPart, melee.integerPart, ranged.integerPart, magic.integerPart);

            let combatLevel = 0.1 * (
                endurance.integerPart +
                intelligence.integerPart +
                attack.integerPart +
                defense.integerPart +
                combatTypeMax
            ) + 0.5 * primaryMax;

            const integerPart = Math.floor(combatLevel);
            let decimalPart = combatLevel - integerPart;

            const isMeleeCombatMax = melee.integerPart === combatTypeMax;
            const isRangedCombatMax = ranged.integerPart === combatTypeMax;
            const isMagicCombatMax = magic.integerPart === combatTypeMax;

            const isAttackPrimaryMax = attack.integerPart === primaryMax;
            const isDefensePrimaryMax = defense.integerPart === primaryMax;
            const isMeleePrimaryMax = melee.integerPart === primaryMax;
            const isRangedPrimaryMax = ranged.integerPart === primaryMax;
            const isMagicPrimaryMax = magic.integerPart === primaryMax;

            const contributions = [
                endurance.decimalPart * 0.1,
                intelligence.decimalPart * 0.1,
                attack.decimalPart * (0.1 + (isAttackPrimaryMax ? 0.5 : 0)),
                defense.decimalPart * (0.1 + (isDefensePrimaryMax ? 0.5 : 0)),
                melee.decimalPart * ((isMeleeCombatMax ? 0.1 : 0) + (isMeleePrimaryMax ? 0.5 : 0)),
                ranged.decimalPart * ((isRangedCombatMax ? 0.1 : 0) + (isRangedPrimaryMax ? 0.5 : 0)),
                magic.decimalPart * ((isMagicCombatMax ? 0.1 : 0) + (isMagicPrimaryMax ? 0.5 : 0))
            ];

            contributions.sort((a, b) => b - a);

            let totalDecimal = 0;
            const maxAddable = 1 - decimalPart;
            let added = 0;

            for (const contribution of contributions) {
                if (added + contribution <= maxAddable) {
                    added += contribution;
                } else {
                    break;
                }
            }

            const finalCombatLevel = integerPart + decimalPart + added;

            elements[15].parentNode.parentNode.parentNode.parentNode.parentNode.querySelector(
                ".NavigationBar_nav__3uuUl .NavigationBar_level__3C7eR"
            ).textContent = finalCombatLevel.toFixed(2);
        }
    };
    if (Edible_Tools_Set.enablePointCombatLevel) {
        window.setInterval(updateCombatLevel, 10000);
    }
    function OfflineStatistics(modalElement) {
        const itemsContainer = modalElement.querySelectorAll(".OfflineProgressModal_itemList__26h-Y");

        let timeContainer = null;
        let getItemContainer = null;
        let spendItemContainer = null;


        itemsContainer.forEach(container => {
            const labelElement = container.querySelector('.OfflineProgressModal_label__2HwFG');
            if (labelElement) {
                const textContent = labelElement.textContent.trim();
                if (textContent.startsWith("Offline duration") || textContent.startsWith("你離線了") || textContent.startsWith("離線時間")) {
                    timeContainer = container;
                } else if (textContent.startsWith("Items gained") || textContent.startsWith("獲得物品:") || textContent.startsWith("獲得物品")) {
                    getItemContainer = container;
                } else if (textContent.startsWith("Items consumed") || textContent.startsWith("你消耗了:") || textContent.startsWith("消耗物品")) {
                    spendItemContainer = container;
                }
            }
        });

        let TotalSec = null;
        if (timeContainer) {
            const textContent = timeContainer.textContent;
            const match = textContent.match(/(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)/);
            if (match) {
                let days = parseInt(match[1], 10) || 0;
                let hours = parseInt(match[2], 10) || 0;
                let minutes = parseInt(match[3], 10) || 0;
                let seconds = parseInt(match[4], 10) || 0;
                TotalSec = days * 86400 + hours * 3600 + minutes * 60 + seconds;
            }
        }

        let getitemtotalAskValue = 0;
        let getitemtotalBidValue = 0;
        if (getItemContainer) {
            const getitemElements = getItemContainer.querySelectorAll('.Item_itemContainer__x7kH1');
            const { totalAskValue, totalBidValue } = calculateTotalValues(getitemElements);
            getitemtotalAskValue = totalAskValue;
            getitemtotalBidValue = totalBidValue;
        }


        let spenditemtotalAskValue = 0;
        let spenditemtotalBidValue = 0;
        if (spendItemContainer) {
            const spenditemElements = spendItemContainer.querySelectorAll('.Item_itemContainer__x7kH1');
            const { totalAskValue, totalBidValue } = calculateTotalValues(spenditemElements);
            spenditemtotalAskValue = totalAskValue;
            spenditemtotalBidValue = totalBidValue;
        }

        if (timeContainer) {
            const newElement = document.createElement('span');
            newElement.textContent = `利潤: ${formatPrice(getitemtotalBidValue - spenditemtotalAskValue,10)} [${formatPrice((getitemtotalBidValue - spenditemtotalAskValue) / (TotalSec / 3600) * 24,10)}/天]`;
            newElement.style.color = 'gold';
            newElement.style.whiteSpace = 'nowrap';
            newElement.style.marginLeft = 'auto';
            timeContainer.querySelector(':first-child').appendChild(newElement);
        }
        if (getItemContainer) {
            const newElement = document.createElement('span');
            newElement.textContent = `產出:[${formatPrice(getitemtotalAskValue)}/${formatPrice(getitemtotalBidValue)}]`;
            newElement.style.float = 'right';
            newElement.style.color = 'gold';
            newElement.style.whiteSpace = 'nowrap';
            getItemContainer.querySelector(':first-child').appendChild(newElement);
        }
        if (spendItemContainer) {
            const newElement = document.createElement('span');
            newElement.textContent = `成本:[${formatPrice(spenditemtotalAskValue)}/${formatPrice(spenditemtotalBidValue)}]`;
            newElement.style.float = 'right';
            newElement.style.color = 'gold';
            newElement.style.whiteSpace = 'nowrap';
            spendItemContainer.querySelector(':first-child').appendChild(newElement);
        }
    }

    function addLocalLootLogButton() {
        const panel = document.querySelector('.LootLogPanel_lootLogPanel__2013X');
        if (!panel) return;
        const refreshBtn = panel.querySelector('button.Button_button__1Fe9z');
        if (!refreshBtn) return;

        if (panel.querySelector('#localLootLogBtn') || panel.querySelector('#deleteLocalLootLogBtn')) return;

        const btnContainer = refreshBtn.parentNode;
        btnContainer.style.display = 'flex';
        btnContainer.style.alignItems = 'center';
        btnContainer.style.gap = '0.5rem';

        const loadBtn = document.createElement('button');
        loadBtn.id = 'localLootLogBtn';
        loadBtn.textContent = isCN ? '讀取本地資料' : 'Load local data';
        loadBtn.className = refreshBtn.className;

        loadBtn.onclick = function() {
            if (!lastWs) {
                alert('未捕獲到 WebSocket，重新整理頁面並等待資料載入後再試。');
                return;
            }
            if (!currentPlayerID) {
                alert('未獲取到當前角色ID');
                return;
            }
            let localLootLog = GM_getValue('localLootLog', {});
            const logs = localLootLog[currentPlayerID] || [];
            if (!logs.length) {
                alert('本地沒有該角色的掉落記錄');
                return;
            }
            const msgObj = {
                type: "loot_log_updated",
                lootLog: logs
            };
            const msgStr = JSON.stringify(msgObj);
            lastWs.dispatchEvent(new MessageEvent('message', { data: msgStr }));
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.id = 'deleteLocalLootLogBtn';
        deleteBtn.textContent = isCN ? '刪除本地快取' : 'Delete local cache';
        deleteBtn.className = refreshBtn.className;
        deleteBtn.style.backgroundColor = '#f44336';

        deleteBtn.onclick = function() {
            if (!currentPlayerID) {
                alert('未獲取到當前角色ID');
                return;
            }

            const confirmMsg = isCN
            ? `確定要刪除角色 ${currentPlayerID} 的本地戰利品記錄嗎？此操作不可撤銷。`
            : `Are you sure you want to delete the local loot log for character ${currentPlayerID}? This action cannot be undone.`;

            if (confirm(confirmMsg)) {
                let localLootLog = GM_getValue('localLootLog', {});

                if (localLootLog[currentPlayerID]) {
                    delete localLootLog[currentPlayerID];
                    GM_setValue('localLootLog', localLootLog);

                    const successMsg = isCN
                    ? '本地快取已成功刪除'
                    : 'Local cache has been successfully deleted';
                    alert(successMsg);
                } else {
                    const noDataMsg = isCN
                    ? '該角色沒有本地快取資料'
                    : 'No local cache data found for this character';
                    alert(noDataMsg);
                }
            }
        };
        btnContainer.appendChild(loadBtn);
        btnContainer.appendChild(deleteBtn);
    }

function optimizeLootLogDisplay(obj) {
    setTimeout(() => {
        const lootLogList = document.querySelectorAll('.LootLogPanel_actionLoots__3oTid .LootLogPanel_actionLoot__32gl_');
        if (!lootLogList.length || !obj || !Array.isArray(obj.lootLog)) return;

        const lootLogData = [...obj.lootLog].reverse();
        lootLogList.forEach((lootElem, idx) => {
            // --- 取div中開始時間 ---
            const secondDiv = lootElem.querySelectorAll('div')[1];
            if (!secondDiv) return;
            const matchCN = secondDiv.textContent.match(/(\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2})/);
            const matchEN = secondDiv.textContent.match(/(\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (AM|PM))/i);
            const matchCNWithPeriod = secondDiv.textContent.match(/(\d{4}\/\d{1,2}\/\d{1,2} (上午|下午)\d{1,2}:\d{2}:\d{2})/);
            const matchDE = secondDiv.textContent.match(/(\d{1,2}\.\d{1,2}\.\d{4}, \d{1,2}:\d{2}:\d{2})/);
            let utcISOString = '';
            if (matchCN) {
                const localTimeStr = matchCN[1].trim();
                const [y, m, d, h, min, s] = localTimeStr.match(/\d+/g).map(Number);
                const localDate = new Date(y, m - 1, d, h, min, s);
                utcISOString = new Date(localDate.getTime()).toISOString().slice(0, 19);
            } else if (matchEN) {
                const localTimeStr = matchEN[1].trim();
                const localDate = new Date(localTimeStr);
                if (!isNaN(localDate)) {
                    utcISOString = localDate.toISOString().slice(0, 19);
                } else {
                    return;
                }
            } else if (matchCNWithPeriod) {//
                const localTimeStr = matchCNWithPeriod[1].trim();
                const parts = localTimeStr.split(/(上午|下午)/).filter(Boolean).map(s => s.trim());
                const datePart = parts[0];
                const timePart = parts[2];
                const period = parts[1];

                const [y, m, d] = datePart.split('/').map(Number);
                let [h, min, s] = timePart.split(':').map(Number);

                if (period === '下午' && h < 12) {
                    h += 12;
                } else if (period === '上午' && h === 12) {
                    h = 0;
                }

                const localDate = new Date(y, m - 1, d, h, min, s);
                utcISOString = localDate.toISOString().slice(0, 19);
            } else if (matchDE) {
                const localTimeStr = matchDE[1].trim();
                const [datePart, timePart] = localTimeStr.split(', ');
                const [day, month, year] = datePart.split('.').map(Number);
                const [hours, minutes, seconds] = timePart.split(':').map(Number);

                const localDate = new Date(year, month - 1, day, hours, minutes, seconds);
                utcISOString = localDate.toISOString().slice(0, 19);
            } else {
                return;
            }

            let log = lootLogData[idx];
            let foundIdx = idx;
            function getLogStartTimeSec(logObj) {
                return logObj && logObj.startTime ? logObj.startTime.slice(0, 19) : '';
            }
            if (!log || getLogStartTimeSec(log) !== utcISOString) {
                for (let i = 0; i < lootLogData.length; i++) {
                    if (getLogStartTimeSec(lootLogData[i]) === utcISOString) {
                        log = lootLogData[i];
                        foundIdx = i;
                        break;
                    }
                }
                if (!log || getLogStartTimeSec(log) !== utcISOString) {
                    return;
                }
            }

            // --- 序號和刪除按鈕 ---
            const firstDiv = lootElem.querySelector('div');
            if (firstDiv) {
                const oldIndex = firstDiv.querySelector('.loot-log-index');
                if (oldIndex) oldIndex.remove();
                const oldDelBtn = firstDiv.querySelector('.loot-log-delbtn');
                if (oldDelBtn) oldDelBtn.remove();

                // 刪除按鈕
                const delBtn = document.createElement('button');
                delBtn.className = 'loot-log-delbtn';
                delBtn.textContent = '🗑';
                delBtn.title = isCN ? '刪除本條記錄' : "Delete this record";
                delBtn.style.marginRight = '0.375rem';
                delBtn.style.cursor = 'pointer';
                delBtn.style.background = 'none';
                delBtn.style.border = 'none';
                delBtn.style.color = '#e98a8a';
                delBtn.style.fontWeight = 'bold';
                delBtn.style.fontSize = '1em';
                delBtn.setAttribute('data-log-index', foundIdx);

                delBtn.onclick = function(e) {
                    e.stopPropagation();
                    if (!currentPlayerID) {
                        alert('未獲取到當前角色ID');
                        return;
                    }
                    let localLootLog = GM_getValue('localLootLog', {});
                    const logs = localLootLog[currentPlayerID] || [];
                    const delLog = lootLogData[foundIdx];
                    if (!delLog) return;
                    if (!confirm(isCN ? '[食用工具]確定要刪除這條掉落記錄嗎？' : '[Edible Tools]Are you sure you want to delete this drop record?')) return;
                    // 刪除
                    const newLogs = logs.filter(l => l.startTime !== delLog.startTime);
                    console.log("newLogs",newLogs)
                    localLootLog[currentPlayerID] = newLogs;
                    console.log("localLootLog",localLootLog)
                    GM_setValue('localLootLog', localLootLog);
                    // 重新整理本地日誌顯示
                    if (lastWs) {
                        const msgObj = {
                            type: "loot_log_updated",
                            lootLog: newLogs
                        };
                        const msgStr = JSON.stringify(msgObj);
                        lastWs.dispatchEvent(new MessageEvent('message', { data: msgStr }));
                    }
                };

                // 序號
                const indexSpan = document.createElement('span');
                indexSpan.className = 'loot-log-index';
                indexSpan.textContent = `#${foundIdx + 1}`;
                indexSpan.style.float = 'right';
                indexSpan.style.color = '#98a7e9';
                indexSpan.style.fontWeight = 'bold';
                indexSpan.style.marginLeft = '0.5rem';

                if (foundIdx > 0) {
                    firstDiv.appendChild(delBtn);
                }
                firstDiv.appendChild(indexSpan);
            }
            //跳過強化統計
            if (log && log.actionHrid == "/actions/enhancing/enhance") return;

            // --- 總計產出價值 ---
            let askTotal = 0, bidTotal = 0;
            if (secondDiv) {
                const oldValue = secondDiv.querySelector('.loot-log-value');
                if (oldValue) oldValue.remove();

                if (!log || !log.drops) return;
                for (const [hrid, count] of Object.entries(log.drops)) {
                    const baseHrid = hrid.replace(/::\d+$/, '');
                    const name = item_hrid_to_name[baseHrid];
                    if (!name) continue;
                    const ask = getSpecialItemPrice(name, 'ask') || 0;
                    const bid = getSpecialItemPrice(name, 'bid') || 0;
                    askTotal += ask * count;
                    bidTotal += bid * count;
                }
                const valueSpan = document.createElement('span');
                valueSpan.className = 'loot-log-value';
                const valueText = isCN ? "總計價值: " : "Total Value: ";
                valueSpan.textContent = valueText + `${formatPrice(askTotal,10)}/${formatPrice(bidTotal,10)}`;
                valueSpan.style.float = 'right';
                valueSpan.style.color = 'gold';
                valueSpan.style.fontWeight = 'bold';
                valueSpan.style.marginLeft = '0.5rem';
                secondDiv.appendChild(valueSpan);
            }

            // 每次行動平均耗時&&每天產出價值
            const thirdDiv = lootElem.querySelectorAll('div')[2];
            if (thirdDiv) {
                const oldAvgTime = thirdDiv.querySelector('.loot-log-avgtime');
                if (oldAvgTime) oldAvgTime.remove();
                const oldDayValue = thirdDiv.querySelector('.loot-log-day-value');
                if (oldDayValue) oldDayValue.remove();
                let duration = 0;
                if (log && log.startTime && log.endTime) {
                    duration = (new Date(log.endTime) - new Date(log.startTime)) / 1000;
                }
                let avgTime = 0;
                if (duration > 0 && log.actionCount > 0) {
                    avgTime = duration / log.actionCount;
                }

                function formatDuration(sec) {
                    if (sec < 60) {
                        return `${sec.toFixed(2)}s`;
                    }
                    sec = Math.round(sec);
                    let h = Math.floor(sec / 3600);
                    let m = Math.floor((sec % 3600) / 60);
                    let s = sec % 60;
                    let str = '';
                    if (h > 0) str += `${h}h`;
                    if (m > 0 || h > 0) str += `${m}m`;
                    str += `${s}s`;
                    return str;
                }

                const avgTimeSpan = document.createElement('span');
                avgTimeSpan.className = 'loot-log-avgtime';
                avgTimeSpan.textContent = `⏱${avgTime > 0 ? formatDuration(avgTime) : '--'}`;
                avgTimeSpan.style.marginRight = '1rem';
                avgTimeSpan.style.marginLeft = '2ch';
                avgTimeSpan.style.color = '#98a7e9';
                avgTimeSpan.style.fontWeight = 'bold';
                thirdDiv.appendChild(avgTimeSpan);

                let dayValueAsk = 0, dayValueBid = 0;
                if (duration > 0) {
                    dayValueAsk = askTotal * 86400 / duration;
                    dayValueBid = bidTotal * 86400 / duration;
                }
                const dayValueSpan = document.createElement('span');
                dayValueSpan.className = 'loot-log-day-value';
                const dayValueText = isCN ? "每天產出: " : "Daily Output: ";
                dayValueSpan.textContent = dayValueText + `${formatPrice(dayValueAsk,10)}/${formatPrice(dayValueBid,10)}`;
                dayValueSpan.style.float = 'right';
                dayValueSpan.style.color = 'gold';
                dayValueSpan.style.fontWeight = 'bold';
                dayValueSpan.style.marginLeft = '0.5rem';
                thirdDiv.appendChild(dayValueSpan);
            }
        });
    }, 200);
}


function initObserver() {
    // 選擇要觀察的目標節點
    const targetNode = document.body;

    // 觀察器的配置（需要觀察子節點的變化）
    const config = { childList: true, subtree: true };

    // 建立一個觀察器例項並傳入回撥函式
    const observer = new MutationObserver(mutationsList => {
        for (let mutation of mutationsList) {
            if (mutation.type === 'childList') {
                // 監聽到子節點變化
                mutation.addedNodes.forEach(addedNode => {
                    // 檢查是否是我們關注的 Modal_modalContainer__3B80m 元素被新增 開箱監控
                    if (addedNode.classList && addedNode.classList.contains('Modal_modalContainer__3B80m')) {
                        // Modal_modalContainer__3B80m 元素被新增，執行處理函式
                        recordChestOpening(addedNode);
                    }
                    //物品字典監控
                    if (addedNode.classList && addedNode.classList.contains('ItemDictionary_modalWrapper__1Ywn2')){
                        ShowChestPrice();
                        // 開始監聽箱子圖示的變化
                        startIconObserver();
                    }
                    if (addedNode.classList && addedNode.classList.contains('OfflineProgressModal_modalContainer__knnk7')) {
                        OfflineStatistics(addedNode);
                        console.log("離線報告已建立!")
                    }
                    if (addedNode.classList && addedNode.classList.contains('MainPanel_subPanelContainer__1i-H9')) {
                        if (addedNode.querySelector(".CombatPanel_combatPanel__QylPo")) {
                            addBattlePlayerFoodButton();
                            addBattlePlayerLootButton();
                        } else if (addedNode.querySelector('.EnhancingPanel_enhancingPanel__ysWpV')) {
                            updateEnhancementUI();
                        }
                    }

                });

                mutation.removedNodes.forEach(removedNode => {
                    // 檢查是否是 Modal_modalContainer__3B80m 元素被移除
                    if (removedNode.classList && removedNode.classList.contains('Modal_modalContainer__3B80m')) {
                        // Modal_modalContainer__3B80m 元素被移除，停止監聽箱子圖示的變化
                        stopIconObserver();
                    }
                });
            }
        }
    });

    // 以上述配置開始觀察目標節點
    observer.observe(targetNode, config);

    // 定義箱子圖示變化的觀察器
    let iconObserver = null;

    // 開始監聽箱子圖示的變化
    function startIconObserver() {
        const chestNameElem = document.querySelector(chestNameSelector);
        if (!chestNameElem) return;

        // 建立一個觀察器例項來監聽圖示的變化
        iconObserver = new MutationObserver(() => {
            // 當箱子圖示變化時，執行處理函式
            ShowChestPrice();
        });

        // 配置觀察器的選項
        const iconConfig = { attributes: true, attributeFilter: ['href'] };

        // 以上述配置開始觀察箱子圖示節點
        iconObserver.observe(chestNameElem, iconConfig);
    }

    // 停止監聽箱子圖示的變化
    function stopIconObserver() {
        if (iconObserver) {
            iconObserver.disconnect();
            iconObserver = null;
        }
    }
}

// 修改 hookWS 裡的 hookedGet 函式，增加如下內容：
function hookWS() {
    const dataProperty = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data");
    const oriGet = dataProperty.get;

    dataProperty.get = hookedGet;
    Object.defineProperty(MessageEvent.prototype, "data", dataProperty);

    function hookedGet() {
        const socket = this.currentTarget;
        if (!(socket instanceof WebSocket)) {
            return oriGet.call(this);
        }
        if (socket.url.indexOf("api.milkywayidle.com/ws") <= -1 && socket.url.indexOf("api-test.milkywayidle.com/ws") <= -1 && socket.url.indexOf("api-test.milkywayidlecn.com/ws") <= -1 && socket.url.indexOf("api.milkywayidlecn.com/ws") <= -1) {
            return oriGet.call(this);
        }
        lastWs = socket;

        const message = oriGet.call(this);
        Object.defineProperty(this, "data", { value: message }); // Anti-loop

        return handleMessage(message);
    }
}

function addStatisticsButton() {
    const waitForNavi = () => {
        const targetNode = document.querySelector("div.NavigationBar_minorNavigationLinks__dbxh7");
        if (targetNode) {
            // 建立統計視窗按鈕
            let statsButton = document.createElement("div");
            statsButton.setAttribute("class", "NavigationBar_minorNavigationLink__31K7Y");
            statsButton.style.color = "gold";
            statsButton.innerHTML = isCN ? "開箱統計" : "Chest Statistics";
            statsButton.addEventListener("click", () => {
                const edibleTools = JSON.parse(localStorage.getItem('Edible_Tools')) || {};
                const openChestData = edibleTools.Chest_Open_Data || {};
                createVisualizationWindow(openChestData);
            });

            // 建立食用工具按鈕
            let edibleToolsButton = document.createElement("div");
            edibleToolsButton.setAttribute("class", "NavigationBar_minorNavigationLink__31K7Y");
            edibleToolsButton.style.color = "gold";
            edibleToolsButton.innerHTML = isCN ? "食用工具" : "Edible Tools";
            edibleToolsButton.addEventListener("click", () => {
                openSettings();
            });

            // 將按鈕新增到目標節點
            targetNode.insertAdjacentElement("afterbegin", statsButton);
            targetNode.insertAdjacentElement("afterbegin", edibleToolsButton);

            //獲取圖示url格式模板
            item_icon_url = document.querySelector("div[class^='Item_itemContainer'] use")?.getAttribute("href")?.split("#")[0];

            addBattlePlayerFoodButton();
            addBattlePlayerLootButton();
        } else {
            setTimeout(waitForNavi, 200);
        }
    };

    waitForNavi(); // 開始等待目標節點出現
}



//奶牛釘釘
function handleMessage(message) {
    try {
        let obj = JSON.parse(message);
        if (obj && obj.type === "new_battle") {
            processCombatConsumables(obj);
        } else if (obj && obj.type === "init_character_data") {
            now_battle_map = undefined;
            battleDifficultyTier = undefined;
            processCombatConsumablesRunCount = 0;
            needTestFood = true;
            processCharacterData(obj);
            addStatisticsButton();
            update_market_list(obj);
        } else if (obj && obj.type === "action_completed" && obj.endCharacterAction) {
            const actionHrid = obj.endCharacterAction.actionHrid;
            if (actionHrid === "/actions/enhancing/enhance") {
                processEnhancementData(obj);
            } else if (actionHrid.startsWith("/actions/combat/")) {
                now_battle_map = actionHrid;
                battleDifficultyTier = obj.endCharacterAction.difficultyTier || 0
            }
        } else if (obj && obj.type === "loot_log_updated") {
            if (!currentPlayerID) return message;
            let localLootLog = GM_getValue('localLootLog', {});
            localLootLog[currentPlayerID] = localLootLog[currentPlayerID] || [];
            const oldLogs = localLootLog[currentPlayerID];
            const newLogs = obj.lootLog || [];
            const logMap = {};
            const uniqueLogs = [];
            for (const log of [...oldLogs, ...newLogs]) {
                const key = log.startTime;
                if (!logMap[key] || new Date(log.endTime) > new Date(logMap[key].endTime)) {
                    logMap[key] = log;
                    const idx = uniqueLogs.findIndex(l => l.startTime === key);
                    if (idx === -1) {
                        uniqueLogs.push(log);
                    } else {
                        uniqueLogs[idx] = log;
                    }
                }
            }
            if (uniqueLogs.length > 50) {
                localLootLog[currentPlayerID] = uniqueLogs.slice(-50);
            } else {
                localLootLog[currentPlayerID] = uniqueLogs;
            }
            GM_setValue('localLootLog', localLootLog);
            addLocalLootLogButton();
            optimizeLootLogDisplay(obj);
        } else if (obj && obj.type === "guild_updated") {
            const Guild_ID = obj.guild.id;
            const edibleTools = JSON.parse(localStorage.getItem('Edible_Tools')) || {};
            edibleTools.Guild_Data = edibleTools.Guild_Data || {};
            let storedData = edibleTools.Guild_Data || {};

            // 判斷是否已經存在舊資料
            if (storedData[Guild_ID] && storedData[Guild_ID].guild_updated && storedData[Guild_ID].guild_updated.old.updatedAt) {
                const oldUpdatedAt = new Date(storedData[Guild_ID].guild_updated.new.updatedAt);
                const newUpdatedAt = new Date(obj.guild.updatedAt);

                // 計算時間差（單位：毫秒）
                const timeDifference = newUpdatedAt - oldUpdatedAt;

                if (timeDifference >= updataDealy) {
                    // 更新老資料為新資料
                    storedData[Guild_ID].guild_updated.old = storedData[Guild_ID].guild_updated.new;
                    // 更新新資料為當前資料
                    storedData[Guild_ID].guild_updated.new = {
                        experience: obj.guild.experience,
                        level: obj.guild.level,
                        updatedAt: obj.guild.updatedAt
                    };
                } else {
                    // 僅更新新資料
                    storedData[Guild_ID].guild_updated.new = {
                        experience: obj.guild.experience,
                        level: obj.guild.level,
                        updatedAt: obj.guild.updatedAt
                    };
                }
                //計算Δ
                const Delta = {
                    Delta_Xp: storedData[Guild_ID].guild_updated.new.experience - storedData[Guild_ID].guild_updated.old.experience,
                    Delta_Level: storedData[Guild_ID].guild_updated.new.level - storedData[Guild_ID].guild_updated.old.level,
                    Delta_Time: (newUpdatedAt - new Date(storedData[Guild_ID].guild_updated.old.updatedAt)) / 1000, // 轉換為秒
                    Rate_XP_Hours: (3600*(obj.guild.experience - storedData[Guild_ID].guild_updated.old.experience)/((newUpdatedAt - new Date(storedData[Guild_ID].guild_updated.old.updatedAt)) / 1000)).toFixed(2)
                };
                storedData[Guild_ID].guild_updated.Delta = Delta;

                const Guild_TotalXp_div = document.querySelectorAll(".GuildPanel_value__Hm2I9")[1];
                if (Guild_TotalXp_div) {
                    const xpText = isCN ? "經驗值 / 小時" : "XP / Hour";

                    Guild_TotalXp_div.insertAdjacentHTML(
                        "afterend",
                        `<div>${formatPrice(Delta.Rate_XP_Hours)} ${xpText}</div>`
                        );
                    const Guild_NeedXp_div = document.querySelectorAll(".GuildPanel_value__Hm2I9")[2];
                    if (Guild_NeedXp_div) {
                        const Guild_NeedXp = document.querySelectorAll(".GuildPanel_value__Hm2I9")[2].textContent.replace(/,/g, '');
                        const Time = TimeReset(Guild_NeedXp/Delta.Rate_XP_Hours);
                        Guild_NeedXp_div.insertAdjacentHTML(
                            "afterend",
                            `<div>${Time}</div>`
                        );
                        }
                        const Guild_Member_div = document.querySelectorAll(".GuildPanel_value__Hm2I9")[3];
                        if (Guild_Member_div) {
                            const curLevel = storedData[Guild_ID].guild_updated.new.level;
                            const curXp = storedData[Guild_ID].guild_updated.new.experience;
                            const nextPopLevel = Math.ceil((curLevel + 1) / 3) * 3;
                            if (nextPopLevel < xp_table.length) {
                                const needXp = xp_table[nextPopLevel] - curXp;
                                let hours = Delta.Rate_XP_Hours > 0 ? needXp / Delta.Rate_XP_Hours : Infinity;
                                if (hours > 0 && isFinite(hours)) {
                                    const timeStr = TimeReset(hours);
                                    Guild_Member_div.insertAdjacentHTML(
                                        "afterend",
                                        `<div>${timeStr}</div>`);
                                }
                            }
                        }
                    }
                } else {
                    // 如果沒有舊資料，則直接新增新資料
                    storedData[Guild_ID] = {
                        guild_name: obj.guild.name,
                        guild_updated: {
                            old: {
                                experience: obj.guild.experience,
                                level: obj.guild.level,
                                updatedAt: obj.guild.updatedAt
                            },
                            new: {},
                        }
                    };
                }

                // 儲存更新後的資料到 localStorage
                edibleTools.Guild_Data = storedData;
                localStorage.setItem('Edible_Tools', JSON.stringify(edibleTools));
            } else if (obj && obj.type === "guild_characters_updated") {
                const edibleTools = JSON.parse(localStorage.getItem('Edible_Tools')) || {};
                edibleTools.Guild_Data = edibleTools.Guild_Data || {};
                let storedData = edibleTools.Guild_Data || {};
                for (const key in obj.guildSharableCharacterMap) {
                    if (obj.guildSharableCharacterMap.hasOwnProperty(key)) {
                        const Guild_ID = obj.guildCharacterMap[key].guildID;
                        const name = obj.guildSharableCharacterMap[key].name;
                        const newUpdatedAt = new Date();
                        storedData[Guild_ID].guild_player = storedData[Guild_ID].guild_player || {};
                        if (storedData[Guild_ID] && storedData[Guild_ID].guild_player && storedData[Guild_ID].guild_player[name] && storedData[Guild_ID].guild_player[name].old && storedData[Guild_ID].guild_player[name].old.updatedAt) {
                            const oldUpdatedAt = new Date(storedData[Guild_ID].guild_player[name].old.updatedAt)
                            const timeDifference = newUpdatedAt - oldUpdatedAt
                            if (timeDifference >= updataDealy) {
                                // 更新老資料為新資料
                                storedData[Guild_ID].guild_player[name].old = storedData[Guild_ID].guild_player[name].new;
                                // 更新新資料為當前資料
                                storedData[Guild_ID].guild_player[name].new = {
                                    id: key,
                                    gameMode: obj.guildSharableCharacterMap[key].gameMode,
                                    guildExperience: obj.guildCharacterMap[key].guildExperience,
                                    updatedAt: newUpdatedAt,
                                };
                            } else {
                                // 僅更新新資料
                                storedData[Guild_ID].guild_player[name].new = {
                                    id: key,
                                    gameMode: obj.guildSharableCharacterMap[key].gameMode,
                                    guildExperience: obj.guildCharacterMap[key].guildExperience,
                                    updatedAt: newUpdatedAt,
                                };
                            }
                            //計算Δ
                            const Delta = {
                                Delta_Time:(newUpdatedAt - new Date(storedData[Guild_ID].guild_player[name].old.updatedAt)) / 1000,
                                Delta_Xp: storedData[Guild_ID].guild_player[name].new.guildExperience - storedData[Guild_ID].guild_player[name].old.guildExperience,
                                Rate_XP_Day: (24*3600*(obj.guildCharacterMap[key].guildExperience - storedData[Guild_ID].guild_player[name].old.guildExperience)/((newUpdatedAt - new Date(storedData[Guild_ID].guild_player[name].old.updatedAt)) / 1000)).toFixed(2)
                            };
                            storedData[Guild_ID].guild_player[name].Delta = Delta;
                            rateXPDayMap[name] = Delta.Rate_XP_Day;
                        }else {
                            storedData[Guild_ID].guild_player[name] = {
                                old: {
                                    id: key,
                                    gameMode: obj.guildSharableCharacterMap[key].gameMode,
                                    guildExperience: obj.guildCharacterMap[key].guildExperience,
                                    updatedAt: newUpdatedAt,
                                },
                                new:{}
                            };
                        }
                    }

                }
                //console.log("測試資料",storedData);
                //console.log("guild_characters_updated", obj);
                updateExperienceDisplay(rateXPDayMap);
                edibleTools.Guild_Data = storedData;
                localStorage.setItem('Edible_Tools', JSON.stringify(edibleTools));
            } else if (obj && obj.type === "market_listings_updated") {
                update_market_list(obj);
            } else if (obj && obj.type === "battle_consumable_ability_updated" && obj.consumable) {
                const itemHrid = obj.consumable.itemHrid
                battlePlayerFoodConsumable
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
        return message;
    }

// 訂單資料更新
function update_market_list(date) {
    if (!date) return;

    let market_list = JSON.parse(GM_getValue('market_list', '[]'));

    // 通用更新
    function updateOrders(orders) {
        orders.forEach(newOrder => {
            const existingOrderIndex = market_list.findIndex(order => order.id === newOrder.id);
            if (existingOrderIndex !== -1) {
                market_list[existingOrderIndex] = newOrder;
            } else {
                market_list.push(newOrder);
            }
            // 給每個訂單新增更新時間戳
            newOrder.lastUpdated = new Date().toISOString();
        });
    }

    // 更新市場資料
    if (date.type === "init_character_data" && date.myMarketListings) {
        updateOrders(date.myMarketListings);
    } else if (date.type === "market_listings_updated" && date.endMarketListings) {
        updateOrders(date.endMarketListings);
    }

    // 儲存更新後的資料
    GM_setValue('market_list', JSON.stringify(market_list));
}

function TimeReset(hours) {
    const totalMinutes = hours * 60;
    const days = Math.floor(totalMinutes / (24 * 60));
    const yudays = totalMinutes % (24 * 60);
    const hrs = Math.floor(yudays / 60);
    const minutes = Math.floor(yudays % 60);
    const dtext = isCN ? "天" : "d";
    const htext = isCN ? "時" : "h";
    const mtext = isCN ? "分" : "m";
    return `${days}${dtext} ${hrs}${htext} ${minutes}${mtext}`;
}

function updateExperienceDisplay(rateXPDayMap) {
    const trElements = document.querySelectorAll(".GuildPanel_membersTable__1NwIX tbody tr");
    const idleuser_list = [];
    const dtext = isCN ? "天" : "d";

    // 將 rateXPDayMap 轉換為陣列並排序
    const sortedMembers = Object.entries(rateXPDayMap)
    .map(([name, XPdata]) => ({ name, XPdata }))
    .sort((a, b) => b.XPdata - a.XPdata);

    sortedMembers.forEach(({ name, XPdata }) => {
        trElements.forEach(tr => {
            const nameElement = tr.querySelector(".CharacterName_name__1amXp");
            const experienceElement = tr.querySelector("td:nth-child(3) > div");
            const activityElement = tr.querySelector('.GuildPanel_activity__9vshh');

            if (nameElement && nameElement.textContent.trim() === name) {
                if (activityElement.childElementCount === 0) {
                    idleuser_list.push(nameElement.textContent.trim());
                }

                if (experienceElement) {
                    const newDiv = document.createElement('div');
                    newDiv.textContent = `${formatPrice(XPdata)}/${dtext}`;

                    // 計算顏色
                    const rank = sortedMembers.findIndex(member => member.name === name);
                    const hue = 120 - (rank * (120 / (sortedMembers.length - 1)));
                    newDiv.style.color = `hsl(${hue}, 100%, 50%)`;

                    experienceElement.insertAdjacentElement('afterend', newDiv);
                }
                return;
            }
        });
    });

    update_idleuser_tb(idleuser_list);
}

function update_idleuser_tb(idleuser_list) {
    const targetElement = document.querySelector('.GuildPanel_noticeMessage__3Txji');
    if (!targetElement) {
        console.error('公會標語元素未找到！');
        return;
    }
    const clonedElement = targetElement.cloneNode(true);

    const namesText = idleuser_list.join(', ');
    clonedElement.innerHTML = '';
    clonedElement.textContent = isCN ? `閒置的成員：${namesText}` : `Idle User : ${namesText}`;
    clonedElement.style.color = '#ffcc00';
    clonedElement.style.height = `25%`;
    clonedElement.style.minHeight = `25%`;
    targetElement.parentElement.appendChild(clonedElement);
}


//箱子資料獲取
function processCharacterData(init_character_data) {
    const init_client_data = init_Client_Data;
    const hrid2name = item_hrid_to_name;

    const character = init_character_data.character;
    if (character) {
        currentPlayerID = character.id;
        currentPlayerName = character.name;
    }

    let formattedShopData = {};
    if (init_character_data?.characterActions[0]?.actionHrid?.startsWith("/actions/combat/")) {
        now_battle_map = init_character_data.characterActions[0].actionHrid
        battleDifficultyTier = init_character_data.characterActions[0].difficultyTier
    }
    // 處理商店資料
    for (let [key, details] of Object.entries(init_client_data.shopItemDetailMap)) {
        const { itemHrid, costs } = details;
        const itemName = hrid2name[itemHrid] || formatItemName(itemHrid.split('/').pop());

        costs.forEach(cost => {
            const costItemName = hrid2name[cost.itemHrid] || formatItemName(cost.itemHrid.split('/').pop());
            const costCount = cost.count;
            if (costItemName === "Coin") {
                if (itemName.endsWith("Charm")) {
                    (specialItemPrices[itemName] ??= {}).ask = costCount;
                    (specialItemPrices[itemName] ??= {}).bid = costCount;
                }
                return;
            }

            if (!formattedShopData[costItemName]) {
                formattedShopData[costItemName] = { items: {}, 最掙錢: '', BID單價: 0 };
            }

            // 計算每種代幣購買每個物品的收益
            let bidValue = getSpecialItemPrice(itemName,"bid") || 0;
            let profit = bidValue / costCount;

            formattedShopData[costItemName].items[itemName] = {
                花費: costCount
            };
            // 更新最賺錢的物品資訊
            if (profit > formattedShopData[costItemName].BID單價) {
                formattedShopData[costItemName].最掙錢 = itemName;
                formattedShopData[costItemName].BID單價 = profit;
                (specialItemPrices[costItemName] ??= {}).ask = profit;
                (specialItemPrices[costItemName] ??= {}).bid = profit;
            }
        });
    }

    // 處理迷宮商店資料
    const labyrinthShopItemDetailMap = init_client_data.labyrinthShopItemDetailMap || {};

    // 處理迷宮代幣價格
    for (let [key, details] of Object.entries(labyrinthShopItemDetailMap)) {
        const { itemHrid, cost, outputCount } = details;
        const itemName = hrid2name[itemHrid] || formatItemName(itemHrid.split('/').pop());
        const costItemName = hrid2name[cost.itemHrid] || formatItemName(cost.itemHrid.split('/').pop());
        const costCount = cost.count;

        // 對於卷軸和披風類物品，進行特殊價格處理
        if (itemName.startsWith("Scroll Of")) {
            // 卷軸價格設定為100K
            (specialItemPrices[itemName] ??= {}).ask = 100000;
            (specialItemPrices[itemName] ??= {}).bid = 100000;
        } else if (itemName.endsWith("Cape")) {
            // 披風價格設定為保護石的價格
            if (Edible_Tools_Set.enableCloakPrice) {
                const protectionMirrorAskPrice = getSpecialItemPrice('Mirror Of Protection', 'ask') || 12000000;
                const protectionMirrorBidPrice = getSpecialItemPrice('Mirror Of Protection', 'bid') || 11500000;
                (specialItemPrices[itemName] ??= {}).ask = protectionMirrorAskPrice;
                (specialItemPrices[itemName] ??= {}).bid = protectionMirrorBidPrice;
            } else {
                // 如果設定了忽略披風價格，設定為1500個迷宮精華的價格
                const labyrinthEssenceAskPrice = getSpecialItemPrice('Labyrinth Essence', 'ask') || 1850;
                const labyrinthEssenceBidPrice = getSpecialItemPrice('Labyrinth Essence', 'bid') || 1800;
                const AskPrice = labyrinthEssenceAskPrice * 1500;
                const BidPrice = labyrinthEssenceBidPrice * 1500;
                (specialItemPrices[itemName] ??= {}).ask = AskPrice;
                (specialItemPrices[itemName] ??= {}).bid = BidPrice;
            }
        }

        if (!formattedShopData[costItemName]) {
            formattedShopData[costItemName] = { items: {}, 最掙錢: '', BID單價: 0 };
        }

        // 計算每種代幣購買每個物品的收益
        let bidValue = getSpecialItemPrice(itemName,"bid") || 0;
        // 考慮outputCount，計算實際收益
        bidValue *= outputCount;
        let profit = bidValue / costCount;

        formattedShopData[costItemName].items[itemName] = {
            花費: costCount
        };
        // 更新最賺錢的物品資訊
        if (profit > formattedShopData[costItemName].BID單價) {
            formattedShopData[costItemName].最掙錢 = itemName;
            formattedShopData[costItemName].BID單價 = profit;
            (specialItemPrices[costItemName] ??= {}).ask = profit;
            (specialItemPrices[costItemName] ??= {}).bid = profit;
        }
    }
    const mostProfitableItems = Object.values(formattedShopData).map(item => item.最掙錢).filter(Boolean);
    //console.log(mostProfitableItems)

    // 處理箱子掉落物資料
    const disableRareItemExpectPrice = !Edible_Tools_Set.enableRareItemExpectPrice;
    for (let iteration = 0; iteration < 4; iteration++) {
        for (let [key, items] of Object.entries(init_client_data.openableLootDropMap)) {
            const boxName = hrid2name[key] || formatItemName(key.split('/').pop());

            if (!formattedChestDropData[boxName]) {
                formattedChestDropData[boxName] = { item: {} };
            }
            let TotalAsk = 0;
            let TotalBid = 0;
            let awa = 0;
            items.forEach(item => {
                const { itemHrid, dropRate, minCount, maxCount } = item;
                if (disableRareItemExpectPrice && dropRate < 0.01) return;
                const itemName = hrid2name[itemHrid] || formatItemName(itemHrid.split('/').pop());
                const expectedYield = ((minCount + maxCount) / 2) * dropRate;
                let bidPrice = -1;
                let askPrice = -1;
                let priceColor = '';

                if (specialItemPrices[itemName] && specialItemPrices[itemName].ask) {
                    askPrice = parseFloat(specialItemPrices[itemName].ask);
                    bidPrice = parseFloat(specialItemPrices[itemName].bid);
                    priceColor = '';
                } else if (marketData?.market?.[itemName]) {
                    bidPrice = marketData.market[itemName].bid;
                    askPrice = marketData.market[itemName].ask;
                } else {
                    console.log(`${itemName} 的價格未找到`);
                }

                if (formattedChestDropData[boxName].item[itemName] && iteration === 0) {
                    // 如果物品已存在，更新期望掉落和相關價格
                    const existingItem = formattedChestDropData[boxName].item[itemName];
                    existingItem.期望掉落 += expectedYield;
                } else if (iteration === 0) {
                    formattedChestDropData[boxName].item[itemName] = {
                        期望掉落: expectedYield,
                    };
                }

                // 判斷 itemName 是否在最掙錢物品列表中
                if (mostProfitableItems.includes(itemName)) {
                    priceColor = '#FFb3E6';
                } else if (askPrice === -1 && bidPrice === -1) {
                    priceColor = 'yellow';
                } else if (askPrice === -1) {
                    askPrice = bidPrice;
                    priceColor = '#D95961';
                } else if (bidPrice === -1) {
                    priceColor = '#2FC4A7';
                }

                const existingItem = formattedChestDropData[boxName].item[itemName];
                existingItem.出售單價 = askPrice;
                existingItem.收購單價 = bidPrice;
                existingItem.出售總價 = (existingItem.出售單價 * existingItem.期望掉落).toFixed(2);
                existingItem.收購總價 = (existingItem.收購單價 * existingItem.期望掉落).toFixed(2);
                existingItem.Color = priceColor;
                const taxFactor = Edible_Tools_Set.enableMarketTaxCalculation && !(itemName in specialItemPrices) ? 0.95 : 1;
                // 累計總價
                TotalAsk += (askPrice * expectedYield) * taxFactor;
                TotalBid += (bidPrice * expectedYield) * taxFactor;
            });

            formattedChestDropData[boxName] = {
                ...formattedChestDropData[boxName],
                期望產出Ask: TotalAsk.toFixed(2),
                期望產出Bid: TotalBid.toFixed(2),
            };

            if (!specialItemPrices[boxName]) {
                specialItemPrices[boxName] = {}
            }
            if (chestCosts[boxName]) {
                const { keyAsk, keyBid, entryAsk, entryBid } = chestCosts[boxName];
                specialItemPrices[boxName].ask = formattedChestDropData[boxName].期望產出Ask - keyBid;
                specialItemPrices[boxName].bid = formattedChestDropData[boxName].期望產出Bid - keyAsk;
            } else {
                specialItemPrices[boxName].ask = formattedChestDropData[boxName].期望產出Ask;
                specialItemPrices[boxName].bid = formattedChestDropData[boxName].期望產出Bid;
            }
        }

        //計算任務代幣和任務水晶價格
        if (iteration === 0) {
            const taskShopItemDetailMap = init_client_data.taskShopItemDetailMap || {};
            let maxTaskTokenValue = 0;

            for (let [key, details] of Object.entries(taskShopItemDetailMap)) {
                const { itemHrid, cost } = details;
                const itemName = hrid2name[itemHrid] || formatItemName(itemHrid.split('/').pop());
                const costItemName = hrid2name[cost.itemHrid] || formatItemName(cost.itemHrid.split('/').pop());
                const costCount = cost.count;

                if (costItemName === "Task Token" && itemName !== "Task Crystal") {
                    let bidValue = getSpecialItemPrice(itemName, "bid") || 0;
                    let taskTokenValue = bidValue / costCount;

                    if (taskTokenValue > maxTaskTokenValue) {
                        maxTaskTokenValue = taskTokenValue;
                    }
                }
            }

            if (maxTaskTokenValue > 0) {
                (specialItemPrices["Task Token"] ??= {}).ask = maxTaskTokenValue;
                (specialItemPrices["Task Token"] ??= {}).bid = maxTaskTokenValue;

                (specialItemPrices["Task Crystal"] ??= {}).ask = maxTaskTokenValue * 50;
                (specialItemPrices["Task Crystal"] ??= {}).bid = maxTaskTokenValue * 50;
            }
        }
    }

    const MWImarketData = JSON.parse(localStorage.getItem('MWITools_marketAPI_json'));
    for (const itemName in specialItemPrices) {
        if (!specialItemPrices.hasOwnProperty(itemName)) continue;
        const { ask, bid } = specialItemPrices[itemName];
        marketData.market[itemName] = { ask, bid };
        if (MWImarketData?.marketData) {
            const itemHrid = item_name_to_hrid[itemName];
            if (itemHrid) {
                MWImarketData.marketData[itemHrid] = MWImarketData.marketData[itemHrid] || {};
                MWImarketData.marketData[itemHrid]["0"] = { a: ask, b: bid };
            }
        }
    }
    if (MWImarketData?.marketData) {
        localStorage.setItem('MWITools_marketAPI_json', JSON.stringify(MWImarketData));
    }
    //處理戰鬥地圖資料
    const combatMaps = {};
    const actionDetailMap = init_client_data.actionDetailMap;
    for (const [actionHrid, actionDetail] of Object.entries(actionDetailMap)) {
        if (!actionHrid.startsWith("/actions/combat/")) continue;
        if (!actionDetail.combatZoneInfo) continue;
        if (actionDetail.combatZoneInfo.isDungeon) {
            DungeonData[actionDetail.name] = {
                maxDifficulty : actionDetail.maxDifficulty,
                keyItemHrid : actionDetail.combatZoneInfo.dungeonInfo.keyItemHrid,
                rewardDropTable : actionDetail.combatZoneInfo.dungeonInfo.rewardDropTable
            }
            continue
        }
        const fightInfo = actionDetail.combatZoneInfo.fightInfo;
        const randomSpawnInfo = fightInfo?.randomSpawnInfo;
        const spawns = randomSpawnInfo?.spawns;

        if (!spawns || spawns.length === 0) continue;

        // 確定地圖型別
        let mapType = "群戰";
        if (spawns.length === 1) {
            mapType = "單怪";
        }

        const monsterGen = {};
        const maxSpawnCount = randomSpawnInfo.maxSpawnCount;
        const maxTotalStrength = randomSpawnInfo.maxTotalStrength;


        const expectedCounts = calculateExpectedSpawns(spawns, maxSpawnCount, maxTotalStrength);

        spawns.forEach(spawn => {
            monsterGen[spawn.combatMonsterHrid] = {
                期望數量: expectedCounts[spawn.combatMonsterHrid],
                //精英等級: spawn.difficultyTier
            };
        });

        // 處理BOSS資料
        const bossData = {};
        const bossSpawns = fightInfo.bossSpawns;
        const battlesPerBoss = fightInfo.battlesPerBoss;

        if (bossSpawns && bossSpawns.length > 0) {
            bossSpawns.forEach(boss => {
                if (boss.combatMonsterHrid) {
                    bossData[boss.combatMonsterHrid] = {
                        //精英等級: boss.difficultyTier
                    };
                }
            });
        }

        combatMaps[actionHrid] = {
            地圖型別: mapType,
            BOSS波次: battlesPerBoss || 0,
            小怪生成: monsterGen,
            BOSS資料: Object.keys(bossData).length > 0 ? bossData : ""
        };
    }
    const combatMobDropData = {};
    const monsterMap = init_client_data.combatMonsterDetailMap;

    for (const [monsterHrid, monsterData] of Object.entries(monsterMap)) {
        const formattedDrops = {
            怪物名稱: monsterData.name,
            普通掉落: [],
            稀有掉落: []
        };

        // 處理普通掉落表
        if (monsterData.dropTable) {
            monsterData.dropTable.forEach(drop => {
                formattedDrops.普通掉落.push({
                    掉落物名稱: item_hrid_to_name[drop.itemHrid] || drop.itemHrid,
                    掉落物Hrid: drop.itemHrid,
                    掉落機率: drop.dropRate,
                    掉落數量: (drop.minCount + drop.maxCount) / 2,
                    難度掉率: drop.dropRatePerDifficultyTier || 0,
                });
            });
        }

        // 處理稀有掉落表
        if (monsterData.rareDropTable) {
            monsterData.rareDropTable.forEach(drop => {
                formattedDrops.稀有掉落.push({
                    掉落物名稱: item_hrid_to_name[drop.itemHrid] || drop.itemHrid,
                    掉落物Hrid: drop.itemHrid,
                    掉落機率: drop.dropRate,
                    掉落數量: (drop.minCount + drop.maxCount) / 2,
                    難度掉率: drop.dropRatePerDifficultyTier || 0,
                });
            });
        }

        combatMobDropData[monsterHrid] = formattedDrops;
    }
    let edibleTools = JSON.parse(localStorage.getItem('Edible_Tools')) || {};
    edibleTools = {
        ...edibleTools,
        Chest_Drop_Data: formattedChestDropData,
        Combat_Data: {...edibleTools.Combat_Data, Combat_Map_Data: combatMaps ,Combat_Mob_Drop_Data: combatMobDropData}
    };

    edibleTools.Chest_Open_Data = edibleTools.Chest_Open_Data || {};
    if (edibleTools.Chest_Open_Data && !edibleTools.Chest_Open_Data[0]) {
        const oldData = { ...edibleTools.Chest_Open_Data };
        edibleTools.Chest_Open_Data = {};
        edibleTools.Chest_Open_Data[0] = {
            玩家暱稱: "老版本開箱資料",
            開箱資料: oldData
        };
    }

    edibleTools.Chest_Open_Data[currentPlayerID] = edibleTools.Chest_Open_Data[currentPlayerID] || {
        玩家暱稱: currentPlayerName,
        開箱資料: {}
    };

    try {
        localStorage.setItem('Edible_Tools', JSON.stringify(edibleTools));
    } catch (error) {
        console.error('儲存資料時發生錯誤:', error);
    }
    // 列印結果
    //console.log("特殊物品價格表:",specialItemPrices)
    //console.log("箱子掉落物列表:", formattedChestDropData);
    //console.log("地牢商店列表:", formattedShopData);
    //console.log("戰鬥地圖列表",combatMaps)
    //console.log("怪物掉落列表",combatMobDropData)
}

function calculateExpectedSpawns(spawns, maxSpawnCount, maxTotalStrength) {
    const monsterList = spawns.map(s => ({ hrid: s.combatMonsterHrid, strength: s.strength }));
    const spawnProbability = 1 / spawns.length;

    const dp = Array.from({ length: maxSpawnCount + 1 }, () => ({}));
    dp[0][0] = 1;

    const expectedCounts = {};
    monsterList.forEach(m => {
        expectedCounts[m.hrid] = 0;
    });

    for (let pos = 0; pos < maxSpawnCount; pos++) {
        const currentDP = dp[pos];
        const nextDP = dp[pos + 1] = {};

        for (const [currentStrengthStr, prob] of Object.entries(currentDP)) {
            const currentStrength = parseInt(currentStrengthStr);

            for (const monster of monsterList) {
                const newStrength = currentStrength + monster.strength;
                if (newStrength > maxTotalStrength) continue;

                const transitionProb = prob * spawnProbability;
                nextDP[newStrength] = (nextDP[newStrength] || 0) + transitionProb;

                expectedCounts[monster.hrid] += transitionProb;
            }
        }
    }
    return expectedCounts;
}

function ShowChestPrice() {
    const modalContainer = document.querySelector(".Modal_modalContainer__3B80m");
    if (!modalContainer) return; // 如果不存在 Modal_modalContainer__3B80m 元素，則直接返回
    const chestNameElem = document.querySelector(chestNameSelector);
    if (!chestNameElem) return;
    const chestName = getItemNameFromElement(chestNameElem);
    const items = document.querySelectorAll(itemSelector);

    const dropListContainer = document.querySelector('.ItemDictionary_openToLoot__1krnv');
    if (!dropListContainer) return; // 檢查 dropListContainer 是否存在
    const edibleTools = JSON.parse(localStorage.getItem('Edible_Tools'))
    const formattedChestDropData = edibleTools.Chest_Drop_Data;

    items.forEach(item => {
        const itemName = getItemNameFromElement(item.querySelector(iconSelector));
        if (!itemName) return; // 檢查 itemName 是否存在
        const itemData = formattedChestDropData[chestName].item[itemName];
        if (!itemData) return; // 檢查 itemData 是否存在
        const itemColor = itemData.Color;
        const itemNameElem = item.querySelector('.Item_name__2C42x');
        if (itemNameElem && itemColor) {
            itemNameElem.style.color = itemColor;
        }
    });

    const askPrice = formattedChestDropData[chestName]["期望產出Ask"];
    const bidPrice = formattedChestDropData[chestName]["期望產出Bid"];
    if (askPrice && bidPrice) {

        const previousResults = dropListContainer.querySelectorAll('.resultDiv');
        previousResults.forEach(result => result.remove());

        const createPriceOutput = (label, price) => {
            const priceOutput = document.createElement('div');
            priceOutput.className = 'resultDiv';
            priceOutput.textContent = `${label}: ${price}`;
            priceOutput.style.color = 'gold';
            priceOutput.style.fontSize = '0.875rem';
            priceOutput.style.fontWeight = '400';
            priceOutput.style.paddingTop = '0.625rem';
            return priceOutput;
        };

        const minPriceOutput = createPriceOutput(isCN ? '期望產出 (最低買入價計算)' : 'Expected Output (Ask Price)', formatPrice(askPrice));
        const maxPriceOutput = createPriceOutput(isCN ? '期望產出 (最高收購價計算)' : 'Expected Output (Bid Price)', formatPrice(bidPrice));
        dropListContainer.appendChild(minPriceOutput);
        dropListContainer.appendChild(maxPriceOutput);
        if (chestCosts[chestName]) {
            const { keyAsk, keyBid, entryAsk, entryBid } = chestCosts[chestName];
            let askProfit = askPrice - (keyBid + entryBid || 0);
            let bidProfit = bidPrice - (keyAsk + entryAsk || 0);
            if (chestName.includes("Refinement")) {
                askProfit += entryBid
                bidProfit += entryAsk
            }
            const ProfitOutput = createPriceOutput(
                isCN ? '期望利潤' : 'Expected Profit',
                `${formatPrice(bidProfit)}~${formatPrice(askProfit)}`
                );
            dropListContainer.appendChild(ProfitOutput);
        }

    }
}

function processEnhancementData(obj) {
    const now_enhancementLevel = parseInt(obj.endCharacterAction.primaryItemHash.match(/::(\d+)$/)[1]);
    const currentCount = obj.endCharacterAction.currentCount;
    // 開始新的物品的強化
    if (enhancementData[currentEnhancingIndex]["強化次數"] && currentCount <= enhancementData[currentEnhancingIndex]["強化次數"]) {
        currentEnhancingIndex++;
        enhancementData[currentEnhancingIndex] = { "強化資料": {}, "其他資料": {} };
        enhancementLevel = undefined;
    }
    //初始化資料
    if (!enhancementData[currentEnhancingIndex]["其他資料"]["物品名稱"]) {
        const itemName = item_hrid_to_name[obj.endCharacterAction.primaryItemHash.match(/::([^:]+)::[^:]*$/)[1]];
        enhancementData[currentEnhancingIndex]["其他資料"] = {
            "物品名稱": itemName,
            "目標強化等級": obj.endCharacterAction.enhancingMaxLevel,
            "保護消耗總數": 0,
        }
        const filteredItems = obj.endCharacterItems.filter(
            item => item.hash !== obj.endCharacterAction.primaryItemHash
        );

        const candidateItems = filteredItems.filter(
            item => item.itemHrid === obj.endCharacterAction.primaryItemHash.split('::')[2]
        );

        let prevLevelItem;
        if (candidateItems.length === 1) {
            prevLevelItem = candidateItems[0];
        } else if (candidateItems.length > 1) {
            prevLevelItem = candidateItems.find(
                item => item.hash !== obj.endCharacterAction.secondaryItemHash
            );
        }

        enhancementLevel = prevLevelItem?.enhancementLevel ?? 0;
    }

    //統計強化次數
    const currentItem = enhancementData[currentEnhancingIndex]["強化資料"];

    if (!currentItem[enhancementLevel]) {
        currentItem[enhancementLevel] = {"祝福次數": 0, "成功次數": 0, "失敗次數": 0, "成功率": 0 };
    }

    if (enhancementLevel < now_enhancementLevel) {
        currentItem[enhancementLevel]["成功次數"]++;
        if (now_enhancementLevel - enhancementLevel == 2) {
            currentItem[enhancementLevel]["祝福次數"]++;
        }
    } else {
        currentItem[enhancementLevel]["失敗次數"]++;
        if (obj.endCharacterAction.enhancingProtectionMinLevel >= 2 && enhancementLevel >= obj.endCharacterAction.enhancingProtectionMinLevel) {
            enhancementData[currentEnhancingIndex]["其他資料"]["保護消耗總數"]++;
        }
    }

    const success = currentItem[enhancementLevel]["成功次數"];
    const failure = currentItem[enhancementLevel]["失敗次數"];
    currentItem[enhancementLevel]["成功率"] = success / (success + failure);

    // 計算強化狀態
    const highestSuccessLevel = Math.max(...Object.keys(currentItem).filter(level => currentItem[level]["成功次數"] > 0));
    const enhancementState = (highestSuccessLevel + 1 >= enhancementData[currentEnhancingIndex]["其他資料"]["目標強化等級"]) ? "強化成功" : "強化失敗";
    enhancementData[currentEnhancingIndex]["強化狀態"] = enhancementState;
    enhancementLevel = now_enhancementLevel;

    //console.log(enhancementData)
    enhancementData[currentEnhancingIndex]["強化次數"] = currentCount;
    updateEnhancementUI();
}

function updateEnhancementUI() {
    const targetElement = document.querySelector(".SkillActionDetail_enhancingComponent__17bOx");
    if (!targetElement) return;

    // 建立父容器
    let parentContainer = document.querySelector("#enhancementParentContainer");
    if (!parentContainer) {
        parentContainer = document.createElement("div");
        parentContainer.id = "enhancementParentContainer";
        parentContainer.style.display = "block"; // 設定為縱向佈局（塊級元素）
        parentContainer.style.borderLeft = "0.125rem solid var(--color-divider)";
        parentContainer.style.padding = "0 0.25rem";

        // 建立並新增標題
        const title = document.createElement("div");
        title.textContent = isCN ? "強化資料" : "Enhancement Data";
        title.style.fontWeight = "bold";
        title.style.marginBottom = "0.625rem"; // 標題與下拉框之間的間距
        title.style.textAlign = "center";
        title.style.color = "var(--color-space-300)";
        parentContainer.appendChild(title);

        // 建立並新增下拉框
        const dropdownContainer = document.createElement("div");
        dropdownContainer.style.marginBottom = "0.625rem"; // 下拉框與表格之間的間距

        const dropdown = document.createElement("select");
        dropdown.id = "enhancementDropdown";
        dropdown.addEventListener("change", function () {
            renderEnhancementUI(this.value);
            updateDropdownColor();
        });

        dropdownContainer.appendChild(dropdown);
        parentContainer.appendChild(dropdownContainer);

        // 建立並新增表格容器
        const enhancementStatsContainer = document.createElement("div");
        enhancementStatsContainer.id = "enhancementStatsContainer";
        enhancementStatsContainer.style.display = "grid";
        enhancementStatsContainer.style.gridTemplateColumns = "repeat(4, 1fr)";
        enhancementStatsContainer.style.gap = "0.625rem";
        enhancementStatsContainer.style.textAlign = "center";
        enhancementStatsContainer.style.marginTop = "0.625rem";

        parentContainer.appendChild(enhancementStatsContainer);
        targetElement.appendChild(parentContainer);
    }

    // 更新下拉框內容
    const dropdown = document.querySelector("#enhancementDropdown");
    const previousSelectedValue = dropdown.value;
    dropdown.innerHTML = ""; // 清空下拉框內容

    Object.keys(enhancementData).forEach(key => {
        const item = enhancementData[key];
        const option = document.createElement("option");
        const itemName = item["其他資料"]["物品名稱"];
        const transferName = isCN && e2c[itemName] ? e2c[itemName] : itemName
        const targetLevel = item["其他資料"]["目標強化等級"];
        const currentLevel = Math.max(...Object.keys(item["強化資料"]));
        const enhancementState = item["強化狀態"];

        option.text = isCN
            ? `${transferName} (目標: ${targetLevel}, 總計: ${item["強化次數"]}${item["其他資料"]["保護消耗總數"] > 0 ? `, 墊子: ${item["其他資料"]["保護消耗總數"]}` : ""})`
                : `${transferName} (Target: ${targetLevel}, Total: ${item["強化次數"]}${item["其他資料"]["保護消耗總數"] > 0 ? `, PU: ${item["其他資料"]["保護消耗總數"]}` : ""})`;

            option.value = key;
            option.style.color = enhancementState === "強化成功" ? "green"
            : (currentLevel < targetLevel && Object.keys(enhancementData).indexOf(key) === Object.keys(enhancementData).length - 1) ? "orange"
            : "red";

            dropdown.appendChild(option);
        });

        // 設定預設選中項並渲染表格資料
        if (Object.keys(enhancementData).length > 0) {
            dropdown.value = previousSelectedValue || Object.keys(enhancementData)[0];
            updateDropdownColor();
            renderEnhancementUI(dropdown.value);
        }

        function updateDropdownColor() {
            const selectedOption = dropdown.options[dropdown.selectedIndex];
            dropdown.style.color = selectedOption ? selectedOption.style.color : "black";
        }
    }

function renderEnhancementUI(selectedKey) {
    const enhancementStatsContainer = document.querySelector("#enhancementStatsContainer");
    enhancementStatsContainer.innerHTML = ""; // 清空現有內容

    const item = enhancementData[selectedKey];

    // 表頭
    const headers = isCN
    ? ["等級", "成功", "失敗", "機率"]
    : ["Level", "Success", "Failure", "Rate"];
    headers.forEach(headerText => {
        const headerDiv = document.createElement("div");
        headerDiv.style.fontWeight = "bold";
        headerDiv.textContent = headerText;
        enhancementStatsContainer.appendChild(headerDiv);
    });

    // 總計資訊
    const totalSuccess = Object.values(item["強化資料"]).reduce((acc, val) => acc + val["成功次數"], 0);
    const totalFailure = Object.values(item["強化資料"]).reduce((acc, val) => acc + val["失敗次數"], 0);
    const totalCount = totalSuccess + totalFailure;
    const totalRate = totalCount > 0 ? (totalSuccess / totalCount * 100).toFixed(2) : "0.00";

    // 將總計資訊新增到表格中
    ["總計", totalSuccess, totalFailure, `${totalRate}%`].forEach((totalText, index) => {
        const totalDiv = document.createElement("div");
        totalDiv.textContent = isCN ? totalText : index === 0 ? "Total" : totalText;
        enhancementStatsContainer.appendChild(totalDiv);
    });

    // 渲染各個強化等級的資料
    Object.keys(item["強化資料"]).sort((a, b) => b - a).forEach(level => {
        const levelData = item["強化資料"][level];
        const levelDivs = [
            level,
            levelData["祝福次數"] > 0
            ? `${levelData["成功次數"]}(${levelData["祝福次數"]})`
                : `${levelData["成功次數"]}`,
                levelData["失敗次數"],
                `${(levelData["成功率"] * 100).toFixed(2)}%`
            ];

            levelDivs.forEach(data => {
                const dataDiv = document.createElement("div");
                dataDiv.textContent = data;
                enhancementStatsContainer.appendChild(dataDiv);
            });
        });
    }

function processCombatConsumables(obj) {
    battlePlayerFood = {};
    battlePlayerLoot = {};
    battlePlayerData = {};
    battleDuration = (new Date() - new Date(obj.combatStartTime)) / 1000;
    battleRunCount = obj.battleId || 1;
    obj.players.forEach(player => {
        const playerName = player.character.name;

        // 初始化玩家資料
        battlePlayerFood[playerName] = { drinkConcentration: player.combatDetails.combatStats.drinkConcentration };
        battlePlayerLoot[playerName] = {};
        battlePlayerData[playerName] = { aura: null, skillexp: {} ,combatDropQuantity: player.combatDetails.combatStats.combatDropQuantity ,combatDropRate: player.combatDetails.combatStats.combatDropRate, combatRareFind: player.combatDetails.combatStats.combatRareFind};

        // 處理消耗品
        player.combatConsumables.forEach(consumable => {
            const itemname = item_hrid_to_name[consumable.itemHrid];
            battlePlayerFood[playerName][itemname] = {
                "數量": consumable.count,
                "顏色": "white",
                "ID": consumable.itemHrid
            };
        });

        // 處理戰利品
        Object.values(player.totalLootMap).forEach(Loot => {
            const itemname = item_hrid_to_name[Loot.itemHrid];
            battlePlayerLoot[playerName][itemname] = {
                "數量": Loot.count,
                "ID": Loot.itemHrid
            };
        });

        // 處理光環
        player.combatAbilities.forEach(ability => {
            const isAura = Array.from(auraAbilities).some(aura => ability.abilityHrid.endsWith(aura));
            if (isAura) {
                battlePlayerData[playerName].aura = ability.abilityHrid;
            }
        });

        Object.keys(player.totalSkillExperienceMap).forEach(skillPath => {
            const skillname = skillPath.replace('/skills/', '');
            battlePlayerData[playerName].skillexp[skillname] = player.totalSkillExperienceMap[skillPath];
        });
    });

    if (processCombatConsumablesRunCount % 10 === 0) {
        const edibleTools = getEdibleToolsData();
        obj.players.forEach(player => {
            const playerName = player.character.name;
            const combatStartTime = obj.combatStartTime;
            // 初始化玩家資料
            if (!edibleTools.Combat_Data.Combat_Player_Data[playerName]) {
                edibleTools.Combat_Data.Combat_Player_Data[playerName] = {
                    Food_Data: {
                        Start: {
                            Food: {},
                            Time: null
                        },
                        End: {
                            Food: {},
                            Time: null
                        },
                        Statistics: {
                            Food: {},
                            Time: null
                        },
                        Start_Time: null
                    }
                };
            }

            const playerData = edibleTools.Combat_Data.Combat_Player_Data[playerName];
            const foodData = playerData.Food_Data;
            // 初始化資料
            if (foodData.Start_Time !== combatStartTime) {
                foodData.Start.Food = {};
                player.combatConsumables.forEach(consumable => {
                    foodData.Start.Food[consumable.itemHrid] = consumable.count;
                });
                foodData.Start.Time = new Date().toISOString();
                foodData.Start_Time = combatStartTime;

                foodData.End = { Food: {}, Time: null };
                foodData.Statistics = { Food: {}, Time: null };
                //console.log(`初始化${playerName}的資料`,foodData)
            } else {
                //console.log(`後寫入${playerName}的資料`,foodData)
                foodData.End.Food = {};
                player.combatConsumables.forEach(consumable => {
                    foodData.End.Food[consumable.itemHrid] = consumable.count;
                });
                foodData.End.Time = new Date().toISOString();

                const startTime = new Date(foodData.Start.Time).getTime();
                const endTime = new Date(foodData.End.Time).getTime();
                const timeDifference = (endTime - startTime) / 1000;
                if (timeDifference > 3600) {
                    const statistics = {
                        Food: {},
                        Time: timeDifference
                    };

                    let hasInvalidData = false;

                    // 計算食物差值
                    for (const itemHrid in foodData.Start.Food) {
                        const startCount = foodData.Start.Food[itemHrid] || 0;
                        const endCount = foodData.End.Food[itemHrid] || 0;
                        const difference = startCount - endCount;

                        // 異常處理
                        if (difference < 0) {
                            hasInvalidData = true;
                            break;
                        }

                        if (difference > 0 && statistics.Time > 0) {
                            const perHour = difference / (statistics.Time / 3600);
                            if (perHour > 108) {
                                hasInvalidData = true;
                                break;
                            }
                            statistics.Food[itemHrid] = difference;
                        } else if (difference > 0) {
                            statistics.Food[itemHrid] = difference;
                        }
                    }

                    if (hasInvalidData) {
                        //console.log(`有異常${playerName}的資料`,foodData)
                        processCombatConsumablesRunCount = -1;
                        foodData.Start = { Food: {}, Time: null };
                        foodData.End = { Food: {}, Time: null };
                        foodData.Statistics = { Food: {}, Time: null };
                        foodData.Start_Time = null;
                    } else {
                        //console.log(`無異常${playerName}的資料`,foodData)
                        foodData.Statistics = statistics;
                    }
                }
            }
        });

        // 儲存到本地儲存
        localStorage.setItem('Edible_Tools', JSON.stringify(edibleTools));
    }
    // 初始食物消耗檢測
    if (needTestFood) {
        const edibleTools = getEdibleToolsData();

        Object.keys(battlePlayerFood).forEach(playerName => {
            const playerData = battlePlayerFood[playerName];
            const drinkConcentration = playerData.drinkConcentration || 0;
            const playerCombatData = edibleTools.Combat_Data.Combat_Player_Data[playerName]?.Food_Data?.Statistics;

            if (playerCombatData && playerCombatData.Time > 0) {
                Object.entries(playerData).forEach(([itemName, itemData]) => {
                    if (itemName === 'drinkConcentration') return;
                    const unitTime = getFoodUnitTime(itemName, drinkConcentration, playerCombatData, itemData.ID);
                    const remainingHours = (itemData.數量 * unitTime) / 3600;
                    if (remainingHours < Edible_Tools_Set.foodWarningThreshold) {
                        const warningMessage = isCN
                        ? `${playerName} 的 ${e2c[itemName] || itemName} 只剩 ${remainingHours.toFixed(1)}h了`
                                : `${playerName}'s ${itemName} only has ${remainingHours.toFixed(1)}h left`;
                            showToast(warningMessage, 6000);
                        }
                    });
                }
            });

            needTestFood = false;
        }
        processCombatConsumablesRunCount++;
    }


function getEdibleToolsData() {
    const data = JSON.parse(localStorage.getItem('Edible_Tools')) || {};
    data.Combat_Data = data.Combat_Data || {};
    data.Combat_Data.Combat_Player_Data = data.Combat_Data.Combat_Player_Data || {};
    return data;
}

function getCombatTabsContainer() {
    return document.querySelector("#root > div > div > div.GamePage_gamePanel__3uNKN > div.GamePage_contentPanel__Zx4FH > div.GamePage_middlePanel__uDts7 > div.GamePage_mainPanel__2njyb > div > div:nth-child(1) > div > div > div > div.TabsComponent_tabsContainer__3BDUp > div > div > div");
}

function addBattlePlayerFoodButton() {
    var tabsContainer = getCombatTabsContainer();
    var referenceTab = tabsContainer ? tabsContainer.children[1] : null;

    if (!tabsContainer || !referenceTab) return;
    if (tabsContainer.querySelector('.Button_battlePlayerFood__custom')) return;

    // 建立按鈕
    var battlePlayerFoodButton = document.createElement('div');
    battlePlayerFoodButton.className = referenceTab.className + ' Button_battlePlayerFood__custom';
    battlePlayerFoodButton.setAttribute('script_translatedfrom', 'New Action');
    battlePlayerFoodButton.textContent = isCN ? "出警" : "Dispatch";

    battlePlayerFoodButton.addEventListener('click', function () {
        const edibleTools = getEdibleToolsData();

        // 計算最大數量字元長度
        let maxQuantityLength = 0;
        Object.values(battlePlayerFood).forEach(playerData => {
            Object.entries(playerData).forEach(([itemName, itemData]) => {
                if (itemName === 'drinkConcentration') return;
                const length = formatPrice(itemData.數量).length;
                if (length > maxQuantityLength) maxQuantityLength = length;
            });
        });

        // 計算所有玩家的最短剩餘時間
        let minTimeOverall = Infinity;
        let minTimePlayer = null;
        Object.keys(battlePlayerFood).forEach(playerName => {
            const playerData = battlePlayerFood[playerName];
            const drinkConcentration = playerData.drinkConcentration || 0;
            const playerCombatData = edibleTools.Combat_Data.Combat_Player_Data[playerName]?.Food_Data?.Statistics;
            let minTime = Infinity;

            Object.entries(playerData).forEach(([itemName, itemData]) => {
                if (itemName === 'drinkConcentration') return;
                const unitTime = getFoodUnitTime(itemName, drinkConcentration, playerCombatData, itemData.ID);
                const totalDays = (itemData.數量 * unitTime) / 86400;
                if (totalDays < minTime) minTime = totalDays;
            });

            if (minTime < minTimeOverall) {
                minTimeOverall = minTime;
                minTimePlayer = playerName;
            }
        });

        // 彈窗
        let dataHtml = `<div style="display: flex; padding: 0.625rem; gap: 0.9375rem;">`;

        Object.keys(battlePlayerFood).forEach(playerName => {
            const playerData = battlePlayerFood[playerName];
            const isMinTimePlayer = Object.keys(battlePlayerFood).length > 1 && playerName === minTimePlayer;

            dataHtml += `<div style="flex-shrink: 0; padding: 0.9375rem; border: 0.0625rem solid #98a7e9; border-radius: 0.625rem; background-color: #1e1e2f; white-space: nowrap;">
                <h3 style="color: ${isMinTimePlayer ? 'red' : '#98a7e9'}; margin: 0 0 0.9375rem 0; text-align: center;">
                    ${playerName}
                </h3>`;

                // 計算物品時間
                const drinkConcentration = playerData.drinkConcentration || 0;
                const playerCombatData = edibleTools.Combat_Data.Combat_Player_Data[playerName]?.Food_Data?.Statistics;
                let minTime = Infinity;
                const items = [];
                let totalHpR = 0;
                let totalMpR = 0;
                let HpRegenMax = 0;
                let MpRegenMax = 0;

                Object.entries(playerData).forEach(([itemName, itemData]) => {
                    if (itemName === 'drinkConcentration') return;
                    const unitTime = getFoodUnitTime(itemName, drinkConcentration, playerCombatData, itemData.ID);

                    if (!itemName.includes('Coffee') && playerCombatData?.Time != null && playerCombatData?.Food?.[itemData.ID] != null) {
                        const totalConsumed = playerCombatData.Food[itemData.ID];
                        const itemDetail = init_Client_Data.itemDetailMap[itemData.ID];
                        const hpr = itemDetail.consumableDetail.hitpointRestore || 0;
                        const mpr = itemDetail.consumableDetail.manapointRestore || 0;
                        totalHpR += hpr * totalConsumed;
                        totalMpR += mpr * totalConsumed;
                        HpRegenMax += hpr;
                        MpRegenMax += mpr;
                    }

                    const totalDays = (itemData.數量 * unitTime) / 86400;
                    items.push({ itemName, itemData, totalDays });
                    if (totalDays < minTime) minTime = totalDays;
                });

                const HpRegen = 60 * totalHpR / playerCombatData?.Time;
                const MpRegen = 60 * totalMpR / playerCombatData?.Time;

                // 物品顯示
                items.forEach(({ itemName, itemData, totalDays }) => {
                    const isMinItem = totalDays === minTime;
                    const svgIcon = `<svg width="1.25rem" height="1.25rem" style="margin-right:0.5rem;vertical-align:middle">
                    <use href="${item_icon_url}#${itemData.ID.split('/').pop()}"></use>
                    </svg>`;

                    // 計算每小時消耗
                    let consumptionPerHour = 0;
                    if (playerCombatData?.Time != null && playerCombatData?.Food[itemData.ID] != null) {
                        const totalConsumed = playerCombatData.Food[itemData.ID];
                        const totalTime = playerCombatData.Time;
                        consumptionPerHour = (totalConsumed / totalTime) * 3600;
                    }

                    dataHtml += `
                        <div style="display: flex; align-items: center; background-color: #2c2e45; border-radius: 0.3125rem; padding: 0.25rem; margin-bottom: 0.5rem; border: 0.0625rem solid #98a7e9;"
                             data-alt="${consumptionPerHour.toFixed(1)}/h">
                            <span style="color: ${isMinItem ? 'red' : 'white'};
                                min-width: ${maxQuantityLength * 10}px;
                                text-align: center;">
                                ${formatPrice(itemData.數量)}
                            </span>
                            ${svgIcon}
                            <span style="color: ${isMinItem ? 'red' : 'white'};">${isCN && e2c[itemName] ? e2c[itemName] : itemName}</span>
                        </div>`;
                });

                // 時間顯示
                const timeDisplay = minTime < 1
                ? `${(minTime * 24).toFixed(1)}小時`
                    : `${minTime.toFixed(1)}天`;
                dataHtml += `
                <div style="margin-top: 0.9375rem; padding-top: 0.625rem; border-top: 0.0625rem solid #98a7e9;">
                    <p style="color: ${isMinTimePlayer ? 'red' : '#4CAF50'}; margin: 0; font-weight: bold; text-align: center;">${isCN ? "剩餘時間" : "Duration"}: ${timeDisplay}</p>
                </div>
                <div style="margin-top: 0.625rem; text-align: center;">
                    <p style="color: gold; margin: 0; font-weight: bold;">${isCN ? "每分回血" : "HP Regen/min"}: ${isNaN(HpRegen) ? (isCN ? "等待資料穩定" : "Waiting for stable data") : `${HpRegen.toFixed(0)}(${HpRegenMax})`}</p>
                    <p style="color: gold; margin: 0; font-weight: bold;">${isCN ? "每分回藍" : "MP Regen/min"}: ${isNaN(MpRegen) ? (isCN ? "等待資料穩定" : "Waiting for stable data") : `${MpRegen.toFixed(0)}(${MpRegenMax})`}</p>
                </div>`;

                // 光環顯示
                const playerAura = battlePlayerData[playerName]?.aura;
                if (playerAura) {
                    const auraHrid = playerAura.split('/').pop();
                    const auraItemHrid = `/items/${auraHrid}`;
                    const auraName = item_hrid_to_name[auraItemHrid] || auraHrid;
                    const transferAuraName = isCN && e2c[auraName] ? e2c[auraName] : auraName;
                    dataHtml += `
                    <div style="margin-top: 0.625rem; text-align: center;">
                    <p style="color: #98a7e9; margin: 0; font-weight: bold;">${isCN ? "光環" : "Aura"}: ${transferAuraName}</p></div>`;
                }

                dataHtml += `</div>`;
            });
            dataHtml += '</div>';

            // 彈窗容器
            let popup = document.createElement('div');
            popup.style.position = 'fixed';
            popup.style.top = '50%';
            popup.style.left = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
            popup.style.backgroundColor = '#131419';
            popup.style.border = '0.0625rem solid #98a7e9';
            popup.style.borderRadius = '0.625rem';
            popup.style.zIndex = '10000';
            popup.style.maxWidth = '90%';

            // 水平容器
            let scrollWrapper = document.createElement('div');
            scrollWrapper.style.overflowX = 'auto';
            scrollWrapper.style.padding = '1.25rem';
            scrollWrapper.innerHTML = dataHtml;

            // 按鈕區域
            let buttonContainer = document.createElement('div');
            buttonContainer.style.display = 'flex';
            buttonContainer.style.justifyContent = 'space-between';
            buttonContainer.style.padding = '0.625rem 1.25rem';
            buttonContainer.style.borderTop = '0.0625rem solid #98a7e9';
            buttonContainer.style.backgroundColor = '#1e1e2f';

            // 清除資料按鈕
            let clearDataButton = document.createElement('button');
            clearDataButton.textContent = isCN ? '清除資料' : 'Clear Data';
            clearDataButton.style.backgroundColor = '#f44336';
            clearDataButton.style.color = 'white';
            clearDataButton.style.border = 'none';
            clearDataButton.style.padding = '0.625rem 1.25rem';
            clearDataButton.style.borderRadius = '0.3125rem';
            clearDataButton.style.cursor = 'pointer';
            clearDataButton.onclick = () => {
                if (confirm(isCN ? '確認清除所有資料？' : 'Are you sure you want to clear all data?')) {
                    const edibleTools = JSON.parse(localStorage.getItem('Edible_Tools')) || {};
                    edibleTools.Combat_Data = edibleTools.Combat_Data || {};
                    edibleTools.Combat_Data.Combat_Player_Data = {};
                    localStorage.setItem('Edible_Tools', JSON.stringify(edibleTools));
                    alert(isCN ? '資料已清除！' : 'Data cleared!');
                }
            };

            // 切換顯示按鈕
            let toggleConsumptionButton = document.createElement('button');
            toggleConsumptionButton.textContent = isCN ? '切換顯示' : 'Toggle Display';
            toggleConsumptionButton.style.backgroundColor = '#4357af';
            toggleConsumptionButton.style.color = 'white';
            toggleConsumptionButton.style.border = 'none';
            toggleConsumptionButton.style.padding = '0.625rem 1.25rem';
            toggleConsumptionButton.style.borderRadius = '0.3125rem';
            toggleConsumptionButton.style.cursor = 'pointer';

            // 切換按鈕點選事件
            toggleConsumptionButton.addEventListener('click', () => {
                const itemElements = scrollWrapper.querySelectorAll('[data-alt]');
                itemElements.forEach(itemElement => {
                    const quantityElement = itemElement.querySelector('span:first-child');
                    const currentText = quantityElement.textContent.trim();
                    const altData = itemElement.getAttribute('data-alt');
                    // 交換資料
                    itemElement.setAttribute('data-alt', currentText);
                    quantityElement.textContent = altData;
                });
            });

            // 關閉按鈕
            let closeButton = document.createElement('button');
            closeButton.textContent = isCN ? '關閉' : 'Close';
            closeButton.style.backgroundColor = '#4357af';
            closeButton.style.color = 'white';
            closeButton.style.border = 'none';
            closeButton.style.padding = '0.625rem 1.25rem';
            closeButton.style.borderRadius = '0.3125rem';
            closeButton.style.cursor = 'pointer';
            closeButton.onclick = () => document.body.removeChild(popup);

            // 新增按鈕到容器
            buttonContainer.appendChild(clearDataButton);
            buttonContainer.appendChild(toggleConsumptionButton);
            buttonContainer.appendChild(closeButton);

            // 新增到彈窗
            popup.appendChild(scrollWrapper);
            popup.appendChild(buttonContainer);
            document.body.appendChild(popup);
        });

        // 插入按鈕
        var lastTab = tabsContainer.children[tabsContainer.children.length - 1];
        tabsContainer.insertBefore(battlePlayerFoodButton, lastTab.nextSibling);

        // 按鈕樣式
        var style = document.createElement('style');
        style.innerHTML = `
            .Button_battlePlayerFood__custom {
                background-color: #546ddb;
                color: white;
                border-radius: 0.3125rem;
                padding: 0.3125rem 0.625rem;
                cursor: pointer;
                transition: background-color 0.3s;
            }
            .Button_battlePlayerFood__custom:hover {
                background-color: #6b84ff;
            }`;
        document.head.appendChild(style);
    }

function addBattlePlayerLootButton() {
    var tabsContainer = getCombatTabsContainer();
    var referenceTab = tabsContainer ? tabsContainer.children[1] : null;

    if (!tabsContainer || !referenceTab) {
        return;
    }

    // 如果按鈕已經存在，直接返回
    if (tabsContainer.querySelector('.Button_battlePlayerLoot__custom')) {
        console.log('分贓按鈕已存在');
        return;
    }

    // 建立按鈕
    var battlePlayerLootButton = document.createElement('div');
    battlePlayerLootButton.className = referenceTab.className + ' Button_battlePlayerLoot__custom';
    battlePlayerLootButton.setAttribute('script_translatedfrom', 'New Action');
    battlePlayerLootButton.textContent = isCN ? "分贓" : "Loot";

    // 按鈕點選事件
    battlePlayerLootButton.addEventListener('click', function() {
        const isMobile = window.innerWidth < 768; // 判斷是否為移動裝置
        const playerCount = Object.keys(battlePlayerLoot).length;
        let maxItemsToShow = 10; // 預設顯示10個物品
        const EPH = (60 * 60 * (battleRunCount - 1) / battleDuration)

        const skillTranslation = {
            attack: isCN ? '攻擊' : 'Attack',
            defense: isCN ? '防禦' : 'Defense',
            intelligence: isCN ? '智力' : 'Intelligence',
            melee: isCN ? '近戰' : 'Melee',
            stamina: isCN ? '耐力' : 'Stamina',
            magic: isCN ? '魔法' : 'Magic',
            ranged: isCN ? '遠端' : 'Ranged',
        };

        if (isMobile) {
            if (playerCount === 3) {
                maxItemsToShow = 3;
            } else if (playerCount === 2) {
                maxItemsToShow = 5;
            } else if (playerCount === 1) {
                maxItemsToShow = 10;
            } else if (playerCount > 3) {
                maxItemsToShow = 1;
            }
        }

        const edibleTools = getEdibleToolsData();
        const combatData = edibleTools.Combat_Data;
        const currentMapData = combatData.Combat_Map_Data?.[now_battle_map];
        const combatDropData = combatData.Combat_Mob_Drop_Data || {};
        const Mob_Kill_List = {};
        if (currentMapData && combatDropData) {
            const bossWave = currentMapData.BOSS波次;

            if (bossWave === 0) {
                Object.entries(currentMapData.小怪生成).forEach(([monsterHrid, data]) => {
                    Mob_Kill_List[monsterHrid] = {
                        擊殺數量: data.期望數量 * (battleRunCount - 1),
                    };
                });
            } else {
                const fullCycles = Math.floor((battleRunCount - 1) / bossWave);
                const remainingWaves = (battleRunCount - 1) % bossWave;
                const normalWaves = fullCycles * (bossWave - 1) + remainingWaves;

                Object.entries(currentMapData.小怪生成).forEach(([monsterHrid, data]) => {
                    Mob_Kill_List[monsterHrid] = {
                        擊殺數量: data.期望數量 * normalWaves,
                    };
                });

                if (currentMapData.BOSS資料 && typeof currentMapData.BOSS資料 === 'object') {
                    Object.entries(currentMapData.BOSS資料).forEach(([bossHrid, bossData]) => {
                        const existing = Mob_Kill_List[bossHrid] || { 擊殺數量: 0 };
                        Mob_Kill_List[bossHrid] = {
                            擊殺數量: existing.擊殺數量 + fullCycles,
                        };
                    });
                }
            }
            console.log(Mob_Kill_List)
        }



        let dataHtml = '<div style="display: flex; flex-direction: ' + (isMobile ? 'column' : 'row') + '; flex-wrap: nowrap; background-color: #131419; padding: ' + (isMobile ? '0.3125rem' : '0.625rem') + '; border-radius: 0.625rem; color: white;">';
        const minPrice = 10000;

        // 獲取所有玩家的總計價格
        let playerPrices = [];
        for (let player in battlePlayerLoot) {
            let totalPrice = 0;
            let lootItems = battlePlayerLoot[player];
            for (let item in lootItems) {
                let bidPrice = getSpecialItemPrice(item,"bid") || 0;
                totalPrice += bidPrice * lootItems[item].數量;
            }
            playerPrices.push({ player, totalPrice });
        }

        // 找到眉筆
        let minTotalPricePlayer = null;
        if (playerPrices.length > 1) {
            minTotalPricePlayer = playerPrices.reduce((min, current) =>
                                                      current.totalPrice < min.totalPrice ? current : min
                                                     ).player;
        }
        const diffTier = battleDifficultyTier || 0;
        // 顯示高價值物品
        for (let player in battlePlayerLoot) {
            const PlayerBonusData = battlePlayerData[player];
            const playerExpectDrops = {};

            const commonDropRateMultiplier = 1 + (PlayerBonusData.combatDropRate || 0);
            const rareDropRateMultiplier = 1 + (PlayerBonusData.combatRareFind || 0);
            const dropQuantityMultiplier = 1 + (PlayerBonusData.combatDropQuantity || 0);

            for (const [monsterHrid, killInfo] of Object.entries(Mob_Kill_List)) {
                const monsterDrops = combatDropData[monsterHrid];
                if (!monsterDrops) continue;

                const processDrops = (drops, isRare) => {
                    for (const drop of drops) {
                        const difficultyTierMultiplier = 1 + 0.1 * diffTier
                        const rateMultiplier = isRare ? rareDropRateMultiplier : commonDropRateMultiplier;
                        const actualRate = Math.min((drop.掉落機率+drop.難度掉率*diffTier) * rateMultiplier * difficultyTierMultiplier, 1);
                        if (actualRate<0) continue;
                        const actualQuantity = drop.掉落數量 * dropQuantityMultiplier / playerCount;

                        const expected = killInfo.擊殺數量 * actualRate * actualQuantity;

                        if (expected > 0) {
                            const key = drop.掉落物名稱;
                            playerExpectDrops[key] = (playerExpectDrops[key] || 0) + expected;
                        }
                    }
                }

                if (monsterDrops.普通掉落) processDrops(monsterDrops.普通掉落, false);
                if (monsterDrops.稀有掉落) processDrops(monsterDrops.稀有掉落, true);
            }
            let totalExpectPrice = 0;
            for (const [itemName, expectedQuantity] of Object.entries(playerExpectDrops)) {
                const unitPrice = getSpecialItemPrice(itemName, 'bid');
                if (unitPrice !== null) {
                    const taxFactor = Edible_Tools_Set.enableMarketTaxCalculation && !(itemName in specialItemPrices) ? 0.95 : 1;
                    totalExpectPrice += unitPrice * expectedQuantity * taxFactor;
                }
            }

            const formattedExpectDrops = {};
            for (const [itemHrid, value] of Object.entries(playerExpectDrops)) {
                formattedExpectDrops[itemHrid] = Number(value.toFixed(2));
            }
            console.log(formattedExpectDrops)

            //計算食物期望消耗
            let totalFoodPrice = 0;
            const playerFood = battlePlayerFood[player];
            const playerCombatData = edibleTools.Combat_Data.Combat_Player_Data[player]?.Food_Data?.Statistics;

            for (let foodName in playerFood) {
                if (foodName === 'drinkConcentration') continue;

                const foodPrice = getSpecialItemPrice(foodName, 'ask') || 0;
                const drinkConc = playerFood.drinkConcentration || 0;
                const unitTime = getFoodUnitTime(foodName, drinkConc, playerCombatData, playerFood[foodName].ID);
                const consumptionPerHour = 3600 / unitTime;

                const totalConsumed = consumptionPerHour * (battleDuration / 3600);
                totalFoodPrice += totalConsumed * foodPrice;
            }

            let totalPrice = 0;

            dataHtml += `<div style="flex: 1 0 auto; min-width: 6.25rem; margin: ${isMobile ? '0.3125rem 0' : '0.625rem'}; padding: ${isMobile ? '0.3125rem' : '0.625rem'}; border-radius: 0.625rem; background-color: #1e1e2f; border: 0.0625rem solid #98a7e9;">`;
            dataHtml += `<h3 style="color: white; margin: ${isMobile ? '0 0 0.3125rem 0' : '0 0 0.625rem 0'}; font-size: ${isMobile ? '0.75rem' : '1.25rem'};">${player}</h3>`;

            // 計算總價格
            let lootItems = battlePlayerLoot[player];
            for (let item in lootItems) {
                let bidPrice = getSpecialItemPrice(item,"bid") || 0;
                totalPrice += bidPrice * lootItems[item].數量;
            }
            // 顯示總計價格
            if (totalPrice > 0 && playerCount <= 3) {
                let color = '#4CAF50';
                if (player === minTotalPricePlayer) {
                    color = '#FF0000';
                }

                // 計算每天價格
                const pricePerDay = formatPrice((60 * 60 * 24 * totalPrice) / battleDuration);
                const ExpectPricePerDay = formatPrice((60 * 60 * 24 * totalExpectPrice) / battleDuration);
                const expectedProfit = totalExpectPrice - totalFoodPrice;
                const expectedProfitPerDay = (60 * 60 * 24 * expectedProfit) / battleDuration;

                dataHtml += `
                        <div style="color: ${color}; font-weight: bold; font-size: ${isMobile ? '0.625rem' : '1rem'}; margin: ${isMobile ? '0.125rem 0' : '0.625rem 0'};">
                            <div style="margin-bottom: ${isMobile ? '0.25rem' : '0.5rem'};">
                                ${isCN ? '總計價值' : 'Total Revenue'}: ${formatPrice(totalPrice)}<br>
                                ${isCN ? '每天收入' : 'Daily Revenue'}: ${pricePerDay}/d
                            </div>
                            ${totalExpectPrice > 0 ? `
                                <div style="height: 0.0625rem; background: #98a7e9; margin: ${isMobile ? '0.1875rem 0' : '0.375rem 0'}; "></div>
                                <div style="color: ${totalPrice > totalExpectPrice ? '#4CAF50':'#FF0000'}; margin-bottom: ${isMobile ? '0.25rem' : '0.5rem'};">
                                    ${(!isMobile) ? `${isCN ? '期望產值' : 'Expected Revenue'}: ${formatPrice(totalExpectPrice)}<br>` : ''}
                                    ${isCN ? '期望日入' : 'NoRNG Daily'}: ${ExpectPricePerDay}/d<br>
                                    ${isCN ? '期望日利' : 'Expected Daily'}: ${formatPrice(expectedProfitPerDay)}/d
                                </div>
                            ` : ''}
                        </div>`;
                }

                let maxSkill = null;
                let maxXp = 0;
                let totalXp = 0;
                if (battlePlayerData[player]?.skillexp) {
                    for (let skill in battlePlayerData[player].skillexp) {
                        let xp = battlePlayerData[player].skillexp[skill];
                        if (xp > maxXp) {
                            maxXp = xp;
                            maxSkill = skill;
                        }
                        totalXp += xp
                    }
                }
                const xpPerHours = formatPrice((60 * 60 * maxXp) / battleDuration);
                const totalXpPerHours = formatPrice((60 * 60 * totalXp) / battleDuration);
                const translatedSkillName = skillTranslation[maxSkill] || maxSkill;

                dataHtml += `
                <div style="height: 0.0625rem; background: #98a7e9; margin: ${isMobile ? '0.1875rem 0' : '0.375rem 0'}; "></div>
                <div style="color: #FFC107; font-size: ${isMobile ? '0.625rem' : '1rem'}; font-weight: bold; margin: ${isMobile ? '0.125rem 0' : '0.625rem 0'};">
                    ${isCN ? `${translatedSkillName}經驗` : `${translatedSkillName} EXP`}: ${xpPerHours}/h<br>
                    ${isCN ? `總計經驗` : `Total EXP`}: ${totalXpPerHours}/h<br>
                </div>`;

                let sortedItems = Object.keys(lootItems)
                .map(item => {
                    let bidPrice = getSpecialItemPrice(item, "bid") || 0;
                    return {
                        item,
                        bidPrice,
                        quantity: lootItems[item].數量
                    };
                })
                .filter(item => item.bidPrice >= 10000)
                .sort((a, b) => b.bidPrice - a.bidPrice);

                let maxQuantityLength = Math.max(...sortedItems.map(item => item.quantity.toString().length));

                for (let i = 0; i < Math.min(sortedItems.length, maxItemsToShow); i++) {
                    let item = sortedItems[i].item;
                    let bidPrice = sortedItems[i].bidPrice;
                    let quantity = sortedItems[i].quantity;

                    // 建立圖示
                    let svgIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svgIcon.setAttribute('width', isMobile ? '0.75rem' : '1.25rem');
                    svgIcon.setAttribute('height', isMobile ? '0.75rem' : '1.25rem');
                    svgIcon.style.marginRight = '0.1875rem';
                    svgIcon.style.verticalAlign = 'middle';

                    let useElement = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                    useElement.setAttribute('href', `${item_icon_url}#${lootItems[item].ID.split('/').pop()}`);
                    svgIcon.appendChild(useElement);

                    // 顯示物品數量、圖示和名稱
                    dataHtml += `
					<div style="display: flex; align-items: center; background-color: #2c2e45; border-radius: 0.3125rem; padding: ${isMobile ? '0.1875rem' : '0.5rem'}; margin-bottom: ${isMobile ? '0.1875rem' : '0.5rem'}; border: 0.0625rem solid #98a7e9; white-space: nowrap; flex-shrink: 0;">
							<span style="color: white; margin-right: 0.1875rem; min-width: ${isMobile ? maxQuantityLength * 0.3125 : maxQuantityLength * 0.5}rem; text-align: center; font-size: ${isMobile ? '0.625rem' : '1rem'}; line-height: 1.2;">${quantity}</span>
						${svgIcon.outerHTML}
						<span style="color: white; white-space: nowrap; font-size: ${isMobile ? '0.625rem' : '1rem'}; line-height: 1.2;">${isCN && e2c[item] ? e2c[item] : item}</span>
					</div>`;
                }
                dataHtml += '</div>';
            }
            dataHtml += '</div>';

            // 建立彈窗
            let popup = document.createElement('div');
            popup.style.position = 'fixed';
            popup.style.top = '50%';
            popup.style.left = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
            popup.style.backgroundColor = '#131419';
            popup.style.border = '0.0625rem solid #98a7e9';
            popup.style.padding = isMobile ? '0.625rem 0.625rem 0.625rem' : '1.25rem 1.25rem 1.25rem';
            popup.style.borderRadius = '0.625rem';
            popup.style.zIndex = '10000';
            popup.style.maxWidth = '90%';
            popup.style.maxHeight = '90%';
            popup.style.overflowX = 'auto';
            popup.style.overflowY = 'auto';
            popup.style.whiteSpace = 'nowrap';
            popup.innerHTML = dataHtml;

            const newElement = document.createElement('div');
            newElement.textContent = `${EPH.toFixed(1)} EPH ${formatSeconds(battleDuration)}`;
            newElement.style.position = 'absolute';
            newElement.style.top = '0';
            newElement.style.left = '50%';
            newElement.style.transform = 'translateX(-50%)';
            newElement.style.height = isMobile ? '0.625rem' : '1.25rem';
            newElement.style.minWidth = isMobile ? '5rem' : '10rem';
            newElement.style.display = 'flex';
            newElement.style.alignItems = 'center';
            newElement.style.justifyContent = 'center';
            newElement.style.backgroundColor = '#4357af';
            newElement.style.borderRadius = '0 0 0.3125rem 0.3125rem';
            newElement.style.fontSize = isMobile ? '0.5rem' : '1rem';
            newElement.style.color = 'white';
            newElement.style.fontWeight = 'bold';
            newElement.style.lineHeight = '1';
            newElement.style.zIndex = '1';

            // 新增關閉按鈕
            let closeButton = document.createElement('button');
            closeButton.textContent = '關閉';
            closeButton.style.position = 'sticky';
            closeButton.style.bottom = '0';
            closeButton.style.display = 'block';
            closeButton.style.margin = '0.3125rem auto 0 auto';
            closeButton.style.backgroundColor = '#4357af';
            closeButton.style.color = 'white';
            closeButton.style.border = 'none';
            closeButton.style.padding = isMobile ? '0.3125rem 0.625rem' : '0.625rem 1.25rem';
            closeButton.style.borderRadius = '0.3125rem';
            closeButton.style.cursor = 'pointer';
            closeButton.style.fontSize = isMobile ? '0.75rem' : '0.875rem';
            closeButton.onclick = function() {
                document.body.removeChild(popup);
            };
            popup.appendChild(newElement);
            popup.appendChild(closeButton);
            document.body.appendChild(popup);
        });

        // 將按鈕插入到最後一個標籤後面
        var lastTab = tabsContainer.children[tabsContainer.children.length - 1];
        tabsContainer.insertBefore(battlePlayerLootButton, lastTab.nextSibling);

        // 新增按鈕樣式
        var style = document.createElement('style');
        style.innerHTML = `
			.Button_battlePlayerLoot__custom {
				background-color: #db5454;
				color: white;
				border-radius: 0.3125rem;
					padding: 0.3125rem 0.625rem;
				cursor: pointer;
				transition: background-color 0.3s ease;
			}
			.Button_battlePlayerLoot__custom:hover {
				background-color: #ff6b6b;
			}
		`;
        document.head.appendChild(style);
    }

//選單
GM_registerMenuCommand('列印所有箱子掉落物', function() {
    console.log('箱子掉落物列表:', formattedChestDropData);
});

function createWindowBase() {
    let windowDiv = document.createElement('div');
    windowDiv.className = 'visualization-window';
    windowDiv.style.position = 'fixed';
    windowDiv.style.top = '50%';
    windowDiv.style.left = '50%';
    windowDiv.style.transform = 'translate(-50%, -50%)';
    windowDiv.style.minWidth = '18.75rem';
    windowDiv.style.maxWidth = 'min(25rem, 90vw)';
    windowDiv.style.maxHeight = '80vh';
    windowDiv.style.backgroundColor = '#131419';
    windowDiv.style.border = '0.0625rem solid #98a7e9';
    windowDiv.style.borderRadius = '0.625rem';
    windowDiv.style.zIndex = '10000';
    windowDiv.style.padding = '1.25rem';
    windowDiv.style.boxSizing = 'border-box';
    windowDiv.style.display = 'flex';
    windowDiv.style.flexDirection = 'column';
    windowDiv.style.gap = '0.9375rem';
    windowDiv.style.color = '#ffffff';
    windowDiv.style.boxShadow = '0 0.25rem 0.75rem rgba(0, 0, 0, 0.25)';
    windowDiv.style.overflow = 'hidden';
    return windowDiv;
}

function createVisualizationWindow(chestData) {
    let oldWindow = document.querySelector('.visualization-window');
    if (oldWindow) oldWindow.remove();

    let windowDiv = createWindowBase();
    windowDiv.style.minHeight = '18.75rem';
    windowDiv.style.maxWidth = '25rem';

    // 標題
    let title = document.createElement('h1');
    title.innerText = isCN ? '選擇角色' : 'Select Character';
    title.style.color = '#98a7e9';
    title.style.margin = '0';
    title.style.fontSize = '1.5em';
    title.style.textAlign = 'center';
    windowDiv.appendChild(title);

    // 內容區域
    let contentDiv = document.createElement('div');
    contentDiv.style.flex = '1';
    contentDiv.style.overflowY = 'auto';
    contentDiv.style.paddingRight = '0.5rem';
    contentDiv.style.display = 'flex';
    contentDiv.style.flexDirection = 'column';
    contentDiv.style.gap = '0.625rem';

    // 玩家列表
    for (let playerID in chestData) {
        const playerData = chestData[playerID];
        const playerName = playerData.玩家暱稱;
        if (Edible_Tools_Set.enableHideOldVersionChestData && playerID == 0) continue;
        let playerBox = document.createElement('div');
        playerBox.style.display = 'flex';
        playerBox.style.alignItems = 'center';
        playerBox.style.border = '0.0625rem solid #98a7e9';
        playerBox.style.borderRadius = '0.5rem';
        playerBox.style.padding = '0.75rem';
        playerBox.style.cursor = 'pointer';
        playerBox.style.backgroundColor = '#1e1e2f';
        playerBox.style.transition = 'all 0.3s ease';

        // 懸停效果
        playerBox.onmouseenter = () => {
            playerBox.style.backgroundColor = '#2c2e45';
            playerBox.style.transform = 'translateX(0.3125rem)';
        };
        playerBox.onmouseleave = () => {
            playerBox.style.backgroundColor = '#1e1e2f';
            playerBox.style.transform = 'none';
        };

        playerBox.onclick = () => showChestList(playerID, playerName, playerData.開箱資料);

        // 玩家名稱
        let playerText = document.createElement('span');
        playerText.style.flex = '1';
        playerText.style.fontSize = '1.1em';
        playerText.style.color = '#ffffff';
        playerText.textContent = playerName;

        // 刪除按鈕
        let deleteButton = document.createElement('button');
        deleteButton.textContent = '×';
        deleteButton.style.backgroundColor = 'red';
        deleteButton.style.color = 'white';
        deleteButton.style.border = 'none';
        deleteButton.style.borderRadius = '50%';
        deleteButton.style.width = '1.5rem';
        deleteButton.style.height = '1.5rem';
        deleteButton.style.cursor = 'pointer';
        deleteButton.onclick = (e) => {
            e.stopPropagation(); // 防止觸發父元素的點選事件
            if (confirm(`是否刪除 ${playerName} 的全部開箱資料？`)) {
                deletePlayerChestData(playerID);
                createVisualizationWindow(JSON.parse(localStorage.getItem('Edible_Tools')).Chest_Open_Data);
            }
        };

        playerBox.appendChild(playerText);
        playerBox.appendChild(deleteButton);
        contentDiv.appendChild(playerBox);
    }

    windowDiv.appendChild(contentDiv);

    // 關閉按鈕
    let closeButton = document.createElement('button');
    closeButton.textContent = isCN ? '關閉' : 'Close';
    closeButton.style.marginTop = '0.625rem';
    closeButton.style.padding = '0.625rem';
    closeButton.style.backgroundColor = '#4357af';
    closeButton.style.color = 'white';
    closeButton.style.border = 'none';
    closeButton.style.borderRadius = '0.3125rem';
    closeButton.style.cursor = 'pointer';
    closeButton.onclick = () => document.body.removeChild(windowDiv);

    windowDiv.appendChild(closeButton);
    document.body.appendChild(windowDiv);
}

function deletePlayerChestData(playerID) {
    let edibleToolsData = JSON.parse(localStorage.getItem('Edible_Tools'));
    if (edibleToolsData && edibleToolsData.Chest_Open_Data) {
        delete edibleToolsData.Chest_Open_Data[playerID];
        localStorage.setItem('Edible_Tools', JSON.stringify(edibleToolsData));
    }
}

function showChestList(playerID, playerName, chestData) {
    let oldWindow = document.querySelector('.visualization-window');
    if (oldWindow) oldWindow.remove();

    let windowDiv = createWindowBase();
    windowDiv.style.minHeight = '18.75rem';
    windowDiv.style.maxWidth = '25rem';

    // 標題
    let title = document.createElement('h1');
    title.innerText = isCN ? '開箱記錄' : 'Chest Records';
    title.style.color = '#98a7e9';
    title.style.margin = '0';
    title.style.fontSize = '1.5em';
    title.style.textAlign = 'center';
    windowDiv.appendChild(title);

    // 內容區域
    let contentDiv = document.createElement('div');
    contentDiv.style.flex = '1';
    contentDiv.style.overflowY = 'auto';
    contentDiv.style.paddingRight = '0.5rem';
    contentDiv.style.display = 'flex';
    contentDiv.style.flexDirection = 'column';
    contentDiv.style.gap = '0.625rem';

    // 箱子列表
    for (let chestName in chestData) {
        let chest = chestData[chestName];

        let chestBox = document.createElement('div');
        chestBox.style.display = 'flex';
        chestBox.style.alignItems = 'center';
        chestBox.style.border = '0.0625rem solid #98a7e9';
        chestBox.style.borderRadius = '0.5rem';
        chestBox.style.padding = '0.75rem';
        chestBox.style.cursor = 'pointer';
        chestBox.style.backgroundColor = '#1e1e2f';
        chestBox.style.transition = 'all 0.3s ease';

        // 懸停效果
        chestBox.onmouseenter = () => {
            chestBox.style.backgroundColor = '#2c2e45';
            chestBox.style.transform = 'translateX(0.3125rem)';
        };
        chestBox.onmouseleave = () => {
            chestBox.style.backgroundColor = '#1e1e2f';
            chestBox.style.transform = 'none';
        };

        chestBox.onclick = () => showChestDetails(playerID, playerName, chestName, chest);

        // 圖示
        let svgIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgIcon.setAttribute('width', '1.25rem');
        svgIcon.setAttribute('height', '1.25rem');
        svgIcon.style.marginRight = '0.75rem';
        svgIcon.style.flexShrink = '0';

        let useElement = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        try {
            let iconId = item_name_to_hrid[chestName].split('/').pop();
            useElement.setAttribute('href', `${item_icon_url}#${iconId}`);
        } catch (error) {
            useElement.setAttribute('href', `${item_icon_url}#coin`);
        }
        svgIcon.appendChild(useElement);

        // 文字
        let chestText = document.createElement('span');
        chestText.style.flex = '1';
        chestText.style.fontSize = '0.95em';
        chestText.innerHTML = `
                <div style="color: #98a7e9;">${isCN && e2c[chestName] ? e2c[chestName] : chestName}</div>
                <div style="color: #ffffff; font-size: 1.1em;">${chest['總計開箱數量']}</div>
            `;

            // 刪除按鈕
            let deleteButton = document.createElement('button');
            deleteButton.textContent = '×';
            deleteButton.style.backgroundColor = 'red';
            deleteButton.style.color = 'white';
            deleteButton.style.border = 'none';
            deleteButton.style.borderRadius = '50%';
            deleteButton.style.width = '1.5rem';
            deleteButton.style.height = '1.5rem';
            deleteButton.style.cursor = 'pointer';
            deleteButton.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`是否刪除 ${isCN && e2c[chestName] ? e2c[chestName] : chestName} 的開箱資料？`)) {
                    deleteChestData(playerID, chestName);
                    showChestList(playerID, playerName, JSON.parse(localStorage.getItem('Edible_Tools')).Chest_Open_Data[playerID].開箱資料);
                }
            };

            chestBox.appendChild(svgIcon);
            chestBox.appendChild(chestText);
            chestBox.appendChild(deleteButton);
            contentDiv.appendChild(chestBox);
        }

        windowDiv.appendChild(contentDiv);

        // 底部按鈕
        let footerDiv = document.createElement('div');
        footerDiv.style.display = 'flex';
        footerDiv.style.gap = '0.625rem';
        footerDiv.style.marginTop = '0.625rem';

        const buttonStyle = {
            flex: '1',
            backgroundColor: '#4357af',
            color: 'white',
            border: 'none',
            padding: '0.625rem',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            transition: 'background-color 0.3s',
            fontSize: '0.95em'
        };

        // 返回按鈕
        let backButton = document.createElement('button');
        Object.assign(backButton.style, buttonStyle);
        backButton.innerText = isCN ? '返回' : 'Back';
        backButton.onclick = () => {
            windowDiv.remove();
            createVisualizationWindow(JSON.parse(localStorage.getItem('Edible_Tools')).Chest_Open_Data);
        };

        // 關閉按鈕
        let closeButton = document.createElement('button');
        Object.assign(closeButton.style, buttonStyle);
        closeButton.innerText = isCN ? '關閉' : 'Close';
        closeButton.onclick = () => windowDiv.remove();

        footerDiv.appendChild(backButton);
        footerDiv.appendChild(closeButton);
        windowDiv.appendChild(footerDiv);

        document.body.appendChild(windowDiv);
    }

function deleteChestData(playerID, chestName) {
    let edibleToolsData = JSON.parse(localStorage.getItem('Edible_Tools'));
    if (edibleToolsData && edibleToolsData.Chest_Open_Data && edibleToolsData.Chest_Open_Data[playerID]) {
        delete edibleToolsData.Chest_Open_Data[playerID].開箱資料[chestName];
        localStorage.setItem('Edible_Tools', JSON.stringify(edibleToolsData));
    }
}

function showChestDetails(playerID, playerName, chestName, chestData) {
    let oldWindow = document.querySelector('.visualization-window');
    if (oldWindow) oldWindow.remove();

    let detailsWindow = createWindowBase();
    detailsWindow.style.minWidth = '18.75rem';
    detailsWindow.style.maxWidth = '25rem';

    // 標題
    let title = document.createElement('div');
    title.style.display = 'flex';
    title.style.alignItems = 'center';
    title.style.justifyContent = 'center';
    title.style.gap = '0.625rem';
    title.style.margin = '0 0 0.9375rem 0';

    let titleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    titleSvg.setAttribute('width', '1.75rem');
    titleSvg.setAttribute('height', '1.75rem');

    let iconId = item_name_to_hrid[chestName].split('/').pop();
    titleSvg.innerHTML = `<use href="${item_icon_url}#${iconId}"/>`;

    let titleText = document.createElement('span');
    titleText.style.color = '#98a7e9';
    titleText.style.fontSize = '1.4em';
    titleText.textContent = isCN && e2c[chestName] ? e2c[chestName] : chestName;

    title.appendChild(titleSvg);
    title.appendChild(titleText);
    detailsWindow.appendChild(title);

    // 內容區域
    let contentDiv = document.createElement('div');
    contentDiv.style.flex = '1';
    contentDiv.style.overflowY = 'auto';
    contentDiv.style.display = 'flex';
    contentDiv.style.flexDirection = 'column';
    contentDiv.style.gap = '0.75rem';
    contentDiv.style.paddingRight = '0.5rem';

    // 統計卡片
    let statsCard = document.createElement('div');
    statsCard.style.backgroundColor = '#1e1e2f';
    statsCard.style.borderRadius = '0.5rem';
    statsCard.style.padding = '0.9375rem';
    statsCard.innerHTML = `
			<div style="color: #98a7e9; margin-bottom: 0.625rem;">📋 ${isCN ? "統計概覽" : "Statistics Overview"}</div>
			<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem;">
				<div>${isCN ? "開箱總數" : "Total Open"}</div>
				<div style="color: #ffffff; text-align: right;">${chestData['總計開箱數量']}</div>
				<div>${isCN ? "Ask 總值" : "Total Ask"}</div>
				<div style="color: #4CAF50; text-align: right;">${formatPrice(chestData['總計開箱Ask'])}</div>
				<div>${isCN ? "Bid 總值" : "Total Bid"}</div>
				<div style="color: orange; text-align: right;">${formatPrice(chestData['總計開箱Bid'])}</div>
				<div>${isCN ? (chestData['累計偏差值'] < 0 ? "低於期望" : "高於期望") : (chestData['累計偏差值'] < 0 ? "Below Expectation" : "Above Expectation")}</div>
				<div style="color: ${chestData['累計偏差值'] < 0 ? '#F44336' : '#4CAF50'}; text-align: right;">${formatPrice(Math.abs(chestData['累計偏差值'] || 0))}</div>
				${chestData['總計最高利潤'] !== undefined ? `
					<div>${isCN ? "期望利潤" : "Expected Profit"}</div>
					<div style="color: ${
						(chestData['總計最低利潤'] > 0 && chestData['總計最高利潤'] > 0) ? '#4CAF50' :
        (chestData['總計最低利潤'] < 0 && chestData['總計最高利潤'] < 0) ? '#F44336' :
        '#FFEB3B'
    }; text-align: right;">
						${formatPrice(chestData['總計最低利潤'])}～${formatPrice(chestData['總計最高利潤'])}
					</div>
				` : ''}
			</div>
		`;
        contentDiv.appendChild(statsCard);

        // 物品列表
        let itemListHeader = document.createElement('div');
        itemListHeader.style.color = '#98a7e9';
        itemListHeader.innerText = isCN ? '🎁 獲得物品' : "🎁 Get Item";
        contentDiv.appendChild(itemListHeader);

        const sortedItems = Object.entries(chestData['獲得物品']).sort((a, b) => {
            const getValidValue = (val) => val === -1 ? 0 : val;

            const aAsk = getValidValue(a[1]['總計Ask價值']);
            const aBid = getValidValue(a[1]['總計Bid價值']);
            const bAsk = getValidValue(b[1]['總計Ask價值']);
            const bBid = getValidValue(b[1]['總計Bid價值']);

            return (bAsk + bBid) - (aAsk + aBid);
        });

        sortedItems.forEach(([itemName, item]) => {
            let itemBox = document.createElement('div');

            itemBox.style.display = 'flex';
            itemBox.style.alignItems = 'center';
            itemBox.style.backgroundColor = '#1e1e2f';
            itemBox.style.border = '0.0625rem solid #98a7e9';
            itemBox.style.borderRadius = '0.5rem';
            itemBox.style.padding = '0.75rem';
            itemBox.style.gap = '0.625rem';

            // 圖示
            let svgIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svgIcon.setAttribute('width', '1.5rem');
            svgIcon.setAttribute('height', '1.5rem');

            let useElement = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            try {
                let iconId = item_name_to_hrid[itemName].split('/').pop();
                useElement.setAttribute('href', `${item_icon_url}#${iconId}`);
            } catch (error) {
                useElement.setAttribute('href', `${item_icon_url}#coin`);
            }
            svgIcon.appendChild(useElement);

            // 文字
            let itemText = document.createElement('div');
            itemText.style.flex = '1';
            itemText.innerHTML = `
            <div style="color: #ffffff;">${isCN && e2c[itemName] ? e2c[itemName] : itemName}</div>
            <div style="color: #98a7e9; font-size: 0.9em;">${isCN ? "數量" : "Count"}: ${formatPrice(item['數量'])}</div>
        `;

            itemBox.appendChild(svgIcon);
            itemBox.appendChild(itemText);
            contentDiv.appendChild(itemBox);
        });

        detailsWindow.appendChild(contentDiv);

        // 底部按鈕
        let footerDiv = document.createElement('div');
        footerDiv.style.display = 'flex';
        footerDiv.style.gap = '0.625rem';
        footerDiv.style.marginTop = '0.625rem';

        const buttonStyle = {
            flex: '1',
            backgroundColor: '#4357af',
            color: 'white',
            border: 'none',
            padding: '0.625rem',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            transition: 'background-color 0.3s'
        };

        // 返回按鈕
        let backButton = document.createElement('button');
        Object.assign(backButton.style, buttonStyle);
        backButton.innerText = isCN ? '返回' : 'Back';
        backButton.onclick = () => {
            detailsWindow.remove();
            showChestList(playerID, playerName, JSON.parse(localStorage.getItem('Edible_Tools')).Chest_Open_Data[playerID].開箱資料);
        };

        // 關閉按鈕
        let closeButton = document.createElement('button');
        Object.assign(closeButton.style, buttonStyle);
        closeButton.innerText = isCN ? '關閉' : 'Close';
        closeButton.onclick = () => detailsWindow.remove();

        footerDiv.appendChild(backButton);
        footerDiv.appendChild(closeButton);
        detailsWindow.appendChild(footerDiv);

        document.body.appendChild(detailsWindow);
    }

GM_registerMenuCommand('列印全部開箱記錄', function() {
    const edibleTools = JSON.parse(localStorage.getItem('Edible_Tools')) || {};
    const openChestData = edibleTools.Chest_Open_Data || {};
    createVisualizationWindow(openChestData);
});

GM_registerMenuCommand('列印掉落物列表', function() {
    let dataHtml = '<div style="display: flex; flex-wrap: nowrap;">';
    const minPrice = 10000;
    for (let player in battlePlayerLoot) {
        let totalPrice = 0;
        dataHtml += `<div style="flex: 1 0 auto; min-width: 6.25rem; margin: 0.625rem; padding: 0.625rem; border: 0.0625rem solid black;">`;
        dataHtml += `<h3>${player}</h3>`;

        let lootItems = battlePlayerLoot[player];
        for (let item in lootItems) {
            let bidPrice = getSpecialItemPrice(item,"bid") || 0;
            totalPrice += bidPrice*lootItems[item].數量
            if (bidPrice > minPrice) {
                dataHtml += `<p>${item}: ${lootItems[item].數量}</p>`;
            }
        }
        if (totalPrice > 0) {
            dataHtml += `<p>總計價格: ${formatPrice(totalPrice)}</p>`;
        }
        dataHtml += '</div>';
    }
    dataHtml += '</div>';

    let popup = document.createElement('div');
    popup.style.position = 'fixed';
    popup.style.top = '50%';
    popup.style.left = '50%';
    popup.style.transform = 'translate(-50%, -50%)';
    popup.style.backgroundColor = 'white';
    popup.style.border = '0.0625rem solid black';
    popup.style.padding = '0.625rem';
    popup.style.zIndex = '10000';
    popup.style.maxWidth = '75%';
    popup.style.overflowX = 'auto';
    popup.style.whiteSpace = 'nowrap';
    popup.innerHTML = dataHtml;

    let closeButton = document.createElement('button');
    closeButton.textContent = '關閉';
    closeButton.style.display = 'block';
    closeButton.style.margin = '1.25rem auto 0 auto';
    closeButton.onclick = function() {
        document.body.removeChild(popup);
    };
    popup.appendChild(closeButton);

    document.body.appendChild(popup);
});

GM_registerMenuCommand('管理本地快取', function() {
    function showLocalStorageStats() {
        const overlay = document.createElement('div');
        overlay.id = 'ls-stats-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 9999;
        `;
            document.body.appendChild(overlay);

            const modal = document.createElement('div');
            modal.id = 'ls-stats-modal';
            modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 80%;
            max-width: 50rem;
            background: #131419;
            border-radius: 0.5rem;
            border: 0.0625rem solid #98a7e9;
            box-shadow: 0 0.25rem 1.25rem rgba(0,0,0,0.6);
            z-index: 10000;
            font-family: Arial, sans-serif;
            color: #c8d0f0;
        `;
            function getStringSize(str) {
                if (!str) return 0;
                return new Blob([str]).size;
            }

            function getLocalStorageStats() {
                const stats = [];
                let totalSize = 0;

                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    const value = localStorage.getItem(key);
                    const size = getStringSize(key) + getStringSize(value);

                    stats.push({
                        key: key,
                        size: size,
                        value: value
                    });

                    totalSize += size;
                }

                stats.sort((a, b) => b.size - a.size);

                return {
                    items: stats,
                    totalSize: totalSize
                };
            }

            // 格式化位元組大小
            function formatBytes(bytes, decimals = 2) {
                if (bytes === 0) return '0 Bytes';

                const k = 1024;
                const dm = decimals < 0 ? 0 : decimals;
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];

                const i = Math.floor(Math.log(bytes) / Math.log(k));

                return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
            }
            const stats = getLocalStorageStats();

            modal.innerHTML = `
            <div id="ls-stats-header" style="background: #1e1e2f; color: #98a7e9; padding: 0.9375rem; border-radius: 0.5rem 0.5rem 0 0; display: flex; justify-content: space-between; align-items: center; border-bottom: 0.0625rem solid #2c2e45;">
                <h3 style="margin: 0;">LocalStorage 佔用情況 - ${window.location.hostname}</h3>
                <button id="ls-stats-close" style="background: none; border: none; color: white; font-size: 1.25rem; cursor: pointer;">&times;</button>
            </div>
            <div id="ls-stats-content" style="padding: 0.9375rem; max-height: 70vh; overflow-y: auto;">
                <table id="ls-stats-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="background: #1e1e2f; color: #98a7e9; padding: 0.625rem; text-align: left; border-bottom: 0.0625rem solid #2c2e45;">鍵名</th>
                            <th style="background: #1e1e2f; color: #98a7e9; padding: 0.625rem; text-align: left; border-bottom: 0.0625rem solid #2c2e45;">佔用空間</th>
                            <th style="background: #1e1e2f; color: #98a7e9; padding: 0.625rem; text-align: left; border-bottom: 0.0625rem solid #2c2e45;">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="total-row" style="font-weight: bold; background-color: #1a1a28;">
                            <td style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45;">總計</td>
                            <td class="size-info" style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45; font-family: monospace;">${formatBytes(stats.totalSize)}</td>
                            <td style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45;">
                                <button class="delete-btn" id="clear-all-btn" style="background: #e74c3c; color: white; border: none; padding: 0.3125rem 0.625rem; border-radius: 0.25rem; cursor: pointer;">清空全部</button>
                            </td>
                        </tr>
                        ${stats.items.map(item => {
                const percentage = ((item.size / stats.totalSize) * 100).toFixed(2);
                return `
                                <tr>
                                    <td style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45;" title="${item.key}">${item.key.length > 30 ? item.key.substring(0, 30) + '...' : item.key}</td>
                                    <td class="size-info" style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45; font-family: monospace;">${formatBytes(item.size)} (${percentage}%)</td>
                                    <td style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45;">
                                        <button class="delete-btn" data-key="${item.key}" style="background: #e74c3c; color: white; border: none; padding: 0.3125rem 0.625rem; border-radius: 0.25rem; cursor: pointer;">刪除</button>
                                    </td>
                                </tr>
                            `;
            }).join('')}
                    </tbody>
                </table>
            </div>
        `;

            document.body.appendChild(modal);

            document.getElementById('ls-stats-close').addEventListener('click', closeStats);
            overlay.addEventListener('click', closeStats);

            document.querySelectorAll('.delete-btn[data-key]').forEach(btn => {
                btn.addEventListener('click', function() {
                    const key = this.getAttribute('data-key');
                    if (confirm(`確定要刪除鍵 "${key}" 嗎？`)) {
                        localStorage.removeItem(key);
                        closeStats();
                        showLocalStorageStats();
                    }
                });
            });

            document.getElementById('clear-all-btn').addEventListener('click', function() {
                if (confirm('確定要清空全部 LocalStorage 資料嗎？此操作不可撤銷！')) {
                    localStorage.clear();
                    closeStats();
                    showLocalStorageStats();
                }
            });

            function closeStats() {
                if (document.getElementById('ls-stats-modal')) {
                    document.body.removeChild(document.getElementById('ls-stats-modal'));
                }
                if (document.getElementById('ls-stats-overlay')) {
                    document.body.removeChild(document.getElementById('ls-stats-overlay'));
                }
            }
        }

        showLocalStorageStats()
    });

function formatToChinesetime(timestamp) {
    const date = new Date(timestamp);
    const beijingOffset = 8 * 60;
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset() + beijingOffset);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}/${month}/${day} ${hours}:${minutes}`;
}

function openSettings() {
    const tran_market_list = {
        "/market_listing_status/filled": isCN ? "已完成" : "Filled",
        "/market_listing_status/active": isCN ? "進行中" : "Active",
        "/market_listing_status/cancelled": isCN ? "取消" : "Cancelled",
        "/market_listing_status/expired": isCN ? "超時" : "Expired",
    };
    const market_List_Data = JSON.parse(GM_getValue('market_list', '[]'));
    const hrid2name = item_hrid_to_name;

    // 格式化市場資料
    market_List_Data.forEach(item => {
        item.itemName = hrid2name[item.itemHrid] || item.itemHrid;
        if (item.lastUpdated) {
            item.format_lastUpdated = formatToChinesetime(item.lastUpdated);
        }
    });

    const settingsContainer = document.createElement('div');
    settingsContainer.style.position = 'fixed';
    settingsContainer.style.top = '0';
    settingsContainer.style.left = '0';
    settingsContainer.style.width = '100%';
    settingsContainer.style.height = '100%';
    settingsContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    settingsContainer.style.zIndex = '9999';
    settingsContainer.style.display = 'flex';
    settingsContainer.style.flexDirection = 'column';

    // 頁面內容
    const Edible_Tools_HTML = `
            <div style="flex: 1; overflow-y: auto; background-color: #131419; padding: 1.25rem; color: #c8d0f0;">
                <header style="background-color: #1e1e2f; color: #98a7e9; padding: 0.625rem 1.25rem; text-align: center; border-bottom: 0.0625rem solid #98a7e9;">
                    <h1>${isCN ? '銀河奶牛資料庫' : 'Milk Way Idle Database'}</h1>
                </header>
                <div style="display: flex; flex: 1;">
                    <div style="width: 12.5rem; background-color: #1a1a28; padding: 0.625rem; border-right: 0.0625rem solid #2c2e45;">
                        <button id="showMarketDataBtn" style="width: 100%; padding: 0.625rem; margin: 0.3125rem 0; background-color: #2c2e45; color: #c8d0f0; border: 0.0625rem solid #98a7e9; border-radius: 0.25rem; cursor: pointer;">${isCN ? '市場資料' : 'Market Data'}</button>
                        <button id="showOpenChestDataBtn" style="width: 100%; padding: 0.625rem; margin: 0.3125rem 0; background-color: #2c2e45; color: #c8d0f0; border: 0.0625rem solid #98a7e9; border-radius: 0.25rem; cursor: pointer;">${isCN ? '開箱資料' : 'Chest Data'}</button>
                        <button id="showEnhancementDataBtn" style="width: 100%; padding: 0.625rem; margin: 0.3125rem 0; background-color: #2c2e45; color: #c8d0f0; border: 0.0625rem solid #98a7e9; border-radius: 0.25rem; cursor: pointer;">${isCN ? '強化資料' : 'Enhancement Data'}</button>
                        <button id="showDungeonToolsBtn" style="width: 100%; padding: 0.625rem; margin: 0.3125rem 0; background-color: #2c2e45; color: #c8d0f0; border: 0.0625rem solid #98a7e9; border-radius: 0.25rem; cursor: pointer;">${isCN ? '地牢工具' : 'Dungeon Tools'}</button>
                        <button id="showLocalStorageStatsBtn" style="width: 100%; padding: 0.625rem; margin: 0.3125rem 0; background-color: #2c2e45; color: #c8d0f0; border: 0.0625rem solid #98a7e9; border-radius: 0.25rem; cursor: pointer;">${isCN ? '本地快取' : 'Local Storage'}</button>
                        <button id="showEdibleToolsSettingBtn" style="width: 100%; padding: 0.625rem; margin: 0.3125rem 0; background-color: #2c2e45; color: #c8d0f0; border: 0.0625rem solid #98a7e9; border-radius: 0.25rem; cursor: pointer;">${isCN ? '外掛設定' : 'Plugin Settings'}</button>
                    </div>
                    <div style="flex: 1; padding: 1.25rem; overflow-y: auto; display: block;" id="showMarketDataPage">
                        <h2 style="text-align: center;">${isCN ? '市場資料' : 'Market Data'}</h2>
                        <div style="text-align: center; margin-bottom: 1.25rem;">
                            <button id="deleteOldDataBtn" style="padding: 0.625rem 1.25rem; margin: 0 0.625rem; background-color: #3d2c2c; color: #ff9999; border: 0.0625rem solid #c0392b; border-radius: 0.25rem; cursor: pointer;">刪除過時市場資料</button>
                            <button id="deleteSpecificStatusDataBtn" style="padding: 0.625rem 1.25rem; margin: 0 0.625rem; background-color: #3d2c2c; color: #ff9999; border: 0.0625rem solid #c0392b; border-radius: 0.25rem; cursor: pointer;">僅保留已完成訂單</button>
                        </div>
                        <table class="marketList-table" style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr>
                                    <th data-sort="id">${isCN ? '訂單ID' : 'Order ID'}</th>
                                    <th data-sort="characterID">${isCN ? '角色ID' : 'Character ID'}</th>
                                    <th data-sort="status">${isCN ? '狀態' : 'Status'}</th>
                                    <th data-sort="isSell">${isCN ? '型別' : 'Type'}</th>
                                    <th data-sort="itemName">${isCN ? '物品' : 'Item'}</th>
                                    <th data-sort="orderQuantity">${isCN ? '數量' : 'Quantity'}</th>
                                    <th data-sort="filledQuantity">${isCN ? '已交易數量' : 'Filled Qty'}</th>
                                    <th data-sort="price">${isCN ? '單價' : 'Price'}</th>
                                    <th data-sort="total">${isCN ? '貿易額' : 'Total'}</th>
                                    <th data-sort="format_lastUpdated">${isCN ? '更新時間' : 'Last Updated'}</th>
                                    <th>${isCN ? '操作' : 'Action'}</th>
                                </tr>
                            </thead>
                            <tbody id="marketDataTableBody">
                                <!-- 資料表會在這裡插入 -->
                            </tbody>
                        </table>
                    </div>
                    <div style="flex: 1; padding: 1.25rem; overflow-y: auto; display: none;" id="OpenChestDataPage">
                        <h2 style="text-align: center;">${isCN ? '開箱資料(咕?)' : 'Chest Data'}</h2>
                    </div>
                    <div style="flex: 1; padding: 1.25rem; overflow-y: auto; display: none;" id="EnhancementDataPage">
                        <h2 style="text-align: center;">${isCN ? '強化資料(咕咕～)' : 'Enhancement Data'}</h2>
                    </div>
					<div style="flex: 1; padding: 1.25rem; overflow-y: auto; display: none;" id="DungeonToolsPage">
						<h2 style="text-align: center;">${isCN ? '地牢助手' : 'Dungeon Tools'}</h2>
						<div style="display: flex; flex-direction: column; gap: 1.25rem; max-width: 50rem; margin: 0 auto;">
						<!-- 使用者選擇部分 -->
						<div style="background: #1e1e2f; padding: 0.9375rem; border-radius: 0.5rem; border: 0.0625rem solid #2c2e45">
								<h3 style="margin-top: 0;">${isCN ? '地牢設定' : 'Dungeon Settings'}</h3>
								<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(12.5rem, 1fr)); gap: 0.9375rem;">
								<div>
									<label>${isCN ? '地牢' : 'Dungeon'}:</label>
									<select id="dungeonSelect" style="width: 100%; padding: 0.5rem; border-radius: 0.25rem; border: 0.0625rem solid #3a3d5c; background-color: #1a1a28; color: #c8d0f0;">
											${Object.keys(DungeonData).map(dungeon => `<option value="${dungeon}">${dungeon}</option>`).join('')}
										</select>
									</div>
									<div>
										<label>${isCN ? '難度' : 'Difficulty'}:</label>
										<select id="difficultySelect" style="width: 100%; padding: 0.5rem; border-radius: 0.25rem; border: 0.0625rem solid #3a3d5c; background-color: #1a1a28; color: #c8d0f0;">
										</select>
									</div>
									<div>
										<label>${isCN ? '用時(分鐘)' : 'Time (minutes)'}:</label>
										<input type="number" id="timeInput" min="1" value="10" style="width: 100%; padding: 0.5rem; border-radius: 0.25rem; border: 0.0625rem solid #3a3d5c; background-color: #1a1a28; color: #c8d0f0;">
									</div>
									<div>
										<label>${isCN ? '戰鬥BUFF(0-20級)' : 'Combat Buff (0-20)'}:</label>
										<input type="number" id="buffInput" min="0" max="20" value="0" style="width: 100%; padding: 0.5rem; border-radius: 0.25rem; border: 0.0625rem solid #3a3d5c; background-color: #1a1a28; color: #c8d0f0;">
									</div>
								</div>
							</div>

							<!-- 價格設定部分 -->
							<div style="background: #1e1e2f; padding: 0.9375rem; border-radius: 0.5rem; border: 0.0625rem solid #2c2e45">
							<h3 style="margin-top: 0;">${isCN ? '價格設定' : 'Price Settings'}</h3>
							<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(12.5rem, 1fr)); gap: 0.9375rem;">
									<div>
										<label>${isCN ? '入口鑰匙成本(Ask)' : 'Entry Key Cost (Ask)'}:</label>
										<input type="number" id="entryKeyAsk" min="0" style="width: 100%; padding: 0.5rem; border-radius: 0.25rem; border: 0.0625rem solid #3a3d5c; background-color: #1a1a28; color: #c8d0f0;">
									</div>
									<div>
										<label>${isCN ? '入口鑰匙成本(Bid)' : 'Entry Key Cost (Bid)'}:</label>
										<input type="number" id="entryKeyBid" min="0" style="width: 100%; padding: 0.5rem; border-radius: 0.25rem; border: 0.0625rem solid #3a3d5c; background-color: #1a1a28; color: #c8d0f0;">
									</div>
									<div>
										<label>${isCN ? '開箱鑰匙成本(Ask)' : 'Chest Key Cost (Ask)'}:</label>
										<input type="number" id="chestKeyAsk" min="0" style="width: 100%; padding: 0.5rem; border-radius: 0.25rem; border: 0.0625rem solid #3a3d5c; background-color: #1a1a28; color: #c8d0f0;">
									</div>
									<div>
										<label>${isCN ? '開箱鑰匙成本(Bid)' : 'Chest Key Cost (Bid)'}:</label>
										<input type="number" id="chestKeyBid" min="0" style="width: 100%; padding: 0.5rem; border-radius: 0.25rem; border: 0.0625rem solid #3a3d5c; background-color: #1a1a28; color: #c8d0f0;">
									</div>
									<div>
										<label>${isCN ? '食物成本(每天)' : 'Food Cost (per day)'}:</label>
										<input type="number" id="foodCost" min="0" value="10000000" style="width: 100%; padding: 0.5rem; border-radius: 0.25rem; border: 0.0625rem solid #3a3d5c; background-color: #1a1a28; color: #c8d0f0;">
									</div>
								</div>
							</div>

							<!-- 計算按鈕 -->
							<button id="calculateBtn" style="padding: 0.75rem; background: #1e3a1e; color: #90ee90; border: 0.0625rem solid #4CAF50; border-radius: 0.25rem; cursor: pointer; font-size: 1rem;">
								${isCN ? '計算利潤' : 'Calculate Profit'}
							</button>

							<!-- 結果顯示部分 -->
							<div style="background: #1e1e2f; padding: 0.9375rem; border-radius: 0.5rem; border: 0.0625rem solid #2c2e45; display: none;" id="resultSection">
								<h3 style="margin-top: 0;">${isCN ? '計算結果' : 'Calculation Results'}</h3>

								<div style="margin-bottom: 0.9375rem;">
									<h4>${isCN ? '期望天利潤' : 'Expected Daily Profit'}:</h4>
									<div id="profitRange" style="font-size: 1.125rem; font-weight: bold; color: #2E7D32;"></div>
								</div>

								<div style="display: flex; gap: 1.25rem; flex-wrap: wrap;">
								<div style="flex: 1; min-width: 15.625rem;">
									<h4>${isCN ? '每天獲得' : 'Daily Loot'}:</h4>
									<div id="chestResults" style="background: #131419; padding: 0.625rem; border-radius: 0.25rem; border: 0.0625rem solid #2c2e45;"></div>
								</div>

								<div style="flex: 1; min-width: 15.625rem;">
									<h4>${isCN ? '所需鑰匙' : 'Keys Required'}:</h4>
									<div id="keyResults" style="background: #131419; padding: 0.625rem; border-radius: 0.25rem; border: 0.0625rem solid #2c2e45;"></div>
								</div>
							</div>
							</div>
						</div>
					</div>
                    <div style="flex: 1; padding: 1.25rem; overflow-y: auto; display: none;" id="EdibleToolsSettingPage">
                        <h2 style="text-align: center;">${isCN ? '外掛設定' : 'Plugin Settings'}</h2>
                    </div>
                </div>
            </div>
            <button id="closeSettingsBtn" style="position: absolute; top: 0.625rem; right: 0.625rem; padding: 0.625rem 1.25rem; background-color: #3d2c2c; color: #ff9999; border: 0.0625rem solid #c0392b; border-radius: 0.25rem; cursor: pointer;">關閉</button>
            `;
        settingsContainer.innerHTML = Edible_Tools_HTML;
        document.body.appendChild(settingsContainer);

        const marketDataPage = document.getElementById('showMarketDataPage');
        const OpenChestDataPage = document.getElementById('OpenChestDataPage');
        const EnhancementDataPage = document.getElementById('EnhancementDataPage');
        const DungeonToolsPage = document.getElementById('DungeonToolsPage');
        const EdibleToolsSettingPage = document.getElementById('EdibleToolsSettingPage');
        let currentPage = 1; // 當前頁碼
        let rowsPerPage = 20; // 每頁顯示的行數

        function showMarketData() {
            marketDataPage.style.display = 'block';
            OpenChestDataPage.style.display = 'none';
            EnhancementDataPage.style.display = 'none';
            DungeonToolsPage.style.display = 'none';
            EdibleToolsSettingPage.style.display = 'none';

            const tableBody = document.getElementById('marketDataTableBody');
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = startIndex + rowsPerPage;
            const paginatedData = market_List_Data.slice(startIndex, endIndex);

            tableBody.innerHTML = paginatedData.map((row, index) => {

                // 建立圖示
                let svgIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svgIcon.setAttribute('width', '1.25rem');
                svgIcon.setAttribute('height', '1.25rem');
                svgIcon.style.marginRight = '0.625rem';
                svgIcon.style.verticalAlign = 'middle';

                let useElement = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                try {
                    let iconId = row.itemHrid.split('/').pop();
                    useElement.setAttribute('href', `${item_icon_url}#${iconId}`);
                } catch (error) {
                    console.error(`無法找到物品的圖示ID:`, error);
                    useElement.setAttribute('href', `${item_icon_url}#coin`);
                }
                svgIcon.appendChild(useElement);

                let translatedName = isCN && e2c[row.itemName] ? e2c[row.itemName] : row.itemName;
                if (row.enhancementLevel > 0) {
                    translatedName = `${translatedName} +${row.enhancementLevel}`;
                }
                let itemNameWithIcon = `${svgIcon.outerHTML}${translatedName}`;

                const globalIndex = startIndex + index; // 計算全域性索引
                return `
                <tr data-index="${globalIndex}">
                    <td>${row.id}</td>
                    <td>${row.characterID}</td>
                    <td>${tran_market_list[row.status] || row.status}</td>
                    <td>${row.isSell ? (isCN ? '出售' : 'Sell') : (isCN ? '收購' : 'Buy')}</td>
                    <td>${itemNameWithIcon}</td>
                    <td>${(row.orderQuantity).toLocaleString()}</td>
                    <td>${(row.filledQuantity).toLocaleString()}</td>
                    <td>${(row.price).toLocaleString()}</td>
                    <td>${(row.price * row.filledQuantity).toLocaleString()}</td>
                    <td>${row.format_lastUpdated}</td>
                    <td><button class="delete-btn">${isCN ? '刪除' : 'Delete'}</button></td>
                </tr>
                `;
            }).join('');

            updatePaginationControls();
            attachDeleteListeners();
        }
        // 新增分頁控制元件
        const paginationControls = document.createElement('div');
        paginationControls.style.textAlign = 'center';
        paginationControls.style.marginTop = '1.25rem';
        paginationControls.innerHTML = `
            <button id="prevPageBtn" style="padding: 0.3125rem 0.625rem; margin: 0 0.3125rem;">上一頁</button>
            <span id="currentPageDisplay">第 ${currentPage} 頁</span>
            <button id="nextPageBtn" style="padding: 0.3125rem 0.625rem; margin: 0 0.3125rem;">下一頁</button>
            <label style="margin-left: 0.625rem;">
                每頁顯示
                <input id="rowsPerPageInput" type="number" value="${rowsPerPage}" min="1" style="width: 3.125rem; text-align: center;">
                行
            </label>
            <label style="margin-left: 0.625rem;">
                跳轉到
                <input id="gotoPageInput" type="number" min="1" style="width: 3.125rem; text-align: center;">
                頁
                <button id="gotoPageBtn" style="padding: 0.3125rem 0.625rem; margin-left: 0.3125rem;">跳轉</button>
            </label>
        `;

        marketDataPage.appendChild(paginationControls);

        // 更新分頁控制元件狀態
        function updatePaginationControls() {
            const totalPages = Math.ceil(market_List_Data.length / rowsPerPage);
            document.getElementById('currentPageDisplay').textContent = `第 ${currentPage} 頁 / 共 ${totalPages} 頁`;

            document.getElementById('prevPageBtn').disabled = currentPage === 1;
            document.getElementById('nextPageBtn').disabled = currentPage === totalPages;
        }

        // 繫結分頁控制元件事件
        document.getElementById('prevPageBtn').addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                showMarketData();
            }
        });

        document.getElementById('nextPageBtn').addEventListener('click', () => {
            const totalPages = Math.ceil(market_List_Data.length / rowsPerPage);
            if (currentPage < totalPages) {
                currentPage++;
                showMarketData();
            }
        });

        document.getElementById('rowsPerPageInput').addEventListener('change', (event) => {
            const newRowsPerPage = parseInt(event.target.value, 10);
            if (newRowsPerPage > 0) {
                rowsPerPage = newRowsPerPage;
                currentPage = 1; // 重置到第一頁
                showMarketData();
            }
        });
        document.getElementById('gotoPageBtn').addEventListener('click', () => {
            const gotoPageInput = document.getElementById('gotoPageInput');
            const totalPages = Math.ceil(market_List_Data.length / rowsPerPage);
            let page = parseInt(gotoPageInput.value, 10);
            if (isNaN(page) || page < 1) page = 1;
            if (page > totalPages) page = totalPages;
            currentPage = page;
            showMarketData();
        });
        function ShowOpenChestData() {
            marketDataPage.style.display = 'none';
            OpenChestDataPage.style.display = 'block';
            EnhancementDataPage.style.display = 'none';
            DungeonToolsPage.style.display = 'none';
            EdibleToolsSettingPage.style.display = 'none';
        }

        function ShowEnhancementData() {
            marketDataPage.style.display = 'none';
            OpenChestDataPage.style.display = 'none';
            EnhancementDataPage.style.display = 'block';
            DungeonToolsPage.style.display = 'none';
            EdibleToolsSettingPage.style.display = 'none';
        }

        function showDungeonTools() {
            marketDataPage.style.display = 'none';
            OpenChestDataPage.style.display = 'none';
            EnhancementDataPage.style.display = 'none';
            DungeonToolsPage.style.display = 'block';
            EdibleToolsSettingPage.style.display = 'none';
        }

        function ShowEdibleToolsSetting() {
            marketDataPage.style.display = 'none';
            OpenChestDataPage.style.display = 'none';
            EnhancementDataPage.style.display = 'none';
            DungeonToolsPage.style.display = 'none';
            EdibleToolsSettingPage.style.display = 'block';
        }

        showMarketData();

        // 刪除單行
        function attachDeleteListeners() {
            document.querySelectorAll('.delete-btn').forEach(button => {
                button.addEventListener('click', (event) => {
                    const row = event.target.closest('tr');
                    const index = parseInt(row.getAttribute('data-index'), 10);
                    market_List_Data.splice(index, 1);

                    GM_setValue('market_list', JSON.stringify(market_List_Data));
                    showMarketData();
                });
            });
        }

        attachDeleteListeners();// 初始繫結刪除按鈕事件

        // 排序功能
        let sortOrder = { field: null, direction: 1 };// 1 是升序，-1 是降序

        function sortTable(column) {
            const field = column.getAttribute('data-sort');
            const direction = sortOrder.field === field && sortOrder.direction === 1 ? -1 : 1;// 切換排序方向

            market_List_Data.sort((a, b) => {
                if (field === 'total') {
                    return (a.price * a.filledQuantity - b.price * b.filledQuantity) * direction;
                }
                if (typeof a[field] === 'string') {
                    return (a[field].localeCompare(b[field])) * direction;
                }
                return (a[field] - b[field]) * direction;
            });

            // 更新排序狀態
            document.querySelectorAll('th').forEach(th => {
                th.classList.remove('sort-asc', 'sort-desc');
            });
            column.classList.add(direction === 1 ? 'sort-asc' : 'sort-desc');

            sortOrder = { field, direction };

            showMarketData();
            attachDeleteListeners();
        }
        //管理本地快取
        function showLocalStorageStats() {
            const overlay = document.createElement('div');
            overlay.id = 'ls-stats-overlay';
            overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 9999;
        `;
            document.body.appendChild(overlay);

            const modal = document.createElement('div');
            modal.id = 'ls-stats-modal';
            modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 80%;
            max-width: 50rem;
            background: #131419;
            border-radius: 0.5rem;
            border: 0.0625rem solid #98a7e9;
            box-shadow: 0 0.25rem 1.25rem rgba(0,0,0,0.6);
            z-index: 10000;
            font-family: Arial, sans-serif;
            color: #c8d0f0;
        `;
            function getStringSize(str) {
                if (!str) return 0;
                return new Blob([str]).size;
            }

            function getLocalStorageStats() {
                const stats = [];
                let totalSize = 0;

                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    const value = localStorage.getItem(key);
                    const size = getStringSize(key) + getStringSize(value);

                    stats.push({
                        key: key,
                        size: size,
                        value: value
                    });

                    totalSize += size;
                }

                stats.sort((a, b) => b.size - a.size);

                return {
                    items: stats,
                    totalSize: totalSize
                };
            }

            // 格式化位元組大小
            function formatBytes(bytes, decimals = 2) {
                if (bytes === 0) return '0 Bytes';

                const k = 1024;
                const dm = decimals < 0 ? 0 : decimals;
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];

                const i = Math.floor(Math.log(bytes) / Math.log(k));

                return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
            }
            const stats = getLocalStorageStats();

            modal.innerHTML = `
            <div id="ls-stats-header" style="background: #1e1e2f; color: #98a7e9; padding: 0.9375rem; border-radius: 0.5rem 0.5rem 0 0; display: flex; justify-content: space-between; align-items: center; border-bottom: 0.0625rem solid #2c2e45;">
                <h3 style="margin: 0;">LocalStorage 佔用情況 - ${window.location.hostname}</h3>
                <button id="ls-stats-close" style="background: none; border: none; color: white; font-size: 1.25rem; cursor: pointer;">&times;</button>
            </div>
            <div id="ls-stats-content" style="padding: 0.9375rem; max-height: 70vh; overflow-y: auto;">
                <table id="ls-stats-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="background: #1e1e2f; color: #98a7e9; padding: 0.625rem; text-align: left; border-bottom: 0.0625rem solid #2c2e45;">鍵名</th>
                            <th style="background: #1e1e2f; color: #98a7e9; padding: 0.625rem; text-align: left; border-bottom: 0.0625rem solid #2c2e45;">佔用空間</th>
                            <th style="background: #1e1e2f; color: #98a7e9; padding: 0.625rem; text-align: left; border-bottom: 0.0625rem solid #2c2e45;">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="total-row" style="font-weight: bold; background-color: #1a1a28;">
                            <td style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45;">總計</td>
                            <td class="size-info" style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45; font-family: monospace;">${formatBytes(stats.totalSize)}</td>
                            <td style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45;">
                                <button class="delete-btn" id="clear-all-btn" style="background: #e74c3c; color: white; border: none; padding: 0.3125rem 0.625rem; border-radius: 0.25rem; cursor: pointer;">清空全部</button>
                            </td>
                        </tr>
                        ${stats.items.map(item => {
                const percentage = ((item.size / stats.totalSize) * 100).toFixed(2);
                return `
                                <tr>
                                    <td style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45;" title="${item.key}">${item.key.length > 30 ? item.key.substring(0, 30) + '...' : item.key}</td>
                                    <td class="size-info" style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45; font-family: monospace;">${formatBytes(item.size)} (${percentage}%)</td>
                                    <td style="padding: 0.625rem; border-bottom: 0.0625rem solid #2c2e45;">
                                        <button class="delete-btn" data-key="${item.key}" style="background: #e74c3c; color: white; border: none; padding: 0.3125rem 0.625rem; border-radius: 0.25rem; cursor: pointer;">刪除</button>
                                    </td>
                                </tr>
                            `;
            }).join('')}
                    </tbody>
                </table>
            </div>
        `;

            document.body.appendChild(modal);

            document.getElementById('ls-stats-close').addEventListener('click', closeStats);
            overlay.addEventListener('click', closeStats);

            document.querySelectorAll('.delete-btn[data-key]').forEach(btn => {
                btn.addEventListener('click', function() {
                    const key = this.getAttribute('data-key');
                    if (confirm(`確定要刪除鍵 "${key}" 嗎？`)) {
                        localStorage.removeItem(key);
                        closeStats();
                        showLocalStorageStats();
                    }
                });
            });

            document.getElementById('clear-all-btn').addEventListener('click', function() {
                if (confirm('確定要清空全部 LocalStorage 資料嗎？此操作不可撤銷！')) {
                    localStorage.clear();
                    closeStats();
                    showLocalStorageStats();
                }
            });

            function closeStats() {
                if (document.getElementById('ls-stats-modal')) {
                    document.body.removeChild(document.getElementById('ls-stats-modal'));
                }
                if (document.getElementById('ls-stats-overlay')) {
                    document.body.removeChild(document.getElementById('ls-stats-overlay'));
                }
            }
        }
        //側邊欄顯隱按鈕
        const sidebar = settingsContainer.querySelector('div[style*="width: 200px"]');

        const toggleSidebarBtn = document.createElement('button');
        toggleSidebarBtn.textContent = '☰';
        toggleSidebarBtn.id = 'toggleSidebarBtn';
        toggleSidebarBtn.style.position = 'absolute';
        toggleSidebarBtn.style.left = '0.625rem';
        toggleSidebarBtn.style.bottom = '0.625rem';
        toggleSidebarBtn.style.zIndex = '10001';
        toggleSidebarBtn.style.background = '#2c2e45';
        toggleSidebarBtn.style.color = '#98a7e9';
        toggleSidebarBtn.style.border = 'none';
        toggleSidebarBtn.style.borderRadius = '50%';
        toggleSidebarBtn.style.width = '2.5rem';
        toggleSidebarBtn.style.height = '2.5rem';
        toggleSidebarBtn.style.fontSize = '1.375rem';
        toggleSidebarBtn.style.boxShadow = '0 0.125rem 0.5rem rgba(0,0,0,0.2)';
        toggleSidebarBtn.style.cursor = 'pointer';

        let sidebarVisible = true;

        toggleSidebarBtn.onclick = function() {
            sidebarVisible = !sidebarVisible;
            sidebar.style.display = sidebarVisible ? '' : 'none';
        };

        settingsContainer.appendChild(toggleSidebarBtn);

        document.querySelectorAll('th').forEach(th => {
            th.addEventListener('click', () => {
                sortTable(th);
            });
        });
        const MARKET_API_OPTIONS = [
            {
                name: isCN ? '官方API 更新間隔1小時' : 'Official API',
                value: 'official'
            },
            {
                name: isCN ? '[失效?]日均價API(GitHub) 更新間隔24小時' : '[INV?]medianmarket(24h)',
                value: 'github1'
            },
            {
                name: isCN ? '[失效?]最新價API(GitHub) 更新間隔1小時' : '[INV?]Latest Price(1h)',
                value: 'github2'
            }
        ];
        EdibleToolsSettingPage.innerHTML = `
            <h2 style="text-align: center;">${isCN ? '外掛設定' : 'Plugin Settings'}</h2>
            <form id="edibleToolsSettingForm" style="display: flex; flex-direction: column; gap: 0.75rem; max-width: 21.875rem; margin: 0 auto;">
                <label>
                    <span>${isCN ? '強制外掛語言' : 'Force Plugin Language'}：</span>
                    <select name="forceLanguage">
                        <option value="none" ${Edible_Tools_Set.forceLanguage === 'none' ? 'selected' : ''}>${isCN ? '不強制' : 'No force'}</option>
                        <option value="zh" ${Edible_Tools_Set.forceLanguage === 'zh' ? 'selected' : ''}>${isCN ? '中文' : 'Chinese'}</option>
                        <option value="en" ${Edible_Tools_Set.forceLanguage === 'en' ? 'selected' : ''}>${isCN ? '英文' : 'English'}</option>
                    </select>
                </label>
                <label>
                    <span>${isCN ? '市場API來源' : 'Market API Source'}：</span>
                    <select name="marketApiSource">
                        ${MARKET_API_OPTIONS.map(opt => `
                            <option value="${opt.value}" ${Edible_Tools_Set.marketApiSource === opt.value ? 'selected' : ''}>${opt.name}</option>
                        `).join('')}
                    </select>
                </label>
                <label>
                    <input type="checkbox" name="cloakPrice" ${Edible_Tools_Set.enableCloakPrice ? 'checked' : ''}>
                    ${isCN ? '披風價格等價保護石' : 'Cloak price equals Protection Mirror'}
                </label>
                <label>
                    <input type="checkbox" name="RareItemExpectPrice" ${Edible_Tools_Set.enableRareItemExpectPrice ? 'checked' : ''}>
                    ${isCN ? '開箱期望計算成品期望' : 'Chest expected value includes rare items'}
                </label>
                <label>
                    <input type="checkbox" name="HideOldVersionChestData" ${Edible_Tools_Set.enableHideOldVersionChestData ? 'checked' : ''}>
                    ${isCN ? '隱藏開箱統計中的老版本開箱資料' : 'Hide old version chest data'}
                </label>
                <label>
                    <input type="checkbox" name="HideChestExpectation" ${Edible_Tools_Set.enableHideChestExpectation ? 'checked' : ''}>
                    ${isCN ? '隱藏開箱統計期望相關資料' : 'Hide expectation data in chest records'}
                </label>
                <label>
                    <input type="checkbox" name="MarketTaxCalculation" ${Edible_Tools_Set.enableMarketTaxCalculation ? 'checked' : ''}>
                    ${isCN ? '利潤計算包含5%市場稅' : 'Include 5% market tax in profit calculation'}
                </label>
                <label>
                    <input type="checkbox" name="PointCombatLevel" ${Edible_Tools_Set.enablePointCombatLevel ? 'checked' : ''}>
                    ${isCN ? '戰鬥等級顯示小數部分' : 'Display the decimal part of the battle level'}
                </label>
                <label>
                    <input type="checkbox" name="ShowToast" ${Edible_Tools_Set.enableShowToast ? 'checked' : ''}>
                    ${isCN ? '啟用訊息提示' : 'Enable Show Toast'}
                </label>
                <label>
                    <input type="checkbox" name="CowbellPrice" ${Edible_Tools_Set.enableCowbellPrice ? 'checked' : ''}>
                    ${isCN ? '牛鈴價格賦值' : 'Cowbell Price Assignment'}
                </label>
                <label>
                    <span>${isCN ? '食物警告時間閾值（小時）' : 'Food Warning Threshold (hours)'}：</span>
                    <input type="number" name="foodWarningThreshold" value="${Edible_Tools_Set.foodWarningThreshold}" min="1" max="8760" style="width: 5rem;">
                </label>
            </form>
            <div style="text-align:center;color:#6b7ab0;font-size:0.75rem;">${isCN ? '設定會自動儲存並立即生效' : 'Settings are saved automatically and take effect immediately'}</div>
        `;

        document.getElementById('edibleToolsSettingForm').addEventListener('change', function(e) {
            const form = e.target.form;
            Edible_Tools_Set = {
                enableCloakPrice: form.cloakPrice.checked,
                enableRareItemExpectPrice: form.RareItemExpectPrice.checked,
                enableHideOldVersionChestData: form.HideOldVersionChestData.checked,
                enableHideChestExpectation: form.HideChestExpectation.checked,
                enableMarketTaxCalculation: form.MarketTaxCalculation.checked,
                enablePointCombatLevel: form.PointCombatLevel.checked,
                enableCowbellPrice: form.CowbellPrice.checked,
                marketApiSource: form.marketApiSource.value,
                forceLanguage: form.forceLanguage.value,
                enableShowToast:form.ShowToast.checked,
                foodWarningThreshold: parseInt(form.foodWarningThreshold.value) || 12
            };
            localStorage.setItem('Edible_Tools_Set', JSON.stringify(Edible_Tools_Set));
            if (e.target.name === 'forceLanguage') {
                location.reload();
            }
        });

        // 切換資料庫頁面
        document.getElementById('showMarketDataBtn').addEventListener('click', showMarketData);
        document.getElementById('showOpenChestDataBtn').addEventListener('click', ShowOpenChestData);
        document.getElementById('showEnhancementDataBtn').addEventListener('click', ShowEnhancementData);
        document.getElementById('showDungeonToolsBtn').addEventListener('click', showDungeonTools);
        document.getElementById('showLocalStorageStatsBtn').addEventListener('click', showLocalStorageStats);
        document.getElementById('showEdibleToolsSettingBtn').addEventListener('click', ShowEdibleToolsSetting);

        // 關閉按鈕
        document.getElementById('closeSettingsBtn').addEventListener('click', () => {
            document.body.removeChild(settingsContainer);
        });

        // 刪除過時市場資料
        document.getElementById('deleteOldDataBtn').addEventListener('click', () => {
            const userInput = prompt("請輸入要刪除之前的日期 (格式：YYYY-MM-DD)", "");

            if (!userInput) return;

            // 轉換使用者輸入的日期為 Date 物件
            const userDate = new Date(userInput);

            if (isNaN(userDate)) {
                alert("無效的日期格式，請使用 YYYY-MM-DD");
                return;
            }

            let market_list = JSON.parse(GM_getValue('market_list', '[]'));

            // 過濾出所有在使用者選擇日期之前的訂單
            const filteredMarketList = market_list.filter(order => {
                const orderDate = new Date(order.lastUpdated);
                return orderDate >= userDate;
            });

            // 更新並儲存新的資料
            GM_setValue('market_list', JSON.stringify(filteredMarketList));

            alert("刪除成功，已清理日期之前的資料。");
            document.body.removeChild(settingsContainer);
        });

        document.getElementById('deleteSpecificStatusDataBtn').addEventListener('click', () => {
            let market_list = JSON.parse(GM_getValue('market_list', '[]'));
            const statusToDelete = ["/market_listing_status/active","進行中","/market_listing_status/cancelled","取消","/market_listing_status/expired","超時"];
            const deleteCount = market_list.filter(order => statusToDelete.includes(order.status)).length;

            if (deleteCount === 0) {
                alert("沒有需要刪除的資料。");
                return;
            }

            const isConfirmed = confirm(`即將刪除 ${deleteCount} 條資料，是否繼續？`);
            if (!isConfirmed) {
                return;
            }

            const filteredMarketList = market_list.filter(order => !statusToDelete.includes(order.status));

            GM_setValue('market_list', JSON.stringify(filteredMarketList));

            alert("刪除成功");

            document.body.removeChild(settingsContainer);
        });

        function updateDifficultyOptions() {
            const dungeonSelect = document.getElementById('dungeonSelect');
            const difficultySelect = document.getElementById('difficultySelect');
            const selectedDungeon = dungeonSelect.value;
            const maxDifficulty = DungeonData[selectedDungeon].maxDifficulty;

            difficultySelect.innerHTML = '';

            for (let i = 0; i <= maxDifficulty; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = `T${i}`;
                difficultySelect.appendChild(option);
            }
        }

        function updateKeyCosts() {
            const dungeonSelect = document.getElementById('dungeonSelect');
            const selectedDungeon = dungeonSelect.value;
            const dungeonInfo = DungeonData[selectedDungeon];

            const entryKeyName = item_hrid_to_name[dungeonInfo.keyItemHrid];

            document.getElementById('entryKeyAsk').value = marketData.market[entryKeyName]?.ask || 0;
            document.getElementById('entryKeyBid').value = marketData.market[entryKeyName]?.bid || 0;

            const firstChestHrid = dungeonInfo.rewardDropTable[0].itemHrid;
            const chestName = item_hrid_to_name[firstChestHrid];
            const keyName = chestName.replace(' Chest', ' Chest Key');

            document.getElementById('chestKeyAsk').value = marketData.market[keyName]?.ask || 0;
            document.getElementById('chestKeyBid').value = marketData.market[keyName]?.bid || 0;
        }

        function calculateExpectedDrops() {
            const dungeonSelect = document.getElementById('dungeonSelect');
            const difficultySelect = document.getElementById('difficultySelect');
            const timeInput = document.getElementById('timeInput');
            const buffInput = document.getElementById('buffInput');

            const selectedDungeon = dungeonSelect.value;
            const difficulty = parseInt(difficultySelect.value);
            const timePerRun = parseInt(timeInput.value);
            const combatBuff = parseInt(buffInput.value);
            const buffMultiplier = 1.195 + 0.005 * combatBuff;

            const dungeonInfo = DungeonData[selectedDungeon];
            const runsPerDay = 1440 / timePerRun;

            let results = {
                chests: {},
                entryKeys: runsPerDay * buffMultiplier,
                chestKeys: 0
            };

            dungeonInfo.rewardDropTable.forEach(drop => {
                const baseRate = drop.dropRate || 0;
                const ratePerTier = drop.dropRatePerDifficultyTier || 0;
                const minCount = drop.minCount || 1;
                const maxCount = drop.maxCount || 1;

                let dropRate = Math.max(baseRate + (difficulty * ratePerTier), 0);
                dropRate = Math.min(dropRate * (1 + 0.1 * difficulty), 1);

                const avgCount = (minCount + maxCount) / 2;

                const expectedCount = dropRate * avgCount * buffMultiplier * runsPerDay;

                const itemName = item_hrid_to_name[drop.itemHrid];
                results.chests[itemName] = expectedCount;

                results.chestKeys += expectedCount;
            });

            return results;
        }

        function calculateProfit(dropResults) {
            const entryKeyAsk = parseFloat(document.getElementById('entryKeyAsk').value);
            const entryKeyBid = parseFloat(document.getElementById('entryKeyBid').value);
            const chestKeyAsk = parseFloat(document.getElementById('chestKeyAsk').value);
            const chestKeyBid = parseFloat(document.getElementById('chestKeyBid').value);
            const foodCost = parseFloat(document.getElementById('foodCost').value);

            let minProfit = 0;
            let maxProfit = 0;

            Object.keys(dropResults.chests).forEach(chestName => {
                const count = dropResults.chests[chestName];
                const chestAsk = formattedChestDropData[chestName]?.期望產出Ask || 0;
                const chestBid = formattedChestDropData[chestName]?.期望產出Bid || 0;

                minProfit += chestBid * count;
                maxProfit += chestAsk * count;
            });

            minProfit -= entryKeyAsk * dropResults.entryKeys;
            minProfit -= chestKeyAsk * dropResults.chestKeys;

            maxProfit -= entryKeyBid * dropResults.entryKeys;
            maxProfit -= chestKeyBid * dropResults.chestKeys;

            minProfit -= foodCost;
            maxProfit -= foodCost;

            return {
                min: minProfit,
                max: maxProfit
            };
        }

        function displayResults(dropResults, profit) {
            const resultSection = document.getElementById('resultSection');
            const profitRange = document.getElementById('profitRange');
            const chestResults = document.getElementById('chestResults');
            const keyResults = document.getElementById('keyResults');

            // 顯示利潤範圍
            profitRange.textContent = `${formatPrice(profit.min)} ~ ${formatPrice(profit.max)}`;

            // 顯示箱子結果
            chestResults.innerHTML = '';
            Object.keys(dropResults.chests).forEach(chestName => {
                const count = dropResults.chests[chestName];
                const div = document.createElement('div');
                div.style.padding = '0.3125rem 0';
                div.style.borderBottom = '0.0625rem solid #eee';
                div.textContent = `${isCN ? e2c[chestName] : chestName}: ${count.toFixed(1)}`;
                chestResults.appendChild(div);
            });

            // 顯示鑰匙需求
            keyResults.innerHTML = '';
            const entryDiv = document.createElement('div');
            entryDiv.style.padding = '0.3125rem 0';
            entryDiv.style.borderBottom = '0.0625rem solid #eee';
            const entryKeyName = item_hrid_to_name[DungeonData[document.getElementById('dungeonSelect').value].keyItemHrid];
            entryDiv.textContent = `${isCN ? e2c[entryKeyName] : entryKeyName}: ${(dropResults.entryKeys).toFixed(1)}`;
            keyResults.appendChild(entryDiv);

            const chestDiv = document.createElement('div');
            chestDiv.style.padding = '0.3125rem 0';
            chestDiv.textContent = `${isCN ? '開箱鑰匙' : 'Chest Keys'}: ${(dropResults.chestKeys).toFixed(1)}`;
            keyResults.appendChild(chestDiv);

            // 顯示結果區域
            resultSection.style.display = 'block';
        }

        // 初始化地牢計算器
        document.getElementById('dungeonSelect').addEventListener('change', function() {
            updateDifficultyOptions();
            updateKeyCosts();
        });

        document.getElementById('calculateBtn').addEventListener('click', function() {
            const dropResults = calculateExpectedDrops();
            const profit = calculateProfit(dropResults);
            displayResults(dropResults, profit);
        });
        updateDifficultyOptions();
        updateKeyCosts();
        // 表格樣式
        const style = document.createElement('style');
        style.innerHTML = `
    .marketList-table {
        width: 100%;
        border-collapse: collapse;
    }

    .marketList-table, .marketList-table th, .marketList-table td {
        border: 0.0625rem solid #2c2e45;
    }

    .marketList-table th, .marketList-table td {
        padding: 0.625rem;
        text-align: center;
    }

    .marketList-table th {
        background-color: #1e1e2f;
        color: #98a7e9;
        cursor: pointer;
    }

    .marketList-table th.sort-asc::after {
        content: ' ▲';
    }

    .marketList-table th.sort-desc::after {
        content: ' ▼';
    }
    `;
        document.head.appendChild(style);
    }

function updateMarketData() {
    setInterval(() => {
        const MWImarketData = JSON.parse(localStorage.getItem('MWITools_marketAPI_json')) || { marketData: {} };
        let updated = false;

        for (const itemName in specialItemPrices) {
            if (!specialItemPrices.hasOwnProperty(itemName)) continue;
            const { ask, bid } = specialItemPrices[itemName];

            if (MWImarketData.marketData) {
                const itemHrid = item_name_to_hrid[itemName];
                if (!itemHrid) continue;
                MWImarketData.marketData[itemHrid] = MWImarketData.marketData[itemHrid] || {};
                const entry = MWImarketData.marketData[itemHrid];
                if (!entry["0"]) {
                    entry["0"] = { a: ask, b: bid };
                    updated = true;
                } else {
                    if (entry["0"].a === -1) { entry["0"].a = ask; updated = true; }
                    if (entry["0"].b === -1) { entry["0"].b = bid; updated = true; }
                }
            } else if (MWImarketData.market) {
                if (!MWImarketData.market[itemName]) {
                    MWImarketData.market[itemName] = { ask, bid };
                    updated = true;
                } else {
                    if (MWImarketData.market[itemName].ask === -1) { MWImarketData.market[itemName].ask = ask; updated = true; }
                    if (MWImarketData.market[itemName].bid === -1) { MWImarketData.market[itemName].bid = bid; updated = true; }
                }
            }
        }

        if (updated) {
            localStorage.setItem('MWITools_marketAPI_json', JSON.stringify(MWImarketData));
        }
    }, 60 * 1000);
}

updateMarketData();
})();