import pytest
import os
import json
import time
from playwright.sync_api import Page, expect

def test_multitext_min_size_layout(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """ノードを最小サイズにリサイズした際のレイアウト崩れ（はみ出し、タブ隠れ）を検証する"""
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    wmp_helpers.wait_for_graph_clear(page)

    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_min_size")
    os.makedirs(screenshot_dir, exist_ok=True)

    # MultiTextノードを作成
    wmp_helpers.create_node(page, "WebuiMonacoPromptMultiText", [100, 100])
    
    # エディタの存在確認
    wmp_helpers.wait_for_editor(page)

    # 最初は十分なサイズで作成し、ノードIDを取得
    node_info = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes[0];
        node.size = [400, 400];
        return { id: node.id };
    }""")

    page.wait_for_selector("[class*='multitext-container']", state="visible")
    
    # 1. ノードを小さくリサイズ
    # computeSize で計算される最小高さは約 160px (36+35+40+50) なので、
    # 200px 程度に設定して正常に収まるか確認する
    page.evaluate(f"""(id) => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph.getNodeById(id);
        node.size = [350, 200];
        app.canvas.setDirty(true, true);
    }}""", node_info['id'])
    
    wmp_helpers.wait_for_ui_stabilize(page, 1000)
    page.screenshot(path=os.path.join(screenshot_dir, "01_min_size.png"))

    # タブの出現を待機
    page.wait_for_selector("[class*='tabs-container']", state="visible")

    # レイアウト情報の取得
    layout_info = page.evaluate(f"""(id) => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph.getNodeById(id);
        if (!node) return {{ error: "Node not found" }};
        
        const widget = node.widgets.find(w => w.name === "webui-monaco-prompt-multitext");
        if (!widget) return {{ error: "Widget not found" }};
        
        const container = widget.element;
        if (!container) return {{ error: "Container element not found" }};

        const tabs = container.querySelector("[class*='tabs-container']");
        const editorContainer = container.querySelector("[class*='editor-container']");
        
        if (!tabs || !editorContainer) return {{ 
            error: "Tabs or Editor container not found in DOM",
            html: container.innerHTML 
        }};

        const nodeRect = {{
            width: node.size[0],
            height: node.size[1]
        }};
        
        const containerRect = container.getBoundingClientRect();
        const tabsRect = tabs.getBoundingClientRect();
        const editorRect = editorContainer.getBoundingClientRect();
        const canvasScale = app.canvas.ds.scale;

        return {{
            nodeSize: nodeRect,
            containerSize: {{
                width: containerRect.width / canvasScale,
                height: containerRect.height / canvasScale
            }},
            tabsVisible: tabs.offsetHeight > 0,
            tabsHeight: tabs.offsetHeight,
            editorHeight: editorRect.height / canvasScale
        }};
    }}""", node_info['id'])

    if "error" in layout_info:
        pytest.fail(f"JS Error: {layout_info['error']}. HTML: {layout_info.get('html', 'N/A')}")

    print(f"DEBUG - Layout info at min size: {json.dumps(layout_info, indent=2)}")

    # 検証1: ウィジェットがノードの高さ（タイトル等を除く）を超えていないか
    # タイトル(36) + 出力(40) = 76px 引いたものがウィジェットの最大許容高さ
    expected_max_height = layout_info['nodeSize']['height'] - 76
    # 誤差吸収のため少し余裕を持たせる
    assert layout_info['containerSize']['height'] <= expected_max_height + 10, \
        f"Widget height {layout_info['containerSize']['height']} exceeds allowed height {expected_max_height}"

    # 検証2: タブが可視状態か
    assert layout_info['tabsVisible'], "Tabs should be visible even at small sizes"
    assert layout_info['tabsHeight'] >= 30, f"Tabs should have sufficient height, but got {layout_info['tabsHeight']}"

    print("Min size layout test finished.")
