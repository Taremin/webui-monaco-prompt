import pytest
from playwright.sync_api import Page, expect
import os
from pathlib import Path
import uuid

def create_static_test_csv(unique_id: str):
    """Create a static test CSV file to ensure stable test environment."""
    extension_path = os.environ.get("COMFYUI_EXTENSION_PATH", os.getcwd())
    csv_dir = Path(extension_path) / "csv"
    csv_dir.mkdir(exist_ok=True)
    basename = f"test_auto_{unique_id}"
    test_csv_path = csv_dir / f"{basename}.csv"
    
    content = f"zzz_unique_apple_{unique_id},100\nzzz_unique_banana_{unique_id},50\n"
    with open(test_csv_path, "w", encoding="utf-8") as f:
        f.write(content)
    
    return test_csv_path, basename

def test_multitext_csv_autocomplete_toggle(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    page.set_viewport_size({"width": 1920, "height": 1080})
    
    # 1. 準備：テスト用CSVの作成
    unique_id = str(uuid.uuid4())[:8]
    test_csv_path, basename = create_static_test_csv(unique_id)
    target_tag = f"zzz_unique_apple_{unique_id}"
    context_key = f"csv.{basename}"

    try:
        wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
        wmp_helpers.wait_for_graph_clear(page)

        # ノードを作成してキャンバスに配置
        page.evaluate(f"""() => {{
            const findApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = findApp();
            const types = Object.keys(window.LiteGraph.registered_node_types);
            const nodeType = types.find(t => t.includes('WebuiMonacoPromptMultiText') || t.includes('MultiText'));
            
            const node1 = window.LiteGraph.createNode(nodeType);
            node1.pos = [100, 300];
            app.graph.add(node1);
            
            app.canvas.centerOnNode(node1);
        }}""")

        wmp_helpers.wait_for_editor(page)
        
        # エディタのShadow DOM内にフォーカス
        editor_locator = page.locator("prompt-editor").first
        editor_locator.scroll_into_view_if_needed()
        editor_locator.click()
        
        # CSVを確実に読み込ませるためにRefreshを呼ぶ
        refresh_btn = page.locator("button:has-text('Refresh')")
        if refresh_btn.is_visible():
            refresh_btn.click()
        else:
            page.evaluate("""() => {
                const findApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
                const app = findApp();
                if (app.refreshComboInNodes) {
                    app.refreshComboInNodes();
                } else if (app.extensionManager && app.extensionManager.refreshComboInNodes) {
                    app.extensionManager.refreshComboInNodes();
                }
            }""")
            
        # 確実にロードされるのを待機
        page.wait_for_function(f"""() => {{
            const findApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = findApp();
            const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
            if (nodes.length === 0) return false;
            const editor = nodes[0].multitext_widget.editorInstance;
            if (!editor) return false;
            
            const val = editor.getContext(editor.createContextKey("{context_key}"));
            return val !== undefined && val !== null;
        }}""")

        # 2. デフォルト状態（CSVオン）でのサジェスト確認
        page.evaluate("() => { const pe = document.querySelector('prompt-editor'); if (pe) pe.focus(); }")
        page.keyboard.type("zzz_unique_")
        
        # API経由でサジェスト起動
        page.evaluate("() => { const pe = document.querySelector('prompt-editor'); if (pe) pe.triggerSuggest(); }")
        
        # API経由で表示完了を待機
        page.wait_for_function("() => { const pe = document.querySelector('prompt-editor'); return pe && pe.isSuggestVisible(); }", timeout=10000)
        
        # 候補が含まれているか確認
        has_tag = page.evaluate(f"() => {{ const pe = document.querySelector('prompt-editor'); return pe ? pe.getSuggestList().some(s => s.includes('{target_tag}')) : false; }}")
        assert has_tag, f"Suggest tag '{target_tag}' should be visible."
        
        # 入力をクリア
        page.keyboard.press("Escape") # サジェストを閉じる
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")

        # 3. CSVをオフにする (API直接操作と伝播)
        page.evaluate(f"""() => {{
            const app = window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const currentToggle = app.ui.settings.getSettingValue("WebuiMonacoPrompt.CsvToggle", {{}});
            currentToggle["{context_key}"] = false;
            app.ui.settings.setSettingValue("WebuiMonacoPrompt.CsvToggle", currentToggle);
            
            if (window.WebuiMonacoPrompt && window.WebuiMonacoPrompt.runAllInstances) {{
                 window.WebuiMonacoPrompt.runAllInstances((instance) => {{
                     instance.setSettings({{csvToggle: currentToggle}}, true);
                 }});
            }}
        }}""")

        # エディタ側で設定が反映されたか確認
        page.wait_for_function(f"""() => {{
            const app = window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
            const editor = nodes[0].multitext_widget.editorInstance;
            return editor.getContext(editor.createContextKey("{context_key}")) === false;
        }}""", timeout=10000)

        # 4. オフ状態でのサジェスト非表示の確認
        page.evaluate("() => { const pe = document.querySelector('prompt-editor'); if (pe) pe.focus(); }")
        page.keyboard.type("zzz_unique_")
        
        page.evaluate("() => { const pe = document.querySelector('prompt-editor'); if (pe) pe.triggerSuggest(); }")
        
        # 2秒待って候補が現れないことを確認
        page.wait_for_timeout(2000)
        has_tag = page.evaluate(f"() => {{ const pe = document.querySelector('prompt-editor'); return pe ? pe.getSuggestList().some(s => s.includes('{target_tag}')) : false; }}")
        assert not has_tag, f"Suggest tag '{target_tag}' should not be visible."
        
        # 入力をクリア
        page.keyboard.press("Escape")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")

        # 5. 再度CSVをオンにする (API直接操作と伝播)
        page.evaluate(f"""() => {{
            const app = window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const currentToggle = app.ui.settings.getSettingValue("WebuiMonacoPrompt.CsvToggle", {{}});
            currentToggle["{context_key}"] = true;
            app.ui.settings.setSettingValue("WebuiMonacoPrompt.CsvToggle", currentToggle);
            
            if (window.WebuiMonacoPrompt && window.WebuiMonacoPrompt.runAllInstances) {{
                 window.WebuiMonacoPrompt.runAllInstances((instance) => {{
                     instance.setSettings({{csvToggle: currentToggle}}, true);
                 }});
            }}
        }}""")
        page.wait_for_timeout(500)

        # ページをリロードして、設定が永続化され、起動時に正しくタグが読み込まれることを確認する
        wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
        wmp_helpers.wait_for_graph_clear(page)

        # 再度ノードを作成してキャンバスに配置
        page.evaluate(f"""() => {{
            const findApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = findApp();
            const types = Object.keys(window.LiteGraph.registered_node_types);
            const nodeType = types.find(t => t.includes('WebuiMonacoPromptMultiText') || t.includes('MultiText'));
            
            const node1 = window.LiteGraph.createNode(nodeType);
            node1.pos = [100, 300];
            app.graph.add(node1);
            
            app.canvas.centerOnNode(node1);
        }}""")

        wmp_helpers.wait_for_editor(page)
        
        # エディタのShadow DOM内にフォーカス
        editor_locator = page.locator("prompt-editor").first
        editor_locator.scroll_into_view_if_needed()
        editor_locator.click()

        # エディタ側で設定が反映されたか確認 (オンになっているはず)
        page.wait_for_function(f"""() => {{
            const app = window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
            if (nodes.length === 0) return false;
            const editor = nodes[0].multitext_widget.editorInstance;
            if (!editor) return false;
            return editor.getContext(editor.createContextKey("{context_key}")) === true;
        }}""", timeout=10000)
        
        # UIの反応を少し待つ
        page.wait_for_timeout(1000)

        # 6. オン状態でのサジェスト表示の再確認
        page.evaluate("() => { const pe = document.querySelector('prompt-editor'); if (pe) pe.focus(); }")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(500)
        
        page.keyboard.type("zzz_unique_")
        
        # API経由でサジェスト起動
        page.evaluate("() => { const pe = document.querySelector('prompt-editor'); if (pe) pe.triggerSuggest(); }")
        
        # API経由で表示完了を待機
        page.wait_for_function("() => { const pe = document.querySelector('prompt-editor'); return pe && pe.isSuggestVisible(); }", timeout=10000)
        
        has_tag = page.evaluate(f"() => {{ const pe = document.querySelector('prompt-editor'); return pe ? pe.getSuggestList().some(s => s.includes('{target_tag}')) : false; }}")
        assert has_tag, f"Suggest tag '{target_tag}' should be visible."

    finally:
        if test_csv_path.exists():
            try:
                test_csv_path.unlink()
            except Exception:
                pass
