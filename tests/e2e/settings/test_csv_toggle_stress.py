import pytest
from playwright.sync_api import Page, expect
import time
import os
from pathlib import Path

def test_csv_toggle_stress(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    Test rapid toggling of CSV files (via UI in V1, via API in V2) to ensure no server errors (JSONDecodeError) occur.
    """
    # E2Eテスト用のダミー CSV ファイルを確実に準備する
    ext_path = os.environ.get("COMFYUI_EXTENSION_PATH")
    if ext_path:
        csv_dir = Path(ext_path) / "csv"
        csv_dir.mkdir(parents=True, exist_ok=True)
        danbooru_csv = csv_dir / "danbooru.csv"
        danbooru_csv.write_text("danbooru,tag\n1,test", encoding="utf-8")

    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    
    # 拡張機能の JS がロード完了し、ノードタイプが登録されるまで安全に待機
    page.wait_for_function("() => typeof LiteGraph !== 'undefined' && Object.keys(LiteGraph.registered_node_types).some(t => t.includes('MultiText'))")
    
    # Listen to console errors to catch potential network errors
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    
    # Also monitor network responses to ensure settings are saved without 500 errors
    failed_requests = []
    page.on("response", lambda response: failed_requests.append(response.url) if response.status >= 500 and "settings" in response.url.lower() else None)
    
    # 設定画面を開く
    wmp_helpers.open_settings(page)
    
    # danbooru.csv のトグル要素が設定ダイアログ内にレンダリングされるか最大3秒間待機して動的に判定
    checkbox_selector = "label:has-text('danbooru.csv') input[type='checkbox']"
    has_ui_toggle = False
    try:
        page.wait_for_selector(checkbox_selector, state="visible", timeout=3000)
        has_ui_toggle = True
    except Exception:
        has_ui_toggle = False
        
    if has_ui_toggle:
        print("[Stress Test] CSV UI toggles detected: Running rapid toggles via UI elements")
        checkbox = page.locator(checkbox_selector).first
        
        # 10回の高速なUIトグル（クリック）連打
        for _ in range(10):
            checkbox.click(force=True)
            # クリック連打の間隔を意図的に詰める (UIイベントとネットワーク送信のストレス)
            page.wait_for_timeout(50)
            
        # 最終的にチェックされた（True）状態に固定する
        if not checkbox.is_checked():
            checkbox.click(force=True)
            
    else:
        print("[Stress Test] CSV UI toggles NOT detected (V2 UI or custom renderers unsupported): Running rapid toggles via JavaScript API")
        # UI が存在しない場合は、API を用いて直接連打ストレスを与える
        page.evaluate("""() => {
            const app = window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const current = app.ui.settings.getSettingValue("WebuiMonacoPrompt.CsvToggle") || {};
            
            let toggle = true;
            for (let i = 0; i < 10; i++) {
                current["csv.danbooru"] = toggle;
                app.ui.settings.setSettingValue("WebuiMonacoPrompt.CsvToggle", current);
                toggle = !toggle;
            }
        }""")
    
    # 送信が落ち着くまで少し待機
    page.wait_for_timeout(2000)
    
    # サーバー側の 500 エラーが発生していないか検証
    assert len(failed_requests) == 0, f"Server returned error for settings sync requests: {failed_requests}"
    
    if not has_ui_toggle:
        # API を使った場合は、最終的な値を永続化させるために再度ゆっくりトグル
        page.evaluate("""() => {
            const app = window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const current = app.ui.settings.getSettingValue("WebuiMonacoPrompt.CsvToggle") || {};
            current["csv.danbooru"] = true;
            app.ui.settings.setSettingValue("WebuiMonacoPrompt.CsvToggle", current);
        }""")
        page.wait_for_timeout(1000)
    
    # ページをリロードして、設定が永続化されているか検証
    page.reload()
    wait_for_comfyui(page)
    
    # リロード後に値が True になっているか検証
    persisted_value = page.evaluate("""() => {
        const app = window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const current = app.ui.settings.getSettingValue("WebuiMonacoPrompt.CsvToggle") || {};
        return current["csv.danbooru"];
    }""")
    
    assert persisted_value is True, "CsvToggle value for danbooru should be persisted as true after reload"
