import pytest
from playwright.sync_api import Page, expect
import os
from pathlib import Path

def create_test_csv():
    """Create a temporary test CSV file to ensure stable test environment."""
    csv_dir = Path(os.getcwd()) / "csv"
    csv_dir.mkdir(exist_ok=True)
    test_csv_path = csv_dir / "test_autocomplete.csv"
    
    content = "test_tag_apple,100\ntest_tag_banana,50\n"
    with open(test_csv_path, "w", encoding="utf-8") as f:
        f.write(content)
    
    return test_csv_path

def test_multitext_csv_autocomplete_toggle(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    page.set_viewport_size({"width": 1920, "height": 1080})
    
    # 1. 準備：テスト用CSVの作成
    test_csv_path = create_test_csv()
    
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
        page.wait_for_function("""() => {
            const findApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = findApp();
            const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
            if (nodes.length === 0) return false;
            const editor = nodes[0].multitext_widget.editorInstance;
            if (!editor) return false;
            
            const val = editor.getContext(editor.createContextKey("csv.test_autocomplete"));
            return val !== undefined && val !== null;
        }""")

        # 2. デフォルト状態（CSVオン）でのサジェスト確認
        page.keyboard.type("test_tag_")
        
        # サジェストウィジェットが出るのを待つ
        page.keyboard.press("Control+Space")
        
        # Monacoのサジェストウィジェットの表示を待機
        suggest_widget = page.locator(".monaco-editor .suggest-widget").first
        suggest_widget.wait_for(state="visible")
        
        # 候補が含まれているか確認
        expect(page.locator(".monaco-list-row:has-text('test_tag_apple')").first).to_be_visible()
        
        # 入力をクリア
        page.keyboard.press("Escape") # サジェストを閉じる
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")

        # 3. CSVをオフにする
        page.evaluate("""() => {
            const app = window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const currentToggle = app.ui.settings.getSettingValue("WebuiMonacoPrompt.CsvToggle", {});
            currentToggle["csv.test_autocomplete"] = false;
            app.ui.settings.setSettingValue("WebuiMonacoPrompt.CsvToggle", currentToggle);
            
            if (window.WebuiMonacoPrompt && window.WebuiMonacoPrompt.runAllInstances) {
                 window.WebuiMonacoPrompt.runAllInstances((instance) => {
                     instance.setSettings({csvToggle: currentToggle}, true);
                 });
            }
        }""")

        # エディタ側で設定が反映されたか確認
        page.wait_for_function("""() => {
            const app = window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
            const editor = nodes[0].multitext_widget.editorInstance;
            return editor.getContext(editor.createContextKey("csv.test_autocomplete")) === false;
        }""")

        # 4. オフ状態でのサジェスト非表示の確認
        editor_locator.click()
        page.keyboard.type("test_tag_")
        page.keyboard.press("Control+Space")
        
        # サジェストウィジェットが表示されないか、表示されても該当テキストがないことを確認する
        try:
            # 別の単語（ドキュメント内単語等）でサジェストが出る可能性もあるので、特定のタグが出ないことを確認
            expect(page.locator(".monaco-list-row:has-text('test_tag_apple')").first).not_to_be_visible(timeout=2000)
        except AssertionError:
            pytest.fail("Suggest tag 'test_tag_apple' is visible even after CSV is toggled off")

        # 入力をクリア
        page.keyboard.press("Escape")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")

        # 5. 再度CSVをオンにする (Settings経由)
        wmp_helpers.open_settings(page)
        wmp_helpers.switch_settings_category(page, "WebuiMonacoPrompt")
        
        # 設定ダイアログ内の "test_autocomplete" のチェックボックスをクリックしてオンにする
        page.locator("input[type='checkbox'][value='test_autocomplete']").first.check()
        
        # 設定ダイアログを閉じる (マスクに遮られることがあるためEscapeキーを使う)
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

        # エディタ側で設定が反映されたか確認
        page.wait_for_function("""() => {
            const app = window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
            if (nodes.length === 0) return false;
            const editor = nodes[0].multitext_widget.editorInstance;
            if (!editor) return false;
            return editor.getContext(editor.createContextKey("csv.test_autocomplete")) === true;
        }""")
        
        # UIの反応を少し待つ
        page.wait_for_timeout(1000)

        # 6. オン状態でのサジェスト表示の再確認
        # Clear any potential stale input and re-type slowly
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(500)
        
        for char in "test_tag_":
            page.keyboard.type(char)
            page.wait_for_timeout(100)
            
        page.keyboard.press("Control+Space")
        
        suggest_widget = page.locator(".monaco-editor .suggest-widget").first
        suggest_widget.wait_for(state="visible", timeout=10000)
        
        # Retry with a slight delay if it fails initially, Monaco needs a bit to rebuild suggestions
        expect(page.locator(".monaco-list-row:has-text('test_tag_apple')").first).to_be_visible(timeout=10000)

    finally:
        # テスト後のお掃除
        if test_csv_path.exists():
            try:
                test_csv_path.unlink()
            except Exception:
                pass
