// ==UserScript==
// @name         迷宮勝率計算器
// @name:en      Labyrinth Clear Rate Calculator
// @name:zh-CN   迷宮勝率計算器
// @namespace    http://tampermonkey.net/
// @version      1.5.13
// @description  Show skilling/combat room clear chance and expected clear seconds (including failed runs) on each labyrinth tile.
// @description:en  Show skilling/combat room clear chance and expected clear seconds (including failed runs) on each labyrinth tile.
// @description:zh-CN  在迷宮每個房間格子上顯示生活/戰鬥房間勝率與期望耗時（包含失敗場次）。
// @author       dakonglong
// @license      MIT
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://test.milkywayidlecn.com/*
// @match        https://shykai.github.io/MWICombatSimulatorTest/dist/*
// @grant        none
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js
// @downloadURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/Labyrinth Clear Rate Calculator.user.js
// @updateURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/Labyrinth Clear Rate Calculator.user.js
// ==/UserScript==

(function () {
    "use strict";

    if (window.__MWI_LAB_CLEAR_RATE_OVERLAY__) {
        return;
    }
    window.__MWI_LAB_CLEAR_RATE_OVERLAY__ = true;
    window.__MWI_LAB_CLEAR_RATE_OVERLAY_VERSION__ = "1.5.13";

    const ROOM_DURATION_SECONDS = 120;
    const ROOM_ENTRY_SECONDS = 1;
    const BASE_ACTION_SECONDS = 10;
    const BASE_ENHANCING_ACTION_SECONDS = 8;
    const LABYRINTH_ENHANCING_BASE_TARGET_LEVEL = 3;
    const LABYRINTH_ENHANCING_LEVEL_STEP = 50;
    const LABYRINTH_COMBAT_ROOM_TYPE = "/labyrinth_room_types/combat";
    const LABYRINTH_SKILLING_ROOM_TYPE = "/labyrinth_room_types/skilling";
    const LABYRINTH_TREASURE_ROOM_TYPE = "/labyrinth_room_types/treasure";
    const LABYRINTH_DESCEND_ROOM_TYPE = "/labyrinth_room_types/descend";
    const DEFAULT_COMBAT_SIM_TRIALS = 100;
    const DEFAULT_AUTOMATION_COMBAT_SIM_TRIALS = 500;
    const DEFAULT_AUTOMATION_TARGET_WIN_RATE = 70;
    const MIN_COMBAT_SIM_TRIALS = 1;
    const MAX_COMBAT_SIM_TRIALS = 2000;
    const COMBAT_SIM_TRIALS_STORAGE_KEY = "mwi_lab_clear_rate_combat_trials";
    const AUTOMATION_COMBAT_SIM_TRIALS_STORAGE_KEY = "mwi_lab_auto_combat_trials";
    const AUTOMATION_TARGET_WIN_RATE_STORAGE_KEY = "mwi_lab_auto_target_win_rate";
    const COMBAT_SIM_CACHE_LIMIT = 256;
    const COMBAT_ONE_SECOND_NS = 1e9;
    const COMBAT_SLOT_COUNT = 5;
    const SIMULATOR_SUPPORTED_EQUIPMENT_TYPES = new Set([
        "/equipment_types/head",
        "/equipment_types/body",
        "/equipment_types/legs",
        "/equipment_types/feet",
        "/equipment_types/hands",
        "/equipment_types/main_hand",
        "/equipment_types/two_hand",
        "/equipment_types/off_hand",
        "/equipment_types/pouch",
        "/equipment_types/back",
        "/equipment_types/neck",
        "/equipment_types/earrings",
        "/equipment_types/ring",
        "/equipment_types/charm",
    ]);
    const COMBAT_SIM_CHUNK_CACHE_BUST = "20260309-1.5.7";
    const COMBAT_SIM_VENDOR_CHUNK_URL = `https://shykai.github.io/MWICombatSimulatorTest/dist/vendors-node_modules_heap-js_dist_heap-js_es5_js.bundle.js?v=${COMBAT_SIM_CHUNK_CACHE_BUST}`;
    const COMBAT_SIM_WORKER_CHUNK_URL = `https://shykai.github.io/MWICombatSimulatorTest/dist/src_worker_js.bundle.js?v=${COMBAT_SIM_CHUNK_CACHE_BUST}`;
    const COMBAT_MODEL_SIGNATURE = "official-simulator-core-v3";
    const LABYRINTH_ABILITY_NAME_ZH_MAP = {
        "/abilities/critical_aura": "暴擊光環",
        "/abilities/elusiveness": "閃避",
        "/abilities/rain_of_arrows": "箭雨",
        "/abilities/penetrating_shot": "貫穿射擊",
        "/abilities/steady_shot": "穩定射擊",
        "/abilities/precision": "精確",
        "/abilities/flame_arrow": "烈焰箭",
        "/abilities/silencing_shot": "沉默之箭",
        "/abilities/aqua_arrow": "流水箭",
        "/abilities/quick_shot": "快速射擊",
        "/abilities/mystic_aura": "元素光環",
        "/abilities/elemental_affinity": "元素增幅",
        "/abilities/frost_surge": "冰霜爆裂",
        "/abilities/mana_spring": "法力噴泉",
        "/abilities/water_strike": "流水衝擊",
        "/abilities/firestorm": "火焰風暴",
        "/abilities/smoke_burst": "煙爆滅影",
        "/abilities/fireball": "火球",
        "/abilities/guardian_aura": "守護光環",
        "/abilities/toxic_pollen": "劇毒粉塵",
        "/abilities/natures_veil": "自然菌幕",
        "/abilities/life_drain": "生命吸取",
        "/abilities/entangle": "纏繞",
        "/abilities/fierce_aura": "物理光環",
        "/abilities/berserk": "狂暴",
        "/abilities/impale": "透骨之刺",
        "/abilities/puncture": "破甲之刺",
        "/abilities/penetrating_strike": "貫心之刺",
        "/abilities/cleave": "分裂斬",
        "/abilities/maim": "血刃斬",
        "/abilities/crippling_slash": "致殘斬",
        "/abilities/toughness": "堅韌",
        "/abilities/sweep": "重掃",
        "/abilities/stunning_blow": "重錘",
        "/abilities/fracturing_impact": "碎裂衝擊",
        "/abilities/speed_aura": "速度光環",
        "/abilities/frenzy": "狂速",
    };
    const LABYRINTH_MONSTER_NAME_ZH_MAP = {
        "/monsters/shadow_archer": "暗影弓手",
        "/monsters/pyre_hunter": "火焰獵手",
        "/monsters/frost_sniper": "霜凍狙擊手",
        "/monsters/siren": "海妖",
        "/monsters/salamander": "火蜥蜴",
        "/monsters/dryad": "樹精",
        "/monsters/giant_scorpion": "巨蠍",
        "/monsters/giant_mantis": "巨螳螂",
        "/monsters/cyclops": "獨眼巨人",
        "/monsters/mimic": "寶箱怪",
    };
    const LABYRINTH_MONSTER_NAME_ZH_BY_TAIL = {
        shadow_archer: "暗影弓手",
        pyre_hunter: "火焰獵手",
        frost_sniper: "霜凍狙擊手",
        siren: "海妖",
        salamander: "火蜥蜴",
        dryad: "樹精",
        giant_scorpion: "巨蠍",
        giant_mantis: "巨螳螂",
        cyclops: "獨眼巨人",
        mimic: "寶箱怪",
    };
    const COMBAT_SKILL_HRID_BY_KEY = {
        stamina: "/skills/stamina",
        intelligence: "/skills/intelligence",
        attack: "/skills/attack",
        melee: "/skills/melee",
        defense: "/skills/defense",
        ranged: "/skills/ranged",
        magic: "/skills/magic",
    };
    const COMBAT_LEVEL_SKILL_HRID = "/skills/combat";
    const BADGE_CLASS = "mwi-lab-clear-rate-badge";
    const STYLE_ID = "mwi-lab-clear-rate-style";
    const CONTROL_ID = "mwi-lab-clear-rate-control";
    const CONTROL_CLASS = "mwi-lab-clear-rate-control";
    const CONTROL_LOAN_TOGGLE_CLASS = "mwi-lab-clear-rate-control__loan-toggle";
    const CONTROL_LOAN_PANEL_CLASS = "mwi-lab-clear-rate-control__loan-panel";
    const CONTROL_LOAN_LIST_CLASS = "mwi-lab-clear-rate-control__loan-list";
    const CONTROL_LOAN_ITEM_CLASS = "mwi-lab-clear-rate-control__loan-item";
    const CONTROL_LOAN_ITEM_STATUS_CLASS = "mwi-lab-clear-rate-control__loan-item-status";
    const CONTROL_LOAN_CALC_CLASS = "mwi-lab-clear-rate-control__loan-calc";
    const CONTROL_LOG_TOGGLE_CLASS = "mwi-lab-clear-rate-control__log-toggle";
    const CONTROL_LOG_PANEL_CLASS = "mwi-lab-clear-rate-control__log-panel";
    const CONTROL_LOG_LIST_CLASS = "mwi-lab-clear-rate-control__log-list";
    const CONTROL_LOG_ITEM_CLASS = "mwi-lab-clear-rate-control__log-item";
    const CONTROL_LOG_ACTION_CLASS = "mwi-lab-clear-rate-control__log-action";
    const CONTROL_LOG_META_CLASS = "mwi-lab-clear-rate-control__log-meta";
    const CONTROL_LOG_INCOMPLETE_CLASS = "mwi-lab-clear-rate-control__log-incomplete";
    const ROOM_LOG_FLOAT_ID = "mwi-lab-room-log-floating";
    const ROOM_LOG_FLOAT_CLASS = "mwi-lab-room-log-floating";
    const ROOM_LOG_FLOAT_HEADER_CLASS = "mwi-lab-room-log-floating__header";
    const ROOM_LOG_FLOAT_TITLE_CLASS = "mwi-lab-room-log-floating__title";
    const ROOM_LOG_FLOAT_ACTIONS_CLASS = "mwi-lab-room-log-floating__actions";
    const ROOM_LOG_FLOAT_CLEAR_CLASS = "mwi-lab-room-log-floating__clear";
    const ROOM_LOG_FLOAT_CLOSE_CLASS = "mwi-lab-room-log-floating__close";
    const ROOM_LOG_STORAGE_KEY = "mwi_lab_skilling_room_logs_v1";
    const ROOM_LOG_POSITION_STORAGE_KEY = "mwi_lab_skilling_room_logs_position_v1";
    const ROOM_LOG_MAX_SESSIONS = 30;
    const ROOM_LOG_ACTION_OUTCOME_SUCCESS = "success";
    const ROOM_LOG_ACTION_OUTCOME_FAIL = "fail";
    const ROOM_LOG_ACTION_OUTCOME_DOUBLE = "double";
    const ROOM_LOG_ACTION_OUTCOME_UNKNOWN = "unknown";
    const CONTROL_DISTRIBUTION_TOGGLE_CLASS = "mwi-lab-clear-rate-control__distribution-toggle";
    const CONTROL_DISTRIBUTION_STEP_CLASS = "mwi-lab-clear-rate-control__distribution-step";
    const CONTROL_DISTRIBUTION_STEP_INPUT_CLASS = "mwi-lab-clear-rate-control__distribution-step-input";
    const ROOM_DISTRIBUTION_FLOAT_ID = "mwi-lab-room-distribution-floating";
    const ROOM_DISTRIBUTION_FLOAT_CLASS = "mwi-lab-room-distribution-floating";
    const ROOM_DISTRIBUTION_HEADER_CLASS = "mwi-lab-room-distribution-floating__header";
    const ROOM_DISTRIBUTION_TITLE_CLASS = "mwi-lab-room-distribution-floating__title";
    const ROOM_DISTRIBUTION_CLOSE_CLASS = "mwi-lab-room-distribution-floating__close";
    const ROOM_DISTRIBUTION_BODY_CLASS = "mwi-lab-room-distribution-floating__body";
    const ROOM_DISTRIBUTION_META_CLASS = "mwi-lab-room-distribution-floating__meta";
    const ROOM_DISTRIBUTION_LIST_CLASS = "mwi-lab-room-distribution-floating__list";
    const ROOM_DISTRIBUTION_ROW_CLASS = "mwi-lab-room-distribution-floating__row";
    const ROOM_DISTRIBUTION_BAR_CLASS = "mwi-lab-room-distribution-floating__bar";
    const ROOM_DISTRIBUTION_POSITION_STORAGE_KEY = "mwi_lab_room_distribution_position_v1";
    const ROOM_DISTRIBUTION_DEFAULT_STEP = 25;
    const ROOM_DISTRIBUTION_MIN_STEP = 5;
    const ROOM_DISTRIBUTION_MAX_STEP = 100;
    const ROOM_DISTRIBUTION_LEVEL_SPAN = 20;
    const LIVE_ACTION_RATE_ID = "mwi-lab-live-action-rate";
    const LIVE_ACTION_RATE_CLASS = "mwi-lab-live-action-rate";
    const LIVE_ACTION_RATE_MWITOOLS_COLOR = "#ffffff";
    const LIVE_ACTION_RATE_MWITOOLS_FONT_SIZE = "0.875rem";
    const CONTROL_SCHEMA_ATTR = "data-mwi-lab-clear-schema";
    const CONTROL_SCHEMA_VERSION = "7";
    const CONTROL_BOUND_FLAG = "__mwiLabControlBound";
    const PREVIEW_TOOLTIP_ID = "mwi-lab-clear-rate-preview";
    const PREVIEW_TOOLTIP_CLASS = "mwi-lab-clear-rate-preview";
    const PREVIEW_CELL_BOUND_FLAG = "__mwiLabPreviewBound";
    const AUTOMATION_ESTIMATE_CONTROL_ID = "mwi-lab-auto-estimate-control";
    const AUTOMATION_ESTIMATE_CONTROL_CLASS = "mwi-lab-auto-estimate-control";
    const AUTOMATION_ESTIMATE_CONTROL_SCHEMA_ATTR = "data-mwi-lab-auto-schema";
    const AUTOMATION_ESTIMATE_CONTROL_SCHEMA_VERSION = "4";
    const AUTOMATION_ESTIMATE_CONTROL_TRIALS_INPUT_CLASS = "mwi-lab-auto-estimate-control__trials-input";
    const AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_INPUT_CLASS = "mwi-lab-auto-estimate-control__target-rate-input";
    const AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_LABEL_CLASS = "mwi-lab-auto-estimate-control__target-rate-label";
    const AUTOMATION_ESTIMATE_CONTROL_RECOMMEND_BUTTON_CLASS = "mwi-lab-auto-estimate-control__recommend-button";
    const AUTOMATION_MAX_FLOOR_TABLE_HEADER_CLASS = "mwi-lab-auto-floor-header";
    const AUTOMATION_MAX_FLOOR_CELL_CLASS = "mwi-lab-auto-floor-cell";
    const AUTOMATION_ESTIMATE_TABLE_HEADER_CLASS = "mwi-lab-auto-estimate-header";
    const AUTOMATION_ESTIMATE_CELL_CLASS = "mwi-lab-auto-estimate-cell";
    const AUTOMATION_ESTIMATE_CELL_CHANCE_CLASS = "mwi-lab-auto-estimate-cell__chance";
    const AUTOMATION_ESTIMATE_CELL_ETA_CLASS = "mwi-lab-auto-estimate-cell__eta";
    const AUTOMATION_ESTIMATE_CELL_ETA_DANGER_CLASS = "mwi-lab-auto-estimate-cell__eta--danger";
    const AUTOMATION_ESTIMATE_CELL_BOUND_FLAG = "__mwiLabAutoEstimateCellBound";
    const AUTOMATION_ESTIMATE_CELL_RENDER_TOKEN_ATTR = "data-mwi-auto-render-token";
    const AUTOMATION_RECOMMEND_TABLE_HEADER_CLASS = "mwi-lab-auto-recommend-header";
    const AUTOMATION_RECOMMEND_CELL_CLASS = "mwi-lab-auto-recommend-cell";
    const AUTOMATION_RECOMMEND_CELL_RENDER_TOKEN_ATTR = "data-mwi-auto-recommend-token";
    const AUTOMATION_RECOMMEND_CELL_BOUND_FLAG = "__mwiLabAutoRecommendCellBound";
    const AUTOMATION_RECOMMEND_MIN_DELTA = -300;
    const AUTOMATION_RECOMMEND_MAX_DELTA = 300;
    const AUTOMATION_RECOMMEND_COMBAT_TRIALS = Math.max(
        MIN_COMBAT_SIM_TRIALS,
        Math.min(MAX_COMBAT_SIM_TRIALS, Math.floor(3600 / ROOM_DURATION_SECONDS))
    );
    const AUTOMATION_RECOMMEND_ACCEPTABLE_DIFF = 0.005;
    const AUTOMATION_ESTIMATE_DEFAULT_SKIP_THRESHOLD = 100;
    const LABYRINTH_UPGRADE_LEVELS_STORAGE_KEY = "mwi_labyrinth_upgrade_levels_v1";
    const LABYRINTH_SKILLING_UPGRADE_MAX_LEVEL = 12;
    const LABYRINTH_UPGRADE_STEP_RATIO = 0.01;
    const LABYRINTH_UPGRADE_SKILLING_SUCCESS_STEP_RATIO = 0.005;
    const LABYRINTH_UPGRADE_KEY_SKILL_ACTION_SPEED = "/labyrinth_upgrades/skill_action_speed";
    const LABYRINTH_UPGRADE_KEY_SKILLING_EFFICIENCY = "/labyrinth_upgrades/skilling_efficiency";
    const LABYRINTH_UPGRADE_KEY_SKILLING_SUCCESS = "/labyrinth_upgrades/skilling_success";
    const LABYRINTH_UPGRADE_KEY_SKILLING_DOUBLE_PROGRESS = "/labyrinth_upgrades/skilling_double_progress";
    const LABYRINTH_UPGRADE_KEY_COMBAT_DAMAGE = "/labyrinth_upgrades/combat_damage";
    const LABYRINTH_UPGRADE_KEY_ATTACK_SPEED = "/labyrinth_upgrades/attack_speed";
    const LABYRINTH_UPGRADE_KEY_CAST_SPEED = "/labyrinth_upgrades/cast_speed";
    const LABYRINTH_UPGRADE_KEY_CRITICAL_RATE = "/labyrinth_upgrades/critical_rate";
    const LABYRINTH_UPGRADE_KEY_LABYRINTH_EXPERIENCE = "/labyrinth_upgrades/labyrinth_experience";
    const LABYRINTH_UPGRADE_KEYS = [
        LABYRINTH_UPGRADE_KEY_SKILL_ACTION_SPEED,
        LABYRINTH_UPGRADE_KEY_SKILLING_EFFICIENCY,
        LABYRINTH_UPGRADE_KEY_SKILLING_SUCCESS,
        LABYRINTH_UPGRADE_KEY_SKILLING_DOUBLE_PROGRESS,
        LABYRINTH_UPGRADE_KEY_COMBAT_DAMAGE,
        LABYRINTH_UPGRADE_KEY_ATTACK_SPEED,
        LABYRINTH_UPGRADE_KEY_CAST_SPEED,
        LABYRINTH_UPGRADE_KEY_CRITICAL_RATE,
        LABYRINTH_UPGRADE_KEY_LABYRINTH_EXPERIENCE,
    ];
    /* Legacy labyrinth shop DOM scan path removed in favor of characterInfo-backed upgrade levels.
    const LABYRINTH_UPGRADE_TEXT_KEY_MAP_LEGACY = [
        [/迷宮冷卻/i, LABYRINTH_UPGRADE_KEY_COOLDOWN],
        [/火把容量/i, LABYRINTH_UPGRADE_KEY_TORCH_CAP],
        [/斗篷容量/i, LABYRINTH_UPGRADE_KEY_SHROUD_CAP],
        [/探照燈容量/i, LABYRINTH_UPGRADE_KEY_BEACON_CAP],
        [/完全自動化/i, LABYRINTH_UPGRADE_KEY_FULL_AUTO],
        [/專業速度/i, LABYRINTH_UPGRADE_KEY_SKILL_ACTION_SPEED],
        [/專業效率/i, LABYRINTH_UPGRADE_KEY_SKILLING_EFFICIENCY],
        [/專業成功率/i, LABYRINTH_UPGRADE_KEY_SKILLING_SUCCESS],
        [/專業雙倍進度/i, LABYRINTH_UPGRADE_KEY_SKILLING_DOUBLE_PROGRESS],
        [/戰鬥傷害/i, LABYRINTH_UPGRADE_KEY_COMBAT_DAMAGE],
        [/攻擊速度/i, LABYRINTH_UPGRADE_KEY_ATTACK_SPEED],
        [/施法速度/i, LABYRINTH_UPGRADE_KEY_CAST_SPEED],
        [/暴擊率/i, LABYRINTH_UPGRADE_KEY_CRITICAL_RATE],
        [/迷宮經驗/i, LABYRINTH_UPGRADE_KEY_LABYRINTH_EXPERIENCE],
    ];
    const LABYRINTH_UPGRADE_TEXT_KEY_MAP = [
        [/\u8ff7\u5bab\u51b7\u5374|cooldown/i, LABYRINTH_UPGRADE_KEY_COOLDOWN],
        [/\u706b\u628a\u5bb9\u91cf|torch/i, LABYRINTH_UPGRADE_KEY_TORCH_CAP],
        [/\u6597\u7bf7\u5bb9\u91cf|shroud/i, LABYRINTH_UPGRADE_KEY_SHROUD_CAP],
        [/\u63a2\u7167\u706f|\u63a2\u7167\u706f\u5bb9\u91cf|beacon/i, LABYRINTH_UPGRADE_KEY_BEACON_CAP],
        [/\u5b8c\u5168\u81ea\u52a8\u5316|full\s*auto/i, LABYRINTH_UPGRADE_KEY_FULL_AUTO],
        [/\u4e13\u4e1a\u901f\u5ea6|skill(?:ing)?\s*(?:action\s*)?speed/i, LABYRINTH_UPGRADE_KEY_SKILL_ACTION_SPEED],
        [/\u4e13\u4e1a\u6548\u7387|skill(?:ing)?\s*efficiency/i, LABYRINTH_UPGRADE_KEY_SKILLING_EFFICIENCY],
        [/\u4e13\u4e1a\u6210\u529f\u7387|skill(?:ing)?\s*success/i, LABYRINTH_UPGRADE_KEY_SKILLING_SUCCESS],
        [/\u4e13\u4e1a\u53cc\u500d\u8fdb\u5ea6|skill(?:ing)?\s*double\s*progress/i, LABYRINTH_UPGRADE_KEY_SKILLING_DOUBLE_PROGRESS],
        [/\u6218\u6597\u4f24\u5bb3|combat\s*damage/i, LABYRINTH_UPGRADE_KEY_COMBAT_DAMAGE],
        [/\u653b\u51fb\u901f\u5ea6|attack\s*speed/i, LABYRINTH_UPGRADE_KEY_ATTACK_SPEED],
        [/\u65bd\u6cd5\u901f\u5ea6|cast\s*speed/i, LABYRINTH_UPGRADE_KEY_CAST_SPEED],
        [/\u66b4\u51fb\u7387|critical\s*rate|crit\s*rate/i, LABYRINTH_UPGRADE_KEY_CRITICAL_RATE],
        [/(?:\u8ff7\u5bab)?\u7ecf\u9a8c|labyrinth\s*experience|experience/i, LABYRINTH_UPGRADE_KEY_LABYRINTH_EXPERIENCE],
    ];
    */
    const LABYRINTH_AUTOMATION_SKILL_ROOM_TYPES = [
        { key: "milking", skillHrid: "/skills/milking" },
        { key: "foraging", skillHrid: "/skills/foraging" },
        { key: "woodcutting", skillHrid: "/skills/woodcutting" },
        { key: "cheesesmithing", skillHrid: "/skills/cheesesmithing" },
        { key: "crafting", skillHrid: "/skills/crafting" },
        { key: "tailoring", skillHrid: "/skills/tailoring" },
        { key: "cooking", skillHrid: "/skills/cooking" },
        { key: "brewing", skillHrid: "/skills/brewing" },
        { key: "alchemy", skillHrid: "/skills/alchemy" },
        { key: "enhancing", skillHrid: "/skills/enhancing" },
    ];
    const LABYRINTH_AUTOMATION_COMBAT_ROOM_TYPES = [
        { key: "shadow_archer", monsterHrid: "/monsters/shadow_archer" },
        { key: "pyre_hunter", monsterHrid: "/monsters/pyre_hunter" },
        { key: "frost_sniper", monsterHrid: "/monsters/frost_sniper" },
        { key: "siren", monsterHrid: "/monsters/siren" },
        { key: "salamander", monsterHrid: "/monsters/salamander" },
        { key: "dryad", monsterHrid: "/monsters/dryad" },
        { key: "giant_scorpion", monsterHrid: "/monsters/giant_scorpion" },
        { key: "giant_mantis", monsterHrid: "/monsters/giant_mantis" },
        { key: "cyclops", monsterHrid: "/monsters/cyclops" },
        { key: "mimic", monsterHrid: "/monsters/mimic" },
    ];
    const LABYRINTH_AUTOMATION_SKILL_NAME_ZH_BY_KEY = {
        milking: "擠奶",
        foraging: "採摘",
        woodcutting: "伐木",
        cheesesmithing: "乳酪鍛造",
        crafting: "製作",
        tailoring: "縫紉",
        cooking: "烹飪",
        brewing: "沖泡",
        alchemy: "鍊金",
        enhancing: "強化",
    };
    const LABYRINTH_AUTOMATION_SKILL_NAME_EN_BY_KEY = {
        milking: "Milking",
        foraging: "Foraging",
        woodcutting: "Woodcutting",
        cheesesmithing: "Cheesesmithing",
        crafting: "Crafting",
        tailoring: "Tailoring",
        cooking: "Cooking",
        brewing: "Brewing",
        alchemy: "Alchemy",
        enhancing: "Enhancing",
    };
    const LABYRINTH_LOAN_SEAL_EFFECTS = [
        {
            itemHrid: "/items/seal_of_efficiency",
            buffTypeHrid: "/buff_types/efficiency",
            amount: 0.14,
            boostMode: "flat",
            isCombat: false,
        },
        {
            itemHrid: "/items/seal_of_action_speed",
            buffTypeHrid: "/buff_types/action_speed",
            amount: 0.15,
            boostMode: "flat",
            isCombat: false,
        },
        {
            itemHrid: "/items/seal_of_gourmet",
            buffTypeHrid: "/buff_types/gourmet",
            amount: 0.1,
            boostMode: "flat",
            isCombat: false,
        },
        {
            itemHrid: "/items/seal_of_gathering",
            buffTypeHrid: "/buff_types/gathering",
            amount: 0.18,
            boostMode: "flat",
            isCombat: false,
        },
        {
            itemHrid: "/items/seal_of_damage",
            buffTypeHrid: "/buff_types/damage",
            amount: 0.08,
            boostMode: "ratio",
            isCombat: true,
        },
        {
            itemHrid: "/items/seal_of_attack_speed",
            buffTypeHrid: "/buff_types/attack_speed",
            amount: 0.15,
            boostMode: "ratio",
            isCombat: true,
        },
        {
            itemHrid: "/items/seal_of_cast_speed",
            buffTypeHrid: "/buff_types/cast_speed",
            amount: 0.15,
            boostMode: "flat",
            isCombat: true,
        },
        {
            itemHrid: "/items/seal_of_critical_rate",
            buffTypeHrid: "/buff_types/critical_rate",
            amount: 0.1,
            boostMode: "flat",
            isCombat: true,
        },
    ];
    const SIMULATOR_PERSONAL_BUFF_ITEM_HRIDS = new Set([
        "/items/seal_of_combat_drop",
        "/items/seal_of_attack_speed",
        "/items/seal_of_cast_speed",
        "/items/seal_of_damage",
        "/items/seal_of_critical_rate",
        "/items/seal_of_wisdom",
        "/items/seal_of_rare_find",
    ]);
    const SIMULATOR_COMBAT_PERSONAL_SEAL_ITEM_HRIDS = new Set([
        "/items/seal_of_combat_drop",
        "/items/seal_of_attack_speed",
        "/items/seal_of_cast_speed",
        "/items/seal_of_damage",
        "/items/seal_of_critical_rate",
        "/items/seal_of_wisdom",
        "/items/seal_of_rare_find",
    ]);
    const LABYRINTH_SEAL_NAME_ZH_BY_ITEM_HRID = {
        "/items/seal_of_gathering": "卷軸·採集",
        "/items/seal_of_gourmet": "卷軸·美食",
        "/items/seal_of_processing": "卷軸·加工",
        "/items/seal_of_efficiency": "卷軸·效率",
        "/items/seal_of_action_speed": "卷軸·行動速度",
        "/items/seal_of_combat_drop": "卷軸·戰利品",
        "/items/seal_of_attack_speed": "卷軸·攻擊速度",
        "/items/seal_of_cast_speed": "卷軸·施法速度",
        "/items/seal_of_damage": "卷軸·傷害",
        "/items/seal_of_critical_rate": "卷軸·暴擊率",
        "/items/seal_of_wisdom": "卷軸·智慧",
        "/items/seal_of_rare_find": "卷軸·稀有掉落",
    };
    const SIMULATOR_BRIDGE_URL_STORAGE_KEY = "mwi_lab_simulator_bridge_url";
    const SIMULATOR_BRIDGE_DEFAULT_URL = "https://shykai.github.io/MWICombatSimulatorTest/dist/";
    const SIMULATOR_BRIDGE_LEGACY_URL_PREFIXES = [
        "https://amvoidguy.github.io/MWICombatSimulatorTest/",
        "https://shykai.github.io/MWICombatSimulatorTest/",
        "https://shykai.github.io/mwisim/",
        "https://truthligh.github.io/MWICombatSimulator/",
    ];
    const SIMULATOR_BRIDGE_PAYLOAD_PARAM = "mwiLabBridge";
    const SIMULATOR_BRIDGE_SOURCE = "mwi-lab-clear-rate-overlay";
    const SIMULATOR_BRIDGE_VERSION = 1;
    const ETA_INFINITE_TEXT = "999+";
    const PANEL_REFRESH_POLL_MS = 1000;
    const PANEL_REFRESH_DEBOUNCE_MS = 120;
    const AUTO_RECALC_DEBOUNCE_MS = 600;
    const UI_LANGUAGE_STORAGE_KEY = "i18nextLng";
    const UI_LANGUAGE_EN = "en";
    const UI_LANGUAGE_ZH = "zh";
    const UI_TEXT = {
        en: {
            pending: "Pending",
            tokenExpected: "Token Expected",
            experiencePerAction: "EXP / Action",
            experiencePerRoom: "EXP / Room",
            experiencePerHour: "EXP / Hour",
            skillingBoxExpected: "Skilling Box Expected",
            combatBoxExpected: "Combat Box Expected",
            refiningChestExpected: "Refining Chest Expected",
            skillingRoomPreview: "Skilling Room Preview",
            combatRoomPreview: "Combat Room Preview",
            treasureRoomPreview: "Treasure Room Preview",
            floorExitPreview: "Floor Exit Preview",
            roomPreview: "Room Preview",
            styleStab: "Stab",
            styleSlash: "Slash",
            styleSmash: "Smash",
            styleRanged: "Ranged",
            styleMagic: "Magic",
            unknown: "Unknown",
            accuracySuffix: "Accuracy",
            damageSuffix: "Damage",
            evasionSuffix: "Evasion",
            water: "Water",
            nature: "Nature",
            fire: "Fire",
            physical: "Physical",
            waterResistance: "Water Resistance",
            natureResistance: "Nature Resistance",
            fireResistance: "Fire Resistance",
            armor: "Armor",
            failureDefense: "Insufficient Defense",
            failureDamage: "Insufficient Damage",
            targetEnhancement: "Target Enhancement",
            successRate: "Success Rate",
            doubleProgress: "Double Progress",
            twoMinuteActions: "Actions in 2m",
            actionDuration: "Action Duration",
            needSpeedForOneMoreAction: "Speed for +1 Action",
            workPower: "Work Power",
            needEfficiencyForOneLessProgress: "Efficiency for -1 Progress",
            nextLevelClearChance: "Next Level Clear %",
            efficiencyTierClearChance: "Efficiency Tier Clear %",
            speedTierClearChance: "Speed Tier Clear %",
            nextSkillingSuccessClearChance: "Next Skilling Success Clear %",
            nextSkillingDoubleProgressClearChance: "Next Double Progress Clear %",
            alreadyOptimal: "Already Optimal",
            combatStyle: "Combat Style",
            damageType: "Damage Type",
            attackInterval: "Attack Interval",
            castSpeed: "Cast Speed",
            maxHp: "Max HP",
            operation: "Action",
            rightClickOpenSimulator: "Right-click to open simulator",
            failureReason: "Failure Reason",
            accuracyDefault: "Accuracy",
            damageDefault: "Damage",
            evasionDefault: "Evasion",
            mitigationDefault: "Armor",
            automationPreview: "Automation Preview",
            status: "Status",
            level: "Level",
            maxFloor: "Max Floor",
            chanceEta: "Chance / ETA",
            targetWinRate: "Target Win %",
            recommendDelta: "Recommend Level",
            recommendSettingLevel: "Recommend Setting Level",
            skipLevel: "Skip Level",
            skipLevelLong: "Skip if above level",
            combatTrials: "Combat Trials",
            calcChance: "Calculate",
            calculating: "Calculating...",
            calcMaze: "Calculate Labyrinth",
            automationListNotFound: "Automation list not found",
            noCalculableRooms: "No calculable rooms",
            missingClientData: "Missing client data",
            preparing: "Preparing...",
            calculatingProgressFmt: "Calculating {current}/{total}",
            skipRoom: "Skip Room",
            calcFailed: "Calculation failed",
            calcDone: "Calculation complete",
            calcDoneWithPersonalBuffs: "Calculation complete (including personal buffs)",
            loanSeal: "Scroll Loan",
            loanPanelTitle: "Available Scroll Effects",
            loanCalc: "Loan Calculate",
            loanNoOptions: "No usable scrolls",
            loanAlreadyActive: "Active",
            loanCannotApply: "No effect data",
            roomLog: "Logs",
            roomLogTitleFmt: "Room Logs (Last {count})",
            roomLogEmpty: "No logs yet",
            roomLogIncomplete: "Incomplete",
            roomLogModeSkilling: "Skilling",
            roomLogModeEnhancing: "Enhancing",
            roomLogModeCombat: "Combat",
            roomLogActionGap: "Missed action records",
            roomLogComingSoon: "Coming Soon",
            roomLogRateFmt: "Success {success}% / Double {double}%",
            roomLogWorkFmt: "Work {value}",
            roomLogExpFmt: "EXP {value}",
            roomLogProgressFmt: "Progress {current}% / {target}%",
            roomLogEnhFmt: "Enh +{current}/+{target}",
            roomLogDurationFmt: "{seconds}s",
            roomLogClear: "Clear",
            roomLogClose: "Close",
            roomDistribution: "Win Rate Distribution",
            roomDistributionStep: "Bin Width",
            roomDistributionTitleFmt: "Room Win Rate Distribution · Floor {floor}",
            roomDistributionWaiting: "Waiting for Calculate Labyrinth",
            roomDistributionCalculatingFmt: "Calculating {current}/{total}",
            roomDistributionMetaFmt: "Lv.{min}–{max} · Valid {valid}/{total} · Failed {failed}",
            roomDistributionTrialsFmt: "Combat uses {trials} fixed trials",
            roomDistributionNoSamples: "No valid samples",
            skippedRooms: "Rooms skipped",
            noSupplies: "No supply crates equipped",
            partialSkipped: "Some rooms skipped",
            missingCoffeeCrate: "Coffee Crate",
            missingFoodCrate: "Food Crate",
            missingTeaCrate: "Tea Crate",
            missingCrateFmt: "Missing {crates}",
            progressFmt: "Progress {percent}%",
            notInLabyrinth: "Not in labyrinth",
            noLabyrinthData: "No labyrinth data",
            cellsNotFound: "Grid cells not found",
            noNewTiles: "No new tiles",
            roomFmt: "Room {current}/{total}",
            combatFmt: "Combat {current}/{total}",
            autoNewTiles: "New tiles found, auto calculating",
            readGameDataFailed: "Unable to read game data. Refresh and try again.",
            exportableCombatRoomNotFound: "Could not identify an exportable combat room.",
            skippedCannotExport: "This room is skipped and cannot be exported.",
            simulatorExportNoLoadout: "Simulator export failed: missing usable loadout.",
            combatFlowFailedFmt: "Labyrinth combat full-flow calculation failed: {message}",
            liveEnhFmt: " [Clear {chance}% | +{current}/+{target} | {left} left]",
            liveBasicFmt: " [Clear {chance}% | {left} left]",
            liveSuccessFmt: "Success {chance}%",
            liveDoubleFmt: "Double {chance}%",
            liveActionsFmt: "Actions {current}/{total}",
            liveEnhTitleFmt: "Enhance +{current}/+{target}",
            liveProgressFmt: "Progress {current}/{target}",
            waitingOptimization: "(Pending optimization)",
        },
        zh: {
            pending: "待計算",
            tokenExpected: "代幣期望",
            experiencePerAction: "每次經驗",
            experiencePerRoom: "每場經驗",
            experiencePerHour: "每小時經驗",
            skillingBoxExpected: "生活紫盒期望",
            combatBoxExpected: "戰鬥紫盒期望",
            refiningChestExpected: "精煉寶箱期望",
            skillingRoomPreview: "生活房間預覽",
            combatRoomPreview: "戰鬥房間預覽",
            treasureRoomPreview: "寶箱房間預覽",
            floorExitPreview: "樓層出口預覽",
            roomPreview: "房間預覽",
            styleStab: "刺擊",
            styleSlash: "斬擊",
            styleSmash: "鈍擊",
            styleRanged: "遠端",
            styleMagic: "魔法",
            unknown: "未知",
            accuracySuffix: "精準度",
            damageSuffix: "傷害",
            evasionSuffix: "閃避",
            water: "水系",
            nature: "自然系",
            fire: "火系",
            physical: "物理",
            waterResistance: "水系抗性",
            natureResistance: "自然系抗性",
            fireResistance: "火系抗性",
            armor: "護甲",
            failureDefense: "防禦不足",
            failureDamage: "傷害不足",
            targetEnhancement: "目標強化",
            successRate: "成功率",
            doubleProgress: "雙倍進度",
            twoMinuteActions: "2分鐘次數",
            actionDuration: "單次時長",
            needSpeedForOneMoreAction: "多1次行動需速度",
            workPower: "工作能力",
            needEfficiencyForOneLessProgress: "減1次進度需效率",
            nextLevelClearChance: "等級提升勝率",
            efficiencyTierClearChance: "效率升檔勝率",
            speedTierClearChance: "速度升檔勝率",
            nextSkillingSuccessClearChance: "下一級專業成功率勝率",
            nextSkillingDoubleProgressClearChance: "下一級專業雙倍進度勝率",
            alreadyOptimal: "已最優",
            combatStyle: "戰鬥風格",
            damageType: "傷害型別",
            attackInterval: "攻擊間隔",
            castSpeed: "施法速度",
            maxHp: "最大HP",
            operation: "操作",
            rightClickOpenSimulator: "右鍵開啟模擬器",
            failureReason: "失敗原因",
            accuracyDefault: "精準度",
            damageDefault: "傷害",
            evasionDefault: "閃避",
            mitigationDefault: "護甲",
            automationPreview: "自動化預覽",
            status: "狀態",
            level: "等級",
            maxFloor: "最高層數",
            chanceEta: "勝率/耗時",
            targetWinRate: "目標勝率",
            recommendDelta: "推薦等級",
            recommendSettingLevel: "推薦設定等級",
            skipLevel: "跳過等級",
            skipLevelLong: "跳過如果高出等級",
            combatTrials: "戰鬥次數",
            calcChance: "計算勝率",
            calculating: "計算中...",
            calcMaze: "計算迷宮",
            automationListNotFound: "未識別到自動化列表",
            noCalculableRooms: "無可計算房間",
            missingClientData: "缺少客戶端資料",
            preparing: "準備中...",
            calculatingProgressFmt: "計算中 {current}/{total}",
            skipRoom: "跳過房間",
            calcFailed: "計算失敗",
            calcDone: "計算完成",
            calcDoneWithPersonalBuffs: "計算完成（包含個人增益）",
            loanSeal: "貸款卷軸",
            loanPanelTitle: "可用卷軸效果",
            loanCalc: "貸款計算",
            loanNoOptions: "沒有可用卷軸",
            loanAlreadyActive: "已生效",
            loanCannotApply: "無效果資料",
            roomLog: "日誌",
            roomLogTitleFmt: "房間日誌（最近{count}場）",
            roomLogEmpty: "暫無日誌",
            roomLogIncomplete: "不完整",
            roomLogModeSkilling: "技能",
            roomLogModeEnhancing: "強化",
            roomLogModeCombat: "戰鬥",
            roomLogActionGap: "行動記錄缺失",
            roomLogComingSoon: "敬請期待",
            roomLogRateFmt: "成功率 {success}% / 雙倍 {double}%",
            roomLogWorkFmt: "工作能力 {value}",
            roomLogExpFmt: "經驗 {value}",
            roomLogProgressFmt: "進度 {current}% / {target}%",
            roomLogEnhFmt: "強化 +{current}/+{target}",
            roomLogDurationFmt: "持續{seconds}秒",
            roomLogClear: "清理",
            roomLogClose: "關閉",
            roomDistribution: "勝率分佈",
            roomDistributionStep: "分檔",
            roomDistributionTitleFmt: "房間勝率分佈 · 第{floor}層",
            roomDistributionWaiting: "等待點選計算迷宮",
            roomDistributionCalculatingFmt: "正在計算 {current}/{total}",
            roomDistributionMetaFmt: "Lv.{min}～{max} · 有效樣本 {valid}/{total} · 失敗 {failed}",
            roomDistributionTrialsFmt: "戰鬥固定使用 {trials} 次模擬",
            roomDistributionNoSamples: "沒有有效樣本",
            skippedRooms: "已跳過房間",
            noSupplies: "未攜帶補給箱",
            partialSkipped: "部分房間已跳過",
            missingCoffeeCrate: "咖啡箱",
            missingFoodCrate: "食物箱",
            missingTeaCrate: "茶葉箱",
            missingCrateFmt: "未攜帶{crates}",
            progressFmt: "進度 {percent}%",
            notInLabyrinth: "不在迷宮",
            noLabyrinthData: "無迷宮資料",
            cellsNotFound: "未找到格子",
            noNewTiles: "無新增地塊",
            roomFmt: "房間 {current}/{total}",
            combatFmt: "戰鬥 {current}/{total}",
            autoNewTiles: "發現新地塊，自動計算",
            readGameDataFailed: "無法讀取遊戲資料，請重新整理頁面後重試。",
            exportableCombatRoomNotFound: "未識別到可匯出的戰鬥房間。",
            skippedCannotExport: "該房間當前設定會跳過，無法匯出模擬器。",
            simulatorExportNoLoadout: "匯出模擬器資料失敗：缺少可用配裝。",
            combatFlowFailedFmt: "迷宮戰鬥全流程計算失敗：{message}",
            liveEnhFmt: " [勝率 {chance}% | +{current}/+{target} | 剩餘{left}次]",
            liveBasicFmt: " [勝率 {chance}% | 剩餘{left}次]",
            liveSuccessFmt: "成功率 {chance}%",
            liveDoubleFmt: "雙倍 {chance}%",
            liveActionsFmt: "已行動 {current}/{total}",
            liveEnhTitleFmt: "強化 +{current}/+{target}",
            liveProgressFmt: "進度 {current}/{target}",
            waitingOptimization: "(等待最佳化)",
        },
    };

    function normalizeUiLanguage(value) {
        const raw = String(value || "").trim().toLowerCase();
        if (raw.startsWith("zh")) {
            return UI_LANGUAGE_ZH;
        }
        if (raw.startsWith("en")) {
            return UI_LANGUAGE_EN;
        }
        return "";
    }

    function getUiLanguage() {
        try {
            const fromStorage = normalizeUiLanguage(localStorage.getItem(UI_LANGUAGE_STORAGE_KEY));
            if (fromStorage) {
                return fromStorage;
            }
        } catch (_error) {
            // Ignore storage read errors.
        }
        return UI_LANGUAGE_EN;
    }

    function isChineseUi() {
        return getUiLanguage() === UI_LANGUAGE_ZH;
    }

    function t(key, vars) {
        const lang = getUiLanguage();
        const template = (UI_TEXT[lang] && UI_TEXT[lang][key]) || UI_TEXT.en[key] || key;
        if (!vars || typeof vars !== "object") {
            return template;
        }
        return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => {
            if (Object.prototype.hasOwnProperty.call(vars, name)) {
                return String(vars[name]);
            }
            return "";
        });
    }

    let cachedInitClientDataRaw = "";
    let cachedInitClientData = null;
    let combatEstimateCache = new Map();
    let manualUpdateRunning = false;
    let combatWorkerScriptPromise = null;
    let combatSimulatorWorker = null;
    let combatSimulatorWorkerUrl = "";
    let combatWorkerRequestId = 0;
    let lastLabyrinthDisplaySignature = "";
    let lastProgressRoomKey = "";
    let wasRoomChallengeRunning = false;
    let lastObservedPathRoomKey = "";
    let autoRecalcArmed = false;
    let autoRecalcLabyrinthSignature = "";
    let lastCalculatedCalculableRoomSignature = "";
    let lastCalculatedCalculableRoomCount = 0;
    let lastCalculatedCalculableRoomEntries = new Set();
    let pendingAutoRecalcRoomKeys = new Set();
    let autoRecalcTimerId = 0;
    let panelRefreshTimerId = 0;
    const combatWorkerPendingRequests = new Map();
    let skillingPreviewByCell = new WeakMap();
    let combatPreviewByCell = new WeakMap();
    let latestRoomEstimateByRoomKey = new Map();
    let lastLiveActionRateToken = "";
    let liveActionRateWsHookInstalled = false;
    let automationEstimateByRoomTypeKey = new Map();
    let automationEstimateSignatureByRoomTypeKey = new Map();
    let automationRecommendByRoomTypeKey = new Map();
    let automationRecommendSignatureByRoomTypeKey = new Map();
    let automationEstimateRunning = false;
    let automationEstimateRunningMode = "";
    let automationEstimateStatusText = t("pending");
    let automationEstimateColumnEnabled = false;
    let automationRecommendColumnEnabled = false;
    let automationWideLayoutNodes = [];
    let lastLabyrinthCalcDoneMessage = "";
    let loanSealSelectionByItemHrid = new Map();
    let activeLoanSimulationOptions = null;
    let latestLabyrinthUpgradeLevels = null;
    let roomLogSessions = [];
    let activeRoomLogSession = null;
    let roomDistributionEnabled = false;
    let roomDistributionSnapshot = null;
    let roomDistributionRunning = false;
    let roomDistributionProgress = null;
    let roomDistributionRunToken = 0;

    function clamp01(value) {
        if (!Number.isFinite(value)) {
            return 0;
        }
        if (value < 0) {
            return 0;
        }
        if (value > 1) {
            return 1;
        }
        return value;
    }

    function finiteNumber(value, fallback = 0) {
        return Number.isFinite(value) ? Number(value) : fallback;
    }

    function positiveNumber(value, fallback = 0) {
        const n = finiteNumber(value, fallback);
        return n > 0 ? n : fallback;
    }

    function createEmptyLabyrinthUpgradeLevels() {
        const result = {};
        for (const key of LABYRINTH_UPGRADE_KEYS) {
            result[key] = 0;
        }
        return result;
    }

    function normalizeLabyrinthUpgradeLevels(raw) {
        const result = createEmptyLabyrinthUpgradeLevels();
        if (!raw || typeof raw !== "object") {
            return result;
        }
        for (const key of LABYRINTH_UPGRADE_KEYS) {
            result[key] = Math.max(0, Math.floor(finiteNumber(raw[key], 0)));
        }
        return result;
    }

    function mergeLabyrinthUpgradeLevels(base, override) {
        const result = normalizeLabyrinthUpgradeLevels(base);
        if (!override || typeof override !== "object") {
            return result;
        }
        for (const key of LABYRINTH_UPGRADE_KEYS) {
            if (Object.prototype.hasOwnProperty.call(override, key)) {
                result[key] = Math.max(0, Math.floor(finiteNumber(override[key], result[key])));
            }
        }
        return result;
    }

    function loadStoredLabyrinthUpgradeLevels() {
        try {
            return normalizeLabyrinthUpgradeLevels(JSON.parse(localStorage.getItem(LABYRINTH_UPGRADE_LEVELS_STORAGE_KEY) || "null"));
        } catch (_error) {
            return createEmptyLabyrinthUpgradeLevels();
        }
    }

    function saveLabyrinthUpgradeLevels(levels) {
        const normalized = normalizeLabyrinthUpgradeLevels(levels);
        try {
            localStorage.setItem(LABYRINTH_UPGRADE_LEVELS_STORAGE_KEY, JSON.stringify(normalized));
        } catch (_error) {
            // Ignore storage errors.
        }
        latestLabyrinthUpgradeLevels = normalized;
        return normalized;
    }

    function readLabyrinthUpgradeLevelsFromState(state) {
        const info = state?.characterInfo;
        if (!info || typeof info !== "object") {
            return null;
        }
        const result = {};
        let matched = 0;
        const assign = (key, value) => {
            if (!Number.isFinite(Number(value))) {
                return;
            }
            result[key] = Math.max(0, Math.floor(Number(value)));
            matched += 1;
        };
        assign(LABYRINTH_UPGRADE_KEY_SKILL_ACTION_SPEED, info.labyrinthSkillActionSpeedLevel);
        assign(LABYRINTH_UPGRADE_KEY_SKILLING_EFFICIENCY, info.labyrinthSkillingEfficiencyLevel);
        assign(LABYRINTH_UPGRADE_KEY_SKILLING_SUCCESS, info.labyrinthSkillingSuccessLevel);
        assign(LABYRINTH_UPGRADE_KEY_SKILLING_DOUBLE_PROGRESS, info.labyrinthSkillingDoubleProgressLevel);
        assign(LABYRINTH_UPGRADE_KEY_COMBAT_DAMAGE, info.labyrinthCombatDamageLevel);
        assign(LABYRINTH_UPGRADE_KEY_ATTACK_SPEED, info.labyrinthAttackSpeedLevel);
        assign(LABYRINTH_UPGRADE_KEY_CAST_SPEED, info.labyrinthCastSpeedLevel);
        assign(LABYRINTH_UPGRADE_KEY_CRITICAL_RATE, info.labyrinthCriticalRateLevel);
        assign(LABYRINTH_UPGRADE_KEY_LABYRINTH_EXPERIENCE, info.labyrinthExperienceLevel);
        return matched > 0 ? result : null;
    }

    function areLabyrinthUpgradeLevelsEqual(left, right) {
        for (const key of LABYRINTH_UPGRADE_KEYS) {
            if (Math.max(0, Math.floor(finiteNumber(left?.[key], 0))) !== Math.max(0, Math.floor(finiteNumber(right?.[key], 0)))) {
                return false;
            }
        }
        return true;
    }

    /* Legacy labyrinth shop DOM scan helpers kept disabled after switching upgrade reads to characterInfo only.
    function getReactFiberNodeFromElement(element) {
        if (!element || typeof element !== "object") {
            return null;
        }
        const fiberKey = Object.getOwnPropertyNames(element).find((key) => key.startsWith("__reactFiber$"));
        return fiberKey ? element[fiberKey] || null : null;
    }

    function resolveLabyrinthUpgradeKeyFromElement(element) {
        let currentElement = element;
        for (let depth = 0; currentElement && depth < 4; depth += 1, currentElement = currentElement.parentElement) {
            let fiber = getReactFiberNodeFromElement(currentElement);
            while (fiber) {
                const upgradeKey = String(fiber.key || "");
                if (upgradeKey.startsWith("/labyrinth_upgrades/")) {
                    return upgradeKey;
                }
                fiber = fiber.return || null;
            }
        }

        const text = String(element?.innerText || element?.textContent || "");
        for (const [pattern, upgradeKey] of LABYRINTH_UPGRADE_TEXT_KEY_MAP) {
            if (pattern.test(text)) {
                return upgradeKey;
            }
        }
        return "";
    }

    function scanLabyrinthUpgradeLevelsFromDom() {
        const result = createEmptyLabyrinthUpgradeLevels();
        let matched = 0;
        for (const element of Array.from(document.querySelectorAll(LABYRINTH_UPGRADE_CARD_SELECTOR))) {
            const upgradeKey = resolveLabyrinthUpgradeKeyFromElement(element);
            if (!upgradeKey || !Object.prototype.hasOwnProperty.call(result, upgradeKey)) {
                continue;
            }
            const text = String(element.innerText || element.textContent || "");
            const countMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
            if (!countMatch) {
                continue;
            }
            result[upgradeKey] = Math.max(0, Math.floor(finiteNumber(Number(countMatch[1]), 0)));
            matched += 1;
        }
        return matched > 0 ? result : null;
    }

    */
    function getLabyrinthUpgradeLevels(forceRefresh = false) {
        if (!latestLabyrinthUpgradeLevels) {
            latestLabyrinthUpgradeLevels = loadStoredLabyrinthUpgradeLevels();
        }
        const fromState = readLabyrinthUpgradeLevelsFromState(getGameState());
        const resolved = fromState ? mergeLabyrinthUpgradeLevels(latestLabyrinthUpgradeLevels, fromState) : latestLabyrinthUpgradeLevels;
        return areLabyrinthUpgradeLevelsEqual(resolved, latestLabyrinthUpgradeLevels)
            ? latestLabyrinthUpgradeLevels
            : saveLabyrinthUpgradeLevels(resolved);
    }

    function syncVisibleLabyrinthUpgradeLevelsCache() {
        if (!latestLabyrinthUpgradeLevels) {
            latestLabyrinthUpgradeLevels = loadStoredLabyrinthUpgradeLevels();
        }
        const fromState = readLabyrinthUpgradeLevelsFromState(getGameState());
        const resolved = fromState ? mergeLabyrinthUpgradeLevels(latestLabyrinthUpgradeLevels, fromState) : latestLabyrinthUpgradeLevels;
        if (!areLabyrinthUpgradeLevelsEqual(resolved, latestLabyrinthUpgradeLevels)) {
            return saveLabyrinthUpgradeLevels(resolved);
        }
        latestLabyrinthUpgradeLevels = normalizeLabyrinthUpgradeLevels(resolved);
        return latestLabyrinthUpgradeLevels;
    }

    function getLabyrinthUpgradeLevel(levels, upgradeKey) {
        return Math.max(0, Math.floor(finiteNumber(levels?.[upgradeKey], 0)));
    }

    function resolveLabyrinthUpgradeLevels(options = null) {
        if (options?.labyrinthUpgradeLevels && typeof options.labyrinthUpgradeLevels === "object") {
            return normalizeLabyrinthUpgradeLevels(options.labyrinthUpgradeLevels);
        }
        return getLabyrinthUpgradeLevels();
    }

    function normalizeChance(value) {
        const n = finiteNumber(value, 0);
        if (n > 1 && n <= 100) {
            return clamp01(n / 100);
        }
        return clamp01(n);
    }

    function nowIsoString(timestamp = Date.now()) {
        try {
            return new Date(timestamp).toISOString();
        } catch (_error) {
            return "";
        }
    }

    function formatRoomLogPercent(percentValue) {
        const value = Math.max(0, finiteNumber(percentValue, 0));
        const oneDecimal = Math.round(value * 10) / 10;
        if (Math.abs(oneDecimal - Math.round(oneDecimal)) < 0.0001) {
            return String(Math.round(oneDecimal));
        }
        return oneDecimal.toFixed(1);
    }

    function formatRoomLogExperience(value) {
        const n = Math.max(0, finiteNumber(value, 0));
        if (Math.abs(n - Math.round(n)) < 1e-9) {
            return `${Math.round(n)}`;
        }
        return n.toFixed(1).replace(/\.0$/, "");
    }

    function getSkillNameByHrid(skillHrid) {
        const hrid = String(skillHrid || "");
        const key = hrid.split("/").pop() || "";
        if (isChineseUi()) {
            return LABYRINTH_AUTOMATION_SKILL_NAME_ZH_BY_KEY[key] || key || "--";
        }
        return LABYRINTH_AUTOMATION_SKILL_NAME_EN_BY_KEY[key] || key || "--";
    }

    function getSkillExperienceValue(skillMap, skillHrid) {
        const hrid = String(skillHrid || "");
        if (!skillMap || !hrid) {
            return NaN;
        }
        if (skillMap instanceof Map) {
            const entry = skillMap.get(hrid);
            if (Number.isFinite(entry?.experience)) {
                return Number(entry.experience);
            }
            return NaN;
        }
        const entry = skillMap[hrid];
        if (entry && Number.isFinite(entry.experience)) {
            return Number(entry.experience);
        }
        return NaN;
    }

    function buildRoomLogContextFromSession(session) {
        if (!session || typeof session !== "object") {
            return null;
        }
        const skillHrid = String(session.skillHrid || "");
        if (!skillHrid) {
            return null;
        }
        return {
            roomKey: String(session.roomKey || ""),
            roomType: LABYRINTH_SKILLING_ROOM_TYPE,
            skillHrid,
            skillName: String(session.skillName || getSkillNameByHrid(skillHrid)),
            recommendedLevel: Math.max(0, Math.floor(finiteNumber(session.recommendedLevel, 0))),
        };
    }

    function createEmptyRoomLogStorage() {
        return {
            sessions: [],
            active: null,
        };
    }

    function trimRoomLogSessions(sessions) {
        if (!Array.isArray(sessions)) {
            return [];
        }
        return sessions
            .filter((entry) => entry && typeof entry === "object")
            .slice(0, ROOM_LOG_MAX_SESSIONS);
    }

    function sanitizeRoomLogAction(action, fallbackCounter = 0) {
        if (!action || typeof action !== "object") {
            return {
                counter: Math.max(0, Math.floor(finiteNumber(fallbackCounter, 0))),
                outcome: ROOM_LOG_ACTION_OUTCOME_UNKNOWN,
                text: "?",
                missing: true,
            };
        }
        return {
            counter: Math.max(0, Math.floor(finiteNumber(action.counter, fallbackCounter))),
            outcome: String(action.outcome || ROOM_LOG_ACTION_OUTCOME_UNKNOWN),
            text: String(action.text || "?"),
            missing: action.missing === true,
        };
    }

    function sanitizeRoomLogSession(session) {
        if (!session || typeof session !== "object") {
            return null;
        }
        const startedAt = Math.max(0, Math.floor(finiteNumber(session.startedAt, 0)));
        const actions = Array.isArray(session.actions) ? session.actions.map((action) => sanitizeRoomLogAction(action)) : [];
        return {
            id: String(session.id || `room-log-${startedAt}`),
            startedAt,
            endedAt: Math.max(0, Math.floor(finiteNumber(session.endedAt, 0))),
            runKey: String(session.runKey || ""),
            roomKey: String(session.roomKey || ""),
            mode: String(session.mode || "skilling"),
            skillHrid: String(session.skillHrid || ""),
            skillName: String(session.skillName || "--"),
            recommendedLevel: Math.max(0, Math.floor(finiteNumber(session.recommendedLevel, 0))),
            successRate: clamp01(finiteNumber(session.successRate, 0)),
            doubleChance: clamp01(finiteNumber(session.doubleChance, 0)),
            progressPerAction: Math.max(0, finiteNumber(session.progressPerAction, 0)),
            experiencePerAction: Math.max(0, finiteNumber(session.experiencePerAction, 0)),
            predictedExperience: Math.max(
                0,
                finiteNumber(session.predictedExperience, finiteNumber(session.experiencePerAction, 0))
            ),
            actualExperienceGain: Math.max(0, finiteNumber(session.actualExperienceGain, 0)),
            startSkillExperience: Math.max(0, finiteNumber(session.startSkillExperience, 0)),
            endSkillExperience: Math.max(0, finiteNumber(session.endSkillExperience, 0)),
            totalExperience: Math.max(0, finiteNumber(session.totalExperience, 0)),
            targetWorkValue: Math.max(0, finiteNumber(session.targetWorkValue, 0)),
            currentWorkValue: Math.max(0, finiteNumber(session.currentWorkValue, 0)),
            currentProgressPct: Math.max(0, finiteNumber(session.currentProgressPct, 0)),
            targetLevel: Math.max(0, Math.floor(finiteNumber(session.targetLevel, 0))),
            currentEnhLevel: Math.max(0, Math.floor(finiteNumber(session.currentEnhLevel, 0))),
            actions,
            incomplete: session.incomplete === true,
            incompleteReasons: Array.isArray(session.incompleteReasons)
                ? Array.from(new Set(session.incompleteReasons.map((reason) => String(reason || "").trim()).filter(Boolean)))
                : [],
            completed: session.completed === true,
        };
    }

    function persistRoomLogStorage() {
        const payload = {
            sessions: trimRoomLogSessions(roomLogSessions),
            active: sanitizeRoomLogSession(activeRoomLogSession),
        };
        try {
            localStorage.setItem(ROOM_LOG_STORAGE_KEY, JSON.stringify(payload));
        } catch (_error) {
            // Ignore storage errors.
        }
    }

    function loadRoomLogStorage() {
        const fallback = createEmptyRoomLogStorage();
        try {
            const raw = localStorage.getItem(ROOM_LOG_STORAGE_KEY);
            if (!raw) {
                return fallback;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return fallback;
            }
            const sessions = Array.isArray(parsed.sessions)
                ? trimRoomLogSessions(parsed.sessions.map((entry) => sanitizeRoomLogSession(entry)).filter(Boolean))
                : [];
            const active = sanitizeRoomLogSession(parsed.active);
            return {
                sessions,
                active,
            };
        } catch (_error) {
            return fallback;
        }
    }

    function getRoomLogFloatingPanel() {
        return document.getElementById(ROOM_LOG_FLOAT_ID);
    }

    function refreshRoomLogPanelIfVisible() {
        const panel = getRoomLogFloatingPanel();
        if (!panel || panel.hasAttribute("hidden")) {
            return;
        }
        renderRoomLogPanel();
    }

    function markRoomLogSessionIncomplete(session, reason) {
        if (!session || typeof session !== "object") {
            return;
        }
        session.incomplete = true;
        if (!Array.isArray(session.incompleteReasons)) {
            session.incompleteReasons = [];
        }
        const normalized = String(reason || "").trim();
        if (normalized && !session.incompleteReasons.includes(normalized)) {
            session.incompleteReasons.push(normalized);
        }
    }

    function getRoomLogRunKey(state) {
        const labyrinth = state?.characterLabyrinth;
        if (!labyrinth) {
            return "";
        }
        const startedAt = String(labyrinth.startedAt || "");
        const floor = Math.max(0, Math.floor(finiteNumber(labyrinth.currentFloor, 0)));
        return `${startedAt}|${floor}`;
    }

    function buildRoomLogSessionKey(state, roomContext, mode) {
        if (!roomContext) {
            return "";
        }
        return [
            getRoomLogRunKey(state),
            String(roomContext.roomKey || ""),
            String(roomContext.skillHrid || ""),
            String(mode || "skilling"),
        ].join("|");
    }

    function getCurrentSkillingRoomContext(state) {
        const roomKey = getCurrentPathRoomKey(state);
        if (!roomKey) {
            return null;
        }
        const room = getRoomAtKey(state, roomKey);
        if (!room || room.roomType !== LABYRINTH_SKILLING_ROOM_TYPE) {
            return null;
        }
        const skillHrid = String(room.skillHrid || "");
        return {
            roomKey,
            roomType: String(room.roomType || ""),
            skillHrid,
            skillName: getSkillNameByHrid(skillHrid),
            recommendedLevel: Math.max(0, Math.floor(finiteNumber(room.recommendedLevel, 0))),
        };
    }

    function getCombatMonsterDisplayName(monsterHrid, initClientData) {
        const hrid = String(monsterHrid || "");
        if (!hrid) {
            return t("roomLogModeCombat");
        }
        const tail = hrid.split("/").pop() || hrid;
        const monster = initClientData?.combatMonsterDetailMap?.[hrid];
        if (isChineseUi()) {
            const localizedByTail = LABYRINTH_MONSTER_NAME_ZH_BY_TAIL[tail];
            if (localizedByTail) {
                return String(localizedByTail);
            }
            const localized = LABYRINTH_MONSTER_NAME_ZH_MAP[hrid];
            if (localized) {
                return String(localized);
            }
        }
        return String(monster?.name || tail || hrid);
    }

    function getCurrentCombatRoomContext(state) {
        const roomKey = getCurrentPathRoomKey(state);
        if (!roomKey) {
            return null;
        }
        const room = getRoomAtKey(state, roomKey);
        if (!room || room.roomType !== LABYRINTH_COMBAT_ROOM_TYPE) {
            return null;
        }
        const initClientData = getInitClientData();
        const monsterHrid = String(room.monsterHrid || "");
        return {
            roomKey,
            roomType: String(room.roomType || ""),
            skillHrid: "",
            skillName: getCombatMonsterDisplayName(monsterHrid, initClientData),
            recommendedLevel: Math.max(0, Math.floor(finiteNumber(room.recommendedLevel, 0))),
        };
    }

    function buildRoomLogSnapshot(roomProgress) {
        if (!roomProgress || typeof roomProgress !== "object") {
            return null;
        }
        const isEnhancing = roomProgress.targetLevel !== null && roomProgress.targetLevel !== undefined;
        const targetWorkValue = Math.max(0, finiteNumber(roomProgress.targetWorkValue, 0));
        let currentProgressRatio = clamp01(finiteNumber(roomProgress.currentProgress, 0));
        let currentWorkValue = Math.max(0, finiteNumber(roomProgress.currentWorkValue, 0));
        if (targetWorkValue > 0 && currentWorkValue <= 0 && currentProgressRatio > 0) {
            currentWorkValue = targetWorkValue * currentProgressRatio;
        }
        if (targetWorkValue > 0) {
            currentProgressRatio = clamp01(currentWorkValue / targetWorkValue);
        }
        return {
            isEnhancing,
            actionCounter: Math.max(0, Math.floor(finiteNumber(roomProgress.actionCounter, 0))),
            successRate: normalizeChance(roomProgress.successRate),
            doubleChance: normalizeChance(roomProgress.doubleProgressChance),
            progressPerAction: Math.max(0, finiteNumber(roomProgress.progressPerAction, 0)),
            targetWorkValue,
            currentWorkValue,
            currentProgressRatio,
            targetLevel: Math.max(0, Math.floor(finiteNumber(roomProgress.targetLevel, 0))),
            currentEnhLevel: Math.max(0, Math.floor(finiteNumber(roomProgress.currentEnhLevel, 0))),
            actionTimeMs: Math.max(1, finiteNumber(roomProgress.actionTimeMs, 1)),
        };
    }

    function computeSkillingRoomExperiencePerRoom(state, _initClientData, roomContext) {
        if (!state || !roomContext?.skillHrid) {
            return 0;
        }
        const skillId = skillHridToSkillId(roomContext.skillHrid);
        if (!skillId) {
            return 0;
        }
        const actionTypeHrid = skillIdToActionTypeHrid(skillId);
        if (!actionTypeHrid) {
            return 0;
        }

        const liveRoom = getRoomAtKey(state, roomContext.roomKey);
        const room = liveRoom || {
            roomType: LABYRINTH_SKILLING_ROOM_TYPE,
            skillHrid: roomContext.skillHrid,
            recommendedLevel: roomContext.recommendedLevel,
            roomKey: roomContext.roomKey,
        };
        const roomLevel = Math.max(0, finiteNumber(room.recommendedLevel, roomContext.recommendedLevel));
        const baseExperiencePerRoom = roomLevel * 50;
        if (baseExperiencePerRoom <= 0) {
            return 0;
        }

        const equipmentMetrics = getSkillingActionMetricsFromState(
            state,
            skillId,
            actionTypeHrid,
            "equipmentActionTypeBuffsDict"
        );
        const consumableMetrics = getSkillingActionMetricsFromState(
            state,
            skillId,
            actionTypeHrid,
            "consumableActionTypeBuffsDict"
        );
        const labyrinthUpgradeLevels = getLabyrinthUpgradeLevels();
        const labyrinthExperienceBonus = getLabyrinthUpgradeExperienceBonus(labyrinthUpgradeLevels);
        const experienceBonusDetail = computeSkillingExperienceBonusForRoom(
            state,
            skillId,
            actionTypeHrid,
            equipmentMetrics,
            consumableMetrics,
            createEmptySkillingMetrics(),
            true,
            labyrinthExperienceBonus
        );
        const experienceMultiplier = Math.max(0, finiteNumber(experienceBonusDetail?.multiplier, 1));
        return Math.max(0, baseExperiencePerRoom * experienceMultiplier);
    }

    function computeSkillingRoomExperiencePerAction(state, initClientData, roomContext) {
        return computeSkillingRoomExperiencePerRoom(state, initClientData, roomContext);
    }

    function refreshRoomLogSessionActualExperience(session, state) {
        if (!session || !state || !session.skillHrid) {
            return NaN;
        }
        const latestSkillExperience = getSkillExperienceValue(state.characterSkillMap, session.skillHrid);
        if (Number.isFinite(latestSkillExperience)) {
            session.endSkillExperience = latestSkillExperience;
        }
        const startSkillExperience = finiteNumber(session.startSkillExperience, NaN);
        const endSkillExperience = finiteNumber(session.endSkillExperience, NaN);
        if (!Number.isFinite(startSkillExperience) || !Number.isFinite(endSkillExperience)) {
            return NaN;
        }
        const gained = Math.max(0, endSkillExperience - startSkillExperience);
        session.actualExperienceGain = gained;
        return gained;
    }

    function resolveRoomLogTotalExperience(session, actualGain) {
        const safeActual = finiteNumber(actualGain, NaN);
        if (Number.isFinite(safeActual) && (safeActual > 0 || session?.completed)) {
            return Math.max(0, safeActual);
        }
        return Math.max(
            0,
            finiteNumber(session?.predictedExperience, finiteNumber(session?.experiencePerAction, finiteNumber(session?.totalExperience, 0)))
        );
    }

    function refreshRoomLogSessionExperience(session, state, roomContext, snapshot) {
        if (!session || !roomContext) {
            return;
        }
        const initClientData = getInitClientData();
        // Keep the legacy field name for backward compatibility, but this value is room-completion EXP.
        const predicted = computeSkillingRoomExperiencePerRoom(state, initClientData, roomContext);
        session.experiencePerAction = Math.max(0, finiteNumber(predicted, 0));
        session.predictedExperience = session.experiencePerAction;
        const actualGain = refreshRoomLogSessionActualExperience(session, state);
        session.totalExperience = resolveRoomLogTotalExperience(session, actualGain);
    }

    function createRoomLogUnknownAction(counter) {
        return {
            counter: Math.max(0, Math.floor(finiteNumber(counter, 0))),
            outcome: ROOM_LOG_ACTION_OUTCOME_UNKNOWN,
            text: "?",
            missing: true,
        };
    }

    function deriveRoomLogAction(prevSnapshot, nextSnapshot, actionCounter) {
        if (!nextSnapshot || typeof nextSnapshot !== "object") {
            return createRoomLogUnknownAction(actionCounter);
        }

        if (nextSnapshot.isEnhancing) {
            const previousLevel = Math.max(0, Math.floor(finiteNumber(prevSnapshot?.currentEnhLevel, 0)));
            const nextLevel = Math.max(0, Math.floor(finiteNumber(nextSnapshot.currentEnhLevel, 0)));
            const levelDelta = nextLevel - previousLevel;
            let outcome = ROOM_LOG_ACTION_OUTCOME_FAIL;
            if (levelDelta >= 2) {
                outcome = ROOM_LOG_ACTION_OUTCOME_DOUBLE;
            } else if (levelDelta >= 1) {
                outcome = ROOM_LOG_ACTION_OUTCOME_SUCCESS;
            }
            const text = `+${nextLevel}`;
            return {
                counter: Math.max(0, Math.floor(finiteNumber(actionCounter, 0))),
                outcome,
                text,
                missing: false,
            };
        }

        const prevWork = Math.max(0, finiteNumber(prevSnapshot?.currentWorkValue, 0));
        const nextWork = Math.max(0, finiteNumber(nextSnapshot.currentWorkValue, 0));
        const workDelta = nextWork - prevWork;
        const prevProgress = clamp01(finiteNumber(prevSnapshot?.currentProgressRatio, 0));
        const nextProgress = clamp01(finiteNumber(nextSnapshot.currentProgressRatio, 0));
        const progressDelta = nextProgress - prevProgress;
        const expectedSingle = Math.max(0, finiteNumber(prevSnapshot?.progressPerAction, 0));

        let outcome = ROOM_LOG_ACTION_OUTCOME_FAIL;
        if (workDelta > 0.0001 || progressDelta > 0.0001) {
            if (expectedSingle > 0 && workDelta >= expectedSingle * 1.8) {
                outcome = ROOM_LOG_ACTION_OUTCOME_DOUBLE;
            } else {
                outcome = ROOM_LOG_ACTION_OUTCOME_SUCCESS;
            }
        }

        return {
            counter: Math.max(0, Math.floor(finiteNumber(actionCounter, 0))),
            outcome,
            text: `${formatRoomLogPercent(nextProgress * 100)}%`,
            missing: false,
        };
    }

    function applyRoomLogSnapshotToSession(session, snapshot) {
        if (!session || !snapshot) {
            return;
        }
        session.successRate = snapshot.successRate;
        session.doubleChance = snapshot.doubleChance;
        session.progressPerAction = snapshot.progressPerAction;
        session.targetWorkValue = snapshot.targetWorkValue;
        session.currentWorkValue = snapshot.currentWorkValue;
        session.currentProgressPct = snapshot.currentProgressRatio * 100;
        session.targetLevel = snapshot.targetLevel;
        session.currentEnhLevel = snapshot.currentEnhLevel;
        session.totalExperience = Math.max(0, finiteNumber(session.totalExperience, finiteNumber(session.experiencePerAction, 0)));
    }

    function appendRoomLogAction(session, nextSnapshot) {
        if (!session || !nextSnapshot) {
            return;
        }
        const prevSnapshot = session.lastSnapshot || null;
        const prevCounter = Math.max(0, Math.floor(finiteNumber(prevSnapshot?.actionCounter, 0)));
        const nextCounter = Math.max(0, Math.floor(finiteNumber(nextSnapshot.actionCounter, 0)));

        if (!prevSnapshot) {
            session.lastSnapshot = nextSnapshot;
            session.lastActionCounter = nextCounter;
            applyRoomLogSnapshotToSession(session, nextSnapshot);
            return;
        }

        if (nextCounter <= prevCounter) {
            session.lastSnapshot = nextSnapshot;
            session.lastActionCounter = nextCounter;
            applyRoomLogSnapshotToSession(session, nextSnapshot);
            return;
        }

        if (!Array.isArray(session.actions)) {
            session.actions = [];
        }

        if (nextCounter - prevCounter > 1) {
            markRoomLogSessionIncomplete(session, "action_gap");
            for (let counter = prevCounter + 1; counter < nextCounter; counter += 1) {
                session.actions.push(createRoomLogUnknownAction(counter));
            }
        }

        const action = deriveRoomLogAction(prevSnapshot, nextSnapshot, nextCounter);
        session.actions.push(action);
        if (session.actions.length > 200) {
            markRoomLogSessionIncomplete(session, "action_overflow");
            session.actions = session.actions.slice(session.actions.length - 200);
        }

        session.lastSnapshot = nextSnapshot;
        session.lastActionCounter = nextCounter;
        applyRoomLogSnapshotToSession(session, nextSnapshot);
    }

    function isRoomLogSessionComplete(session) {
        if (!session || typeof session !== "object") {
            return false;
        }
        if (session.mode === "combat") {
            return true;
        }
        if (session.mode === "enhancing") {
            const targetLevel = Math.max(0, Math.floor(finiteNumber(session.targetLevel, 0)));
            const currentLevel = Math.max(0, Math.floor(finiteNumber(session.currentEnhLevel, 0)));
            return targetLevel > 0 && currentLevel >= targetLevel;
        }
        const targetWork = Math.max(0, finiteNumber(session.targetWorkValue, 0));
        const currentWork = Math.max(0, finiteNumber(session.currentWorkValue, 0));
        const progressPct = Math.max(0, finiteNumber(session.currentProgressPct, 0));
        if (targetWork > 0) {
            return currentWork >= targetWork - 0.0001 || progressPct >= 99.9;
        }
        return progressPct >= 99.9;
    }

    function finalizeActiveRoomLogSession(options = {}) {
        if (!activeRoomLogSession) {
            return;
        }
        const session = activeRoomLogSession;
        const latestState = getGameState();
        const fallbackContext = buildRoomLogContextFromSession(session);
        if (latestState && fallbackContext) {
            refreshRoomLogSessionExperience(session, latestState, fallbackContext, session.lastSnapshot || null);
        }
        if (options && options.forceIncompleteReason) {
            markRoomLogSessionIncomplete(session, options.forceIncompleteReason);
        }

        let completed;
        if (options && typeof options.completed === "boolean") {
            completed = options.completed;
        } else {
            completed = isRoomLogSessionComplete(session);
        }

        if (!completed) {
            markRoomLogSessionIncomplete(session, "not_complete");
        }

        session.endedAt = Date.now();
        session.completed = completed && !session.incomplete;

        const stored = sanitizeRoomLogSession(session);
        if (stored) {
            roomLogSessions.unshift(stored);
            roomLogSessions = trimRoomLogSessions(roomLogSessions);
        }

        activeRoomLogSession = null;
        persistRoomLogStorage();
        refreshRoomLogPanelIfVisible();
    }

    function ensureRoomLogSession(state, roomContext, snapshot) {
        if (!roomContext || !snapshot) {
            return null;
        }
        const mode = snapshot.isEnhancing ? "enhancing" : "skilling";
        const sessionKey = buildRoomLogSessionKey(state, roomContext, mode);
        if (!sessionKey) {
            return null;
        }

        if (activeRoomLogSession && activeRoomLogSession.sessionKey !== sessionKey) {
            finalizeActiveRoomLogSession({ forceIncompleteReason: "room_switch" });
        }

        if (activeRoomLogSession) {
            return activeRoomLogSession;
        }

        const now = Date.now();
        const startSkillExperience = getSkillExperienceValue(state?.characterSkillMap, roomContext.skillHrid);
        activeRoomLogSession = {
            id: `room-log-${now}-${Math.random().toString(36).slice(2, 8)}`,
            startedAt: now,
            endedAt: 0,
            runKey: getRoomLogRunKey(state),
            sessionKey,
            roomKey: String(roomContext.roomKey || ""),
            mode,
            skillHrid: String(roomContext.skillHrid || ""),
            skillName: String(roomContext.skillName || "--"),
            recommendedLevel: Math.max(0, Math.floor(finiteNumber(roomContext.recommendedLevel, 0))),
            successRate: snapshot.successRate,
            doubleChance: snapshot.doubleChance,
            progressPerAction: snapshot.progressPerAction,
            experiencePerAction: 0,
            predictedExperience: 0,
            actualExperienceGain: 0,
            startSkillExperience: Number.isFinite(startSkillExperience) ? startSkillExperience : 0,
            endSkillExperience: Number.isFinite(startSkillExperience) ? startSkillExperience : 0,
            totalExperience: 0,
            targetWorkValue: snapshot.targetWorkValue,
            currentWorkValue: snapshot.currentWorkValue,
            currentProgressPct: snapshot.currentProgressRatio * 100,
            targetLevel: snapshot.targetLevel,
            currentEnhLevel: snapshot.currentEnhLevel,
            actions: [],
            lastActionCounter: snapshot.actionCounter,
            lastSnapshot: snapshot,
            incomplete: false,
            incompleteReasons: [],
            completed: false,
        };
        refreshRoomLogSessionExperience(activeRoomLogSession, state, roomContext, snapshot);
        if (snapshot.actionCounter > 0) {
            markRoomLogSessionIncomplete(activeRoomLogSession, "start_midway");
        }
        persistRoomLogStorage();
        return activeRoomLogSession;
    }

    function ensureCombatRoomLogSession(state, roomContext) {
        if (!roomContext) {
            return null;
        }
        const mode = "combat";
        const sessionKey = buildRoomLogSessionKey(state, roomContext, mode);
        if (!sessionKey) {
            return null;
        }

        if (activeRoomLogSession && activeRoomLogSession.sessionKey !== sessionKey) {
            finalizeActiveRoomLogSession({ forceIncompleteReason: "room_switch" });
        }

        if (activeRoomLogSession) {
            return activeRoomLogSession;
        }

        const now = Date.now();
        activeRoomLogSession = {
            id: `room-log-${now}-${Math.random().toString(36).slice(2, 8)}`,
            startedAt: now,
            endedAt: 0,
            runKey: getRoomLogRunKey(state),
            sessionKey,
            roomKey: String(roomContext.roomKey || ""),
            mode,
            skillHrid: "",
            skillName: String(roomContext.skillName || t("roomLogModeCombat")),
            recommendedLevel: Math.max(0, Math.floor(finiteNumber(roomContext.recommendedLevel, 0))),
            successRate: 0,
            doubleChance: 0,
            progressPerAction: 0,
            experiencePerAction: 0,
            predictedExperience: 0,
            actualExperienceGain: 0,
            startSkillExperience: 0,
            endSkillExperience: 0,
            totalExperience: 0,
            targetWorkValue: 0,
            currentWorkValue: 0,
            currentProgressPct: 0,
            targetLevel: 0,
            currentEnhLevel: 0,
            actions: [],
            lastActionCounter: 0,
            lastSnapshot: null,
            incomplete: false,
            incompleteReasons: [],
            completed: false,
        };
        persistRoomLogStorage();
        refreshRoomLogPanelIfVisible();
        return activeRoomLogSession;
    }

    function handleRoomLogProgressMessage(roomProgressMessage) {
        if (!roomProgressMessage || typeof roomProgressMessage !== "object") {
            return;
        }
        const state = getGameState();
        const roomContext = getCurrentSkillingRoomContext(state);
        if (!roomContext) {
            return;
        }
        const snapshot = buildRoomLogSnapshot(roomProgressMessage);
        if (!snapshot) {
            return;
        }
        const session = ensureRoomLogSession(state, roomContext, snapshot);
        if (!session) {
            return;
        }
        appendRoomLogAction(session, snapshot);
        refreshRoomLogSessionExperience(session, state, roomContext, snapshot);
        persistRoomLogStorage();
        refreshRoomLogPanelIfVisible();
    }

    function syncRoomLogSessionState(state) {
        if (!state?.characterLabyrinth) {
            if (activeRoomLogSession) {
                finalizeActiveRoomLogSession({ forceIncompleteReason: "left_labyrinth", completed: false });
            }
            return;
        }

        const combatRoomContext = getCurrentCombatRoomContext(state);
        const isCombatRunning = Boolean(
            combatRoomContext && Array.isArray(state.labyrinthBattleMonsters) && state.labyrinthBattleMonsters.length > 0
        );
        if (isCombatRunning) {
            ensureCombatRoomLogSession(state, combatRoomContext);
            return;
        }

        if (!activeRoomLogSession) {
            return;
        }

        if (activeRoomLogSession.mode === "combat") {
            finalizeActiveRoomLogSession({ completed: true });
            return;
        }

        const roomContext = getCurrentSkillingRoomContext(state);
        if (!roomContext || !state.labyrinthRoomProgress) {
            finalizeActiveRoomLogSession();
            return;
        }
        const snapshot = buildRoomLogSnapshot(state.labyrinthRoomProgress);
        if (!snapshot) {
            return;
        }
        const mode = snapshot.isEnhancing ? "enhancing" : "skilling";
        const activeSessionKey = buildRoomLogSessionKey(state, roomContext, mode);
        if (activeRoomLogSession.sessionKey !== activeSessionKey) {
            finalizeActiveRoomLogSession({ forceIncompleteReason: "room_switch" });
            return;
        }
        activeRoomLogSession.lastSnapshot = snapshot;
        activeRoomLogSession.lastActionCounter = snapshot.actionCounter;
        applyRoomLogSnapshotToSession(activeRoomLogSession, snapshot);
        refreshRoomLogSessionExperience(activeRoomLogSession, state, roomContext, snapshot);
    }

    function initializeRoomLogState() {
        const loaded = loadRoomLogStorage();
        roomLogSessions = trimRoomLogSessions(loaded.sessions);
        activeRoomLogSession = null;

        const staleActive = loaded.active;
        if (staleActive) {
            markRoomLogSessionIncomplete(staleActive, "reload_recovered");
            staleActive.completed = false;
            staleActive.endedAt = Date.now();
            const stored = sanitizeRoomLogSession(staleActive);
            if (stored) {
                roomLogSessions.unshift(stored);
                roomLogSessions = trimRoomLogSessions(roomLogSessions);
            }
        }

        persistRoomLogStorage();
    }

    function isSimulatorBridgePage() {
        const host = String(window.location.host || "").toLowerCase();
        const path = String(window.location.pathname || "");
        return host === "shykai.github.io" && path.includes("/MWICombatSimulatorTest/dist");
    }

    function normalizeSimulatorBridgeUrl(value) {
        const raw = String(value || "").trim();
        if (!raw) {
            return SIMULATOR_BRIDGE_DEFAULT_URL;
        }
        try {
            const url = new URL(raw, window.location.href);
            if (!/^https?:$/i.test(url.protocol)) {
                return SIMULATOR_BRIDGE_DEFAULT_URL;
            }
            return url.toString();
        } catch (_error) {
            return SIMULATOR_BRIDGE_DEFAULT_URL;
        }
    }

    function getSimulatorBridgeUrl() {
        try {
            const fromStorage = localStorage.getItem(SIMULATOR_BRIDGE_URL_STORAGE_KEY);
            return normalizeSimulatorBridgeUrl(fromStorage);
        } catch (_error) {
            return SIMULATOR_BRIDGE_DEFAULT_URL;
        }
    }

    function migrateLegacySimulatorBridgeUrl() {
        try {
            const raw = localStorage.getItem(SIMULATOR_BRIDGE_URL_STORAGE_KEY);
            if (!raw) {
                return;
            }
            const normalized = normalizeSimulatorBridgeUrl(raw);
            const normalizedLower = normalized.toLowerCase();
            const defaultLower = String(SIMULATOR_BRIDGE_DEFAULT_URL || "").toLowerCase();
            if (defaultLower && normalizedLower.startsWith(defaultLower)) {
                return;
            }
            const shouldMigrate = SIMULATOR_BRIDGE_LEGACY_URL_PREFIXES.some((legacyPrefix) => {
                return normalizedLower.startsWith(String(legacyPrefix || "").toLowerCase());
            });
            if (shouldMigrate) {
                localStorage.setItem(SIMULATOR_BRIDGE_URL_STORAGE_KEY, SIMULATOR_BRIDGE_DEFAULT_URL);
            }
        } catch (_error) {
            // Ignore storage write errors.
        }
    }

    function encodeSimulatorBridgePayload(payload) {
        const json = JSON.stringify(payload || {});
        const lz = typeof LZString !== "undefined" ? LZString : null;
        if (lz && typeof lz.compressToEncodedURIComponent === "function") {
            const encoded = lz.compressToEncodedURIComponent(json);
            if (encoded) {
                return encoded;
            }
        }
        return encodeURIComponent(json);
    }

    function decodeSimulatorBridgePayload(encoded) {
        const raw = String(encoded || "");
        if (!raw) {
            return null;
        }
        const lz = typeof LZString !== "undefined" ? LZString : null;
        if (lz && typeof lz.decompressFromEncodedURIComponent === "function") {
            try {
                const decompressed = lz.decompressFromEncodedURIComponent(raw);
                if (decompressed) {
                    return JSON.parse(decompressed);
                }
            } catch (_error) {
                // Fall back to plain decoding.
            }
        }
        try {
            return JSON.parse(decodeURIComponent(raw));
        } catch (_error) {
            return null;
        }
    }

    function extractSimulatorBridgePayloadFromLocation() {
        try {
            const searchParams = new URLSearchParams(window.location.search || "");
            const searchValue = searchParams.get(SIMULATOR_BRIDGE_PAYLOAD_PARAM);
            if (searchValue) {
                return decodeSimulatorBridgePayload(searchValue);
            }
        } catch (_error) {
            // Continue to hash parsing.
        }

        try {
            const hashRaw = String(window.location.hash || "").replace(/^#/, "");
            if (!hashRaw) {
                return null;
            }
            const hashParams = new URLSearchParams(hashRaw);
            const hashValue = hashParams.get(SIMULATOR_BRIDGE_PAYLOAD_PARAM);
            if (hashValue) {
                return decodeSimulatorBridgePayload(hashValue);
            }
        } catch (_error) {
            return null;
        }
        return null;
    }

    function clearSimulatorBridgePayloadFromLocation() {
        try {
            const url = new URL(window.location.href);
            const searchParams = new URLSearchParams(url.search);
            searchParams.delete(SIMULATOR_BRIDGE_PAYLOAD_PARAM);
            url.search = searchParams.toString();

            const hashRaw = String(url.hash || "").replace(/^#/, "");
            if (hashRaw) {
                const hashParams = new URLSearchParams(hashRaw);
                hashParams.delete(SIMULATOR_BRIDGE_PAYLOAD_PARAM);
                const hash = hashParams.toString();
                url.hash = hash ? `#${hash}` : "";
            }

            history.replaceState(null, "", url.toString());
        } catch (_error) {
            // Ignore URL cleanup errors.
        }
    }

    function buildSimulatorBridgeLaunchUrl(payload) {
        const baseUrl = normalizeSimulatorBridgeUrl(getSimulatorBridgeUrl());
        const encoded = encodeSimulatorBridgePayload(payload);
        const url = new URL(baseUrl, window.location.href);
        url.hash = `${SIMULATOR_BRIDGE_PAYLOAD_PARAM}=${encoded}`;
        return url.toString();
    }

    function normalizeCombatSimTrials(value) {
        const n = Math.floor(Number(value));
        if (!Number.isFinite(n)) {
            return DEFAULT_COMBAT_SIM_TRIALS;
        }
        if (n < MIN_COMBAT_SIM_TRIALS) {
            return MIN_COMBAT_SIM_TRIALS;
        }
        if (n > MAX_COMBAT_SIM_TRIALS) {
            return MAX_COMBAT_SIM_TRIALS;
        }
        return n;
    }

    function loadCombatSimTrialsSetting() {
        try {
            const raw = localStorage.getItem(COMBAT_SIM_TRIALS_STORAGE_KEY);
            if (raw === null || raw === undefined) {
                return DEFAULT_COMBAT_SIM_TRIALS;
            }
            const trimmed = String(raw).trim();
            if (!trimmed) {
                return DEFAULT_COMBAT_SIM_TRIALS;
            }
            return normalizeCombatSimTrials(trimmed);
        } catch (_error) {
            return DEFAULT_COMBAT_SIM_TRIALS;
        }
    }

    function saveCombatSimTrialsSetting(value) {
        const normalized = normalizeCombatSimTrials(Number(value));
        try {
            localStorage.setItem(COMBAT_SIM_TRIALS_STORAGE_KEY, String(normalized));
        } catch (_error) {
            // Ignore storage errors and keep runtime value.
        }
        return normalized;
    }

    function loadAutomationCombatSimTrialsSetting() {
        try {
            const raw = localStorage.getItem(AUTOMATION_COMBAT_SIM_TRIALS_STORAGE_KEY);
            if (raw === null || raw === undefined) {
                return DEFAULT_AUTOMATION_COMBAT_SIM_TRIALS;
            }
            const trimmed = String(raw).trim();
            if (!trimmed) {
                return DEFAULT_AUTOMATION_COMBAT_SIM_TRIALS;
            }
            return normalizeCombatSimTrials(trimmed);
        } catch (_error) {
            return DEFAULT_AUTOMATION_COMBAT_SIM_TRIALS;
        }
    }

    function saveAutomationCombatSimTrialsSetting(value) {
        const normalized = normalizeCombatSimTrials(Number(value));
        try {
            localStorage.setItem(AUTOMATION_COMBAT_SIM_TRIALS_STORAGE_KEY, String(normalized));
        } catch (_error) {
            // Ignore storage errors and keep runtime value.
        }
        return normalized;
    }

    function normalizeAutomationTargetWinRate(value) {
        let n = Number(value);
        if (!Number.isFinite(n)) {
            return DEFAULT_AUTOMATION_TARGET_WIN_RATE;
        }
        if (n >= 0 && n <= 1) {
            n *= 100;
        }
        if (n < 0) {
            n = 0;
        }
        if (n > 100) {
            n = 100;
        }
        return Math.round(n * 10) / 10;
    }

    function loadAutomationTargetWinRateSetting() {
        try {
            const raw = localStorage.getItem(AUTOMATION_TARGET_WIN_RATE_STORAGE_KEY);
            if (raw === null || raw === undefined) {
                return DEFAULT_AUTOMATION_TARGET_WIN_RATE;
            }
            const trimmed = String(raw).trim();
            if (!trimmed) {
                return DEFAULT_AUTOMATION_TARGET_WIN_RATE;
            }
            return normalizeAutomationTargetWinRate(trimmed);
        } catch (_error) {
            return DEFAULT_AUTOMATION_TARGET_WIN_RATE;
        }
    }

    function saveAutomationTargetWinRateSetting(value) {
        const normalized = normalizeAutomationTargetWinRate(value);
        try {
            localStorage.setItem(AUTOMATION_TARGET_WIN_RATE_STORAGE_KEY, String(normalized));
        } catch (_error) {
            // Ignore storage errors and keep runtime value.
        }
        return normalized;
    }

    function roundForSignature(value) {
        const n = finiteNumber(value, 0);
        return Math.round(n * 1000) / 1000;
    }

    function isLikelyGameState(state) {
        return Boolean(
            state &&
                typeof state === "object" &&
                (Object.prototype.hasOwnProperty.call(state, "characterLabyrinth") ||
                    Object.prototype.hasOwnProperty.call(state, "combatUnit") ||
                    Object.prototype.hasOwnProperty.call(state, "gameConn"))
        );
    }

    function findGameStateFromFiber(rootFiber) {
        if (!rootFiber || typeof rootFiber !== "object") {
            return null;
        }
        const queue = [rootFiber];
        const visited = new Set();
        let steps = 0;
        while (queue.length > 0 && steps < 20000) {
            const fiber = queue.shift();
            if (!fiber || typeof fiber !== "object" || visited.has(fiber)) {
                continue;
            }
            visited.add(fiber);
            steps += 1;

            const state = fiber.stateNode?.state;
            if (isLikelyGameState(state)) {
                return state;
            }

            if (fiber.child) {
                queue.push(fiber.child);
            }
            if (fiber.sibling) {
                queue.push(fiber.sibling);
            }
        }
        return null;
    }

    function getGameState() {
        const gamePage = document.querySelector('[class^="GamePage"]');
        if (gamePage) {
            const reactKey = Object.keys(gamePage).find((key) => key.startsWith("__reactFiber$"));
            if (reactKey) {
                const fiberNode = gamePage[reactKey];
                const directState = fiberNode?.return?.stateNode?.state || null;
                if (isLikelyGameState(directState)) {
                    return directState;
                }
            }
        }

        const rootElement = document.getElementById("root");
        let rootContainer = rootElement?._reactRootContainer || null;
        if (!rootContainer) {
            const fallbackRoot = Array.from(document.querySelectorAll("div")).find((el) =>
                Object.prototype.hasOwnProperty.call(el, "_reactRootContainer")
            );
            rootContainer = fallbackRoot?._reactRootContainer || null;
        }
        return findGameStateFromFiber(rootContainer?.current || null);
    }

    function getInitClientData() {
        const raw = localStorage.getItem("initClientData");
        if (!raw) {
            return null;
        }

        if (cachedInitClientData && cachedInitClientDataRaw === raw) {
            return cachedInitClientData;
        }

        const lz = typeof LZString !== "undefined" ? LZString : null;
        const parsers = [
            () => JSON.parse(raw),
            () => {
                if (!lz || typeof lz.decompressFromUTF16 !== "function") {
                    return null;
                }
                const decompressed = lz.decompressFromUTF16(raw);
                return decompressed ? JSON.parse(decompressed) : null;
            },
            () => {
                if (!lz || typeof lz.decompressFromBase64 !== "function") {
                    return null;
                }
                const decompressed = lz.decompressFromBase64(raw);
                return decompressed ? JSON.parse(decompressed) : null;
            },
        ];

        for (const parser of parsers) {
            try {
                const parsed = parser();
                if (parsed && typeof parsed === "object") {
                    cachedInitClientData = parsed;
                    cachedInitClientDataRaw = raw;
                    return cachedInitClientData;
                }
            } catch (_error) {
                // Try next parser.
            }
        }

        console.error("[Lab Clear Rate] Failed to parse initClientData with all parsers.");
        return null;
    }

    function getContainerValue(container, key) {
        if (!container || key === undefined || key === null) {
            return undefined;
        }
        if (container instanceof Map) {
            return container.get(key);
        }
        return container[key];
    }

    function getContainerEntries(container) {
        if (!container) {
            return [];
        }
        if (container instanceof Map) {
            return Array.from(container.entries());
        }
        if (typeof container === "object") {
            return Object.entries(container);
        }
        return [];
    }

    function deepCloneJson(value) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof structuredClone === "function") {
            return structuredClone(value);
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_error) {
            return value;
        }
    }

    function stableStringify(value) {
        if (value === null || value === undefined) {
            return String(value);
        }
        const type = typeof value;
        if (type === "number" || type === "boolean") {
            return JSON.stringify(value);
        }
        if (type === "string") {
            return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
            return `[${value.map((item) => stableStringify(item)).join(",")}]`;
        }
        if (value instanceof Map) {
            const entries = Array.from(value.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
            return stableStringify(entries);
        }
        if (type === "object") {
            const keys = Object.keys(value).sort();
            const body = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",");
            return `{${body}}`;
        }
        return JSON.stringify(String(value));
    }

    function hashString(text) {
        const source = String(text || "");
        let hash = 2166136261;
        for (let i = 0; i < source.length; i += 1) {
            hash ^= source.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function normalizeTriggerList(rawList) {
        if (!Array.isArray(rawList)) {
            return [];
        }
        return rawList
            .map((trigger) => ({
                dependencyHrid: String(trigger?.dependencyHrid || ""),
                conditionHrid: String(trigger?.conditionHrid || ""),
                comparatorHrid: String(trigger?.comparatorHrid || ""),
                value: finiteNumber(trigger?.value, 0),
            }))
            .filter((trigger) => trigger.dependencyHrid && trigger.conditionHrid && trigger.comparatorHrid);
    }

    function skillHridToSkillId(skillHrid) {
        if (!skillHrid || typeof skillHrid !== "string") {
            return "";
        }
        const parts = skillHrid.split("/");
        return parts[parts.length - 1] || "";
    }

    function skillIdToActionTypeHrid(skillId) {
        return skillId ? `/action_types/${skillId}` : "";
    }

    function isGatheringSkillId(skillId) {
        return skillId === "milking" || skillId === "foraging" || skillId === "woodcutting";
    }

    function isGourmetSkillId(skillId) {
        return skillId === "cooking" || skillId === "brewing";
    }

    function isDoubleProgressBuffApplicable(skillId, buffTypeHrid) {
        if (buffTypeHrid === "/buff_types/gathering") {
            return isGatheringSkillId(skillId);
        }
        if (buffTypeHrid === "/buff_types/gourmet") {
            return isGourmetSkillId(skillId);
        }
        return false;
    }

    function sumBuffValue(buffs, predicate) {
        let total = 0;
        for (const buff of buffs) {
            if (!buff || !predicate(buff)) {
                continue;
            }
            total += Number(buff.flatBoost || 0);
            total += Number(buff.flatBoostLevelBonus || 0);
            total += Number(buff.ratioBoost || 0);
            total += Number(buff.ratioBoostLevelBonus || 0);
        }
        return total;
    }

    function getBuffAmount(buff) {
        if (!buff) {
            return 0;
        }
        return (
            finiteNumber(buff.flatBoost, 0) +
            finiteNumber(buff.flatBoostLevelBonus, 0) +
            finiteNumber(buff.ratioBoost, 0) +
            finiteNumber(buff.ratioBoostLevelBonus, 0)
        );
    }

    function createEmptySkillingMetrics() {
        return {
            skillLevelBonus: 0,
            efficiencyBonus: 0,
            actionSpeedBonus: 0,
            successBonus: 0,
            experienceBonus: 0,
            genericExperienceBonus: 0,
            skillingExperienceBonus: 0,
            skillExperienceBonus: 0,
            crateDoubleProgressBonus: 0,
            gatheringBonus: 0,
        };
    }

    function cloneSkillingMetrics(metrics) {
        return {
            skillLevelBonus: finiteNumber(metrics?.skillLevelBonus, 0),
            efficiencyBonus: finiteNumber(metrics?.efficiencyBonus, 0),
            actionSpeedBonus: finiteNumber(metrics?.actionSpeedBonus, 0),
            successBonus: finiteNumber(metrics?.successBonus, 0),
            experienceBonus: finiteNumber(metrics?.experienceBonus, 0),
            genericExperienceBonus: finiteNumber(metrics?.genericExperienceBonus, 0),
            skillingExperienceBonus: finiteNumber(metrics?.skillingExperienceBonus, 0),
            skillExperienceBonus: finiteNumber(metrics?.skillExperienceBonus, 0),
            crateDoubleProgressBonus: finiteNumber(metrics?.crateDoubleProgressBonus, 0),
            gatheringBonus: finiteNumber(metrics?.gatheringBonus, 0),
        };
    }

    function addSkillingMetrics(target, source) {
        if (!target || !source) {
            return target;
        }
        target.skillLevelBonus += finiteNumber(source.skillLevelBonus, 0);
        target.efficiencyBonus += finiteNumber(source.efficiencyBonus, 0);
        target.actionSpeedBonus += finiteNumber(source.actionSpeedBonus, 0);
        target.successBonus += finiteNumber(source.successBonus, 0);
        target.experienceBonus += finiteNumber(source.experienceBonus, 0);
        target.genericExperienceBonus += finiteNumber(source.genericExperienceBonus, 0);
        target.skillingExperienceBonus += finiteNumber(source.skillingExperienceBonus, 0);
        target.skillExperienceBonus += finiteNumber(source.skillExperienceBonus, 0);
        target.crateDoubleProgressBonus += finiteNumber(source.crateDoubleProgressBonus, 0);
        target.gatheringBonus += finiteNumber(source.gatheringBonus, 0);
        return target;
    }

    function buildLabyrinthUpgradeSkillingMetrics(levels) {
        const metrics = createEmptySkillingMetrics();
        metrics.actionSpeedBonus += getLabyrinthUpgradeLevel(levels, LABYRINTH_UPGRADE_KEY_SKILL_ACTION_SPEED) * LABYRINTH_UPGRADE_STEP_RATIO;
        metrics.efficiencyBonus += getLabyrinthUpgradeLevel(levels, LABYRINTH_UPGRADE_KEY_SKILLING_EFFICIENCY) * LABYRINTH_UPGRADE_STEP_RATIO;
        metrics.successBonus +=
            getLabyrinthUpgradeLevel(levels, LABYRINTH_UPGRADE_KEY_SKILLING_SUCCESS) *
            LABYRINTH_UPGRADE_SKILLING_SUCCESS_STEP_RATIO;
        metrics.crateDoubleProgressBonus +=
            getLabyrinthUpgradeLevel(levels, LABYRINTH_UPGRADE_KEY_SKILLING_DOUBLE_PROGRESS) * LABYRINTH_UPGRADE_STEP_RATIO;
        return metrics;
    }

    function getLabyrinthUpgradeExperienceBonus(levels) {
        return getLabyrinthUpgradeLevel(levels, LABYRINTH_UPGRADE_KEY_LABYRINTH_EXPERIENCE) * LABYRINTH_UPGRADE_STEP_RATIO;
    }

    function subtractSkillingMetrics(target, source) {
        if (!target || !source) {
            return target;
        }
        target.skillLevelBonus -= finiteNumber(source.skillLevelBonus, 0);
        target.efficiencyBonus -= finiteNumber(source.efficiencyBonus, 0);
        target.actionSpeedBonus -= finiteNumber(source.actionSpeedBonus, 0);
        target.successBonus -= finiteNumber(source.successBonus, 0);
        target.experienceBonus -= finiteNumber(source.experienceBonus, 0);
        target.genericExperienceBonus -= finiteNumber(source.genericExperienceBonus, 0);
        target.skillingExperienceBonus -= finiteNumber(source.skillingExperienceBonus, 0);
        target.skillExperienceBonus -= finiteNumber(source.skillExperienceBonus, 0);
        target.crateDoubleProgressBonus -= finiteNumber(source.crateDoubleProgressBonus, 0);
        target.gatheringBonus -= finiteNumber(source.gatheringBonus, 0);
        return target;
    }

    function getSkillingBuffMetrics(skillId, buffs) {
        const metrics = createEmptySkillingMetrics();
        const skillLevelType = `/buff_types/${skillId}_level`;
        const skillSuccessType = `/buff_types/${skillId}_success`;
        const skillExperienceType = `/buff_types/${skillId}_experience`;
        for (const buff of Array.isArray(buffs) ? buffs : []) {
            if (!buff?.typeHrid) {
                continue;
            }
            const amount = getBuffAmount(buff);
            if (!Number.isFinite(amount) || amount === 0) {
                continue;
            }

            if (buff.typeHrid === skillLevelType) {
                metrics.skillLevelBonus += amount;
            } else if (buff.typeHrid === "/buff_types/efficiency") {
                metrics.efficiencyBonus += amount;
            } else if (buff.typeHrid === "/buff_types/action_speed") {
                metrics.actionSpeedBonus += amount;
            } else if (buff.typeHrid === "/buff_types/labyrinth_double_progress") {
                metrics.crateDoubleProgressBonus += amount;
            } else if (
                buff.typeHrid === "/buff_types/experience" ||
                buff.typeHrid === "/buff_types/wisdom"
            ) {
                metrics.experienceBonus += amount;
                metrics.genericExperienceBonus += amount;
            } else if (buff.typeHrid === "/buff_types/skilling_experience") {
                metrics.experienceBonus += amount;
                metrics.skillingExperienceBonus += amount;
            } else if (buff.typeHrid === skillExperienceType) {
                metrics.experienceBonus += amount;
                metrics.skillExperienceBonus += amount;
            } else if (isDoubleProgressBuffApplicable(skillId, buff.typeHrid)) {
                metrics.gatheringBonus += amount;
            } else if (buff.typeHrid === "/buff_types/success_rate" || buff.typeHrid === skillSuccessType) {
                metrics.successBonus += amount;
            }
        }

        return metrics;
    }

    function getSkillingActionMetricsFromState(state, skillId, actionTypeHrid, stateKey) {
        const actionTypeBuffs = state?.[stateKey];
        const buffs = actionTypeBuffs?.[actionTypeHrid];
        return getSkillingBuffMetrics(skillId, Array.isArray(buffs) ? buffs : []);
    }

    function getSkillingGlobalMetrics(state, skillId, actionTypeHrid, options = {}) {
        const includePersonalBuffs = !(options && options.includePersonalBuffs === false);
        const equipmentMetrics = getSkillingActionMetricsFromState(
            state,
            skillId,
            actionTypeHrid,
            "equipmentActionTypeBuffsDict"
        );
        const hasTotalBuffs = Array.isArray(state?.skillingActionTypeBuffsDict?.[actionTypeHrid]);
        if (!hasTotalBuffs) {
            const fallbackGlobalMetrics = createEmptySkillingMetrics();
            const fallbackGlobalStateKeys = [
                "communityActionTypeBuffsDict",
                "houseActionTypeBuffsDict",
                "achievementActionTypeBuffsDict",
                "mooPassActionTypeBuffsDict",
            ];
            if (includePersonalBuffs) {
                fallbackGlobalStateKeys.unshift("personalActionTypeBuffsDict");
            }
            for (const stateKey of fallbackGlobalStateKeys) {
                addSkillingMetrics(
                    fallbackGlobalMetrics,
                    getSkillingActionMetricsFromState(state, skillId, actionTypeHrid, stateKey)
                );
            }
            return {
                equipmentMetrics,
                globalMetrics: fallbackGlobalMetrics,
            };
        }

        const totalMetrics = getSkillingActionMetricsFromState(
            state,
            skillId,
            actionTypeHrid,
            "skillingActionTypeBuffsDict"
        );
        const consumableMetrics = getSkillingActionMetricsFromState(
            state,
            skillId,
            actionTypeHrid,
            "consumableActionTypeBuffsDict"
        );
        const globalMetrics = cloneSkillingMetrics(totalMetrics);
        subtractSkillingMetrics(globalMetrics, equipmentMetrics);
        subtractSkillingMetrics(globalMetrics, consumableMetrics);
        if (!includePersonalBuffs) {
            const personalMetrics = getSkillingActionMetricsFromState(
                state,
                skillId,
                actionTypeHrid,
                "personalActionTypeBuffsDict"
            );
            subtractSkillingMetrics(globalMetrics, personalMetrics);
        }

        return {
            equipmentMetrics,
            globalMetrics,
        };
    }

    function hasMeaningfulSkillingMetrics(metrics) {
        const epsilon = 1e-9;
        return (
            Math.abs(finiteNumber(metrics?.skillLevelBonus, 0)) > epsilon ||
            Math.abs(finiteNumber(metrics?.efficiencyBonus, 0)) > epsilon ||
            Math.abs(finiteNumber(metrics?.actionSpeedBonus, 0)) > epsilon ||
            Math.abs(finiteNumber(metrics?.successBonus, 0)) > epsilon ||
            Math.abs(finiteNumber(metrics?.experienceBonus, 0)) > epsilon ||
            Math.abs(finiteNumber(metrics?.genericExperienceBonus, 0)) > epsilon ||
            Math.abs(finiteNumber(metrics?.skillingExperienceBonus, 0)) > epsilon ||
            Math.abs(finiteNumber(metrics?.skillExperienceBonus, 0)) > epsilon ||
            Math.abs(finiteNumber(metrics?.crateDoubleProgressBonus, 0)) > epsilon ||
            Math.abs(finiteNumber(metrics?.gatheringBonus, 0)) > epsilon
        );
    }

    function hasActivePersonalSkillingBuffForRoom(state, room) {
        if (!state || !room || room.roomType !== LABYRINTH_SKILLING_ROOM_TYPE || !room.skillHrid) {
            return false;
        }
        const skillId = skillHridToSkillId(room.skillHrid);
        if (!skillId) {
            return false;
        }
        const actionTypeHrid = skillIdToActionTypeHrid(skillId);
        const personalBuffs = state?.personalActionTypeBuffsDict?.[actionTypeHrid];
        if (!Array.isArray(personalBuffs) || personalBuffs.length === 0) {
            return false;
        }
        return hasMeaningfulSkillingMetrics(getSkillingBuffMetrics(skillId, personalBuffs));
    }

    function hasActivePersonalCombatBuff(state) {
        const personalBuffs = state?.personalActionTypeBuffsDict?.["/action_types/combat"];
        if (!Array.isArray(personalBuffs) || personalBuffs.length === 0) {
            return false;
        }
        const epsilon = 1e-9;
        for (const buff of personalBuffs) {
            if (Math.abs(getBuffAmount(buff)) > epsilon) {
                return true;
            }
        }
        return false;
    }

    function buildLabyrinthCalcDoneMessage(state, flatRooms, targetIndexes) {
        return t("calcDone");
    }

    function getCharacterItemValues(state) {
        const itemMap = state?.characterItemMap;
        if (itemMap instanceof Map) {
            return Array.from(itemMap.values());
        }
        if (itemMap && typeof itemMap === "object") {
            return Object.values(itemMap);
        }
        return [];
    }

    function formatLoanSealPercent(amount) {
        const percent = Math.max(0, finiteNumber(amount, 0)) * 100;
        if (Math.abs(percent - Math.round(percent)) < 1e-9) {
            return `${Math.round(percent)}`;
        }
        return percent.toFixed(1).replace(/\.0$/, "");
    }

    function getPersonalBuffHridFromSealItemHrid(itemHrid) {
        const tail = String(itemHrid || "").split("/").pop() || "";
        if (!tail.startsWith("seal_of_")) {
            return "";
        }
        return `/personal_buff_types/${tail.slice("seal_of_".length)}`;
    }

    function getActivePersonalBuffByHrid(state) {
        const result = new Map();
        const buffs = Array.isArray(state?.characterBuffs) ? state.characterBuffs : [];
        for (const buff of buffs) {
            const hrid = String(buff?.hrid || "");
            if (!hrid.startsWith("/personal_buff_types/")) {
                continue;
            }
            result.set(hrid, buff);
        }
        return result;
    }

    function formatLoanSealDisplayName(name) {
        const rawName = String(name || "").trim();
        if (!rawName) {
            return "";
        }
        return rawName.replace(/^卷軸[·.．]/, "");
    }

    function buildLoanSealEffectCatalog(state, initClientData = null) {
        const itemDetails = state?.itemDetailDict || initClientData?.itemDetailMap || {};
        const buffTypeDetails = state?.buffTypeDetailDict || initClientData?.buffTypeDetailMap || {};
        const itemCountByHrid = new Map();
        for (const item of getCharacterItemValues(state)) {
            const itemHrid = String(item?.itemHrid || item?.hrid || "");
            if (!itemHrid.startsWith("/items/seal_of_")) {
                continue;
            }
            const count = Math.max(0, Math.floor(finiteNumber(item?.count ?? item?.quantity ?? item?.amount, 0)));
            itemCountByHrid.set(itemHrid, (itemCountByHrid.get(itemHrid) || 0) + count);
        }

        const activePersonalBuffByHrid = getActivePersonalBuffByHrid(state);
        const catalog = [];
        for (const effect of LABYRINTH_LOAN_SEAL_EFFECTS) {
            const itemHrid = String(effect?.itemHrid || "");
            const quantity = Math.max(0, Math.floor(finiteNumber(itemCountByHrid.get(itemHrid), 0)));

            const itemDetail = getContainerValue(itemDetails, itemHrid) || null;
            const buffTypeHrid = String(effect?.buffTypeHrid || "");
            const buffTypeDetail = buffTypeHrid ? getContainerValue(buffTypeDetails, buffTypeHrid) : null;
            const personalBuffHrid = getPersonalBuffHridFromSealItemHrid(itemHrid);
            const activeBuff = personalBuffHrid ? activePersonalBuffByHrid.get(personalBuffHrid) || null : null;
            const localizedName = isChineseUi() ? LABYRINTH_SEAL_NAME_ZH_BY_ITEM_HRID[itemHrid] || "" : "";
            const displayName = formatLoanSealDisplayName(
                localizedName || itemDetail?.name || buffTypeDetail?.name || itemHrid.split("/").pop() || itemHrid
            );
            const sortIndex = Math.max(0, Math.floor(finiteNumber(itemDetail?.sortIndex, 9999)));
            const amount = Math.max(0, finiteNumber(effect?.amount, 0));

            catalog.push({
                itemHrid,
                displayName,
                sortIndex,
                quantity,
                buffTypeHrid,
                amount,
                boostMode: String(effect?.boostMode || "flat") === "ratio" ? "ratio" : "flat",
                isCombat: effect?.isCombat === true,
                personalBuffHrid,
                isActive: Boolean(activeBuff),
                activeBuff,
                canApply: Boolean(buffTypeHrid) && amount > 0,
                labelText: `${displayName} (+${formatLoanSealPercent(amount)}%)`,
            });
        }

        catalog.sort((a, b) => {
            if (a.sortIndex !== b.sortIndex) {
                return a.sortIndex - b.sortIndex;
            }
            return a.displayName.localeCompare(b.displayName);
        });
        return catalog;
    }

    function createLoanSealBuffEntry(effect, index = 0) {
        const amount = Math.max(0, finiteNumber(effect?.amount, 0));
        if (!effect?.buffTypeHrid || amount <= 0) {
            return null;
        }
        const useRatio = effect?.boostMode === "ratio";
        return {
            uniqueHrid: `/buff_uniques/loan_seal_${String(effect.itemHrid || "").split("/").pop() || index}`,
            typeHrid: String(effect.buffTypeHrid),
            ratioBoost: useRatio ? amount : 0,
            ratioBoostLevelBonus: 0,
            flatBoost: useRatio ? 0 : amount,
            flatBoostLevelBonus: 0,
            startTime: "0001-01-01T00:00:00Z",
            duration: 0,
        };
    }

    function getLoanSkillingActionTypeHrids(state) {
        const source = state?.personalActionTypeBuffsDict || state?.skillingActionTypeBuffsDict || {};
        const values = [];
        for (const key of Object.keys(source)) {
            const actionType = String(key || "");
            if (!actionType.startsWith("/action_types/")) {
                continue;
            }
            if (
                actionType === "/action_types/combat" ||
                actionType === "/action_types/labyrinth" ||
                actionType === "/action_types/special"
            ) {
                continue;
            }
            values.push(actionType);
        }
        if (values.length > 0) {
            values.sort();
            return values;
        }
        return LABYRINTH_AUTOMATION_SKILL_ROOM_TYPES.map((entry) => `/action_types/${entry.key}`);
    }

    function buildLoanSimulationOptions(state, catalog, selectedItemHrids) {
        if (!Array.isArray(catalog) || catalog.length === 0 || !Array.isArray(selectedItemHrids) || selectedItemHrids.length === 0) {
            return null;
        }
        const selectedSet = new Set(selectedItemHrids.map((itemHrid) => String(itemHrid || "")));
        const selectedEffects = catalog.filter(
            (effect) => selectedSet.has(String(effect?.itemHrid || "")) && !effect?.isActive && effect?.canApply
        );
        if (!selectedEffects.length) {
            return null;
        }

        const skillingActionTypes = getLoanSkillingActionTypeHrids(state);
        const loanPersonalActionTypeBuffsDict = {};

        for (let i = 0; i < selectedEffects.length; i += 1) {
            const effect = selectedEffects[i];
            if (effect.isCombat) {
                continue;
            }
            const buffEntry = createLoanSealBuffEntry(effect, i);
            if (!buffEntry) {
                continue;
            }

            for (const actionTypeHrid of skillingActionTypes) {
                if (!loanPersonalActionTypeBuffsDict[actionTypeHrid]) {
                    loanPersonalActionTypeBuffsDict[actionTypeHrid] = [];
                }
                loanPersonalActionTypeBuffsDict[actionTypeHrid].push({
                    ...buffEntry,
                });
            }
        }

        return {
            loanPersonalActionTypeBuffsDict,
            selectedSealItemHrids: selectedEffects.map((effect) => String(effect?.itemHrid || "")).filter(Boolean),
            selectedEffects,
        };
    }

    function normalizeLoanSimulationOptions(rawOptions) {
        return null;
    }

    function getActivePersonalSealItemHrids(state) {
        const result = [];
        const buffs = Array.isArray(state?.characterBuffs) ? state.characterBuffs : [];
        for (const buff of buffs) {
            const hrid = String(buff?.hrid || "");
            if (!hrid.startsWith("/personal_buff_types/")) {
                continue;
            }
            const tail = hrid.slice("/personal_buff_types/".length);
            if (!tail) {
                continue;
            }
            const itemHrid = `/items/seal_of_${tail}`;
            if (!SIMULATOR_PERSONAL_BUFF_ITEM_HRIDS.has(itemHrid)) {
                continue;
            }
            result.push(itemHrid);
        }
        return Array.from(new Set(result));
    }

    function getSimulatorPersonalBuffItemHrids(state) {
        return [];
    }

    function getCombatSimulatorPersonalSealItemHrids(state, options = {}) {
        return [];
    }

    function getSkillLevel(skillMap, skillHrid) {
        if (!skillMap) {
            return 0;
        }
        if (skillMap instanceof Map) {
            return Number(skillMap.get(skillHrid)?.level || 0);
        }
        return Number(skillMap[skillHrid]?.level || 0);
    }

    function getCrateBuffs(initClientData, teaCrateItemHrid) {
        if (!initClientData || !teaCrateItemHrid) {
            return [];
        }
        const map = initClientData.labyrinthCrateDetailMap || {};
        const buffs = map[teaCrateItemHrid];
        return Array.isArray(buffs) ? buffs : [];
    }

    function normalizeCombatBuffEntry(buff) {
        if (!buff?.typeHrid) {
            return null;
        }
        return {
            uniqueHrid: String(buff.uniqueHrid || ""),
            typeHrid: String(buff.typeHrid || ""),
            ratioBoost: finiteNumber(buff.ratioBoost, 0),
            ratioBoostLevelBonus: finiteNumber(buff.ratioBoostLevelBonus, 0),
            flatBoost: finiteNumber(buff.flatBoost, 0),
            flatBoostLevelBonus: finiteNumber(buff.flatBoostLevelBonus, 0),
            startTime: String(buff.startTime || "0001-01-01T00:00:00Z"),
            duration: Math.max(0, finiteNumber(buff.duration, 0)),
        };
    }

    function createLabyrinthCombatBuff(uniqueKey, typeHrid, level, valueKey) {
        const normalizedLevel = Math.max(0, Math.floor(finiteNumber(level, 0)));
        if (!typeHrid || normalizedLevel <= 0) {
            return null;
        }
        return normalizeCombatBuffEntry({
            uniqueHrid: `/buff_uniques/labyrinth_upgrade_${uniqueKey}`,
            typeHrid,
            [valueKey]: normalizedLevel * LABYRINTH_UPGRADE_STEP_RATIO,
            startTime: "0001-01-01T00:00:00Z",
            duration: 0,
        });
    }

    function buildLabyrinthCombatBuffs(levels) {
        const buffs = [];
        const definitions = [
            [LABYRINTH_UPGRADE_KEY_COMBAT_DAMAGE, "combat_damage", "/buff_types/damage", "ratioBoost"],
            [LABYRINTH_UPGRADE_KEY_ATTACK_SPEED, "attack_speed", "/buff_types/attack_speed", "ratioBoost"],
            [LABYRINTH_UPGRADE_KEY_CAST_SPEED, "cast_speed", "/buff_types/cast_speed", "flatBoost"],
            [LABYRINTH_UPGRADE_KEY_CRITICAL_RATE, "critical_rate", "/buff_types/critical_rate", "flatBoost"],
        ];
        for (const [upgradeKey, uniqueKey, typeHrid, valueKey] of definitions) {
            const buff = createLabyrinthCombatBuff(uniqueKey, typeHrid, getLabyrinthUpgradeLevel(levels, upgradeKey), valueKey);
            if (buff) {
                buffs.push(buff);
            }
        }
        return buffs;
    }

    function appendNormalizedCombatBuffs(target, seen, rawBuffs) {
        if (!Array.isArray(rawBuffs)) {
            return target;
        }
        const dedupeSet = seen instanceof Set ? seen : new Set();
        for (const buff of rawBuffs) {
            const normalized = normalizeCombatBuffEntry(buff);
            if (!normalized || !normalized.typeHrid) {
                continue;
            }
            const dedupeKey = [
                normalized.typeHrid,
                normalized.ratioBoost,
                normalized.ratioBoostLevelBonus,
                normalized.flatBoost,
                normalized.flatBoostLevelBonus,
                normalized.duration,
            ].join("|");
            if (dedupeSet.has(dedupeKey)) {
                continue;
            }
            dedupeSet.add(dedupeKey);
            target.push(normalized);
        }
        return target;
    }

    function getCombatPersonalBuffs(state) {
        const actionTypeHrid = "/action_types/combat";
        const personalBuffs = state?.personalActionTypeBuffsDict?.[actionTypeHrid];
        const combatBuffs = [];
        appendNormalizedCombatBuffs(combatBuffs, new Set(), Array.isArray(personalBuffs) ? personalBuffs : []);
        return combatBuffs;
    }

    function getActiveGuildCombatBuffs(state) {
        // This is the character's effective selection; guildBuildingLevelDict only describes the guild-wide cap.
        const guildBuffs = state?.guildActionTypeBuffsDict?.["/action_types/combat"];
        const combatBuffs = [];
        appendNormalizedCombatBuffs(combatBuffs, new Set(), Array.isArray(guildBuffs) ? guildBuffs : []);
        return combatBuffs;
    }

    function getActiveGuildCombatShrineLevels(state) {
        const activeBuffs = state?.characterGuildBuffDict || {};
        const readLevel = (hrid) => Math.max(0, Math.floor(finiteNumber(activeBuffs?.[hrid]?.level, 0)));
        return {
            force: readLevel("/guild_buffs/force_combat"),
            spirit: readLevel("/guild_buffs/spirit_combat"),
            tempo: readLevel("/guild_buffs/tempo_combat"),
        };
    }

    function getCombatBuffValueByType(buffs, typeHrid, valueKey) {
        return (Array.isArray(buffs) ? buffs : []).reduce((total, buff) => {
            if (buff?.typeHrid !== typeHrid) {
                return total;
            }
            return total + finiteNumber(buff?.[valueKey], 0);
        }, 0);
    }

    function isLabyrinthRunActiveForCrateSelection(state) {
        if (!state?.characterLabyrinth) {
            return false;
        }
        const labyrinth = state.characterLabyrinth;
        if (Array.isArray(labyrinth.roomData) && labyrinth.roomData.length > 0) {
            return true;
        }
        const path = parseLabyrinthPathData(labyrinth.pathData);
        if (Array.isArray(path) && path.length > 0) {
            return true;
        }
        if (state.labyrinthRoomProgress) {
            return true;
        }
        return Array.isArray(state.labyrinthBattleMonsters) && state.labyrinthBattleMonsters.length > 0;
    }

    function getLabyrinthCrateSelection(state) {
        const labyrinth = state?.characterLabyrinth || {};
        const setting = state?.characterSetting || {};
        const fromLabyrinth = {
            teaCrateItemHrid: String(labyrinth?.teaCrateItemHrid || ""),
            coffeeCrateItemHrid: String(labyrinth?.coffeeCrateItemHrid || ""),
            foodCrateItemHrid: String(labyrinth?.foodCrateItemHrid || ""),
            source: "labyrinth",
        };
        const runActive = isLabyrinthRunActiveForCrateSelection(state);
        const hasSettingCrateKeys =
            Object.prototype.hasOwnProperty.call(setting, "labyrinthTeaCrateHrid") ||
            Object.prototype.hasOwnProperty.call(setting, "labyrinthCoffeeCrateHrid") ||
            Object.prototype.hasOwnProperty.call(setting, "labyrinthFoodCrateHrid");
        if (!runActive && hasSettingCrateKeys) {
            return {
                teaCrateItemHrid: String(setting?.labyrinthTeaCrateHrid || ""),
                coffeeCrateItemHrid: String(setting?.labyrinthCoffeeCrateHrid || ""),
                foodCrateItemHrid: String(setting?.labyrinthFoodCrateHrid || ""),
                source: "setting",
            };
        }
        return fromLabyrinth;
    }

    function getCombatCrateBuffs(state, initClientData) {
        const crateSelection = getLabyrinthCrateSelection(state);
        const teaCrateItemHrid = String(crateSelection?.teaCrateItemHrid || "");
        const coffeeCrateItemHrid = String(crateSelection?.coffeeCrateItemHrid || "");
        const foodCrateItemHrid = String(crateSelection?.foodCrateItemHrid || "");
        const combatCrateItemHrids = [];
        if (coffeeCrateItemHrid) {
            combatCrateItemHrids.push(coffeeCrateItemHrid);
        }
        if (foodCrateItemHrid) {
            combatCrateItemHrids.push(foodCrateItemHrid);
        }
        // Compatibility fallback: old states may only expose one crate field.
        if (!combatCrateItemHrids.length && teaCrateItemHrid) {
            if (teaCrateItemHrid.includes("coffee_crate") || teaCrateItemHrid.includes("food_crate")) {
                combatCrateItemHrids.push(teaCrateItemHrid);
            }
        }

        const combatBuffs = [];
        const seen = new Set();
        for (const itemHrid of combatCrateItemHrids) {
            const crateBuffs = getCrateBuffs(initClientData, itemHrid);
            appendNormalizedCombatBuffs(combatBuffs, seen, crateBuffs);
        }
        const combatCrateSignature = combatCrateItemHrids.join("+");
        return {
            teaCrateItemHrid,
            coffeeCrateItemHrid,
            foodCrateItemHrid,
            combatCrateItemHrids,
            combatCrateSignature,
            combatBuffs,
        };
    }

    function computeNonEnhancingClearStats(params) {
        const { attempts, successChance, doubleChance, progressPerSuccess, targetProgress } = params;
        const effectiveProgressPerSuccess = getEffectiveSkillingProgressPerSuccess(progressPerSuccess);

        if (!Number.isFinite(targetProgress) || targetProgress <= 0) {
            return { clearChance: 1, expectedAttemptsOnClear: 0 };
        }
        if (!Number.isFinite(attempts) || attempts <= 0) {
            return { clearChance: 0, expectedAttemptsOnClear: null };
        }
        if (!Number.isFinite(effectiveProgressPerSuccess) || effectiveProgressPerSuccess <= 0) {
            return { clearChance: 0, expectedAttemptsOnClear: null };
        }

        const p = clamp01(successChance);
        const d = clamp01(doubleChance);
        if (p <= 0) {
            return { clearChance: 0, expectedAttemptsOnClear: null };
        }

        const neededUnits = Math.ceil(targetProgress / effectiveProgressPerSuccess - 1e-9);
        if (neededUnits <= 0) {
            return { clearChance: 1, expectedAttemptsOnClear: 0 };
        }
        if (neededUnits > attempts * 2) {
            return { clearChance: 0, expectedAttemptsOnClear: null };
        }

        const q0 = 1 - p;
        const q1 = p * (1 - d);
        const q2 = p * d;

        let stateDist = new Float64Array(neededUnits + 1);
        stateDist[0] = 1;
        let expectedAttemptsNumerator = 0;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const nextDist = new Float64Array(neededUnits + 1);

            for (let units = 0; units <= neededUnits; units += 1) {
                const prob = stateDist[units];
                if (prob <= 0) {
                    continue;
                }

                if (units === neededUnits) {
                    nextDist[neededUnits] += prob;
                    continue;
                }

                nextDist[units] += prob * q0;
                nextDist[Math.min(neededUnits, units + 1)] += prob * q1;
                nextDist[Math.min(neededUnits, units + 2)] += prob * q2;
            }

            const reachedNow = nextDist[neededUnits] - stateDist[neededUnits];
            if (reachedNow > 0) {
                expectedAttemptsNumerator += attempt * reachedNow;
            }

            stateDist = nextDist;
        }

        const clearChance = clamp01(stateDist[neededUnits]);
        const expectedAttemptsOnClear = clearChance > 0 ? expectedAttemptsNumerator / clearChance : null;

        return {
            clearChance,
            expectedAttemptsOnClear,
        };
    }

    function computeEnhancingClearStats(params) {
        const { attempts, successChance, doubleChance, targetLevel, startLevel } = params;
        const target = Math.max(0, Math.floor(finiteNumber(targetLevel, 0)));
        const start = Math.max(0, Math.floor(finiteNumber(startLevel, 0)));
        if (target <= 0) {
            return { clearChance: 1, expectedAttemptsOnClear: 0 };
        }
        if (!Number.isFinite(attempts) || attempts <= 0) {
            return { clearChance: 0, expectedAttemptsOnClear: null };
        }

        const p = clamp01(successChance);
        const d = clamp01(doubleChance);
        const failChance = 1 - p;
        const singleSuccessChance = p * (1 - d);
        const doubleSuccessChance = p * d;

        let stateDist = new Float64Array(target + 1);
        stateDist[Math.min(start, target)] = 1;
        let expectedAttemptsNumerator = 0;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const nextDist = new Float64Array(target + 1);
            for (let level = 0; level <= target; level += 1) {
                const prob = stateDist[level];
                if (prob <= 0) {
                    continue;
                }
                if (level === target) {
                    nextDist[target] += prob;
                    continue;
                }
                nextDist[Math.max(0, level - 1)] += prob * failChance;
                nextDist[Math.min(target, level + 1)] += prob * singleSuccessChance;
                nextDist[Math.min(target, level + 2)] += prob * doubleSuccessChance;
            }
            const reachedNow = nextDist[target] - stateDist[target];
            if (reachedNow > 0) {
                expectedAttemptsNumerator += attempt * reachedNow;
            }
            stateDist = nextDist;
        }

        const clearChance = clamp01(stateDist[target]);
        const expectedAttemptsOnClear = clearChance > 0 ? expectedAttemptsNumerator / clearChance : null;
        return {
            clearChance,
            expectedAttemptsOnClear,
        };
    }

    function getEnhancingTargetLevelByRoomLevel(roomLevel) {
        return 5;
    }

    function getBadgeColor(probability) {
        if (probability >= 0.95) {
            return "#1fbf60";
        }
        if (probability >= 0.8) {
            return "#77b82a";
        }
        if (probability >= 0.6) {
            return "#d2ac19";
        }
        if (probability >= 0.4) {
            return "#d27a1f";
        }
        return "#d84b4b";
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
.${BADGE_CLASS} {
  position: absolute;
  right: 1px;
  bottom: 1px;
  z-index: 9;
  max-width: calc(100% - 2px);
  max-height: 24%;
  padding: 1px 3px;
  border-radius: 3px;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: flex-end;
  gap: 2px;
  white-space: nowrap;
  background: rgba(0, 0, 0, 0.35);
  color: #ffffff;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.55);
  pointer-events: none;
  user-select: none;
}
.${BADGE_CLASS}__chance {
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  flex: 0 0 auto;
}
.${BADGE_CLASS}__eta {
  font-size: 8px;
  font-weight: 600;
  line-height: 1;
  opacity: 0.95;
  flex: 0 0 auto;
}
.${LIVE_ACTION_RATE_CLASS} {
  display: inline-block;
  margin-left: 6px;
  font-size: ${LIVE_ACTION_RATE_MWITOOLS_FONT_SIZE};
  font-weight: 500;
  line-height: 1.2;
  color: ${LIVE_ACTION_RATE_MWITOOLS_COLOR};
  white-space: nowrap;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
}
.${CONTROL_CLASS} {
  position: relative;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 4px;
  row-gap: 2px;
  width: min(372px, calc(100vw - 16px));
  box-sizing: border-box;
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.62);
  color: #f0f4ff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
  user-select: none;
  overflow: visible;
}
.${CONTROL_CLASS}--inline {
  margin-left: auto;
  flex: 0 0 auto;
}
.${CONTROL_CLASS}--block {
  margin: 0 0 8px 0;
}
.${CONTROL_CLASS}__button {
  min-width: 96px;
  width: auto;
  padding: 0 10px;
  height: 18px;
  border: 0;
  border-radius: 5px;
  background: #3a88ff;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  flex: 0 0 auto;
}
.${CONTROL_CLASS}__button:disabled {
  opacity: 0.75;
  cursor: wait;
}
.${CONTROL_LOAN_TOGGLE_CLASS} {
  min-width: 74px;
  width: auto;
  padding: 0 10px;
  height: 18px;
  border: 0;
  border-radius: 5px;
  background: rgba(84, 126, 224, 0.95);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  flex: 0 0 auto;
  margin-left: auto;
}
.${CONTROL_LOAN_TOGGLE_CLASS}:disabled {
  opacity: 0.75;
  cursor: wait;
}
.${CONTROL_LOAN_PANEL_CLASS} {
  position: absolute;
  top: 0;
  left: calc(100% + 8px);
  width: 250px;
  max-height: 320px;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid rgba(128, 170, 255, 0.45);
  border-radius: 6px;
  background: rgba(12, 16, 24, 0.96);
  color: #f2f7ff;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
  z-index: 2147483645;
  pointer-events: auto;
}
.${CONTROL_LOAN_PANEL_CLASS}[hidden] {
  display: none !important;
}
.${CONTROL_LOAN_PANEL_CLASS} * {
  pointer-events: auto;
}
.${CONTROL_LOAN_PANEL_CLASS}__title {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #9ec4ff;
}
.${CONTROL_LOAN_LIST_CLASS} {
  max-height: 230px;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 2px;
}
.${CONTROL_LOAN_ITEM_CLASS} {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  line-height: 1.2;
}
.${CONTROL_LOAN_ITEM_CLASS} input[type="checkbox"] {
  margin: 0;
}
.${CONTROL_LOAN_ITEM_CLASS}__name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.${CONTROL_LOAN_ITEM_STATUS_CLASS} {
  font-size: 10px;
  opacity: 0.85;
  white-space: nowrap;
}
.${CONTROL_LOAN_ITEM_STATUS_CLASS}--warn {
  color: #ff7b7b;
  opacity: 1;
  font-weight: 700;
}
.${CONTROL_LOAN_CALC_CLASS} {
  margin-top: 8px;
  width: 100%;
  height: 22px;
  border: 0;
  border-radius: 5px;
  background: #3a88ff;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.${CONTROL_LOAN_CALC_CLASS}:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}
.${CONTROL_LOG_TOGGLE_CLASS} {
  min-width: 54px;
  width: auto;
  padding: 0 10px;
  height: 18px;
  border: 0;
  border-radius: 5px;
  background: rgba(77, 151, 255, 0.95);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  flex: 0 0 auto;
}
.${CONTROL_LOG_TOGGLE_CLASS}:disabled {
  opacity: 0.75;
  cursor: wait;
}
.${CONTROL_DISTRIBUTION_TOGGLE_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 18px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(77, 151, 255, 0.18);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  flex: 0 0 auto;
}
.${CONTROL_DISTRIBUTION_TOGGLE_CLASS} input {
  width: 12px;
  height: 12px;
  margin: 0;
  accent-color: #4d97ff;
}
.${CONTROL_DISTRIBUTION_TOGGLE_CLASS}:has(input:disabled) {
  opacity: 0.75;
  cursor: wait;
}
.${CONTROL_DISTRIBUTION_STEP_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 18px;
  margin-bottom: 7px;
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  flex: 0 0 auto;
}
.${CONTROL_DISTRIBUTION_STEP_INPUT_CLASS} {
  width: 36px;
  height: 18px;
  box-sizing: border-box;
  border: 1px solid rgba(150, 190, 255, 0.45);
  border-radius: 4px;
  background: rgba(20, 28, 42, 0.9);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  outline: none;
}
.${CONTROL_DISTRIBUTION_STEP_INPUT_CLASS}:disabled {
  opacity: 0.75;
  cursor: wait;
}
.${ROOM_DISTRIBUTION_FLOAT_CLASS} {
  position: fixed;
  top: 92px;
  width: 310px;
  max-height: min(68vh, 560px);
  box-sizing: border-box;
  border: 1px solid rgba(128, 170, 255, 0.5);
  border-radius: 8px;
  background: rgba(10, 14, 22, 0.97);
  color: #f2f7ff;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55);
  z-index: 2147483646;
  pointer-events: auto;
  user-select: none;
}
.${ROOM_DISTRIBUTION_FLOAT_CLASS}[hidden] {
  display: none !important;
}
.${ROOM_DISTRIBUTION_HEADER_CLASS} {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 6px;
  border-bottom: 1px solid rgba(146, 182, 255, 0.24);
  cursor: move;
}
.${ROOM_DISTRIBUTION_TITLE_CLASS} {
  min-width: 0;
  color: #9ec4ff;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.${ROOM_DISTRIBUTION_CLOSE_CLASS} {
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  flex: 0 0 auto;
}
.${ROOM_DISTRIBUTION_CLOSE_CLASS}:hover {
  background: rgba(255, 108, 108, 0.45);
}
.${ROOM_DISTRIBUTION_BODY_CLASS} {
  box-sizing: border-box;
  padding: 8px 10px 10px;
  overflow-y: auto;
  max-height: calc(min(68vh, 560px) - 42px);
}
.${ROOM_DISTRIBUTION_META_CLASS} {
  margin-bottom: 5px;
  color: rgba(221, 232, 255, 0.9);
  font-size: 10px;
  line-height: 1.35;
}
.${ROOM_DISTRIBUTION_LIST_CLASS} {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.${ROOM_DISTRIBUTION_ROW_CLASS} {
  display: grid;
  grid-template-columns: 72px 1fr 48px;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  line-height: 1.2;
}
.${ROOM_DISTRIBUTION_ROW_CLASS}__label,
.${ROOM_DISTRIBUTION_ROW_CLASS}__value {
  white-space: nowrap;
}
.${ROOM_DISTRIBUTION_ROW_CLASS}__value {
  text-align: right;
  font-weight: 700;
}
.${ROOM_DISTRIBUTION_BAR_CLASS} {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}
.${ROOM_DISTRIBUTION_BAR_CLASS} > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #4d97ff 0%, #61dba0 100%);
}
.${ROOM_LOG_FLOAT_CLASS} {
  position: fixed;
  top: 92px;
  right: 14px;
  width: 340px;
  max-height: min(62vh, 470px);
  box-sizing: border-box;
  border: 1px solid rgba(128, 170, 255, 0.5);
  border-radius: 8px;
  background: rgba(10, 14, 22, 0.97);
  color: #f2f7ff;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55);
  z-index: 2147483646;
  pointer-events: auto;
  user-select: none;
}
.${ROOM_LOG_FLOAT_CLASS}[hidden] {
  display: none !important;
}
.${ROOM_LOG_FLOAT_HEADER_CLASS} {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 6px;
  border-bottom: 1px solid rgba(146, 182, 255, 0.24);
  cursor: move;
}
.${ROOM_LOG_FLOAT_TITLE_CLASS} {
  min-width: 0;
  color: #9ec4ff;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.${ROOM_LOG_FLOAT_ACTIONS_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.${ROOM_LOG_FLOAT_CLEAR_CLASS} {
  min-width: 40px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  padding: 0 6px;
}
.${ROOM_LOG_FLOAT_CLEAR_CLASS}:hover {
  background: rgba(255, 181, 94, 0.45);
}
.${ROOM_LOG_FLOAT_CLOSE_CLASS} {
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  flex: 0 0 auto;
}
.${ROOM_LOG_FLOAT_CLOSE_CLASS}:hover {
  background: rgba(255, 108, 108, 0.45);
}
.${CONTROL_LOG_PANEL_CLASS} {
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
  padding: 8px;
}
.${CONTROL_LOG_PANEL_CLASS}__title {
  display: none;
}
.${CONTROL_LOG_LIST_CLASS} {
  max-height: calc(min(62vh, 470px) - 60px);
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
}
.${CONTROL_LOG_ITEM_CLASS} {
  border: 1px solid rgba(146, 182, 255, 0.25);
  border-radius: 5px;
  background: rgba(22, 31, 45, 0.92);
  padding: 6px 7px;
  font-size: 11px;
  line-height: 1.25;
}
.${CONTROL_LOG_ITEM_CLASS}__header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-weight: 700;
  color: #eef6ff;
}
.${CONTROL_LOG_ITEM_CLASS}__time {
  opacity: 0.85;
  font-weight: 600;
}
.${CONTROL_LOG_META_CLASS} {
  font-size: 10px;
  color: rgba(221, 232, 255, 0.9);
  margin-bottom: 4px;
}
.${CONTROL_LOG_INCOMPLETE_CLASS} {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0 6px;
  background: rgba(244, 124, 71, 0.22);
  color: #ffba92;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.4;
}
.${CONTROL_LOG_ITEM_CLASS}__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
}
.${CONTROL_LOG_ITEM_CLASS}__sep {
  opacity: 0.65;
}
.${CONTROL_LOG_ACTION_CLASS} {
  font-weight: 700;
}
.${CONTROL_LOG_ACTION_CLASS}--success {
  color: #3ddc84;
}
.${CONTROL_LOG_ACTION_CLASS}--fail {
  color: #ff6464;
}
.${CONTROL_LOG_ACTION_CLASS}--double {
  color: #ffcf5c;
  background-image: linear-gradient(90deg, #ff5e7e 0%, #ffb55e 24%, #ffe45e 42%, #63e67c 60%, #59c8ff 78%, #d78bff 100%);
  background-size: 100% 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.${CONTROL_LOG_ACTION_CLASS}--unknown {
  color: #9ab0d8;
}
.${CONTROL_CLASS}__settings {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
.${CONTROL_CLASS}__settings-label {
  font-size: 10px;
  line-height: 1;
  opacity: 0.92;
}
.${CONTROL_CLASS}__settings-input {
  width: 46px;
  height: 18px;
  box-sizing: border-box;
  border: 1px solid rgba(150, 190, 255, 0.45);
  border-radius: 4px;
  background: rgba(20, 28, 42, 0.9);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  outline: none;
}
.${CONTROL_CLASS}__settings-input:disabled {
  opacity: 0.75;
  cursor: wait;
}
.${CONTROL_CLASS}__progress {
  flex: 1 1 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.${CONTROL_CLASS}__track {
  width: 100%;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
  overflow: hidden;
}
.${CONTROL_CLASS}__bar {
  width: 0%;
  height: 100%;
  background: linear-gradient(90deg, #57d08a 0%, #8ed447 100%);
  transition: width 0.08s linear;
}
.${CONTROL_CLASS}__text {
  display: none;
}
.${AUTOMATION_ESTIMATE_CONTROL_CLASS} {
  margin: 6px 0 8px 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.${AUTOMATION_ESTIMATE_CONTROL_CLASS}__settings {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.${AUTOMATION_ESTIMATE_CONTROL_CLASS}__settings-label {
  font-size: 11px;
  color: rgba(240, 244, 255, 0.92);
}
.${AUTOMATION_ESTIMATE_CONTROL_TRIALS_INPUT_CLASS} {
  width: 68px;
  height: 22px;
  box-sizing: border-box;
  border: 1px solid rgba(150, 190, 255, 0.45);
  border-radius: 4px;
  background: rgba(20, 28, 42, 0.9);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  outline: none;
}
.${AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_LABEL_CLASS} {
  font-size: 11px;
  color: rgba(240, 244, 255, 0.92);
}
.${AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_INPUT_CLASS} {
  width: 64px;
  height: 22px;
  box-sizing: border-box;
  border: 1px solid rgba(150, 190, 255, 0.45);
  border-radius: 4px;
  background: rgba(20, 28, 42, 0.9);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  outline: none;
}
.${AUTOMATION_ESTIMATE_CONTROL_CLASS}__button {
  min-width: 74px;
  width: auto;
  padding: 0 10px;
  height: 24px;
  border: 0;
  border-radius: 5px;
  background: #3a88ff;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.${AUTOMATION_ESTIMATE_CONTROL_CLASS}__button:disabled {
  opacity: 0.75;
  cursor: wait;
}
.${AUTOMATION_ESTIMATE_CONTROL_RECOMMEND_BUTTON_CLASS} {
  min-width: 88px;
}
.${AUTOMATION_ESTIMATE_CONTROL_CLASS}__status {
  font-size: 12px;
  line-height: 1.2;
  color: rgba(240, 244, 255, 0.9);
}
.${AUTOMATION_MAX_FLOOR_TABLE_HEADER_CLASS} {
  width: 64px;
  min-width: 64px;
  max-width: 64px;
  white-space: nowrap;
  text-align: right;
}
.${AUTOMATION_MAX_FLOOR_CELL_CLASS} {
  width: 64px;
  min-width: 64px;
  max-width: 64px;
  color: rgba(240, 244, 255, 0.95);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  text-align: right;
  padding-right: 6px;
}
.${AUTOMATION_ESTIMATE_TABLE_HEADER_CLASS} {
  width: 84px;
  min-width: 84px;
  max-width: 84px;
  white-space: nowrap;
  text-align: right;
}
.${AUTOMATION_RECOMMEND_TABLE_HEADER_CLASS} {
  width: 96px;
  min-width: 96px;
  max-width: 96px;
  white-space: nowrap;
  text-align: right;
}
.${AUTOMATION_ESTIMATE_CELL_CLASS} {
  width: 84px;
  min-width: 84px;
  max-width: 84px;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  cursor: default;
  text-align: right;
  padding-right: 6px;
}
.${AUTOMATION_RECOMMEND_CELL_CLASS} {
  width: 96px;
  min-width: 96px;
  max-width: 96px;
  color: rgba(240, 244, 255, 0.95);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  text-align: right;
  padding-right: 6px;
}
.${AUTOMATION_ESTIMATE_CELL_CLASS}__text {
  color: rgba(240, 244, 255, 0.95);
  font-weight: 600;
}
.${AUTOMATION_ESTIMATE_CELL_CHANCE_CLASS} {
  font-size: 11px;
  font-weight: 700;
}
.${AUTOMATION_ESTIMATE_CELL_ETA_CLASS} {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.92;
}
.${AUTOMATION_ESTIMATE_CELL_ETA_DANGER_CLASS} {
  color: #ff5a5a;
  opacity: 1;
  font-weight: 700;
}
div[class*="LabyrinthPanel_automationSection"] table[class*="LabyrinthPanel_automationTable"] {
  width: 100%;
  max-width: 100%;
}
table[class*="LabyrinthPanel_automationTable"] thead th:nth-child(3),
table[class*="LabyrinthPanel_automationTable"] tbody td:nth-child(3) {
  white-space: nowrap;
}
.${PREVIEW_TOOLTIP_CLASS} {
  position: fixed;
  z-index: 2147483646;
  min-width: 140px;
  max-width: 220px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(128, 170, 255, 0.45);
  background: rgba(12, 16, 24, 0.95);
  color: #f2f7ff;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
  font-size: 11px;
  line-height: 1.35;
  pointer-events: none;
  display: none;
}
.${PREVIEW_TOOLTIP_CLASS}__title {
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 700;
  color: #9ec4ff;
}
.${PREVIEW_TOOLTIP_CLASS}__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  white-space: nowrap;
}
.${PREVIEW_TOOLTIP_CLASS}__label {
  opacity: 0.78;
}
.${PREVIEW_TOOLTIP_CLASS}__value {
  font-weight: 700;
  color: #ffffff;
}
@media (max-width: 700px), (pointer: coarse) {
  .${CONTROL_DISTRIBUTION_TOGGLE_CLASS},
  .${CONTROL_DISTRIBUTION_STEP_CLASS},
  .${ROOM_DISTRIBUTION_FLOAT_CLASS} {
    display: none !important;
  }
}
`;
        document.head.appendChild(style);
    }

    function getPreviewTooltip() {
        return document.getElementById(PREVIEW_TOOLTIP_ID);
    }

    function ensurePreviewTooltip() {
        let tooltip = getPreviewTooltip();
        if (tooltip) {
            return tooltip;
        }
        tooltip = document.createElement("div");
        tooltip.id = PREVIEW_TOOLTIP_ID;
        tooltip.className = PREVIEW_TOOLTIP_CLASS;
        document.body.appendChild(tooltip);
        return tooltip;
    }

    function hidePreviewTooltip() {
        const tooltip = getPreviewTooltip();
        if (!tooltip) {
            return;
        }
        tooltip.style.display = "none";
        tooltip.style.left = "-9999px";
        tooltip.style.top = "-9999px";
        tooltip.textContent = "";
    }

    function formatPreviewPercent(value) {
        return `${(clamp01(value) * 100).toFixed(1)}%`;
    }

    function formatPreviewDeltaPercent(value, digits = 2) {
        if (!Number.isFinite(value)) {
            return "--";
        }
        const percent = Math.max(0, finiteNumber(value, 0)) * 100;
        return `+${percent.toFixed(Math.max(0, Math.floor(digits)))}%`;
    }

    function computeEfficiencyDeltaForOneLessProgressUnit(targetProgress, effectiveSkillLevel, currentEfficiencyBonus, neededUnits) {
        const target = finiteNumber(targetProgress, 0);
        const skillLevel = finiteNumber(effectiveSkillLevel, 0);
        const efficiency = finiteNumber(currentEfficiencyBonus, 0);
        const units = Math.floor(finiteNumber(neededUnits, 0));
        if (!(target > 0) || !(skillLevel > 0) || units <= 1) {
            return null;
        }
        const requiredProgressPerSuccess = Math.ceil(target / (units - 1) - 1e-9);
        const requiredEfficiency = requiredProgressPerSuccess / skillLevel - 1;
        if (!Number.isFinite(requiredEfficiency)) {
            return null;
        }
        return Math.max(0, requiredEfficiency - efficiency);
    }

    function computeActionSpeedDeltaForOneMoreAttempt(baseActionSeconds, currentActionSpeedBonus, attempts) {
        const baseSeconds = finiteNumber(baseActionSeconds, 0);
        const speed = finiteNumber(currentActionSpeedBonus, 0);
        const currentAttempts = Math.max(0, Math.floor(finiteNumber(attempts, 0)));
        if (!(baseSeconds > 0)) {
            return null;
        }
        const requiredSpeed = (baseSeconds * (currentAttempts + 1)) / ROOM_DURATION_SECONDS - 1;
        if (!Number.isFinite(requiredSpeed)) {
            return null;
        }
        return Math.max(0, requiredSpeed - speed);
    }

    function formatExpectedRewardCount(value) {
        const n = Math.max(0, finiteNumber(value, 0));
        if (Math.abs(n - Math.round(n)) < 1e-9) {
            return `${Math.round(n)}`;
        }
        return n.toFixed(2).replace(/\.?0+$/, "");
    }

    function getCurrentLabyrinthFloor(state) {
        const floor = Math.floor(finiteNumber(state?.characterLabyrinth?.currentFloor, 1));
        return Math.max(1, floor);
    }

    function createRoomRewardPreview(state, room) {
        if (!room || !room.roomType) {
            return null;
        }
        const roomType = String(room.roomType || "");
        const floor = getCurrentLabyrinthFloor(state);
        const rows = [];

        if (roomType === LABYRINTH_COMBAT_ROOM_TYPE || roomType === LABYRINTH_SKILLING_ROOM_TYPE) {
            const tokenChance = Math.min(floor * 0.05, 0.5);
            const boxChance = Math.min(floor * 0.01, 0.1);
            const boxLabel = roomType === LABYRINTH_SKILLING_ROOM_TYPE ? t("skillingBoxExpected") : t("combatBoxExpected");
            rows.push({
                label: t("tokenExpected"),
                value: formatExpectedRewardCount(tokenChance),
            });
            rows.push({
                label: boxLabel,
                value: formatExpectedRewardCount(boxChance),
            });
        } else if (roomType === LABYRINTH_TREASURE_ROOM_TYPE) {
            const tokenCount = Math.min(floor, 10);
            const boxChance = Math.min(floor * 0.05, 0.5);
            rows.push({
                label: t("tokenExpected"),
                value: formatExpectedRewardCount(tokenCount),
            });
            rows.push({
                label: t("skillingBoxExpected"),
                value: formatExpectedRewardCount(boxChance),
            });
            rows.push({
                label: t("combatBoxExpected"),
                value: formatExpectedRewardCount(boxChance),
            });
        } else if (roomType === LABYRINTH_DESCEND_ROOM_TYPE) {
            const tokenCount = 5 * floor;
            const boxAverage = floor >= 4 ? (floor - 3) / 2 : 0;
            const refineAverage = floor >= 6 ? (floor - 4) / 2 : 0;
            rows.push({
                label: t("tokenExpected"),
                value: formatExpectedRewardCount(tokenCount),
            });
            rows.push({
                label: t("skillingBoxExpected"),
                value: formatExpectedRewardCount(boxAverage),
            });
            rows.push({
                label: t("combatBoxExpected"),
                value: formatExpectedRewardCount(boxAverage),
            });
            rows.push({
                label: t("refiningChestExpected"),
                value: formatExpectedRewardCount(refineAverage),
            });
        } else {
            return null;
        }

        return {
            floor,
            rows,
        };
    }

    function appendRewardPreviewRows(tooltip, rewardPreview) {
        if (!tooltip || !rewardPreview || !Array.isArray(rewardPreview.rows) || rewardPreview.rows.length === 0) {
            return;
        }
        for (const row of rewardPreview.rows) {
            if (!row || !row.label) {
                continue;
            }
            appendPreviewRow(tooltip, String(row.label), String(row.value ?? "--"));
        }
    }

    function getRoomPreviewTitle(roomType) {
        const type = String(roomType || "");
        if (type === LABYRINTH_SKILLING_ROOM_TYPE) {
            return t("skillingRoomPreview");
        }
        if (type === LABYRINTH_COMBAT_ROOM_TYPE) {
            return t("combatRoomPreview");
        }
        if (type === LABYRINTH_TREASURE_ROOM_TYPE) {
            return t("treasureRoomPreview");
        }
        if (type === LABYRINTH_DESCEND_ROOM_TYPE) {
            return t("floorExitPreview");
        }
        return t("roomPreview");
    }

    function buildRewardOnlyPreview(state, room) {
        const rewardPreview = createRoomRewardPreview(state, room);
        if (!rewardPreview) {
            return null;
        }
        return {
            type: "reward-only",
            title: getRoomPreviewTitle(room?.roomType),
            rewardPreview,
        };
    }

    function formatPreviewDecimal(value, digits = 1) {
        const n = finiteNumber(value, 0);
        return n.toFixed(digits);
    }

    function getEffectiveSkillingProgressPerSuccess(workPower) {
        return Math.max(0, Math.floor(finiteNumber(workPower, 0)));
    }

    function computeProgressPerSuccessForOneLessProgressUnit(targetProgress, neededUnits) {
        const target = finiteNumber(targetProgress, 0);
        const units = Math.floor(finiteNumber(neededUnits, 0));
        if (!(target > 0) || units <= 1) {
            return null;
        }
        return Math.max(1, Math.ceil(target / (units - 1) - 1e-9));
    }

    function formatSkillingWorkPowerWithEffectiveProgress(workPower, effectiveProgress) {
        const raw = finiteNumber(workPower, 0);
        const effective = getEffectiveSkillingProgressPerSuccess(
            effectiveProgress === null || effectiveProgress === undefined ? raw : effectiveProgress
        );
        const rawText = formatPreviewDecimal(raw, 2);
        if (Math.abs(raw - effective) < 1e-9) {
            return rawText;
        }
        return `${rawText} -> ${effective}`;
    }

    function formatPreviewInteger(value) {
        return `${Math.round(finiteNumber(value, 0))}`;
    }

    function formatPreviewExperience(value) {
        const n = Math.max(0, finiteNumber(value, 0));
        if (Math.abs(n - Math.round(n)) < 1e-9) {
            return `${Math.round(n)}`;
        }
        return n.toFixed(1).replace(/\.0$/, "");
    }

    function formatPreviewExperiencePerHourK(value) {
        const n = Math.max(0, finiteNumber(value, 0));
        return `${(n / 1000).toFixed(1)}K`;
    }

    function formatPreviewPercentValue(value, digits = 0) {
        const percent = finiteNumber(value, 0) * 100;
        if (digits <= 0) {
            return `${Math.round(percent)}%`;
        }
        return `${percent.toFixed(digits)}%`;
    }

    function getCombatStylePreviewLabel(styleHrid) {
        switch (styleHrid) {
            case "/combat_styles/stab":
                return t("styleStab");
            case "/combat_styles/slash":
                return t("styleSlash");
            case "/combat_styles/smash":
                return t("styleSmash");
            case "/combat_styles/ranged":
                return t("styleRanged");
            case "/combat_styles/magic":
                return t("styleMagic");
            default:
                return t("unknown");
        }
    }

    function getCombatStyleAccuracyLabel(styleHrid) {
        const joiner = isChineseUi() ? "" : " ";
        return `${getCombatStylePreviewLabel(styleHrid)}${joiner}${t("accuracySuffix")}`;
    }

    function getCombatStyleDamageLabel(styleHrid) {
        const joiner = isChineseUi() ? "" : " ";
        return `${getCombatStylePreviewLabel(styleHrid)}${joiner}${t("damageSuffix")}`;
    }

    function getCombatStyleEvasionLabel(styleHrid) {
        const joiner = isChineseUi() ? "" : " ";
        return `${getCombatStylePreviewLabel(styleHrid)}${joiner}${t("evasionSuffix")}`;
    }

    function getDamageTypePreviewLabel(damageTypeHrid) {
        switch (damageTypeHrid) {
            case "/damage_types/water":
                return t("water");
            case "/damage_types/nature":
                return t("nature");
            case "/damage_types/fire":
                return t("fire");
            case "/damage_types/physical":
                return t("physical");
            default:
                return t("unknown");
        }
    }

    function getDamageTypeMitigationLabel(damageTypeHrid) {
        switch (damageTypeHrid) {
            case "/damage_types/water":
                return t("waterResistance");
            case "/damage_types/nature":
                return t("natureResistance");
            case "/damage_types/fire":
                return t("fireResistance");
            case "/damage_types/physical":
            default:
                return t("armor");
        }
    }

    function appendPreviewRow(tooltip, label, value) {
        const row = document.createElement("div");
        row.className = `${PREVIEW_TOOLTIP_CLASS}__row`;

        const labelNode = document.createElement("span");
        labelNode.className = `${PREVIEW_TOOLTIP_CLASS}__label`;
        labelNode.textContent = label;

        const valueNode = document.createElement("span");
        valueNode.className = `${PREVIEW_TOOLTIP_CLASS}__value`;
        valueNode.textContent = value;

        row.appendChild(labelNode);
        row.appendChild(valueNode);
        tooltip.appendChild(row);
    }

    function deriveCombatFailureReasonFromCounts(totalFailures, failedByTimeout, failedByDeath) {
        const failures = Math.max(0, Math.floor(finiteNumber(totalFailures, 0)));
        if (failures <= 0) {
            return "";
        }
        const timeoutCount = Math.max(0, Math.floor(finiteNumber(failedByTimeout, 0)));
        const deathCount = Math.max(0, Math.floor(finiteNumber(failedByDeath, 0)));
        if (deathCount > timeoutCount) {
            return t("failureDefense");
        }
        return t("failureDamage");
    }

    function renderSkillingPreviewTooltip(preview) {
        const tooltip = ensurePreviewTooltip();
        tooltip.textContent = "";

        const titleNode = document.createElement("div");
        titleNode.className = `${PREVIEW_TOOLTIP_CLASS}__title`;
        titleNode.textContent = t("skillingRoomPreview");
        tooltip.appendChild(titleNode);

        if (preview.type === "enhancing") {
            appendPreviewRow(tooltip, t("targetEnhancement"), `+${Math.max(0, Math.floor(finiteNumber(preview.targetLevel, 0)))}`);
            appendPreviewRow(tooltip, t("successRate"), formatPreviewPercent(preview.successChance));
            appendPreviewRow(tooltip, t("doubleProgress"), formatPreviewPercent(preview.doubleChance));
            appendPreviewRow(tooltip, t("twoMinuteActions"), `${Math.max(0, Math.floor(finiteNumber(preview.attempts, 0)))}`);
            appendPreviewRow(tooltip, t("actionDuration"), `${formatPreviewDecimal(preview.actionSeconds, 2)}s`);
            appendPreviewRow(tooltip, t("experiencePerRoom"), formatPreviewExperience(preview.experiencePerRoom));
            appendPreviewRow(tooltip, t("experiencePerHour"), formatPreviewExperiencePerHourK(preview.experiencePerHour));
            appendPreviewRow(tooltip, t("needSpeedForOneMoreAction"), formatPreviewDeltaPercent(preview.speedDeltaForOneMoreAttempt, 2));
            appendPreviewRow(
                tooltip,
                t("speedTierClearChance"),
                Number.isFinite(preview.speedTierClearChance) ? formatPreviewPercent(preview.speedTierClearChance) : "--"
            );
            appendPreviewRow(
                tooltip,
                t("nextLevelClearChance"),
                Number.isFinite(preview.nextLevelClearChance) ? formatPreviewPercent(preview.nextLevelClearChance) : "--"
            );
            if (Number.isFinite(preview.nextSkillingSuccessClearChance)) {
                appendPreviewRow(
                    tooltip,
                    t("nextSkillingSuccessClearChance"),
                    formatPreviewPercent(preview.nextSkillingSuccessClearChance)
                );
            }
            if (Number.isFinite(preview.nextSkillingDoubleProgressClearChance)) {
                appendPreviewRow(
                    tooltip,
                    t("nextSkillingDoubleProgressClearChance"),
                    formatPreviewPercent(preview.nextSkillingDoubleProgressClearChance)
                );
            }
        } else {
            appendPreviewRow(
                tooltip,
                t("workPower"),
                formatSkillingWorkPowerWithEffectiveProgress(preview.workPower, preview.effectiveProgressPerSuccess)
            );
            appendPreviewRow(tooltip, t("successRate"), formatPreviewPercent(preview.successChance));
            appendPreviewRow(tooltip, t("doubleProgress"), formatPreviewPercent(preview.doubleChance));
            appendPreviewRow(tooltip, t("twoMinuteActions"), `${Math.max(0, Math.floor(finiteNumber(preview.attempts, 0)))}`);
            appendPreviewRow(tooltip, t("actionDuration"), `${formatPreviewDecimal(preview.actionSeconds, 2)}s`);
            appendPreviewRow(tooltip, t("experiencePerRoom"), formatPreviewExperience(preview.experiencePerRoom));
            appendPreviewRow(tooltip, t("experiencePerHour"), formatPreviewExperiencePerHourK(preview.experiencePerHour));
            appendPreviewRow(
                tooltip,
                t("needEfficiencyForOneLessProgress"),
                preview.efficiencyDeltaForOneLessProgressUnit === null
                    ? t("alreadyOptimal")
                    : formatPreviewDeltaPercent(preview.efficiencyDeltaForOneLessProgressUnit, 2)
            );
            appendPreviewRow(tooltip, t("needSpeedForOneMoreAction"), formatPreviewDeltaPercent(preview.speedDeltaForOneMoreAttempt, 2));
            appendPreviewRow(
                tooltip,
                t("nextLevelClearChance"),
                Number.isFinite(preview.nextLevelClearChance) ? formatPreviewPercent(preview.nextLevelClearChance) : "--"
            );
            appendPreviewRow(
                tooltip,
                t("efficiencyTierClearChance"),
                Number.isFinite(preview.efficiencyTierClearChance)
                    ? formatPreviewPercent(preview.efficiencyTierClearChance)
                    : t("alreadyOptimal")
            );
            appendPreviewRow(
                tooltip,
                t("speedTierClearChance"),
                Number.isFinite(preview.speedTierClearChance) ? formatPreviewPercent(preview.speedTierClearChance) : "--"
            );
            if (Number.isFinite(preview.nextSkillingSuccessClearChance)) {
                appendPreviewRow(
                    tooltip,
                    t("nextSkillingSuccessClearChance"),
                    formatPreviewPercent(preview.nextSkillingSuccessClearChance)
                );
            }
            if (Number.isFinite(preview.nextSkillingDoubleProgressClearChance)) {
                appendPreviewRow(
                    tooltip,
                    t("nextSkillingDoubleProgressClearChance"),
                    formatPreviewPercent(preview.nextSkillingDoubleProgressClearChance)
                );
            }
        }
        appendRewardPreviewRows(tooltip, preview.rewardPreview);

        return tooltip;
    }

    function renderCombatPreviewTooltip(preview) {
        const tooltip = ensurePreviewTooltip();
        tooltip.textContent = "";

        const titleNode = document.createElement("div");
        titleNode.className = `${PREVIEW_TOOLTIP_CLASS}__title`;
        titleNode.textContent = String(preview.monsterName || "--");
        tooltip.appendChild(titleNode);

        appendPreviewRow(tooltip, t("combatStyle"), String(preview.styleLabel || "--"));
        appendPreviewRow(tooltip, t("damageType"), String(preview.damageTypeLabel || "--"));
        appendPreviewRow(tooltip, t("attackInterval"), `${formatPreviewDecimal(preview.attackIntervalSeconds, 2)}s`);
        appendPreviewRow(tooltip, t("castSpeed"), formatPreviewPercentValue(preview.totalCastSpeed, 0));
        appendPreviewRow(tooltip, String(preview.styleAccuracyLabel || t("accuracyDefault")), formatPreviewInteger(preview.styleAccuracy));
        appendPreviewRow(tooltip, String(preview.styleDamageLabel || t("damageDefault")), formatPreviewInteger(preview.styleDamage));
        appendPreviewRow(tooltip, t("maxHp"), formatPreviewInteger(preview.maxHitpoints));
        appendPreviewRow(tooltip, String(preview.targetEvasionLabel || t("evasionDefault")), formatPreviewInteger(preview.targetEvasionRating));
        appendPreviewRow(tooltip, String(preview.targetMitigationLabel || t("mitigationDefault")), formatPreviewInteger(preview.targetMitigationValue));

        if (Array.isArray(preview.abilities) && preview.abilities.length > 0) {
            for (const ability of preview.abilities) {
                appendPreviewRow(
                    tooltip,
                    `Lv.${Math.max(1, Math.floor(finiteNumber(ability.level, 1)))}`,
                    String(ability.name || "--")
                );
            }
        }
        appendRewardPreviewRows(tooltip, preview.rewardPreview);
        appendPreviewRow(tooltip, t("operation"), t("rightClickOpenSimulator"));
        if (preview.failureReason) {
            appendPreviewRow(tooltip, t("failureReason"), String(preview.failureReason));
        }

        return tooltip;
    }

    function renderRewardOnlyPreviewTooltip(preview) {
        const tooltip = ensurePreviewTooltip();
        tooltip.textContent = "";

        const titleNode = document.createElement("div");
        titleNode.className = `${PREVIEW_TOOLTIP_CLASS}__title`;
        titleNode.textContent = String(preview?.title || t("roomPreview"));
        tooltip.appendChild(titleNode);

        appendRewardPreviewRows(tooltip, preview?.rewardPreview || null);
        return tooltip;
    }

    function buildCombatPreview(state, room, initClientData, result = null) {
        if (!room || room.roomType !== LABYRINTH_COMBAT_ROOM_TYPE || !room.monsterHrid) {
            return null;
        }
        const monster = initClientData?.combatMonsterDetailMap?.[room.monsterHrid];
        const baseDetails = monster?.combatDetails;
        if (!baseDetails || !baseDetails.combatStats) {
            return null;
        }

        const scaledTemplate = createMonsterCombatTemplate(initClientData, room);
        const details = scaledTemplate?.combatDetails || baseDetails;
        const stats = details.combatStats || baseDetails.combatStats;
        const roomLevel = positiveNumber(room?.recommendedLevel, positiveNumber(baseDetails.combatLevel, 100));
        const combatLevel = Math.max(1, Math.floor(roomLevel));
        const baseCombatLevel = positiveNumber(baseDetails.combatLevel, combatLevel);
        const abilityLevelScale = roomLevel / Math.max(1, baseCombatLevel);
        const styleHrid = getCombatStyleHrid(stats);
        const damageTypeHrid = getDamageTypeHrid(stats);
        const loadoutWeaponMeta = getLoadoutWeaponCombatMetaForRoom(state, initClientData, room);
        const currentPlayerCombatStats = state?.combatUnit?.combatDetails?.combatStats || null;
        const targetStyleHrid = loadoutWeaponMeta?.styleHrid || getCombatStyleHrid(currentPlayerCombatStats);
        const targetDamageTypeHrid = loadoutWeaponMeta?.damageTypeHrid || getDamageTypeHrid(currentPlayerCombatStats);
        const rewardPreview = createRoomRewardPreview(state, room);
        const attackIntervalNs = positiveNumber(details.attackInterval || stats.attackInterval, COMBAT_ONE_SECOND_NS);
        const abilityMap = initClientData?.abilityDetailMap || {};
        const abilities = [];
        if (Array.isArray(monster?.abilities)) {
            for (const rawAbility of monster.abilities) {
                if (!rawAbility || !rawAbility.abilityHrid) {
                    continue;
                }
                const abilityHrid = String(rawAbility.abilityHrid);
                const abilityDetail = getAbilityDetailByHrid(state, initClientData, abilityHrid) || getContainerValue(abilityMap, abilityHrid);
                const fallbackName = abilityHrid.split("/").pop() || abilityHrid;
                const localizedName = isChineseUi() ? LABYRINTH_ABILITY_NAME_ZH_MAP[abilityHrid] : "";
                const baseAbilityLevel = positiveNumber(rawAbility.level, 1);
                abilities.push({
                    level: Math.max(1, Math.round(baseAbilityLevel * abilityLevelScale)),
                    name: String(localizedName || abilityDetail?.name || fallbackName),
                });
            }
        }

        return {
            type: "combat",
            monsterName: String(
                (isChineseUi() &&
                    (LABYRINTH_MONSTER_NAME_ZH_BY_TAIL[String(room.monsterHrid || "").split("/").pop() || ""] ||
                        LABYRINTH_MONSTER_NAME_ZH_MAP[room.monsterHrid])) ||
                    monster?.name ||
                    room.monsterHrid.split("/").pop() ||
                    room.monsterHrid
            ),
            baseCombatLevel: combatLevel,
            styleLabel: getCombatStylePreviewLabel(styleHrid),
            damageTypeLabel: getDamageTypePreviewLabel(damageTypeHrid),
            attackIntervalSeconds: attackIntervalNs / COMBAT_ONE_SECOND_NS,
            totalCastSpeed: finiteNumber(details.totalCastSpeed, finiteNumber(baseDetails.totalCastSpeed, 0)),
            styleAccuracyLabel: getCombatStyleAccuracyLabel(styleHrid),
            styleDamageLabel: getCombatStyleDamageLabel(styleHrid),
            maxHitpoints: positiveNumber(details.maxHitpoints, 1),
            maxManapoints: positiveNumber(details.maxManapoints, 1),
            styleAccuracy: getAccuracyRating(details, styleHrid),
            styleDamage: getMaxDamage(details, styleHrid),
            defensiveMaxDamage: positiveNumber(details.defensiveMaxDamage, 0),
            targetEvasionLabel: getCombatStyleEvasionLabel(targetStyleHrid),
            targetEvasionRating: getEvasionRating(details, targetStyleHrid),
            targetMitigationLabel: getDamageTypeMitigationLabel(targetDamageTypeHrid),
            targetMitigationValue: getResistance(details, targetDamageTypeHrid),
            totalThreat: positiveNumber(details.totalThreat, 100),
            rewardPreview,
            failureReason: String(result?.combatMeta?.failureReason || ""),
            abilities,
        };
    }

    function getLoadoutWeaponCombatMetaForRoom(state, initClientData, room) {
        const loadoutInfo = resolveCombatRoomLoadout(state, room);
        const loadout = loadoutInfo?.loadout;
        if (!isCombatLoadout(loadout)) {
            return null;
        }
        const wearableMap = loadout.wearableMap || {};
        const weaponSlots = ["/item_locations/two_hand", "/item_locations/main_hand"];
        let styleHrid = "";
        let damageTypeHrid = "";
        for (const slotKey of weaponSlots) {
            const entry = parseWearableReference(wearableMap[slotKey]);
            if (!entry || !entry.itemHrid) {
                continue;
            }
            const itemDetail = getItemDetailByHrid(state, initClientData, entry.itemHrid);
            const baseStats = itemDetail?.equipmentDetail?.combatStats || {};
            if (!styleHrid) {
                if (Array.isArray(baseStats.combatStyleHrids) && baseStats.combatStyleHrids.length > 0) {
                    styleHrid = String(baseStats.combatStyleHrids[0] || "");
                } else if (typeof baseStats.combatStyleHrid === "string" && baseStats.combatStyleHrid) {
                    styleHrid = baseStats.combatStyleHrid;
                }
            }
            if (!damageTypeHrid && typeof baseStats.damageType === "string" && baseStats.damageType) {
                damageTypeHrid = baseStats.damageType;
            }
            if (styleHrid && damageTypeHrid) {
                break;
            }
        }
        if (!styleHrid && !damageTypeHrid) {
            return null;
        }
        return {
            styleHrid,
            damageTypeHrid,
        };
    }

    function getCellPreview(cell) {
        if (!cell) {
            return null;
        }
        const combatPreview = combatPreviewByCell.get(cell);
        if (combatPreview) {
            return combatPreview;
        }
        return skillingPreviewByCell.get(cell) || null;
    }

    function renderCellPreviewTooltip(preview) {
        if (preview?.type === "combat") {
            return renderCombatPreviewTooltip(preview);
        }
        if (preview?.type === "reward-only") {
            return renderRewardOnlyPreviewTooltip(preview);
        }
        return renderSkillingPreviewTooltip(preview);
    }

    function positionPreviewTooltip(tooltip, x, y) {
        const offset = 12;
        const margin = 8;
        tooltip.style.display = "block";
        tooltip.style.left = "0px";
        tooltip.style.top = "0px";

        const width = tooltip.offsetWidth || 180;
        const height = tooltip.offsetHeight || 100;
        let left = x + offset;
        let top = y + offset;

        if (left + width + margin > window.innerWidth) {
            left = Math.max(margin, x - width - offset);
        }
        if (top + height + margin > window.innerHeight) {
            top = Math.max(margin, y - height - offset);
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    function showSkillingPreviewTooltip(cell, event) {
        const preview = getCellPreview(cell);
        if (!preview) {
            hidePreviewTooltip();
            return;
        }
        const tooltip = renderCellPreviewTooltip(preview);
        positionPreviewTooltip(tooltip, event.clientX, event.clientY);
    }

    function bindSkillingPreviewEvents(cell) {
        if (!cell || cell[PREVIEW_CELL_BOUND_FLAG]) {
            return;
        }
        cell[PREVIEW_CELL_BOUND_FLAG] = true;
        cell.addEventListener("mouseenter", (event) => {
            showSkillingPreviewTooltip(cell, event);
        });
        cell.addEventListener("mousemove", (event) => {
            showSkillingPreviewTooltip(cell, event);
        });
        cell.addEventListener("mouseleave", () => {
            hidePreviewTooltip();
        });
        cell.addEventListener("contextmenu", (event) => {
            const preview = getCellPreview(cell);
            if (!preview || preview.type !== "combat") {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            openCombatRoomSimulatorFromCell(cell);
        });
    }

    function setCellSkillingPreview(cell, preview) {
        if (!cell || !preview) {
            return;
        }
        bindSkillingPreviewEvents(cell);
        skillingPreviewByCell.set(cell, preview);
    }

    function setCellCombatPreview(cell, preview) {
        if (!cell || !preview) {
            return;
        }
        bindSkillingPreviewEvents(cell);
        combatPreviewByCell.set(cell, preview);
    }

    function clearCellSkillingPreview(cell) {
        if (!cell) {
            return;
        }
        skillingPreviewByCell.delete(cell);
    }

    function clearCellCombatPreview(cell) {
        if (!cell) {
            return;
        }
        combatPreviewByCell.delete(cell);
    }

    function isLabyrinthPanelInstance(value) {
        return Boolean(
            value &&
                typeof value === "object" &&
                typeof value.getSkillingRoomTypes === "function" &&
                typeof value.getCombatRoomTypes === "function" &&
                typeof value.getEffectiveLevelForRoom === "function"
        );
    }

    function findLabyrinthPanelInstanceFromFiber(rootFiber) {
        if (!rootFiber || typeof rootFiber !== "object") {
            return null;
        }
        const queue = [rootFiber];
        const visited = new Set();
        let steps = 0;
        while (queue.length > 0 && steps < 12000) {
            const fiber = queue.shift();
            if (!fiber || typeof fiber !== "object" || visited.has(fiber)) {
                continue;
            }
            visited.add(fiber);
            steps += 1;

            if (isLabyrinthPanelInstance(fiber.stateNode)) {
                return fiber.stateNode;
            }

            if (fiber.child) {
                queue.push(fiber.child);
            }
            if (fiber.sibling) {
                queue.push(fiber.sibling);
            }
            if (fiber.return) {
                queue.push(fiber.return);
            }
        }
        return null;
    }

    function getLabyrinthPanelInstance() {
        const panelElement = document.querySelector('div[class*="LabyrinthPanel_labyrinthPanel"]');
        if (!panelElement) {
            return null;
        }
        const reactKey = Object.keys(panelElement).find((key) => key.startsWith("__reactFiber$"));
        if (!reactKey) {
            return null;
        }
        const fiberNode = panelElement[reactKey];
        return findLabyrinthPanelInstanceFromFiber(fiberNode);
    }

    function getAutomationEstimateTable() {
        const direct = document.querySelector('table[class*="LabyrinthPanel_automationTable"]');
        if (direct) {
            return direct;
        }
        const panel = document.querySelector('div[class*="LabyrinthPanel_labyrinthPanel"]');
        if (!panel) {
            return null;
        }
        const tables = Array.from(panel.querySelectorAll("table"));
        for (const table of tables) {
            const headerCells = Array.from(table.querySelectorAll("thead th")).map((th) =>
                String(th.textContent || "").trim()
            );
            if (!headerCells.length) {
                continue;
            }
            const hasRoomType = headerCells.some((text) => /房間型別|room\s*type/i.test(text));
            const hasSkip = headerCells.some((text) => /跳過如果高出等級|跳過等級|skip.*level|skip\s*if/i.test(text));
            if (hasRoomType && hasSkip) {
                return table;
            }
        }
        return null;
    }

    function getAutomationEstimateSection(table) {
        if (!table) {
            return null;
        }
        return table.closest('div[class*="LabyrinthPanel_automationSection"]') || table.parentElement || null;
    }

    function clearAutomationWideLayout() {
        if (!Array.isArray(automationWideLayoutNodes) || automationWideLayoutNodes.length === 0) {
            return;
        }
        for (const node of automationWideLayoutNodes) {
            if (!node || !node.style) {
                continue;
            }
            node.style.removeProperty("width");
            node.style.removeProperty("max-width");
            node.style.removeProperty("min-width");
        }
        automationWideLayoutNodes = [];
    }

    function applyAutomationWideLayout(section, table) {
        clearAutomationWideLayout();
        if (!section) {
            return;
        }
        const currentWidth = Math.max(0, Math.floor(section.getBoundingClientRect().width));
        if (!currentWidth) {
            return;
        }
        const maxAllowed = Math.max(320, Math.floor(window.innerWidth - 24));
        const targetWidth = Math.min(maxAllowed, currentWidth + 100);
        section.style.setProperty("width", `${targetWidth}px`, "important");
        section.style.setProperty("max-width", `${targetWidth}px`, "important");
        section.style.setProperty("min-width", "0px", "important");
        if (table && table.style) {
            table.style.setProperty("width", "100%", "important");
            table.style.setProperty("max-width", "100%", "important");
        }
        automationWideLayoutNodes = table ? [section, table] : [section];
    }

    function isAutomationEstimatePanelVisible() {
        return Boolean(getAutomationEstimateTable());
    }

    function hasAnyLabyrinthCrateSelected(state) {
        const selection = getLabyrinthCrateSelection(state);
        const tea = String(selection?.teaCrateItemHrid || "");
        const coffee = String(selection?.coffeeCrateItemHrid || "");
        const food = String(selection?.foodCrateItemHrid || "");
        return Boolean(tea || coffee || food);
    }

    function getAutomationMissingCratesForEntry(entry, crateSelection) {
        const tea = String(crateSelection?.teaCrateItemHrid || "");
        const coffee = String(crateSelection?.coffeeCrateItemHrid || "");
        const food = String(crateSelection?.foodCrateItemHrid || "");
        if (entry?.isCombat) {
            const missing = [];
            if (!coffee) {
                missing.push(t("missingCoffeeCrate"));
            }
            if (!food) {
                missing.push(t("missingFoodCrate"));
            }
            return missing;
        }
        return tea ? [] : [t("missingTeaCrate")];
    }

    function formatAutomationMissingCratesMessage(missingCrates) {
        if (!Array.isArray(missingCrates) || missingCrates.length === 0) {
            return "";
        }
        const joiner = isChineseUi() ? "、" : " / ";
        return t("missingCrateFmt", { crates: missingCrates.join(joiner) });
    }

    function normalizeAutomationRoomTypeEntry(rawEntry, isCombat) {
        const key = String(rawEntry?.key || "");
        if (!key) {
            return null;
        }
        if (isCombat) {
            const monsterHrid = String(rawEntry?.monsterHrid || "");
            if (!monsterHrid) {
                return null;
            }
            return {
                key,
                isCombat: true,
                monsterHrid,
            };
        }
        const skillHrid = String(rawEntry?.skillHrid || "");
        if (!skillHrid) {
            return null;
        }
        return {
            key,
            isCombat: false,
            skillHrid,
        };
    }

    function getAutomationRoomTypeEntries(panelInstance) {
        const skillingFromPanel =
            typeof panelInstance?.getSkillingRoomTypes === "function" ? panelInstance.getSkillingRoomTypes() : null;
        const combatFromPanel =
            typeof panelInstance?.getCombatRoomTypes === "function" ? panelInstance.getCombatRoomTypes() : null;
        const skillingRaw =
            Array.isArray(skillingFromPanel) && skillingFromPanel.length > 0
                ? skillingFromPanel
                : LABYRINTH_AUTOMATION_SKILL_ROOM_TYPES;
        const combatRaw =
            Array.isArray(combatFromPanel) && combatFromPanel.length > 0
                ? combatFromPanel
                : LABYRINTH_AUTOMATION_COMBAT_ROOM_TYPES;
        const result = [];
        for (const rawEntry of Array.isArray(skillingRaw) ? skillingRaw : []) {
            const normalized = normalizeAutomationRoomTypeEntry(rawEntry, false);
            if (normalized) {
                result.push(normalized);
            }
        }
        for (const rawEntry of Array.isArray(combatRaw) ? combatRaw : []) {
            const normalized = normalizeAutomationRoomTypeEntry(rawEntry, true);
            if (normalized) {
                result.push(normalized);
            }
        }
        return result;
    }

    function getAutomationRoomTypeEntryByKey(roomTypeKey, panelInstance = null) {
        const key = String(roomTypeKey || "");
        if (!key) {
            return null;
        }
        const panel = panelInstance || getLabyrinthPanelInstance();
        const entries = getAutomationRoomTypeEntries(panel);
        for (const entry of entries) {
            if (String(entry?.key || "") === key) {
                return entry;
            }
        }
        return null;
    }

    function createAutomationRoomFromEntry(entry, roomLevel) {
        const level = Math.max(1, Math.floor(finiteNumber(roomLevel, 1)));
        if (entry?.isCombat) {
            return {
                roomType: LABYRINTH_COMBAT_ROOM_TYPE,
                monsterHrid: String(entry.monsterHrid || ""),
                recommendedLevel: level,
            };
        }
        return {
            roomType: LABYRINTH_SKILLING_ROOM_TYPE,
            skillHrid: String(entry?.skillHrid || ""),
            recommendedLevel: level,
        };
    }

    function resolveAutomationRoomLoadoutId(panelInstance, key, state) {
        let value = null;
        if (typeof panelInstance?.getLoadoutIdForRoomType === "function") {
            value = panelInstance.getLoadoutIdForRoomType(key);
        }
        if (!Number.isFinite(Number(value))) {
            const settingKey = `labyrinthLoadout${toPascalCase(key)}`;
            value = state?.characterSetting?.[settingKey];
        }
        return Math.max(0, Math.floor(finiteNumber(value, 0)));
    }

    function resolveAutomationSkipThreshold(panelInstance, key, state, skipThresholdOverrides = null) {
        let value = null;
        if (skipThresholdOverrides instanceof Map && skipThresholdOverrides.has(String(key || ""))) {
            value = skipThresholdOverrides.get(String(key || ""));
        }
        if (typeof panelInstance?.getSkipThresholdForRoomType === "function") {
            const panelValue = panelInstance.getSkipThresholdForRoomType(key);
            if (!Number.isFinite(Number(value))) {
                value = panelValue;
            }
        }
        if (!Number.isFinite(Number(value))) {
            const settingKey = `labyrinthSkip${toPascalCase(key)}`;
            value = state?.characterSetting?.[settingKey];
        }
        if (!Number.isFinite(Number(value))) {
            value = AUTOMATION_ESTIMATE_DEFAULT_SKIP_THRESHOLD;
        }
        return Math.floor(finiteNumber(value, AUTOMATION_ESTIMATE_DEFAULT_SKIP_THRESHOLD));
    }

    function getAutomationCombatBaseLevel(state) {
        const fromCombatSkill = finiteNumber(getSkillLevel(state?.characterSkillMap, COMBAT_LEVEL_SKILL_HRID), NaN);
        if (Number.isFinite(fromCombatSkill) && fromCombatSkill > 0) {
            return fromCombatSkill;
        }
        const fromCombatDetails = finiteNumber(state?.combatUnit?.combatDetails?.combatLevel, NaN);
        if (Number.isFinite(fromCombatDetails) && fromCombatDetails > 0) {
            return fromCombatDetails;
        }
        const fromCombatUnit = finiteNumber(state?.combatUnit?.combatLevel, NaN);
        if (Number.isFinite(fromCombatUnit) && fromCombatUnit > 0) {
            return fromCombatUnit;
        }
        const fromCharacter = finiteNumber(state?.character?.combatLevel, NaN);
        if (Number.isFinite(fromCharacter) && fromCharacter > 0) {
            return fromCharacter;
        }

        const levels = getCombatSkillLevelsFromState(state);
        const avg =
            (finiteNumber(levels.stamina, 1) +
                finiteNumber(levels.intelligence, 1) +
                finiteNumber(levels.attack, 1) +
                finiteNumber(levels.defense, 1) +
                finiteNumber(levels.melee, 1) +
                finiteNumber(levels.ranged, 1) +
                finiteNumber(levels.magic, 1)) /
            7;
        return Math.max(0, avg);
    }

    function getAutomationCombatCrateLevelBonus(state, initClientData) {
        if (!state || !initClientData) {
            return 0;
        }
        const combatCrate = getCombatCrateBuffs(state, initClientData);
        const buffs = Array.isArray(combatCrate?.combatBuffs) ? combatCrate.combatBuffs : [];
        if (!buffs.length) {
            return 0;
        }
        const skillLevelTypes = new Set([
            "/buff_types/stamina_level",
            "/buff_types/intelligence_level",
            "/buff_types/attack_level",
            "/buff_types/defense_level",
            "/buff_types/melee_level",
            "/buff_types/ranged_level",
            "/buff_types/magic_level",
        ]);

        let directLevelBonus = 0;
        let skillLevelSum = 0;
        let skillLevelCount = 0;

        for (const buff of buffs) {
            const typeHrid = String(buff?.typeHrid || "");
            if (!typeHrid) {
                continue;
            }
            const amount = getBuffAmount(buff);
            if (!Number.isFinite(amount) || amount === 0) {
                continue;
            }
            if (typeHrid === "/buff_types/combat_level" || typeHrid === "/buff_types/action_level") {
                directLevelBonus += amount;
                continue;
            }
            if (skillLevelTypes.has(typeHrid)) {
                skillLevelSum += amount;
                skillLevelCount += 1;
            }
        }

        const averagedSkillLevelBonus = skillLevelCount > 0 ? skillLevelSum / skillLevelCount : 0;
        return Math.max(0, directLevelBonus + averagedSkillLevelBonus);
    }

    function resolveAutomationEffectiveLevel(panelInstance, entry, state, initClientData, options = {}) {
        const includePersonalBuffs = !(options && options.includePersonalBuffs === false);
        if (!entry?.isCombat) {
            if (includePersonalBuffs) {
                const testRoom = createAutomationRoomFromEntry(entry, 1);
                const fromPanel =
                    typeof panelInstance?.getEffectiveLevelForRoom === "function"
                        ? finiteNumber(panelInstance.getEffectiveLevelForRoom(testRoom), NaN)
                        : NaN;
                if (Number.isFinite(fromPanel)) {
                    return Math.max(0, fromPanel);
                }
            }
            const baseLevel = positiveNumber(getSkillLevel(state?.characterSkillMap, entry.skillHrid), 1);
            const selection = getLabyrinthCrateSelection(state);
            const teaCrateItemHrid = String(selection?.teaCrateItemHrid || "");
            const skillId = skillHridToSkillId(entry.skillHrid);
            const crateMetrics = getSkillingBuffMetrics(skillId, getCrateBuffs(initClientData, teaCrateItemHrid));
            return Math.max(0, baseLevel + finiteNumber(crateMetrics.skillLevelBonus, 0));
        }

        const baseCombatLevel = getAutomationCombatBaseLevel(state);
        const crateLevelBonus = getAutomationCombatCrateLevelBonus(state, initClientData);
        return Math.max(0, baseCombatLevel + crateLevelBonus);
    }

    function computeAutomationTargetRoomLevel(effectiveLevel, skipThreshold) {
        const effective = finiteNumber(effectiveLevel, 0);
        const threshold = Math.floor(finiteNumber(skipThreshold, AUTOMATION_ESTIMATE_DEFAULT_SKIP_THRESHOLD));
        return Math.floor(effective + threshold - 1);
    }

    function computeAutomationMaxFloorByRoomLevel(roomLevel) {
        const level = Math.max(0, Math.floor(finiteNumber(roomLevel, 0)));
        if (level <= 0) {
            return 0;
        }
        return Math.max(0, Math.floor(level / 20));
    }

    function getAutomationRoomLabel(entry, initClientData = null) {
        if (entry?.isCombat) {
            const monsterHrid = String(entry?.monsterHrid || "");
            const monsterDetail = monsterHrid ? getContainerValue(initClientData?.combatMonsterDetailMap, monsterHrid) : null;
            return String(
                (isChineseUi() &&
                    (LABYRINTH_MONSTER_NAME_ZH_MAP[monsterHrid] || LABYRINTH_MONSTER_NAME_ZH_BY_TAIL[monsterHrid.split("/").pop() || ""])) ||
                    monsterDetail?.name ||
                    monsterHrid.split("/").pop() ||
                    monsterHrid ||
                    "--"
            );
        }
        const key = String(entry?.key || "");
        return isChineseUi()
            ? LABYRINTH_AUTOMATION_SKILL_NAME_ZH_BY_KEY[key] || key || "--"
            : LABYRINTH_AUTOMATION_SKILL_NAME_EN_BY_KEY[key] || key || "--";
    }

    function parseAutomationSkipThresholdFromRow(row) {
        if (!row) {
            return NaN;
        }
        const cells = Array.from(row.querySelectorAll("td"));
        const skipCell = cells[2] || null;
        const rawText = String(skipCell?.textContent || "");
        const match = rawText.match(/-?\d+/);
        if (!match) {
            return NaN;
        }
        return Math.floor(finiteNumber(Number(match[0]), NaN));
    }

    function buildAutomationSkipThresholdOverrideMap(entries) {
        const overrides = new Map();
        if (!Array.isArray(entries) || entries.length === 0) {
            return overrides;
        }
        const table = getAutomationEstimateTable();
        if (!table) {
            return overrides;
        }
        const rows = Array.from(table.querySelectorAll("tbody tr"));
        const count = Math.min(entries.length, rows.length);
        for (let i = 0; i < count; i += 1) {
            const entry = entries[i];
            if (!entry?.key) {
                continue;
            }
            const parsed = parseAutomationSkipThresholdFromRow(rows[i]);
            if (!Number.isFinite(parsed)) {
                continue;
            }
            overrides.set(String(entry.key), parsed);
        }
        return overrides;
    }

    function buildAutomationEstimateSharedSignature(state) {
        if (!state || !state.characterLabyrinth) {
            return "";
        }
        const selection = getLabyrinthCrateSelection(state);
        const crateSignature = [
            String(selection?.teaCrateItemHrid || ""),
            String(selection?.coffeeCrateItemHrid || ""),
            String(selection?.foodCrateItemHrid || ""),
        ].join("|");
        const trials = getSelectedAutomationCombatTrials();
        return `crate=${crateSignature}|trials=${trials}`;
    }

    function buildAutomationRecommendSharedSignature(state, targetWinRate) {
        if (!state || !state.characterLabyrinth) {
            return "";
        }
        const selection = getLabyrinthCrateSelection(state);
        const crateSignature = [
            String(selection?.teaCrateItemHrid || ""),
            String(selection?.coffeeCrateItemHrid || ""),
            String(selection?.foodCrateItemHrid || ""),
        ].join("|");
        const trials = getSelectedAutomationCombatTrials();
        const target = normalizeAutomationTargetWinRate(targetWinRate);
        return `crate=${crateSignature}|trials=${trials}|target=${target}`;
    }

    function buildAutomationEstimateEntrySignature(panelInstance, entry, state, sharedSignature, skipThresholdOverrides) {
        if (!entry?.key || !state) {
            return "";
        }
        const threshold = resolveAutomationSkipThreshold(panelInstance, entry.key, state, skipThresholdOverrides);
        const loadoutId = resolveAutomationRoomLoadoutId(panelInstance, entry.key, state);
        const effective = resolveAutomationEffectiveLevel(panelInstance, entry, state, null, {
            includePersonalBuffs: false,
        });
        const roundedEffective = Math.round(effective * 100) / 100;
        return `${sharedSignature}|${entry.key}:${threshold}:${loadoutId}:${roundedEffective}`;
    }

    function buildAutomationRecommendEntrySignature(panelInstance, entry, state, sharedSignature) {
        if (!entry?.key || !state) {
            return "";
        }
        const loadoutId = resolveAutomationRoomLoadoutId(panelInstance, entry.key, state);
        const effective = resolveAutomationEffectiveLevel(panelInstance, entry, state, null, {
            includePersonalBuffs: false,
        });
        const roundedEffective = Math.round(effective * 100) / 100;
        return `${sharedSignature}|${entry.key}:${loadoutId}:${roundedEffective}`;
    }

    function renderAutomationEstimateTooltip(estimate) {
        if (!estimate || estimate.status !== "ready") {
            const tooltip = ensurePreviewTooltip();
            tooltip.textContent = "";
            const titleNode = document.createElement("div");
            titleNode.className = `${PREVIEW_TOOLTIP_CLASS}__title`;
            titleNode.textContent = String(estimate?.roomLabel || t("automationPreview"));
            tooltip.appendChild(titleNode);
            appendPreviewRow(tooltip, t("status"), String(estimate?.message || t("pending")));
            return tooltip;
        }

        const tooltip = estimate.detailPreview ? renderCellPreviewTooltip(estimate.detailPreview) : ensurePreviewTooltip();
        const hiddenLabels = new Set([t("combatTrials"), "Combat Trials", "戰鬥次數", t("successRate"), "勝率", "ETA", "耗時", t("tokenExpected"), "代幣期望"]);
        const hiddenLabelIncludes = ["Box Expected", "盒子期望", "盒期望", "紫盒期望", "寶箱期望"];
        const rows = Array.from(tooltip.querySelectorAll(`.${PREVIEW_TOOLTIP_CLASS}__row`));
        for (const row of rows) {
            const labelNode = row.querySelector(`.${PREVIEW_TOOLTIP_CLASS}__label`);
            const labelText = String(labelNode?.textContent || "").trim();
            if (!labelText) {
                continue;
            }
            if (hiddenLabels.has(labelText) || hiddenLabelIncludes.some((part) => labelText.includes(part))) {
                row.remove();
            }
        }
        if (!estimate.detailPreview) {
            tooltip.textContent = "";
            const titleNode = document.createElement("div");
            titleNode.className = `${PREVIEW_TOOLTIP_CLASS}__title`;
            titleNode.textContent = String(estimate.roomLabel || t("automationPreview"));
            tooltip.appendChild(titleNode);
        }
        appendPreviewRow(tooltip, t("level"), `Lv.${Math.max(1, Math.floor(finiteNumber(estimate.roomLevel, 1)))}`);
        if (!estimate.detailPreview && estimate.isCombat && estimate.failureReason) {
            appendPreviewRow(tooltip, t("failureReason"), String(estimate.failureReason));
        }
        return tooltip;
    }

    function getAutomationEstimateFromCell(cell) {
        if (!cell) {
            return null;
        }
        const roomTypeKey = String(cell.getAttribute("data-mwi-auto-room-key") || "");
        if (!roomTypeKey) {
            return null;
        }
        return automationEstimateByRoomTypeKey.get(roomTypeKey) || null;
    }

    function getAutomationRecommendFromCell(cell) {
        if (!cell) {
            return null;
        }
        const roomTypeKey = String(cell.getAttribute("data-mwi-auto-room-key") || "");
        if (!roomTypeKey) {
            return null;
        }
        return automationRecommendByRoomTypeKey.get(roomTypeKey) || null;
    }

    function showAutomationEstimateTooltip(cell, event) {
        const estimate = getAutomationEstimateFromCell(cell);
        if (!estimate) {
            hidePreviewTooltip();
            return;
        }
        const tooltip = renderAutomationEstimateTooltip(estimate);
        positionPreviewTooltip(tooltip, event.clientX, event.clientY);
    }

    function showAutomationRecommendTooltip(cell, event) {
        const estimate = getAutomationRecommendFromCell(cell);
        if (!estimate) {
            hidePreviewTooltip();
            return;
        }
        const tooltip = renderAutomationEstimateTooltip(estimate);
        positionPreviewTooltip(tooltip, event.clientX, event.clientY);
    }

    function bindAutomationEstimateCellEvents(cell) {
        if (!cell || cell[AUTOMATION_ESTIMATE_CELL_BOUND_FLAG]) {
            return;
        }
        cell[AUTOMATION_ESTIMATE_CELL_BOUND_FLAG] = true;
        cell.addEventListener("mouseenter", (event) => {
            showAutomationEstimateTooltip(cell, event);
        });
        cell.addEventListener("mousemove", (event) => {
            showAutomationEstimateTooltip(cell, event);
        });
        cell.addEventListener("mouseleave", () => {
            hidePreviewTooltip();
        });
        cell.addEventListener("contextmenu", (event) => {
            const roomTypeKey = String(cell.getAttribute("data-mwi-auto-room-key") || "");
            if (!roomTypeKey) {
                return;
            }
            const estimate = getAutomationEstimateFromCell(cell);
            const entry = getAutomationRoomTypeEntryByKey(roomTypeKey);
            const isCombat = Boolean(estimate?.isCombat || entry?.isCombat);
            if (!isCombat) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            openCombatRoomSimulatorFromAutomationCell(cell);
        });
    }

    function bindAutomationRecommendCellEvents(cell) {
        if (!cell || cell[AUTOMATION_RECOMMEND_CELL_BOUND_FLAG]) {
            return;
        }
        cell[AUTOMATION_RECOMMEND_CELL_BOUND_FLAG] = true;
        cell.addEventListener("mouseenter", (event) => {
            showAutomationRecommendTooltip(cell, event);
        });
        cell.addEventListener("mousemove", (event) => {
            showAutomationRecommendTooltip(cell, event);
        });
        cell.addEventListener("mouseleave", () => {
            hidePreviewTooltip();
        });
        cell.addEventListener("contextmenu", (event) => {
            const roomTypeKey = String(cell.getAttribute("data-mwi-auto-room-key") || "");
            if (!roomTypeKey) {
                return;
            }
            const recommend = getAutomationRecommendFromCell(cell);
            const entry = getAutomationRoomTypeEntryByKey(roomTypeKey);
            const isCombat = Boolean(recommend?.isCombat || entry?.isCombat);
            if (!isCombat) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            openCombatRoomSimulatorFromAutomationCell(cell);
        });
    }

    function ensureAutomationMaxFloorHeader(table) {
        const headRow = table?.querySelector("thead tr");
        if (!headRow) {
            return;
        }
        if (headRow.querySelector(`.${AUTOMATION_MAX_FLOOR_TABLE_HEADER_CLASS}`)) {
            return;
        }
        const th = document.createElement("th");
        th.className = AUTOMATION_MAX_FLOOR_TABLE_HEADER_CLASS;
        th.textContent = t("maxFloor");
        const estimateHeader = headRow.querySelector(`.${AUTOMATION_ESTIMATE_TABLE_HEADER_CLASS}`);
        if (estimateHeader) {
            headRow.insertBefore(th, estimateHeader);
        } else {
            headRow.appendChild(th);
        }
    }

    function ensureAutomationEstimateHeader(table) {
        const headRow = table?.querySelector("thead tr");
        if (!headRow) {
            return;
        }
        if (headRow.querySelector(`.${AUTOMATION_ESTIMATE_TABLE_HEADER_CLASS}`)) {
            return;
        }
        const th = document.createElement("th");
        th.className = AUTOMATION_ESTIMATE_TABLE_HEADER_CLASS;
        th.textContent = t("chanceEta");
        headRow.appendChild(th);
    }

    function ensureAutomationRecommendHeader(table) {
        const headRow = table?.querySelector("thead tr");
        if (!headRow) {
            return;
        }
        const existingHeader = headRow.querySelector(`.${AUTOMATION_RECOMMEND_TABLE_HEADER_CLASS}`);
        if (existingHeader) {
            if (existingHeader.textContent !== t("recommendSettingLevel")) {
                existingHeader.textContent = t("recommendSettingLevel");
            }
            return;
        }
        const th = document.createElement("th");
        th.className = AUTOMATION_RECOMMEND_TABLE_HEADER_CLASS;
        th.textContent = t("recommendSettingLevel");
        headRow.appendChild(th);
    }

    function updateAutomationSkipHeaderText(table, compact = false) {
        const headers = Array.from(table?.querySelectorAll("thead th") || []);
        if (headers.length === 0) {
            return;
        }
        const nextText = compact ? t("skipLevel") : t("skipLevelLong");
        for (const th of headers) {
            const text = String(th?.textContent || "").trim();
            if (!text) {
                continue;
            }
            if (text === nextText) {
                return;
            }
            if (/跳過如果高出等級|跳過等級|skip.*level|skip\s*if/i.test(text)) {
                th.textContent = nextText;
                return;
            }
        }
    }

    function removeAutomationEstimateColumn(table) {
        if (!table) {
            return;
        }
        const floorHeader = table.querySelector(`thead th.${AUTOMATION_MAX_FLOOR_TABLE_HEADER_CLASS}`);
        if (floorHeader) {
            floorHeader.remove();
        }
        const header = table.querySelector(`thead th.${AUTOMATION_ESTIMATE_TABLE_HEADER_CLASS}`);
        if (header) {
            header.remove();
        }
        const floorCells = Array.from(table.querySelectorAll(`tbody td.${AUTOMATION_MAX_FLOOR_CELL_CLASS}`));
        for (const cell of floorCells) {
            cell.remove();
        }
        const cells = Array.from(table.querySelectorAll(`tbody td.${AUTOMATION_ESTIMATE_CELL_CLASS}`));
        for (const cell of cells) {
            cell.remove();
        }
    }

    function removeAutomationRecommendColumn(table) {
        if (!table) {
            return;
        }
        const header = table.querySelector(`thead th.${AUTOMATION_RECOMMEND_TABLE_HEADER_CLASS}`);
        if (header) {
            header.remove();
        }
        const cells = Array.from(table.querySelectorAll(`tbody td.${AUTOMATION_RECOMMEND_CELL_CLASS}`));
        for (const cell of cells) {
            cell.remove();
        }
    }

    function getAutomationEstimateCellRenderToken(estimate) {
        if (!estimate) {
            return "none";
        }
        if (estimate.status !== "ready") {
            return `status:${String(estimate.status || "")}:${String(estimate.message || "")}`;
        }
        const roomLevel = Math.max(1, Math.floor(finiteNumber(estimate.roomLevel, 1)));
        const chancePercent = Math.round(clamp01(estimate.clearChance) * 100);
        const etaText = String(estimate.etaText || ETA_INFINITE_TEXT);
        return `ready:${roomLevel}:${chancePercent}:${etaText}`;
    }

    function getAutomationMaxFloorText(estimate) {
        if (!estimate) {
            return "--";
        }
        if (String(estimate.status || "") === "skipped") {
            return t("skipRoom");
        }
        const roomLevel = finiteNumber(estimate?.roomLevel, NaN);
        if (!Number.isFinite(roomLevel) || roomLevel <= 0) {
            return t("skipRoom");
        }
        const floor = computeAutomationMaxFloorByRoomLevel(roomLevel);
        if (!Number.isFinite(floor) || floor < 1) {
            return t("skipRoom");
        }
        return String(floor);
    }

    function upsertAutomationMaxFloorCellContent(cell, estimate) {
        if (!cell) {
            return;
        }
        const nextText = getAutomationMaxFloorText(estimate);
        if (cell.textContent !== nextText) {
            cell.textContent = nextText;
        }
        cell.classList.add(AUTOMATION_MAX_FLOOR_CELL_CLASS);
        cell.removeAttribute("title");
    }

    function upsertAutomationEstimateCellContent(cell, estimate) {
        if (!cell) {
            return;
        }
        const nextToken = getAutomationEstimateCellRenderToken(estimate);
        const currentToken = String(cell.getAttribute(AUTOMATION_ESTIMATE_CELL_RENDER_TOKEN_ATTR) || "");
        if (currentToken === nextToken) {
            return;
        }
        cell.setAttribute(AUTOMATION_ESTIMATE_CELL_RENDER_TOKEN_ATTR, nextToken);
        cell.classList.add(AUTOMATION_ESTIMATE_CELL_CLASS);
        cell.removeAttribute("title");
        cell.textContent = "";

        const statusText = document.createElement("span");
        statusText.className = `${AUTOMATION_ESTIMATE_CELL_CLASS}__text`;

        if (!estimate) {
            statusText.textContent = "--";
            cell.appendChild(statusText);
            return;
        }

        if (estimate.status !== "ready") {
            statusText.textContent = String(estimate.message || t("pending"));
            cell.appendChild(statusText);
            return;
        }

        const chanceNode = document.createElement("span");
        chanceNode.className = AUTOMATION_ESTIMATE_CELL_CHANCE_CLASS;
        chanceNode.textContent = `${Math.round(clamp01(estimate.clearChance) * 100)}%`;

        const etaNode = document.createElement("span");
        etaNode.className = AUTOMATION_ESTIMATE_CELL_ETA_CLASS;
        const etaText = String(estimate.etaText || ETA_INFINITE_TEXT);
        etaNode.textContent = ` / ${etaText}`;
        const expectedSeconds = finiteNumber(estimate.expectedSeconds, Infinity);
        const etaIsDanger = etaText === ETA_INFINITE_TEXT || expectedSeconds > 999;
        chanceNode.classList.toggle(AUTOMATION_ESTIMATE_CELL_ETA_DANGER_CLASS, etaIsDanger);
        etaNode.classList.toggle(AUTOMATION_ESTIMATE_CELL_ETA_DANGER_CLASS, etaIsDanger);

        cell.appendChild(chanceNode);
        cell.appendChild(etaNode);
    }

    function getAutomationRecommendCellRenderToken(estimate) {
        if (!estimate) {
            return "none";
        }
        if (estimate.status !== "ready") {
            return `status:${String(estimate.status || "")}:${String(estimate.message || "")}`;
        }
        const delta = Math.floor(finiteNumber(estimate.levelDelta, 0));
        const roomLevel = Math.max(1, Math.floor(finiteNumber(estimate.roomLevel, 1)));
        const chancePercent = Math.round(clamp01(finiteNumber(estimate.clearChance, 0)) * 1000) / 10;
        return `ready:${delta}:${roomLevel}:${chancePercent}`;
    }

    function formatAutomationSignedDelta(value) {
        const n = Math.floor(finiteNumber(value, 0));
        if (n > 0) {
            return `+${n}`;
        }
        return String(n);
    }

    function upsertAutomationRecommendCellContent(cell, estimate) {
        if (!cell) {
            return;
        }
        const nextToken = getAutomationRecommendCellRenderToken(estimate);
        const currentToken = String(cell.getAttribute(AUTOMATION_RECOMMEND_CELL_RENDER_TOKEN_ATTR) || "");
        if (currentToken === nextToken) {
            return;
        }
        cell.setAttribute(AUTOMATION_RECOMMEND_CELL_RENDER_TOKEN_ATTR, nextToken);
        cell.classList.add(AUTOMATION_RECOMMEND_CELL_CLASS);
        cell.removeAttribute("title");
        cell.textContent = "";

        if (!estimate) {
            cell.textContent = "--";
            return;
        }
        if (estimate.status !== "ready") {
            cell.textContent = String(estimate.message || t("pending"));
            return;
        }
        const settingLevel = Math.floor(finiteNumber(estimate.levelDelta, 0)) + 1;
        cell.textContent = formatAutomationSignedDelta(settingLevel);
    }

    function ensureAutomationEstimateControl(section) {
        if (!section) {
            return null;
        }
        let root = section.querySelector(`#${AUTOMATION_ESTIMATE_CONTROL_ID}`);
        if (root && root.getAttribute(AUTOMATION_ESTIMATE_CONTROL_SCHEMA_ATTR) !== AUTOMATION_ESTIMATE_CONTROL_SCHEMA_VERSION) {
            root.remove();
            root = null;
        }
        if (!root) {
            const initialTrials = loadAutomationCombatSimTrialsSetting();
            const initialTargetWinRate = loadAutomationTargetWinRateSetting();
            root = document.createElement("div");
            root.id = AUTOMATION_ESTIMATE_CONTROL_ID;
            root.className = AUTOMATION_ESTIMATE_CONTROL_CLASS;
            root.setAttribute(AUTOMATION_ESTIMATE_CONTROL_SCHEMA_ATTR, AUTOMATION_ESTIMATE_CONTROL_SCHEMA_VERSION);
            root.innerHTML = `
<div class="${AUTOMATION_ESTIMATE_CONTROL_CLASS}__settings">
  <span class="${AUTOMATION_ESTIMATE_CONTROL_CLASS}__settings-label">${t("combatTrials")}</span>
  <input type="number" class="${AUTOMATION_ESTIMATE_CONTROL_TRIALS_INPUT_CLASS}" min="${MIN_COMBAT_SIM_TRIALS}" max="${MAX_COMBAT_SIM_TRIALS}" step="1" value="${initialTrials}" inputmode="numeric" />
</div>
<button type="button" class="${AUTOMATION_ESTIMATE_CONTROL_CLASS}__button">${t("calcChance")}</button>
<div class="${AUTOMATION_ESTIMATE_CONTROL_CLASS}__settings">
  <span class="${AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_LABEL_CLASS}">${t("targetWinRate")}</span>
  <input type="number" class="${AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_INPUT_CLASS}" min="0" max="100" step="0.1" value="${initialTargetWinRate}" inputmode="decimal" />
</div>
<button type="button" class="${AUTOMATION_ESTIMATE_CONTROL_CLASS}__button ${AUTOMATION_ESTIMATE_CONTROL_RECOMMEND_BUTTON_CLASS}">${t("recommendDelta")}</button>
<span class="${AUTOMATION_ESTIMATE_CONTROL_CLASS}__status">${t("pending")}</span>`;
            section.insertBefore(root, section.firstChild);
        }
        const settingsLabel = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_CLASS}__settings-label`);
        if (settingsLabel) {
            settingsLabel.textContent = t("combatTrials");
        }
        const targetRateLabel = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_LABEL_CLASS}`);
        if (targetRateLabel) {
            targetRateLabel.textContent = t("targetWinRate");
        }
        const statusNode = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_CLASS}__status`);
        if (statusNode && !String(statusNode.textContent || "").trim()) {
            statusNode.textContent = t("pending");
        }
        const button = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_CLASS}__button`);
        if (button && !button.dataset.bound) {
            button.dataset.bound = "1";
            button.addEventListener("click", () => {
                runAutomationEstimateCalculation();
            });
        }
        if (button) {
            button.textContent = t("calcChance");
        }
        const recommendButton = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_RECOMMEND_BUTTON_CLASS}`);
        if (recommendButton && !recommendButton.dataset.bound) {
            recommendButton.dataset.bound = "1";
            recommendButton.addEventListener("click", () => {
                runAutomationRecommendCalculation();
            });
        }
        if (recommendButton) {
            recommendButton.textContent = t("recommendDelta");
        }
        const trialsInput = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_TRIALS_INPUT_CLASS}`);
        if (trialsInput && !trialsInput.dataset.bound) {
            trialsInput.dataset.bound = "1";
            trialsInput.value = String(loadAutomationCombatSimTrialsSetting());
            const syncTrials = (finalize = false) => {
                const raw = String(trialsInput.value ?? "").trim();
                if (!raw) {
                    if (finalize) {
                        const fallback = saveAutomationCombatSimTrialsSetting(DEFAULT_AUTOMATION_COMBAT_SIM_TRIALS);
                        trialsInput.value = String(fallback);
                    }
                    return;
                }
                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) {
                    if (finalize) {
                        const fallback = saveAutomationCombatSimTrialsSetting(DEFAULT_AUTOMATION_COMBAT_SIM_TRIALS);
                        trialsInput.value = String(fallback);
                    }
                    return;
                }
                const normalized = saveAutomationCombatSimTrialsSetting(parsed);
                if (finalize || /^\d+$/.test(raw)) {
                    trialsInput.value = String(normalized);
                }
            };
            trialsInput.addEventListener("input", () => {
                syncTrials(false);
            });
            trialsInput.addEventListener("change", () => {
                syncTrials(true);
            });
            trialsInput.addEventListener("blur", () => {
                syncTrials(true);
            });
        }
        const targetRateInput = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_INPUT_CLASS}`);
        if (targetRateInput && !targetRateInput.dataset.bound) {
            targetRateInput.dataset.bound = "1";
            targetRateInput.value = String(loadAutomationTargetWinRateSetting());
            const syncTargetRate = (finalize = false) => {
                const raw = String(targetRateInput.value ?? "").trim();
                if (!raw) {
                    if (finalize) {
                        const fallback = saveAutomationTargetWinRateSetting(DEFAULT_AUTOMATION_TARGET_WIN_RATE);
                        targetRateInput.value = String(fallback);
                    }
                    return;
                }
                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) {
                    if (finalize) {
                        const fallback = saveAutomationTargetWinRateSetting(DEFAULT_AUTOMATION_TARGET_WIN_RATE);
                        targetRateInput.value = String(fallback);
                    }
                    return;
                }
                const normalized = saveAutomationTargetWinRateSetting(parsed);
                if (finalize) {
                    targetRateInput.value = String(normalized);
                }
            };
            targetRateInput.addEventListener("input", () => {
                syncTargetRate(false);
            });
            targetRateInput.addEventListener("change", () => {
                syncTargetRate(true);
            });
            targetRateInput.addEventListener("blur", () => {
                syncTargetRate(true);
            });
        }
        return root;
    }

    function getAutomationEstimateTrialsInput() {
        const root = document.getElementById(AUTOMATION_ESTIMATE_CONTROL_ID);
        if (!root) {
            return null;
        }
        return root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_TRIALS_INPUT_CLASS}`);
    }

    function getAutomationTargetWinRateInput() {
        const root = document.getElementById(AUTOMATION_ESTIMATE_CONTROL_ID);
        if (!root) {
            return null;
        }
        return root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_INPUT_CLASS}`);
    }

    function getSelectedAutomationCombatTrials() {
        const input = getAutomationEstimateTrialsInput();
        if (!input) {
            return loadAutomationCombatSimTrialsSetting();
        }
        const normalized = normalizeCombatSimTrials(Number(input.value));
        if (input.value !== String(normalized)) {
            input.value = String(normalized);
        }
        return normalized;
    }

    function getSelectedAutomationTargetWinRate() {
        const input = getAutomationTargetWinRateInput();
        if (!input) {
            return loadAutomationTargetWinRateSetting();
        }
        const normalized = normalizeAutomationTargetWinRate(Number(input.value));
        if (input.value !== String(normalized)) {
            input.value = String(normalized);
        }
        return normalized;
    }

    function setAutomationEstimateControlStatus(status = {}) {
        const root = document.getElementById(AUTOMATION_ESTIMATE_CONTROL_ID);
        if (!root) {
            return;
        }
        const button = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_CLASS}__button`);
        const recommendButton = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_RECOMMEND_BUTTON_CLASS}`);
        const text = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_CLASS}__status`);
        const trialsInput = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_TRIALS_INPUT_CLASS}`);
        const targetRateInput = root.querySelector(`.${AUTOMATION_ESTIMATE_CONTROL_TARGET_RATE_INPUT_CLASS}`);
        if (button && Object.prototype.hasOwnProperty.call(status, "running")) {
            const running = Boolean(status.running);
            const runningMode = String(automationEstimateRunningMode || "");
            const nextCalcText = running && runningMode === "estimate" ? t("calculating") : t("calcChance");
            const nextRecommendText = running && runningMode === "recommend" ? t("calculating") : t("recommendDelta");
            if (button.disabled !== running) {
                button.disabled = running;
            }
            if (recommendButton && recommendButton.disabled !== running) {
                recommendButton.disabled = running;
            }
            if (trialsInput && trialsInput.disabled !== running) {
                trialsInput.disabled = running;
            }
            if (targetRateInput && targetRateInput.disabled !== running) {
                targetRateInput.disabled = running;
            }
            if (button.textContent !== nextCalcText) {
                button.textContent = nextCalcText;
            }
            if (recommendButton && recommendButton.textContent !== nextRecommendText) {
                recommendButton.textContent = nextRecommendText;
            }
        }
        if (text && typeof status.message === "string" && text.textContent !== status.message) {
            text.textContent = status.message;
        }
    }

    function renderAutomationEstimateTable(entries) {
        const table = getAutomationEstimateTable();
        if (!table) {
            return;
        }
        const showEstimateColumns = automationEstimateColumnEnabled;
        const showRecommendColumn = automationRecommendColumnEnabled;
        updateAutomationSkipHeaderText(table, showEstimateColumns || showRecommendColumn);

        if (!showEstimateColumns) {
            removeAutomationEstimateColumn(table);
        }
        if (!showRecommendColumn) {
            removeAutomationRecommendColumn(table);
        }
        if (!showEstimateColumns && !showRecommendColumn) {
            return;
        }
        if (!Array.isArray(entries) || entries.length === 0) {
            removeAutomationEstimateColumn(table);
            removeAutomationRecommendColumn(table);
            return;
        }

        const rowList = Array.from(table.querySelectorAll("tbody tr"));
        if (showEstimateColumns) {
            ensureAutomationMaxFloorHeader(table);
            ensureAutomationEstimateHeader(table);
            for (let i = 0; i < rowList.length; i += 1) {
                const row = rowList[i];
                const entry = entries[i] || null;
                const estimate = entry ? automationEstimateByRoomTypeKey.get(entry.key) || null : null;

                let estimateCell = row.querySelector(`td.${AUTOMATION_ESTIMATE_CELL_CLASS}`);
                let floorCell = row.querySelector(`td.${AUTOMATION_MAX_FLOOR_CELL_CLASS}`);
                if (!floorCell) {
                    floorCell = document.createElement("td");
                    floorCell.className = AUTOMATION_MAX_FLOOR_CELL_CLASS;
                    if (estimateCell) {
                        row.insertBefore(floorCell, estimateCell);
                    } else {
                        row.appendChild(floorCell);
                    }
                }
                if (!estimateCell) {
                    estimateCell = document.createElement("td");
                    estimateCell.className = AUTOMATION_ESTIMATE_CELL_CLASS;
                    row.appendChild(estimateCell);
                }
                upsertAutomationMaxFloorCellContent(floorCell, estimate);

                if (!entry) {
                    if (estimateCell.getAttribute("data-mwi-auto-room-key") !== "") {
                        estimateCell.setAttribute("data-mwi-auto-room-key", "");
                    }
                    upsertAutomationEstimateCellContent(estimateCell, null);
                    continue;
                }
                if (estimateCell.getAttribute("data-mwi-auto-room-key") !== entry.key) {
                    estimateCell.setAttribute("data-mwi-auto-room-key", entry.key);
                }
                bindAutomationEstimateCellEvents(estimateCell);
                upsertAutomationEstimateCellContent(estimateCell, estimate);
            }
        }

        if (showRecommendColumn) {
            ensureAutomationRecommendHeader(table);
            for (let i = 0; i < rowList.length; i += 1) {
                const row = rowList[i];
                const entry = entries[i] || null;
                const recommend = entry ? automationRecommendByRoomTypeKey.get(entry.key) || null : null;

                let recommendCell = row.querySelector(`td.${AUTOMATION_RECOMMEND_CELL_CLASS}`);
                if (!recommendCell) {
                    recommendCell = document.createElement("td");
                    recommendCell.className = AUTOMATION_RECOMMEND_CELL_CLASS;
                    row.appendChild(recommendCell);
                }
                if (!entry) {
                    if (recommendCell.getAttribute("data-mwi-auto-room-key") !== "") {
                        recommendCell.setAttribute("data-mwi-auto-room-key", "");
                    }
                    upsertAutomationRecommendCellContent(recommendCell, null);
                    continue;
                }
                if (recommendCell.getAttribute("data-mwi-auto-room-key") !== entry.key) {
                    recommendCell.setAttribute("data-mwi-auto-room-key", entry.key);
                }
                bindAutomationRecommendCellEvents(recommendCell);
                upsertAutomationRecommendCellContent(recommendCell, recommend);
            }
        }
    }

    async function computeAutomationEntryClearChanceByRoomLevel(params, roomLevel) {
        const safeRoomLevel = Math.max(1, Math.floor(finiteNumber(roomLevel, 1)));
        const room = createAutomationRoomFromEntry(params.entry, safeRoomLevel);
        const combatTrials = normalizeCombatSimTrials(
            params.entry?.isCombat ? params.recommendCombatTrials : params.combatTrials
        );
        const result = params.entry.isCombat
            ? await computeCombatRoomClearChance(
                  params.state,
                  params.initClientData,
                  room,
                  params.maxEnhancementByItem,
                  null,
                  combatTrials,
                  `auto:recommend:${params.entry.key}:${safeRoomLevel}:target${Math.round(params.targetChance * 1000)}`,
                  { includePersonalBuffs: false }
              )
            : computeRoomClearChance(params.state, params.initClientData, room, params.maxEnhancementByItem, {
                  includePersonalBuffs: false,
              });

        if (!result) {
            return null;
        }
        return {
            room,
            roomLevel: safeRoomLevel,
            clearChance: clamp01(finiteNumber(result.clearChance, 0)),
            result,
        };
    }

    function getAutomationRecommendStepByChanceDiff(chanceDiff) {
        const diffPercent = Math.abs(clamp01(finiteNumber(chanceDiff, 0))) * 100;
        if (diffPercent >= 70) {
            return 64;
        }
        if (diffPercent >= 55) {
            return 48;
        }
        if (diffPercent >= 40) {
            return 32;
        }
        if (diffPercent >= 25) {
            return 20;
        }
        if (diffPercent >= 15) {
            return 12;
        }
        if (diffPercent >= 8) {
            return 6;
        }
        if (diffPercent >= 4) {
            return 3;
        }
        if (diffPercent >= 2) {
            return 2;
        }
        return 1;
    }

    async function findAutomationRecommendedLevelDelta(params) {
        const targetChance = clamp01(finiteNumber(params.targetChance, 0));
        const targetPercent = targetChance * 100;
        const effectiveLevel = Math.max(0, finiteNumber(params.effectiveLevel, 0));
        const maxDelta = Math.max(0, Math.floor(AUTOMATION_RECOMMEND_MAX_DELTA));
        const minDelta = Math.min(-1, Math.floor(AUTOMATION_RECOMMEND_MIN_DELTA));
        const isCombatEntry = Boolean(params?.entry?.isCombat);
        const evalCacheByDelta = new Map();
        let bestMatch = null;
        const getDisplayPercentFromChance = (chance) => {
            // Keep recommendation threshold aligned with "計算勝率" table display (integer percent).
            return Math.round(clamp01(finiteNumber(chance, 0)) * 100);
        };
        const isAtOrAboveTarget = (sample) => {
            if (!sample) {
                return false;
            }
            return getDisplayPercentFromChance(sample.clearChance) >= targetPercent;
        };
        const shouldValidateHighTarget = targetPercent >= 99;
        const upwardValidationMaxSteps = isCombatEntry ? 14 : 48;
        const upwardValidationFailStreak = isCombatEntry ? 5 : 14;
        const sweepUpwardForHighestPass = async (startDelta) => {
            let highestPassDelta = Math.max(minDelta, Math.min(maxDelta, Math.floor(finiteNumber(startDelta, minDelta))));
            let failStreak = 0;
            let steps = 0;
            let probeDelta = highestPassDelta + 1;
            while (probeDelta <= maxDelta && steps < upwardValidationMaxSteps) {
                const sample = await evaluateDelta(probeDelta);
                steps += 1;
                if (isAtOrAboveTarget(sample)) {
                    highestPassDelta = probeDelta;
                    failStreak = 0;
                } else {
                    failStreak += 1;
                    if (failStreak >= upwardValidationFailStreak) {
                        break;
                    }
                }
                probeDelta += 1;
            }
            return highestPassDelta;
        };
        const getInitialProbeStep = (chanceDiff) => {
            const dynamicStep = Math.max(1, Math.floor(getAutomationRecommendStepByChanceDiff(chanceDiff)));
            const minStep = isCombatEntry ? 8 : 4;
            return Math.max(minStep, dynamicStep);
        };
        const getNextProbeStep = (currentStep, chanceDiff) => {
            const dynamicStep = Math.max(1, Math.floor(getAutomationRecommendStepByChanceDiff(chanceDiff)));
            const doubledStep = Math.max(1, currentStep * 2);
            const maxStep = isCombatEntry ? 96 : 64;
            return Math.max(dynamicStep, Math.min(maxStep, doubledStep));
        };

        const rememberBest = (sample) => {
            if (!sample) {
                return;
            }
            const sampleDisplayPercent = getDisplayPercentFromChance(sample.clearChance);
            const diff = Math.abs(sampleDisplayPercent - targetPercent);
            const sampleDelta = Math.floor(finiteNumber(sample.levelDelta, 0));
            const bestDelta = bestMatch ? Math.floor(finiteNumber(bestMatch.levelDelta, 0)) : -Infinity;
            if (
                !bestMatch ||
                diff < bestMatch.diff - 1e-9 ||
                (Math.abs(diff - bestMatch.diff) <= 1e-9 && sampleDelta > bestDelta)
            ) {
                bestMatch = {
                    ...sample,
                    displayChancePercent: sampleDisplayPercent,
                    diff,
                };
            }
        };

        const evaluateDelta = async (rawDelta) => {
            const levelDelta = Math.max(minDelta, Math.min(maxDelta, Math.floor(finiteNumber(rawDelta, 0))));
            if (evalCacheByDelta.has(levelDelta)) {
                return evalCacheByDelta.get(levelDelta);
            }
            const roomLevel = Math.max(1, Math.floor(effectiveLevel + levelDelta));
            const computed = await computeAutomationEntryClearChanceByRoomLevel(params, roomLevel);
            const sample = computed
                ? {
                      levelDelta,
                      roomLevel,
                      clearChance: computed.clearChance,
                      result: computed.result,
                  }
                : null;
            evalCacheByDelta.set(levelDelta, sample);
            rememberBest(sample);
            return sample;
        };

        const base = await evaluateDelta(0);
        if (!base) {
            return null;
        }

        if (isAtOrAboveTarget(base)) {
            // Find a [pass, fail] bracket quickly with exponential probing, then binary-search the highest pass level.
            let passDelta = 0;
            let failDelta = maxDelta + 1;
            let probeStep = getInitialProbeStep(base.clearChance - targetChance);
            let probeDelta = Math.min(maxDelta, passDelta + probeStep);

            while (probeDelta <= maxDelta) {
                const probeSample = await evaluateDelta(probeDelta);
                if (!probeSample) {
                    failDelta = probeDelta;
                    break;
                }
                if (isAtOrAboveTarget(probeSample)) {
                    passDelta = probeDelta;
                    if (passDelta >= maxDelta) {
                        break;
                    }
                    probeStep = getNextProbeStep(probeStep, probeSample.clearChance - targetChance);
                    probeDelta = Math.min(maxDelta, passDelta + probeStep);
                    if (probeDelta <= passDelta) {
                        break;
                    }
                    continue;
                }
                failDelta = probeDelta;
                break;
            }

            if (failDelta <= maxDelta) {
                while (failDelta - passDelta > 1) {
                    const mid = Math.floor((passDelta + failDelta) / 2);
                    const midSample = await evaluateDelta(mid);
                    if (!midSample) {
                        failDelta = mid;
                        continue;
                    }
                    if (isAtOrAboveTarget(midSample)) {
                        passDelta = mid;
                    } else {
                        failDelta = mid;
                    }
                }
                await evaluateDelta(passDelta);
                await evaluateDelta(failDelta);
            } else {
                await evaluateDelta(passDelta);
                if (passDelta < maxDelta) {
                    await evaluateDelta(maxDelta);
                }
            }
            if (shouldValidateHighTarget && passDelta < maxDelta) {
                passDelta = await sweepUpwardForHighestPass(passDelta);
                await evaluateDelta(passDelta);
            }
        } else {
            // Base is below target, probe downward quickly to find first pass, then binary-search the highest pass.
            let passDelta = minDelta - 1;
            let failDelta = 0;
            let probeStep = getInitialProbeStep(base.clearChance - targetChance);
            let probeDelta = Math.max(minDelta, failDelta - probeStep);

            while (probeDelta >= minDelta) {
                const probeSample = await evaluateDelta(probeDelta);
                if (!probeSample) {
                    break;
                }
                if (isAtOrAboveTarget(probeSample)) {
                    passDelta = probeDelta;
                    break;
                }
                if (probeDelta === minDelta) {
                    break;
                }
                failDelta = probeDelta;
                probeStep = getNextProbeStep(probeStep, probeSample.clearChance - targetChance);
                probeDelta = Math.max(minDelta, failDelta - probeStep);
                if (probeDelta >= failDelta) {
                    break;
                }
            }

            if (passDelta >= minDelta) {
                while (failDelta - passDelta > 1) {
                    const mid = Math.floor((passDelta + failDelta) / 2);
                    const midSample = await evaluateDelta(mid);
                    if (!midSample) {
                        failDelta = mid;
                        continue;
                    }
                    if (isAtOrAboveTarget(midSample)) {
                        passDelta = mid;
                    } else {
                        failDelta = mid;
                    }
                }
                await evaluateDelta(passDelta);
                await evaluateDelta(failDelta);
                if (shouldValidateHighTarget && passDelta < maxDelta) {
                    passDelta = await sweepUpwardForHighestPass(passDelta);
                    await evaluateDelta(passDelta);
                }
            } else {
                await evaluateDelta(failDelta);
                if (failDelta > minDelta) {
                    await evaluateDelta(minDelta);
                }
            }
        }

        return bestMatch;
    }

    async function runAutomationRecommendCalculation() {
        if (automationEstimateRunning) {
            return;
        }
        automationEstimateRunningMode = "";
        const state = getGameState();
        const panelInstance = getLabyrinthPanelInstance();
        const table = getAutomationEstimateTable();
        if (!state?.characterLabyrinth || !table) {
            automationEstimateStatusText = t("automationListNotFound");
            setAutomationEstimateControlStatus({
                running: false,
                message: automationEstimateStatusText,
            });
            return;
        }

        const entries = getAutomationRoomTypeEntries(panelInstance);
        if (!entries.length) {
            automationEstimateStatusText = t("noCalculableRooms");
            setAutomationEstimateControlStatus({
                running: false,
                message: automationEstimateStatusText,
            });
            return;
        }

        automationEstimateColumnEnabled = false;
        automationRecommendColumnEnabled = true;
        renderAutomationEstimateTable(entries);

        const initClientData = getInitClientData();
        if (!initClientData) {
            automationEstimateStatusText = t("missingClientData");
            setAutomationEstimateControlStatus({
                running: false,
                message: automationEstimateStatusText,
            });
            return;
        }

        automationEstimateRunning = true;
        automationEstimateRunningMode = "recommend";
        setAutomationEstimateControlStatus({
            running: true,
            message: t("preparing"),
        });

        try {
            const maxEnhancementByItem = buildMaxEnhancementByItem(state);
            const recommendCombatTrials = normalizeCombatSimTrials(AUTOMATION_RECOMMEND_COMBAT_TRIALS);
            const targetWinRate = saveAutomationTargetWinRateSetting(getSelectedAutomationTargetWinRate());
            const targetChance = clamp01(targetWinRate / 100);
            automationRecommendByRoomTypeKey.clear();
            let computedCount = 0;

            for (let i = 0; i < entries.length; i += 1) {
                const entry = entries[i];
                automationEstimateStatusText = t("calculatingProgressFmt", { current: i + 1, total: entries.length });
                setAutomationEstimateControlStatus({
                    running: true,
                    message: automationEstimateStatusText,
                });

                const roomLabel = getAutomationRoomLabel(entry, initClientData);
                const effectiveLevel = resolveAutomationEffectiveLevel(panelInstance, entry, state, initClientData, {
                    includePersonalBuffs: false,
                });

                try {
                    const match = await findAutomationRecommendedLevelDelta({
                        state,
                        initClientData,
                        entry,
                        maxEnhancementByItem,
                        recommendCombatTrials,
                        effectiveLevel,
                        targetChance,
                    });
                    if (!match) {
                        automationRecommendByRoomTypeKey.set(entry.key, {
                            status: "error",
                            roomLabel,
                            isCombat: entry.isCombat,
                            message: t("calcFailed"),
                        });
                    } else {
                        const recommendedRoomLevel = Math.max(1, Math.floor(finiteNumber(match.roomLevel, 1)));
                        const recommendedRoom = createAutomationRoomFromEntry(entry, recommendedRoomLevel);
                        const detailPreview = entry.isCombat
                            ? buildCombatPreview(state, recommendedRoom, initClientData, match.result)
                            : match.result?.skillingPreview || null;
                        automationRecommendByRoomTypeKey.set(entry.key, {
                            status: "ready",
                            roomLabel,
                            isCombat: entry.isCombat,
                            levelDelta: Math.floor(finiteNumber(match.levelDelta, 0)),
                            roomLevel: recommendedRoomLevel,
                            clearChance: clamp01(finiteNumber(match.clearChance, 0)),
                            detailPreview,
                            failureReason: String(match.result?.failureReason || ""),
                        });
                        computedCount += 1;
                    }
                } catch (error) {
                    console.error("[Lab Clear Rate] automation recommend failed:", error);
                    automationRecommendByRoomTypeKey.set(entry.key, {
                        status: "error",
                        roomLabel,
                        isCombat: entry.isCombat,
                        message: t("calcFailed"),
                    });
                }

                renderAutomationEstimateTable(entries);
                if ((i + 1) % 2 === 0) {
                    await nextFrame();
                }
            }

            if (computedCount > 0) {
                automationEstimateStatusText = t("calcDone");
            } else {
                automationEstimateStatusText = t("calcDone");
            }
            setAutomationEstimateControlStatus({
                running: false,
                message: automationEstimateStatusText,
            });
        } finally {
            automationEstimateRunning = false;
            automationEstimateRunningMode = "";
            setAutomationEstimateControlStatus({
                running: false,
                message: automationEstimateStatusText,
            });
        }
    }

    async function runAutomationEstimateCalculation() {
        if (automationEstimateRunning) {
            return;
        }
        automationEstimateRunningMode = "";
        const state = getGameState();
        const panelInstance = getLabyrinthPanelInstance();
        const table = getAutomationEstimateTable();
        if (!state?.characterLabyrinth || !table) {
            automationEstimateStatusText = t("automationListNotFound");
            setAutomationEstimateControlStatus({
                running: false,
                message: automationEstimateStatusText,
            });
            return;
        }

        const entries = getAutomationRoomTypeEntries(panelInstance);
        if (!entries.length) {
            automationEstimateStatusText = t("noCalculableRooms");
            setAutomationEstimateControlStatus({
                running: false,
                message: automationEstimateStatusText,
            });
            return;
        }

        automationRecommendColumnEnabled = false;
        automationEstimateColumnEnabled = true;
        automationRecommendByRoomTypeKey.clear();
        automationRecommendSignatureByRoomTypeKey.clear();
        renderAutomationEstimateTable(entries);

        const initClientData = getInitClientData();
        if (!initClientData) {
            automationEstimateStatusText = t("missingClientData");
            setAutomationEstimateControlStatus({
                running: false,
                message: automationEstimateStatusText,
            });
            return;
        }

        automationEstimateRunning = true;
        automationEstimateRunningMode = "estimate";
        setAutomationEstimateControlStatus({
            running: true,
            message: t("preparing"),
        });

        try {
            const maxEnhancementByItem = buildMaxEnhancementByItem(state);
            const combatTrials = saveAutomationCombatSimTrialsSetting(getSelectedAutomationCombatTrials());
            const skipThresholdOverrides = buildAutomationSkipThresholdOverrideMap(entries);
            automationEstimateByRoomTypeKey.clear();
            let computedCount = 0;
            let skippedCount = 0;

            for (let i = 0; i < entries.length; i += 1) {
                const entry = entries[i];
                automationEstimateStatusText = t("calculatingProgressFmt", { current: i + 1, total: entries.length });
                setAutomationEstimateControlStatus({
                    running: true,
                    message: automationEstimateStatusText,
                });

                const roomLabel = getAutomationRoomLabel(entry, initClientData);
                const skipThreshold = resolveAutomationSkipThreshold(panelInstance, entry.key, state, skipThresholdOverrides);
                const effectiveLevel = resolveAutomationEffectiveLevel(panelInstance, entry, state, initClientData, {
                    includePersonalBuffs: false,
                });
                const roomLevel = computeAutomationTargetRoomLevel(effectiveLevel, skipThreshold);
                if (roomLevel < 1) {
                    automationEstimateByRoomTypeKey.set(entry.key, {
                        status: "skipped",
                        roomLabel,
                        roomLevel,
                        isCombat: entry.isCombat,
                        message: t("skipRoom"),
                    });
                    skippedCount += 1;
                    renderAutomationEstimateTable(entries);
                    if ((i + 1) % 2 === 0) {
                        await nextFrame();
                    }
                    continue;
                }
                const room = createAutomationRoomFromEntry(entry, roomLevel);

                try {
                    const result = entry.isCombat
                        ? await computeCombatRoomClearChance(
                              state,
                              initClientData,
                              room,
                              maxEnhancementByItem,
                              null,
                              combatTrials,
                              `auto:${entry.key}:${roomLevel}`,
                              { disableCache: true, includePersonalBuffs: false }
                          )
                        : computeRoomClearChance(state, initClientData, room, maxEnhancementByItem, {
                              includePersonalBuffs: false,
                          });

                    if (!result) {
                        automationEstimateByRoomTypeKey.set(entry.key, {
                            status: "error",
                            roomLabel,
                            roomLevel,
                            isCombat: entry.isCombat,
                            message: t("calcFailed"),
                        });
                    } else {
                        const clearChance = clamp01(finiteNumber(result.clearChance, 0));
                        const shownPercent = Math.round(clearChance * 100);
                        const expectedSeconds = finiteNumber(result.expectedSecondsPerClear, Infinity);
                        const etaText = formatEtaText(expectedSeconds, shownPercent);
                        const detailPreview = entry.isCombat
                            ? buildCombatPreview(state, room, initClientData, result)
                            : result.skillingPreview || null;
                        automationEstimateByRoomTypeKey.set(entry.key, {
                            status: "ready",
                            roomLabel,
                            roomLevel,
                            isCombat: entry.isCombat,
                            clearChance,
                            expectedSeconds,
                            etaText,
                            failureReason: String(result?.combatMeta?.failureReason || ""),
                            combatTrials: entry.isCombat ? combatTrials : 0,
                            detailPreview,
                        });
                        computedCount += 1;
                    }
                } catch (error) {
                    console.error("[Lab Clear Rate] automation estimate failed:", error);
                    automationEstimateByRoomTypeKey.set(entry.key, {
                        status: "error",
                        roomLabel,
                        roomLevel,
                        isCombat: entry.isCombat,
                        message: t("calcFailed"),
                    });
                }

                renderAutomationEstimateTable(entries);
                if ((i + 1) % 2 === 0) {
                    await nextFrame();
                }
            }

            if (computedCount > 0) {
                automationEstimateStatusText = t("calcDone");
            } else if (skippedCount > 0) {
                automationEstimateStatusText = t("skippedRooms");
            } else {
                automationEstimateStatusText = t("calcDone");
            }
            setAutomationEstimateControlStatus({
                running: false,
                message: automationEstimateStatusText,
            });
        } finally {
            automationEstimateRunning = false;
            automationEstimateRunningMode = "";
            setAutomationEstimateControlStatus({
                running: false,
                message: automationEstimateStatusText,
            });
        }
    }

    function refreshAutomationEstimatePanel(state) {
        const table = getAutomationEstimateTable();
        if (!table) {
            clearAutomationWideLayout();
            return;
        }
        const panelInstance = getLabyrinthPanelInstance();
        const entries = getAutomationRoomTypeEntries(panelInstance);

        if (entries.length > 0) {
            const sharedSignature = buildAutomationEstimateSharedSignature(state);
            const skipThresholdOverrides = buildAutomationSkipThresholdOverrideMap(entries);
            const nextSignatures = new Map();
            let invalidated = false;
            const recommendSharedSignature = buildAutomationRecommendSharedSignature(state, getSelectedAutomationTargetWinRate());
            const nextRecommendSignatures = new Map();
            let recommendInvalidated = false;

            for (const entry of entries) {
                const key = String(entry?.key || "");
                if (!key) {
                    continue;
                }
                const nextSignature = buildAutomationEstimateEntrySignature(
                    panelInstance,
                    entry,
                    state,
                    sharedSignature,
                    skipThresholdOverrides
                );
                nextSignatures.set(key, nextSignature);
                const prevSignature = automationEstimateSignatureByRoomTypeKey.get(key);
                if (!automationEstimateRunning && prevSignature && prevSignature !== nextSignature) {
                    if (automationEstimateByRoomTypeKey.has(key)) {
                        automationEstimateByRoomTypeKey.delete(key);
                    }
                    invalidated = true;
                }

                const nextRecommendSignature = buildAutomationRecommendEntrySignature(
                    panelInstance,
                    entry,
                    state,
                    recommendSharedSignature
                );
                nextRecommendSignatures.set(key, nextRecommendSignature);
                const prevRecommendSignature = automationRecommendSignatureByRoomTypeKey.get(key);
                if (!automationEstimateRunning && prevRecommendSignature && prevRecommendSignature !== nextRecommendSignature) {
                    if (automationRecommendByRoomTypeKey.has(key)) {
                        automationRecommendByRoomTypeKey.delete(key);
                    }
                    recommendInvalidated = true;
                }
            }

            for (const key of Array.from(automationEstimateSignatureByRoomTypeKey.keys())) {
                if (nextSignatures.has(key)) {
                    continue;
                }
                automationEstimateSignatureByRoomTypeKey.delete(key);
                if (automationEstimateByRoomTypeKey.has(key)) {
                    automationEstimateByRoomTypeKey.delete(key);
                    invalidated = true;
                }
            }
            for (const key of Array.from(automationRecommendSignatureByRoomTypeKey.keys())) {
                if (nextRecommendSignatures.has(key)) {
                    continue;
                }
                automationRecommendSignatureByRoomTypeKey.delete(key);
                if (automationRecommendByRoomTypeKey.has(key)) {
                    automationRecommendByRoomTypeKey.delete(key);
                    recommendInvalidated = true;
                }
            }

            automationEstimateSignatureByRoomTypeKey = nextSignatures;
            automationRecommendSignatureByRoomTypeKey = nextRecommendSignatures;
            if (!automationEstimateRunning && (invalidated || recommendInvalidated)) {
                automationEstimateStatusText = t("pending");
            }
        } else {
            automationEstimateSignatureByRoomTypeKey.clear();
            automationRecommendSignatureByRoomTypeKey.clear();
        }

        const section = getAutomationEstimateSection(table);
        applyAutomationWideLayout(section, table);
        ensureAutomationEstimateControl(section);
        setAutomationEstimateControlStatus({
            running: automationEstimateRunning,
            message: automationEstimateStatusText,
        });
        renderAutomationEstimateTable(entries);
    }

    function getControlPanel() {
        return document.getElementById(CONTROL_ID);
    }

    function getControlCombatTrialsInput() {
        const root = getControlPanel();
        if (!root) {
            return null;
        }
        return root.querySelector(`.${CONTROL_CLASS}__settings-input`);
    }

    function getSelectedCombatSimTrials() {
        const input = getControlCombatTrialsInput();
        if (!input) {
            return loadCombatSimTrialsSetting();
        }
        const normalized = normalizeCombatSimTrials(Number(input.value));
        if (input.value !== String(normalized)) {
            input.value = String(normalized);
        }
        return normalized;
    }

    function getSelectedLoanSealItemHrids() {
        const selected = [];
        for (const [itemHrid, enabled] of loanSealSelectionByItemHrid.entries()) {
            if (enabled) {
                selected.push(String(itemHrid || ""));
            }
        }
        return selected;
    }

    function updateLoanCalcButtonState(panelRoot = null) {
        const root = panelRoot || getControlPanel();
        if (!root) {
            return;
        }
        const loanCalcButton = root.querySelector(`.${CONTROL_LOAN_CALC_CLASS}`);
        if (!loanCalcButton) {
            return;
        }
        const checkedCount = Array.from(
            root.querySelectorAll(`.${CONTROL_LOAN_LIST_CLASS} input[type="checkbox"]:not(:disabled):checked`)
        ).length;
        loanCalcButton.disabled = checkedCount <= 0;
    }

    function resolveLoanPanelGridRect() {
        const state = getGameState();
        const roomRows = Array.isArray(state?.characterLabyrinth?.roomData) ? state.characterLabyrinth.roomData : [];
        const totalCells = roomRows.flat().length;
        let gridParent = totalCells > 0 ? findRoomGridParent(totalCells) : null;
        if (!gridParent) {
            const anyCell = document.querySelector('div[class*="LabyrinthPanel_roomCell"]');
            gridParent = anyCell ? anyCell.parentElement : null;
        }
        if (!gridParent) {
            return null;
        }
        return gridParent.getBoundingClientRect();
    }

    function positionLoanSealPanel(panelRoot = null) {
        const root = panelRoot || getControlPanel();
        if (!root) {
            return;
        }
        const panel = root.querySelector(`.${CONTROL_LOAN_PANEL_CLASS}`);
        const list = root.querySelector(`.${CONTROL_LOAN_LIST_CLASS}`);
        if (!panel || panel.hasAttribute("hidden")) {
            return;
        }

        const gridRect = resolveLoanPanelGridRect();
        if (!gridRect) {
            panel.style.position = "absolute";
            panel.style.top = "0";
            panel.style.left = "calc(100% + 8px)";
            panel.style.right = "auto";
            panel.style.maxHeight = "320px";
            if (list) {
                list.style.maxHeight = "230px";
            }
            return;
        }

        const viewportWidth = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
        const viewportHeight = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);
        const margin = 8;
        const gutter = 10;
        const panelWidth = Math.max(240, Math.ceil(panel.getBoundingClientRect().width || 250));

        let left = Math.round(gridRect.right + gutter);
        if (left + panelWidth > viewportWidth - margin) {
            left = Math.round(Math.max(margin, gridRect.left - panelWidth - gutter));
        }

        let top = Math.round(Math.max(margin, gridRect.top));
        if (viewportHeight > 0) {
            top = Math.min(top, Math.max(margin, viewportHeight - 140));
        }

        const panelMaxHeight = Math.max(180, Math.min(420, Math.floor(Math.max(240, viewportHeight - top - margin))));

        panel.style.position = "fixed";
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = "auto";
        panel.style.maxHeight = `${panelMaxHeight}px`;

        if (list) {
            const listMaxHeight = Math.max(110, panelMaxHeight - 90);
            list.style.maxHeight = `${listMaxHeight}px`;
        }
    }

    function isLoanSealPanelOpen(root = null) {
        const panelRoot = root || getControlPanel();
        if (!panelRoot) {
            return false;
        }
        const panel = panelRoot.querySelector(`.${CONTROL_LOAN_PANEL_CLASS}`);
        return Boolean(panel) && !panel.hasAttribute("hidden");
    }

    function renderLoanSealPanel(root = null) {
        const panelRoot = root || getControlPanel();
        if (!panelRoot) {
            return;
        }
        const panel = panelRoot.querySelector(`.${CONTROL_LOAN_PANEL_CLASS}`);
        const list = panelRoot.querySelector(`.${CONTROL_LOAN_LIST_CLASS}`);
        const loanCalcButton = panelRoot.querySelector(`.${CONTROL_LOAN_CALC_CLASS}`);
        if (!panel || !list || !loanCalcButton) {
            return;
        }

        const state = getGameState();
        const initClientData = getInitClientData();
        const catalog = buildLoanSealEffectCatalog(state, initClientData);
        const catalogMap = new Map(catalog.map((effect) => [String(effect.itemHrid || ""), effect]));

        if (catalog.length > 0) {
            for (const itemHrid of Array.from(loanSealSelectionByItemHrid.keys())) {
                if (!catalogMap.has(itemHrid)) {
                    loanSealSelectionByItemHrid.delete(itemHrid);
                }
            }
        }

        list.textContent = "";
        if (!catalog.length) {
            const empty = document.createElement("div");
            empty.className = CONTROL_LOAN_ITEM_STATUS_CLASS;
            empty.textContent = t("loanNoOptions");
            list.appendChild(empty);
            loanCalcButton.disabled = true;
            positionLoanSealPanel(panelRoot);
            return;
        }

        for (const effect of catalog) {
            const itemHrid = String(effect.itemHrid || "");
            const canSelect = !effect.isActive && effect.canApply;
            if (!canSelect && loanSealSelectionByItemHrid.get(itemHrid)) {
                loanSealSelectionByItemHrid.set(itemHrid, false);
            }

            const row = document.createElement("div");
            row.className = CONTROL_LOAN_ITEM_CLASS;

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.disabled = !canSelect;
            checkbox.checked = canSelect && loanSealSelectionByItemHrid.get(itemHrid) === true;
            checkbox.addEventListener("change", (event) => {
                const checked = Boolean(event?.target?.checked);
                loanSealSelectionByItemHrid.set(itemHrid, checked);
                updateLoanCalcButtonState(panelRoot);
            });

            row.addEventListener("click", (event) => {
                const target = event?.target;
                if (target && typeof target.closest === "function" && target.closest('input[type="checkbox"]')) {
                    return;
                }
                if (!canSelect || checkbox.disabled) {
                    return;
                }
                checkbox.checked = !checkbox.checked;
                loanSealSelectionByItemHrid.set(itemHrid, checkbox.checked);
                updateLoanCalcButtonState(panelRoot);
            });

            const nameNode = document.createElement("span");
            nameNode.className = `${CONTROL_LOAN_ITEM_CLASS}__name`;
            nameNode.textContent = effect.labelText;

            const statusNode = document.createElement("span");
            statusNode.className = CONTROL_LOAN_ITEM_STATUS_CLASS;
            if (effect.isActive) {
                statusNode.classList.add(`${CONTROL_LOAN_ITEM_STATUS_CLASS}--warn`);
                statusNode.textContent = `${t("loanAlreadyActive")} x${effect.quantity}`;
                if (effect.activeBuff?.expiresAt) {
                    statusNode.title = String(effect.activeBuff.expiresAt);
                }
            } else if (!effect.canApply) {
                statusNode.classList.add(`${CONTROL_LOAN_ITEM_STATUS_CLASS}--warn`);
                statusNode.textContent = `${t("loanCannotApply")} x${effect.quantity}`;
            } else {
                statusNode.textContent = `x${effect.quantity}`;
            }

            row.appendChild(checkbox);
            row.appendChild(nameNode);
            row.appendChild(statusNode);
            list.appendChild(row);
        }

        updateLoanCalcButtonState(panelRoot);
        positionLoanSealPanel(panelRoot);
    }

    function refreshLoanSealPanelOnOpen(root = null) {
        const panelRoot = root || getControlPanel();
        if (!panelRoot || !isLoanSealPanelOpen(panelRoot)) {
            return;
        }
        renderLoanSealPanel(panelRoot);
        window.setTimeout(() => {
            if (!panelRoot.isConnected || !isLoanSealPanelOpen(panelRoot)) {
                return;
            }
            renderLoanSealPanel(panelRoot);
        }, 180);
    }

    function loadRoomLogPanelPosition() {
        const fallback = {
            left: Math.max(10, (window.innerWidth || 1280) - 360),
            top: 92,
        };
        try {
            const raw = localStorage.getItem(ROOM_LOG_POSITION_STORAGE_KEY);
            if (!raw) {
                return fallback;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return fallback;
            }
            const left = Math.floor(finiteNumber(parsed.left, fallback.left));
            const top = Math.floor(finiteNumber(parsed.top, fallback.top));
            return { left, top };
        } catch (_error) {
            return fallback;
        }
    }

    function saveRoomLogPanelPosition(position) {
        if (!position || typeof position !== "object") {
            return;
        }
        const payload = {
            left: Math.floor(finiteNumber(position.left, 0)),
            top: Math.floor(finiteNumber(position.top, 0)),
        };
        try {
            localStorage.setItem(ROOM_LOG_POSITION_STORAGE_KEY, JSON.stringify(payload));
        } catch (_error) {
            // Ignore storage errors.
        }
    }

    function clampRoomLogPanelPosition(panel, position) {
        const panelRect = panel ? panel.getBoundingClientRect() : null;
        const panelWidth = Math.max(280, Math.ceil(panelRect?.width || 340));
        const panelHeight = Math.max(180, Math.ceil(panelRect?.height || 320));
        const viewportWidth = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 1280);
        const viewportHeight = Math.max(240, window.innerHeight || document.documentElement.clientHeight || 720);
        const margin = 8;
        const maxLeft = Math.max(margin, viewportWidth - panelWidth - margin);
        const maxTop = Math.max(margin, viewportHeight - panelHeight - margin);
        return {
            left: Math.min(maxLeft, Math.max(margin, Math.floor(finiteNumber(position?.left, margin)))),
            top: Math.min(maxTop, Math.max(margin, Math.floor(finiteNumber(position?.top, margin)))),
        };
    }

    function applyRoomLogPanelPosition(panel, position, persist = false) {
        if (!panel) {
            return;
        }
        const clamped = clampRoomLogPanelPosition(panel, position);
        panel.style.left = `${clamped.left}px`;
        panel.style.top = `${clamped.top}px`;
        panel.style.right = "auto";
        if (persist) {
            saveRoomLogPanelPosition(clamped);
        }
    }

    function ensureRoomLogFloatingPanel() {
        let root = getRoomLogFloatingPanel();
        if (root) {
            return root;
        }

        root = document.createElement("div");
        root.id = ROOM_LOG_FLOAT_ID;
        root.className = ROOM_LOG_FLOAT_CLASS;
        root.setAttribute("hidden", "hidden");
        root.innerHTML = `
<div class="${ROOM_LOG_FLOAT_HEADER_CLASS}">
  <div class="${ROOM_LOG_FLOAT_TITLE_CLASS}">${t("roomLogTitleFmt", { count: ROOM_LOG_MAX_SESSIONS })}</div>
  <div class="${ROOM_LOG_FLOAT_ACTIONS_CLASS}">
    <button type="button" class="${ROOM_LOG_FLOAT_CLEAR_CLASS}">${t("roomLogClear")}</button>
    <button type="button" class="${ROOM_LOG_FLOAT_CLOSE_CLASS}" title="${t("roomLogClose")}">×</button>
  </div>
</div>
<div class="${CONTROL_LOG_PANEL_CLASS}">
  <div class="${CONTROL_LOG_LIST_CLASS}"></div>
</div>
`;
        document.body.appendChild(root);

        applyRoomLogPanelPosition(root, loadRoomLogPanelPosition(), false);

        const closeButton = root.querySelector(`.${ROOM_LOG_FLOAT_CLOSE_CLASS}`);
        if (closeButton) {
            closeButton.addEventListener("click", (event) => {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                root.setAttribute("hidden", "hidden");
            });
        }

        const clearButton = root.querySelector(`.${ROOM_LOG_FLOAT_CLEAR_CLASS}`);
        if (clearButton) {
            clearButton.addEventListener("click", (event) => {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                clearRoomLogData();
            });
        }

        const header = root.querySelector(`.${ROOM_LOG_FLOAT_HEADER_CLASS}`);
        if (header) {
            header.addEventListener("pointerdown", (event) => {
                const target = event?.target;
                if (target && typeof target.closest === "function" && target.closest(`.${ROOM_LOG_FLOAT_CLOSE_CLASS}`)) {
                    return;
                }
                if (!(event instanceof PointerEvent) || event.button !== 0) {
                    return;
                }
                event.preventDefault();
                const initialRect = root.getBoundingClientRect();
                const startX = event.clientX;
                const startY = event.clientY;
                const startLeft = initialRect.left;
                const startTop = initialRect.top;

                const onMove = (moveEvent) => {
                    const nextLeft = startLeft + (moveEvent.clientX - startX);
                    const nextTop = startTop + (moveEvent.clientY - startY);
                    applyRoomLogPanelPosition(root, { left: nextLeft, top: nextTop }, false);
                };
                const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                    window.removeEventListener("pointercancel", onUp);
                    const finalRect = root.getBoundingClientRect();
                    applyRoomLogPanelPosition(root, { left: finalRect.left, top: finalRect.top }, true);
                };

                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
                window.addEventListener("pointercancel", onUp);
            });
        }

        if (!ensureRoomLogFloatingPanel.__resizeBound) {
            ensureRoomLogFloatingPanel.__resizeBound = true;
            window.addEventListener("resize", () => {
                const panel = getRoomLogFloatingPanel();
                if (!panel || panel.hasAttribute("hidden")) {
                    return;
                }
                const rect = panel.getBoundingClientRect();
                applyRoomLogPanelPosition(panel, { left: rect.left, top: rect.top }, true);
            });
        }

        return root;
    }

    function isRoomLogPanelOpen() {
        const panel = getRoomLogFloatingPanel();
        return Boolean(panel) && !panel.hasAttribute("hidden");
    }

    function setRoomLogPanelOpen(opening) {
        let panel = getRoomLogFloatingPanel();
        if (!panel && !opening) {
            return;
        }
        if (!panel) {
            panel = ensureRoomLogFloatingPanel();
        }
        if (!panel) {
            return;
        }
        if (opening) {
            panel.removeAttribute("hidden");
            applyRoomLogPanelPosition(panel, loadRoomLogPanelPosition(), false);
            renderRoomLogPanel();
            return;
        }
        panel.setAttribute("hidden", "hidden");
    }

    function clearRoomLogData() {
        roomLogSessions = [];
        activeRoomLogSession = null;
        persistRoomLogStorage();
        refreshRoomLogPanelIfVisible();
    }

    function formatRoomLogDurationSeconds(session) {
        if (!session || typeof session !== "object") {
            return "--";
        }
        const startedAt = Math.max(0, Math.floor(finiteNumber(session.startedAt, 0)));
        if (!startedAt) {
            return "--";
        }
        const endedAtRaw = Math.max(0, Math.floor(finiteNumber(session.endedAt, 0)));
        const endedAt = endedAtRaw > 0 ? endedAtRaw : Date.now();
        const durationMs = Math.max(0, endedAt - startedAt);
        const seconds = Math.max(0, Math.round(durationMs / 1000));
        return t("roomLogDurationFmt", { seconds });
    }

    function normalizeRoomLogDisplaySkillName(rawName) {
        const input = String(rawName || "").trim();
        if (!input) {
            return "--";
        }
        const cleaned = input.replace(/^(技能|skill|skilling|強化|enhancing)\s*[·\.:：\-]?\s*/i, "").trim();
        return cleaned || input;
    }

    function getRoomLogActionOutcomeClass(action) {
        const outcome = String(action?.outcome || ROOM_LOG_ACTION_OUTCOME_UNKNOWN);
        if (outcome === ROOM_LOG_ACTION_OUTCOME_DOUBLE) {
            return `${CONTROL_LOG_ACTION_CLASS} ${CONTROL_LOG_ACTION_CLASS}--double`;
        }
        if (outcome === ROOM_LOG_ACTION_OUTCOME_SUCCESS) {
            return `${CONTROL_LOG_ACTION_CLASS} ${CONTROL_LOG_ACTION_CLASS}--success`;
        }
        if (outcome === ROOM_LOG_ACTION_OUTCOME_FAIL) {
            return `${CONTROL_LOG_ACTION_CLASS} ${CONTROL_LOG_ACTION_CLASS}--fail`;
        }
        return `${CONTROL_LOG_ACTION_CLASS} ${CONTROL_LOG_ACTION_CLASS}--unknown`;
    }

    function getRoomLogMetaText(session) {
        if (session?.mode === "combat") {
            return t("roomLogComingSoon");
        }
        const successText = formatRoomLogPercent(clamp01(finiteNumber(session?.successRate, 0)) * 100);
        const doubleText = formatRoomLogPercent(clamp01(finiteNumber(session?.doubleChance, 0)) * 100);
        const parts = [t("roomLogRateFmt", { success: successText, double: doubleText })];

        if (session?.mode === "enhancing") {
            parts.push(
                t("roomLogEnhFmt", {
                    current: Math.max(0, Math.floor(finiteNumber(session?.currentEnhLevel, 0))),
                    target: Math.max(0, Math.floor(finiteNumber(session?.targetLevel, 0))),
                })
            );
        } else {
            parts.push(
                t("roomLogWorkFmt", {
                    value: getEffectiveSkillingProgressPerSuccess(session?.progressPerAction),
                })
            );
            parts.push(
                t("roomLogProgressFmt", {
                    current: formatRoomLogPercent(Math.max(0, finiteNumber(session?.currentProgressPct, 0))),
                    target: 100,
                })
            );
        }
        return parts.join(" | ");
    }

    function getRoomLogIncompleteText(session) {
        const reasons = Array.isArray(session?.incompleteReasons) ? session.incompleteReasons : [];
        if (reasons.includes("action_gap")) {
            return `${t("roomLogIncomplete")} · ${t("roomLogActionGap")}`;
        }
        return t("roomLogIncomplete");
    }

    function appendRoomLogActionNodes(container, actions) {
        if (!container) {
            return;
        }
        const actionList = Array.isArray(actions) ? actions : [];
        if (!actionList.length) {
            const empty = document.createElement("span");
            empty.className = `${CONTROL_LOG_ACTION_CLASS} ${CONTROL_LOG_ACTION_CLASS}--unknown`;
            empty.textContent = "--";
            container.appendChild(empty);
            return;
        }

        for (let i = 0; i < actionList.length; i += 1) {
            if (i > 0) {
                const separator = document.createElement("span");
                separator.className = `${CONTROL_LOG_ITEM_CLASS}__sep`;
                separator.textContent = " - ";
                container.appendChild(separator);
            }
            const action = actionList[i];
            const node = document.createElement("span");
            node.className = getRoomLogActionOutcomeClass(action);
            node.textContent = String(action?.text || "?");
            container.appendChild(node);
        }
    }

    function renderRoomLogPanel() {
        const panelRoot = ensureRoomLogFloatingPanel();
        if (!panelRoot) {
            return;
        }
        const title = panelRoot.querySelector(`.${ROOM_LOG_FLOAT_TITLE_CLASS}`);
        const clearButton = panelRoot.querySelector(`.${ROOM_LOG_FLOAT_CLEAR_CLASS}`);
        const closeButton = panelRoot.querySelector(`.${ROOM_LOG_FLOAT_CLOSE_CLASS}`);
        const list = panelRoot.querySelector(`.${CONTROL_LOG_LIST_CLASS}`);
        if (!title || !list) {
            return;
        }

        title.textContent = t("roomLogTitleFmt", { count: ROOM_LOG_MAX_SESSIONS });
        if (clearButton) {
            clearButton.textContent = t("roomLogClear");
            clearButton.title = t("roomLogClear");
        }
        if (closeButton) {
            closeButton.title = t("roomLogClose");
        }
        list.textContent = "";

        if (!Array.isArray(roomLogSessions) || roomLogSessions.length === 0) {
            const empty = document.createElement("div");
            empty.className = CONTROL_LOG_META_CLASS;
            empty.textContent = t("roomLogEmpty");
            list.appendChild(empty);
            return;
        }

        const displaySessions = roomLogSessions.slice(0, ROOM_LOG_MAX_SESSIONS);
        for (const session of displaySessions) {
            const card = document.createElement("div");
            card.className = CONTROL_LOG_ITEM_CLASS;

            const header = document.createElement("div");
            header.className = `${CONTROL_LOG_ITEM_CLASS}__header`;
            const level = Math.max(0, Math.floor(finiteNumber(session?.recommendedLevel, 0)));
            const displaySkillName = normalizeRoomLogDisplaySkillName(session?.skillName);
            const nameText = level > 0 ? `${displaySkillName} Lv.${level}` : displaySkillName;
            const titleText = document.createElement("span");
            titleText.textContent = nameText;
            const timeText = document.createElement("span");
            timeText.className = `${CONTROL_LOG_ITEM_CLASS}__time`;
            const durationText = formatRoomLogDurationSeconds(session);
            if (session?.mode === "combat") {
                timeText.textContent = durationText;
            } else {
                const expText = t("roomLogExpFmt", { value: formatRoomLogExperience(session?.totalExperience) });
                timeText.textContent = `${durationText} | ${expText}`;
            }
            header.appendChild(titleText);
            header.appendChild(timeText);
            if (session?.incomplete || !session?.completed) {
                const incomplete = document.createElement("span");
                incomplete.className = CONTROL_LOG_INCOMPLETE_CLASS;
                incomplete.textContent = getRoomLogIncompleteText(session);
                header.appendChild(incomplete);
            }
            card.appendChild(header);

            const meta = document.createElement("div");
            meta.className = CONTROL_LOG_META_CLASS;
            meta.textContent = getRoomLogMetaText(session);
            card.appendChild(meta);

            const actionRow = document.createElement("div");
            actionRow.className = `${CONTROL_LOG_ITEM_CLASS}__actions`;
            appendRoomLogActionNodes(actionRow, session?.actions);
            card.appendChild(actionRow);

            list.appendChild(card);
        }
    }

    function isRoomDistributionUnsupportedDevice() {
        if (typeof window.matchMedia !== "function") {
            return (window.innerWidth || 1280) <= 700;
        }
        return window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;
    }

    function normalizeRoomDistributionStep(value) {
        const numeric = Math.floor(finiteNumber(Number(value), ROOM_DISTRIBUTION_DEFAULT_STEP));
        return Math.min(ROOM_DISTRIBUTION_MAX_STEP, Math.max(ROOM_DISTRIBUTION_MIN_STEP, numeric));
    }

    function getRoomDistributionStepInput() {
        return getRoomDistributionFloatingPanel()?.querySelector(`.${CONTROL_DISTRIBUTION_STEP_INPUT_CLASS}`) || null;
    }

    function getSelectedRoomDistributionStep() {
        return normalizeRoomDistributionStep(getRoomDistributionStepInput()?.value);
    }

    function getRoomDistributionFloatingPanel() {
        return document.getElementById(ROOM_DISTRIBUTION_FLOAT_ID);
    }

    function getRoomDistributionContext(state = null) {
        const latestState = state || getGameState();
        const labyrinth = latestState?.characterLabyrinth;
        const labyrinthSignature = getLabyrinthDisplaySignature(latestState);
        if (!labyrinth || !labyrinthSignature) {
            return null;
        }
        const floor = Math.max(1, Math.floor(finiteNumber(labyrinth.currentFloor, 1)));
        const minLevel = floor * ROOM_DISTRIBUTION_LEVEL_SPAN;
        return {
            labyrinthSignature,
            floor,
            minLevel,
            maxLevel: minLevel + ROOM_DISTRIBUTION_LEVEL_SPAN,
        };
    }

    function clearRoomDistributionSnapshot() {
        roomDistributionRunToken += 1;
        roomDistributionSnapshot = null;
        roomDistributionProgress = null;
    }

    function syncRoomDistributionToggleState() {
        const root = getControlPanel();
        const checkbox = root?.querySelector(`.${CONTROL_DISTRIBUTION_TOGGLE_CLASS} input[type="checkbox"]`);
        if (checkbox) {
            checkbox.checked = roomDistributionEnabled;
        }
    }

    function setRoomDistributionEnabled(enabled) {
        const nextEnabled = Boolean(enabled) && !isRoomDistributionUnsupportedDevice();
        if (roomDistributionEnabled === nextEnabled) {
            syncRoomDistributionToggleState();
            if (nextEnabled) {
                renderRoomDistributionPanel();
            }
            return;
        }
        roomDistributionEnabled = nextEnabled;
        clearRoomDistributionSnapshot();
        syncRoomDistributionToggleState();
        const panel = getRoomDistributionFloatingPanel();
        if (!nextEnabled) {
            if (panel) {
                panel.setAttribute("hidden", "hidden");
            }
            return;
        }
        renderRoomDistributionPanel();
    }

    function handleRoomDistributionLabyrinthTransition(nextSignature = "") {
        const normalizedSignature = String(nextSignature || "");
        if (
            roomDistributionSnapshot &&
            String(roomDistributionSnapshot.labyrinthSignature || "") === normalizedSignature
        ) {
            return;
        }
        clearRoomDistributionSnapshot();
        if (roomDistributionEnabled) {
            renderRoomDistributionPanel();
        }
    }

    function loadRoomDistributionPanelPosition() {
        const fallback = {
            left: Math.max(10, (window.innerWidth || 1280) - 698),
            top: 92,
        };
        try {
            const raw = localStorage.getItem(ROOM_DISTRIBUTION_POSITION_STORAGE_KEY);
            if (!raw) {
                return fallback;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return fallback;
            }
            return {
                left: Math.floor(finiteNumber(parsed.left, fallback.left)),
                top: Math.floor(finiteNumber(parsed.top, fallback.top)),
            };
        } catch (_error) {
            return fallback;
        }
    }

    function saveRoomDistributionPanelPosition(position) {
        if (!position || typeof position !== "object") {
            return;
        }
        try {
            localStorage.setItem(
                ROOM_DISTRIBUTION_POSITION_STORAGE_KEY,
                JSON.stringify({
                    left: Math.floor(finiteNumber(position.left, 0)),
                    top: Math.floor(finiteNumber(position.top, 0)),
                })
            );
        } catch (_error) {
            // Ignore storage errors.
        }
    }

    function clampRoomDistributionPanelPosition(panel, position) {
        const panelRect = panel ? panel.getBoundingClientRect() : null;
        const panelWidth = Math.max(280, Math.ceil(panelRect?.width || 310));
        const panelHeight = Math.max(160, Math.ceil(panelRect?.height || 300));
        const viewportWidth = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 1280);
        const viewportHeight = Math.max(240, window.innerHeight || document.documentElement.clientHeight || 720);
        const margin = 8;
        return {
            left: Math.min(
                Math.max(margin, viewportWidth - panelWidth - margin),
                Math.max(margin, Math.floor(finiteNumber(position?.left, margin)))
            ),
            top: Math.min(
                Math.max(margin, viewportHeight - panelHeight - margin),
                Math.max(margin, Math.floor(finiteNumber(position?.top, margin)))
            ),
        };
    }

    function applyRoomDistributionPanelPosition(panel, position, persist = false) {
        if (!panel) {
            return;
        }
        const clamped = clampRoomDistributionPanelPosition(panel, position);
        panel.style.left = `${clamped.left}px`;
        panel.style.top = `${clamped.top}px`;
        panel.style.right = "auto";
        if (persist) {
            saveRoomDistributionPanelPosition(clamped);
        }
    }

    function ensureRoomDistributionFloatingPanel() {
        if (isRoomDistributionUnsupportedDevice()) {
            return null;
        }
        let root = getRoomDistributionFloatingPanel();
        if (root) {
            return root;
        }

        root = document.createElement("div");
        root.id = ROOM_DISTRIBUTION_FLOAT_ID;
        root.className = ROOM_DISTRIBUTION_FLOAT_CLASS;
        root.setAttribute("hidden", "hidden");
        root.innerHTML = `
<div class="${ROOM_DISTRIBUTION_HEADER_CLASS}">
  <div class="${ROOM_DISTRIBUTION_TITLE_CLASS}"></div>
  <button type="button" class="${ROOM_DISTRIBUTION_CLOSE_CLASS}" title="${t("roomLogClose")}">×</button>
</div>
<div class="${ROOM_DISTRIBUTION_BODY_CLASS}">
  <label class="${CONTROL_DISTRIBUTION_STEP_CLASS}">
    <span>${t("roomDistributionStep")}</span>
    <input type="number" class="${CONTROL_DISTRIBUTION_STEP_INPUT_CLASS}" min="${ROOM_DISTRIBUTION_MIN_STEP}" max="${ROOM_DISTRIBUTION_MAX_STEP}" step="1" value="${ROOM_DISTRIBUTION_DEFAULT_STEP}" inputmode="numeric" />
    <span>%</span>
  </label>
  <div class="${ROOM_DISTRIBUTION_META_CLASS}"></div>
  <div class="${ROOM_DISTRIBUTION_LIST_CLASS}"></div>
</div>`;
        document.body.appendChild(root);
        applyRoomDistributionPanelPosition(root, loadRoomDistributionPanelPosition(), false);

        const closeButton = root.querySelector(`.${ROOM_DISTRIBUTION_CLOSE_CLASS}`);
        if (closeButton) {
            closeButton.addEventListener("click", (event) => {
                event?.preventDefault();
                event?.stopPropagation();
                setRoomDistributionEnabled(false);
            });
        }

        const stepInput = root.querySelector(`.${CONTROL_DISTRIBUTION_STEP_INPUT_CLASS}`);
        if (stepInput) {
            const syncStep = (finalize = false) => {
                const raw = String(stepInput.value ?? "").trim();
                if (!raw && !finalize) {
                    return;
                }
                const normalized = normalizeRoomDistributionStep(raw || ROOM_DISTRIBUTION_DEFAULT_STEP);
                if (finalize || /^\d+$/.test(raw)) {
                    stepInput.value = String(normalized);
                }
                renderRoomDistributionPanel();
            };
            stepInput.addEventListener("input", () => syncStep(false));
            stepInput.addEventListener("change", () => syncStep(true));
            stepInput.addEventListener("blur", () => syncStep(true));
        }

        const header = root.querySelector(`.${ROOM_DISTRIBUTION_HEADER_CLASS}`);
        if (header) {
            header.addEventListener("pointerdown", (event) => {
                const target = event?.target;
                if (target && typeof target.closest === "function" && target.closest(`.${ROOM_DISTRIBUTION_CLOSE_CLASS}`)) {
                    return;
                }
                if (!(event instanceof PointerEvent) || event.button !== 0) {
                    return;
                }
                event.preventDefault();
                const initialRect = root.getBoundingClientRect();
                const startX = event.clientX;
                const startY = event.clientY;
                const startLeft = initialRect.left;
                const startTop = initialRect.top;
                const onMove = (moveEvent) => {
                    applyRoomDistributionPanelPosition(
                        root,
                        {
                            left: startLeft + (moveEvent.clientX - startX),
                            top: startTop + (moveEvent.clientY - startY),
                        },
                        false
                    );
                };
                const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                    window.removeEventListener("pointercancel", onUp);
                    const finalRect = root.getBoundingClientRect();
                    applyRoomDistributionPanelPosition(root, { left: finalRect.left, top: finalRect.top }, true);
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
                window.addEventListener("pointercancel", onUp);
            });
        }

        if (!ensureRoomDistributionFloatingPanel.__resizeBound) {
            ensureRoomDistributionFloatingPanel.__resizeBound = true;
            window.addEventListener("resize", () => {
                if (isRoomDistributionUnsupportedDevice()) {
                    setRoomDistributionEnabled(false);
                    return;
                }
                const panel = getRoomDistributionFloatingPanel();
                if (!panel || panel.hasAttribute("hidden")) {
                    return;
                }
                const rect = panel.getBoundingClientRect();
                applyRoomDistributionPanelPosition(panel, { left: rect.left, top: rect.top }, true);
            });
        }

        return root;
    }

    function summarizeRoomDistribution(chances, stepValue) {
        const step = normalizeRoomDistributionStep(stepValue);
        const source = Array.isArray(chances) ? chances : [];
        const binCount = Math.max(1, Math.ceil(100 / step));
        const bins = Array.from({ length: binCount }, (_unused, index) => ({
            min: index * step,
            max: Math.min(100, (index + 1) * step),
            count: 0,
        }));
        for (const chanceValue of source) {
            const chance = clamp01(finiteNumber(chanceValue, 0));
            const chancePercent = chance * 100;
            const index = chance >= 1 ? bins.length - 1 : Math.min(bins.length - 1, Math.floor(chancePercent / step));
            bins[index].count += 1;
        }
        return bins.map((bin) => ({
            ...bin,
            ratio: source.length > 0 ? bin.count / source.length : 0,
        }));
    }

    function renderRoomDistributionPanel() {
        const existingPanel = getRoomDistributionFloatingPanel();
        if (!roomDistributionEnabled || isRoomDistributionUnsupportedDevice()) {
            if (existingPanel) {
                existingPanel.setAttribute("hidden", "hidden");
            }
            return;
        }
        const panel = existingPanel || ensureRoomDistributionFloatingPanel();
        if (!panel) {
            return;
        }
        const context = getRoomDistributionContext();
        if (!context) {
            panel.setAttribute("hidden", "hidden");
            return;
        }
        const wasHidden = panel.hasAttribute("hidden");
        panel.removeAttribute("hidden");
        if (wasHidden) {
            applyRoomDistributionPanelPosition(panel, loadRoomDistributionPanelPosition(), false);
        }

        const title = panel.querySelector(`.${ROOM_DISTRIBUTION_TITLE_CLASS}`);
        const closeButton = panel.querySelector(`.${ROOM_DISTRIBUTION_CLOSE_CLASS}`);
        const meta = panel.querySelector(`.${ROOM_DISTRIBUTION_META_CLASS}`);
        const list = panel.querySelector(`.${ROOM_DISTRIBUTION_LIST_CLASS}`);
        if (!title || !meta || !list) {
            return;
        }
        title.textContent = t("roomDistributionTitleFmt", { floor: context.floor });
        if (closeButton) {
            closeButton.title = t("roomLogClose");
        }
        list.textContent = "";

        const fixedTrials = normalizeCombatSimTrials(AUTOMATION_RECOMMEND_COMBAT_TRIALS);
        if (
            roomDistributionProgress &&
            context &&
            roomDistributionProgress.labyrinthSignature === context.labyrinthSignature
        ) {
            meta.textContent = `${t("roomDistributionCalculatingFmt", {
                current: roomDistributionProgress.current,
                total: roomDistributionProgress.total,
            })} · Lv.${context.minLevel}～${context.maxLevel} · ${t("roomDistributionTrialsFmt", { trials: fixedTrials })}`;
            return;
        }

        const snapshot =
            context && roomDistributionSnapshot?.labyrinthSignature === context.labyrinthSignature
                ? roomDistributionSnapshot
                : null;
        if (!snapshot) {
            meta.textContent = context
                ? `Lv.${context.minLevel}～${context.maxLevel} · ${t("roomDistributionWaiting")} · ${t(
                      "roomDistributionTrialsFmt",
                      { trials: fixedTrials }
                  )}`
                : t("roomDistributionWaiting");
            return;
        }

        const validCount = Array.isArray(snapshot.chances) ? snapshot.chances.length : 0;
        meta.textContent = `${t("roomDistributionMetaFmt", {
            min: snapshot.minLevel,
            max: snapshot.maxLevel,
            valid: validCount,
            total: snapshot.totalCount,
            failed: snapshot.failedCount,
        })} · ${t("roomDistributionTrialsFmt", { trials: fixedTrials })}`;
        if (validCount === 0) {
            const empty = document.createElement("div");
            empty.className = ROOM_DISTRIBUTION_META_CLASS;
            empty.textContent = t("roomDistributionNoSamples");
            list.appendChild(empty);
            return;
        }

        const bins = summarizeRoomDistribution(snapshot.chances, getSelectedRoomDistributionStep());
        for (const bin of bins) {
            const row = document.createElement("div");
            row.className = ROOM_DISTRIBUTION_ROW_CLASS;
            const label = document.createElement("span");
            label.className = `${ROOM_DISTRIBUTION_ROW_CLASS}__label`;
            label.textContent = `${bin.min}%-${bin.max}%`;
            const bar = document.createElement("span");
            bar.className = ROOM_DISTRIBUTION_BAR_CLASS;
            const fill = document.createElement("span");
            fill.style.width = `${(bin.ratio * 100).toFixed(1)}%`;
            bar.appendChild(fill);
            const value = document.createElement("span");
            value.className = `${ROOM_DISTRIBUTION_ROW_CLASS}__value`;
            value.textContent = `${(bin.ratio * 100).toFixed(1)}%`;
            row.appendChild(label);
            row.appendChild(bar);
            row.appendChild(value);
            list.appendChild(row);
        }
    }

    function getRoomDistributionEntries() {
        return [
            ...LABYRINTH_AUTOMATION_SKILL_ROOM_TYPES.map((entry) => ({ ...entry, isCombat: false })),
            ...LABYRINTH_AUTOMATION_COMBAT_ROOM_TYPES.map((entry) => ({ ...entry, isCombat: true })),
        ];
    }

    async function calculateCurrentFloorRoomDistribution(options = {}) {
        if (!roomDistributionEnabled || isRoomDistributionUnsupportedDevice() || roomDistributionRunning) {
            return false;
        }
        const state = getGameState();
        const context = getRoomDistributionContext(state);
        const initClientData = getInitClientData();
        if (!state || !context || !initClientData) {
            renderRoomDistributionPanel();
            return false;
        }
        if (roomDistributionSnapshot?.labyrinthSignature === context.labyrinthSignature) {
            renderRoomDistributionPanel();
            return true;
        }

        const entries = getRoomDistributionEntries();
        const levels = [];
        for (let level = context.minLevel; level <= context.maxLevel; level += 1) {
            levels.push(level);
        }
        const totalCount = entries.length * levels.length;
        const maxEnhancementByItem = buildMaxEnhancementByItem(state);
        const labyrinthUpgradeLevels = getLabyrinthUpgradeLevels(true);
        const loanPersonalActionTypeBuffsDict =
            options?.loanPersonalActionTypeBuffsDict && typeof options.loanPersonalActionTypeBuffsDict === "object"
                ? options.loanPersonalActionTypeBuffsDict
                : null;
        const selectedSealItemHrids = Array.isArray(options?.selectedSealItemHrids) ? options.selectedSealItemHrids : [];
        const combatTrials = normalizeCombatSimTrials(AUTOMATION_RECOMMEND_COMBAT_TRIALS);
        const chances = [];
        let failedCount = 0;
        let completedCount = 0;
        const runToken = ++roomDistributionRunToken;
        roomDistributionRunning = true;
        roomDistributionProgress = {
            labyrinthSignature: context.labyrinthSignature,
            current: 0,
            total: totalCount,
        };
        renderRoomDistributionPanel();

        const isRunStale = () =>
            runToken !== roomDistributionRunToken ||
            !roomDistributionEnabled ||
            isRoomDistributionUnsupportedDevice() ||
            getRoomDistributionContext()?.labyrinthSignature !== context.labyrinthSignature;

        try {
            for (const entry of entries) {
                for (const roomLevel of levels) {
                    if (isRunStale()) {
                        return false;
                    }
                    const room = createAutomationRoomFromEntry(entry, roomLevel);
                    try {
                        const result = entry.isCombat
                            ? await computeCombatRoomClearChance(
                                  state,
                                  initClientData,
                                  room,
                                  maxEnhancementByItem,
                                  null,
                                  combatTrials,
                                  `distribution:${context.labyrinthSignature}:${entry.key}:${roomLevel}`,
                                  {
                                      selectedSealItemHrids,
                                      labyrinthUpgradeLevels,
                                  }
                              )
                            : computeRoomClearChance(state, initClientData, room, maxEnhancementByItem, {
                                  loanPersonalActionTypeBuffsDict,
                                  labyrinthUpgradeLevels,
                              });
                        if (result && Number.isFinite(Number(result.clearChance))) {
                            chances.push(clamp01(Number(result.clearChance)));
                        } else {
                            failedCount += 1;
                        }
                    } catch (error) {
                        failedCount += 1;
                        console.warn(
                            `[Lab Clear Rate] distribution sample failed: ${entry.key} Lv.${roomLevel}`,
                            error
                        );
                    }
                    completedCount += 1;
                    roomDistributionProgress = {
                        labyrinthSignature: context.labyrinthSignature,
                        current: completedCount,
                        total: totalCount,
                    };
                    setControlStatus({
                        running: true,
                        ratio: completedCount / totalCount,
                        message: t("roomDistributionCalculatingFmt", { current: completedCount, total: totalCount }),
                    });
                    renderRoomDistributionPanel();
                    if (!entry.isCombat && completedCount % 10 === 0) {
                        await nextFrame();
                    }
                }
            }

            if (isRunStale()) {
                return false;
            }
            roomDistributionSnapshot = {
                labyrinthSignature: context.labyrinthSignature,
                floor: context.floor,
                minLevel: context.minLevel,
                maxLevel: context.maxLevel,
                chances,
                failedCount,
                totalCount,
                calculatedAt: Date.now(),
            };
            return true;
        } finally {
            roomDistributionRunning = false;
            roomDistributionProgress = null;
            renderRoomDistributionPanel();
        }
    }

    function createControlPanel() {
        let root = getControlPanel();
        if (root && root.getAttribute(CONTROL_SCHEMA_ATTR) !== CONTROL_SCHEMA_VERSION) {
            root.remove();
            root = null;
        }
        if (root) {
            const settingsLabel = root.querySelector(`.${CONTROL_CLASS}__settings-label`);
            if (settingsLabel) {
                settingsLabel.textContent = t("combatTrials");
            }
            const logToggle = root.querySelector(`.${CONTROL_LOG_TOGGLE_CLASS}`);
            if (logToggle) {
                logToggle.textContent = t("roomLog");
            }
            const distributionLabel = root.querySelector(`.${CONTROL_DISTRIBUTION_TOGGLE_CLASS} span`);
            if (distributionLabel) {
                distributionLabel.textContent = t("roomDistribution");
            }
            const text = root.querySelector(`.${CONTROL_CLASS}__text`);
            if (text && !String(text.textContent || "").trim()) {
                text.textContent = t("pending");
            }
            bindControlPanelInteractions(root);
            syncRoomDistributionToggleState();
            refreshRoomLogPanelIfVisible();
            return root;
        }
        root = document.createElement("div");
        root.id = CONTROL_ID;
        root.className = CONTROL_CLASS;
        root.setAttribute(CONTROL_SCHEMA_ATTR, CONTROL_SCHEMA_VERSION);
        root.innerHTML = `
<button type="button" class="${CONTROL_CLASS}__button">${t("calcMaze")}</button>
<div class="${CONTROL_CLASS}__settings">
  <span class="${CONTROL_CLASS}__settings-label">${t("combatTrials")}</span>
  <input type="number" class="${CONTROL_CLASS}__settings-input" min="${MIN_COMBAT_SIM_TRIALS}" max="${MAX_COMBAT_SIM_TRIALS}" step="1" value="${DEFAULT_COMBAT_SIM_TRIALS}" inputmode="numeric" />
</div>
<button type="button" class="${CONTROL_LOG_TOGGLE_CLASS}">${t("roomLog")}</button>
<label class="${CONTROL_DISTRIBUTION_TOGGLE_CLASS}">
  <input type="checkbox" />
  <span>${t("roomDistribution")}</span>
</label>
<div class="${CONTROL_CLASS}__progress">
  <div class="${CONTROL_CLASS}__track"><div class="${CONTROL_CLASS}__bar"></div></div>
  <div class="${CONTROL_CLASS}__text">${t("pending")}</div>
</div>
`;
        bindControlPanelInteractions(root);
        syncRoomDistributionToggleState();
        refreshRoomLogPanelIfVisible();
        return root;
    }

    function bindControlPanelInteractions(root) {
        if (!root || root[CONTROL_BOUND_FLAG]) {
            return;
        }

        const button = root.querySelector(`.${CONTROL_CLASS}__button`);
        if (button) {
            button.addEventListener(
                "click",
                (event) => {
                    if (event) {
                        event.preventDefault();
                        if (typeof event.stopImmediatePropagation === "function") {
                            event.stopImmediatePropagation();
                        }
                        event.stopPropagation();
                    }
                    runManualUpdate();
                },
                true
            );
        }

        const loanToggle = root.querySelector(`.${CONTROL_LOAN_TOGGLE_CLASS}`);
        if (loanToggle) {
            loanToggle.addEventListener(
                "click",
                (event) => {
                    if (event) {
                        event.preventDefault();
                        if (typeof event.stopImmediatePropagation === "function") {
                            event.stopImmediatePropagation();
                        }
                        event.stopPropagation();
                    }
                    const panel = root.querySelector(`.${CONTROL_LOAN_PANEL_CLASS}`);
                    if (!panel) {
                        return;
                    }
                    const opening = panel.hasAttribute("hidden");
                    if (opening) {
                        setRoomLogPanelOpen(false);
                        panel.removeAttribute("hidden");
                        refreshLoanSealPanelOnOpen(root);
                    } else {
                        panel.setAttribute("hidden", "hidden");
                    }
                },
                true
            );
        }

        const logToggle = root.querySelector(`.${CONTROL_LOG_TOGGLE_CLASS}`);
        if (logToggle) {
            logToggle.addEventListener(
                "click",
                (event) => {
                    if (event) {
                        event.preventDefault();
                        if (typeof event.stopImmediatePropagation === "function") {
                            event.stopImmediatePropagation();
                        }
                        event.stopPropagation();
                    }
                    const loanPanel = root.querySelector(`.${CONTROL_LOAN_PANEL_CLASS}`);
                    if (loanPanel) {
                        loanPanel.setAttribute("hidden", "hidden");
                    }
                    setRoomLogPanelOpen(!isRoomLogPanelOpen());
                },
                true
            );
        }

        const distributionCheckbox = root.querySelector(`.${CONTROL_DISTRIBUTION_TOGGLE_CLASS} input[type="checkbox"]`);
        if (distributionCheckbox) {
            distributionCheckbox.checked = roomDistributionEnabled;
            distributionCheckbox.addEventListener(
                "change",
                (event) => {
                    if (event && typeof event.stopImmediatePropagation === "function") {
                        event.stopImmediatePropagation();
                    }
                    setRoomDistributionEnabled(distributionCheckbox.checked);
                },
                true
            );
        }

        const loanCalcButton = root.querySelector(`.${CONTROL_LOAN_CALC_CLASS}`);
        if (loanCalcButton) {
            loanCalcButton.addEventListener(
                "click",
                (event) => {
                    if (event) {
                        event.preventDefault();
                        if (typeof event.stopImmediatePropagation === "function") {
                            event.stopImmediatePropagation();
                        }
                        event.stopPropagation();
                    }
                    const state = getGameState();
                    const initClientData = getInitClientData();
                    const catalog = buildLoanSealEffectCatalog(state, initClientData);
                    const selectedItemHrids = getSelectedLoanSealItemHrids();
                    const loanOptions = buildLoanSimulationOptions(state, catalog, selectedItemHrids);
                    if (!loanOptions) {
                        return;
                    }
                    runManualUpdate({
                        loanPersonalActionTypeBuffsDict: loanOptions.loanPersonalActionTypeBuffsDict,
                        selectedSealItemHrids: loanOptions.selectedSealItemHrids,
                    });
                },
                true
            );
        }

        const trialsInput = root.querySelector(`.${CONTROL_CLASS}__settings-input`);
        if (trialsInput) {
            const initialTrials = loadCombatSimTrialsSetting();
            trialsInput.value = String(initialTrials);
            const syncTrials = (finalize = false) => {
                const raw = String(trialsInput.value ?? "").trim();
                if (!raw) {
                    if (finalize) {
                        const fallback = saveCombatSimTrialsSetting(DEFAULT_COMBAT_SIM_TRIALS);
                        trialsInput.value = String(fallback);
                    }
                    return;
                }

                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) {
                    if (finalize) {
                        const fallback = saveCombatSimTrialsSetting(DEFAULT_COMBAT_SIM_TRIALS);
                        trialsInput.value = String(fallback);
                    }
                    return;
                }

                const normalized = saveCombatSimTrialsSetting(parsed);
                if (finalize || /^\d+$/.test(raw)) {
                    trialsInput.value = String(normalized);
                }
            };
            trialsInput.addEventListener(
                "input",
                (event) => {
                    if (event && typeof event.stopImmediatePropagation === "function") {
                        event.stopImmediatePropagation();
                    }
                    syncTrials(false);
                },
                true
            );
            trialsInput.addEventListener(
                "change",
                (event) => {
                    if (event && typeof event.stopImmediatePropagation === "function") {
                        event.stopImmediatePropagation();
                    }
                    syncTrials(true);
                },
                true
            );
            trialsInput.addEventListener(
                "blur",
                (event) => {
                    if (event && typeof event.stopImmediatePropagation === "function") {
                        event.stopImmediatePropagation();
                    }
                    syncTrials(true);
                },
                true
            );
        }

        root[CONTROL_BOUND_FLAG] = true;
    }

    function findLongestPathControlHost(gridParent) {
        if (!gridParent) {
            return null;
        }
        const searchRoot = gridParent.closest('div[class*="LabyrinthPanel_activeRun"]') || gridParent.parentElement || gridParent;
        let marker = null;

        const xpathQueries = [
            ".//*[contains(normalize-space(text()), '最長路徑')]",
            ".//*[contains(translate(normalize-space(text()), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'longest path')]",
        ];
        for (const xpath of xpathQueries) {
            const snapshot = document.evaluate(xpath, searchRoot, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < snapshot.snapshotLength; i += 1) {
                const node = snapshot.snapshotItem(i);
                if (!node) {
                    continue;
                }
                const text = String(node.textContent || "").trim();
                if (!text || text.length > 96) {
                    continue;
                }
                marker = node;
                break;
            }
            if (marker) {
                break;
            }
        }

        if (!marker) {
            const nodes = Array.from(searchRoot.querySelectorAll("div, span, p, strong"));
            marker = nodes.find((node) => {
                if (node.childElementCount > 0) {
                    return false;
                }
                const text = String(node.textContent || "").replace(/\s+/g, "").toLowerCase();
                return text.includes("最長路徑") || text.includes("longestpath");
            });
        }
        if (!marker) {
            return null;
        }

        let host = marker.parentElement;
        for (let depth = 0; depth < 4 && host; depth += 1) {
            const display = getComputedStyle(host).display;
            if (display.includes("flex")) {
                return host;
            }
            host = host.parentElement;
        }
        return marker.parentElement;
    }

    function ensureControlPanel(gridParent) {
        if (!gridParent) {
            return getControlPanel();
        }
        const root = createControlPanel();
        const inlineHost = findLongestPathControlHost(gridParent);

        if (inlineHost) {
            root.classList.add(`${CONTROL_CLASS}--inline`);
            root.classList.remove(`${CONTROL_CLASS}--block`);
            if (root.parentElement !== inlineHost) {
                inlineHost.appendChild(root);
            }
            if (isLoanSealPanelOpen(root)) {
                positionLoanSealPanel(root);
            }
            return root;
        }

        const gridContainer = gridParent.parentElement || gridParent;
        const host = gridContainer.parentElement || gridContainer;
        const anchor = gridContainer;
        if (!host) {
            return getControlPanel();
        }
        root.classList.add(`${CONTROL_CLASS}--block`);
        root.classList.remove(`${CONTROL_CLASS}--inline`);
        if (root.parentElement !== host || root.nextElementSibling !== anchor) {
            host.insertBefore(root, anchor);
        }
        if (isLoanSealPanelOpen(root)) {
            positionLoanSealPanel(root);
        }
        return root;
    }

    function setControlStatus(status) {
        const root = getControlPanel();
        if (!root) {
            return;
        }
        const button = root.querySelector(`.${CONTROL_CLASS}__button`);
        const loanToggle = root.querySelector(`.${CONTROL_LOAN_TOGGLE_CLASS}`);
        const logToggle = root.querySelector(`.${CONTROL_LOG_TOGGLE_CLASS}`);
        const distributionCheckbox = root.querySelector(`.${CONTROL_DISTRIBUTION_TOGGLE_CLASS} input[type="checkbox"]`);
        const loanCalcButton = root.querySelector(`.${CONTROL_LOAN_CALC_CLASS}`);
        const trialsInput = root.querySelector(`.${CONTROL_CLASS}__settings-input`);
        const bar = root.querySelector(`.${CONTROL_CLASS}__bar`);
        const text = root.querySelector(`.${CONTROL_CLASS}__text`);
        if (button && Object.prototype.hasOwnProperty.call(status, "running")) {
            const running = Boolean(status.running);
            button.disabled = running;
            button.textContent = running ? t("calculating") : t("calcMaze");
            if (loanToggle) {
                loanToggle.disabled = running;
            }
            if (logToggle) {
                logToggle.disabled = running;
            }
            if (distributionCheckbox) {
                distributionCheckbox.disabled = running;
            }
            if (loanCalcButton) {
                if (running) {
                    loanCalcButton.disabled = true;
                } else {
                    updateLoanCalcButtonState(root);
                }
            }
            if (trialsInput) {
                trialsInput.disabled = running;
            }
        }
        if (bar && Object.prototype.hasOwnProperty.call(status, "ratio")) {
            const ratio = clamp01(finiteNumber(status.ratio, 0));
            bar.style.width = `${(ratio * 100).toFixed(1)}%`;
        }
        if (text && typeof status.message === "string") {
            text.textContent = status.message;
        }
    }

    function nextFrame() {
        return new Promise((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    }

    function createProgressTracker(totalUnits) {
        const safeTotal = Math.max(1, Math.floor(finiteNumber(totalUnits, 1)));
        let completed = 0;

        function update(message) {
            const ratio = clamp01(completed / safeTotal);
            const percent = Math.round(ratio * 100);
            const msg = message || t("progressFmt", { percent });
            setControlStatus({
                running: true,
                ratio,
                message: msg,
            });
        }

        update(t("preparing"));

        return {
            add(units = 1, message) {
                const value = Math.max(0, Math.floor(finiteNumber(units, 0)));
                completed = Math.min(safeTotal, completed + value);
                update(message);
            },
            finish(message) {
                completed = safeTotal;
                update(message || t("calcDone"));
            },
        };
    }

    async function fetchCombatWorkerChunkText(url) {
        const response = await fetch(url, { cache: "force-cache", credentials: "omit" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} for ${url}`);
        }
        return response.text();
    }

    function buildCombatSimulatorWorkerSource(vendorChunkSource, workerChunkSource) {
        const runtimePrelude = `"use strict";
var __webpack_modules__ = {};
var __webpack_module_cache__ = {};
function __webpack_require__(moduleId) {
  var cached = __webpack_module_cache__[moduleId];
  if (cached !== undefined) {
    return cached.exports;
  }
  var module = (__webpack_module_cache__[moduleId] = { exports: {} });
  var factory = __webpack_modules__[moduleId];
  if (!factory) {
    throw new Error("Missing webpack module: " + moduleId);
  }
  factory(module, module.exports, __webpack_require__);
  return module.exports;
}
__webpack_require__.o = function (obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
};
__webpack_require__.d = function (exports, definition) {
  for (var key in definition) {
    if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
      Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
    }
  }
};
__webpack_require__.r = function (exports) {
  if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  }
  Object.defineProperty(exports, "__esModule", { value: true });
};
var __webpack_chunk_array__ = [];
__webpack_chunk_array__.push = function (data) {
  var moreModules = data[1] || {};
  var runtime = data[2];
  for (var moduleId in moreModules) {
    if (__webpack_require__.o(moreModules, moduleId)) {
      __webpack_modules__[moduleId] = moreModules[moduleId];
    }
  }
  if (runtime) {
    runtime(__webpack_require__);
  }
};
self["webpackChunkmwicombatsimulator"] = __webpack_chunk_array__;`;

        const runtimeSuffix = `
(function () {
  var Player = __webpack_require__("./src/combatsimulator/player.js").default;
  var CombatUnit = __webpack_require__("./src/combatsimulator/combatUnit.js").default;
  var CombatSimulator = __webpack_require__("./src/combatsimulator/combatSimulator.js").default;
  var Labyrinth = __webpack_require__("./src/combatsimulator/labyrinth.js").default;
  var ONE_SECOND_NS = 1e9;
  var ONE_HOUR_NS = 3600 * ONE_SECOND_NS;

  function clone(value) {
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeCrates(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }
    var seen = Object.create(null);
    var result = [];
    for (var i = 0; i < raw.length; i += 1) {
      var hrid = String(raw[i] || "");
      if (!hrid || seen[hrid]) {
        continue;
      }
      seen[hrid] = true;
      result.push(hrid);
    }
    return result;
  }

  function normalizeBuffs(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }
    var result = [];
    var seen = Object.create(null);
    for (var i = 0; i < raw.length; i += 1) {
      var buff = raw[i];
      var typeHrid = String((buff && buff.typeHrid) || "");
      if (!typeHrid) {
        continue;
      }
      var normalized = {
        uniqueHrid: String((buff && buff.uniqueHrid) || ""),
        typeHrid: typeHrid,
        ratioBoost: finite(buff && buff.ratioBoost, 0),
        ratioBoostLevelBonus: finite(buff && buff.ratioBoostLevelBonus, 0),
        flatBoost: finite(buff && buff.flatBoost, 0),
        flatBoostLevelBonus: finite(buff && buff.flatBoostLevelBonus, 0),
        startTime: String((buff && buff.startTime) || "0001-01-01T00:00:00Z"),
        duration: Math.max(0, finite(buff && buff.duration, 0)),
      };
      var dedupeKey = [
        normalized.typeHrid,
        normalized.ratioBoost,
        normalized.ratioBoostLevelBonus,
        normalized.flatBoost,
        normalized.flatBoostLevelBonus,
        normalized.duration,
      ].join("|");
      if (seen[dedupeKey]) {
        continue;
      }
      seen[dedupeKey] = true;
      result.push(normalized);
    }
    return result;
  }

  function normalizePersonalBuffItemHrids(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }
    var result = [];
    var seen = Object.create(null);
    for (var i = 0; i < raw.length; i += 1) {
      var itemHrid = String(raw[i] || "");
      if (!itemHrid || seen[itemHrid]) {
        continue;
      }
      seen[itemHrid] = true;
      result.push(itemHrid);
    }
    return result;
  }

  function buildPersonalBuffsFromItemHrids(raw) {
    var itemHrids = normalizePersonalBuffItemHrids(raw);
    var detailByItem = {
      "/items/seal_of_combat_drop": { typeHrid: "/buff_types/combat_drop_quantity", flatBoost: 0.15, ratioBoost: 0 },
      "/items/seal_of_attack_speed": { typeHrid: "/buff_types/attack_speed", flatBoost: 0, ratioBoost: 0.15 },
      "/items/seal_of_cast_speed": { typeHrid: "/buff_types/cast_speed", flatBoost: 0.15, ratioBoost: 0 },
      "/items/seal_of_damage": { typeHrid: "/buff_types/damage", flatBoost: 0, ratioBoost: 0.08 },
      "/items/seal_of_critical_rate": { typeHrid: "/buff_types/critical_rate", flatBoost: 0.1, ratioBoost: 0 },
      "/items/seal_of_wisdom": { typeHrid: "/buff_types/wisdom", flatBoost: 0.2, ratioBoost: 0 },
      "/items/seal_of_rare_find": { typeHrid: "/buff_types/rare_find", flatBoost: 0.6, ratioBoost: 0 },
    };
    var buffs = [];
    for (var i = 0; i < itemHrids.length; i += 1) {
      var itemHrid = itemHrids[i];
      var detail = detailByItem[itemHrid];
      if (!detail || !detail.typeHrid) {
        continue;
      }
      buffs.push({
        uniqueHrid: "/buff_uniques/personal_" + itemHrid.split("/").pop(),
        typeHrid: detail.typeHrid,
        ratioBoost: finite(detail.ratioBoost, 0),
        ratioBoostLevelBonus: 0,
        flatBoost: finite(detail.flatBoost, 0),
        flatBoostLevelBonus: 0,
        startTime: "0001-01-01T00:00:00Z",
        duration: 0,
      });
    }
    return normalizeBuffs(buffs);
  }

  function ensureEncounterRecorderPatched() {
    if (!CombatSimulator || !CombatSimulator.prototype) {
      return;
    }
    if (CombatSimulator.prototype.__mwiLabEncounterRecorderPatched) {
      return;
    }
    var originalStartNewEncounter = CombatSimulator.prototype.startNewEncounter;
    var originalCheckEncounterEnd = CombatSimulator.prototype.checkEncounterEnd;
    if (typeof originalStartNewEncounter !== "function" || typeof originalCheckEncounterEnd !== "function") {
      return;
    }

    CombatSimulator.prototype.startNewEncounter = function () {
      var result = originalStartNewEncounter.apply(this, arguments);
      if (this && this.labyrinth) {
        if (!this.__mwiLabEncounterStats || typeof this.__mwiLabEncounterStats !== "object") {
          this.__mwiLabEncounterStats = { completed: [], currentStartNs: null };
        }
        if (!Array.isArray(this.__mwiLabEncounterStats.completed)) {
          this.__mwiLabEncounterStats.completed = [];
        }
        this.__mwiLabEncounterStats.currentStartNs = Math.max(0, finite(this.simulationTime, 0));
      }
      return result;
    };

    CombatSimulator.prototype.checkEncounterEnd = function () {
      var beforeEncounters = Math.max(0, Math.floor(finite(this && this.simResult ? this.simResult.encounters : 0, 0)));
      var stats = this && this.__mwiLabEncounterStats && typeof this.__mwiLabEncounterStats === "object"
        ? this.__mwiLabEncounterStats
        : null;
      var startNs = stats ? finite(stats.currentStartNs, NaN) : NaN;

      var ended = originalCheckEncounterEnd.apply(this, arguments);
      if (ended && this && this.labyrinth) {
        if (!stats || typeof stats !== "object") {
          stats = { completed: [], currentStartNs: null };
          this.__mwiLabEncounterStats = stats;
        }
        if (!Array.isArray(stats.completed)) {
          stats.completed = [];
        }

        var afterEncounters = Math.max(0, Math.floor(finite(this && this.simResult ? this.simResult.encounters : 0, 0)));
        var reason = "timeout";
        if (afterEncounters > beforeEncounters) {
          reason = "success";
        } else if (this.allPlayersDead === true) {
          reason = "death";
        }

        var endNs = Math.max(0, finite(this.simulationTime, 0));
        var beginNs = Number.isFinite(startNs) ? Math.max(0, startNs) : endNs;
        var durationNs = Math.max(0, endNs - beginNs);
        stats.completed.push({
          reason: reason,
          startNs: beginNs,
          endNs: endNs,
          durationNs: durationNs,
        });
        stats.currentStartNs = null;
      }
      return ended;
    };

    CombatSimulator.prototype.__mwiLabEncounterRecorderPatched = true;
  }

  function ensureLabyrinthMonsterInitialCooldownPatched() {
    if (!CombatUnit || !CombatUnit.prototype || CombatUnit.prototype.__mwiLabMonsterInitialCooldownPatched) return;
    var originalResetCooldowns = CombatUnit.prototype.resetCooldowns;
    if (typeof originalResetCooldowns !== "function") return;

    CombatUnit.prototype.resetCooldowns = function (currentTime) {
      var result = originalResetCooldowns.apply(this, arguments);
      if (this && !this.isPlayer && Array.isArray(this.abilities)) {
        var effectiveTime = Number.isFinite(Number(currentTime)) ? Number(currentTime) : 0;
        var haste = finite(this.combatDetails && this.combatDetails.combatStats
          ? this.combatDetails.combatStats.abilityHaste : 0, 0);
        this.abilities.filter(function (ability) { return ability != null; }).forEach(function (ability) {
          var cooldownDuration = finite(ability.cooldownDuration, 0);
          if (haste > 0) cooldownDuration = cooldownDuration * 100 / (100 + haste);
          ability.lastUsed = effectiveTime - Math.floor(cooldownDuration * 0.5);
        });
      }
      return result;
    };

    CombatUnit.prototype.__mwiLabMonsterInitialCooldownPatched = true;
  }

  function getDeathCount(simResult, playerHrid) {
    if (!simResult || typeof simResult !== "object") {
      return 0;
    }
    var deaths = simResult.deaths;
    if (!deaths || typeof deaths !== "object") {
      return 0;
    }
    var directCount = Math.floor(finite(deaths[playerHrid], 0));
    if (directCount > 0) {
      return directCount;
    }
    var total = 0;
    for (var key in deaths) {
      if (!Object.prototype.hasOwnProperty.call(deaths, key)) {
        continue;
      }
      if (String(key || "").indexOf("player") !== 0) {
        continue;
      }
      total += Math.max(0, Math.floor(finite(deaths[key], 0)));
    }
    return total;
  }

  async function simulateSingleRoomBatch(params) {
    var roomDurationSeconds = Math.max(1, Number(params.roomDurationSeconds) || 120);
    var trials = Math.max(1, Math.floor(Number(params.trials) || 1));
    var roomLevel = Math.max(1, Math.floor(Number(params.mazeDifficulty) || 100));
    var monsterHrid = String(params.monsterHrid || "");
    var playerDto = clone(params.playerDto);
    if (!playerDto || !monsterHrid) {
      throw new Error("Missing playerDto or monsterHrid");
    }

    var player = Player.createFromDTO(playerDto);
    // Lab clear-rate calculation always assumes no active food/coffee consumables.
    player.food = [null, null, null];
    player.drinks = [null, null, null];
    var guildCombatBuffs = normalizeBuffs(params.guildCombatBuffs || []);
    var guildMaxHitpointsRatio = 0;
    var guildMaxManapointsRatio = 0;
    var remainingGuildCombatBuffs = [];
    for (var guildBuffIndex = 0; guildBuffIndex < guildCombatBuffs.length; guildBuffIndex += 1) {
      var guildBuff = guildCombatBuffs[guildBuffIndex];
      if (guildBuff.typeHrid === "/buff_types/max_hitpoints") {
        guildMaxHitpointsRatio += finite(guildBuff.ratioBoost, 0);
      } else if (guildBuff.typeHrid === "/buff_types/max_manapoints") {
        guildMaxManapointsRatio += finite(guildBuff.ratioBoost, 0);
      } else {
        remainingGuildCombatBuffs.push(guildBuff);
      }
    }
    if (player.combatDetails && player.combatDetails.combatStats) {
      player.combatDetails.combatStats.maxHitpointsRatio =
        finite(player.combatDetails.combatStats.maxHitpointsRatio, 0) + guildMaxHitpointsRatio;
      player.combatDetails.combatStats.maxManapointsRatio =
        finite(player.combatDetails.combatStats.maxManapointsRatio, 0) + guildMaxManapointsRatio;
    }
    player.extraBuffs = normalizeBuffs(
      buildPersonalBuffsFromItemHrids(params.playerPersonalBuffItemHrids)
        .concat(params.labyrinthCombatBuffs || [])
        .concat(remainingGuildCombatBuffs)
    );

    var mazeCrates = normalizeCrates(params.mazeCrateItemHrids);
    var labyrinth = new Labyrinth(monsterHrid, roomLevel, mazeCrates);
    player.zoneBuffs = labyrinth && Array.isArray(labyrinth.buffs) ? labyrinth.buffs : [];

    ensureEncounterRecorderPatched();
    ensureLabyrinthMonsterInitialCooldownPatched();
    var simulator = new CombatSimulator([player], null, labyrinth, { enableHpMpVisualization: false });
    var simulationLimitNs = Math.max(1, Math.floor(roomDurationSeconds * trials * ONE_SECOND_NS));
    simulator.__mwiLabEncounterStats = { completed: [], currentStartNs: null };
    var simResult = await simulator.simulate(simulationLimitNs);
    var encounters = Math.max(0, Math.floor(finite(simResult && simResult.encounters, 0)));
    var deaths = clone((simResult && simResult.deaths) || {});
    var completedEncounters =
      simulator &&
      simulator.__mwiLabEncounterStats &&
      Array.isArray(simulator.__mwiLabEncounterStats.completed)
        ? simulator.__mwiLabEncounterStats.completed.slice()
        : [];
    var completedTrialsRecorded = Math.max(0, completedEncounters.length);
    var successes = encounters;
    var playerHrid = String(player.hrid || "player1");
    var failedByDeath = Math.max(0, getDeathCount(simResult, playerHrid));
    var failedByTimeout = Math.max(0, completedTrialsRecorded - successes - failedByDeath);
    var completedTrials = Math.max(0, successes + failedByDeath + failedByTimeout);

    var simulatedNs = Math.max(0, finite(simResult && simResult.simulatedTime, simulationLimitNs));
    var completedSpentNs = completedEncounters.reduce(function (sum, entry) {
      return sum + Math.max(0, finite(entry && entry.durationNs, 0));
    }, 0);
    var lastEncounterFinishNs = Math.max(0, finite(simResult && simResult.lastEncounterFinishTime, 0));
    var completedTimeNs = lastEncounterFinishNs > 0 ? lastEncounterFinishNs : completedSpentNs;
    var totalSpentSeconds = Math.max(0, completedTimeNs / ONE_SECOND_NS);
    var minElapsedSeconds = 0;
    var maxElapsedSeconds = 0;
    if (completedEncounters.length > 0) {
      minElapsedSeconds = completedEncounters.reduce(function (minValue, entry) {
        var seconds = Math.max(0, finite(entry && entry.durationNs, 0)) / ONE_SECOND_NS;
        return Math.min(minValue, seconds);
      }, Infinity);
      maxElapsedSeconds = completedEncounters.reduce(function (maxValue, entry) {
        var seconds = Math.max(0, finite(entry && entry.durationNs, 0)) / ONE_SECOND_NS;
        return Math.max(maxValue, seconds);
      }, 0);
      if (!Number.isFinite(minElapsedSeconds)) {
        minElapsedSeconds = 0;
      }
    }

    var deathCount = failedByDeath;
    var monsterKillCount = 0;
    for (var deathKey in deaths) {
      if (!Object.prototype.hasOwnProperty.call(deaths, deathKey)) {
        continue;
      }
      if (String(deathKey || "").indexOf("player") === 0) {
        continue;
      }
      monsterKillCount += Math.max(0, Math.floor(finite(deaths[deathKey], 0)));
    }
    var completedHours = completedTimeNs > 0 ? completedTimeNs / ONE_HOUR_NS : (simulatedNs > 0 ? simulatedNs / ONE_HOUR_NS : 0);
    var uiHours = simulatedNs > 0 ? simulatedNs / ONE_HOUR_NS : completedHours;
    var encountersPerHour = completedHours > 0 ? successes / completedHours : 0;
    var monsterKillsPerHour = completedHours > 0 ? monsterKillCount / completedHours : 0;
    var playerDeathsPerHour = completedHours > 0 ? failedByDeath / completedHours : 0;
    var uiMonsterKillsPerHour = uiHours > 0 ? monsterKillCount / uiHours : 0;
    var uiPlayerDeathsPerHour = uiHours > 0 ? failedByDeath / uiHours : 0;
    var hadIncompleteFinalEncounter =
      simulator &&
      simulator.__mwiLabEncounterStats &&
      Number.isFinite(finite(simulator.__mwiLabEncounterStats.currentStartNs, NaN));

    return {
      successes: successes,
      trials: completedTrials,
      totalSpentSeconds: totalSpentSeconds,
      minElapsedSeconds: minElapsedSeconds,
      maxElapsedSeconds: maxElapsedSeconds,
      failedByTimeout: failedByTimeout,
      failedByDeath: failedByDeath,
      debug: {
        requestedTrials: trials,
        simulatedSecondsLimit: simulationLimitNs / ONE_SECOND_NS,
        completedSeconds: completedTimeNs / ONE_SECOND_NS,
        completedTrials: completedTrials,
        completedTrialsRecorded: completedTrialsRecorded,
        encounters: encounters,
        monsterKillCount: monsterKillCount,
        simulatedTime: simulatedNs,
        lastEncounterFinishTime: lastEncounterFinishNs,
        simulationLimitNs: simulationLimitNs,
        encountersPerHour: encountersPerHour,
        monsterKillsPerHour: monsterKillsPerHour,
        playerDeathsPerHour: playerDeathsPerHour,
        uiMonsterKillsPerHour: uiMonsterKillsPerHour,
        uiPlayerDeathsPerHour: uiPlayerDeathsPerHour,
        hadIncompleteFinalEncounter: hadIncompleteFinalEncounter,
        deaths: deaths,
        deathCount: deathCount,
      },
    };
  }

  self.onmessage = async function (event) {
    var data = event && event.data ? event.data : {};
    if (data.type !== "simulate_room") {
      return;
    }

    var requestId = data.requestId;
    try {
      var trials = Math.max(1, Math.floor(Number(data.trials) || 1));
      var run = await simulateSingleRoomBatch({
        playerDto: data.playerDto,
        playerPersonalBuffItemHrids: data.playerPersonalBuffItemHrids,
        labyrinthCombatBuffs: data.labyrinthCombatBuffs,
        guildCombatBuffs: data.guildCombatBuffs,
        monsterHrid: data.monsterHrid,
        mazeDifficulty: data.mazeDifficulty,
        roomDurationSeconds: data.roomDurationSeconds,
        mazeCrateItemHrids: data.mazeCrateItemHrids,
        trials: trials,
      });

      self.postMessage({
        type: "room_progress",
        requestId: requestId,
        completed: trials,
        trials: trials,
      });

      self.postMessage({
        type: "room_result",
        requestId: requestId,
        successes: Math.max(0, Math.floor(finite(run && run.successes, 0))),
        trials: Math.max(1, Math.floor(finite(run && run.trials, trials))),
        totalSpentSeconds: Math.max(0, finite(run && run.totalSpentSeconds, 0)),
        minElapsedSeconds: Math.max(0, finite(run && run.minElapsedSeconds, 0)),
        maxElapsedSeconds: Math.max(0, finite(run && run.maxElapsedSeconds, 0)),
        failedByTimeout: Math.max(0, Math.floor(finite(run && run.failedByTimeout, 0))),
        failedByDeath: Math.max(0, Math.floor(finite(run && run.failedByDeath, 0))),
        firstRunDebug: run && run.debug ? run.debug : null,
      });
    } catch (error) {
      self.postMessage({
        type: "room_error",
        requestId: requestId,
        error: error && error.message ? error.message : String(error),
      });
    }
  };
})();`;

        return [runtimePrelude, vendorChunkSource, workerChunkSource, runtimeSuffix].join("\n\n");
    }

    function resetCombatSimulatorWorker(error) {
        if (combatSimulatorWorker) {
            try {
                combatSimulatorWorker.terminate();
            } catch (_e) {}
        }
        combatSimulatorWorker = null;
        if (combatSimulatorWorkerUrl) {
            URL.revokeObjectURL(combatSimulatorWorkerUrl);
            combatSimulatorWorkerUrl = "";
        }
        if (combatWorkerPendingRequests.size > 0) {
            for (const pending of combatWorkerPendingRequests.values()) {
                pending.reject(error || new Error("Combat worker reset"));
            }
            combatWorkerPendingRequests.clear();
        }
    }

    async function ensureCombatSimulatorWorker() {
        if (combatSimulatorWorker) {
            return combatSimulatorWorker;
        }
        if (!combatWorkerScriptPromise) {
            combatWorkerScriptPromise = Promise.all([
                fetchCombatWorkerChunkText(COMBAT_SIM_VENDOR_CHUNK_URL),
                fetchCombatWorkerChunkText(COMBAT_SIM_WORKER_CHUNK_URL),
            ]).then(([vendorChunkSource, workerChunkSource]) =>
                buildCombatSimulatorWorkerSource(vendorChunkSource, workerChunkSource)
            );
        }

        const workerSource = await combatWorkerScriptPromise;
        combatSimulatorWorkerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
        const worker = new Worker(combatSimulatorWorkerUrl);

        worker.addEventListener("message", (event) => {
            const message = event?.data || {};
            const pending = combatWorkerPendingRequests.get(message.requestId);
            if (!pending) {
                return;
            }

            if (message.type === "room_progress") {
                const completed = Math.max(0, Math.floor(finiteNumber(message.completed, 0)));
                const targetCompleted = Math.min(pending.trials, completed);
                const delta = Math.max(0, targetCompleted - pending.completed);
                pending.completed = targetCompleted;
                if (delta > 0 && pending.progressTracker) {
                    pending.progressTracker.add(delta);
                }
                return;
            }

            if (message.type === "room_result") {
                combatWorkerPendingRequests.delete(message.requestId);
                if (pending.progressTracker && pending.completed < pending.trials) {
                    pending.progressTracker.add(pending.trials - pending.completed);
                }
                pending.resolve(message);
                return;
            }
            combatWorkerPendingRequests.delete(message.requestId);
            pending.reject(new Error(String(message.error || "Unknown combat worker error")));
        });

        worker.addEventListener("error", (event) => {
            const reason = new Error(event?.message || "Combat simulator worker crashed");
            resetCombatSimulatorWorker(reason);
            combatWorkerScriptPromise = null;
        });

        combatSimulatorWorker = worker;
        return combatSimulatorWorker;
    }

    async function simulateCombatRoomWithWorker(params, progressTracker) {
        const worker = await ensureCombatSimulatorWorker();
        const requestId = ++combatWorkerRequestId;
        const trials = Math.max(1, Math.floor(finiteNumber(params?.trials, 1)));

        return new Promise((resolve, reject) => {
            combatWorkerPendingRequests.set(requestId, {
                resolve,
                reject,
                completed: 0,
                trials,
                progressTracker,
            });

            try {
                worker.postMessage({
                    type: "simulate_room",
                    requestId,
                    playerDto: deepCloneJson(params.playerDto),
                    playerPersonalBuffItemHrids: deepCloneJson(params.playerPersonalBuffItemHrids),
                    labyrinthCombatBuffs: deepCloneJson(params.labyrinthCombatBuffs),
                    guildCombatBuffs: deepCloneJson(params.guildCombatBuffs),
                    monsterHrid: params.monsterHrid,
                    mazeDifficulty: params.mazeDifficulty,
                    roomDurationSeconds: params.roomDurationSeconds,
                    mazeCrateItemHrids: deepCloneJson(params.mazeCrateItemHrids),
                    trials,
                });
            } catch (error) {
                combatWorkerPendingRequests.delete(requestId);
                reject(error);
            }
        });
    }

    function findRoomGridParent(totalCells) {
        const allCells = Array.from(document.querySelectorAll('div[class*="LabyrinthPanel_roomCell"]'));
        if (!allCells.length) {
            return null;
        }

        const parentCount = new Map();
        for (const cell of allCells) {
            const parent = cell.parentElement;
            if (!parent) {
                continue;
            }
            parentCount.set(parent, (parentCount.get(parent) || 0) + 1);
        }

        const candidates = [];
        for (const [parent, count] of parentCount.entries()) {
            if (count === totalCells) {
                candidates.push(parent);
            }
        }
        if (!candidates.length) {
            return null;
        }

        return (
            candidates.find((parent) => parent.querySelector('svg[aria-label="Exit"], use[href$="#flag"], use[xlink\\:href$="#flag"]')) ||
            candidates[0]
        );
    }

    function findRoomGridCells(totalCells) {
        const preferredParent = findRoomGridParent(totalCells);
        if (!preferredParent) {
            return [];
        }
        return Array.from(preferredParent.children).filter((el) => String(el.className || "").includes("LabyrinthPanel_roomCell"));
    }

    function toRoomKey(x, y) {
        return `${x},${y}`;
    }

    function parseRoomKey(roomKey) {
        if (!roomKey) {
            return null;
        }
        const [xRaw, yRaw] = String(roomKey).split(",");
        const x = Number(xRaw);
        const y = Number(yRaw);
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            return null;
        }
        return { x, y };
    }

    function getRoomKeyFromCell(cell) {
        if (!cell) {
            return "";
        }
        const x = Number(cell.getAttribute("data-room-x"));
        const y = Number(cell.getAttribute("data-room-y"));
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            return "";
        }
        return toRoomKey(x, y);
    }

    function clearDisplayedRoomData() {
        hidePreviewTooltip();
        skillingPreviewByCell = new WeakMap();
        combatPreviewByCell = new WeakMap();
        latestRoomEstimateByRoomKey.clear();
        const roomCells = Array.from(document.querySelectorAll('div[class*="LabyrinthPanel_roomCell"]'));
        for (const cell of roomCells) {
            removeBadge(cell);
        }
    }

    function parseLabyrinthPathData(pathData) {
        if (Array.isArray(pathData)) {
            return pathData;
        }
        if (typeof pathData === "string" && pathData) {
            try {
                const parsed = JSON.parse(pathData);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_error) {
                return [];
            }
        }
        return [];
    }

    function getCurrentPathRoomKey(state) {
        const labyrinth = state?.characterLabyrinth;
        if (!labyrinth) {
            return "";
        }
        const path = parseLabyrinthPathData(labyrinth.pathData);
        const point = path[0];
        if (!point) {
            return "";
        }
        const x = Number(point.x);
        const y = Number(point.y);
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            return "";
        }
        return `${x},${y}`;
    }

    function getLiveActionRateHost() {
        const actionName = document.querySelector("div[class*='Header_actionName']");
        if (!actionName) {
            return null;
        }
        return actionName.querySelector("div[class*='Header_displayName']") || actionName;
    }

    function clearLiveActionRateDisplay() {
        const existing = document.getElementById(LIVE_ACTION_RATE_ID);
        if (existing) {
            existing.remove();
        }
        lastLiveActionRateToken = "";
    }

    function upsertLiveActionRateDisplay(text, title) {
        const host = getLiveActionRateHost();
        if (!host) {
            return false;
        }
        let node = document.getElementById(LIVE_ACTION_RATE_ID);
        if (!node || node.parentElement !== host) {
            if (node) {
                node.remove();
            }
            node = document.createElement("span");
            node.id = LIVE_ACTION_RATE_ID;
            node.className = LIVE_ACTION_RATE_CLASS;
            host.appendChild(node);
        }
        node.textContent = text;
        node.style.color = LIVE_ACTION_RATE_MWITOOLS_COLOR;
        node.style.fontSize = LIVE_ACTION_RATE_MWITOOLS_FONT_SIZE;
        node.title = title || "";
        return true;
    }

    function buildLabyrinthLiveProgressToken(roomProgress) {
        if (!roomProgress || typeof roomProgress !== "object") {
            return "";
        }
        const isEnhancing = roomProgress.targetLevel !== null && roomProgress.targetLevel !== undefined;
        if (isEnhancing) {
            return [
                "enh",
                Math.floor(finiteNumber(roomProgress.actionCounter, 0)),
                Math.floor(finiteNumber(roomProgress.currentEnhLevel, 0)),
                Math.floor(finiteNumber(roomProgress.targetLevel, 0)),
                Math.round(normalizeChance(roomProgress.successRate) * 10000),
                Math.round(normalizeChance(roomProgress.doubleProgressChance) * 10000),
            ].join("|");
        }
        return [
            "skill",
            Math.floor(finiteNumber(roomProgress.actionCounter, 0)),
            Math.round(clamp01(finiteNumber(roomProgress.currentProgress, 0)) * 10000),
            Math.round(finiteNumber(roomProgress.currentWorkValue, 0) * 1000),
            Math.round(finiteNumber(roomProgress.targetWorkValue, 0) * 1000),
            Math.round(finiteNumber(roomProgress.progressPerAction, 0) * 1000),
            Math.round(normalizeChance(roomProgress.successRate) * 10000),
            Math.round(normalizeChance(roomProgress.doubleProgressChance) * 10000),
        ].join("|");
    }

    function computeLabyrinthLiveSkillingEstimate(roomProgress) {
        if (!roomProgress || typeof roomProgress !== "object") {
            return null;
        }
        const isEnhancing = roomProgress.targetLevel !== null && roomProgress.targetLevel !== undefined;
        const successChance = normalizeChance(roomProgress.successRate);
        const doubleChance = normalizeChance(roomProgress.doubleProgressChance);
        const fallbackActionMs = (isEnhancing ? BASE_ENHANCING_ACTION_SECONDS : BASE_ACTION_SECONDS) * 1000;
        const actionTimeMs = Math.max(1, finiteNumber(roomProgress.actionTimeMs, fallbackActionMs));
        const totalAttempts = Math.max(0, Math.floor((ROOM_DURATION_SECONDS * 1000) / actionTimeMs));
        const actionCounter = Math.max(0, Math.floor(finiteNumber(roomProgress.actionCounter, 0)));
        const attemptsLeft = Math.max(0, totalAttempts - actionCounter);

        if (isEnhancing) {
            const targetLevel = Math.max(0, Math.floor(finiteNumber(roomProgress.targetLevel, 0)));
            if (targetLevel <= 0) {
                return null;
            }
            const currentLevel = Math.max(0, Math.floor(finiteNumber(roomProgress.currentEnhLevel, 0)));
            const clearStats = computeEnhancingClearStats({
                attempts: attemptsLeft,
                successChance,
                doubleChance,
                targetLevel,
                startLevel: currentLevel,
            });
            return {
                isEnhancing: true,
                successChance,
                doubleChance,
                actionCounter,
                totalAttempts,
                attemptsLeft,
                targetLevel,
                currentLevel,
                clearChance: clamp01(finiteNumber(clearStats?.clearChance, 0)),
            };
        }

        const workPower = Math.max(0, finiteNumber(roomProgress.progressPerAction, 0));
        const progressPerSuccess = getEffectiveSkillingProgressPerSuccess(workPower);
        const targetWorkValue = Math.max(0, finiteNumber(roomProgress.targetWorkValue, 0));
        if (targetWorkValue <= 0) {
            return null;
        }
        let currentWorkValue = Math.max(0, finiteNumber(roomProgress.currentWorkValue, 0));
        if (targetWorkValue > 0 && currentWorkValue <= 0) {
            const progressRatio = clamp01(finiteNumber(roomProgress.currentProgress, 0));
            if (progressRatio > 0) {
                currentWorkValue = targetWorkValue * progressRatio;
            }
        }
        const remainingWorkValue = Math.max(0, targetWorkValue - currentWorkValue);
        const clearStats = computeNonEnhancingClearStats({
            attempts: attemptsLeft,
            successChance,
            doubleChance,
            progressPerSuccess,
            targetProgress: remainingWorkValue,
        });
        return {
            isEnhancing: false,
            successChance,
            doubleChance,
            actionCounter,
            totalAttempts,
            attemptsLeft,
            targetWorkValue,
            currentWorkValue,
            workPower,
            progressPerSuccess,
            clearChance: clamp01(finiteNumber(clearStats?.clearChance, 0)),
        };
    }

    function formatLabyrinthLiveEstimateText(estimate) {
        const chanceText = (clamp01(estimate?.clearChance) * 100).toFixed(1);
        if (estimate?.isEnhancing) {
            return t("liveEnhFmt", {
                chance: chanceText,
                current: estimate.currentLevel,
                target: estimate.targetLevel,
                left: estimate.attemptsLeft,
            });
        }
        return t("liveBasicFmt", {
            chance: chanceText,
            left: estimate?.attemptsLeft || 0,
        });
    }

    function formatLabyrinthLiveEstimateTitle(estimate) {
        if (!estimate) {
            return "";
        }
        const parts = [
            t("liveSuccessFmt", { chance: (clamp01(estimate.successChance) * 100).toFixed(1) }),
            t("liveDoubleFmt", { chance: (clamp01(estimate.doubleChance) * 100).toFixed(1) }),
            t("liveActionsFmt", { current: estimate.actionCounter, total: estimate.totalAttempts }),
        ];
        if (estimate.isEnhancing) {
            parts.push(t("liveEnhTitleFmt", { current: estimate.currentLevel, target: estimate.targetLevel }));
        } else {
            parts.push(t("liveProgressFmt", {
                current: Math.round(finiteNumber(estimate.currentWorkValue, 0)),
                target: Math.round(finiteNumber(estimate.targetWorkValue, 0)),
            }));
        }
        return parts.join(" | ");
    }

    function refreshLiveActionRateDisplay(state, roomProgressOverride = null) {
        const roomProgress =
            roomProgressOverride ||
            (state && typeof state === "object" ? state.labyrinthRoomProgress || null : null);
        const progressToken = buildLabyrinthLiveProgressToken(roomProgress);
        if (!progressToken) {
            clearLiveActionRateDisplay();
            return;
        }
        const existing = document.getElementById(LIVE_ACTION_RATE_ID);
        if (progressToken === lastLiveActionRateToken && existing) {
            return;
        }
        const estimate = computeLabyrinthLiveSkillingEstimate(roomProgress);
        if (!estimate) {
            clearLiveActionRateDisplay();
            return;
        }
        const text = formatLabyrinthLiveEstimateText(estimate);
        const title = formatLabyrinthLiveEstimateTitle(estimate);
        const rendered = upsertLiveActionRateDisplay(text, title);
        if (rendered) {
            lastLiveActionRateToken = progressToken;
        }
    }

    function handleLiveActionRateWsMessage(rawData) {
        if (typeof rawData !== "string") {
            return;
        }
        if (!rawData.includes("\"labyrinth_room_progress\"")) {
            return;
        }
        try {
            const msg = JSON.parse(rawData);
            if (!msg || msg.type !== "labyrinth_room_progress") {
                return;
            }
            refreshLiveActionRateDisplay(null, msg);
            handleRoomLogProgressMessage(msg);
        } catch (_error) {
            // Ignore malformed message payloads.
        }
    }

    function installLiveActionRateWsHook() {
        if (liveActionRateWsHookInstalled) {
            return;
        }
        const descriptor = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data");
        if (!descriptor || typeof descriptor.get !== "function") {
            return;
        }
        const originalGetter = descriptor.get;
        try {
            Object.defineProperty(MessageEvent.prototype, "data", {
                ...descriptor,
                get: function () {
                    const data = originalGetter.call(this);
                    if (this.currentTarget instanceof WebSocket && typeof data === "string") {
                        handleLiveActionRateWsMessage(data);
                    }
                    return data;
                },
            });
            liveActionRateWsHookInstalled = true;
        } catch (error) {
            console.warn("[Lab Clear Rate] Failed to install live action WS hook:", error);
        }
    }

    function isRoomChallengeRunning(state) {
        if (!state?.characterLabyrinth) {
            return false;
        }
        if (state.labyrinthRoomProgress) {
            return true;
        }
        return Array.isArray(state.labyrinthBattleMonsters) && state.labyrinthBattleMonsters.length > 0;
    }

    function clearSingleRoomDisplay(state, roomKey) {
        if (!roomKey) {
            return;
        }
        const labyrinth = state?.characterLabyrinth;
        if (!labyrinth || !Array.isArray(labyrinth.roomData) || labyrinth.roomData.length === 0) {
            return;
        }
        const [xRaw, yRaw] = String(roomKey).split(",");
        const x = Number(xRaw);
        const y = Number(yRaw);
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            return;
        }
        const rowCount = labyrinth.roomData.length;
        const colCount = Array.isArray(labyrinth.roomData[0]) ? labyrinth.roomData[0].length : 0;
        if (!colCount || x < 0 || y < 0 || x >= colCount || y >= rowCount) {
            return;
        }
        const roomCells = findRoomGridCells(rowCount * colCount);
        if (!roomCells.length) {
            return;
        }
        const cell = roomCells[y * colCount + x];
        if (!cell) {
            return;
        }
        removeBadge(cell);
        clearCellSkillingPreview(cell);
        clearCellCombatPreview(cell);
        clearRoomEstimate(roomKey);
    }

    function getRoomAtKey(state, roomKey) {
        if (!state?.characterLabyrinth || !Array.isArray(state.characterLabyrinth.roomData)) {
            return null;
        }
        const point = parseRoomKey(roomKey);
        if (!point) {
            return null;
        }
        const row = state.characterLabyrinth.roomData[point.y];
        if (!Array.isArray(row)) {
            return null;
        }
        return row[point.x] || null;
    }

    function isRoomKeyStillCalculable(state, roomKey) {
        return isCalculableRoom(getRoomAtKey(state, roomKey));
    }

    function pruneInvalidRoomDisplays(state) {
        if (!state?.characterLabyrinth) {
            return;
        }
        if (!(latestRoomEstimateByRoomKey instanceof Map) || latestRoomEstimateByRoomKey.size === 0) {
            return;
        }
        for (const roomKey of Array.from(latestRoomEstimateByRoomKey.keys())) {
            if (isRoomKeyStillCalculable(state, roomKey)) {
                continue;
            }
            clearSingleRoomDisplay(state, roomKey);
        }
    }

    function syncCompletedRoomCleanup(state) {
        if (!state?.characterLabyrinth) {
            lastProgressRoomKey = "";
            wasRoomChallengeRunning = false;
            lastObservedPathRoomKey = "";
            return;
        }

        const currentKey = getCurrentPathRoomKey(state);
        const hasProgress = isRoomChallengeRunning(state);

        if (hasProgress) {
            if (!wasRoomChallengeRunning) {
                lastProgressRoomKey = currentKey || lastObservedPathRoomKey || lastProgressRoomKey;
            } else if (!lastProgressRoomKey && currentKey) {
                lastProgressRoomKey = currentKey;
            }
            wasRoomChallengeRunning = true;
            if (currentKey) {
                lastObservedPathRoomKey = currentKey;
            }
            return;
        }

        if (wasRoomChallengeRunning && lastProgressRoomKey) {
            if (!isRoomKeyStillCalculable(state, lastProgressRoomKey)) {
                clearSingleRoomDisplay(state, lastProgressRoomKey);
            }
        } else if (!wasRoomChallengeRunning && lastObservedPathRoomKey && currentKey && currentKey !== lastObservedPathRoomKey) {
            // Fallback: if a very short room run did not get sampled while active, clear the previous head cell on path shift.
            if (!isRoomKeyStillCalculable(state, lastObservedPathRoomKey)) {
                clearSingleRoomDisplay(state, lastObservedPathRoomKey);
            }
        }

        lastProgressRoomKey = "";
        wasRoomChallengeRunning = false;
        lastObservedPathRoomKey = currentKey || "";
    }

    function getLabyrinthDisplaySignature(state) {
        const labyrinth = state?.characterLabyrinth;
        if (!labyrinth) {
            return "";
        }
        return hashString(
            stableStringify({
                startedAt: String(labyrinth.startedAt || ""),
                currentFloor: Math.max(0, Math.floor(finiteNumber(labyrinth.currentFloor, 0))),
            })
        );
    }

    function getCalculableRoomSnapshot(state) {
        const roomData = state?.characterLabyrinth?.roomData;
        if (!Array.isArray(roomData) || roomData.length === 0) {
            return {
                count: 0,
                signature: "",
            };
        }
        const parts = [];
        for (let y = 0; y < roomData.length; y += 1) {
            const row = roomData[y];
            if (!Array.isArray(row)) {
                continue;
            }
            for (let x = 0; x < row.length; x += 1) {
                const room = row[x];
                const roomType = String(room?.roomType || "");
                if (roomType !== LABYRINTH_COMBAT_ROOM_TYPE && roomType !== LABYRINTH_SKILLING_ROOM_TYPE) {
                    continue;
                }
                parts.push(
                    `${x},${y}|${roomType}|${String(room?.monsterHrid || "")}|${String(room?.skillHrid || "")}|${Math.max(
                        0,
                        Math.floor(finiteNumber(room?.recommendedLevel, 0))
                    )}`
                );
            }
        }
        parts.sort();
        return {
            count: parts.length,
            signature: parts.length > 0 ? hashString(parts.join("||")) : "",
            entries: parts,
        };
    }

    function resetAutoRecalcState() {
        autoRecalcArmed = false;
        autoRecalcLabyrinthSignature = "";
        lastCalculatedCalculableRoomSignature = "";
        lastCalculatedCalculableRoomCount = 0;
        lastCalculatedCalculableRoomEntries = new Set();
        pendingAutoRecalcRoomKeys = new Set();
        if (autoRecalcTimerId) {
            window.clearTimeout(autoRecalcTimerId);
            autoRecalcTimerId = 0;
        }
    }

    function updateAutoRecalcBaseline(state) {
        const snapshot = getCalculableRoomSnapshot(state);
        autoRecalcArmed = true;
        autoRecalcLabyrinthSignature = getLabyrinthDisplaySignature(state);
        lastCalculatedCalculableRoomSignature = snapshot.signature;
        lastCalculatedCalculableRoomCount = snapshot.count;
        lastCalculatedCalculableRoomEntries = new Set(snapshot.entries || []);
    }

    function getNewCalculableRoomKeys(state) {
        if (!autoRecalcArmed || manualUpdateRunning) {
            return [];
        }
        if (!state?.characterLabyrinth || !Array.isArray(state.characterLabyrinth.roomData)) {
            return [];
        }
        const signature = getLabyrinthDisplaySignature(state);
        if (!signature) {
            return [];
        }
        if (autoRecalcLabyrinthSignature && signature !== autoRecalcLabyrinthSignature) {
            resetAutoRecalcState();
            return [];
        }
        const snapshot = getCalculableRoomSnapshot(state);
        if (!Array.isArray(snapshot.entries) || snapshot.entries.length === 0) {
            return [];
        }
        const addedRoomKeys = [];
        const seenRoomKeys = new Set();
        for (const entry of snapshot.entries) {
            if (lastCalculatedCalculableRoomEntries.has(entry)) {
                continue;
            }
            const roomKey = String(entry).split("|")[0] || "";
            if (!roomKey || seenRoomKeys.has(roomKey)) {
                continue;
            }
            seenRoomKeys.add(roomKey);
            addedRoomKeys.push(roomKey);
        }
        return addedRoomKeys;
    }

    function scheduleAutoRecalcIfNeeded(state) {
        const roomKeys = getNewCalculableRoomKeys(state);
        if (!roomKeys.length) {
            return;
        }
        for (const roomKey of roomKeys) {
            pendingAutoRecalcRoomKeys.add(roomKey);
        }
        if (autoRecalcTimerId) {
            return;
        }
        autoRecalcTimerId = window.setTimeout(() => {
            autoRecalcTimerId = 0;
            const latestState = getGameState();
            const latestRoomKeys = getNewCalculableRoomKeys(latestState);
            for (const roomKey of latestRoomKeys) {
                pendingAutoRecalcRoomKeys.add(roomKey);
            }
            const keysToRecalc = Array.from(pendingAutoRecalcRoomKeys);
            pendingAutoRecalcRoomKeys.clear();
            if (!keysToRecalc.length) {
                return;
            }
            runManualUpdate({ trigger: "auto-new-tiles", roomKeys: keysToRecalc });
        }, AUTO_RECALC_DEBOUNCE_MS);
    }

    function markLabyrinthTransition(nextSignature = "") {
        const normalizedSignature = String(nextSignature || "");
        clearDisplayedRoomData();
        lastProgressRoomKey = "";
        wasRoomChallengeRunning = false;
        lastObservedPathRoomKey = "";
        lastLabyrinthDisplaySignature = normalizedSignature;
        activeLoanSimulationOptions = null;
        resetAutoRecalcState();
        handleRoomDistributionLabyrinthTransition(normalizedSignature);
    }

    function markLabyrinthTransitionPreserveTooltip(nextSignature = "") {
        const normalizedSignature = String(nextSignature || "");
        skillingPreviewByCell = new WeakMap();
        combatPreviewByCell = new WeakMap();
        latestRoomEstimateByRoomKey.clear();
        const roomCells = Array.from(document.querySelectorAll('div[class*="LabyrinthPanel_roomCell"]'));
        for (const cell of roomCells) {
            removeBadge(cell);
        }
        lastProgressRoomKey = "";
        wasRoomChallengeRunning = false;
        lastObservedPathRoomKey = "";
        lastLabyrinthDisplaySignature = normalizedSignature;
        activeLoanSimulationOptions = null;
        resetAutoRecalcState();
        handleRoomDistributionLabyrinthTransition(normalizedSignature);
    }

    function removeBadge(cell) {
        const badge = cell.querySelector(`.${BADGE_CLASS}`);
        if (badge) {
            badge.remove();
        }
    }

    function formatEtaText(expectedSeconds, shownPercent) {
        if (shownPercent === 0 || expectedSeconds === Infinity) {
            return ETA_INFINITE_TEXT;
        }
        if (!Number.isFinite(expectedSeconds)) {
            return "--";
        }
        const roundedSeconds = Math.max(0, Math.ceil(expectedSeconds));
        if (roundedSeconds > 999) {
            return "999+";
        }
        return `${roundedSeconds}s`;
    }

    function upsertBadge(cell, probability, expectedSeconds, details) {
        let badge = cell.querySelector(`.${BADGE_CLASS}`);
        if (!badge) {
            badge = document.createElement("div");
            badge.className = BADGE_CLASS;
            cell.style.position = "relative";
            cell.appendChild(badge);
        }
        let chanceNode = badge.querySelector(`.${BADGE_CLASS}__chance`);
        if (!chanceNode) {
            chanceNode = document.createElement("div");
            chanceNode.className = `${BADGE_CLASS}__chance`;
            badge.appendChild(chanceNode);
        }

        let etaNode = badge.querySelector(`.${BADGE_CLASS}__eta`);
        if (!etaNode) {
            etaNode = document.createElement("div");
            etaNode.className = `${BADGE_CLASS}__eta`;
            badge.appendChild(etaNode);
        }

        const shownPercent = Math.round(probability * 100);
        chanceNode.textContent = `${shownPercent}%`;
        etaNode.textContent = formatEtaText(expectedSeconds, shownPercent);
        badge.style.backgroundColor = getBadgeColor(probability);
        badge.title = details;
    }

    function clearRoomEstimate(roomKey) {
        if (!roomKey) {
            return;
        }
        latestRoomEstimateByRoomKey.delete(roomKey);
    }

    function updateRoomEstimate(roomKey, result) {
        if (!roomKey || !result) {
            return;
        }
        const clearChance = clamp01(finiteNumber(result.clearChance, 0));
        const expectedSeconds = finiteNumber(result.expectedSecondsPerClear, Infinity);
        const shownPercent = Math.round(clearChance * 100);
        const etaText = formatEtaText(expectedSeconds, shownPercent);
        latestRoomEstimateByRoomKey.set(roomKey, {
            clearChance,
            expectedSeconds,
            shownPercent,
            etaText,
            isImpassable: etaText === ETA_INFINITE_TEXT,
        });
    }

    function computeRoomClearChance(state, initClientData, room, maxEnhancementByItem, options = {}) {
        if (!room || room.roomType !== LABYRINTH_SKILLING_ROOM_TYPE || !room.skillHrid) {
            return null;
        }

        const skillId = skillHridToSkillId(room.skillHrid);
        if (!skillId) {
            return null;
        }

        const actionTypeHrid = skillIdToActionTypeHrid(skillId);
        const isEnhancingRoom = skillId === "enhancing";
        const crateSelection = getLabyrinthCrateSelection(state);
        const labyrinthUpgradeLevels = resolveLabyrinthUpgradeLevels(options);
        const teaCrateItemHrid = String(crateSelection?.teaCrateItemHrid || "");
        const crateBuffs = getCrateBuffs(initClientData, teaCrateItemHrid);
        const labyrinthUpgradeMetrics = buildLabyrinthUpgradeSkillingMetrics(labyrinthUpgradeLevels);
        const labyrinthExperienceBonus = getLabyrinthUpgradeExperienceBonus(labyrinthUpgradeLevels);
        const includePersonalBuffs = false;
        const { equipmentMetrics, globalMetrics } = getSkillingGlobalMetrics(state, skillId, actionTypeHrid, {
            includePersonalBuffs,
        });

        const fallbackMetrics = createEmptySkillingMetrics();
        addSkillingMetrics(fallbackMetrics, equipmentMetrics);

        const roomLoadout = getSkillingRoomLoadoutMetrics(
            state,
            initClientData,
            room,
            skillId,
            actionTypeHrid,
            maxEnhancementByItem,
            fallbackMetrics
        );
        const crateMetrics = getSkillingBuffMetrics(skillId, crateBuffs);
        const loanMetrics = createEmptySkillingMetrics();
        const combinedMetrics = createEmptySkillingMetrics();
        addSkillingMetrics(combinedMetrics, globalMetrics);
        addSkillingMetrics(combinedMetrics, roomLoadout.metrics);
        addSkillingMetrics(combinedMetrics, crateMetrics);
        addSkillingMetrics(combinedMetrics, labyrinthUpgradeMetrics);
        addSkillingMetrics(combinedMetrics, loanMetrics);

        const baseSkillLevel = getSkillLevel(state.characterSkillMap, room.skillHrid);
        const skillLevelBonus = combinedMetrics.skillLevelBonus;
        const efficiencyBonus = combinedMetrics.efficiencyBonus;
        const actionSpeedBonus = combinedMetrics.actionSpeedBonus;
        const successBonus = combinedMetrics.successBonus;
        const experienceBonusDetail = computeSkillingExperienceBonusForRoom(
            state,
            skillId,
            actionTypeHrid,
            roomLoadout.metrics,
            crateMetrics,
            loanMetrics,
            includePersonalBuffs,
            labyrinthExperienceBonus
        );
        const experienceBonus = finiteNumber(experienceBonusDetail?.totalBonus, 0);
        const crateDoubleProgressBonus = combinedMetrics.crateDoubleProgressBonus;
        const gatheringBonus = combinedMetrics.gatheringBonus;

        const effectiveSkillLevel = baseSkillLevel + skillLevelBonus;
        const roomLevel = Number(room.recommendedLevel || 0);
        const levelDelta = effectiveSkillLevel - roomLevel;
        const levelBonus = levelDelta >= 0 ? levelDelta * 0.005 : levelDelta * 0.01;
        const successChance = clamp01(0.8 * (1 + levelBonus + successBonus));
        const doubleChance = clamp01(crateDoubleProgressBonus + gatheringBonus);
        const rewardPreview = createRoomRewardPreview(state, room);

        const baseActionSeconds = isEnhancingRoom ? BASE_ENHANCING_ACTION_SECONDS : BASE_ACTION_SECONDS;
        const actionSeconds = baseActionSeconds / Math.max(0.05, 1 + actionSpeedBonus);
        const attempts = Math.max(1, Math.floor(ROOM_DURATION_SECONDS / actionSeconds));
        const baseExperiencePerRoom = Math.max(0, roomLevel * 50);
        const experienceMultiplier = Math.max(0, finiteNumber(experienceBonusDetail?.multiplier, 1));
        const experiencePerRoom = Math.max(0, baseExperiencePerRoom * experienceMultiplier);
        const experiencePerAction = attempts > 0 ? Math.max(0, experiencePerRoom / attempts) : experiencePerRoom;
        const speedDeltaForOneMoreAttempt = computeActionSpeedDeltaForOneMoreAttempt(baseActionSeconds, actionSpeedBonus, attempts);

        let progressPerSuccess = null;
        let workPower = null;
        let targetProgress = null;
        let targetEnhLevel = null;
        let clearStats = null;
        let preview = null;

        if (isEnhancingRoom) {
            targetEnhLevel = getEnhancingTargetLevelByRoomLevel(roomLevel);
            clearStats = computeEnhancingClearStats({
                attempts,
                successChance,
                doubleChance,
                targetLevel: targetEnhLevel,
                startLevel: 0,
            });
            const nextLevelDelta = effectiveSkillLevel + 1 - roomLevel;
            const nextLevelBonus = nextLevelDelta >= 0 ? nextLevelDelta * 0.005 : nextLevelDelta * 0.01;
            const nextLevelClearStats = computeEnhancingClearStats({
                attempts,
                successChance: clamp01(0.8 * (1 + nextLevelBonus + successBonus)),
                doubleChance,
                targetLevel: targetEnhLevel,
                startLevel: 0,
            });
            const speedTierClearStats = Number.isFinite(speedDeltaForOneMoreAttempt)
                ? computeEnhancingClearStats({
                      attempts: attempts + 1,
                      successChance,
                      doubleChance,
                      targetLevel: targetEnhLevel,
                      startLevel: 0,
                  })
                : null;
            const skillingSuccessUpgradeLevel = getLabyrinthUpgradeLevel(
                labyrinthUpgradeLevels,
                LABYRINTH_UPGRADE_KEY_SKILLING_SUCCESS
            );
            const nextSkillingSuccessClearStats =
                skillingSuccessUpgradeLevel < LABYRINTH_SKILLING_UPGRADE_MAX_LEVEL
                    ? computeEnhancingClearStats({
                          attempts,
                          successChance: clamp01(
                              0.8 * (1 + levelBonus + successBonus + LABYRINTH_UPGRADE_SKILLING_SUCCESS_STEP_RATIO)
                          ),
                          doubleChance,
                          targetLevel: targetEnhLevel,
                          startLevel: 0,
                      })
                    : null;
            const skillingDoubleProgressUpgradeLevel = getLabyrinthUpgradeLevel(
                labyrinthUpgradeLevels,
                LABYRINTH_UPGRADE_KEY_SKILLING_DOUBLE_PROGRESS
            );
            const nextSkillingDoubleProgressClearStats =
                skillingDoubleProgressUpgradeLevel < LABYRINTH_SKILLING_UPGRADE_MAX_LEVEL
                    ? computeEnhancingClearStats({
                          attempts,
                          successChance,
                          doubleChance: clamp01(doubleChance + LABYRINTH_UPGRADE_STEP_RATIO),
                          targetLevel: targetEnhLevel,
                          startLevel: 0,
                      })
                    : null;
            preview = {
                type: "enhancing",
                targetLevel: targetEnhLevel,
                successChance,
                doubleChance,
                attempts,
                actionSeconds,
                speedDeltaForOneMoreAttempt,
                speedTierClearChance:
                    speedTierClearStats === null ? null : clamp01(finiteNumber(speedTierClearStats.clearChance, 0)),
                nextLevelClearChance: clamp01(finiteNumber(nextLevelClearStats.clearChance, 0)),
                nextSkillingSuccessClearChance:
                    nextSkillingSuccessClearStats === null
                        ? null
                        : clamp01(finiteNumber(nextSkillingSuccessClearStats.clearChance, 0)),
                nextSkillingDoubleProgressClearChance:
                    nextSkillingDoubleProgressClearStats === null
                        ? null
                        : clamp01(finiteNumber(nextSkillingDoubleProgressClearStats.clearChance, 0)),
                experiencePerAction,
                experiencePerRoom,
                experiencePerHour: 0,
                rewardPreview,
            };
        } else {
            workPower = Math.max(0, effectiveSkillLevel * (1 + efficiencyBonus));
            progressPerSuccess = getEffectiveSkillingProgressPerSuccess(workPower);
            targetProgress = roomLevel * 10;
            const neededUnits = progressPerSuccess > 0 ? Math.ceil(targetProgress / progressPerSuccess - 1e-9) : 0;
            const efficiencyDeltaForOneLessProgressUnit = computeEfficiencyDeltaForOneLessProgressUnit(
                targetProgress,
                effectiveSkillLevel,
                efficiencyBonus,
                neededUnits
            );
            clearStats = computeNonEnhancingClearStats({
                attempts,
                successChance,
                doubleChance,
                progressPerSuccess,
                targetProgress,
            });
            const nextLevelEffectiveSkillLevel = effectiveSkillLevel + 1;
            const nextLevelDelta = nextLevelEffectiveSkillLevel - roomLevel;
            const nextLevelBonus = nextLevelDelta >= 0 ? nextLevelDelta * 0.005 : nextLevelDelta * 0.01;
            const nextLevelSuccessChance = clamp01(0.8 * (1 + nextLevelBonus + successBonus));
            const nextLevelClearStats = computeNonEnhancingClearStats({
                attempts,
                successChance: nextLevelSuccessChance,
                doubleChance,
                progressPerSuccess: getEffectiveSkillingProgressPerSuccess(
                    nextLevelEffectiveSkillLevel * (1 + efficiencyBonus)
                ),
                targetProgress,
            });
            const efficiencyTierClearStats =
                efficiencyDeltaForOneLessProgressUnit === null
                    ? null
                    : computeNonEnhancingClearStats({
                          attempts,
                          successChance,
                          doubleChance,
                          progressPerSuccess: computeProgressPerSuccessForOneLessProgressUnit(targetProgress, neededUnits),
                          targetProgress,
                      });
            const speedTierClearStats = Number.isFinite(speedDeltaForOneMoreAttempt)
                ? computeNonEnhancingClearStats({
                      attempts: attempts + 1,
                      successChance,
                      doubleChance,
                      progressPerSuccess,
                      targetProgress,
                  })
                : null;
            const skillingSuccessUpgradeLevel = getLabyrinthUpgradeLevel(
                labyrinthUpgradeLevels,
                LABYRINTH_UPGRADE_KEY_SKILLING_SUCCESS
            );
            const nextSkillingSuccessClearStats =
                skillingSuccessUpgradeLevel < LABYRINTH_SKILLING_UPGRADE_MAX_LEVEL
                    ? computeNonEnhancingClearStats({
                          attempts,
                          successChance: clamp01(
                              0.8 * (1 + levelBonus + successBonus + LABYRINTH_UPGRADE_SKILLING_SUCCESS_STEP_RATIO)
                          ),
                          doubleChance,
                          progressPerSuccess,
                          targetProgress,
                      })
                    : null;
            const skillingDoubleProgressUpgradeLevel = getLabyrinthUpgradeLevel(
                labyrinthUpgradeLevels,
                LABYRINTH_UPGRADE_KEY_SKILLING_DOUBLE_PROGRESS
            );
            const nextSkillingDoubleProgressClearStats =
                skillingDoubleProgressUpgradeLevel < LABYRINTH_SKILLING_UPGRADE_MAX_LEVEL
                    ? computeNonEnhancingClearStats({
                          attempts,
                          successChance,
                          doubleChance: clamp01(doubleChance + LABYRINTH_UPGRADE_STEP_RATIO),
                          progressPerSuccess,
                          targetProgress,
                      })
                    : null;
            preview = {
                type: "skilling",
                workPower,
                effectiveProgressPerSuccess: progressPerSuccess,
                successChance,
                doubleChance,
                attempts,
                actionSeconds,
                efficiencyDeltaForOneLessProgressUnit,
                efficiencyTierProgressPerSuccess: computeProgressPerSuccessForOneLessProgressUnit(targetProgress, neededUnits),
                speedDeltaForOneMoreAttempt,
                nextLevelClearChance: clamp01(finiteNumber(nextLevelClearStats.clearChance, 0)),
                efficiencyTierClearChance:
                    efficiencyTierClearStats === null ? null : clamp01(finiteNumber(efficiencyTierClearStats.clearChance, 0)),
                speedTierClearChance:
                    speedTierClearStats === null ? null : clamp01(finiteNumber(speedTierClearStats.clearChance, 0)),
                nextSkillingSuccessClearChance:
                    nextSkillingSuccessClearStats === null
                        ? null
                        : clamp01(finiteNumber(nextSkillingSuccessClearStats.clearChance, 0)),
                nextSkillingDoubleProgressClearChance:
                    nextSkillingDoubleProgressClearStats === null
                        ? null
                        : clamp01(finiteNumber(nextSkillingDoubleProgressClearStats.clearChance, 0)),
                experiencePerAction,
                experiencePerRoom,
                experiencePerHour: 0,
                rewardPreview,
            };
        }
        const clearChance = clearStats.clearChance;
        const expectedSecondsOnSuccessfulRun = Number.isFinite(clearStats.expectedAttemptsOnClear)
            ? clearStats.expectedAttemptsOnClear * actionSeconds
            : null;
        const expectedSecondsPerClear =
            clearChance > 0 && Number.isFinite(expectedSecondsOnSuccessfulRun)
                ? (clearChance * expectedSecondsOnSuccessfulRun + (1 - clearChance) * ROOM_DURATION_SECONDS) / clearChance
                : Infinity;
        const expectedSecondsPerClearForExpPerHour =
            clearChance > 0 && Number.isFinite(expectedSecondsOnSuccessfulRun)
                ? (clearChance * (expectedSecondsOnSuccessfulRun + ROOM_ENTRY_SECONDS) +
                      (1 - clearChance) * (ROOM_DURATION_SECONDS + ROOM_ENTRY_SECONDS)) /
                  clearChance
                : Infinity;
        const experiencePerHour =
            Number.isFinite(expectedSecondsPerClearForExpPerHour) && expectedSecondsPerClearForExpPerHour > 0
                ? Math.max(0, experiencePerRoom * (3600 / expectedSecondsPerClearForExpPerHour))
                : 0;
        if (preview && typeof preview === "object") {
            preview.experiencePerHour = experiencePerHour;
        }

        return {
            clearChance,
            expectedSecondsPerClear,
            skillingPreview: preview,
            debug: [
                `skill=${skillId}`,
                `loadout=${roomLoadout.loadoutInfo.loadout?.name || roomLoadout.loadoutInfo.loadoutId || "current"}`,
                `mode=${roomLoadout.mode}`,
                `base=${baseSkillLevel.toFixed(2)}`,
                `skill+${skillLevelBonus.toFixed(2)}`,
                `globalSkill+${globalMetrics.skillLevelBonus.toFixed(2)}`,
                `lvlBonus=${(levelBonus * 100).toFixed(1)}%`,
                `eff+${(efficiencyBonus * 100).toFixed(1)}%`,
                `globalEff+${(globalMetrics.efficiencyBonus * 100).toFixed(1)}%`,
                labyrinthUpgradeMetrics.actionSpeedBonus > 0 ? `labAct+${(labyrinthUpgradeMetrics.actionSpeedBonus * 100).toFixed(1)}%` : "",
                labyrinthUpgradeMetrics.efficiencyBonus > 0 ? `labEff+${(labyrinthUpgradeMetrics.efficiencyBonus * 100).toFixed(1)}%` : "",
                labyrinthUpgradeMetrics.successBonus > 0 ? `labSuccess+${(labyrinthUpgradeMetrics.successBonus * 100).toFixed(1)}%` : "",
                labyrinthUpgradeMetrics.crateDoubleProgressBonus > 0
                    ? `labDouble+${(labyrinthUpgradeMetrics.crateDoubleProgressBonus * 100).toFixed(1)}%`
                    : "",
                `exp+${(experienceBonus * 100).toFixed(1)}%`,
                `exp(wisdom)=${(finiteNumber(experienceBonusDetail?.genericBonus, 0) * 100).toFixed(1)}%`,
                `exp(skilling)=${(finiteNumber(experienceBonusDetail?.skillingBonus, 0) * 100).toFixed(1)}%`,
                `exp(skill)=${(finiteNumber(experienceBonusDetail?.skillBonus, 0) * 100).toFixed(1)}%`,
                labyrinthExperienceBonus > 0 ? `labExp+${(labyrinthExperienceBonus * 100).toFixed(1)}%` : "",
                `success=${(successChance * 100).toFixed(1)}%`,
                `globalSuccess+${(globalMetrics.successBonus * 100).toFixed(1)}%`,
                `double=${(doubleChance * 100).toFixed(1)}%`,
                hasMeaningfulSkillingMetrics(loanMetrics) ? "loan=1" : "",
                isEnhancingRoom ? `target=+${targetEnhLevel}` : `target=${Math.round(targetProgress)}`,
                isEnhancingRoom
                    ? ""
                    : `work=${workPower.toFixed(2)}${Math.abs(workPower - progressPerSuccess) > 1e-9 ? `->${progressPerSuccess}` : ""}`,
                `attempts=${attempts}`,
                `eta=${formatEtaText(expectedSecondsPerClear, Math.round(clearChance * 100))}`,
            ]
                .filter(Boolean)
                .join(" | "),
        };
    }

    function toPascalCase(text) {
        return String(text || "")
            .split("_")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join("");
    }

    function getLabyrinthRoomLoadoutSettingKey(room) {
        if (!room) {
            return "";
        }
        if (room.roomType === LABYRINTH_SKILLING_ROOM_TYPE && room.skillHrid) {
            const suffix = toPascalCase(skillHridToSkillId(room.skillHrid));
            return suffix ? `labyrinthLoadout${suffix}` : "";
        }
        if (room.roomType === LABYRINTH_COMBAT_ROOM_TYPE && room.monsterHrid) {
            const monsterTail = String(room.monsterHrid).split("/").pop() || "";
            const suffix = toPascalCase(monsterTail);
            return suffix ? `labyrinthLoadout${suffix}` : "";
        }
        return "";
    }

    function getLoadoutById(loadoutDict, loadoutId) {
        if (!loadoutDict || !Number.isFinite(Number(loadoutId))) {
            return null;
        }
        const numericId = Number(loadoutId);
        if (loadoutDict[numericId]) {
            return loadoutDict[numericId];
        }
        if (loadoutDict[String(numericId)]) {
            return loadoutDict[String(numericId)];
        }
        for (const value of Object.values(loadoutDict)) {
            if (Number(value?.id) === numericId) {
                return value;
            }
        }
        return null;
    }

    function getLabyrinthRoomLoadout(state, room) {
        const settingKey = getLabyrinthRoomLoadoutSettingKey(room);
        const loadoutId = Number(state?.characterSetting?.[settingKey] || 0);
        const loadout = getLoadoutById(state?.characterLoadoutDict, loadoutId);
        return {
            settingKey,
            loadoutId,
            loadout,
        };
    }

    function isCombatLoadout(loadout) {
        return Boolean(loadout && loadout.actionTypeHrid === "/action_types/combat");
    }

    function listCombatLoadouts(state) {
        const loadouts = [];
        for (const value of Object.values(state?.characterLoadoutDict || {})) {
            if (isCombatLoadout(value)) {
                loadouts.push(value);
            }
        }
        loadouts.sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
        return loadouts;
    }

    function getMostUsedCombatLoadoutIdOnCurrentLabyrinth(state) {
        const roomData = state?.characterLabyrinth?.roomData;
        if (!Array.isArray(roomData) || roomData.length === 0) {
            return 0;
        }
        const countByLoadoutId = new Map();
        for (const row of roomData) {
            if (!Array.isArray(row)) {
                continue;
            }
            for (const room of row) {
                if (!room || room.roomType !== LABYRINTH_COMBAT_ROOM_TYPE) {
                    continue;
                }
                const key = getLabyrinthRoomLoadoutSettingKey(room);
                const id = Number(state?.characterSetting?.[key] || 0);
                if (!Number.isFinite(id) || id <= 0) {
                    continue;
                }
                const loadout = getLoadoutById(state?.characterLoadoutDict, id);
                if (!isCombatLoadout(loadout)) {
                    continue;
                }
                countByLoadoutId.set(id, (countByLoadoutId.get(id) || 0) + 1);
            }
        }
        let bestId = 0;
        let bestCount = 0;
        for (const [id, count] of countByLoadoutId.entries()) {
            if (count > bestCount || (count === bestCount && id < bestId)) {
                bestId = id;
                bestCount = count;
            }
        }
        return bestId;
    }

    function resolveCombatRoomLoadout(state, room) {
        const direct = getLabyrinthRoomLoadout(state, room);
        const selectedLoadoutId = Number(direct.loadoutId || 0);
        if (isCombatLoadout(direct.loadout) && selectedLoadoutId > 0) {
            return {
                ...direct,
                source: "room",
                selectedLoadoutId,
            };
        }

        const fallbackIdOnFloor = getMostUsedCombatLoadoutIdOnCurrentLabyrinth(state);
        if (fallbackIdOnFloor > 0) {
            const fallbackLoadout = getLoadoutById(state?.characterLoadoutDict, fallbackIdOnFloor);
            if (isCombatLoadout(fallbackLoadout)) {
                return {
                    ...direct,
                    loadoutId: fallbackIdOnFloor,
                    loadout: fallbackLoadout,
                    source: "fallback-floor",
                    selectedLoadoutId,
                };
            }
        }

        const combatLoadouts = listCombatLoadouts(state);
        if (combatLoadouts.length > 0) {
            const fallbackLoadout = combatLoadouts[0];
            return {
                ...direct,
                loadoutId: Number(fallbackLoadout.id || 0),
                loadout: fallbackLoadout,
                source: "fallback-any",
                selectedLoadoutId,
            };
        }

        return {
            ...direct,
            loadout: null,
            source: "missing",
            selectedLoadoutId,
        };
    }

    function getItemDetailByHrid(state, initClientData, itemHrid) {
        if (!itemHrid) {
            return null;
        }
        const fromState = state?.itemDetailDict?.[itemHrid];
        if (fromState) {
            return fromState;
        }
        return initClientData?.itemDetailMap?.[itemHrid] || null;
    }

    function getAbilityDetailByHrid(state, initClientData, abilityHrid) {
        if (!abilityHrid) {
            return null;
        }
        const fromState = getContainerValue(state?.abilityDetailDict, abilityHrid);
        if (fromState) {
            return fromState;
        }
        return getContainerValue(initClientData?.abilityDetailMap, abilityHrid) || null;
    }

    function getAbilityLevelFromState(state, abilityHrid) {
        if (!abilityHrid) {
            return 1;
        }
        const ability = getContainerValue(state?.characterAbilityMap, abilityHrid);
        return positiveNumber(ability?.level, 1);
    }

    function getCombatTriggerList(triggerMap, triggerKey) {
        const value = getContainerValue(triggerMap, triggerKey);
        if (!Array.isArray(value)) {
            return null;
        }
        return normalizeTriggerList(value);
    }

    function hasContainerKey(container, key) {
        const normalizedKey = String(key || "");
        if (!normalizedKey) {
            return false;
        }
        if (container instanceof Map) {
            return container.has(normalizedKey);
        }
        if (container && typeof container === "object") {
            return Object.prototype.hasOwnProperty.call(container, normalizedKey);
        }
        return false;
    }

    function hasAnyContainerEntries(container) {
        if (container instanceof Map) {
            return container.size > 0;
        }
        if (container && typeof container === "object") {
            return Object.keys(container).length > 0;
        }
        return false;
    }

    function getDefaultAbilityTriggers(state, initClientData, abilityHrid) {
        const detail = getAbilityDetailByHrid(state, initClientData, abilityHrid);
        return normalizeTriggerList(detail?.defaultCombatTriggers);
    }

    function buildHouseRoomLevelMap(state) {
        const result = {};
        for (const [roomHrid, room] of getContainerEntries(state?.characterHouseRoomDict)) {
            if (!roomHrid) {
                continue;
            }
            result[roomHrid] = Math.max(0, Math.floor(finiteNumber(room?.level, 0)));
        }
        return result;
    }

    function buildAchievementCompletionMap(state) {
        const result = {};
        for (const [achievementHrid, info] of getContainerEntries(state?.characterAchievementMap)) {
            if (!achievementHrid) {
                continue;
            }
            const completed = info === true || info?.isCompleted === true;
            if (completed) {
                result[achievementHrid] = true;
            }
        }
        return result;
    }

    function isTaskBadgeItemHrid(itemHrid) {
        const tail = String(itemHrid || "").split("/").pop() || "";
        return tail.includes("task_badge");
    }

    function isSupportedCombatEquipmentType(equipmentType) {
        const typeHrid = String(equipmentType || "");
        return typeHrid ? SIMULATOR_SUPPORTED_EQUIPMENT_TYPES.has(typeHrid) : false;
    }

    function shouldIncludeCombatEquipment(itemHrid, equipmentType) {
        if (!isSupportedCombatEquipmentType(equipmentType)) {
            return false;
        }
        if (isTaskBadgeItemHrid(itemHrid)) {
            return false;
        }
        return true;
    }

    function buildCombatLoadoutEquipmentDto(state, initClientData, loadout, maxEnhancementByItem) {
        const equipment = {};
        for (const rawRef of Object.values(loadout?.wearableMap || {})) {
            const entry = parseWearableReference(rawRef);
            if (!entry?.itemHrid) {
                continue;
            }
            const itemDetail = getItemDetailByHrid(state, initClientData, entry.itemHrid);
            const equipmentType = itemDetail?.equipmentDetail?.type;
            if (!shouldIncludeCombatEquipment(entry.itemHrid, equipmentType)) {
                continue;
            }
            const enhancementLevel = Math.max(0, Math.floor(resolveWearableEnhancement(entry, loadout, maxEnhancementByItem)));
            equipment[equipmentType] = {
                hrid: entry.itemHrid,
                enhancementLevel,
            };
        }
        return equipment;
    }

    function buildCombatLoadoutAbilityDtos(state, initClientData, loadout, intelligenceLevel) {
        const abilityDtos = [];
        const requirementList = Array.isArray(state?.abilitySlotsLevelRequirementList)
            ? state.abilitySlotsLevelRequirementList
            : [0, 1, 1, 20, 50, 90];
        const loadoutAbilityMap = loadout?.abilityMap || {};
        const loadoutTriggerMap = loadout?.abilityCombatTriggersMap;
        const globalTriggerMap = state?.abilityCombatTriggersDict;
        const loadoutHasTriggerConfig = hasAnyContainerEntries(loadoutTriggerMap);

        for (let slot = 1; slot <= COMBAT_SLOT_COUNT; slot += 1) {
            const abilityHrid = String(loadoutAbilityMap[slot] || loadoutAbilityMap[String(slot)] || "");
            if (!abilityHrid) {
                abilityDtos.push(null);
                continue;
            }

            const minIntelligence = Math.max(0, Math.floor(finiteNumber(requirementList[slot], 0)));
            if (intelligenceLevel < minIntelligence) {
                abilityDtos.push(null);
                continue;
            }

            let abilityTriggers = null;
            if (loadoutHasTriggerConfig) {
                if (hasContainerKey(loadoutTriggerMap, abilityHrid)) {
                    const explicitLoadoutTriggers = getCombatTriggerList(loadoutTriggerMap, abilityHrid);
                    abilityTriggers = Array.isArray(explicitLoadoutTriggers) ? explicitLoadoutTriggers : [];
                } else {
                    // When a loadout has its own trigger config, missing ability key means intentionally empty.
                    abilityTriggers = [];
                }
            } else {
                abilityTriggers =
                    getCombatTriggerList(globalTriggerMap, abilityHrid) ||
                    getDefaultAbilityTriggers(state, initClientData, abilityHrid);
            }

            abilityDtos.push({
                hrid: abilityHrid,
                level: getAbilityLevelFromState(state, abilityHrid),
                triggers: abilityTriggers,
            });
        }
        return abilityDtos;
    }

    function buildCombatPlayerDtoForRoom(state, initClientData, room, maxEnhancementByItem) {
        const loadoutInfo = resolveCombatRoomLoadout(state, room);
        const loadout = loadoutInfo.loadout;
        if (!isCombatLoadout(loadout)) {
            return {
                playerDto: null,
                loadoutInfo,
            };
        }

        const levels = getCombatSkillLevelsFromState(state);
        const intelligenceLevel = positiveNumber(levels.intelligence, 1);
        const equipment = buildCombatLoadoutEquipmentDto(state, initClientData, loadout, maxEnhancementByItem);
        const abilities = buildCombatLoadoutAbilityDtos(state, initClientData, loadout, intelligenceLevel);
        const houseRooms = buildHouseRoomLevelMap(state);
        const achievements = buildAchievementCompletionMap(state);

        const playerDto = {
            hrid: "player1",
            staminaLevel: positiveNumber(levels.stamina, 1),
            intelligenceLevel,
            attackLevel: positiveNumber(levels.attack, 1),
            meleeLevel: positiveNumber(levels.melee, 1),
            defenseLevel: positiveNumber(levels.defense, 1),
            rangedLevel: positiveNumber(levels.ranged, 1),
            magicLevel: positiveNumber(levels.magic, 1),
            equipment,
            food: [],
            drinks: [],
            abilities,
            houseRooms,
            achievements,
            debuffOnLevelGap: 0,
        };

        return {
            playerDto,
            loadoutInfo,
        };
    }

    function buildCombatInputSnapshot(playerData, room) {
        const playerDto = playerData?.playerDto;
        const loadoutInfo = playerData?.loadoutInfo || {};
        const loadout = loadoutInfo.loadout || null;
        if (!playerDto) {
            return null;
        }

        const equipment = [];
        for (const [slot, detail] of Object.entries(playerDto.equipment || {})) {
            if (!detail?.hrid) {
                continue;
            }
            equipment.push({
                slot: String(slot),
                hrid: String(detail.hrid),
                enhancementLevel: Math.max(0, Math.floor(finiteNumber(detail.enhancementLevel, 0))),
            });
        }
        equipment.sort((a, b) => a.slot.localeCompare(b.slot));

        const abilitySlots = [];
        const abilityList = Array.isArray(playerDto.abilities) ? playerDto.abilities : [];
        for (let i = 0; i < abilityList.length; i += 1) {
            const ability = abilityList[i];
            if (!ability?.hrid) {
                continue;
            }
            abilitySlots.push({
                slot: i + 1,
                hrid: String(ability.hrid),
                level: Math.max(1, Math.floor(finiteNumber(ability.level, 1))),
            });
        }

        return {
            roomKey: "",
            roomMonsterHrid: String(room?.monsterHrid || ""),
            roomRecommendedLevel: Math.max(0, Math.floor(finiteNumber(room?.recommendedLevel, 0))),
            loadoutId: Number(loadoutInfo.loadoutId || 0),
            loadoutName: String(loadout?.name || ""),
            loadoutMode: loadout?.useExactEnhancement ? "exact" : "highest",
            loadoutSource: String(loadoutInfo.source || "room"),
            selectedLoadoutId: Number(loadoutInfo.selectedLoadoutId || loadoutInfo.loadoutId || 0),
            loadoutSettingKey: String(loadoutInfo.settingKey || ""),
            levels: {
                stamina: positiveNumber(playerDto.staminaLevel, 1),
                intelligence: positiveNumber(playerDto.intelligenceLevel, 1),
                attack: positiveNumber(playerDto.attackLevel, 1),
                melee: positiveNumber(playerDto.meleeLevel, 1),
                defense: positiveNumber(playerDto.defenseLevel, 1),
                ranged: positiveNumber(playerDto.rangedLevel, 1),
                magic: positiveNumber(playerDto.magicLevel, 1),
            },
            equipment,
            abilitySlots,
            houseRoomCount: Object.keys(playerDto.houseRooms || {}).length,
            achievementCount: Object.keys(playerDto.achievements || {}).length,
        };
    }

    function equipmentTypeToItemLocationHrid(equipmentTypeHrid) {
        const raw = String(equipmentTypeHrid || "");
        if (!raw.startsWith("/equipment_types/")) {
            return "";
        }
        return raw.replace("/equipment_types/", "/item_locations/");
    }

    function normalizeSimulatorImportConsumableSlots(entries, slotCount = 3) {
        const result = [];
        const source = Array.isArray(entries) ? entries : [];
        for (const entry of source) {
            const itemHrid = String(entry?.hrid || entry?.itemHrid || "");
            result.push({ itemHrid });
            if (result.length >= slotCount) {
                break;
            }
        }
        while (result.length < slotCount) {
            result.push({ itemHrid: "" });
        }
        return result;
    }

    function normalizeSimulatorImportAbilitySlots(entries, slotCount = 5) {
        const result = [];
        const source = Array.isArray(entries) ? entries : [];
        for (let i = 0; i < slotCount; i += 1) {
            const ability = source[i];
            const abilityHrid = String(ability?.hrid || ability?.abilityHrid || "");
            const level = Math.max(1, Math.floor(finiteNumber(ability?.level, 1)));
            result.push({
                abilityHrid,
                level: String(level),
            });
        }
        return result;
    }

    function buildSimulatorImportTriggerMap(playerDto, options = {}) {
        const includeConsumables = options?.includeConsumables !== false;
        const triggerMap = {};

        function include(entry) {
            const hrid = String(entry?.hrid || "");
            if (!hrid) {
                return;
            }
            const triggers = normalizeTriggerList(entry?.triggers || []);
            if (!triggers.length && options?.keepEmptyAbilityTriggers !== true) {
                return;
            }
            triggerMap[hrid] = deepCloneJson(triggers);
        }

        const foods = Array.isArray(playerDto?.food) ? playerDto.food : [];
        const drinks = Array.isArray(playerDto?.drinks) ? playerDto.drinks : [];
        const abilities = Array.isArray(playerDto?.abilities) ? playerDto.abilities : [];

        if (includeConsumables) {
            for (const entry of foods) {
                include(entry);
            }
            for (const entry of drinks) {
                include(entry);
            }
        }
        for (const entry of abilities) {
            include(entry);
        }

        return triggerMap;
    }

    function buildCombatZoneCandidatesByMonster(initClientData, monsterHrid) {
        const targetMonsterHrid = String(monsterHrid || "");
        if (!targetMonsterHrid) {
            return [];
        }
        const actionDetailMap = initClientData?.actionDetailMap;
        if (!actionDetailMap) {
            return [];
        }

        const candidateMap = new Map();

        function pushCandidate(actionHrid, actionDetail, difficultyTier, sourceTag, waveHint = 0) {
            const normalizedActionHrid = String(actionHrid || "");
            if (!normalizedActionHrid) {
                return;
            }
            const normalizedDifficultyTier = Math.max(0, Math.floor(finiteNumber(difficultyTier, 0)));
            const normalizedWaveHint = Math.max(0, Math.floor(finiteNumber(waveHint, 0)));
            const key = `${normalizedActionHrid}|${normalizedDifficultyTier}`;
            const current = candidateMap.get(key);
            if (!current) {
                candidateMap.set(key, {
                    actionHrid: normalizedActionHrid,
                    difficultyTier: normalizedDifficultyTier,
                    source: sourceTag,
                    sortIndex: finiteNumber(actionDetail?.sortIndex, Number.MAX_SAFE_INTEGER),
                    isDungeon: actionDetail?.combatZoneInfo?.isDungeon === true,
                    startWave:
                        normalizedWaveHint > 0 &&
                        (sourceTag === "dungeon-fixed" || sourceTag === "dungeon-random")
                            ? normalizedWaveHint
                            : 0,
                });
                return;
            }
            if (!current.startWave && normalizedWaveHint > 0) {
                current.startWave = normalizedWaveHint;
            } else if (current.startWave > 0 && normalizedWaveHint > 0) {
                current.startWave = Math.min(current.startWave, normalizedWaveHint);
            }
        }

        function collectFromSpawnList(actionHrid, actionDetail, spawnList, sourceTag, waveHint = 0) {
            for (const spawn of Array.isArray(spawnList) ? spawnList : []) {
                if (!spawn || String(spawn.combatMonsterHrid || "") !== targetMonsterHrid) {
                    continue;
                }
                pushCandidate(actionHrid, actionDetail, spawn.difficultyTier, sourceTag, waveHint);
            }
        }

        for (const [actionHrid, actionDetail] of getContainerEntries(actionDetailMap)) {
            if (!actionDetail || actionDetail.type !== "/action_types/combat") {
                continue;
            }
            const zoneInfo = actionDetail.combatZoneInfo;
            if (!zoneInfo) {
                continue;
            }

            const fightInfo = zoneInfo.fightInfo || {};
            collectFromSpawnList(actionHrid, actionDetail, fightInfo.bossSpawns, "boss");
            collectFromSpawnList(actionHrid, actionDetail, fightInfo?.randomSpawnInfo?.spawns, "random");

            const dungeonInfo = zoneInfo.dungeonInfo || {};
            for (const [waveKey, fixedSpawns] of Object.entries(dungeonInfo.fixedSpawnsMap || {})) {
                collectFromSpawnList(actionHrid, actionDetail, fixedSpawns, "dungeon-fixed", Number(waveKey));
            }
            for (const [waveKey, randomInfo] of Object.entries(dungeonInfo.randomSpawnInfoMap || {})) {
                collectFromSpawnList(
                    actionHrid,
                    actionDetail,
                    randomInfo?.spawns,
                    "dungeon-random",
                    Number(waveKey)
                );
            }
        }

        const candidates = Array.from(candidateMap.values());
        if (!candidates.length) {
            return [];
        }

        candidates.sort((a, b) => {
            if (a.isDungeon !== b.isDungeon) {
                return a.isDungeon ? -1 : 1;
            }
            if (a.sortIndex !== b.sortIndex) {
                return a.sortIndex - b.sortIndex;
            }
            if (a.difficultyTier !== b.difficultyTier) {
                return a.difficultyTier - b.difficultyTier;
            }
            return a.actionHrid.localeCompare(b.actionHrid);
        });
        return candidates;
    }

    function findSuggestedCombatZoneByMonster(initClientData, monsterHrid) {
        const candidates = buildCombatZoneCandidatesByMonster(initClientData, monsterHrid);
        return candidates.length ? candidates[0] : null;
    }

    function buildSimulatorImportSetFromPlayerDto(state, playerDto, defaultZoneHrid, simulationTime = "24") {
        const levels = {
            attackLevel: positiveNumber(playerDto?.attackLevel, 1),
            magicLevel: positiveNumber(playerDto?.magicLevel, 1),
            meleeLevel: positiveNumber(playerDto?.meleeLevel, 1),
            rangedLevel: positiveNumber(playerDto?.rangedLevel, 1),
            defenseLevel: positiveNumber(playerDto?.defenseLevel, 1),
            staminaLevel: positiveNumber(playerDto?.staminaLevel, 1),
            intelligenceLevel: positiveNumber(playerDto?.intelligenceLevel, 1),
        };

        const equipment = [];
        for (const [equipmentTypeHrid, entry] of Object.entries(playerDto?.equipment || {})) {
            const itemHrid = String(entry?.hrid || "");
            if (!itemHrid) {
                continue;
            }
            const itemLocationHrid = equipmentTypeToItemLocationHrid(equipmentTypeHrid);
            if (!itemLocationHrid) {
                continue;
            }
            equipment.push({
                itemLocationHrid,
                itemHrid,
                enhancementLevel: Math.max(0, Math.floor(finiteNumber(entry?.enhancementLevel, 0))),
            });
        }
        equipment.sort((a, b) => a.itemLocationHrid.localeCompare(b.itemLocationHrid));

        const food = normalizeSimulatorImportConsumableSlots(playerDto?.food, 3);
        const drinks = normalizeSimulatorImportConsumableSlots(playerDto?.drinks, 3);
        const abilities = normalizeSimulatorImportAbilitySlots(playerDto?.abilities, 5);
        const triggerMap = buildSimulatorImportTriggerMap(playerDto, {
            includeConsumables: false,
            keepEmptyAbilityTriggers: true,
        });

        return {
            player: {
                ...levels,
                equipment,
            },
            food: {
                "/action_types/combat": food,
            },
            drinks: {
                "/action_types/combat": drinks,
            },
            abilities,
            triggerMap,
            zone: String(defaultZoneHrid || "/actions/combat/fly"),
            simulationTime: String(simulationTime || "24"),
            houseRooms: buildHouseRoomLevelMap(state),
            achievements: buildAchievementCompletionMap(state),
        };
    }

    function buildEmptySimulatorImportConsumableSlots(slotCount = 3) {
        const result = [];
        for (let i = 0; i < slotCount; i += 1) {
            result.push({ itemHrid: "" });
        }
        return result;
    }

    function stripConsumablesFromSimulatorImportSet(importSet) {
        if (!importSet || typeof importSet !== "object") {
            return importSet;
        }
        const sanitizedTriggerMap = {};
        for (const [key, value] of Object.entries(importSet.triggerMap || {})) {
            const hrid = String(key || "");
            if (!hrid.startsWith("/abilities/")) {
                continue;
            }
            sanitizedTriggerMap[hrid] = deepCloneJson(value);
        }
        return {
            ...importSet,
            food: {
                "/action_types/combat": buildEmptySimulatorImportConsumableSlots(3),
            },
            drinks: {
                "/action_types/combat": buildEmptySimulatorImportConsumableSlots(3),
            },
            triggerMap: sanitizedTriggerMap,
        };
    }

    function buildFallbackSimulatorImportSetFromState(state, defaultZoneHrid, simulationTime = "24") {
        const levels = getCombatSkillLevelsFromState(state);
        const fallbackDto = {
            attackLevel: positiveNumber(levels.attack, 1),
            magicLevel: positiveNumber(levels.magic, 1),
            meleeLevel: positiveNumber(levels.melee, 1),
            rangedLevel: positiveNumber(levels.ranged, 1),
            defenseLevel: positiveNumber(levels.defense, 1),
            staminaLevel: positiveNumber(levels.stamina, 1),
            intelligenceLevel: positiveNumber(levels.intelligence, 1),
            equipment: {},
            food: [],
            drinks: [],
            abilities: [],
        };
        return buildSimulatorImportSetFromPlayerDto(state, fallbackDto, defaultZoneHrid, simulationTime);
    }

    function buildCombatRoomSimulatorBridgePayload(state, initClientData, room, maxEnhancementByItem) {
        if (!room || room.roomType !== LABYRINTH_COMBAT_ROOM_TYPE || !room.monsterHrid) {
            return null;
        }
        const roomLevel = Math.max(1, Math.floor(positiveNumber(room?.recommendedLevel, 1)));
        const zoneCandidates = buildCombatZoneCandidatesByMonster(initClientData, room.monsterHrid);
        const zoneSuggestion = zoneCandidates.length ? zoneCandidates[0] : null;
        const suggestedZoneHrid = String(zoneSuggestion?.actionHrid || "/actions/combat/fly");
        const suggestedDifficultyTier = Math.max(0, Math.floor(finiteNumber(zoneSuggestion?.difficultyTier, 0)));
        const suggestedStartWave = Math.max(0, Math.floor(finiteNumber(zoneSuggestion?.startWave, 0)));
        const loadoutInfo = resolveCombatRoomLoadout(state, room);
        const combatCrate = getCombatCrateBuffs(state, initClientData);
        const combatCrateItemHrids = Array.isArray(combatCrate?.combatCrateItemHrids) ? combatCrate.combatCrateItemHrids : [];
        const coffeeCrateItemHrid = String(
            combatCrate?.coffeeCrateItemHrid ||
                combatCrateItemHrids.find((itemHrid) => String(itemHrid || "").includes("coffee_crate")) ||
                ""
        );
        const foodCrateItemHrid = String(
            combatCrate?.foodCrateItemHrid ||
                combatCrateItemHrids.find((itemHrid) => String(itemHrid || "").includes("food_crate")) ||
                ""
        );
        const teaCrateItemHrid = String(combatCrate?.teaCrateItemHrid || "");
        const playerData = buildCombatPlayerDtoForRoom(state, initClientData, room, maxEnhancementByItem);
        const importSetRaw = playerData?.playerDto
            ? buildSimulatorImportSetFromPlayerDto(state, playerData.playerDto, suggestedZoneHrid, "24")
            : buildFallbackSimulatorImportSetFromState(state, suggestedZoneHrid, "24");
        const importSet = stripConsumablesFromSimulatorImportSet(importSetRaw);
        const simulatorPersonalBuffItemHrids = getSimulatorPersonalBuffItemHrids(state);

        return {
            source: SIMULATOR_BRIDGE_SOURCE,
            version: SIMULATOR_BRIDGE_VERSION,
            generatedAt: new Date().toISOString(),
            uiLanguage: getUiLanguage(),
            monsterHrid: String(room.monsterHrid),
            roomLevel,
            mazeDifficulty: roomLevel,
            suggestedZoneHrid,
            suggestedDifficultyTier,
            suggestedIsDungeon: zoneSuggestion?.isDungeon === true,
            suggestedStartWave,
            zoneCandidates: zoneCandidates.slice(0, 32).map((candidate) => ({
                zoneHrid: String(candidate?.actionHrid || ""),
                difficultyTier: Math.max(0, Math.floor(finiteNumber(candidate?.difficultyTier, 0))),
                isDungeon: candidate?.isDungeon === true,
                startWave: Math.max(0, Math.floor(finiteNumber(candidate?.startWave, 0))),
            })),
            loadoutSource: String(loadoutInfo?.source || "unknown"),
            loadoutId: Number(loadoutInfo?.loadoutId || 0),
            selectedLoadoutId: Number(loadoutInfo?.selectedLoadoutId || loadoutInfo?.loadoutId || 0),
            teaCrateItemHrid,
            coffeeCrateItemHrid,
            foodCrateItemHrid,
            importSet,
            simulatorPersonalBuffItemHrids,
        };
    }

    function getRoomFromCell(state, cell) {
        const roomKey = getRoomKeyFromCell(cell);
        const point = parseRoomKey(roomKey);
        const roomRows = state?.characterLabyrinth?.roomData;
        if (!point || !Array.isArray(roomRows) || !Array.isArray(roomRows[point.y])) {
            return null;
        }
        return roomRows[point.y][point.x] || null;
    }

    function openCombatRoomSimulatorFromCell(cell) {
        const state = getGameState();
        const initClientData = getInitClientData();
        if (!state || !initClientData) {
            window.alert(t("readGameDataFailed"));
            return;
        }
        const room = getRoomFromCell(state, cell);
        if (!room || room.roomType !== LABYRINTH_COMBAT_ROOM_TYPE || !room.monsterHrid) {
            window.alert(t("exportableCombatRoomNotFound"));
            return;
        }
        const maxEnhancementByItem = buildMaxEnhancementByItem(state);
        const payload = buildCombatRoomSimulatorBridgePayload(state, initClientData, room, maxEnhancementByItem);
        if (!payload?.importSet) {
            window.alert(t("simulatorExportNoLoadout"));
            return;
        }
        const launchUrl = buildSimulatorBridgeLaunchUrl(payload);
        window.open(launchUrl, "_blank", "noopener,noreferrer");
    }

    function getAutomationCombatRoomFromCell(cell, state, initClientData) {
        if (!cell || !state || !initClientData) {
            return null;
        }
        const roomTypeKey = String(cell.getAttribute("data-mwi-auto-room-key") || "");
        if (!roomTypeKey) {
            return null;
        }
        const panelInstance = getLabyrinthPanelInstance();
        const entry = getAutomationRoomTypeEntryByKey(roomTypeKey, panelInstance);
        if (!entry || !entry.isCombat || !entry.monsterHrid) {
            return null;
        }

        let roomLevel = NaN;
        const recommend = getAutomationRecommendFromCell(cell);
        if (recommend?.status === "ready" && recommend?.isCombat) {
            roomLevel = Math.floor(finiteNumber(recommend.roomLevel, NaN));
        }
        const estimate = getAutomationEstimateFromCell(cell);
        if (!Number.isFinite(roomLevel) && estimate?.status === "ready" && estimate?.isCombat) {
            roomLevel = Math.floor(finiteNumber(estimate.roomLevel, NaN));
        }

        if (!Number.isFinite(roomLevel)) {
            const entries = getAutomationRoomTypeEntries(panelInstance);
            const skipThresholdOverrides = buildAutomationSkipThresholdOverrideMap(entries);
            const skipThreshold = resolveAutomationSkipThreshold(panelInstance, entry.key, state, skipThresholdOverrides);
            const effectiveLevel = resolveAutomationEffectiveLevel(panelInstance, entry, state, initClientData, {
                includePersonalBuffs: false,
            });
            roomLevel = computeAutomationTargetRoomLevel(effectiveLevel, skipThreshold);
        }

        if (!Number.isFinite(roomLevel) || roomLevel < 1) {
            return {
                skipped: true,
            };
        }

        return {
            room: createAutomationRoomFromEntry(entry, roomLevel),
        };
    }

    function openCombatRoomSimulatorFromAutomationCell(cell) {
        const state = getGameState();
        const initClientData = getInitClientData();
        if (!state || !initClientData) {
            window.alert(t("readGameDataFailed"));
            return;
        }
        const resolved = getAutomationCombatRoomFromCell(cell, state, initClientData);
        if (!resolved) {
            window.alert(t("exportableCombatRoomNotFound"));
            return;
        }
        if (resolved.skipped) {
            window.alert(t("skippedCannotExport"));
            return;
        }
        const room = resolved.room;
        if (!room || room.roomType !== LABYRINTH_COMBAT_ROOM_TYPE || !room.monsterHrid) {
            window.alert(t("exportableCombatRoomNotFound"));
            return;
        }
        const maxEnhancementByItem = buildMaxEnhancementByItem(state);
        const payload = buildCombatRoomSimulatorBridgePayload(state, initClientData, room, maxEnhancementByItem);
        if (!payload?.importSet) {
            window.alert(t("simulatorExportNoLoadout"));
            return;
        }
        const launchUrl = buildSimulatorBridgeLaunchUrl(payload);
        window.open(launchUrl, "_blank", "noopener,noreferrer");
    }

    function parseWearableReference(rawValue) {
        if (!rawValue) {
            return null;
        }
        const parts = String(rawValue).split("::");
        if (parts.length < 4) {
            return null;
        }
        return {
            itemHrid: parts[2] || "",
            enhancementLevel: finiteNumber(Number(parts[3]), 0),
        };
    }

    function buildMaxEnhancementByItem(state) {
        const maxByItem = new Map();
        const itemMap = state?.characterItemMap;

        function consume(item) {
            if (!item || !item.itemHrid) {
                return;
            }
            if (!Number.isFinite(Number(item.count)) || Number(item.count) <= 0) {
                return;
            }
            const itemHrid = item.itemHrid;
            const enhancement = Math.max(0, finiteNumber(item.enhancementLevel, 0));
            const existing = maxByItem.get(itemHrid);
            if (!Number.isFinite(existing) || enhancement > existing) {
                maxByItem.set(itemHrid, enhancement);
            }
        }

        if (itemMap instanceof Map) {
            for (const item of itemMap.values()) {
                consume(item);
            }
        } else if (itemMap && typeof itemMap === "object") {
            for (const item of Object.values(itemMap)) {
                consume(item);
            }
        }

        return maxByItem;
    }

    function resolveWearableEnhancement(entry, loadout, maxEnhancementByItem) {
        if (!entry) {
            return 0;
        }
        if (entry.fromCurrentEquipment) {
            return Math.max(0, finiteNumber(entry.enhancementLevel, 0));
        }
        if (loadout?.useExactEnhancement) {
            return Math.max(0, finiteNumber(entry.enhancementLevel, 0));
        }
        const highest = maxEnhancementByItem.get(entry.itemHrid);
        if (Number.isFinite(highest)) {
            return Math.max(0, highest);
        }
        return Math.max(0, finiteNumber(entry.enhancementLevel, 0));
    }

    function getCurrentEquippedItemForLocation(state, itemLocationHrid) {
        const location = String(itemLocationHrid || "");
        if (!location) {
            return null;
        }
        const locationMap = state?.characterItemByLocationMap;
        let item = null;
        if (locationMap instanceof Map) {
            item = locationMap.get(location) || null;
        } else if (locationMap && typeof locationMap === "object") {
            item = locationMap[location] || null;
        }
        if (!item || !item.itemHrid) {
            return null;
        }
        if (Number.isFinite(Number(item.count)) && Number(item.count) <= 0) {
            return null;
        }
        return {
            itemHrid: String(item.itemHrid || ""),
            enhancementLevel: Math.max(0, finiteNumber(item.enhancementLevel, 0)),
            fromCurrentEquipment: true,
        };
    }

    function getEnhancementBonusMultiplier(initClientData, enhancementLevel) {
        const level = Math.max(0, Math.floor(finiteNumber(enhancementLevel, 0)));
        const table = initClientData?.enhancementLevelTotalBonusMultiplierTable;
        const fromTable =
            table && Object.prototype.hasOwnProperty.call(table, level) ? Number(table[level]) : Number.NaN;
        if (Number.isFinite(fromTable)) {
            return fromTable;
        }
        return level;
    }

    function addFlatBuff(buffs, typeHrid, amount) {
        const value = finiteNumber(amount, 0);
        if (!typeHrid || !Number.isFinite(value) || value === 0) {
            return;
        }
        buffs.push({
            typeHrid,
            flatBoost: value,
            flatBoostLevelBonus: 0,
            ratioBoost: 0,
            ratioBoostLevelBonus: 0,
        });
    }

    function addRatioBuff(buffs, typeHrid, amount) {
        const value = finiteNumber(amount, 0);
        if (!typeHrid || !Number.isFinite(value) || value === 0) {
            return;
        }
        buffs.push({
            typeHrid,
            flatBoost: 0,
            flatBoostLevelBonus: 0,
            ratioBoost: value,
            ratioBoostLevelBonus: 0,
        });
    }

    function getToolSlotForActionType(actionTypeHrid) {
        if (!actionTypeHrid || typeof actionTypeHrid !== "string") {
            return "";
        }
        if (!actionTypeHrid.startsWith("/action_types/")) {
            return "";
        }
        const skillId = actionTypeHrid.split("/").pop() || "";
        if (!skillId || skillId === "combat" || skillId === "special" || skillId === "labyrinth") {
            return "";
        }
        return `/item_locations/${skillId}_tool`;
    }

    function shouldUseWearableSlotForSkillingAction(slotKey, actionTypeHrid) {
        if (!slotKey) {
            return false;
        }
        if (!slotKey.endsWith("_tool")) {
            return true;
        }
        const requiredToolSlot = getToolSlotForActionType(actionTypeHrid);
        return requiredToolSlot ? slotKey === requiredToolSlot : false;
    }

    function addNoncombatStatsForWearableEntry(totals, state, initClientData, loadout, maxEnhancementByItem, entry) {
        if (!totals || !entry || !entry.itemHrid) {
            return;
        }

        const itemDetail = getItemDetailByHrid(state, initClientData, entry.itemHrid);
        const equipmentDetail = itemDetail?.equipmentDetail;
        if (!equipmentDetail) {
            return;
        }

        const enhancementLevel = resolveWearableEnhancement(entry, loadout, maxEnhancementByItem);
        const enhancementMultiplier = getEnhancementBonusMultiplier(initClientData, enhancementLevel);
        const baseStats = equipmentDetail.noncombatStats || {};
        const enhancementStats = equipmentDetail.noncombatEnhancementBonuses || {};

        for (const [key, value] of Object.entries(baseStats)) {
            if (!Number.isFinite(Number(value))) {
                continue;
            }
            totals[key] = finiteNumber(totals[key], 0) + Number(value);
        }
        for (const [key, value] of Object.entries(enhancementStats)) {
            if (!Number.isFinite(Number(value))) {
                continue;
            }
            totals[key] = finiteNumber(totals[key], 0) + Number(value) * enhancementMultiplier;
        }
    }

    function buildLoadoutNoncombatStatTotals(state, initClientData, loadout, maxEnhancementByItem, actionTypeHrid) {
        const totals = {};
        if (!loadout) {
            return totals;
        }

        const requiredToolSlot = getToolSlotForActionType(actionTypeHrid);
        let sawRequiredToolSlot = false;
        for (const [slotKey, rawRef] of Object.entries(loadout.wearableMap || {})) {
            if (!shouldUseWearableSlotForSkillingAction(slotKey, actionTypeHrid)) {
                continue;
            }
            if (requiredToolSlot && slotKey === requiredToolSlot) {
                sawRequiredToolSlot = true;
            }
            let entry = parseWearableReference(rawRef);
            if (!entry && requiredToolSlot && slotKey === requiredToolSlot) {
                entry = getCurrentEquippedItemForLocation(state, requiredToolSlot);
            }
            addNoncombatStatsForWearableEntry(totals, state, initClientData, loadout, maxEnhancementByItem, entry);
        }
        if (requiredToolSlot && !sawRequiredToolSlot) {
            addNoncombatStatsForWearableEntry(
                totals,
                state,
                initClientData,
                loadout,
                maxEnhancementByItem,
                getCurrentEquippedItemForLocation(state, requiredToolSlot)
            );
        }

        return totals;
    }

    function buildSkillingEquipmentBuffsFromTotals(skillId, totals) {
        const buffs = [];
        if (!skillId || !totals) {
            return buffs;
        }

        const actionSpeed = finiteNumber(totals[`${skillId}Speed`], 0) + finiteNumber(totals.skillingSpeed, 0);
        const efficiency = finiteNumber(totals[`${skillId}Efficiency`], 0) + finiteNumber(totals.skillingEfficiency, 0);
        const gathering = finiteNumber(totals.gatheringQuantity, 0);
        const success = finiteNumber(totals[`${skillId}Success`], 0);
        const skillingExperience = finiteNumber(totals.skillingExperience, 0);
        const skillExperience = finiteNumber(totals[`${skillId}Experience`], 0);
        const wisdom = finiteNumber(totals.wisdom, 0);
        // Runtime state folds equipment skilling/skill EXP stats into generic EXP (wisdom/experience).
        // Keep reconstruction aligned with actual in-game actionType buff buckets.
        const genericExperience = wisdom + skillingExperience + skillExperience;

        addFlatBuff(buffs, "/buff_types/action_speed", actionSpeed);
        addFlatBuff(buffs, "/buff_types/efficiency", efficiency);
        addFlatBuff(buffs, "/buff_types/gathering", gathering);
        addRatioBuff(buffs, `/buff_types/${skillId}_success`, success);
        addRatioBuff(buffs, "/buff_types/wisdom", genericExperience);

        return buffs;
    }

    function getSkillingRoomLoadoutMetrics(state, initClientData, room, skillId, actionTypeHrid, maxEnhancementByItem, fallbackMetrics) {
        const loadoutInfo = getLabyrinthRoomLoadout(state, room);
        const fallback = cloneSkillingMetrics(fallbackMetrics);
        const loadout = loadoutInfo.loadout;
        if (!loadout) {
            return {
                metrics: fallback,
                loadoutInfo,
                mode: "current",
            };
        }

        const noncombatTotals = buildLoadoutNoncombatStatTotals(state, initClientData, loadout, maxEnhancementByItem, actionTypeHrid);
        const equipmentBuffs = buildSkillingEquipmentBuffsFromTotals(skillId, noncombatTotals);
        const metrics = createEmptySkillingMetrics();
        addSkillingMetrics(metrics, getSkillingBuffMetrics(skillId, equipmentBuffs));
        const mode = loadout.actionTypeHrid === actionTypeHrid ? (loadout.useExactEnhancement ? "exact" : "highest") : "configured";

        return {
            metrics,
            loadoutInfo,
            mode,
        };
    }

    function computeSkillingExperienceBonusForRoom(
        state,
        skillId,
        actionTypeHrid,
        roomLoadoutMetrics,
        crateMetrics,
        loanMetrics,
        includePersonalBuffs,
        labyrinthExperienceBonus = 0
    ) {
        const { globalMetrics: globalWithoutPersonal } = getSkillingGlobalMetrics(state, skillId, actionTypeHrid, {
            includePersonalBuffs: false,
        });
        let genericBonus = 0;
        let skillingBonus = 0;
        let skillBonus = 0;

        const appendExperienceBuckets = (metrics) => {
            genericBonus += finiteNumber(metrics?.genericExperienceBonus, 0);
            skillingBonus += finiteNumber(metrics?.skillingExperienceBonus, 0);
            skillBonus += finiteNumber(metrics?.skillExperienceBonus, 0);
        };

        appendExperienceBuckets(globalWithoutPersonal);
        appendExperienceBuckets(roomLoadoutMetrics);
        appendExperienceBuckets(crateMetrics);
        appendExperienceBuckets(loanMetrics);
        genericBonus += finiteNumber(labyrinthExperienceBonus, 0);

        if (includePersonalBuffs) {
            const personalMetrics = getSkillingActionMetricsFromState(
                state,
                skillId,
                actionTypeHrid,
                "personalActionTypeBuffsDict"
            );
            appendExperienceBuckets(personalMetrics);
        }

        const genericMultiplier = Math.max(0, 1 + genericBonus);
        const skillingMultiplier = Math.max(0, 1 + skillingBonus);
        const skillMultiplier = Math.max(0, 1 + skillBonus);
        const multiplier = genericMultiplier * skillingMultiplier * skillMultiplier;

        return {
            genericBonus,
            skillingBonus,
            skillBonus,
            multiplier,
            totalBonus: multiplier - 1,
        };
    }

    function getCombatSkillLevelsFromState(state) {
        const levels = {};
        for (const [key, hrid] of Object.entries(COMBAT_SKILL_HRID_BY_KEY)) {
            levels[key] = positiveNumber(getSkillLevel(state?.characterSkillMap, hrid), 1);
        }
        if (!state?.characterSkillMap && state?.combatUnit?.combatDetails) {
            levels.attack = positiveNumber(state.combatUnit.combatDetails.attackLevel, levels.attack);
            levels.melee = positiveNumber(state.combatUnit.combatDetails.meleeLevel, levels.melee);
            levels.defense = positiveNumber(state.combatUnit.combatDetails.defenseLevel, levels.defense);
            levels.ranged = positiveNumber(state.combatUnit.combatDetails.rangedLevel, levels.ranged);
            levels.magic = positiveNumber(state.combatUnit.combatDetails.magicLevel, levels.magic);
            levels.stamina = positiveNumber(state.combatUnit.combatDetails.staminaLevel, levels.stamina);
            levels.intelligence = positiveNumber(state.combatUnit.combatDetails.intelligenceLevel, levels.intelligence);
        }
        return levels;
    }

    function createEmptyCombatStats() {
        return {
            combatStyleHrid: "/combat_styles/smash",
            damageType: "/damage_types/physical",
            attackInterval: 3000000000,
            autoAttackDamage: 0,
            castSpeed: 0,
            criticalRate: 0,
            criticalDamage: 0,
            stabAccuracy: 0,
            slashAccuracy: 0,
            smashAccuracy: 0,
            rangedAccuracy: 0,
            magicAccuracy: 0,
            stabDamage: 0,
            slashDamage: 0,
            smashDamage: 0,
            rangedDamage: 0,
            magicDamage: 0,
            defensiveDamage: 0,
            taskDamage: 0,
            armorPenetration: 0,
            waterPenetration: 0,
            naturePenetration: 0,
            firePenetration: 0,
            maxHitpoints: 0,
            maxManapoints: 0,
            stabEvasion: 0,
            slashEvasion: 0,
            smashEvasion: 0,
            rangedEvasion: 0,
            magicEvasion: 0,
            armor: 0,
            waterResistance: 0,
            natureResistance: 0,
            fireResistance: 0,
            tenacity: 0,
            hpRegenPer10: 0,
            mpRegenPer10: 0,
            drinkConcentration: 0,
            combatRareFind: 0,
            combatDropRate: 0,
            combatDropQuantity: 0,
            combatExperience: 0,
            foodSlots: 1,
            drinkSlots: 1,
            physicalAmplify: 0,
            waterAmplify: 0,
            natureAmplify: 0,
            fireAmplify: 0,
            healingAmplify: 0,
            physicalThorns: 0,
            elementalThorns: 0,
            lifeSteal: 0,
            abilityHaste: 0,
            manaLeech: 0,
            threat: 100,
            parry: 0,
            mayhem: 0,
            pierce: 0,
            curse: 0,
            fury: 0,
            weaken: 0,
            ripple: 0,
            bloom: 0,
            blaze: 0,
            attackSpeed: 0,
            foodHaste: 0,
            damageTaken: 0,
            retaliation: 0,
            primaryTraining: "/skills/melee",
            focusTraining: "",
        };
    }

    function addNumericStat(stats, key, value) {
        const n = Number(value);
        if (!Number.isFinite(n)) {
            return;
        }
        stats[key] = finiteNumber(stats[key], 0) + n;
    }

    function getPositiveMultiplier(value) {
        return Math.max(0.05, 1 + finiteNumber(value, 0));
    }

    function buildPlayerDetailsFromCombatProfile(profile) {
        const levels = profile.levels;
        const combatStats = profile.combatStats;

        const attack = positiveNumber(levels.attack, 1);
        const melee = positiveNumber(levels.melee, 1);
        const defense = positiveNumber(levels.defense, 1);
        const ranged = positiveNumber(levels.ranged, 1);
        const magic = positiveNumber(levels.magic, 1);
        const stamina = positiveNumber(levels.stamina, 1);
        const intelligence = positiveNumber(levels.intelligence, 1);

        const details = {
            attackLevel: attack,
            meleeLevel: melee,
            defenseLevel: defense,
            rangedLevel: ranged,
            magicLevel: magic,
            staminaLevel: stamina,
            intelligenceLevel: intelligence,
            maxHitpoints: Math.floor(10 * (10 + stamina) + finiteNumber(combatStats.maxHitpoints, 0)),
            maxManapoints: Math.floor(10 * (10 + intelligence) + finiteNumber(combatStats.maxManapoints, 0)),
            stabAccuracyRating: (10 + attack) * getPositiveMultiplier(combatStats.stabAccuracy),
            slashAccuracyRating: (10 + attack) * getPositiveMultiplier(combatStats.slashAccuracy),
            smashAccuracyRating: (10 + attack) * getPositiveMultiplier(combatStats.smashAccuracy),
            rangedAccuracyRating: (10 + attack) * getPositiveMultiplier(combatStats.rangedAccuracy),
            magicAccuracyRating: (10 + attack) * getPositiveMultiplier(combatStats.magicAccuracy),
            stabMaxDamage: (10 + melee) * getPositiveMultiplier(combatStats.stabDamage),
            slashMaxDamage: (10 + melee) * getPositiveMultiplier(combatStats.slashDamage),
            smashMaxDamage: (10 + melee) * getPositiveMultiplier(combatStats.smashDamage),
            rangedMaxDamage: (10 + ranged) * getPositiveMultiplier(combatStats.rangedDamage),
            magicMaxDamage: (10 + magic) * getPositiveMultiplier(combatStats.magicDamage),
            defensiveMaxDamage: (10 + defense) * getPositiveMultiplier(combatStats.defensiveDamage),
            stabEvasionRating: (10 + defense) * getPositiveMultiplier(combatStats.stabEvasion),
            slashEvasionRating: (10 + defense) * getPositiveMultiplier(combatStats.slashEvasion),
            smashEvasionRating: (10 + defense) * getPositiveMultiplier(combatStats.smashEvasion),
            rangedEvasionRating: (10 + defense) * getPositiveMultiplier(combatStats.rangedEvasion),
            magicEvasionRating: (10 + defense) * getPositiveMultiplier(combatStats.magicEvasion),
            totalArmor: 0.2 * defense + finiteNumber(combatStats.armor, 0),
            totalWaterResistance: 0.2 * defense + finiteNumber(combatStats.waterResistance, 0),
            totalNatureResistance: 0.2 * defense + finiteNumber(combatStats.natureResistance, 0),
            totalFireResistance: 0.2 * defense + finiteNumber(combatStats.fireResistance, 0),
        };

        details.currentHitpoints = details.maxHitpoints;
        details.currentManapoints = details.maxManapoints;

        const baseInterval = positiveNumber(combatStats.attackInterval, COMBAT_ONE_SECOND_NS);
        let attackInterval = baseInterval / (1 + attack / 2000);
        attackInterval /= Math.max(0.05, 1 + finiteNumber(combatStats.attackSpeed, 0));
        attackInterval /= Math.max(0.05, 1 + finiteNumber(profile.extraAttackSpeedRatio, 0));

        combatStats.attackInterval = attackInterval;
        combatStats.hpRegenPer10 = 0.01 + finiteNumber(combatStats.hpRegenPer10, 0);
        combatStats.mpRegenPer10 = 0.01 + finiteNumber(combatStats.mpRegenPer10, 0);
        combatStats.castSpeed = finiteNumber(combatStats.castSpeed, 0) + attack / 2000;

        details.combatStats = combatStats;
        return details;
    }

    function cloneCombatStatsForSimulation(rawCombatStats, rawAttackIntervalNs) {
        const source = rawCombatStats || {};
        const combatStats = createEmptyCombatStats();
        for (const [key, value] of Object.entries(source)) {
            const numericValue = Number(value);
            if (Number.isFinite(numericValue)) {
                combatStats[key] = numericValue;
            }
        }
        combatStats.combatStyleHrid = getCombatStyleHrid(source);
        combatStats.damageType = getDamageTypeHrid(source);
        combatStats.attackInterval = positiveNumber(rawAttackIntervalNs || source.attackInterval, COMBAT_ONE_SECOND_NS);
        return combatStats;
    }

    function buildMazeMonsterDetailsForRoom(monsterDetails, roomLevel) {
        if (!monsterDetails || !monsterDetails.combatStats) {
            return null;
        }
        const resolvedRoomLevel = positiveNumber(roomLevel, positiveNumber(monsterDetails.combatLevel, 100));
        const mazeScale = resolvedRoomLevel / 100;
        const levels = {
            attack: positiveNumber(monsterDetails.attackLevel, 1) * mazeScale,
            melee: positiveNumber(monsterDetails.meleeLevel, 1) * mazeScale,
            defense: positiveNumber(monsterDetails.defenseLevel, 1) * mazeScale,
            ranged: positiveNumber(monsterDetails.rangedLevel, 1) * mazeScale,
            magic: positiveNumber(monsterDetails.magicLevel, 1) * mazeScale,
            stamina: positiveNumber(monsterDetails.staminaLevel, 1) * mazeScale,
            intelligence: positiveNumber(monsterDetails.intelligenceLevel, 1) * mazeScale,
        };
        const combatStats = cloneCombatStatsForSimulation(monsterDetails.combatStats, monsterDetails.attackInterval);
        const details = buildPlayerDetailsFromCombatProfile({
            levels,
            combatStats,
            extraAttackSpeedRatio: 0,
        });
        if (!details) {
            return null;
        }
        // Monster template max HP/MP already includes monster-specific modifiers (e.g. aura-like effects).
        // Prefer scaling template values directly to avoid underestimating preview stats.
        const scaledTemplateMaxHp = finiteNumber(monsterDetails.maxHitpoints, NaN) * mazeScale;
        const scaledTemplateMaxMp = finiteNumber(monsterDetails.maxManapoints, NaN) * mazeScale;
        if (Number.isFinite(scaledTemplateMaxHp) && scaledTemplateMaxHp > 0) {
            details.maxHitpoints = Math.max(1, Math.floor(scaledTemplateMaxHp));
        }
        if (Number.isFinite(scaledTemplateMaxMp) && scaledTemplateMaxMp > 0) {
            details.maxManapoints = Math.max(1, Math.floor(scaledTemplateMaxMp));
        }
        // Use game's labyrinth rule: armor/resistance scales by room level from base values.
        details.totalArmor = finiteNumber(monsterDetails.totalArmor, details.totalArmor) * mazeScale;
        details.totalWaterResistance = finiteNumber(monsterDetails.totalWaterResistance, details.totalWaterResistance) * mazeScale;
        details.totalNatureResistance = finiteNumber(monsterDetails.totalNatureResistance, details.totalNatureResistance) * mazeScale;
        details.totalFireResistance = finiteNumber(monsterDetails.totalFireResistance, details.totalFireResistance) * mazeScale;
        details.currentHitpoints = details.maxHitpoints;
        details.currentManapoints = details.maxManapoints;
        return details;
    }

    function getCombatStyleHrid(combatStats) {
        if (!combatStats) {
            return "/combat_styles/smash";
        }
        if (Array.isArray(combatStats.combatStyleHrids) && combatStats.combatStyleHrids.length > 0) {
            return combatStats.combatStyleHrids[0] || "/combat_styles/smash";
        }
        return combatStats.combatStyleHrid || "/combat_styles/smash";
    }

    function getDamageTypeHrid(combatStats) {
        if (!combatStats) {
            return "/damage_types/physical";
        }
        return combatStats.damageType || "/damage_types/physical";
    }

    function getAccuracyRating(details, combatStyle) {
        switch (combatStyle) {
            case "/combat_styles/stab":
                return positiveNumber(details.stabAccuracyRating, 1);
            case "/combat_styles/slash":
                return positiveNumber(details.slashAccuracyRating, 1);
            case "/combat_styles/smash":
                return positiveNumber(details.smashAccuracyRating, 1);
            case "/combat_styles/ranged":
                return positiveNumber(details.rangedAccuracyRating, 1);
            case "/combat_styles/magic":
                return positiveNumber(details.magicAccuracyRating, 1);
            default:
                return positiveNumber(details.smashAccuracyRating, 1);
        }
    }

    function getMaxDamage(details, combatStyle) {
        switch (combatStyle) {
            case "/combat_styles/stab":
                return positiveNumber(details.stabMaxDamage, 1);
            case "/combat_styles/slash":
                return positiveNumber(details.slashMaxDamage, 1);
            case "/combat_styles/smash":
                return positiveNumber(details.smashMaxDamage, 1);
            case "/combat_styles/ranged":
                return positiveNumber(details.rangedMaxDamage, 1);
            case "/combat_styles/magic":
                return positiveNumber(details.magicMaxDamage, 1);
            default:
                return positiveNumber(details.smashMaxDamage, 1);
        }
    }

    function getEvasionRating(details, combatStyle) {
        switch (combatStyle) {
            case "/combat_styles/stab":
                return positiveNumber(details.stabEvasionRating, 1);
            case "/combat_styles/slash":
                return positiveNumber(details.slashEvasionRating, 1);
            case "/combat_styles/smash":
                return positiveNumber(details.smashEvasionRating, 1);
            case "/combat_styles/ranged":
                return positiveNumber(details.rangedEvasionRating, 1);
            case "/combat_styles/magic":
                return positiveNumber(details.magicEvasionRating, 1);
            default:
                return positiveNumber(details.smashEvasionRating, 1);
        }
    }

    function getResistance(details, damageType) {
        switch (damageType) {
            case "/damage_types/water":
                return finiteNumber(details.totalWaterResistance, 0);
            case "/damage_types/nature":
                return finiteNumber(details.totalNatureResistance, 0);
            case "/damage_types/fire":
                return finiteNumber(details.totalFireResistance, 0);
            case "/damage_types/physical":
            default:
                return finiteNumber(details.totalArmor, 0);
        }
    }

    function createMonsterCombatTemplate(initClientData, room) {
        const monsterDetails = initClientData?.combatMonsterDetailMap?.[room?.monsterHrid]?.combatDetails;
        if (!monsterDetails) {
            return null;
        }
        const details = buildMazeMonsterDetailsForRoom(monsterDetails, room?.recommendedLevel);
        if (!details) {
            return {
                isPlayer: false,
                combatDetails: monsterDetails,
            };
        }
        return {
            isPlayer: false,
            combatDetails: details,
        };
    }

    function getCombatPlayerSignature(state) {
        const details = state?.combatUnit?.combatDetails;
        if (!details || !details.combatStats) {
            return "";
        }
        const stats = details.combatStats;
        const signatureParts = [
            getCombatStyleHrid(stats),
            getDamageTypeHrid(stats),
            roundForSignature(details.maxHitpoints),
            roundForSignature(details.maxManapoints),
            roundForSignature(details.attackLevel),
            roundForSignature(details.meleeLevel),
            roundForSignature(details.defenseLevel),
            roundForSignature(details.rangedLevel),
            roundForSignature(details.magicLevel),
            roundForSignature(details.stabAccuracyRating),
            roundForSignature(details.slashAccuracyRating),
            roundForSignature(details.smashAccuracyRating),
            roundForSignature(details.rangedAccuracyRating),
            roundForSignature(details.magicAccuracyRating),
            roundForSignature(details.stabMaxDamage),
            roundForSignature(details.slashMaxDamage),
            roundForSignature(details.smashMaxDamage),
            roundForSignature(details.rangedMaxDamage),
            roundForSignature(details.magicMaxDamage),
            roundForSignature(details.stabEvasionRating),
            roundForSignature(details.slashEvasionRating),
            roundForSignature(details.smashEvasionRating),
            roundForSignature(details.rangedEvasionRating),
            roundForSignature(details.magicEvasionRating),
            roundForSignature(details.defensiveMaxDamage),
            roundForSignature(details.totalArmor),
            roundForSignature(details.totalWaterResistance),
            roundForSignature(details.totalNatureResistance),
            roundForSignature(details.totalFireResistance),
            roundForSignature(stats.attackInterval || details.attackInterval),
            roundForSignature(stats.autoAttackDamage),
            roundForSignature(stats.criticalRate),
            roundForSignature(stats.criticalDamage),
            roundForSignature(stats.taskDamage),
            roundForSignature(stats.damageTaken),
            roundForSignature(stats.armorPenetration),
            roundForSignature(stats.waterPenetration),
            roundForSignature(stats.naturePenetration),
            roundForSignature(stats.firePenetration),
            roundForSignature(stats.physicalAmplify),
            roundForSignature(stats.waterAmplify),
            roundForSignature(stats.natureAmplify),
            roundForSignature(stats.fireAmplify),
            roundForSignature(stats.physicalThorns),
            roundForSignature(stats.elementalThorns),
            roundForSignature(stats.retaliation),
            roundForSignature(stats.lifeSteal),
            roundForSignature(stats.manaLeech),
        ];
        return signatureParts.join("|");
    }

    function getCombatRoomSignature(state, initClientData, room, maxEnhancementByItem, options = {}) {
        const includePersonalBuffs = !(options && options.includePersonalBuffs === false);
        const baseSignature = getCombatPlayerSignature(state);
        const combatCrate = getCombatCrateBuffs(state, initClientData);
        const labyrinthUpgradeLevels = resolveLabyrinthUpgradeLevels(options);
        const labyrinthCombatBuffs = buildLabyrinthCombatBuffs(labyrinthUpgradeLevels);
        const guildCombatBuffs = getActiveGuildCombatBuffs(state);
        const personalSealItemHrids = getCombatSimulatorPersonalSealItemHrids(state, {
            includePersonalBuffs,
            selectedSealItemHrids: Array.isArray(options?.selectedSealItemHrids) ? options.selectedSealItemHrids : [],
        });
        const combatCrateSignature = String(combatCrate.combatCrateSignature || combatCrate.teaCrateItemHrid || "");
        const crateBuffHash = hashString(stableStringify(combatCrate.combatBuffs || []));
        const labyrinthBuffHash = hashString(stableStringify(labyrinthCombatBuffs || []));
        const guildBuffHash = hashString(stableStringify(guildCombatBuffs || []));
        const personalBuffHash = hashString(stableStringify(personalSealItemHrids || []));
        const monsterDetailHash = hashString(stableStringify(initClientData?.combatMonsterDetailMap?.[room?.monsterHrid] || null));
        const loadoutInfo = resolveCombatRoomLoadout(state, room);
        const loadout = loadoutInfo.loadout;
        if (!isCombatLoadout(loadout)) {
            return [
                "fallback",
                `model=${COMBAT_MODEL_SIGNATURE}`,
                `monster=${room?.monsterHrid || ""}`,
                `monsterData=${monsterDetailHash}`,
                `crate=${combatCrateSignature}`,
                `crateBuff=${crateBuffHash}`,
                `labBuff=${labyrinthBuffHash}`,
                `guildBuff=${guildBuffHash}`,
                `pMode=${includePersonalBuffs ? 1 : 0}`,
                `pBuff=${personalBuffHash}`,
                baseSignature,
            ].join("|");
        }

        const levelParts = [];
        const levels = getCombatSkillLevelsFromState(state);
        for (const [key, value] of Object.entries(levels)) {
            levelParts.push(`${key}:${roundForSignature(value)}`);
        }
        levelParts.sort();

        const wearableParts = [];
        for (const [slotKey, rawRef] of Object.entries(loadout.wearableMap || {})) {
            const entry = parseWearableReference(rawRef);
            if (!entry || !entry.itemHrid) {
                continue;
            }
            const itemDetail = getItemDetailByHrid(state, initClientData, entry.itemHrid);
            const equipmentType = itemDetail?.equipmentDetail?.type;
            if (!shouldIncludeCombatEquipment(entry.itemHrid, equipmentType)) {
                continue;
            }
            const enh = resolveWearableEnhancement(entry, loadout, maxEnhancementByItem);
            wearableParts.push(`${slotKey}:${entry.itemHrid}:${enh}`);
        }
        wearableParts.sort();

        const abilityParts = [];
        const abilityMap = loadout.abilityMap || {};
        for (let slot = 1; slot <= COMBAT_SLOT_COUNT; slot += 1) {
            const abilityHrid = String(abilityMap[slot] || abilityMap[String(slot)] || "");
            if (!abilityHrid) {
                continue;
            }
            const level = getAbilityLevelFromState(state, abilityHrid);
            abilityParts.push(`${slot}:${abilityHrid}:${level}`);
        }
        abilityParts.sort();

        const abilityTriggerHash = hashString(stableStringify(loadout.abilityCombatTriggersMap || {}));
        const houseHash = hashString(stableStringify(buildHouseRoomLevelMap(state)));
        const achievementHash = hashString(stableStringify(buildAchievementCompletionMap(state)));

        return [
            `model=${COMBAT_MODEL_SIGNATURE}`,
            `monster=${room?.monsterHrid || ""}`,
            `monsterData=${monsterDetailHash}`,
            `loadout=${loadoutInfo.loadoutId}`,
            `source=${loadoutInfo.source || "room"}`,
            `selected=${loadoutInfo.selectedLoadoutId || loadoutInfo.loadoutId || 0}`,
            `exact=${loadout.useExactEnhancement ? 1 : 0}`,
            `setting=${loadoutInfo.settingKey}`,
            `crate=${combatCrateSignature}`,
            `crateBuff=${crateBuffHash}`,
            `labBuff=${labyrinthBuffHash}`,
            `guildBuff=${guildBuffHash}`,
            `pMode=${includePersonalBuffs ? 1 : 0}`,
            `pBuff=${personalBuffHash}`,
            `levels=${levelParts.join(",")}`,
            `ability=${abilityParts.join(",")}`,
            `aTrig=${abilityTriggerHash}`,
            `house=${houseHash}`,
            `ach=${achievementHash}`,
            `wear=${wearableParts.join(",")}`,
            `fallback=${baseSignature}`,
        ].join("|");
    }

    async function computeCombatRoomClearChanceFullFlow(
        state,
        initClientData,
        room,
        maxEnhancementByItem,
        progressTracker,
        combatTrials,
        roomKey = "",
        options = {}
    ) {
        const roomLevel = positiveNumber(room?.recommendedLevel, 1);
        const trials = normalizeCombatSimTrials(combatTrials);
        const combatCrate = getCombatCrateBuffs(state, initClientData);
        const labyrinthUpgradeLevels = resolveLabyrinthUpgradeLevels(options);
        const labyrinthCombatBuffs = buildLabyrinthCombatBuffs(labyrinthUpgradeLevels);
        const guildCombatBuffs = getActiveGuildCombatBuffs(state);
        const guildCombatShrineLevels = getActiveGuildCombatShrineLevels(state);
        const includePersonalBuffs = !(options && options.includePersonalBuffs === false);
        const playerPersonalBuffItemHrids = getCombatSimulatorPersonalSealItemHrids(state, {
            includePersonalBuffs,
            selectedSealItemHrids: Array.isArray(options?.selectedSealItemHrids) ? options.selectedSealItemHrids : [],
        });
        const combatCrateSignature = String(combatCrate.combatCrateSignature || combatCrate.teaCrateItemHrid || "");
        const playerData = buildCombatPlayerDtoForRoom(state, initClientData, room, maxEnhancementByItem);
        if (!playerData.playerDto) {
            return null;
        }
        const inputSnapshot = buildCombatInputSnapshot(playerData, room);
        if (inputSnapshot) {
            inputSnapshot.roomKey = String(roomKey || "");
        }

        const workerResult = await simulateCombatRoomWithWorker(
            {
                playerDto: playerData.playerDto,
                playerPersonalBuffItemHrids,
                labyrinthCombatBuffs,
                guildCombatBuffs,
                monsterHrid: room.monsterHrid,
                mazeDifficulty: roomLevel,
                roomDurationSeconds: ROOM_DURATION_SECONDS,
                mazeCrateItemHrids: Array.isArray(combatCrate.combatCrateItemHrids)
                    ? combatCrate.combatCrateItemHrids.slice()
                    : [],
                trials,
            },
            progressTracker
        );

        const executedTrials = Math.max(0, Math.floor(finiteNumber(workerResult?.trials, trials)));
        const successes = Math.max(0, Math.floor(finiteNumber(workerResult?.successes, 0)));
        const totalSpentSeconds = Math.max(0, finiteNumber(workerResult?.totalSpentSeconds, 0));
        const minElapsedSeconds = Math.max(0, finiteNumber(workerResult?.minElapsedSeconds, 0));
        const maxElapsedSeconds = Math.max(minElapsedSeconds, finiteNumber(workerResult?.maxElapsedSeconds, minElapsedSeconds));
        const failedByTimeoutRaw = Math.max(0, Math.floor(finiteNumber(workerResult?.failedByTimeout, 0)));
        const failedByDeathRaw = Math.max(0, Math.floor(finiteNumber(workerResult?.failedByDeath, 0)));
        const firstRunDebug = workerResult?.firstRunDebug || null;
        const clearChance = executedTrials > 0 ? clamp01(successes / executedTrials) : 0;
        const expectedSecondsPerClear = successes > 0 ? totalSpentSeconds / successes : Infinity;
        const totalFailures = Math.max(0, executedTrials - successes);
        const knownFailures = Math.max(0, failedByTimeoutRaw + failedByDeathRaw);
        const failedByTimeout = knownFailures >= totalFailures ? failedByTimeoutRaw : failedByTimeoutRaw + (totalFailures - knownFailures);
        const failedByDeath = knownFailures >= totalFailures ? failedByDeathRaw : failedByDeathRaw;
        const failureReason = clearChance < 1 ? deriveCombatFailureReasonFromCounts(totalFailures, failedByTimeout, failedByDeath) : "";

        return {
            clearChance,
            expectedSecondsPerClear,
            combatMeta: {
                source: "full",
                roomKey: String(roomKey || ""),
                monsterHrid: String(room?.monsterHrid || ""),
                roomLevel,
                trials: executedTrials,
                successes,
                failures: totalFailures,
                failedByTimeout,
                failedByDeath,
                failureReason,
                totalSpentSeconds,
                minElapsedSeconds,
                maxElapsedSeconds,
                expectedSecondsPerClearRaw: expectedSecondsPerClear,
                loadoutId: playerData.loadoutInfo.loadoutId || 0,
                loadoutName: playerData.loadoutInfo.loadout?.name || "",
                loadoutMode: playerData.loadoutInfo.loadout?.useExactEnhancement ? "exact" : "highest",
                loadoutSource: playerData.loadoutInfo.source || "room",
                selectedLoadoutId: playerData.loadoutInfo.selectedLoadoutId || playerData.loadoutInfo.loadoutId || 0,
                mazeCrateItemHrid: combatCrateSignature,
                mazeCrateItemHrids: Array.isArray(combatCrate.combatCrateItemHrids) ? combatCrate.combatCrateItemHrids.slice() : [],
                mazeCrateBuffCount: Array.isArray(combatCrate.combatBuffs) ? combatCrate.combatBuffs.length : 0,
                labyrinthBuffCount: Array.isArray(labyrinthCombatBuffs) ? labyrinthCombatBuffs.length : 0,
                guildBuffCount: Array.isArray(guildCombatBuffs) ? guildCombatBuffs.length : 0,
                guildCombatShrineLevels,
                personalBuffCount: Array.isArray(playerPersonalBuffItemHrids) ? playerPersonalBuffItemHrids.length : 0,
                combatInputSnapshot: inputSnapshot,
                firstRunDebug: firstRunDebug || null,
            },
            debug: [
                "combat-full",
                `monster=${room.monsterHrid.split("/").pop() || room.monsterHrid}`,
                `loadout=${playerData.loadoutInfo.loadout?.name || playerData.loadoutInfo.loadoutId || "current"}`,
                `source=${playerData.loadoutInfo.source || "room"}`,
                playerData.loadoutInfo.selectedLoadoutId && playerData.loadoutInfo.selectedLoadoutId !== playerData.loadoutInfo.loadoutId
                    ? `selected=${playerData.loadoutInfo.selectedLoadoutId}`
                    : "",
                `mode=${playerData.loadoutInfo.loadout?.useExactEnhancement ? "exact" : "highest"}`,
                `crate=${combatCrateSignature || "none"}`,
                `guildLv=${guildCombatShrineLevels.force}/${guildCombatShrineLevels.spirit}/${guildCombatShrineLevels.tempo}`,
                getLabyrinthUpgradeLevel(labyrinthUpgradeLevels, LABYRINTH_UPGRADE_KEY_COMBAT_DAMAGE) > 0
                    ? `labDmg+${(
                          getLabyrinthUpgradeLevel(labyrinthUpgradeLevels, LABYRINTH_UPGRADE_KEY_COMBAT_DAMAGE) *
                          LABYRINTH_UPGRADE_STEP_RATIO *
                          100
                      ).toFixed(1)}%`
                    : "",
                getLabyrinthUpgradeLevel(labyrinthUpgradeLevels, LABYRINTH_UPGRADE_KEY_ATTACK_SPEED) > 0
                    ? `labAtkSpd+${(
                          getLabyrinthUpgradeLevel(labyrinthUpgradeLevels, LABYRINTH_UPGRADE_KEY_ATTACK_SPEED) *
                          LABYRINTH_UPGRADE_STEP_RATIO *
                          100
                      ).toFixed(1)}%`
                    : "",
                getLabyrinthUpgradeLevel(labyrinthUpgradeLevels, LABYRINTH_UPGRADE_KEY_CAST_SPEED) > 0
                    ? `labCastSpd+${(
                          getLabyrinthUpgradeLevel(labyrinthUpgradeLevels, LABYRINTH_UPGRADE_KEY_CAST_SPEED) *
                          LABYRINTH_UPGRADE_STEP_RATIO *
                          100
                      ).toFixed(1)}%`
                    : "",
                getLabyrinthUpgradeLevel(labyrinthUpgradeLevels, LABYRINTH_UPGRADE_KEY_CRITICAL_RATE) > 0
                    ? `labCrit+${(
                          getLabyrinthUpgradeLevel(labyrinthUpgradeLevels, LABYRINTH_UPGRADE_KEY_CRITICAL_RATE) *
                          LABYRINTH_UPGRADE_STEP_RATIO *
                          100
                      ).toFixed(1)}%`
                    : "",
                getCombatBuffValueByType(guildCombatBuffs, "/buff_types/max_hitpoints", "ratioBoost") > 0
                    ? `guildHp+${(
                          getCombatBuffValueByType(guildCombatBuffs, "/buff_types/max_hitpoints", "ratioBoost") * 100
                      ).toFixed(1)}%`
                    : "",
                getCombatBuffValueByType(guildCombatBuffs, "/buff_types/max_manapoints", "ratioBoost") > 0
                    ? `guildMp+${(
                          getCombatBuffValueByType(guildCombatBuffs, "/buff_types/max_manapoints", "ratioBoost") * 100
                      ).toFixed(1)}%`
                    : "",
                getCombatBuffValueByType(guildCombatBuffs, "/buff_types/attack_speed", "ratioBoost") > 0
                    ? `guildAtkSpd+${(
                          getCombatBuffValueByType(guildCombatBuffs, "/buff_types/attack_speed", "ratioBoost") * 100
                      ).toFixed(1)}%`
                    : "",
                getCombatBuffValueByType(guildCombatBuffs, "/buff_types/cast_speed", "flatBoost") > 0
                    ? `guildCastSpd+${(
                          getCombatBuffValueByType(guildCombatBuffs, "/buff_types/cast_speed", "flatBoost") * 100
                      ).toFixed(1)}%`
                    : "",
                getCombatBuffValueByType(guildCombatBuffs, "/buff_types/damage", "ratioBoost") > 0
                    ? `guildDmg+${(
                          getCombatBuffValueByType(guildCombatBuffs, "/buff_types/damage", "ratioBoost") * 100
                      ).toFixed(1)}%`
                    : "",
                Array.isArray(playerPersonalBuffItemHrids) && playerPersonalBuffItemHrids.length > 0
                    ? `pBuff=${playerPersonalBuffItemHrids.length}`
                    : "",
                `roomLv=${roomLevel}`,
                `trials=${executedTrials}`,
                `wins=${successes}`,
                `t=${minElapsedSeconds.toFixed(2)}-${maxElapsedSeconds.toFixed(2)}s`,
                firstRunDebug && Number.isFinite(Number(firstRunDebug.encounters))
                    ? `enc=${Math.max(0, Math.floor(finiteNumber(firstRunDebug.encounters, 0)))}`
                    : "",
                firstRunDebug && Number.isFinite(Number(firstRunDebug.simulatedTime))
                    ? `simT=${(finiteNumber(firstRunDebug.simulatedTime, 0) / COMBAT_ONE_SECOND_NS).toFixed(2)}s`
                    : "",
                firstRunDebug && firstRunDebug.deaths && typeof firstRunDebug.deaths === "object"
                    ? `deaths=${Object.values(firstRunDebug.deaths).reduce(
                          (sum, value) => sum + Math.max(0, Math.floor(finiteNumber(value, 0))),
                          0
                      )}`
                    : "",
                totalFailures > 0 ? `failT=${failedByTimeout}` : "",
                totalFailures > 0 ? `failD=${failedByDeath}` : "",
                failureReason ? `why=${failureReason}` : "",
                `eta=${formatEtaText(expectedSecondsPerClear, Math.round(clearChance * 100))}`,
            ].join(" | "),
        };
    }

    async function computeCombatRoomClearChance(
        state,
        initClientData,
        room,
        maxEnhancementByItem,
        progressTracker,
        combatTrials,
        roomKey = "",
        options = {}
    ) {
        if (!room || room.roomType !== LABYRINTH_COMBAT_ROOM_TYPE || !room.monsterHrid) {
            return null;
        }
        const includePersonalBuffs = !(options && options.includePersonalBuffs === false);
        const labyrinthUpgradeLevels = resolveLabyrinthUpgradeLevels(options);
        const playerSignature = getCombatRoomSignature(state, initClientData, room, maxEnhancementByItem, {
            includePersonalBuffs,
            selectedSealItemHrids: Array.isArray(options?.selectedSealItemHrids) ? options.selectedSealItemHrids : [],
            labyrinthUpgradeLevels,
        });
        if (!playerSignature) {
            return null;
        }

        const roomLevel = positiveNumber(room.recommendedLevel, 1);
        const trials = normalizeCombatSimTrials(combatTrials);
        const disableCache = Boolean(options && options.disableCache);
        const cacheKey = `${room.monsterHrid}|${roomLevel}|trials=${trials}|${playerSignature}`;
        if (!disableCache) {
            const cached = combatEstimateCache.get(cacheKey);
            if (cached) {
                if (progressTracker) {
                    progressTracker.add(trials);
                }
                return {
                    ...cached,
                    combatMeta: {
                        ...(cached.combatMeta || {}),
                        source: "cache",
                        roomKey: String(roomKey || cached.combatMeta?.roomKey || ""),
                        cacheKey,
                    },
                };
            }
        }

        let result = null;
        try {
            result = await computeCombatRoomClearChanceFullFlow(
                state,
                initClientData,
                room,
                maxEnhancementByItem,
                progressTracker,
                trials,
                roomKey,
                {
                    includePersonalBuffs,
                    selectedSealItemHrids: Array.isArray(options?.selectedSealItemHrids) ? options.selectedSealItemHrids : [],
                    labyrinthUpgradeLevels,
                }
            );
        } catch (error) {
            const fatalError = error instanceof Error ? error : new Error(String(error));
            console.error("[Lab Clear Rate] full combat simulation failed:", fatalError);
            resetCombatSimulatorWorker(error instanceof Error ? error : new Error(String(error)));
            combatWorkerScriptPromise = null;
            const alertMessage = t("combatFlowFailedFmt", { message: fatalError.message || String(fatalError) });
            if (typeof window !== "undefined" && typeof window.alert === "function") {
                window.alert(alertMessage);
            }
            throw fatalError;
        }

        if (!result) {
            return null;
        }

        const cacheableResult = {
            ...result,
            combatMeta: {
                ...(result.combatMeta || {}),
                source: "full",
                roomKey: String(roomKey || result.combatMeta?.roomKey || ""),
                cacheKey,
            },
        };
        if (!disableCache) {
            combatEstimateCache.set(cacheKey, cacheableResult);
            if (combatEstimateCache.size > COMBAT_SIM_CACHE_LIMIT) {
                const oldestKey = combatEstimateCache.keys().next().value;
                if (oldestKey) {
                    combatEstimateCache.delete(oldestKey);
                }
            }
        }

        return cacheableResult;
    }

    function isCalculableRoom(room) {
        return room?.roomType === LABYRINTH_COMBAT_ROOM_TYPE || room?.roomType === LABYRINTH_SKILLING_ROOM_TYPE;
    }

    function getTotalProgressUnits(rooms, combatTrials) {
        const trials = normalizeCombatSimTrials(combatTrials);
        let total = 0;
        for (const room of rooms) {
            if (room?.roomType === LABYRINTH_COMBAT_ROOM_TYPE) {
                total += trials;
            } else if (room?.roomType === LABYRINTH_SKILLING_ROOM_TYPE) {
                total += 1;
            }
        }
        return total;
    }

    function getTotalProgressUnitsForIndexes(rooms, indexes, combatTrials) {
        const trials = normalizeCombatSimTrials(combatTrials);
        let total = 0;
        for (const index of indexes) {
            const room = rooms[index];
            if (room?.roomType === LABYRINTH_COMBAT_ROOM_TYPE) {
                total += trials;
            } else if (room?.roomType === LABYRINTH_SKILLING_ROOM_TYPE) {
                total += 1;
            }
        }
        return total;
    }

    function parseRoomKeyToIndex(roomKey, colCount, totalCount) {
        if (!roomKey || !Number.isInteger(colCount) || colCount <= 0) {
            return -1;
        }
        const [xRaw, yRaw] = String(roomKey).split(",");
        const x = Number(xRaw);
        const y = Number(yRaw);
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            return -1;
        }
        if (x < 0 || y < 0 || x >= colCount) {
            return -1;
        }
        const index = y * colCount + x;
        if (!Number.isInteger(index) || index < 0 || index >= totalCount) {
            return -1;
        }
        return index;
    }

    function getTargetRoomIndexes(flatRooms, colCount, roomKeys) {
        const totalCount = Array.isArray(flatRooms) ? flatRooms.length : 0;
        if (!totalCount) {
            return [];
        }
        if (!Array.isArray(roomKeys) || roomKeys.length === 0) {
            return Array.from({ length: totalCount }, (_unused, index) => index);
        }
        const indexes = new Set();
        for (const roomKey of roomKeys) {
            const index = parseRoomKeyToIndex(roomKey, colCount, totalCount);
            if (index < 0) {
                continue;
            }
            if (!isCalculableRoom(flatRooms[index])) {
                continue;
            }
            indexes.add(index);
        }
        return Array.from(indexes).sort((a, b) => a - b);
    }

    function refreshControlPanelPlacement() {
        syncVisibleLabyrinthUpgradeLevelsCache();
        if (roomDistributionEnabled && isRoomDistributionUnsupportedDevice()) {
            setRoomDistributionEnabled(false);
        }
        const state = getGameState();
        refreshLiveActionRateDisplay(state);
        syncRoomLogSessionState(state);
        if (!state || !state.characterLabyrinth) {
            markLabyrinthTransition("");
            hidePreviewTooltip();
            clearAutomationWideLayout();
            automationEstimateByRoomTypeKey.clear();
            automationEstimateSignatureByRoomTypeKey.clear();
            automationRecommendByRoomTypeKey.clear();
            automationRecommendSignatureByRoomTypeKey.clear();
            automationEstimateStatusText = t("pending");
            automationEstimateRunning = false;
            automationEstimateRunningMode = "";
            automationEstimateColumnEnabled = false;
            automationRecommendColumnEnabled = false;
            removeAutomationEstimateColumn(getAutomationEstimateTable());
            removeAutomationRecommendColumn(getAutomationEstimateTable());
            const existing = getControlPanel();
            if (existing && !manualUpdateRunning) {
                existing.remove();
            }
            return null;
        }

        // Automation page should render independently from active labyrinth room grid data.
        refreshAutomationEstimatePanel(state);

        const roomRows = Array.isArray(state.characterLabyrinth.roomData) ? state.characterLabyrinth.roomData : [];
        const flatRooms = roomRows.flat();
        if (!flatRooms.length) {
            if (isAutomationEstimatePanelVisible()) {
                markLabyrinthTransitionPreserveTooltip("");
            } else {
                markLabyrinthTransition("");
                hidePreviewTooltip();
            }
            return null;
        }

        const signature = getLabyrinthDisplaySignature(state);
        if (signature && signature !== lastLabyrinthDisplaySignature) {
            markLabyrinthTransition(signature);
            setControlStatus({
                running: false,
                ratio: 0,
                message: t("pending"),
            });
        }

        syncCompletedRoomCleanup(state);
        pruneInvalidRoomDisplays(state);

        const gridParent = findRoomGridParent(flatRooms.length);
        if (!gridParent) {
            if (!isAutomationEstimatePanelVisible()) {
                hidePreviewTooltip();
            }
            return null;
        }
        const panel = ensureControlPanel(gridParent);
        if (roomDistributionEnabled) {
            renderRoomDistributionPanel();
        }
        scheduleAutoRecalcIfNeeded(state);
        return panel;
    }

    async function updateRoomBadges(options = {}) {
        ensureStyle();
        hidePreviewTooltip();
        lastLabyrinthCalcDoneMessage = t("calcDone");

        const state = getGameState();
        if (!state || !state.characterLabyrinth || !Array.isArray(state.characterLabyrinth.roomData)) {
            markLabyrinthTransition("");
            setControlStatus({
                running: false,
                ratio: 0,
                message: t("notInLabyrinth"),
            });
            return false;
        }

        const roomRows = state.characterLabyrinth.roomData;
        const flatRooms = roomRows.flat();
        const colCount = Array.isArray(roomRows[0]) ? roomRows[0].length : 0;
        const targetRoomKeys = Array.isArray(options?.roomKeys) ? options.roomKeys : [];
        const hasTargetRoomFilter = targetRoomKeys.length > 0;
        if (!flatRooms.length) {
            markLabyrinthTransition("");
            setControlStatus({
                running: false,
                ratio: 0,
                message: t("noLabyrinthData"),
            });
            return false;
        }
        const runSignature = getLabyrinthDisplaySignature(state);
        lastLabyrinthDisplaySignature = runSignature;

        function isRunStale() {
            const latestSignature = getLabyrinthDisplaySignature(getGameState());
            return Boolean(runSignature && latestSignature && latestSignature !== runSignature);
        }

        const roomCells = findRoomGridCells(flatRooms.length);
        if (roomCells.length !== flatRooms.length) {
            setControlStatus({
                running: false,
                ratio: 0,
                message: t("cellsNotFound"),
            });
            return false;
        }
        ensureControlPanel(roomCells[0]?.parentElement || null);

        const combatTrials = saveCombatSimTrialsSetting(getSelectedCombatSimTrials());
        const targetIndexes = getTargetRoomIndexes(flatRooms, colCount, targetRoomKeys);
        if (hasTargetRoomFilter && targetIndexes.length === 0) {
            setControlStatus({
                running: false,
                ratio: 1,
                message: t("noNewTiles"),
            });
            return true;
        }
        const progressTracker = createProgressTracker(
            hasTargetRoomFilter
                ? getTotalProgressUnitsForIndexes(flatRooms, targetIndexes, combatTrials)
                : getTotalProgressUnits(flatRooms, combatTrials)
        );
        const initClientData = getInitClientData();
        const maxEnhancementByItem = buildMaxEnhancementByItem(state);
        const labyrinthUpgradeLevels = getLabyrinthUpgradeLevels(true);
        const targetCount = targetIndexes.length;
        const loanPersonalActionTypeBuffsDict =
            options && options.loanPersonalActionTypeBuffsDict && typeof options.loanPersonalActionTypeBuffsDict === "object"
                ? options.loanPersonalActionTypeBuffsDict
                : null;
        const selectedSealItemHrids = Array.isArray(options?.selectedSealItemHrids) ? options.selectedSealItemHrids : [];

        for (let targetPos = 0; targetPos < targetCount; targetPos += 1) {
            if (isRunStale()) {
                markLabyrinthTransition(getLabyrinthDisplaySignature(getGameState()));
                setControlStatus({
                    running: false,
                    ratio: 0,
                    message: t("pending"),
                });
                return false;
            }

            const i = targetIndexes[targetPos];
            const room = flatRooms[i];
            const cell = roomCells[i];
            const roomX = colCount > 0 ? i % colCount : -1;
            const roomY = colCount > 0 ? Math.floor(i / colCount) : -1;
            const roomKey = roomX >= 0 && roomY >= 0 ? `${roomX},${roomY}` : "";
            if (!cell) {
                continue;
            }

            const roomProgressMessage = hasTargetRoomFilter
                ? t("roomFmt", { current: targetPos + 1, total: targetCount })
                : t("roomFmt", { current: i + 1, total: flatRooms.length });
            const combatProgressMessage = hasTargetRoomFilter
                ? t("combatFmt", { current: targetPos + 1, total: targetCount })
                : t("combatFmt", { current: i + 1, total: flatRooms.length });

            let result = null;
            if (room?.roomType === LABYRINTH_SKILLING_ROOM_TYPE) {
                result = computeRoomClearChance(state, initClientData, room, maxEnhancementByItem, {
                    loanPersonalActionTypeBuffsDict,
                    labyrinthUpgradeLevels,
                });
                progressTracker.add(1, roomProgressMessage);
            } else if (room?.roomType === LABYRINTH_COMBAT_ROOM_TYPE) {
                setControlStatus({
                    running: true,
                    message: combatProgressMessage,
                });
                result = await computeCombatRoomClearChance(
                    state,
                    initClientData,
                    room,
                    maxEnhancementByItem,
                    progressTracker,
                    combatTrials,
                    roomKey,
                    {
                        selectedSealItemHrids,
                        labyrinthUpgradeLevels,
                    }
                );
            }

            if (isRunStale()) {
                markLabyrinthTransition(getLabyrinthDisplaySignature(getGameState()));
                setControlStatus({
                    running: false,
                    ratio: 0,
                    message: t("pending"),
                });
                return false;
            }

            if (!result) {
                removeBadge(cell);
                clearCellSkillingPreview(cell);
                clearCellCombatPreview(cell);
                if (isCalculableRoom(room)) {
                    clearRoomEstimate(roomKey);
                } else {
                    const rewardOnlyPreview = buildRewardOnlyPreview(state, room);
                    if (rewardOnlyPreview) {
                        setCellSkillingPreview(cell, rewardOnlyPreview);
                    }
                }
            } else {
                upsertBadge(cell, result.clearChance, result.expectedSecondsPerClear, result.debug);
                if (isCalculableRoom(room)) {
                    updateRoomEstimate(roomKey, result);
                }
                if (result.skillingPreview) {
                    setCellSkillingPreview(cell, result.skillingPreview);
                } else {
                    clearCellSkillingPreview(cell);
                }
                const combatPreview = buildCombatPreview(state, room, initClientData, result);
                if (combatPreview) {
                    setCellCombatPreview(cell, combatPreview);
                } else {
                    clearCellCombatPreview(cell);
                }
            }

            if ((targetPos + 1) % 2 === 0) {
                await nextFrame();
            }
        }

        const doneMessage = buildLabyrinthCalcDoneMessage(state, flatRooms, targetIndexes);
        lastLabyrinthCalcDoneMessage = doneMessage;
        progressTracker.finish(doneMessage);
        return true;
    }

    async function runManualUpdate(options = {}) {
        if (manualUpdateRunning) {
            return;
        }
        if (autoRecalcTimerId) {
            window.clearTimeout(autoRecalcTimerId);
            autoRecalcTimerId = 0;
        }
        pendingAutoRecalcRoomKeys.clear();
        const trigger = String(options?.trigger || "manual");
        const explicitLoanOptions = normalizeLoanSimulationOptions(options);
        let effectiveLoanOptions = explicitLoanOptions;
        if (!effectiveLoanOptions && trigger === "auto-new-tiles") {
            effectiveLoanOptions = normalizeLoanSimulationOptions(activeLoanSimulationOptions);
        }
        if (trigger !== "auto-new-tiles") {
            activeLoanSimulationOptions = effectiveLoanOptions ? deepCloneJson(effectiveLoanOptions) : null;
        }

        const runOptions = {
            ...(options && typeof options === "object" ? options : {}),
        };
        if (effectiveLoanOptions) {
            runOptions.loanPersonalActionTypeBuffsDict = deepCloneJson(effectiveLoanOptions.loanPersonalActionTypeBuffsDict);
            runOptions.selectedSealItemHrids = Array.isArray(effectiveLoanOptions.selectedSealItemHrids)
                ? Array.from(effectiveLoanOptions.selectedSealItemHrids)
                : [];
        } else {
            delete runOptions.loanPersonalActionTypeBuffsDict;
            delete runOptions.selectedSealItemHrids;
        }

        manualUpdateRunning = true;
        setControlStatus({
            running: true,
            ratio: 0,
            message: trigger === "auto-new-tiles" ? t("autoNewTiles") : t("preparing"),
        });

        try {
            const ok = await updateRoomBadges(runOptions);
            if (ok) {
                if (trigger !== "auto-new-tiles" && roomDistributionEnabled && !isRoomDistributionUnsupportedDevice()) {
                    try {
                        await calculateCurrentFloorRoomDistribution(runOptions);
                    } catch (distributionError) {
                        console.error("[Lab Clear Rate] room distribution calculation failed:", distributionError);
                    }
                }
                const latestState = getGameState();
                if (latestState?.characterLabyrinth) {
                    updateAutoRecalcBaseline(latestState);
                }
                setControlStatus({
                    running: false,
                    ratio: 1,
                    message: lastLabyrinthCalcDoneMessage || t("calcDone"),
                });
            }
        } catch (error) {
            console.error("[Lab Clear Rate] manual update failed:", error);
            if (trigger === "auto-new-tiles") {
                const latestState = getGameState();
                if (latestState?.characterLabyrinth) {
                    updateAutoRecalcBaseline(latestState);
                }
            }
            setControlStatus({
                running: false,
                message: t("calcFailed"),
            });
        } finally {
            manualUpdateRunning = false;
        }
    }

    function setInputControlValue(element, value) {
        if (!element) {
            return;
        }
        element.value = String(value ?? "");
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function setSelectControlValue(select, value) {
        if (!select || !select.options) {
            return false;
        }
        const target = String(value || "");
        if (!target) {
            return false;
        }
        for (const option of Array.from(select.options)) {
            if (String(option.value || "") === target) {
                select.value = option.value;
                select.dispatchEvent(new Event("input", { bubbles: true }));
                select.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
            }
        }

        const targetTail = target.split("/").pop() || target;
        for (const option of Array.from(select.options)) {
            const optionValue = String(option.value || "");
            const optionTail = optionValue.split("/").pop() || optionValue;
            if (optionTail === targetTail) {
                select.value = option.value;
                select.dispatchEvent(new Event("input", { bubbles: true }));
                select.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
            }
        }
        return false;
    }

    function setCheckboxControlValue(checkbox, checked) {
        if (!checkbox) {
            return false;
        }
        const target = checked === true;
        if (checkbox.checked !== target) {
            checkbox.checked = target;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return true;
    }

    function resolveSimulatorLabyrinthSelection(payload) {
        const monsterHrid = String(payload?.monsterHrid || "");
        if (!monsterHrid) {
            return null;
        }
        const roomLevelRaw = Number(payload?.mazeDifficulty);
        const roomLevel = Number.isFinite(roomLevelRaw) ? Math.max(20, Math.floor(roomLevelRaw)) : null;
        return {
            labyrinthHrid: monsterHrid,
            roomLevel,
        };
    }

    function applyMonsterSelectionOnSimulatorPage(payload) {
        let applied = false;
        setCheckboxControlValue(document.querySelector("input#simAllZoneToggle"), false);
        setCheckboxControlValue(document.querySelector("input#simAllSoloToggle"), false);
        setCheckboxControlValue(document.querySelector("input#simAllLabyrinthsToggle"), false);

        const labyrinthSelection = resolveSimulatorLabyrinthSelection(payload);
        if (!labyrinthSelection) {
            return false;
        }
        if (setCheckboxControlValue(document.querySelector("input#simLabyrinthToggle"), true)) {
            applied = true;
        }
        if (setCheckboxControlValue(document.querySelector("input#simDungeonToggle"), false)) {
            applied = true;
        }
        if (setSelectControlValue(document.querySelector("select#selectLabyrinth"), labyrinthSelection.labyrinthHrid)) {
            applied = true;
        }
        if (Number.isFinite(Number(labyrinthSelection.roomLevel))) {
            setInputControlValue(
                document.querySelector("input#inputRoomLevel"),
                String(Math.max(20, Math.floor(Number(labyrinthSelection.roomLevel))))
            );
            applied = true;
        }
        return applied;
    }

    function applySimulatorPlayerSelectionOnPage() {
        let applied = false;
        for (let i = 1; i <= 5; i += 1) {
            const checkbox = document.querySelector(`input#player${i}.form-check-input.player-checkbox`) || document.querySelector(`input#player${i}`);
            if (!checkbox) {
                continue;
            }
            const shouldCheck = i === 1;
            if (setCheckboxControlValue(checkbox, shouldCheck)) {
                applied = true;
            }
        }
        return applied;
    }

    function applySimulatorCrateSelectionOnPage(payload) {
        let applied = false;
        if (setSelectControlValue(document.querySelector("select#selectCoffeeCrates"), payload?.coffeeCrateItemHrid)) {
            applied = true;
        }
        if (setSelectControlValue(document.querySelector("select#selectFoodCrates"), payload?.foodCrateItemHrid)) {
            applied = true;
        }
        if (setSelectControlValue(document.querySelector("select#selectTeaCrates"), payload?.teaCrateItemHrid)) {
            applied = true;
        }
        return applied;
    }

    function applySimulatorLanguageOnPage(payload) {
        const nextLanguage = normalizeUiLanguage(payload?.uiLanguage) || UI_LANGUAGE_EN;
        try {
            localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, nextLanguage);
        } catch (_error) {
            // Ignore storage write errors.
        }
        try {
            if (window.i18next && typeof window.i18next.changeLanguage === "function") {
                window.i18next.changeLanguage(nextLanguage);
            }
        } catch (_error) {
            // Ignore language switching errors.
        }
    }

    function applySimulatorExtraBuffsOnPage(payload) {
        const configuredBuffs = Array.isArray(payload?.simulatorPersonalBuffItemHrids)
            ? payload.simulatorPersonalBuffItemHrids
            : [];
        const expected = new Set(
            configuredBuffs
                .map((value) => String(value || ""))
                .filter((value) => SIMULATOR_PERSONAL_BUFF_ITEM_HRIDS.has(value))
        );
        const toggle = document.querySelector("input#personalBuffsToggle");
        const buffInputs = Array.from(document.querySelectorAll("#personalBuffsBox input[type='checkbox']"));
        if (!toggle && buffInputs.length === 0) {
            return false;
        }

        let applied = false;
        if (toggle && setCheckboxControlValue(toggle, expected.size > 0)) {
            applied = true;
        }
        for (const input of buffInputs) {
            const value = String(input?.value || "");
            const shouldCheck = expected.has(value);
            if (setCheckboxControlValue(input, shouldCheck)) {
                applied = true;
            }
        }
        return applied;
    }

    function applySimulatorBridgeFieldsOnPage(payload, sanitizedImportSet) {
        applySimulatorLanguageOnPage(payload);
        applyMonsterSelectionOnSimulatorPage(payload);
        applySimulatorPlayerSelectionOnPage();
        applySimulatorCrateSelectionOnPage(payload);
        applySimulatorExtraBuffsOnPage(payload);

        if (Number.isFinite(Number(payload?.mazeDifficulty))) {
            const roomLevel = Math.max(20, Math.floor(Number(payload.mazeDifficulty)));
            setInputControlValue(document.querySelector("input#inputRoomLevel"), String(roomLevel));
        }

        if (sanitizedImportSet?.simulationTime !== undefined) {
            setInputControlValue(
                document.querySelector("input#inputSimulationTime"),
                String(sanitizedImportSet.simulationTime)
            );
        }
    }

    function collectSimulatorSupportedHrids(attributeName) {
        const supported = new Set();
        if (!attributeName) {
            return supported;
        }
        const selector = `[${attributeName}]`;
        for (const element of Array.from(document.querySelectorAll(selector))) {
            const hrid = String(element?.getAttribute(attributeName) || "").trim();
            if (hrid) {
                supported.add(hrid);
            }
        }
        return supported;
    }

    function sanitizeImportMapBySupportedHrids(rawMap, supportedHrids, transformValue) {
        const result = {};
        if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
            return result;
        }
        if (!(supportedHrids instanceof Set) || supportedHrids.size === 0) {
            return result;
        }
        for (const [rawKey, rawValue] of Object.entries(rawMap)) {
            const hrid = String(rawKey || "");
            if (!hrid || !supportedHrids.has(hrid)) {
                continue;
            }
            result[hrid] = typeof transformValue === "function" ? transformValue(rawValue) : rawValue;
        }
        return result;
    }

    function sanitizeSimulatorImportSetForPage(importSet) {
        if (!importSet || typeof importSet !== "object") {
            return importSet;
        }
        const sanitized = {
            ...importSet,
        };

        const supportedHouseRoomHrids = collectSimulatorSupportedHrids("data-house-hrid");
        sanitized.houseRooms = sanitizeImportMapBySupportedHrids(importSet.houseRooms, supportedHouseRoomHrids, (value) => {
            return Math.max(0, Math.floor(finiteNumber(value, 0)));
        });

        const supportedAchievementHrids = collectSimulatorSupportedHrids("data-achievement-hrid");
        sanitized.achievements = sanitizeImportMapBySupportedHrids(importSet.achievements, supportedAchievementHrids, (value) => {
            return value === true;
        });

        return sanitized;
    }

    function buildSimulatorGroupImportSetForPage(importSet) {
        if (!importSet || typeof importSet !== "object") {
            return null;
        }
        const serialized = JSON.stringify(importSet);
        return {
            1: serialized,
            2: serialized,
            3: serialized,
            4: serialized,
            5: serialized,
        };
    }

    function applySimulatorBridgePayloadOnSimulatorPage(payload) {
        const importSet = payload?.importSet;
        if (!importSet || typeof importSet !== "object") {
            return false;
        }

        const sanitizedImportSet = sanitizeSimulatorImportSetForPage(importSet);
        const importButton = document.querySelector("button#buttonImportSet");
        if (!importButton) {
            return false;
        }

        let imported = false;

        const groupTab = document.querySelector("a#group-combat-tab");
        if (groupTab) {
            groupTab.click();
        }
        const inputSetGroupAll = document.querySelector("input#inputSetGroupCombatAll, textarea#inputSetGroupCombatAll");
        if (inputSetGroupAll) {
            const groupImportSet = buildSimulatorGroupImportSetForPage(sanitizedImportSet);
            if (groupImportSet) {
                setInputControlValue(inputSetGroupAll, JSON.stringify(groupImportSet));
                importButton.click();
                imported = true;
            }
        }

        if (!imported) {
            const soloTab = document.querySelector("a#solo-tab");
            if (soloTab) {
                soloTab.click();
            }
            const inputSetSolo = document.querySelector("input#inputSetSolo, textarea#inputSetSolo");
            if (!inputSetSolo) {
                return false;
            }
            setInputControlValue(inputSetSolo, JSON.stringify(sanitizedImportSet));
            importButton.click();
            imported = true;
        }

        if (!imported) {
            return false;
        }

        applySimulatorBridgeFieldsOnPage(payload, sanitizedImportSet);
        // Some controls are initialized a moment after import completes.
        // Perform one delayed sync, but avoid long-running rewrites that block user edits.
        window.setTimeout(() => {
            applySimulatorBridgeFieldsOnPage(payload, sanitizedImportSet);
        }, 180);

        return true;
    }

    function bootstrapSimulatorBridgePage() {
        const payload = extractSimulatorBridgePayloadFromLocation();
        if (!payload || typeof payload !== "object") {
            return;
        }
        clearSimulatorBridgePayloadFromLocation();

        let attempts = 0;
        const maxAttempts = 120;
        const timerId = window.setInterval(() => {
            attempts += 1;
            try {
                if (applySimulatorBridgePayloadOnSimulatorPage(payload)) {
                    window.clearInterval(timerId);
                    return;
                }
            } catch (error) {
                console.error("[Lab Clear Rate] Simulator bridge apply failed:", error);
                window.clearInterval(timerId);
                return;
            }
            if (attempts >= maxAttempts) {
                window.clearInterval(timerId);
                console.error("[Lab Clear Rate] Simulator bridge timeout: import controls not found.");
            }
        }, 150);
    }

    migrateLegacySimulatorBridgeUrl();

    if (isSimulatorBridgePage()) {
        bootstrapSimulatorBridgePage();
        return;
    }

    initializeRoomLogState();
    installLiveActionRateWsHook();

    function schedulePanelRefresh() {
        if (panelRefreshTimerId) {
            return;
        }
        panelRefreshTimerId = window.setTimeout(() => {
            panelRefreshTimerId = 0;
            refreshControlPanelPlacement();
        }, PANEL_REFRESH_DEBOUNCE_MS);
    }

    const observer = new MutationObserver(() => {
        schedulePanelRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Fallback for state transitions that do not trigger childList mutations.
    window.setInterval(() => {
        schedulePanelRefresh();
    }, PANEL_REFRESH_POLL_MS);

    ensureStyle();
    if (refreshControlPanelPlacement()) {
        setControlStatus({
            running: false,
            ratio: 0,
            message: t("pending"),
        });
    }
})();
