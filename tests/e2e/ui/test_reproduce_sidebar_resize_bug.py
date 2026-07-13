import pytest
import os
import json
from playwright.sync_api import Page, expect

def test_reproduce_sidebar_resize_bug(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """サイドバーのリサイズが戻ってしまうバグを再現する"""
    page.set_viewport_size({"width": 1280, "height": 720})
    
    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_reproduce")
    os.makedirs(screenshot_dir, exist_ok=True)

    page.on("console", lambda msg: print(f"BROWSER: {msg.text}"))
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    wmp_helpers.wait_for_graph_clear(page)

    # MultiTextノードを作成
    node_id = wmp_helpers.create_node(page, "WebuiMonacoPromptMultiText", [100, 100])
    page.evaluate(f"""(args) => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph.getNodeById(args.id);
        node.size = [800, 600];
    }}""", {"id": node_id})
    
    wmp_helpers.wait_for_editor(page)

    sidebar = page.locator("[class*='multitext-sidebar']").nth(0)
    initial_width = sidebar.bounding_box()["width"]
    print(f"DEBUG - Initial Sidebar Width: {initial_width}")

    resizer = page.locator("[class*='multitext-resizer']").first
    resizer.hover()
    resizer_box = resizer.bounding_box()
    
    start_x = resizer_box["x"] + resizer_box["width"] / 2
    start_y = resizer_box["y"] + resizer_box["height"] / 2

    # リサイズ操作: 右へ 150px 移動 (steps=10 で滑らかなドラッグをシミュレート)
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x + 150, start_y, steps=10)
    page.mouse.up()

    # 直後の幅確認
    width_after_resize = sidebar.bounding_box()["width"]
    print(f"DEBUG - Width immediately after resize: {width_after_resize}")
    
    # バグが起きていれば、LiteGraphの描画サイクル(通常60fps)ですぐに戻るはず
    # 少し待機して戻らないか確認
    wmp_helpers.wait_for_ui_stabilize(page, 2000)
    
    final_width = sidebar.bounding_box()["width"]
    print(f"DEBUG - Final Sidebar Width after 2 seconds: {final_width}")

    page.screenshot(path=os.path.join(screenshot_dir, "final_state.png"))

    # アサーション: 幅が維持されていること（150px程度増えているはず）
    assert final_width > initial_width + 100, f"Sidebar width should be maintained. Initial: {initial_width}, Final: {final_width}"

