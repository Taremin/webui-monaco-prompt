import pytest
import time
import os
import subprocess
from playwright.sync_api import Page


def test_multitext_cross_file_search(page: Page, comfyui_server, wait_for_comfyui):
    """複数ファイルを横断してCOMMON_WORDが検索され、結果クリックで正しいファイルに切り替わることを確認する"""
    url = comfyui_server
    print(f"Connecting to {url}...")
    
    page.goto(url, timeout=60000)
    wait_for_comfyui(page)

    print("Step 1: Create MultiText and Find Nodes")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        app.graph.clear();
        
        const mNode = LiteGraph.createNode("WebuiMonacoPromptMultiText");
        mNode.pos = [100, 100];
        app.graph.add(mNode);
        
        const fNode = LiteGraph.createNode("WebuiMonacoPromptFind");
        fNode.pos = [100, 500];
        app.graph.add(fNode);
    }""")
    # ウィジェットが完全に初期化されるまで待機
    page.wait_for_function("""
        () => {
            const app = window.app || window.ComfyApp;
            const node = app.graph._nodes.find(n => n.multitext_widget);
            return node && node.multitext_widget && !!node.multitext_widget.editorInstance;
        }
    """, timeout=60000)

    print("Step 2: Setup multiple files")
    # default.txt にテキスト設定
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.editorInstance.monaco.setValue("COMMON_WORD in first file");
    }""")

    # 2つ目のファイルを作成
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.addItemWithName('file', 'test1.txt');
    }""")
    time.sleep(0.5)
    file2_name = "test1.txt"
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {{
            for (const item of items) {{
                if (item.name === name) return item;
                if (item.children) {{ const res = findFile(item.children, name); if (res) return res; }}
            }}
        }};
        const f = findFile(node.multitext_widget.data.tree, '{file2_name}');
        node.multitext_widget.openFile(f.id);
        node.multitext_widget.editorInstance.monaco.setValue("COMMON_WORD in second file with UNIQUE_TWO");
    }}""")

    # 3つ目のファイルを作成
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.addItemWithName('file', 'test2.txt');
    }""")
    time.sleep(0.5)
    file3_name = "test2.txt"
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {{
            for (const item of items) {{
                if (item.name === name) return item;
                if (item.children) {{ const res = findFile(item.children, name); if (res) return res; }}
            }}
        }};
        const f = findFile(node.multitext_widget.data.tree, '{file3_name}');
        node.multitext_widget.openFile(f.id);
        node.multitext_widget.editorInstance.monaco.setValue("COMMON_WORD in third file with UNIQUE_THREE");
    }}""")

    print(f"Created files: default.txt, {file2_name}, {file3_name}")

    # default.txt に戻す
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {
            for (const item of items) {
                if (item.name === name) return item;
                if (item.children) { const res = findFile(item.children, name); if (res) return res; }
            }
        };
        const f = findFile(node.multitext_widget.data.tree, 'default.txt');
        if (f) node.multitext_widget.openFile(f.id);
    }""")
    time.sleep(1)

    print("Step 3: Cross-file search")
    search_word = "COMMON_WORD"
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        let findWidget = app.graph._nodes.find(n => n.find)?.find;
        if (!findWidget) throw new Error("FindWidget not found");
        findWidget.elements.input.value = "{search_word}";
        findWidget.execute();
    }}""")
    time.sleep(2)

    rows_text = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        let findWidget = app.graph._nodes.find(n => n.find)?.find;
        return Array.from(findWidget.elements.tbody.querySelectorAll("tr")).map(tr => tr.innerText);
    }""")
    
    print(f"Results: {rows_text}")
    # 順序に依存せず、各ファイル名が含まれていることを確認
    # default.txt はメインモデルとして表示される場合、括弧内のファイル名が表示されない ( node.title のみになる )
    assert any("default.txt" in r or ("WebuiMonacoPromptMultiText" in r and "(" not in r) for r in rows_text), "default.txt (or main model) not found in results"
    assert any(file2_name in r for r in rows_text), f"{file2_name} not found in results"
    assert any(file3_name in r for r in rows_text), f"{file3_name} not found in results"
    
    print("Step 4: Jump to file3")
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        let findWidget = app.graph._nodes.find(n => n.find)?.find;
        findWidget.elements.input.value = "UNIQUE_THREE";
        findWidget.execute();
    }""")
    time.sleep(1)
    
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        let findWidget = app.graph._nodes.find(n => n.find)?.find;
        const rows = Array.from(findWidget.elements.tbody.querySelectorAll("tr"));
        const targetRow = rows.find(tr => tr.innerText.includes("{file3_name}"));
        if (!targetRow) throw new Error("Target row for {file3_name} not found");
        targetRow.click();
    }}""")
    time.sleep(1)

    active_file = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, id) => {
            for (const item of items) {
                if (item.id === id) return item;
                if (item.children) { const res = findFile(item.children, id); if (res) return res; }
            }
        };
        const activeId = node.multitext_widget.data.activeFileId;
        const file = findFile(node.multitext_widget.data.tree, activeId);
        return file ? file.name : null;
    }""")
    assert active_file == file3_name, f"Failed to switch to {file3_name}, got {active_file}"
    print("Verification successful!")
