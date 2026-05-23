import os
import json
from pathlib import Path
from playwright.sync_api import Page

def wait_for_node_registration(page: Page, timeout=10000):
    """MultiTextノードがLiteGraphに登録されるまで待機し、そのノードタイプ名を返す"""
    return page.evaluate(f"""async (t) => {{
        const check = () => {{
            if (typeof window.LiteGraph === 'undefined') return null;
            const types = Object.keys(window.LiteGraph.registered_node_types);
            return types.find(type => type.includes('WebuiMonacoPromptMultiText') || type.includes('MultiText')) || null;
        }};
        
        let match = check();
        if (match) return match;
        
        const start = Date.now();
        while (Date.now() - start < t) {{
            await new Promise(r => setTimeout(r, 500));
            match = check();
            if (match) return match;
        }}
        return null;
    }}""", timeout)

def test_csv_parse_error_recovery(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    不正なCSVファイルが存在しても、エディタが正常に起動し、
    その後CSVを修正・リロードして正常に機能することを確認するテスト。
    """
    console_logs = []
    page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
    
    csv_dir = Path(os.getcwd()) / "csv"
    csv_dir.mkdir(exist_ok=True)
    bad_csv_path = csv_dir / "bad.csv"

    try:
        # 1. 不正なCSVを作成 (カラム数が足りないなど)
        # _addCSV で parse(relax_column_count: true) しているが、
        # 極端に壊れたデータやパースエラーを誘発させる
        content = "test_tag_bad,100,50\nanother_bad,200,30\n"
        with open(bad_csv_path, "w", encoding="utf-8") as f:
            f.write(content)

        page.set_viewport_size({"width": 1920, "height": 1080})
        wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)

        wmp_helpers.wait_for_graph_clear(page)

        node_type = wait_for_node_registration(page)
        assert node_type, "MultiText node type should be registered."

        wmp_helpers.create_node(page, node_type, [100, 300])

        # 2. エディタがタイムアウトせずに起動することを確認
        # (不正なCSVによって初期化がクラッシュしていないことの証明)
        wmp_helpers.wait_for_editor(page)

        # 3. CSVを修正する
        good_content = "tag1,cat1,200\ntag2,cat1,300\n"
        with open(bad_csv_path, "w", encoding="utf-8") as f:
            f.write(good_content)

        # 4. リロードボタン（もしあれば）または再起動相当の操作
        # ここではノードを新しく作り直すか、ページをリロードして確認
        page.reload()
        wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
        wmp_helpers.wait_for_graph_clear(page)
        wmp_helpers.create_node(page, node_type, [100, 300])
        
        wmp_helpers.wait_for_editor(page)
        
        page.wait_for_timeout(1000)

        # 強制クリックで確実にフォーカスを当てる (遮蔽物を無視)
        page.locator("prompt-editor .view-lines").first.click(force=True)
        page.keyboard.type("tag1")

        # API経由でサジェストをトリガー
        page.evaluate("() => { const pe = document.querySelector('prompt-editor'); if (pe) pe.triggerSuggest(); }")

        # API（モデル状態）経由でサジェスト表示完了を待機
        page.wait_for_function("() => { const pe = document.querySelector('prompt-editor'); return pe && pe.isSuggestVisible(); }", timeout=10000)

        # 候補に "tag1" が含まれているか確認する
        has_tag = page.evaluate("() => { const pe = document.querySelector('prompt-editor'); return pe ? pe.getSuggestList().some(s => s.includes('tag1')) : false; }")
        assert has_tag, "Suggest tag 'tag1' should be visible."

    finally:
        if console_logs:
            print("\n" + "="*20 + " BROWSER CONSOLE LOGS " + "="*20)
            for log in console_logs:
                print(log)
            print("="*60 + "\n")
        
        if bad_csv_path.exists():
            bad_csv_path.unlink()
