import pytest
from playwright.sync_api import Page, expect
import time
import json

def log_event(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

def test_header_initially_hidden_when_disabled(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    設定でヘッダーが非表示(ShowHeader=False)になっている場合、
    ノード生成直後の最初の段階からヘッダーのdisplayスタイルが'none'になっていることを検証する。
    """
    page.goto(comfyui_server)
    wait_for_comfyui(page)
    
    log_event("Clearing existing localStorage to ensure a clean state")
    page.evaluate("localStorage.clear()")
    page.reload()
    wait_for_comfyui(page)

    log_event("Ensuring ShowHeader setting is false via API")
    page.evaluate("app.ui.settings.setSettingValue('WebuiMonacoPrompt.ShowHeader', false)")
    wmp_helpers.wait_for_ui_stabilize(page)

    log_event("Creating CLIPTextEncode Node")
    page.evaluate("""() => {
        app.graph.clear();
        const node = LiteGraph.createNode('CLIPTextEncode');
        node.pos = [400, 300];
        app.graph.add(node);
    }""")

    wmp_helpers.wait_for_editor(page)

    log_event("Asserting header display style is 'none' on load")
    header = page.locator("prompt-editor").first.locator("header")
    expect(header).to_have_css("display", "none")

def test_header_visible_when_enabled(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    設定でヘッダーが表示(ShowHeader=True)になっている場合、
    ノード生成直後にヘッダーが表示されていることを検証する。
    """
    page.goto(comfyui_server)
    wait_for_comfyui(page)
    
    log_event("Ensuring ShowHeader setting is true via API")
    page.evaluate("app.ui.settings.setSettingValue('WebuiMonacoPrompt.ShowHeader', true)")
    wmp_helpers.wait_for_ui_stabilize(page)

    log_event("Creating CLIPTextEncode Node")
    page.evaluate("""() => {
        app.graph.clear();
        const node = LiteGraph.createNode('CLIPTextEncode');
        node.pos = [400, 300];
        app.graph.add(node);
    }""")
    wmp_helpers.wait_for_editor(page)

    log_event("Asserting header display style is not 'none' on load")
    header = page.locator("prompt-editor").first.locator("header")
    
    try:
        expect(header).not_to_have_css("display", "none")
    except Exception as e:
        # 詳細な状態をブラウザから引き出してダンプする
        debug_data = page.evaluate("""() => {
            const editor = document.querySelector('prompt-editor');
            const storage = JSON.parse(localStorage.getItem("Comfy.Settings") || "{}");
            const wmpSettings = Object.keys(storage)
                .filter(k => k.includes("WebuiMonacoPrompt"))
                .reduce((o, k) => { o[k] = storage[k]; return o; }, {});
                
            if (!editor) {
                return { error: "prompt-editor element not found in DOM", wmpSettings };
            }
            
            const child = editor.shadowRoot ? editor.shadowRoot.querySelector('header') : null;
            const parent = editor.shadowRoot ? editor.shadowRoot.querySelector('.inner') : null;
            
            return {
                wmpSettings,
                editorShowHeader: editor.showHeader,
                editorIsConnected: editor.isConnected,
                headerStyleDisplay: child ? child.style.display : "no_header",
                headerClass: child ? child.className : "",
                parentStyleDisplay: parent ? parent.style.display : "no_parent",
                childRect: child ? child.getBoundingClientRect() : null,
                parentRect: parent ? parent.getBoundingClientRect() : null,
                managerSettings: window.WebuiMonacoPrompt.PromptEditorManager.getGroup("comfyui").getSettings()
            };
        }""")
        print("\n--- DETAILED EDITOR DEBUG DUMP ---")
        print(json.dumps(debug_data, indent=2))
        print("----------------------------------\n")
        raise e
