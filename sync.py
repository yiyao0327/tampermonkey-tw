import os
import re
import json
import urllib.request
import opencc

# 採用臺灣正體模式 (包含詞彙轉換：軟件->軟體、內存->記憶體)
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

        print(f"[*] 正在處理: {item.get('name', script_id)}")

        try:
            req = urllib.request.Request(
                upstream_url,
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                content = res.read().decode('utf-8', errors='ignore')

            # 簡轉繁
            tw_content = converter.convert(content)

            # 改寫或補齊 @updateURL 與 @downloadURL
            if re.search(r'@updateURL\s+', tw_content):
                tw_content = re.sub(r'(@updateURL\s+)[^\r\n]+', rf'\g<1>{target_raw_url}', tw_content)
            else:
                tw_content = re.sub(r'(\/\/\s*==\/UserScript==)', f'// @updateURL    {target_raw_url}\n\\1', tw_content)

            if re.search(r'@downloadURL\s+', tw_content):
                tw_content = re.sub(r'(@downloadURL\s+)[^\r\n]+', rf'\g<1>{target_raw_url}', tw_content)
            else:
                tw_content = re.sub(r'(\/\/\s*==\/UserScript==)', f'// @downloadURL  {target_raw_url}\n\\1', tw_content)

            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(tw_content)

            print(f"[✓] 成功轉換: {output_file}")

        except Exception as e:
            print(f"[!] 處理 {script_id} 失敗: {e}")

if __name__ == '__main__':
    process_scripts()
