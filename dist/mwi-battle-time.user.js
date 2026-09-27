// ==UserScript==
// @name         [銀河奶牛]顯示戰鬥升級所需時間
// @version      1.4
// @description  顯示戰鬥升級所需時間
// @match        https://www.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://test.milkywayidlecn.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @author       DOUBAO-DiamondMoo
// @license      MIT
// @namespace    http://tampermonkey.net/
// @downloadURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/mwi-battle-time.user.js
// @updateURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/mwi-battle-time.user.js
// ==/UserScript==

(function() {
    'use strict';

    // 技能中英對照表
    const SKILL_MAP = {
        "/skills/stamina": "耐力",
        "/skills/intelligence": "智力",
        "/skills/attack": "攻擊",
        "/skills/defense": "防禦",
        "/skills/melee": "近戰",
        "/skills/ranged": "遠端",
        "/skills/magic": "魔法"
    };

    // 反向技能對映（通過技能名稱找key）
    const REVERSE_SKILL_MAP = Object.fromEntries(
        Object.entries(SKILL_MAP).flatMap(([key, value]) => [
            [value, key],
            [value.replace(/攻擊/, '攻击').replace(/防禦/, '防御').replace(/近戰/, '近战').replace(/遠程/, '远程'), key]
        ])
    );

    // 已處理的提示框列表，避免重複處理
    const processedTooltips = new Set();

    // 獲取遊戲核心狀態
    function getGameState() {
        try {
            // 獲取GamePage元素
            const gamePageEl = document.querySelector('[class^="GamePage"]');
            if (!gamePageEl) return null;

            // 提取react fiber節點
            const fiberKeys = Reflect.ownKeys(gamePageEl).filter(k =>
                k.startsWith('__reactFiber$')
            );

            if (fiberKeys.length === 0) return null;

            // 嘗試找到有效的fiber key
            for (const fiberKey of fiberKeys) {
                const stateNode = gamePageEl[fiberKey]?.return?.stateNode;
                if (stateNode?.state) {
                    return stateNode.state;
                }
            }

            return null;
        } catch (error) {
            console.log(`[升級時間指令碼] 獲取遊戲狀態出錯:`, error);
            return null;
        }
    }

    // 計算戰鬥持續時間（秒）
    function calculateBattleDuration(combatStartTime) {
        if (!combatStartTime) return 0;
        const start = new Date(combatStartTime).getTime();
        const now = new Date().getTime(); // 當前UTC時間（與start時區一致）
        return Math.max(1, Math.floor((now - start) / 1000)); // 最小1秒避免除零
    }

    // 格式化秒數為年日時分
    function formatSeconds(seconds) {
        const years = Math.floor(seconds / 31536000); // 365天×24小時×3600秒
        seconds %= 31536000;
        const days = Math.floor(seconds / 86400); // 24×3600
        seconds %= 86400;
        const hours = Math.floor(seconds / 3600);
        seconds %= 3600;
        const minutes = Math.floor(seconds / 60);

        // 拼接非零單位
        const parts = [];
        if (years > 0) parts.push(`${years.toLocaleString()} y`);
        if (days > 0) parts.push(`${days} d`);
        if (hours > 0) parts.push(`${hours} h`);
        if (minutes > 0 || parts.length === 0) parts.push(`${minutes} m`);
        return parts.join(' ');
    }

    // 處理技能提示框
    function handleSkillTooltip(tooltipEl) {
        try {
            // 檢查是否已處理過
            if (processedTooltips.has(tooltipEl)) return;
            processedTooltips.add(tooltipEl);

            const gameState = getGameState();
            if (!gameState) return;

            // 1. 獲取當前角色ID和戰鬥資訊
            const playerId = gameState.character?.id;
            const battlePlayers = gameState.battlePlayers;
            const combatStartTime = gameState.combatStartTime;

            // 校驗戰鬥狀態
            if (!playerId || !battlePlayers || !combatStartTime) {
                console.log("未在戰鬥中");
                return;
            }

            // 2. 找到當前玩家在戰鬥中的索引
            let playerIndex = battlePlayers.findIndex(
                p => p.character?.id === playerId
            );


            // 3. 獲取當前提示框的技能名稱
            const skillNameEl = tooltipEl.querySelector('.NavigationBar_name__jAIEQ');
            const skillName = skillNameEl?.textContent?.trim();
            if (!skillName || !REVERSE_SKILL_MAP[skillName]) {
                return;
            }

            // 4. 獲取該技能的總經驗和升級所需經驗
            const playerData = battlePlayers[playerIndex];
            const totalExpMap = playerData.totalSkillExperienceMap;
            const skillKey = REVERSE_SKILL_MAP[skillName];
            const totalExp = totalExpMap?.[skillKey] || 0;

            // 獲取升級所需經驗
            const needExpEl = tooltipEl.querySelector('div:nth-child(4)');
            const needExp = needExpEl
                ? parseFloat(needExpEl.textContent.replace(/[^0-9.-]/g, ''))
                : 0;

            if (totalExp <= 0 || needExp <= 0) {
                return;
            }

            // 5. 計算每小時經驗值
            const battleDurationSec = calculateBattleDuration(combatStartTime);
            const expPerHour = (totalExp / battleDurationSec) * 3600;
            if (expPerHour <= 0) {
                return;
            }

            // 6. 計算升級剩餘時間並建立元素
            const remainingSec = Math.ceil(needExp / expPerHour * 3600);
            const remainingTimeStr = formatSeconds(remainingSec);

            // 7. 計算升級具體時間
            function formatUpgradeTime(seconds) {
                const now = new Date();
                const upgradeDate = new Date(now.getTime() + seconds * 1000);

                const currentYear = now.getFullYear();
                const upgradeYear = upgradeDate.getFullYear();
                const month = String(upgradeDate.getMonth() + 1).padStart(2, '0');
                const day = String(upgradeDate.getDate()).padStart(2, '0');
                const hours = String(upgradeDate.getHours()).padStart(2, '0');
                const minutes = String(upgradeDate.getMinutes()).padStart(2, '0');

                // 如果升級時間超過30天且跨年度才顯示年份
                const days = Math.floor(seconds / 86400);
                if (days >= 30 && upgradeYear > currentYear) {
                    return `${upgradeYear}/${month}/${day} ${hours}:${minutes}`;
                } else {
                    return `${month}/${day} ${hours}:${minutes}`;
                }
            }

            const upgradeTimeStr = formatUpgradeTime(remainingSec);

            // 8. 插入或更新升級時間元素（避免重複）
            let timeEl = tooltipEl.querySelector('.upgrade-time-display');
            if (!timeEl) {
                timeEl = document.createElement('div');
                timeEl.className = 'upgrade-time-display';
                timeEl.style.cssText = 'line-height: 1.4;';
                // 插入到升級所需經驗之後、說明資訊之前
                const infoEl = tooltipEl.querySelector('.NavigationBar_info__3zahT');
                tooltipEl.insertBefore(timeEl, infoEl);
            }
            timeEl.innerHTML = `升級所需時間:  ${remainingTimeStr}<br>升級具體時間: ${upgradeTimeStr}`;

        } catch (error) {
            console.log(`[升級時間指令碼] 處理技能提示框出錯:`, error);
        }
    }

    // 初始化指令碼
    function initScript() {
        // 使用MutationObserver監聽DOM變化
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                // 檢查新增的節點
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        // 檢查節點本身是否是提示框
                        if (node.classList.contains('NavigationBar_navigationSkillTooltip__3a9Rz')) {
                            handleSkillTooltip(node);
                        }
                        // 檢查節點內是否包含提示框
                        const tooltips = node.querySelectorAll('.NavigationBar_navigationSkillTooltip__3a9Rz');
                        if (tooltips.length > 0) {
                            tooltips.forEach(tooltip => {
                                handleSkillTooltip(tooltip);
                            });
                        }
                    }
                });

                // 檢查修改的節點（提示框可能通過修改現有節點顯示）
                if (mutation.type === 'attributes' && mutation.target.nodeType === 1) {
                    const target = mutation.target;
                    // 檢查目標節點是否是提示框或包含提示框
                    if (target.classList.contains('NavigationBar_navigationSkillTooltip__3a9Rz')) {
                        handleSkillTooltip(target);
                    }
                    const tooltips = target.querySelectorAll('.NavigationBar_navigationSkillTooltip__3a9Rz');
                    if (tooltips.length > 0) {
                        tooltips.forEach(tooltip => {
                            handleSkillTooltip(tooltip);
                        });
                    }
                }
            });
        });

        // 監聽整個文件的變化
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'data-popper-placement'] // 常見的提示框變化屬性
        });
    }

    // 等待頁面完全載入後初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initScript);
    } else {
        initScript();
    }
})();