import os
import re
import json
import urllib.request
import opencc

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
        
        # 自動防呆：如果網址誤填了 .meta.js，自動轉為 .user.js
        if upstream_url.endswith('.meta.js'):
            upstream_url = upstream_url[:-8] + '.user.js'

        output_file = f"dist/{script_id}.user.js"
        target_raw_url = f"{RAW_BASE_URL}/{script_id}.user.js"

        print(f"[*] 正在處理: {item.get('name', script_id)} -> {upstream_url}")

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
                print(f"[!] 警告: 從 {upstream_url} 下載到的內容過短（僅 {len(content)} 字元），可能不是完整腳本！")

            # 1. 簡轉繁轉換 (正體中文)
            tw_content = converter.convert(content)

            # 2. 針對該遊戲腳本的特殊相容 (同時支援遊戲介面的簡體與繁體名稱)
            tw_content = tw_content.replace(
                'const REVERSE_SKILL_MAP = Object.fromEntries(\n        Object.entries(SKILL_MAP).map(([key, value]) => [value, key])\n    );',
                '''const REVERSE_SKILL_MAP = Object.fromEntries(
        Object.entries(SKILL_MAP).flatMap(([key, value]) => [
            [value, key],
            [value.replace(/攻擊/, '攻击').replace(/防禦/, '防御').replace(/近戰/, '近战').replace(/遠程/, '远程'), key]
        ])
    );'''
            )

            # 3. 改寫 @updateURL 與 @downloadURL
            if re.search(r'//\s*@updateURL\b', tw_content):
                tw_content = re.sub(r'(//\s*@updateURL\s+)[^\r\n]+', rf'\g<1>{target_raw_url}', tw_content)
            else:
                tw_content = re.sub(r'(\n//\s*==/UserScript==)', f'\n// @updateURL    {target_raw_url}\\1', tw_content, count=1)

            if re.search(r'//\s*@downloadURL\b', tw_content):
                tw_content = re.sub(r'(//\s*@downloadURL\s+)[^\r\n]+', rf'\g<1>{target_raw_url}', tw_content)
            else:
                tw_content = re.sub(r'(\n//\s*==/UserScript==)', f'\n// @downloadURL  {target_raw_url}\\1', tw_content, count=1)

            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(tw_content)

            print(f"[✓] 轉換成功！總大小: {len(tw_content)} 字元 -> {output_file}")

        except Exception as e:
            print(f"[!] 處理 {script_id} 失敗: {e}")

if __name__ == '__main__':
    process_scripts()
