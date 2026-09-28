import os
import re
import json
import urllib.request
import urllib.parse
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

    successful_scripts = []

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

            # 抓取腳本內的 @name（若無則依序取 scripts.json 的 name 或 id）
            name_match = re.search(r'//\s*@name\s+([^\r\n]+)', tw_content)
            if name_match:
                script_name = name_match.group(1).strip()
            else:
                script_name = converter.convert(item.get('name', script_id))

            successful_scripts.append({
                'id': script_id,
                'name': script_name,
                'install_url': target_raw_url
            })

            print(f"[✓] 轉換成功！總大小: {len(tw_content)} 字元 -> {output_file}")

        except Exception as e:
            print(f"[!] 處理 {script_id} 失敗: {e}")

    # 輸出整理好的清單
    generate_catalog(successful_scripts)

def generate_catalog(scripts_data):
    if not scripts_data:
        print("[!] 無任何成功轉換的腳本，略過生成清單。")
        return

    # 1. 寫入到專案根目錄的 README.md
    root_md_file = 'README.md'
    with open(root_md_file, 'w', encoding='utf-8') as f:
        f.write("# 繁體化 UserScript 腳本安裝清單\n\n")
        f.write("此儲存庫由 GitHub Actions 自動同步並轉換為繁體中文。\n\n")
        f.write("| 腳本名稱 | 安裝連結 |\n")
        f.write("| :--- | :--- |\n")
        for s in scripts_data:
            # 針對 URL 檔名中的空白與特殊符號編碼 (空格轉為 %20)
            encoded_url = urllib.parse.quote(s['install_url'], safe='/:')
            f.write(f"| **{s['name']}** | [點擊安裝]({encoded_url}) |\n")

    # 2. 備份輸出 JSON 清單於 dist/
    json_file = 'dist/scripts_list.json'
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(scripts_data, f, ensure_ascii=False, indent=2)

    print(f"\n[★] 清單建立完成：")
    print(f"    - 根目錄: {root_md_file}")
    print(f"    - 資料檔: {json_file}")

if __name__ == '__main__':
    process_scripts()
