import pytest
import time
import os
from playwright.sync_api import Page, expect


def test_multitext_full_search(page: Page, comfyui_server, wait_for_comfyui):
    """非アクティブファイルの内容も横断検索で見つかること、結果クリックでタブが切り替わることを確認する"""
    # フィクスチャから取得したURLを使用
    url = comfyui_server
    page.goto(url)
    wait_for_comfyui(page)

    print("Step 1: Create MultiText and Find Nodes")
    # 1. MultiText ノードと Find ノードを作成 (API経由で直接作成して時間を節約)
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

    print("Step 2: Add files and content")
    # 2. ファイルを作成してテキストを入力
    # 最初のファイル (default.txt) は自動生成される
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.editorInstance.monaco.setValue("content in default.txt");
    }""")

    # 2つ目のファイルを追加
    page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        node.multitext_widget.addItemWithName('file', 'test1.txt');
    }""")
    time.sleep(0.5)

    # 新しいファイル名を取得して、テキストを入力
    second_file = "test1.txt"
    print(f"Second file created: {second_file}")
    print(f"Second file created: {second_file}")

    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const node = app.graph._nodes.find(n => n.multitext_widget);
        const findFile = (items, name) => {{
            for (const item of items) {{
                if (item.name === name) return item;
                if (item.children) {{ const res = findFile(item.children, name); if (res) return res; }}
            }}
        }};
        const f = findFile(node.multitext_widget.data.tree, '{second_file}');
        node.multitext_widget.openFile(f.id);
        node.multitext_widget.editorInstance.monaco.setValue("secret search word in hidden file");
    }}""")

    # 3. 再び default.txt をアクティブにする (second_file は非表示になる)
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

    print("Step 3: Execute search for hidden content")
    # 4. 検索を実行
    search_word = "secret"
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        // FindWidget インスタンスを探す
        let findWidget = null;
        for (const node of app.graph._nodes) {{
            if (node.find) {{
                findWidget = node.find;
                break;
            }}
        }}
        if (!findWidget) throw new Error("FindWidget not found");
        
        findWidget.elements.input.value = "{search_word}";
        findWidget.execute();
    }}""")

    time.sleep(1)

    print("Step 4: Verify search results")
    # 5. 検索結果を確認
    results_count = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        let findWidget = null;
        for (const node of app.graph._nodes) { if (node.find) { findWidget = node.find; break; } }
        return findWidget.elements.tbody.querySelectorAll("tr").length;
    }""")
    assert results_count > 0, f"Search word '{search_word}' was not found in hidden file"

    # 全ての検索結果を取得して、目的のファイルが含まれているか確認
    results_texts = page.evaluate("""() => {
        const app = window.app || window.ComfyApp;
        let findWidget = null;
        for (const node of app.graph._nodes) { if (node.find) { findWidget = node.find; break; } }
        return Array.from(findWidget.elements.tbody.querySelectorAll("tr")).map(tr => tr.innerText);
    }""")
    print(f"Total search results: {results_texts}")
    assert any(second_file in res for res in results_texts), f"Filename '{second_file}' not found in any search results: {results_texts}"

    print("Step 5: Click result and verify tab switch")
    # 6. 目的のファイルが含まれる検索結果をクリックしてタブ切り替えを検証
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        let findWidget = null;
        for (const node of app.graph._nodes) {{ if (node.find) {{ findWidget = node.find; break; }} }}
        const rows = Array.from(findWidget.elements.tbody.querySelectorAll("tr"));
        const targetRow = rows.find(tr => tr.innerText.includes("{second_file}"));
        if (!targetRow) throw new Error("Target search result row not found for " + "{second_file}");
        targetRow.click();
    }}""")

    time.sleep(1)

    # 現在のアクティブファイルが second_file になっているか確認
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
    assert active_file == second_file, f"Active file did not switch to '{second_file}', stayed at '{active_file}'"

    print("Verification successful: Hidden file searched and switched successfully.")
