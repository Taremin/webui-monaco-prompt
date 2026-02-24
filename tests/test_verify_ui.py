import pytest
import os
import json
from playwright.sync_api import Page, expect

def test_verify_ui_appearance(page: Page, comfyui_server, wait_for_comfyui):
    """UIの外観を検証し、スクリーンショットを撮影するテスト"""
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1280, "height": 720})
    
    # スクリーンショット保存用ディレクトリ
    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots")
    os.makedirs(screenshot_dir, exist_ok=True)

    print(f"Navigating to {comfyui_server}...")
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
        node.setSize([800, 600]);
        app.graph.add(node);
    }}""")
    
    page.wait_for_selector(".monaco-editor", state="visible")

    # 初期状態のスクリーンショット
    page.screenshot(path=os.path.join(screenshot_dir, "01_initial_state.png"))

    # 1. フォルダとファイルを作成
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        console.log("Adding folder...");
        node.multitext_widget.addItemWithName('folder', 'new_folder');
        const folder = node.multitext_widget.data.tree.find(i => i.type === 'folder');
        if (!folder) {
           console.error("Folder not found in tree!", JSON.stringify(node.multitext_widget.data.tree));
           throw new Error("Folder not found after addItemWithName");
        }
        console.log("Adding file to folder:", folder.id);
        node.multitext_widget.addItemWithName('file', 'new_file.txt', folder.id);
    }""")
    
    # 描画待ち
    page.wait_for_selector("text=new_file.txt")
    
    # ツリーの状態を撮影 (ホバー前)
    page.screenshot(path=os.path.join(screenshot_dir, "02_tree_structure.png"))

    # 2. アクションボタンの右寄せ検証 (ホバー)
    item_selector = ".webui-monaco-prompt-multitext-tree-item:has-text('new_file.txt')"
    page.hover(item_selector)
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(screenshot_dir, "03_hover_actions_right.png"))

    # 3. リサイズハンドルの検証 (ドラッグ)
    resizer_selector = ".webui-monaco-prompt-multitext-resizer"
    resizer = page.locator(resizer_selector)
    box = resizer.bounding_box()
    assert box, "Resizer should be visible"

    # サイドバーを広げる
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] + 100, box["y"] + box["height"] / 2)
    page.screenshot(path=os.path.join(screenshot_dir, "04_resizing_sidebar.png"))
    page.mouse.up()

    # 広げた後の状態
    page.screenshot(path=os.path.join(screenshot_dir, "05_after_resize.png"))

    print(f"Screenshots saved to {screenshot_dir}")

if __name__ == "__main__":
    # 直接実行用ではなく pytest で実行することを想定
    pass
