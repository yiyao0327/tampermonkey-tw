// ==UserScript==
// @name         MWI-Hit-Tracker
// @name:en      MWI-Hit-Tracker
// @namespace    http://tampermonkey.net/
// @version      1.2.5
// @description  戰鬥過程中即時顯示攻擊/治療命中目標
// @description:en Visualizing Attack/Heal Effects with Animated Lines‌
// @author       Artintel
// @license MIT
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://test.milkywayidlecn.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @grant        none
// @downloadURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/mwi-hit-tracker.user.js
// @updateURL https://raw.githubusercontent.com/yiyao0327/tampermonkey-tw/main/dist/mwi-hit-tracker.user.js
// ==/UserScript==

(function() {
    'use strict';

    const isZHInGameSetting = localStorage.getItem("i18nextLng")?.toLowerCase()?.startsWith("zh"); // 獲取遊戲內設定語言
    let isZH = isZHInGameSetting; // MWITools 本身顯示的語言預設由遊戲內設定語言決定

    /*
    const lineColor = [
        "rgba(255, 99, 132, 1)", // 淺粉色
        "rgba(54, 162, 235, 1)", // 淺藍色
        "rgba(255, 206, 86, 1)", // 淺黃色
        "rgba(75, 192, 192, 1)", // 淺綠色
        "rgba(153, 102, 255, 1)", // 淺紫色
        "rgba(255, 159, 64, 1)", // 淺橙色
        "rgba(255, 0, 0, 1)", // 敵人攻擊顏色
    ];
    const filterColor = [
        "rgba(255, 99, 132, 0.8)", // 淺粉色
        "rgba(54, 162, 235, 0.8)", // 淺藍色
        "rgba(255, 206, 86, 0.8)", // 淺黃色
        "rgba(75, 192, 192, 0.8)", // 淺綠色
        "rgba(153, 102, 255, 0.8)", // 淺紫色
        "rgba(255, 159, 64, 0.8)", // 淺橙色
        "rgba(255, 0, 0, 0.8)", // 敵人攻擊顏色
    ];
    */
    let settingsMap = {
        tracker0 : {
            id: "tracker0",
            desc: isZH ? "啟用玩家 #1 傷害線":"Enable player #1 damage line",
            isTrue: true,
            descH: isZH ? "啟用玩家 #1 治療線":"Enable player #1 healing line",
            isTrueH: true,
            r: 255,
            g: 99,
            b: 132,
        },
        tracker1 : {
            id: "tracker1",
            desc: isZH ? "啟用玩家 #2 傷害線":"Enable player #2 damage line",
            isTrue: true,
            descH: isZH ? "啟用玩家 #2 治療線":"Enable player #2 healing line",
            isTrueH: true,
            r: 54,
            g: 162,
            b: 235,
        },
        tracker2 : {
            id: "tracker2",
            desc: isZH ? "啟用玩家 #3 傷害線":"Enable player #3 damage line",
            isTrue: true,
            descH: isZH ? "啟用玩家 #3 治療線":"Enable player #3 healing line",
            isTrueH: true,
            r: 255,
            g: 206,
            b: 86,
        },
        tracker3 : {
            id: "tracker3",
            desc: isZH ? "啟用玩家 #4 傷害線":"Enable player #4 damage line",
            isTrue: true,
            descH: isZH ? "啟用玩家 #4 治療線":"Enable player #4 healing line",
            isTrueH: true,
            r: 75,
            g: 192,
            b: 192,
        },
        tracker4 : {
            id: "tracker4",
            desc: isZH ? "啟用玩家 #5 傷害線":"Enable player #5 damage line",
            isTrue: true,
            descH: isZH ? "啟用玩家 #5 治療線":"Enable player #5 healing line",
            isTrueH: true,
            r: 153,
            g: 102,
            b: 255,
        },
        tracker6 : {
            id: "tracker6",
            desc: isZH ? "啟用敵人傷害線":"Enable enemies damage line",
            isTrue: true,
            descH: isZH ? "啟用敵人治療線":"Enable enemies healing line",
            isTrueH: true,
            r: 255,
            g: 0,
            b: 0,
        },
        missedLine : {
            id: "missedLine",
            desc: isZH ? "啟用被閃避的攻擊線":"Enable missed attack line",
            isTrue: true,
        },
        moreEffect : {
            id: "moreEffect",
            desc: isZH ? "特效拓展：擊中時有粒子效果和目標震動":"Effects extension: particle effects & Target shake on hit",
            isTrue: true,
        }
    };
    readSettings();

    /* 指令碼設定面板 */
    const waitForSetttins = () => {
        const targetNode = document.querySelector("div.SettingsPanel_profileTab__214Bj");
        if (targetNode) {
            if (!targetNode.querySelector("#tracker_settings")) {
                targetNode.insertAdjacentHTML("beforeend", `<div id="tracker_settings"></div>`);
                const insertElem = targetNode.querySelector("div#tracker_settings");
                insertElem.insertAdjacentHTML(
                    "beforeend",
                    `<div style="float: left; color: orange">${
                        isZH ? "MWI-Hit-Tracker 設定 ：" : "MWI-Hit-Tracker Settings: "
                    }</div></br>`
                );

                for (const setting of Object.values(settingsMap)) {
                    if (/^tracker\d$/.test(setting.id)){
                        insertElem.insertAdjacentHTML(
                            "beforeend",
                            `<div class="tracker-option"><input type="checkbox" data-number="${setting.id}" data-param="isTrue" ${setting.isTrue ? "checked" : ""}></input>
                        <span style="margin-right:5px">${setting.desc}</span>
                        <input type="checkbox" data-number="${setting.id}" data-param="isTrueH" ${setting.isTrueH ? "checked" : ""}></input>
                        <span style="margin-right:5px">${setting.descH}</span>
                        <div class="color-preview" id="colorPreview_${setting.id}"></div>${isZH ? "←點選自定義顏色" : "←click to customize color"}</div>`
                        );
                        // 顏色自定義
                        const colorPreview = document.getElementById('colorPreview_'+setting.id);
                        let currentColor = { r: setting.r, g: setting.g, b: setting.b };

                        // 點選開啟顏色選擇器
                        colorPreview.addEventListener('click', () => {
                            const settingColor = { r: settingsMap[setting.id].r, g: settingsMap[setting.id].g, b: settingsMap[setting.id].b }
                            const modal = createColorPicker(settingColor, (newColor) => {
                                currentColor = newColor;
                                settingsMap[setting.id].r = newColor.r;
                                settingsMap[setting.id].g = newColor.g;
                                settingsMap[setting.id].b = newColor.b;
                                localStorage.setItem("tracker_settingsMap", JSON.stringify(settingsMap));
                                updatePreview();
                            });
                            document.body.appendChild(modal);
                        });

                        function updatePreview() {
                            colorPreview.style.backgroundColor = `rgb(${currentColor.r},${currentColor.g},${currentColor.b})`;
                        }

                        updatePreview();
                        function createColorPicker(initialColor, callback) {
                            // 建立彈窗容器
                            const backdrop = document.createElement('div');
                            backdrop.className = 'modal-backdrop';

                            const modal = document.createElement('div');
                            modal.className = 'color-picker-modal';

                            // 顏色預覽
                            //const preview = document.createElement('div');
                            //preview.className = 'color-preview';
                            //preview.style.height = '100px';
                            // 建立SVG容器
                            const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                            preview.setAttribute("width", "200");
                            preview.setAttribute("height", "150");
                            preview.style.display = 'block';
                            // 建立拋物線路徑
                            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                            Object.assign(path.style, {
                                strokeWidth: '5px',
                                fill: 'none',
                                strokeLinecap: 'round',
                            });
                            path.setAttribute("d", "M 0 130 Q 100 0 200 130");
                            preview.appendChild(path);

                            // 顏色控制組件
                            const controls = document.createElement('div');
                            ['r', 'g', 'b'].forEach(channel => {
                                const container = document.createElement('div');
                                container.className = 'slider-container';

                                // 標籤
                                const label = document.createElement('label');
                                label.textContent = channel.toUpperCase() + ':';
                                label.style.color = "white";

                                // 滑塊
                                const slider = document.createElement('input');
                                slider.type = 'range';
                                slider.min = 0;
                                slider.max = 255;
                                slider.value = initialColor[channel];

                                // 輸入框
                                const input = document.createElement('input');
                                input.type = 'number';
                                input.min = 0;
                                input.max = 255;
                                input.value = initialColor[channel];
                                input.style.width = '60px';

                                // 雙向繫結
                                const updateChannel = (value) => {
                                    value = Math.min(255, Math.max(0, parseInt(value) || 0));
                                    slider.value = value;
                                    input.value = value;
                                    currentColor[channel] = value;
                                    path.style.stroke = getColorString(currentColor);
                                };

                                slider.addEventListener('input', (e) => updateChannel(e.target.value));
                                input.addEventListener('change', (e) => updateChannel(e.target.value));

                                container.append(label, slider, input);
                                controls.append(container);
                            });

                            // 操作按鈕
                            const actions = document.createElement('div');
                            actions.className = 'modal-actions';

                            const confirmBtn = document.createElement('button');
                            confirmBtn.textContent = isZH ? '確定':'OK';
                            confirmBtn.onclick = () => {
                                callback(currentColor);
                                backdrop.remove();
                            };

                            const cancelBtn = document.createElement('button');
                            cancelBtn.textContent = isZH ? '取消':'Cancel';
                            cancelBtn.onclick = () => backdrop.remove();

                            actions.append(cancelBtn, confirmBtn);

                            // 組裝彈窗
                            const getColorString = (color) =>
                            `rgb(${color.r},${color.g},${color.b})`;

                            path.style.stroke = getColorString(settingsMap[setting.id]);
                            modal.append(preview, controls, actions);
                            backdrop.append(modal);

                            // 點選背景關閉
                            backdrop.addEventListener('click', (e) => {
                                if (e.target === backdrop) backdrop.remove();
                            });

                            return backdrop;
                        }
                    }else{
                        insertElem.insertAdjacentHTML(
                            "beforeend",
                            `<div class="tracker-option"><input type="checkbox" data-number="${setting.id}" data-param="isTrue" ${setting.isTrue ? "checked" : ""}></input>
                        <span style="margin-right:5px">${setting.desc}</span></div>`
                        );
                    }
                }

                insertElem.addEventListener("change", saveSettings);
            }
        }
        setTimeout(waitForSetttins, 500);
    };
    waitForSetttins();

    function saveSettings() {
        for (const checkbox of document.querySelectorAll("div#tracker_settings input")) {
            settingsMap[checkbox.dataset.number][checkbox.dataset.param] = checkbox.checked;
            localStorage.setItem("tracker_settingsMap", JSON.stringify(settingsMap));
        }
    }

    function readSettings() {
        const ls = localStorage.getItem("tracker_settingsMap");
        if (ls) {
            const lsObj = JSON.parse(ls);
            for (const option of Object.values(lsObj)) {
                if (settingsMap.hasOwnProperty(option.id)) {
                    settingsMap[option.id].isTrue = option.isTrue;
                    settingsMap[option.id].isTrueH = option.isTrueH;
                    settingsMap[option.id].r = option.r;
                    settingsMap[option.id].g = option.g;
                    settingsMap[option.id].b = option.b;
                }
            }
        }
    }

    let monstersHP = [];
    let monstersMP = [];
    let monstersDmgCounter = [];
    let playersHP = [];
    let playersMP = [];
    let playersDmgCounter = [];
    hookWS();

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
            if (socket.url.indexOf("api.milkywayidle.com/ws") <= -1 && socket.url.indexOf("api-test.milkywayidle.com/ws") <= -1 && socket.url.indexOf("api.milkywayidlecn.com/ws") <= -1 && socket.url.indexOf("api-test.milkywayidlecn.com/ws") <= -1) {
                return oriGet.call(this);
            }

            const message = oriGet.call(this);
            Object.defineProperty(this, "data", { value: message }); // Anti-loop

            return handleMessage(message);
        }
    }

    // 建立Toast函式
    function showToast(message, duration = 5000) {
        // 建立Toast元素
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.left = '50%';
        toast.style.bottom = '50px';
        toast.style.transform = 'translateX(-50%)';
        toast.style.backgroundColor = 'rgba(60, 60, 60, 0.8)';
        toast.style.color = 'white';
        toast.style.padding = '12px 24px';
        toast.style.borderRadius = '4px';
        toast.style.zIndex = '9999';
        toast.style.transition = 'opacity 0.3s ease';
        toast.style.opacity = '0';

        // 新增到body
        document.body.appendChild(toast);

        // 觸發重繪
        void toast.offsetWidth;

        // 顯示Toast
        toast.style.opacity = '1';

        // 自動消失
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, duration);
    }

    // 動畫效果
    const AnimationManager = {
        maxPaths: 50, // 最大同時存在path數
        activePaths: new Set(), // 當前活動路徑集合
        isCoolingDown: false, // 冷卻狀態標誌
        coolDownTimer: null, // 冷卻計時器

        canCreate() {
            // 冷卻期間禁止建立
            if (this.isCoolingDown) return false;
            // 超載進入冷卻
            if (this.activePaths.size >= this.maxPaths) {
                this.triggerCoolDown();
                return false;
            }
            // 數量檢查
            return this.activePaths.size < this.maxPaths;
        },

        addPath(path) {
            this.activePaths.add(path);
        },

        removePath(path) {
            this.activePaths.delete(path);
        },

        triggerCoolDown() {
            // 清除所有現有路徑
            this.activePaths.clear();
            const svg = document.getElementById('svg-container');
            if(svg && svg !== undefined) {
                svg.innerHTML = '';
            }
            // 設定冷卻狀態
            showToast(isZH?'動畫超過限制數'+this.maxPaths+'，進入5秒冷卻':'Animation limit reached ('+this.maxPaths+'), entering 5s cooldown');
            this.isCoolingDown = true;

            // 清除現有計時器（防止重複呼叫）
            if (this.coolDownTimer) {
                clearTimeout(this.coolDownTimer);
            }

            // 設定5秒冷卻計時器
            this.coolDownTimer = setTimeout(() => {
                this.isCoolingDown = false;
                this.coolDownTimer = null;
            }, 5000);
        }
    };

    function getElementCenter(element) {
        const rect = element.getBoundingClientRect();
        if (element.innerText.trim() === '') {
            return {
                x: rect.left + rect.width/2,
                y: rect.top
            };
        }
        return {
            x: rect.left + rect.width/2,
            y: rect.top + rect.height/2
        };
    }

    function createParabolaPath(startElem, endElem, reversed = false) {
        const start = getElementCenter(startElem);
        const end = getElementCenter(endElem);

        // 弧度調整位置（修改這個數值控制弧度）
        //const curveHeight = -120; // 數值越大弧度越高（負值向上彎曲）
        const curveRatio = reversed ? 4:2.5;
        const curveHeight = -Math.abs(start.x - end.x)/curveRatio;

        const controlPoint = {
            x: (start.x + end.x) / 2,
            y: Math.min(start.y, end.y) + curveHeight // 調整這裡
        };

        if (reversed) {return `M ${end.x} ${end.y} Q ${controlPoint.x} ${controlPoint.y}, ${start.x} ${start.y}`;}
        return `M ${start.x} ${start.y} Q ${controlPoint.x} ${controlPoint.y}, ${end.x} ${end.y}`;
    }

    function createEffect(startElem, endElem, hpDiff, index, reversed = false) {
        // 嘗試定位目標
        let hitTarget = undefined;
        let hitDamage = undefined;
        if (reversed) {
            if (hpDiff >= 0) {
                hitTarget = startElem.querySelector('.FullAvatar_fullAvatar__3RB2h');
            }
            const dmgDivs = startElem.querySelector('.CombatUnit_splatsContainer__2xcc0').querySelectorAll('div'); // 獲取所有 div
            for (const div of dmgDivs) {
                if (div.innerText.trim() === '') {
                    startElem = div;
                    hitDamage = div;
                    break;
                }
            }
        } else {
            if (hpDiff >= 0) {
                hitTarget = endElem.querySelector('.CombatUnit_monsterIcon__2g3AZ');
            }
            const dmgDivs = endElem.querySelector('.CombatUnit_splatsContainer__2xcc0').querySelectorAll('div'); // 獲取所有 div
            for (const div of dmgDivs) {
                if (div.innerText.trim() === '') {
                    endElem = div;
                    hitDamage = div;
                    break;
                }
            }
        }

        let strokeWidth = '1px';
        let filterWidth = '1px';
        let explosionSize = 1;
        // 治療的粗細度因子翻倍
        const hpDiffCoeff = hpDiff > 0 ? hpDiff : (-2*hpDiff);
        if (hpDiffCoeff >= 1000){
            strokeWidth = '5px';
            filterWidth = '6px';
            explosionSize = 6;
        } else if (hpDiffCoeff >= 700) {
            strokeWidth = '4px';
            filterWidth = '5px';
            explosionSize = 5;
        } else if (hpDiffCoeff >= 500) {
            strokeWidth = '3px';
            filterWidth = '4px';
            explosionSize = 4;
        } else if (hpDiffCoeff >= 300) {
            strokeWidth = '2px';
            filterWidth = '3px';
            explosionSize = 3;
        } else if (hpDiffCoeff >= 100) {
            filterWidth = '2px';
            explosionSize = 2;
        }

        const svg = document.getElementById('svg-container');
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

        if (reversed) {index = 6;}
        const trackerSetting = settingsMap["tracker"+index];
        const lineColor = "rgba("+trackerSetting.r+", "+trackerSetting.g+", "+trackerSetting.b+", 1)";
        const filterColor = "rgba("+trackerSetting.r+", "+trackerSetting.g+", "+trackerSetting.b+", 0.8)";
        Object.assign(path.style, {
            stroke: lineColor,
            strokeWidth: strokeWidth,
            fill: 'none',
            strokeLinecap: 'round',
            filter: 'drop-shadow(0 0 '+filterWidth+' '+filterColor+')'
        });
        const pathD = createParabolaPath(startElem, endElem, reversed);
        path.setAttribute('d', pathD);
        // 入場動畫
        const length = path.getTotalLength();
        path.style.strokeDasharray = length;
        path.style.strokeDashoffset = length;
        path.style.opacity = '1';

        svg.appendChild(path);
        // 註冊到管理器
        AnimationManager.addPath(path);
        // 移除邏輯
        const cleanUp = () => {
            try {
                if (path.parentNode) {
                    svg.removeChild(path);
                }
                AnimationManager.removePath(path);
            } catch(e) {
                console.error('Svg path cleanup error:', e);
            }
        };
        // 繪製動畫
        const endXY = pathD.split(', ')[1].split(' ');
        if (hpDiff === 0) {
            requestAnimationFrame(() => {
                path.style.transition = 'stroke-dashoffset 0.1s linear, opacity 0.3s linear';
                path.style.strokeDashoffset = '0';
                path.style.opacity = '0.4';
            });
            createMissEffect(hitDamage);
        } else {
            requestAnimationFrame(() => {
                path.style.transition = 'stroke-dashoffset 0.1s linear';
                path.style.strokeDashoffset = '0';
                // 新增動畫結束監聽
                path.addEventListener('transitionend', () => {
                    createHitEffect({x:endXY[0], y:endXY[1]}, svg, path, hitTarget, explosionSize, hitDamage);
                }, {once: true}); // 只觸發一次
            });
        }
        // 自動移除
        setTimeout(() => {
            // 1. 先重置transition
            path.style.transition = 'none';

            // 2. 重新設定dasharray實現反向動畫
            requestAnimationFrame(() => {
                // 保持當前可見狀態
                path.style.strokeDasharray = length;
                path.style.strokeDashoffset = '0';

                // 3. 開始消失動畫
                path.style.transition = 'stroke-dashoffset 0.3s cubic-bezier(0.4, 0, 1, 1)';
                path.style.strokeDashoffset = -length;

                // 4. 動畫結束後移除
                const removeElement = () => {
                    //svg.removeChild(path);
                    cleanUp();
                    path.removeEventListener('transitionend', removeElement);
                };
                path.addEventListener('transitionend', removeElement);
            });
        }, 600);
        // 強制清理保護
        const forceCleanupTimer = setTimeout(cleanUp, 5000); // 5秒後強制移除
        path.addEventListener('transitionend', () => clearTimeout(forceCleanupTimer));
        // 自動移除
        //setTimeout(() => {
        //    path.style.opacity = '0';
        //    path.style.transition = 'opacity 0.1s linear';
        //    setTimeout(() => svg.removeChild(path), 500);
        //}, 800);
    }

    // Miss特效建立函式
    function createMissEffect(hitDamage) {
        if (!settingsMap.moreEffect.isTrue) {
            return null;
        }
        if (hitDamage !== undefined) {
            hitDamage.animate(
                [{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }],
                {
                    duration: 600,
                    easing: 'ease-in-out'
                }
            );
        }
    }

    // 命中特效建立函式
    function createHitEffect(point, container, path, hitTarget = undefined, explosionSize = 1, hitDamage = undefined) {
        if (!settingsMap.moreEffect.isTrue) {
            return null;
        }
        // 衝擊波核心
        const WAVE_CONFIG = {
            startSize: explosionSize*2,// 初始半徑（建議8-12px）
            endSize: explosionSize*4,// 最大擴散半徑（建議25-40px）
            strokeWidth: 3,// 線寬（建議2-4px）
            duration: 500// 動畫時長（毫秒）
        };
        const core = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        core.setAttribute("cx", point.x);
        core.setAttribute("cy", point.y);
        core.setAttribute("r", "0");
        core.style.fill = 'rgba(255,255,255,0.9)';
        core.style.filter = 'blur(4px)';
        container.appendChild(core);

        core.animate([
            {
                r: WAVE_CONFIG.startSize,
                opacity: 1,
                strokeWidth: WAVE_CONFIG.strokeWidth
            },
            {
                r: WAVE_CONFIG.endSize,
                opacity: 0,
                strokeWidth: 0
            }
        ], {
            duration: WAVE_CONFIG.duration,
            easing: 'ease-out'
        }).onfinish = () => core.remove();

        const PARTICLES_CONFIG = {
            count: explosionSize*3,// 粒子數量（建議12-20）
            baseSize: 1+explosionSize/3,// 基礎半徑（1.5-3px）
            sizeVariation: 1.5,// 尺寸隨機變化量（±這個值）
            minSpeed: explosionSize*4,// 最小飛行距離（px）
            maxSpeed: explosionSize*8// 最大飛行距離（px）
        };

        for(let i=0; i<PARTICLES_CONFIG.count; i++) {
            const particle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            const size = PARTICLES_CONFIG.baseSize + Math.random()*PARTICLES_CONFIG.sizeVariation;
            particle.setAttribute("cx", point.x);
            particle.setAttribute("cy", point.y);
            particle.setAttribute("r", size);
            particle.style.fill = path.style.stroke;
            container.appendChild(particle);


            const angle = Math.random() * Math.PI*2;
            const dist = PARTICLES_CONFIG.minSpeed + Math.random()*(PARTICLES_CONFIG.maxSpeed-PARTICLES_CONFIG.minSpeed);
            particle.animate([
                {transform: `translate(0,0)`, opacity: 1},
                {transform: `translate(${Math.cos(angle)*dist}px, ${Math.sin(angle)*dist}px)`, opacity: 0}
            ], {
                duration: 400,
                easing: 'ease-out'
            }).onfinish = () => particle.remove();
        }

        // 震動效果（需要CSS支援）
        if (hitTarget!==undefined) {
            const shake = explosionSize*2-1;
            if (explosionSize < 3) {
                hitTarget.animate([
                    {transform: 'translate(0,0)'},
                    {transform: `translate(-${shake*2}px,-${shake}px)`},
                    {transform: `translate(${shake}px,${shake*2}px)`},
                    {transform: 'translate(0,0)'}
                ], {
                    duration: 90+explosionSize*10,
                    iterations: 2
                });
            } else if (explosionSize < 5) {
                hitTarget.animate([
                    {transform: 'translate(0,0)'},
                    {transform: `translate(-${shake*2}px,-${shake}px)`},
                    {transform: `translate(${shake}px,${shake*2}px)`},
                    {transform: `translate(-${shake}px,-${shake}px)`},
                    {transform: 'translate(0,0)'}
                ], {
                    duration: 90+explosionSize*10,
                    iterations: 2
                });
            } else {
                hitTarget.animate([
                    {transform: 'translate(0,0)'},
                    {transform: `translate(-${shake*2}px,-${shake}px)`},
                    {transform: `translate(${shake}px,-${shake}px)`},
                    {transform: `translate(${shake}px,${shake*2}px)`},
                    {transform: `translate(-${shake}px,${shake}px)`},
                    {transform: 'translate(0,0)'}
                ], {
                    duration: 90+explosionSize*10,
                    iterations: 2
                });
            }
        }

        // 傷害數字蹦出
        if (hitDamage!==undefined) {
            const originalZIndex = hitDamage.style.zIndex || 'auto';
            if (explosionSize < 3) {
                hitDamage.animate([
                    { transform: 'scale(1)', offset: 0 },
                    { transform: 'scale(1.2)', offset: 0.6 },
                    { transform: 'scale(0.9)', offset: 0.85 },
                    { transform: 'scale(1)', offset: 1 }
                ], {
                    duration: 1500,
                    easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                });
            } else if (explosionSize < 5) {
                hitDamage.animate([
                    { transform: 'scale(1)', offset: 0 },
                    { transform: 'scale(1.4)', offset: 0.6 },
                    { transform: 'scale(0.9)', offset: 0.85 },
                    { transform: 'scale(1)', offset: 1 }
                ], {
                    duration: 1800,
                    easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                });
            } else {
                hitDamage.animate([
                    { transform: 'scale(1)', offset: 0 },
                    { transform: 'scale(1.6)', offset: 0.6 },
                    { transform: 'scale(0.9)', offset: 0.85 },
                    { transform: 'scale(1)', offset: 1 }
                ], {
                    duration: 2100,
                    easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                });
            }
        }
    }

    // 新增視窗resize監聽
    let isResizeListenerAdded = false;
    function createLine(from, to, hpDiff, reversed = false) {
        if (hpDiff === 0 && !settingsMap.missedLine.isTrue) {return null;}
        if (hpDiff >= 0) {
            if (reversed){
                if (!settingsMap.tracker6.isTrue) {
                    return null;
                }
            } else {
                if (!settingsMap["tracker"+from].isTrue) {
                    return null;
                }
            }
        } else {
            if (reversed){
                if (!settingsMap.tracker6.isTrueH) {
                    return null;
                }
            } else {
                if (!settingsMap["tracker"+from].isTrueH) {
                    return null;
                }
            }
        }
        if (!AnimationManager.canCreate()) {
            return null; // 同時存在數量超出上限
        }
        const container = document.querySelector(".BattlePanel_playersArea__vvwlB");
        if (container && container.children.length > 0) {
            const playersContainer = container.children[0];
            const monsterContainer = document.querySelector(".BattlePanel_monstersArea__2dzrY").children[0];
            const effectFrom = (reversed&&hpDiff<0)?monsterContainer.children[from]:playersContainer.children[from];
            const effectTo = (!reversed&&hpDiff<0)?playersContainer.children[to]:monsterContainer.children[to];
            const svg = document.getElementById('svg-container');
            if(!svg){
                const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svgContainer.id = 'svg-container';
                Object.assign(svgContainer.style, {
                    position: 'fixed',
                    top: '0',
                    left: '0',
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    overflow: 'visible',
                    zIndex: '190'
                });

                // 設定SVG原生屬性
                svgContainer.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
                svgContainer.setAttribute('preserveAspectRatio', 'none');
                // 初始化viewBox
                const updateViewBox = () => {
                    if (document.getElementById('svg-container') !== undefined) {
                        document.getElementById('svg-container').setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
                    }
                };
                //playersContainer.appendChild(svgContainer);
                document.querySelector(".GamePage_mainPanel__2njyb").appendChild(svgContainer);
                updateViewBox();
                //document.body.appendChild(svgContainer);
                // 新增resize監聽（確保只新增一次）
                if (!isResizeListenerAdded) {
                    window.addEventListener('resize', () => {
                        updateViewBox();
                    });
                    isResizeListenerAdded = true;
                }
            }

            if (reversed) {
                createEffect(effectFrom, effectTo, hpDiff, to, reversed);
            } else {
                createEffect(effectFrom, effectTo, hpDiff, from, reversed);
            }
        }

    }

    function handleMessage(message) {
        let obj = JSON.parse(message);
        if (obj && obj.type === "new_battle") {
            monstersHP = obj.monsters.map((monster) => monster.currentHitpoints);
            monstersMP = obj.monsters.map((monster) => monster.currentManapoints);
            monstersDmgCounter = obj.monsters.map((monster) => monster.damageSplatCounter);
            playersHP = obj.players.map((player) => player.currentHitpoints);
            playersMP = obj.players.map((player) => player.currentManapoints);
            playersDmgCounter = obj.players.map((player) => player.damageSplatCounter);
        } else if (obj && obj.type === "battle_updated" && monstersHP.length) {
            const mMap = obj.mMap;
            const pMap = obj.pMap;
            const monsterIndices = Object.keys(obj.mMap);
            const playerIndices = Object.keys(obj.pMap);

            let castMonster = -1;
            monsterIndices.forEach((monsterIndex) => {
                if(mMap[monsterIndex].cMP < monstersMP[monsterIndex]){castMonster = monsterIndex;}
                monstersMP[monsterIndex] = mMap[monsterIndex].cMP;
            });
            let castPlayer = -1;
            playerIndices.forEach((userIndex) => {
                if(pMap[userIndex].cMP < playersMP[userIndex]){castPlayer = userIndex;}
                playersMP[userIndex] = pMap[userIndex].cMP;
            });

            let hurtMonster = false;
            let hurtPlayer = false;
            let monsterLifeSteal = {from:null, to:null, hpDiff:null};
            let playerLifeSteal = {from:null, to:null, hpDiff:null};
            monstersHP.forEach((mHP, mIndex) => {
                const monster = mMap[mIndex];
                if (monster) {
                    const hpDiff = mHP - monster.cHP;
                    if (hpDiff > 0) {hurtMonster = true;}
                    let dmgSplat = false;
                    if (monstersDmgCounter[mIndex] < monster.dmgCounter) {dmgSplat = true;}//判斷是否受擊（包括命中和miss）
                    monstersHP[mIndex] = monster.cHP;
                    monstersDmgCounter[mIndex] = monster.dmgCounter;
                    if (dmgSplat && hpDiff >= 0 && playerIndices.length > 0) {
                        if (playerIndices.length > 1) {
                            playerIndices.forEach((userIndex) => {
                                if(userIndex === castPlayer) {
                                    createLine(userIndex, mIndex, hpDiff);
                                }
                            });
                        } else {
                            createLine(playerIndices[0], mIndex, hpDiff);
                        }
                    }
                    // 治療線
                    if (hpDiff < 0 ) {
                        if (castMonster > -1){
                            createLine(mIndex, castMonster, hpDiff, true);
                        }else{
                            // 可能為吸血，暫存資訊在之後判斷
                            monsterLifeSteal.from=mIndex;
                            monsterLifeSteal.to=mIndex;
                            monsterLifeSteal.hpDiff=hpDiff;
                        }
                    }
                }
            });

            playersHP.forEach((pHP, pIndex) => {
                const player = pMap[pIndex];
                if (player) {
                    const hpDiff = pHP - player.cHP;
                    if (hpDiff > 0) {hurtPlayer = true;}
                    let dmgSplat = false;
                    if (playersDmgCounter[pIndex] < player.dmgCounter) {dmgSplat = true;}//判斷是否受擊（包括命中和miss）
                    playersHP[pIndex] = player.cHP;
                    playersDmgCounter[pIndex] = player.dmgCounter;
                    if (dmgSplat && hpDiff >= 0 && monsterIndices.length > 0) {
                        if (monsterIndices.length > 1) {
                            monsterIndices.forEach((monsterIndex) => {
                                if(monsterIndex === castMonster) {
                                    createLine(pIndex, monsterIndex, hpDiff, true);
                                }
                            });
                        } else {
                            createLine(pIndex, monsterIndices[0], hpDiff, true);
                        }
                    }
                    // 治療線
                    if (hpDiff < 0 ) {
                        if (castPlayer > -1){
                            createLine(castPlayer, pIndex, hpDiff);
                        }else{
                            // 可能為吸血，暫存資訊在之後判斷
                            playerLifeSteal.from=pIndex;
                            playerLifeSteal.to=pIndex;
                            playerLifeSteal.hpDiff=hpDiff;
                        }
                    }
                }
            });

            // 補充場景：不使用MP（也就是普攻）吸血時造成治療，即前提條件是傷及對方陣營
            if (hurtMonster && playerLifeSteal.from !== null) {
                createLine(playerLifeSteal.from, playerLifeSteal.to, playerLifeSteal.hpDiff);
            }
            if (hurtPlayer && monsterLifeSteal.from !== null) {
                createLine(monsterLifeSteal.from, monsterLifeSteal.to, monsterLifeSteal.hpDiff, true);
            }
        }
        return message;
    }

    const style = document.createElement('style');
    style.textContent = `
        .tracker-option {
          display: flex;
          align-items: center;
        }

        .color-preview {
            cursor: pointer;
            width: 20px;
            height: 20px;
            margin: 3px 3px;
            border: 1px solid #ccc;
            border-radius: 3px;
        }

        .color-picker-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.5);
            padding: 20px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            box-shadow: 0 0 20px rgba(0,0,0,0.2);
            z-index: 1000;
        }

        .modal-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 999;
        }

        .modal-actions {
            margin-top: 20px;
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }
    `;
    document.head.appendChild(style);

})();