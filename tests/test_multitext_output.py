import pytest
import os
import json
import time
from playwright.sync_api import Page, expect

def test_multitext_output_final_verification(page: Page, comfyui_server, wait_for_comfyui):
    """ブラウザ内でLiteGraphの実行をフックしてMultiTextの出力を検証する"""
    page.set_default_timeout(60000)
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_output")
    os.makedirs(screenshot_dir, exist_ok=True)

    # ワークフロー構築
    node_info = page.evaluate("""() => {
        const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = getApp();
        app.graph.clear();
        
        const mtType = Object.keys(window.LiteGraph.registered_node_types).find(t => t.includes('WebuiMonacoPromptMultiText'));
        const mtNode = window.LiteGraph.createNode(mtType);
        mtNode.pos = [100, 100];
        app.graph.add(mtNode);
        
        const paNode = window.LiteGraph.createNode("PreviewAny");
        paNode.pos = [500, 100];
        app.graph.add(paNode);
        
        mtNode.connect(0, paNode, 0);
        
        return { mtId: mtNode.id, paId: paNode.id };
    }""")

    test_data = {
        "tree": [{"id": "f1", "name": "test.txt", "type": "file", "content": "FINAL_CHECK_CONTENT"}]
    }

    # 実行と結果のフック
    page.evaluate(f"""(data) => {{
        const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = getApp();
        const mtNode = app.graph.getNodeById({node_info['mtId']});
        
        // 値をセット
        const widget = mtNode.widgets.find(w => w.name === "text");
        widget.value = JSON.stringify(data);
        if (widget.callback) widget.callback(widget.value);
        
        // 実行開始
        if (app.queuePrompt) app.queuePrompt();
    }}""", test_data)

    # PreviewAnyのウィジェット値をポーリング
    success = False
    final_val = ""
    for i in range(30):
        final_val = page.evaluate(f"""() => {{
            const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = getApp();
            const paNode = app.graph.getNodeById({node_info['paId']});
            return paNode.widgets ? paNode.widgets[0].value : "";
        }}""")
        if "FINAL_CHECK_CONTENT" in str(final_val):
            success = True
            break
        time.sleep(1)

    print(f"DEBUG - Final PreviewAny value: {final_val}")
    assert success, f"Expected 'FINAL_CHECK_CONTENT' in PreviewAny, but got: {final_val}"
    page.screenshot(path=os.path.join(screenshot_dir, "final_success.png"))
