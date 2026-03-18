import pytest
import uuid
from playwright.sync_api import Page

def test_multitext_tree_operations(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """(非破壊方式) ツリー操作のE2Eテスト"""
    page.set_viewport_size({"width": 1920, "height": 1080})
    
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    wmp_helpers.wait_for_graph_clear(page)

    node_title = f"MT-TREE-{uuid.uuid4().hex[:6]}"
    node_id = wmp_helpers.create_node(page, "WebuiMonacoPromptMultiText", [300, 300])
    page.evaluate(f"""(args) => {{
        const node = app.graph.getNodeById(args.id);
        node.title = args.title;
        node.setSize([800, 600]);
    }}""", {"id": node_id, "title": node_title})
    
    wmp_helpers.wait_for_editor(page)

    print("Step 1: Adding folder...")
    page.evaluate(f"""(title) => {{
        const node = (window.app || window.ComfyApp).graph._nodes.find(n => n.title === title);
        node.multitext_widget.addItemWithName('folder', 'new_folder');
    }}""", node_title)
    
    # ウィジェット内部のデータをチェック
    wmp_helpers.wait_for_ui_stabilize(page)
    has_folder = page.evaluate(f"""(title) => {{
        const node = (window.app || window.ComfyApp).graph._nodes.find(n => n.title === title);
        return node.multitext_widget.data.tree.some(i => i.name === 'new_folder');
    }}""", node_title)
    assert has_folder, "Folder was not created internally"

    print("Step 2: Adding file inside folder...")
    page.evaluate(f"""(title) => {{
        const node = (window.app || window.ComfyApp).graph._nodes.find(n => n.title === title);
        const folder = node.multitext_widget.data.tree.find(i => i.name === 'new_folder');
        node.multitext_widget.addItemWithName('file', 'child.txt', folder.id);
    }}""", node_title)
    
    wmp_helpers.wait_for_ui_stabilize(page, 500)
    is_nested = page.evaluate(f"""(title) => {{
        const node = (window.app || window.ComfyApp).graph._nodes.find(n => n.title === title);
        const folder = node.multitext_widget.data.tree.find(i => i.name === 'new_folder');
        return folder.children && folder.children.some(c => c.name === 'child.txt');
    }}""", node_title)
    assert is_nested, "File was not nested in folder"

    print("Step 3: Moving file to root...")
    page.evaluate(f"""(title) => {{
        const node = (window.app || window.ComfyApp).graph._nodes.find(n => n.title === title);
        const folder = node.multitext_widget.data.tree.find(i => i.name === 'new_folder');
        const file = folder.children.find(c => c.name === 'child.txt');
        node.multitext_widget.moveItems([file.id], undefined);
    }}""", node_title)
    
    wmp_helpers.wait_for_ui_stabilize(page, 500)
    is_root = page.evaluate(f"""(title) => {{
        const node = (window.app || window.ComfyApp).graph._nodes.find(n => n.title === title);
        return node.multitext_widget.data.tree.some(i => i.name === 'child.txt');
    }}""", node_title)
    assert is_root, "File was not moved to root"

    print("--- NON-DESTRUCTIVE TREE TEST PASSED ---")

