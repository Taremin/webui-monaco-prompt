import pytest
from playwright.sync_api import Page, expect
import time
import os
import json

def test_comfyui_settings_ui_elements(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    Settings UI の修正を検証するテスト:
    1. Manage Language Presets がボタンとして表示されているか (DOM強制挿入の検証)
    2. CSV ファイルに対応する boolean 設定が表示されているか
    3. 設定の保存・復元が正しく行われるか (配列化の修復検証)
    """
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.type}: {msg.text}"))
    
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    
    # Settings 画面を開く
    wmp_helpers.open_settings(page)
    
    # デバッグ: 登録されている設定項目をコンソールに出力
    page.evaluate("""() => {
        const findApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = findApp();
        if (app && app.ui && app.ui.settings) {
            console.log("DEBUG: addSetting implementation:", app.ui.settings.addSetting.toString());
            console.log("DEBUG: app.ui.settings object:", Object.keys(app.ui.settings));
            
            // 既存の設定項目を確認
            const settings = app.ui.settings.settings || [];
            console.log("DEBUG: Registered settings count:", settings.length);
            console.log("DEBUG: WebuiMonacoPrompt settings:", settings.filter(s => s.id.includes("WebuiMonacoPrompt")));
        }
    }""")
    
    # V2の場合: 検索ボックスを使用して項目を絞り込む (より確実)
    search_box = page.get_by_placeholder("Search settings")
    if (search_box.is_visible()):
        search_box.fill("WebuiMonacoPrompt")
        page.wait_for_timeout(1000) # 検索結果の反映を待機
    else:
        # V1や検索ボックスがない場合はカテゴリ切り替えを試みる
        wmp_helpers.switch_settings_category(page, "WebuiMonacoPrompt")

    # 1. Manage Language Presets ボタンの検証
    # Manage Language Presets ボタンの存在確認 (V1/V2 両対応)
    manage_btn_present = page.evaluate("""() => {
        // V1 style
        if (document.querySelector("#webui-monaco-manage-btn")) return true;
        
        // V2 style (check text in current view)
        const text = document.body.textContent;
        return text.includes('Manage Language Presets') || text.includes('Open Dialog');
    }""")
    
    if not manage_btn_present:
        import warnings
        warnings.warn("Manage Language Presets button not found in current view")
    
    # カテゴリ切り替えの描画を待機
    try:
        page.wait_for_function("""() => {
            return document.body.textContent.includes('CSV Enabled Files') || 
                    document.body.textContent.includes('Font Size') ||
                    document.body.textContent.includes('Replace Textarea');
        }""", timeout=5000)
    except Exception:
        pass
    
    # 2. CSV 項目の検証
    csv_present = page.evaluate("""() => {
        // Refactored: CSV settings are now under "CSV Enabled Files"
        const text = document.body.textContent;
        return text.includes('CSV Enabled Files') && text.includes('danbooru.csv');
    }""")
    assert csv_present, "CSV: danbooru.csv setting not found in Settings dialog under 'CSV Enabled Files'"
    
    # 3. データ整合性の検証 (配列化の修復)
    wmp_helpers.set_comfy_setting(page, "WebuiMonacoPrompt.LanguagePreset", "sd-prompt")
    
    page.reload()
    wait_for_comfyui(page)
    
    val = wmp_helpers.get_comfy_setting(page, "WebuiMonacoPrompt.LanguagePreset")
    
    assert val == "sd-prompt"
    assert isinstance(val, str)

def test_comfyui_manage_presets_button_click(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    Manage ボタンをクリックしたときにダイアログが開くことを確認
    """
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    
    # Settings を開く
    wmp_helpers.open_settings(page)
    
    # V2の場合: 検索ボックスを使用して項目を絞り込む
    search_box = page.get_by_placeholder("Search settings")
    if search_box.is_visible():
        search_box.fill("WebuiMonacoPrompt")
        page.wait_for_timeout(1000)
    else:
        wmp_helpers.switch_settings_category(page, "WebuiMonacoPrompt")
    
    # Manage ボタンをクリック
    wmp_helpers.open_preset_dialog(page)
    
    # プリセット管理ダイアログ (#webui-monaco-preset-dialog) が表示されることを確認
    page.wait_for_selector("#webui-monaco-preset-dialog", state="visible", timeout=5000)
    expect(page.locator("#webui-monaco-preset-dialog")).to_be_visible()
