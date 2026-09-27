import os
import re
import json
import urllib.request
import datetime
import opencc

# 採用臺灣正體慣用詞彙模式 (例如：內存 -> 記憶體、軟件 -> 軟體)
converter = opencc.OpenCC('s2twp')

# 取得 Repo 資訊 (GitHub Actions 環境變數注入)
GITHUB_REPOSITORY = os.environ.get('GITHUB_REPOSITORY', 'yiyao0327/tampermonkey-tw')
BRANCH = 'main'
RAW_BASE_URL = f"https://raw.githubusercontent.com/{GITHUB_REPOSITORY}/{BRANCH}/dist"

def process_scripts():
    if not os.path.exists('dist'):
        os.makedirs('dist')

    with open('scripts.json', 'r', encoding='utf-8') as f:
        scripts = json.load(f)

    processed_list = []

    for item in scripts:
        script_id = item['id']
        name = item.get('name', script_id)
        upstream_url = item['upstream']
        
        # 防呆機制：若網址誤填了只有元數據的 .meta.js，自動修正為包含代碼本體的 .user.js
        if upstream_url.endswith('.meta.js'):
            upstream_url = upstream_url[:-8] + '.user.js'

        output_file = f"dist/{script_id}.user.js"
        target_raw_url = f"{RAW_BASE_URL}/{script_id}.user.js"

        print(f"[*] 正在處理: {name} -> {upstream_url}")

        try:
            req = urllib.request.Request(
                upstream_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                content = res.read().decode('utf-8', errors='ignore')

            if len(content.strip().splitlines()) <= 15:
                print(f"[!] 警告: 從 {upstream_url} 下載到的內容過短，請確認是否為完整腳本。")

            # 1. 簡體轉換為臺灣正體
            tw_content = converter.convert(content)

            # 2. 針對銀河奶牛等特定腳本技能對照表的相容相容處理 (防止繁化後無法匹配遊戲內簡體文字)
            if 'REVERSE_SKILL_MAP' in tw_content and 'SKILL_MAP' in tw_content:
                tw_content = tw_content.replace(
                    'const REVERSE_SKILL_MAP = Object.fromEntries(\n        Object.entries(SKILL_MAP).map(([key, value]) => [value, key])\n    );',
                    '''const REVERSE_SKILL_MAP = Object.fromEntries(
        Object.entries(SKILL_MAP).flatMap(([key, value]) => [
            [value, key],
            [value.replace(/攻擊/, '攻击').replace(/防禦/, '防御').replace(/近戰/, '近战').replace(/遠程/, '远程'), key]
        ])
    );'''
                )

            # 3. 改寫或補齊 @updateURL 與 @downloadURL 指向你的 GitHub Raw 網址
            if re.search(r'//\s*@updateURL\b', tw_content):
                tw_content = re.sub(r'(//\s*@updateURL\s+)[^\r\n]+', rf'\g<1>{target_raw_url}', tw_content)
            else:
                tw_content = re.sub(r'(\n//\s*==/UserScript==)', f'\n// @updateURL    {target_raw_url}\\1', tw_content, count=1)

            if re.search(r'//\s*@downloadURL\b', tw_content):
                tw_content = re.sub(r'(//\s*@downloadURL\s+)[^\r\n]+', rf'\g<1>{target_raw_url}', tw_content)
            else:
                tw_content = re.sub(r'(\n//\s*==/UserScript==)', f'\n// @downloadURL  {target_raw_url}\\1', tw_content, count=1)

            # 4. 寫入 dist 目錄
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(tw_content)

            tw_name = converter.convert(name)
            processed_list.append({
                "name": tw_name,
                "raw_url": target_raw_url,
                "upstream": upstream_url,
                "id": script_id
            })

            print(f"[✓] 轉換成功！總大小: {len(tw_content)} 字元 -> {output_file}")

        except Exception as e:
            print(f"[!] 處理 {script_id} 失敗: {e}")

    # 5. 更新 README.md 清單
    generate_readme(processed_list)

def generate_readme(scripts):
    # 計算 UTC+8 當前時間
    tz = datetime.timezone(datetime.timedelta(hours=8))
    now_str = datetime.datetime.now(tz).strftime('%Y-%m-%d %H:%M:%S')

    readme_content = f"""# 竄改猴腳本繁體中文自動同步庫

本專案每日定時追蹤上游簡體中文腳本，自動透過 OpenCC 轉換為臺灣正體慣用詞，並重定向 `@updateURL`。  
安裝後只要原作者有更新，便會**自動拉取繁體最新版本**。

> **最後同步時間**：`{now_str} (UTC+8)`

---

## 📋 腳本訂閱與安裝清單

在已安裝 Tampermonkey 的瀏覽器中，直接點擊「**🚀 點我安裝**」即可跳出安裝視窗：

| 腳本名稱 | 竄改猴一鍵安裝 | 上游來源 |
| :--- | :---: | :---: |
"""

    for s in scripts:
        readme_content += f"| **{s['name']}** | [🚀 點我安裝]({s['raw_url']}) | [查看原腳本]({s['upstream']}) |\n"

    readme_content += """
---

## 🛠️ 如何新增腳本？
編輯 `scripts.json`，在陣列中加入物件：
```json
{
  "id": "腳本專屬代稱",
  "name": "腳本名稱",
  "upstream": "原作者的 .user.js 網址"
}
"""

with open('README.md', 'w', encoding='utf-8') as f:
    f.write(readme_content)

print("[✓] 首頁 README.md 清單已成功更新！")
if name == 'main':
process_scripts()


---

### 檔案 3：`.github/workflows/sync.yml`

自動化排程設定。已鎖定穩定的系統版本，並使用 `git add -A` 確保產出的腳本與 `README.md` 都會自動提交儲存：

```yaml
name: Sync & Convert Scripts to Traditional Chinese

on:
  schedule:
    # 每天台灣時間凌晨 02:00 自動執行
    - cron: '0 18 * * *'
  workflow_dispatch: # 支援在 GitHub 網頁上手動一鍵執行

jobs:
  sync:
    # 明確指定 LTS 映像檔，消除 ubuntu-latest 遷移警告
    runs-on: ubuntu-24.04
    steps:
      - name: 檢出儲存庫代碼
        uses: actions/checkout@v4

      - name: 設定 Python 環境
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: 安裝 opencc 套件
        run: pip install opencc

      - name: 執行轉換排程
        env:
          GITHUB_REPOSITORY: ${{ github.repository }}
        run: python sync.py

      - name: 提交並推送更新
        run: |
          git config --local user.name "github-actions[bot]"
          git config --local user.email "github-actions[bot]@users.noreply.github.com"
          git add -A
          if git diff --staged --quiet; then
            echo "沒有任何更新，略過提交。"
          else
            git commit -m "chore: 自動更新繁體腳本與訂閱清單 [skip ci]"
            git push
          fi
