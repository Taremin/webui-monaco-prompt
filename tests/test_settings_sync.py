import pytest
import time
import os
from pathlib import Path
from playwright.sync_api import Page, expect

def wait_for_monaco_editor(page: Page):
    try:
        page.wait_for_selector("prompt-editor", state="attached", timeout=45000)
        page.wait_for_selector(".monaco-editor", state="visible", timeout=30000)
    except Exception as e:
        print(f"Failed to find monaco-editor: {e}")
        page.screenshot(path="e2e_error_editor_sync.png")
        raise e

def test_settings_sync_between_editors(page: Page, comfyui_server, wait_for_comfyui):
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
    page.wait_for_function("() => app.graph && app.graph._nodes.length === 0")

    page.evaluate(f"""() => {{
        const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = getApp();
        const types = Object.keys(window.LiteGraph.registered_node_types);
        const nodeType = types.find(t => t.includes('WebuiMonacoPromptMultiText') || t.includes('MultiText'));
        
        const node1 = window.LiteGraph.createNode(nodeType);
        node1.pos = [100, 300];
        app.graph.add(node1);
        
        const node2 = window.LiteGraph.createNode(nodeType);
        node2.pos = [700, 300];
        app.graph.add(node2);
        
        app.canvas.centerOnNode(node1);
    }}""")

    page.wait_for_function("() => app.graph && app.graph._nodes.length >= 2")
    wait_for_monaco_editor(page)
    
    font_sizes = page.evaluate("""() => {
        const getApp = () => window.app || window.ComfyApp;
        const app = getApp();
        const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
        return nodes.map((n, i) => {
            if (n.multitext_widget && n.multitext_widget.editorInstance) {
                return n.multitext_widget.editorInstance.fontSize;
            }
            return null;
        });
    }""")
    
    assert font_sizes[0] == font_sizes[1], "Both editors should start with the same font size."
    
    page.wait_for_function("() => typeof app !== 'undefined' && app.ui && app.ui.settings")
    page.keyboard.press("Control+,")
    page.wait_for_selector("div[role='dialog']:visible, .comfy-modal:visible, .p-dialog:visible", timeout=30000)

    monaco_category = page.locator("text=WebUI Monaco Prompt").or_(page.locator("text=webui-monaco-prompt"))
    if monaco_category.is_visible():
        monaco_category.click()
        
        page.evaluate("""() => {
            const getApp = () => window.app || window.ComfyApp;
            const app = getApp();
            app.ui.settings.setSettingValue('WebuiMonacoPrompt.FontSize', 18);
        }""")
        
        page.wait_for_function("""() => {
            const getApp = () => window.app || window.ComfyApp;
            const app = getApp();
            const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
            return nodes.every(n => n.multitext_widget && n.multitext_widget.editorInstance && n.multitext_widget.editorInstance.fontSize === 18);
        }""")
        
        new_font_sizes = page.evaluate("""() => {
            const getApp = () => window.app || window.ComfyApp;
            const app = getApp();
            const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
            return nodes.map(n => n.multitext_widget.editorInstance.fontSize);
        }""")
        assert new_font_sizes[0] == 18 and new_font_sizes[1] == 18, "Both editors should reflect the new font size."

def test_dynamic_csv_toggle_sync(page: Page, comfyui_server, wait_for_comfyui):
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
    
    page.evaluate(f"""() => {{
        const getApp = () => window.app || window.ComfyApp;
        const app = getApp();
        const types = Object.keys(window.LiteGraph.registered_node_types);
        const nodeType = types.find(t => t.includes('WebuiMonacoPromptMultiText') || t.includes('MultiText'));
        const node1 = window.LiteGraph.createNode(nodeType);
        node1.pos = [100, 300];
        app.graph.add(node1);
        app.canvas.centerOnNode(node1);
    }}""")
    
    wait_for_monaco_editor(page)

    csv_dir = Path(os.getcwd()) / "csv"
    csv_dir.mkdir(exist_ok=True)
    test_csv_path = csv_dir / "test_dynamic.csv"
    
    try:
        if test_csv_path.exists():
            test_csv_path.unlink()
            
        page.set_viewport_size({"width": 1920, "height": 1080})
        page.goto(comfyui_server)
        wait_for_comfyui(page)

        page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
        
        page.evaluate(f"""() => {{
            const getApp = () => window.app || window.ComfyApp;
            const app = getApp();
            const types = Object.keys(window.LiteGraph.registered_node_types);
            const nodeType = types.find(t => t.includes('WebuiMonacoPromptMultiText') || t.includes('MultiText'));
            const node1 = window.LiteGraph.createNode(nodeType);
            node1.pos = [100, 300];
            app.graph.add(node1);
            app.canvas.centerOnNode(node1);
        }}""")
        
        wait_for_monaco_editor(page)

        content = "test_tag_1,100\\ntest_tag_2,50\\n"
        with open(test_csv_path, "w", encoding="utf-8") as f:
            f.write(content)

        refresh_btn = page.locator("button:has-text('Refresh')")
        if refresh_btn.is_visible():
            refresh_btn.click()
        else:
            page.evaluate("""() => {
                const getApp = () => window.app || window.ComfyApp;
                const app = getApp();
                if (app.refreshComboInNodes) {
                    app.refreshComboInNodes();
                } else if (app.extensionManager && app.extensionManager.refreshComboInNodes) {
                    app.extensionManager.refreshComboInNodes();
                }
            }""")
            
        # Wait dynamically instead of fixed timeout to avoid flakiness
        try:
            page.wait_for_function("""() => {
                const getApp = () => window.app || window.ComfyApp;
                const app = getApp();
                const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
                if (nodes.length === 0) return false;
                const editor = nodes[0].multitext_widget.editorInstance;
                if (!editor) return false;
                
                const val = editor.getContext(editor.createContextKey("csv.test_dynamic"));
                return val !== undefined && val !== null;
            }""", timeout=10000)
        except Exception:
            pytest.fail("Dynamic CSV was not detected or added to the local context by refresh within timeout")
        
    finally:
        if test_csv_path.exists():
            try:
                test_csv_path.unlink()
            except Exception as e:
                print(f"Failed to cleanup {test_csv_path}: {e}")
