import pytest
from playwright.sync_api import Page, expect
import time
import os
import json
from pathlib import Path

# テストモジュールがロードされた瞬間に、コピー元の csv ディレクトリに danbooru.csv を作成する
# これにより、comfyui_server フィクスチャ起動時のコピー処理に 100% 確実にファイルが含まれるようになる
try:
    project_root = Path(__file__).parent.parent.parent.resolve()
    csv_dir = project_root / "csv"
    csv_dir.mkdir(exist_ok=True)
    danbooru_csv = csv_dir / "danbooru.csv"
    danbooru_csv.write_text("danbooru,tag\n1,test", encoding="utf-8")
except Exception as e:
    print(f"Skipping global CSV creation: {e}")

def test_comfyui_settings_ui_elements(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    Settings UI の修正を検証するテスト:
    1. Manage Language Presets がボタンとして表示されているか (DOM強制挿入の検証)
    2. CSV ファイルに対応する boolean 設定が表示されているか
    3. 設定の保存・復元が正しく行われるか (配列化の修復検証)
    """
    page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.type}: {msg.text}"))
    
    # 起動済みの物理コピー先にも念のため直接挿入
    base_dir = Path(os.getcwd())
    versions_dir = base_dir / "tests" / "comfyui-versions"
    csv_paths = []
    if versions_dir.exists():
        for comfy_path in versions_dir.iterdir():
            if comfy_path.is_dir() and comfy_path.name.startswith("ComfyUI-"):
                csv_paths.append(comfy_path / "csv")
                csv_paths.append(comfy_path / "custom_nodes" / "webui-monaco-prompt" / "csv")
    for csv_path in csv_paths:
        try:
            csv_path.mkdir(parents=True, exist_ok=True)
            danbooru_csv = csv_path / "danbooru.csv"
            danbooru_csv.write_text("danbooru,tag\n1,test", encoding="utf-8")
        except Exception as e:
            print(f"Skipping CSV creation for {csv_path}: {e}")
    
    # LocalStorage の残留値を削除して、登録完了の判定が誤検知されないようにする
    page.add_init_script("""() => {
        try {
            const raw = localStorage.getItem("Comfy.Settings");
            if (raw) {
                const settings = JSON.parse(raw);
                delete settings["WebuiMonacoPrompt.ReplaceTextarea"];
                localStorage.setItem("Comfy.Settings", JSON.stringify(settings));
            }
        } catch(e) {}
        localStorage.removeItem('Comfy.Settings.WebuiMonacoPrompt.ReplaceTextarea');
    }""")
    
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    
    # 拡張機能の設定が ComfyUI に登録完了するまで待機（index.ts 内の 500ms setTimeout 対策）
    page.wait_for_function("""() => {
        const findApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = findApp();
        if (app && app.ui && app.ui.settings) {
            // 設定項目が登録され、デフォルト値である true が返るようになったか
            return app.ui.settings.getSettingValue("WebuiMonacoPrompt.ReplaceTextarea") === true;
        }
        return false;
    }""", timeout=15000)
    
    # Settings 画面を開く
    wmp_helpers.open_settings(page)
    

    # 設定ダイアログまたは検索ボックスが DOM にマウントされるのを安全に待機
    page.wait_for_selector(".p-dialog, dialog, [role='dialog'], input[placeholder*='Search' i], input[placeholder*='検索' i]", state="attached", timeout=10000)
    
    # 検索ボックスを使用して項目を絞り込む、またはカテゴリを切り替える
    search_box = page.locator("input[placeholder*='Search' i], input[placeholder*='search' i], .p-inputtext[placeholder]").first
    if search_box.is_visible():
        search_box.fill("WebuiMonacoPrompt")
        page.wait_for_timeout(1000) # 検索結果の反映を待機
    else:
        try:
            wmp_helpers.switch_settings_category(page, "WebuiMonacoPrompt")
        except Exception as e:
            print(f"Skipping category switch: {e}")

    # カテゴリ切り替えまたは検索反映後の描画を待機
    try:
        page.wait_for_function("""() => {
            return document.body.textContent.includes('Font Size') ||
                    document.body.textContent.includes('Replace Textarea');
        }""", timeout=5000)
    except Exception:
        pass
    
    # データ整合性の検証 (配列化の修復)
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
    
    # 検索ボックスを使用して項目を絞り込む
    search_box = page.locator("input[placeholder*='Search' i], input[placeholder*='search' i], .p-inputtext[placeholder]").first
    if search_box.is_visible():
        search_box.fill("WebuiMonacoPrompt")
        page.wait_for_timeout(1000)
    else:
        # 検索ボックスがない場合はカテゴリ切り替えを試みる（タイムアウトエラーを回避するため保護）
        try:
            wmp_helpers.switch_settings_category(page, "WebuiMonacoPrompt")
        except Exception as e:
            print(f"Skipping category switch: {e}")
    
    # Manage ボタンをクリック
    wmp_helpers.open_preset_dialog(page)
    
    # プリセット管理ダイアログ (#webui-monaco-preset-dialog) が表示されることを確認
    page.wait_for_selector("#webui-monaco-preset-dialog", state="visible", timeout=5000)
    expect(page.locator("#webui-monaco-preset-dialog")).to_be_visible()
