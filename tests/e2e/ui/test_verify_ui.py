import pytest
import os
import json
from playwright.sync_api import Page, expect

def test_verify_ui_appearance(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """UIの外観を検証し、スクリーンショットを撮影するテスト"""
    page.set_viewport_size({"width": 1280, "height": 720})
    
    # スクリーンショット保存用ディレクトリ
    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots")
    os.makedirs(screenshot_dir, exist_ok=True)

    print(f"Navigating to {comfyui_server}...")
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    wmp_helpers.wait_for_graph_clear(page)

    # MultiTextノードを作成
    import uuid
    unique_id = uuid.uuid4().hex[:6]
    node_id = wmp_helpers.create_node(page, "WebuiMonacoPromptMultiText", [100, 100])
    page.evaluate(f"""(args) => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph.getNodeById(args.id);
        node.title = "MT-VERIFY-UI-" + args.unique_id;
        node.setSize([800, 600]);
    }}""", {"id": node_id, "unique_id": unique_id})
    
    wmp_helpers.wait_for_editor(page)

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

    # 基本コンポーネントの可視性検証
    expect(page.locator("[class*='multitext-container']")).to_be_visible()
    expect(page.locator("[class*='multitext-sidebar']").nth(0)).to_be_visible()
    expect(page.locator("[class*='main-area']")).to_be_visible()
    
    resizer = page.locator("[class*='multitext-resizer']")
    box = resizer.bounding_box()
    assert box, "Resizer should be visible"
    
    expect(page.locator("[class*='sidebar-toolbar']")).to_be_visible()
    expect(page.locator("[class*='multitext-tree']:not([class*='action'])").first).to_be_visible()
    expect(page.locator("[class*='multitext-tabs-container']")).to_be_visible()
    expect(page.locator("[class*='multitext-editor-container']")).to_be_visible()
    expect(page.locator("[class*='tree-name']", has_text="default.txt")).to_be_visible()

    # 2. アクションボタンの右寄せ検証 (ホバー)
    item_selector = "[class*='tree-item']:has-text('new_file.txt')"
    page.hover(item_selector)
    wmp_helpers.wait_for_ui_stabilize(page, 500)
    page.screenshot(path=os.path.join(screenshot_dir, "03_hover_actions_right.png"))


    # 3. リサイズハンドルの検証 (ドラッグ)
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] + 100, box["y"] + box["height"] / 2)
    page.screenshot(path=os.path.join(screenshot_dir, "04_resizing_sidebar.png"))
    page.mouse.up()

    # 広げた後の状態
    page.screenshot(path=os.path.join(screenshot_dir, "05_after_resize.png"))

    print(f"Screenshots saved to {screenshot_dir}")

if __name__ == "__main__":
    pass
