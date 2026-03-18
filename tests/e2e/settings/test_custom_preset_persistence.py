import pytest
import json
import time
from playwright.sync_api import Page, expect

def log_event(msg):
    print(f"[{msg}]")

def create_prompt_node(page: Page, wmp_helpers):
    """CLIP Text Encode (Prompt) ノードを作成し、エディタを待機する"""
    page.evaluate("""() => {
        const findApp = () => {
            if (window.app) return window.app;
            if (window.comfyAPI && window.comfyAPI.app) return window.comfyAPI.app;
            const canvas = document.querySelector("comfy-canvas");
            if (canvas && canvas.app) return canvas.app;
            return null;
        };
        const app = findApp();
        if (!app) throw new Error("ComfyUI App not found");
        app.graph.clear();
        const node = window.LiteGraph.createNode("CLIPTextEncode");
        node.pos = [400, 300];
        app.graph.add(node);
        if (app.canvas) app.canvas.centerOnNode(node);
    }""")
    wmp_helpers.wait_for_editor(page)

def test_custom_preset_persistence(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    カスタムプリセットが保存され、リロード後も維持されていることを検証する。
    """
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    create_prompt_node(page, wmp_helpers)

    preset_name = "TestPersistencePreset"
    
    log_event("Opening Preset Dialog")
    # 管理ダイアログを開く
    page.evaluate("() => window.WebuiMonacoPrompt.showPresetManager()")
    
    # ダイアログが表示されるのを待つ
    page.wait_for_selector("#webui-monaco-preset-dialog", state="visible")
    
    log_event(f"Creating new preset: {preset_name}")
    # Shadow Root を考慮したセレクタ
    # ただし、PresetDialog 自体は Shadow DOM の外（document.body）に append されているため標準セレクタでOK
    input_selector = "#webui-monaco-preset-dialog input[type='text']"
    
    page.fill(input_selector, preset_name)
    page.click("#webui-monaco-preset-dialog button:has-text('Save')")
    
    # 保存後のリスト更新を待機
    page.wait_for_selector(f"#webui-monaco-preset-dialog .preset-item:has-text('{preset_name}')", state="visible", timeout=10000)
    expect(page.locator(f"#webui-monaco-preset-dialog .preset-item:has-text('{preset_name}')")).to_be_visible()
    
    log_event("Reloading page")
    page.reload()
    wait_for_comfyui(page)
    wmp_helpers.wait_for_ui_stabilize(page, 3000)
    
    log_event("Checking if preset persisted after reload")
    # 再度ダイアログを開いて確認
    page.evaluate("() => window.WebuiMonacoPrompt.showPresetManager()")
    page.wait_for_selector("#webui-monaco-preset-dialog", state="visible")
    
    # プリセットが残っていることを確認
    expect(page.locator(f"#webui-monaco-preset-dialog .preset-item:has-text('{preset_name}')")).to_be_visible()
    
    log_event("Deleting custom preset")
    # 削除テスト
    page.on("dialog", lambda dialog: dialog.accept()) # confirmを自動承認
    page.click(f"#webui-monaco-preset-dialog .preset-item:has-text('{preset_name}') button:has-text('Delete')")
    
    # 消えたことを確認
    expect(page.locator(f"#webui-monaco-preset-dialog .preset-item:has-text('{preset_name}')")).not_to_be_visible()
    
    log_event("Reloading again to ensure deletion persisted")
    page.reload()
    wait_for_comfyui(page)
    
    page.evaluate("() => window.WebuiMonacoPrompt.showPresetManager()")
    page.wait_for_selector("#webui-monaco-preset-dialog", state="visible")
    expect(page.locator(f"#webui-monaco-preset-dialog .preset-item:has-text('{preset_name}')")).not_to_be_visible()
