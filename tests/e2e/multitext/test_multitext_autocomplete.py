import pytest
from playwright.sync_api import Page, expect
import os
from pathlib import Path
import uuid

def create_static_test_csv(unique_id: str):
    """Create a static test CSV file to ensure stable test environment."""
    csv_dir = Path(os.getcwd()) / "csv"
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
        page.keyboard.type("zzz_unique_")
        
        # サジェストウィジェットが出るのを待つ
        page.keyboard.press("Control+Space")
        
        # Monacoのサジェストウィジェットの表示を待機
        suggest_widget = page.locator(".monaco-editor .suggest-widget").first
        suggest_widget.wait_for(state="visible", timeout=10000)
        
        # 候補が含まれているか確認
        expect(page.locator(f".monaco-list-row:has-text('{target_tag}')").first).to_be_visible(timeout=10000)
        
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
        editor_locator.click()
        page.keyboard.type("zzz_unique_")
        page.keyboard.press("Control+Space")
        
        # サジェストウィジェットが表示されないか、表示されても該当テキストがないことを確認する
        try:
            expect(page.locator(f".monaco-list-row:has-text('{target_tag}')").first).not_to_be_visible(timeout=2000)
        except AssertionError:
            pytest.fail(f"Suggest tag '{target_tag}' is visible even after CSV is toggled off")

        # 入力をクリア
        page.keyboard.press("Escape")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")

        # 5. 再度CSVをオンにする (Settingsダイアログ経由)
        wmp_helpers.open_settings(page)
        
        # Optional: Switch category if implemented
        try:
            wmp_helpers.switch_settings_category(page, "WebuiMonacoPrompt")
        except:
            pass
            
        search_box = page.get_by_placeholder("Search settings")
        if search_box.is_visible():
            search_box.fill("WebuiMonacoPrompt")
        page.wait_for_timeout(500)
        
        # 設定ダイアログ内の対応するチェックボックスをクリックしてオンにする
        checkbox = page.locator(f"input[type='checkbox'][value='{basename}']").first
        checkbox.wait_for(state="attached", timeout=5000)
        if not checkbox.is_checked():
            checkbox.evaluate("node => node.click()")
            
        # 設定ダイアログを閉じる
        page.keyboard.press("Escape")
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
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(500)
        
        page.keyboard.type("zzz_unique_")
        page.wait_for_timeout(500)
            
        page.keyboard.press("Control+Space")
        
        suggest_widget = page.locator(".monaco-editor .suggest-widget").first
        suggest_widget.wait_for(state="visible", timeout=10000)
        
        expect(page.locator(f".monaco-list-row:has-text('{target_tag}')").first).to_be_visible(timeout=10000)

    finally:
        if test_csv_path.exists():
            try:
                test_csv_path.unlink()
            except Exception:
                pass
