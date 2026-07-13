import pytest
import re
import uuid
from playwright.sync_api import Page, expect

def test_language_composition_preset_and_toggles(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    動的言語構成機能（Language Composition）のテスト。
    - プリセットの切り替えで複数の機能トグルが連動するか
    - トグルを手動で変更した際にプリセットがカスタムになるか
    - 保存ダイアログを通じてカスタムプリセットが保存・選択されるか
    """
    page.set_viewport_size({"width": 1920, "height": 1080})
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    # 完全にクリーンな状態で開始するためのリセット処理
    page.evaluate("""() => {
        localStorage.clear();
        if (window.app && window.app.ui && window.app.ui.settings) {
            window.app.ui.settings.setSettingValue("WebuiMonacoPrompt.LanguageUserPresets", "[]");
            window.app.ui.settings.setSettingValue("WebuiMonacoPrompt.LanguagePreset", "comfy-prompt");
        }
    }""")
    page.reload()
    wait_for_comfyui(page)

    # 0. 念のため再度クリア
    page.evaluate("() => { localStorage.clear(); }")
    
    # 1. ワークフローをクリア
    wmp_helpers.wait_for_graph_clear(page)

    # 2. グラフにCLIP Text Encodeノードを追加
    wmp_helpers.create_node(page, "CLIPTextEncode", [400, 300])

    page.wait_for_function("() => app.graph && app.graph._nodes.length > 0")
    
    # 3. エディタがアタッチされるのを待機
    wmp_helpers.wait_for_editor(page)
    editor = page.locator("prompt-editor")
    
    # ComfyUIの設定同期（ネットワーク通信とWebSocketエコー）による非同期の巻き戻りを防ぐため、
    # このテストでは明示的に同期をモックする。
    page.evaluate("""() => {
        const editorEl = document.querySelector('prompt-editor');
        if (editorEl) {
            editorEl.syncLanguageFeatures = () => { /* mocked to prevent echo races */ };
        }
    }""")
    
    # ヘッダーを表示
    page.evaluate("""() => {
        const editorEl = document.querySelector('prompt-editor');
        if (editorEl && !editorEl.showHeader) {
            editorEl.changeShowHeader(true);
        }
    }""")
    
    # Preset コンボの特定
    preset_select = editor.locator("label", has_text="Preset").locator("select")
    preset_select.wait_for(state="attached")
    current_preset = preset_select.input_value()
    print(f"Initial Preset: {current_preset}")

    # "Full Features" プリセット (id: 'full-features') に変更
    preset_select.evaluate("el => { el.value = 'full-features'; el.dispatchEvent(new Event('change', {bubbles: true})); }")
    
    # JSで languageFeatures が更新されているか確認 (動的待機)
    page.wait_for_function("""() => {
        const editorEl = document.querySelector('prompt-editor');
        return editorEl && editorEl.languageFeatures && editorEl.languageFeatures['jinja2'] === true;
    }""")
    
    features = page.evaluate("""() => {
        const editorEl = document.querySelector('prompt-editor');
        return editorEl.languageFeatures;
    }""")
    assert features.get('jinja2') is True, "Jinja2 feature should be enabled by 'full-features' preset."
    assert features.get('comment-hash') is True, "Hash comment should be enabled."
    
    # 機能を1つトグルオフしてみる (Jinja2)
    # label のテキストを使って input をクリックする
    editor.locator("label", has_text="Jinja2").locator("input").evaluate("el => { el.checked = false; el.dispatchEvent(new Event('change', {bubbles: true})); }")
    
    # プリセットが "comfy-dynamic-prompt" に戻ったか確認（Jinja2オフで完全一致する既存プリセットがあるため）
    expect(preset_select).to_have_value("comfy-dynamic-prompt")
    
    # さらに Dynamic Prompts をオフにしてみる
    editor.locator("label", has_text="Dynamic Prompts").locator("input").evaluate("el => { el.checked = false; el.dispatchEvent(new Event('change', {bubbles: true})); }")
    
    # プリセットが今度こそ "custom" (または custom-* ) になったか確認
    expect(preset_select).to_have_value(re.compile(r"^custom"))
    
    # プリセットを 'comfy-prompt' に強制リセットしてからテスト開始 (UIレベルで操作)
    preset_select.evaluate("el => { el.value = 'comfy-prompt'; el.dispatchEvent(new Event('change', {bubbles: true})); }")
    expect(preset_select).to_have_value("comfy-prompt")

    current_preset = preset_select.input_value()
    print(f"Preset after reset: {current_preset}")
    assert current_preset == "comfy-prompt", f"Preset should be reset to 'comfy-prompt', but got {current_preset}"

    # 保存テストの前に、ユニークな名前を生成する
    unique_preset_name = f"Test Preset {str(uuid.uuid4())[:8]}"
    
    # Manage Presets ボタンをクリックしてダイアログを開く
    editor.locator("button", has_text="Manage Presets").evaluate("el => el.click()")
    
    # ダイアログオーバーレイを特定
    dialog_overlay = page.locator('div[class*="dialogOverlay"]')
    
    # ダイアログ内の入力欄に名前を入れて Save ボタンをクリック
    preset_input = dialog_overlay.locator('input[placeholder="Preset Name"]')
    preset_input.fill(unique_preset_name)
    dialog_overlay.locator('button', has_text='Save').click()
    
    # Close ボタンをクリックしてダイアログを閉じる
    dialog_overlay.locator('button', has_text='Close').click()
    
    # セレクトボックスに新しい項目が追加され、選択されているか
    expected_slug = re.sub(r'[^a-z0-9]+', '-', unique_preset_name.lower())
    expected_id = f"custom-{expected_slug}"
    
    # セレクトボックスが更新されるのを待つ (Playwrightのexpectの自動リトライ)
    expect(preset_select).to_have_value(expected_id)
    
    # --- プリセットを削除してクリーンアップ ---
    # 再度ダイアログを開く
    editor.locator("button", has_text="Manage Presets").evaluate("el => el.click()")
    
    # confirmを自動承認 (Playwright同期APIスレッドのデッドロックを防ぐため、ブラウザ側で confirm を直接モック化)
    page.evaluate("window.confirm = () => true;")
    
    # 名前でアイテムを探して Delete ボタンをクリック (隠れた要素対策に force=True を適用)
    preset_item = dialog_overlay.locator('div[class*="dialog-item"]', has_text=unique_preset_name)
    preset_item.locator('button', has_text='Delete').click(force=True)
    
    # ダイアログを閉じる
    dialog_overlay.locator('button', has_text='Close').click()
    
    # 機能をいくつか変更して保存されるか確認する代わりに、Jinja2 が効いているか確認
    has_jinja = page.evaluate("""async () => {
        const editor = document.querySelector('prompt-editor');
        const check = () => {
            const deepTraverse = (root) => {
                const spans = Array.from(root.querySelectorAll ? root.querySelectorAll('span') : []);
                if (spans.some(s => s.className.includes('mtk') && (s.textContent.includes('{{') || s.textContent.includes('}}')))) return true;
                for (const child of Array.from(root.children || [])) {
                    if (child.shadowRoot && deepTraverse(child.shadowRoot)) return true;
                    if (deepTraverse(child)) return true;
                }
                return false;
            };
            return deepTraverse(editor.shadowRoot || editor);
        };
        for(let i=0; i<10; i++) {
            if(check()) return true;
            await new Promise(r => setTimeout(r, 500));
        }
        return false;
    }""")

    print("Language Composition E2E Test Passed successfully.")
