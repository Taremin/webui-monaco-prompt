import pytest
import time
from playwright.sync_api import Page, expect
from playwright.sync_api import Page, expect


def test_multitext_tab_close_vs_delete(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """タブを閉じてもファイルが削除されないこと、サイドバーから削除できることを確認する"""
    # コンソールログを収集
    page.on("console", lambda msg: print(f"Browser Console [{msg.type}]: {msg.text}"))
    
    page.set_viewport_size({"width": 1920, "height": 1080})
    
    print(f"Navigating to {comfyui_server}...")
    page.goto(comfyui_server)
    wait_for_comfyui(page)
    page.screenshot(path="tests/debug_load_finished.png")

    # ワークフローをクリア (リトライ付き)
    for _ in range(3):
        try:
            page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
            wmp_helpers.wait_for_graph_clear(page)
            break
        except:
            wmp_helpers.wait_for_ui_stabilize(page, 2000)

    # MultiTextノードを作成
    node_type = None
    for _ in range(10):
        node_type = page.evaluate("""() => {
            if (typeof window.LiteGraph === 'undefined') return null;
            const types = Object.keys(window.LiteGraph.registered_node_types);
            return types.find(t => t.includes('WebuiMonacoPromptMultiText') || t.includes('MultiText'));
        }""")
        if node_type:
            break
        wmp_helpers.wait_for_ui_stabilize(page)
    
    assert node_type, "MultiText node type should be registered"

    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = window.LiteGraph.createNode("{node_type}");
        node.pos = [400, 300];
        app.graph.add(node);
    }}""")
    
    # ノードが準備できるのを待つ (Monaco Editor が見えるまで)
    try:
        wmp_helpers.wait_for_editor(page)
    except Exception as e:
        page.screenshot(path="tests/debug_editor_timeout.png")
        raise e

    # 新しいファイルを作成
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.addItemWithName('file', 'test_file_1.txt');
    }""")

    # ファイルが2つあることを確認
    page.wait_for_function("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const countFiles = (items) => items.reduce((acc, item) => acc + (item.type === 'file' ? 1 : 0) + (item.children ? countFiles(item.children) : 0), 0);
        return countFiles(node.multitext_widget.data.tree) >= 2;
    }""")

    filenames = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const getFileNames = (items) => items.flatMap(item => item.type === 'file' ? [item.name] : (item.children ? getFileNames(item.children) : []));
        return getFileNames(node.multitext_widget.data.tree);
    }""")
    target_file = filenames[-1]

    # タブを閉じる
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {{
            for (const item of items) {{
                if (item.name === name && item.type === 'file') return item.id;
                if (item.children) {{ const res = findFile(item.children, name); if (res) return res; }}
            }}
        }};
        const id = findFile(node.multitext_widget.data.tree, "{target_file}");
        if (id) node.multitext_widget.closeTab(id);
    }}""")

    # 検証1: タブからは消えているが、データとしては残っている
    wmp_helpers.wait_for_ui_stabilize(page)
    data_exists = page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {{
            for (const item of items) {{
                if (item.name === name && item.type === 'file') return item.id;
                if (item.children) {{ const res = findFile(item.children, name); if (res) return res; }}
            }}
        }};
        const id = findFile(node.multitext_widget.data.tree, "{target_file}");
        const isOpened = id ? node.multitext_widget.data.openedFileIds.includes(id) : false;
        const exists = !!id;
        return {{ isOpened, exists }};
    }}""")
    assert data_exists['isOpened'] is False
    assert data_exists['exists'] is True

    # 検証2: サイドバーから再度開ける
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {{
            for (const item of items) {{
                if (item.name === name && item.type === 'file') return item.id;
                if (item.children) {{ const res = findFile(item.children, name); if (res) return res; }}
            }}
        }};
        const id = findFile(node.multitext_widget.data.tree, "{target_file}");
        if (id) node.multitext_widget.openFile(id);
    }}""")
    
    page.wait_for_function(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {{
            for (const item of items) {{
                if (item.name === name && item.type === 'file') return item.id;
                if (item.children) {{ const res = findFile(item.children, name); if (res) return res; }}
            }}
        }};
        const id = findFile(node.multitext_widget.data.tree, "{target_file}");
        return id ? node.multitext_widget.data.openedFileIds.includes(id) : false;
    }}""")

    # 検証3: ファイルを削除する
    page.evaluate("""() => { window.confirm = () => true; }""")
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {{
            for (const item of items) {{
                if (item.name === name && item.type === 'file') return item.id;
                if (item.children) {{ const res = findFile(item.children, name); if (res) return res; }}
            }}
        }};
        const id = findFile(node.multitext_widget.data.tree, "{target_file}");
        if (id) node.multitext_widget.deleteItem(id);
    }}""")

    wmp_helpers.wait_for_ui_stabilize(page)
    data_deleted = page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {{
            for (const item of items) {{
                if (item.name === name && item.type === 'file') return item.id;
                if (item.children) {{ const res = findFile(item.children, name); if (res) return res; }}
            }}
        }};
        const id = findFile(node.multitext_widget.data.tree, "{target_file}");
        return !!id;
    }}""")
    assert data_deleted is False

    # --- 追加: 横断検索の検証を同じセッションで実行 ---
    print("--- Phase 4: Cross-file search verification ---")
    # ワークフローをクリアして、新しいノードを作成
    page.evaluate("() => { app.graph.clear(); }")
    wmp_helpers.wait_for_ui_stabilize(page)

    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        app.graph.clear();
        
        const mNode = window.LiteGraph.createNode("{node_type}");
        mNode.pos = [400, 300];
        app.graph.add(mNode);
        
        const fNode = LiteGraph.createNode("WebuiMonacoPromptFind");
        fNode.pos = [400, 800];
        app.graph.add(fNode);
    }}""")
    wmp_helpers.wait_for_editor(page)
    
    # ウィジェットが準備できるまで待つ（editorInstanceで確認）
    print("Waiting for multitext_widget.addItemWithName function in Phase 4...")
    page.wait_for_function("""
        () => {
            const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp || (window.parent && window.parent.app);
            const app = getApp();
            if (!app || !app.graph) return false;
            const node = app.graph._nodes.find(n => n.multitext_widget);
            if (!node) {
                return false;
            }
            const w = node.multitext_widget;
            const ready = !!w.editorInstance && typeof w.addItemWithName === 'function';
            if (ready) console.log("Phase 4: multitext_widget is READY!");
            return ready;
        }
    """)

    # 複数ファイルを作成し、内容を設定
    print("Creating multiple files for search...")
    # default.txt にテキスト設定
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.editorInstance.monaco.setValue("COMMON_QUERY in default");
    }""")
    
    # 2つ目のファイルを作成
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.addItemWithName('file', 'file_a.txt');
        const findFile = (items, name) => {
            for (const item of items) {
                if (item.name === name) return item.id;
                if (item.children) { const res = findFile(item.children, name); if (res) return res; }
            }
        };
        const id = findFile(node.multitext_widget.data.tree, 'file_a.txt');
        if (id) node.multitext_widget.openFile(id);
    }""")
    wmp_helpers.wait_for_ui_stabilize(page, 500)
    file_a = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, id) => {
            for (const item of items) {
                if (item.id === id && item.type === 'file') return item.name;
                if (item.children) { const res = findFile(item.children, id); if (res) return res; }
            }
        };
        return findFile(node.multitext_widget.data.tree, node.multitext_widget.data.activeFileId) || "unknown";
    }""")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.editorInstance.monaco.setValue("COMMON_QUERY in file-a");
    }""")
    
    # 3つ目のファイルを作成
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.addItemWithName('file', 'file_b.txt');
        const findFile = (items, name) => {
            for (const item of items) {
                if (item.name === name) return item.id;
                if (item.children) { const res = findFile(item.children, name); if (res) return res; }
            }
        };
        const id = findFile(node.multitext_widget.data.tree, 'file_b.txt');
        if (id) node.multitext_widget.openFile(id);
    }""")
    wmp_helpers.wait_for_ui_stabilize(page, 500)
    file_b = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, id) => {
            for (const item of items) {
                if (item.id === id && item.type === 'file') return item.name;
                if (item.children) { const res = findFile(item.children, id); if (res) return res; }
            }
        };
        return findFile(node.multitext_widget.data.tree, node.multitext_widget.data.activeFileId) || "unknown";
    }""")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.editorInstance.monaco.setValue("COMMON_QUERY in file-b UNIQUE_KEY");
    }""")
    
    print(f"Created files: default.txt, {file_a}, {file_b}")
    
    # default.txt に戻す
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {
            for (const item of items) {
                if (item.name === name && item.type === 'file') return item.id;
                if (item.children) { const res = findFile(item.children, name); if (res) return res; }
            }
        };
        const id = findFile(node.multitext_widget.data.tree, "default.txt");
        if (id) node.multitext_widget.openFile(id);
    }""")
    wmp_helpers.wait_for_ui_stabilize(page, 2000)

    # 横断検索実行
    print("Executing search for 'COMMON_QUERY'...")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const findWidget = app.graph._nodes.find(n => n.find).find;
        findWidget.elements.input.value = "COMMON_QUERY";
        findWidget.execute();
    }""")
    wmp_helpers.wait_for_ui_stabilize(page, 2000)

    # 全ファイルが含まれているか確認
    results = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const findWidget = app.graph._nodes.find(n => n.find).find;
        return Array.from(findWidget.elements.tbody.querySelectorAll("tr")).map(tr => tr.innerText);
    }""")
    print(f"Search results: {results}")
    # default.txt はメインモデルとして表示される場合、括弧内のファイル名が表示されない ( node.title のみになる )
    assert any("default.txt" in r or ("WebuiMonacoPromptMultiText" in r and "(" not in r) for r in results), "default.txt (or main model) not found in results"
    assert any(file_a in r for r in results), f"File '{file_a}' not found in results"
    assert any(file_b in r for r in results), f"File '{file_b}' not found in results"

    # ジャンプとタブ切り替えの検証
    print("Testing JUMP and tab switch...")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const findWidget = app.graph._nodes.find(n => n.find).find;
        findWidget.elements.input.value = "UNIQUE_KEY";
        findWidget.execute();
    }""")
    wmp_helpers.wait_for_ui_stabilize(page)
    
    # 目的のファイルが含まれる検索結果をクリック
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const findWidget = app.graph._nodes.find(n => n.find).find;
        const rows = Array.from(findWidget.elements.tbody.querySelectorAll("tr"));
        const targetRow = rows.find(tr => tr.innerText.includes("{file_b}"));
        if (!targetRow) throw new Error("Target row for {file_b} not found in UNIQUE_KEY search");
        targetRow.click();
    }}""")
    wmp_helpers.wait_for_ui_stabilize(page, 2000)

    # アクティブファイルが切り替わったか確認
    active_file = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, id) => {
            for (const item of items) {
                if (item.id === id && item.type === 'file') return item.name;
                if (item.children) { const res = findFile(item.children, id); if (res) return res; }
            }
        };
        return findFile(node.multitext_widget.data.tree, node.multitext_widget.data.activeFileId) || "unknown";
    }""")
    print(f"Active file after jump: {active_file}")
    assert active_file == file_b, f"Expected {file_b}, got {active_file}"
    
    print("--- ALL VERIFICATIONS COMPLETED SUCCESSFULLY ---")

