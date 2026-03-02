import pytest
import os
import json
from playwright.sync_api import Page, expect

def test_reproduce_sidebar_resize_bug(page: Page, comfyui_server, wait_for_comfyui):
    """サイドバーのリサイズが戻ってしまうバグを再現する"""
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1280, "height": 720})
    
    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_reproduce")
    os.makedirs(screenshot_dir, exist_ok=True)

    page.on("console", lambda msg: print(f"BROWSER: {msg.text}"))
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    # ワークフローをクリア
    page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
    page.wait_for_function("() => app.graph && app.graph._nodes.length === 0", timeout=10000)

    # MultiTextノードを作成
    node_type = page.evaluate("""() => {
        const types = Object.keys(window.LiteGraph.registered_node_types);
        return types.find(t => t.includes('WebuiMonacoPromptMultiText'));
    }""")
    assert node_type, "MultiText node type should be registered"
    
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = window.LiteGraph.createNode("{node_type}");
        node.pos = [100, 100];
        node.size = [800, 600];
        app.graph.add(node);
    }}""")
    
    page.wait_for_selector(".monaco-editor", state="attached")

    sidebar = page.locator(".webui-monaco-prompt-multitext-sidebar")
    initial_width = sidebar.bounding_box()["width"]
    print(f"DEBUG - Initial Sidebar Width: {initial_width}")

    resizer = page.locator(".webui-monaco-prompt-multitext-resizer")
    resizer_box = resizer.bounding_box()
    
    start_x = resizer_box["x"] + resizer_box["width"] / 2
    start_y = resizer_box["y"] + resizer_box["height"] / 2

    # リサイズ操作: 右へ 150px 移動
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x + 150, start_y)
    page.mouse.up()

    # 直後の幅確認
    width_after_resize = sidebar.bounding_box()["width"]
    print(f"DEBUG - Width immediately after resize: {width_after_resize}")
    
    # バグが起きていれば、LiteGraphの描画サイクル(通常60fps)ですぐに戻るはず
    # 少し待機して戻らないか確認
    page.wait_for_timeout(2000)
    
    final_width = sidebar.bounding_box()["width"]
    print(f"DEBUG - Final Sidebar Width after 2 seconds: {final_width}")

    page.screenshot(path=os.path.join(screenshot_dir, "final_state.png"))

    # アサーション: 幅が維持されていること（150px程度増えているはず）
    assert final_width > initial_width + 100, f"Sidebar width should be maintained. Initial: {initial_width}, Final: {final_width}"
