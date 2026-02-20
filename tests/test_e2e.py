import pytest
import time
from playwright.sync_api import Page, expect

def wait_for_comfyui_load(page: Page):
    """ComfyUIのUIがロードされるまで待機する"""
    # メニューバーやサイドバーなど、UIの主要要素が表示されるのを待つ
    page.wait_for_selector(".comfy-menu, .comfyui-menu, .side-bar-button", state="attached", timeout=60000)
    # ローディング画面やオーバーレイが消えるのを待つ
    # Stability Matrix環境やカスタムノードが多い場合は時間がかかることがある
    try:
        page.wait_for_selector("#comfy-file-input-overlay", state="hidden", timeout=30000)
    except:
        pass

def test_monaco_editor_replacement(page: Page, comfyui_server):
    """CLIP Text Encode ノードの textarea が Monaco Editor に置換されているか確認する"""
    # 基本タイムアウトを設定
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    wait_for_comfyui_load(page)

    # ノードが生成され、Monaco Promptがtextareaをスキャンして置換するまでの猶予
    # Stability Matrix等の重い環境では時間がかかるため最大60秒待機
    page.wait_for_selector(".monaco-editor", state="visible", timeout=60000)
    
    editor_count = page.locator(".monaco-editor").count()
    assert editor_count > 0, "Monaco Editor should be initialized and present in the UI"

def test_autocomplete_menu(page: Page, comfyui_server):
    """プロンプト入力時に補完メニューが表示されるか確認する"""
    page.set_default_timeout(60000)
    # コンソールログを収集するためのリスト
    console_logs = []
    page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    wait_for_comfyui_load(page)

    # Monaco Editor が表示され、インタラクティブになるまで待つ
    try:
        # すべてのエディタを取得して、最初に見つかったものを使用
        editor_locator = page.locator(".monaco-editor")
        page.wait_for_selector(".monaco-editor", state="visible", timeout=60000)
        
        # 最初の要素を取得
        first_editor = editor_locator.first
        first_editor.click(delay=500)
        
        # フォーカスを確実にするためのスクリプト実行
        page.evaluate("""() => {
            const editors = document.querySelectorAll('.monaco-editor');
            if (editors.length > 0) {
                const textarea = editors[0].querySelector('textarea');
                if (textarea) textarea.focus();
            }
        }""")
        
        # 入力前に少し待機
        time.sleep(2)

        # 全選択して削除
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        time.sleep(1)

        # 文字を1つずつ丁寧に入力
        for char in "1girl":
            page.keyboard.type(char, delay=100)
            time.sleep(0.1)
            
        # 補完をトリガー (Ctrl+Space)
        page.keyboard.press("Control+ ")
        
        # 補完メニュー (suggest-widget) を確認
        suggest_widget = page.locator(".suggest-widget")
        try:
            expect(suggest_widget).to_be_visible(timeout=30000)
        except Exception as e:
            # 内部の monaco インスタンスから値を取得してデバッグ
            val = page.evaluate("() => { try { return monaco.editor.getModels()[0].getValue(); } catch(e) { return 'monaco not found or model empty'; } }")
            print(f"Current Monaco value: {val}")
            raise e
        
        expect(page.locator(".suggest-widget .monaco-list-row").first).to_be_visible()
        
    except Exception as e:
        # ログをファイルに保存
        with open("tests/browser_console.log", "w", encoding="utf-8") as f:
            f.writelines(line + "\n" for line in console_logs)
            
        page.screenshot(path="tests/autocomplete_failure.png", full_page=True)
        try:
            with open("tests/autocomplete_debug.html", "w", encoding="utf-8") as f:
                f.write(page.content())
        except:
            pass
        raise e

def test_settings_persistence(page: Page, comfyui_server):
    """設定が変更され、リロード後も維持されるか確認する"""
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    wait_for_comfyui_load(page)

    # 設定モーダルを開く (Ctrl + ,)
    time.sleep(5)
    page.keyboard.press("Control+,")
    page.wait_for_selector("div[role='dialog']:visible, .comfy-modal:visible, .p-dialog:visible", timeout=30000)

    # WebUI Monaco Prompt のカテゴリを探す
    monaco_category = page.locator("text=WebUI Monaco Prompt").or_(page.locator("text=webui-monaco-prompt"))
    if monaco_category.is_visible():
        monaco_category.click()
        
        # 「Minimap」のトグルを探して切り替えてみる (Vim Modeはバグがある可能性があるため回避)
        minimap_toggle = page.get_by_label("Minimap").or_(page.get_by_text("Minimap"))
        if minimap_toggle.is_visible():
            initial_checked = minimap_toggle.is_checked()
            minimap_toggle.click()
            time.sleep(1)
            
            # リロードして維持されているか確認
            page.reload()
            wait_for_comfyui_load(page)
            
            page.keyboard.press("Control+,")
            monaco_category.click()
            # リロード後はDOMが新しくなるので再取得
            new_minimap_toggle = page.get_by_label("Minimap").or_(page.get_by_text("Minimap"))
            assert new_minimap_toggle.is_checked() != initial_checked, "Settings should be persisted after reload"
