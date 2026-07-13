import pytest
from playwright.sync_api import Page, expect
import time

def log_event(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

def test_settings_initialization_bug(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    設定（ShowHeader, Language Featureなど）を変更した後、リロードしても初期化されないことを検証する。
    """
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.type}: {msg.text}"))
    
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    log_event("Clearing existing localStorage to ensure a clean state")
    page.evaluate("localStorage.clear()")
    page.reload()
    wait_for_comfyui(page)
    
    # 拡張機能の設定が ComfyUI に登録完了するまで待機（登録遅延対策）
    page.wait_for_function("""() => {
        const findApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = findApp();
        if (app && app.ui && app.ui.settings) {
            return app.ui.settings.getSettingValue("WebuiMonacoPrompt.ShowHeader") === true;
        }
        return false;
    }""", timeout=15000)

    log_event("Adding Prompt Node")
    page.evaluate("() => { const node = LiteGraph.createNode('WebuiMonacoPromptMultiText'); app.graph.add(node); }")
    wmp_helpers.wait_for_ui_stabilize(page)

    log_event("Setting Show Header to true via app.ui.settings API")
    page.evaluate("app.ui.settings.setSettingValue('WebuiMonacoPrompt.ShowHeader', true)")

    log_event("Setting a Language Feature (jinja2) to true via app.ui.settings API")
    page.evaluate("app.ui.settings.setSettingValue('WebuiMonacoPrompt.LanguageFeature.jinja2', true)")

    page.wait_for_timeout(2000)

    log_event("Checking API values before reload to ensure they actually stick first")
    show_header_pre = page.evaluate("app.ui.settings.getSettingValue('WebuiMonacoPrompt.ShowHeader')")
    jinja2_feature_pre = page.evaluate("app.ui.settings.getSettingValue('WebuiMonacoPrompt.LanguageFeature.jinja2')")
    assert show_header_pre is True, f"Expected ShowHeader to be True initially, got {show_header_pre}"
    assert jinja2_feature_pre is True, f"Expected LanguageFeature.jinja2 to be True initially, got {jinja2_feature_pre}"

    log_event("Reloading page")
    page.reload()
    wait_for_comfyui(page)
    
    # リロード後に拡張機能の設定が ComfyUI に再マウントされるまで待機
    page.wait_for_function("""() => {
        const findApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = findApp();
        if (app && app.ui && app.ui.settings) {
            return app.ui.settings.getSettingValue("WebuiMonacoPrompt.ShowHeader") === true;
        }
        return false;
    }""", timeout=15000)
    
    wmp_helpers.wait_for_ui_stabilize(page, 3000)

    page.wait_for_timeout(2000)

    log_event("Checking API values after reload")
    show_header = page.evaluate("app.ui.settings.getSettingValue('WebuiMonacoPrompt.ShowHeader')")
    assert show_header is True, f"Expected ShowHeader to be True via API, but got {show_header}"

    log_event("Checking Language Feature after reload")
    jinja2_feature = page.evaluate("app.ui.settings.getSettingValue('WebuiMonacoPrompt.LanguageFeature.jinja2')")
    assert jinja2_feature is True, f"Expected LanguageFeature.jinja2 to be True via API, but got {jinja2_feature}"
