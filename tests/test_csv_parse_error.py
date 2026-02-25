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
        page.screenshot(path="e2e_error_csv_parse.png")
        raise e

def wait_for_node_registration(page: Page):
    return page.evaluate("""async () => {
        const check = () => {
            if (typeof window.LiteGraph === 'undefined') return null;
            const types = Object.keys(window.LiteGraph.registered_node_types);
            return types.find(t => t.includes('WebuiMonacoPromptMultiText') || t.includes('MultiText')) || null;
        };
        let match = check();
        if (match) return match;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            match = check();
            if (match) return match;
        }
        return null;
    }""")

def test_csv_parse_error_recovery(page: Page, comfyui_server, wait_for_comfyui):
    page.set_default_timeout(60000)
    
    csv_dir = Path(os.getcwd()) / "csv"
    csv_dir.mkdir(exist_ok=True)
    bad_csv_path = csv_dir / "bad.csv"
    
    try:
        content = "test_tag_bad,100,50\\nanother_bad,200,30\\n"
        with open(bad_csv_path, "w", encoding="utf-8") as f:
            f.write(content)

        page.set_viewport_size({"width": 1920, "height": 1080})
        page.goto(comfyui_server)
        wait_for_comfyui(page)

        page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
        
        node_type = wait_for_node_registration(page)
        assert node_type, "MultiText node type should be registered."
        
        page.evaluate(f"""() => {{
            const getApp = () => window.app || window.ComfyApp;
            const app = getApp();
            const node1 = window.LiteGraph.createNode('{node_type}');
            node1.pos = [100, 300];
            app.graph.add(node1);
            app.canvas.centerOnNode(node1);
        }}""")
        
        wait_for_monaco_editor(page)
        
        has_editor = page.evaluate("""() => {
            const getApp = () => window.app || window.ComfyApp;
            const app = getApp();
            const nodes = app.graph._nodes.filter(n => n.type && n.type.includes('MultiText'));
            return nodes[0] && nodes[0].multitext_widget && nodes[0].multitext_widget.editorInstance !== null;
        }""")
        
        assert has_editor, "Editor instance should be created even with bad CSV data"
        
    finally:
        if bad_csv_path.exists():
            try:
                bad_csv_path.unlink()
            except Exception as e:
                print(f"Failed to cleanup {bad_csv_path}: {e}")
