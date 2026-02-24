import pytest
import os
import json
from playwright.sync_api import Page, expect

def test_multitext_resize_tracking(page: Page, comfyui_server, wait_for_comfyui):
    """リサイズバーがマウスカーソルに追従するか（特にズーム時）を検証する"""
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1280, "height": 720})

    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_resize_tracking")
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

    # リサイザーの位置を検証する関数
    def perform_resize_and_check(drag_distance_x, scale=1.0):
        print(f"\\n--- Testing resize tracking at scale: {scale} ---")
        # スケール設定
        page.evaluate(f"window.app.canvas.ds.scale = {scale}; window.app.canvas.setDirty(true, true);")
        page.wait_for_timeout(500)

        resizer = page.locator(".webui-monaco-prompt-multitext-resizer")
        initial_box = resizer.bounding_box()
        assert initial_box, "Resizer bounding box not found"

        start_x = initial_box["x"] + initial_box["width"] / 2
        start_y = initial_box["y"] + initial_box["height"] / 2

        target_x = start_x + drag_distance_x

        # ドラッグの開始
        page.mouse.move(start_x, start_y)
        page.mouse.down()

        # ドラッグ中
        page.mouse.move(target_x, start_y, steps=10)
        page.wait_for_timeout(500) # リサイズ処理が反映されるのを待つ

        # ドラッグ中のリサイザーの位置を取得
        current_box = resizer.bounding_box()
        current_resizer_center_x = current_box["x"] + current_box["width"] / 2

        print(f"DEBUG (Scale {scale}) - Target Mouse X: {target_x}, Resizer Center X: {current_resizer_center_x}")

        # ドラッグ終了
        page.mouse.up()
        page.wait_for_timeout(500)
        
        try:
            debug_logs = page.evaluate("window.RESIZE_DEBUG")
            print(f"BROWSER RESIZE LOGS: {json.dumps(debug_logs, indent=2)}")
        except Exception as e:
            print(f"Failed to get RESIZE_DEBUG: {e}")
        page.evaluate("window.RESIZE_DEBUG = []")

        # マウスカーソル（target_x）とリサイザーの中心（current_resizer_center_x）が近いことを確認
        # 15px以内の誤差は許容（UIの描画遅延や端数処理などを考慮）
        assert abs(target_x - current_resizer_center_x) < 15, \
            f"Resizer did not track mouse closely. Scale: {scale}, Expected Mouse X: {target_x}, Actual Resizer X: {current_resizer_center_x}, Diff: {abs(target_x - current_resizer_center_x)}"

    # スケール 1.0 で検証
    perform_resize_and_check(150, scale=1.0)
    page.screenshot(path=os.path.join(screenshot_dir, "01_scale_1.png"))

    # スケール 0.5 で検証 (ズームアウト)
    perform_resize_and_check(100, scale=0.5)
    page.screenshot(path=os.path.join(screenshot_dir, "02_scale_0_5.png"))

    # スケール 1.5 で検証 (ズームイン)
    perform_resize_and_check(-100, scale=1.5)
    page.screenshot(path=os.path.join(screenshot_dir, "03_scale_1_5.png"))
