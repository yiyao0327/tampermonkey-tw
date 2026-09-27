import os
import re
import json
import urllib.request
import opencc

# 採用臺灣正體模式 (包含詞彙轉換)
converter = opencc.OpenCC('s2twp')

GITHUB_REPOSITORY = os.environ.get('GITHUB_REPOSITORY', 'username/repo')
BRANCH = 'main'
RAW_BASE_URL = f"https://raw.githubusercontent.com/{GITHUB_REPOSITORY}/{BRANCH}/dist"

def process_scripts():
    if not os.path.exists('dist'):
        os.makedirs('dist')

    with open('scripts.json', 'r', encoding='utf-8') as f:
        scripts = json.load(f)

    for item in scripts:
        script_id = item['id']
        upstream_url = item['upstream']
        output_file = f"dist/{script_id}.user.js"
        target_raw_url = f"{RAW_BASE_URL}/{script_id}.user.js"

        print(f"[*] 正在處理: {item.get('name', script_id)} ({upstream_url})")

        try:
            req = urllib.request.Request(
                upstream_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                content = res.read().decode('utf-8', errors='ignore')

            if not content.strip():
                print(f"[!] 警告: 從 {upstream_url} 下載到的內容為空！")
                continue

            # 1. 簡轉繁轉換
            tw_content = converter.convert(content)

            # 2. 安全替換/插入 @updateURL 與 @downloadURL
            # 先檢查是否有更新網址，若有則直接替換該行
            if re.search(r'//\s*@updateURL\b', tw_content):
                tw_content = re.sub(r'(//\s*@updateURL\s+)[^\r\n]+', rf'\g<1>{target_raw_url}', tw_content)
            else:
                # 若無，精準插入在 ==/UserScript== 之前的一行
                tw_content = re.sub(r'(\n//\s*==/UserScript==)', f'\n// @updateURL    {target_raw_url}\\1', tw_content, count=1)

            if re.search(r'//\s*@downloadURL\b', tw_content):
                tw_content = re.sub(r'(//\s*@downloadURL\s+)[^\r\n]+', rf'\g<1>{target_raw_url}', tw_content)
            else:
                tw_content = re.sub(r'(\n//\s*==/UserScript==)', f'\n// @downloadURL  {target_raw_url}\\1', tw_content, count=1)

            # 3. 寫入檔案
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(tw_content)

            print(f"[✓] 成功轉換並輸出，檔案大小: {len(tw_content)} 字元 -> {output_file}")

        except Exception as e:
            print(f"[!] 處理 {script_id} 失敗: {e}")

if __name__ == '__main__':
    process_scripts()
