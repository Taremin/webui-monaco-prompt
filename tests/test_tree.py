import pytest
from playwright.sync_api import Page

def test_multitext_tree_operations(page: Page, comfyui_server, wait_for_comfyui):
    """ツリー表示、フォルダ作成、ドラッグ＆ドロップのE2Eテスト"""
    page.set_default_timeout(60000)
    page.set_viewport_size({"width": 1920, "height": 1080})
    
    print(f"Navigating to {comfyui_server}...")
    page.on("console", lambda msg: print(f"JS Console: {msg.text}"))
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

    # 1. フォルダの作成
    print("Creating a folder...")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        if (!node) {
            console.error("MultiText node NOT found in graph!");
            return;
        }
        console.log("MultiText node found, widget:", node.multitext_widget);
        console.log("addItem function:", typeof node.multitext_widget.addItem);
        node.multitext_widget.addItemWithName('folder', 'new_folder');
    }""")
    
    # フォルダが表示されるのを待つ
    try:
        page.wait_for_selector(".webui-monaco-prompt-multitext-tree-name:has-text('new_folder')", timeout=5000)
    except Exception as e:
        page.screenshot(path="debug_tree_after_folder.png")
        raise e

    # 2. フォルダ内にファイルを作成
    print("Creating a file inside the folder...")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const folder = node.multitext_widget.data.tree.find(i => i.type === 'folder' && i.name === 'new_folder');
        folder.expanded = true; // 確実に展開
        node.multitext_widget.addItemWithName('file', 'new_file.txt', folder.id);
    }""")
    
    # ファイルが表示されるのを待つ
    page.wait_for_selector(".webui-monaco-prompt-multitext-tree-name:has-text('new_file.txt')")

    # 3. 階層の確認 (インデントがあること)
    indent_count = page.evaluate("""() => {
        const nameEl = Array.from(document.querySelectorAll('.webui-monaco-prompt-multitext-tree-name'))
                            .find(el => el.textContent === 'new_file.txt');
        const itemEl = nameEl.closest('.webui-monaco-prompt-multitext-tree-item');
        return itemEl.querySelectorAll('.webui-monaco-prompt-multitext-tree-indent').length;
    }""")
    assert indent_count == 1, f"Expected indent level 1, got {indent_count}"

    # 4. ドラッグ＆ドロップ (ファイルをトップレベルへ移動)
    print("Moving file to top level...")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {
            for (const item of items) {
                if (item.name === name) return item;
                if (item.children) { const res = findFile(item.children, name); if (res) return res; }
            }
        };
        const file = findFile(node.multitext_widget.data.tree, 'new_file.txt');
        const defaultFile = findFile(node.multitext_widget.data.tree, 'default.txt');
        node.multitext_widget.moveItem(file.id, defaultFile.id);
    }""")

    # インデントが 0 になったか確認
    page.wait_for_timeout(500)
    new_indent_count = page.evaluate("""() => {
        const item = Array.from(document.querySelectorAll('.webui-monaco-prompt-multitext-tree-item'))
                         .find(el => el.textContent.includes('new_file.txt'));
        return item.querySelectorAll('.webui-monaco-prompt-multitext-tree-indent').length;
    }""")
    assert new_indent_count == 0, f"Expected indent level 0, got {new_indent_count}"

    # 5. リロード後の永続性確認
    print("Saving and reloading workspace...")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.commitData();
    }""")
    
    import json
    workflow_data = page.evaluate("() => app.graph.serialize()")
    workflow_json = json.dumps(workflow_data)
    page.evaluate(f"() => app.graph.clear()")
    page.evaluate(f"(jsonStr) => app.graph.configure(JSON.parse(jsonStr))", workflow_json)
    
    page.wait_for_selector(".monaco-editor", state="visible")
    
    exists = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const items = node.multitext_widget.data.tree;
        const hasFolder = items.some(i => i.name === 'new_folder');
        const hasFile = items.some(i => i.name === 'new_file.txt');
        return hasFolder && hasFile;
    }""")
    assert exists, "Items should persist after reload"

    print("--- ALL TREE OPERATIONS VERIFIED ---")
