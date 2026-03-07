import pytest
import time
import uuid
from playwright.sync_api import Page, expect

def test_multitext_decoration_independence(page: Page, comfyui_server, wait_for_comfyui):
    """サイドバー検索とノード内検索のデコレーション（ハイライト）が独立していることを確認する"""
    url = comfyui_server
    page.goto(url)
    wait_for_comfyui(page)
    page.set_viewport_size({"width": 1920, "height": 1080})

    # 2つのノードを作成
    node_a_title = f"MT-A-{uuid.uuid4().hex[:4]}"
    node_b_title = f"MT-B-{uuid.uuid4().hex[:4]}"

    page.evaluate(f"""(titles) => {{
        const app = window.app || window.ComfyApp;
        app.graph.clear();
        
        titles.forEach((title, i) => {{
            const node = LiteGraph.createNode("WebuiMonacoPromptMultiText");
            node.title = title;
            node.pos = [100, 100 + i * 350];
            node.setSize([600, 300]);
            app.graph.add(node);
        }});
    }}""", [node_a_title, node_b_title])

    # 準備待ち
    for title in [node_a_title, node_b_title]:
        page.wait_for_function(f"""
            (title) => {{
                const app = window.app || window.ComfyApp;
                const node = app.graph._nodes.find(n => n.title === title);
                return node && node.multitext_widget && !!node.multitext_widget.editorInstance;
            }}
        """, arg=title, timeout=60000)

    # テキスト入力
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const nodeA = app.graph._nodes.find(n => n.title === '{node_a_title}');
        const nodeB = app.graph._nodes.find(n => n.title === '{node_b_title}');
        
        nodeA.multitext_widget.editorInstance.monaco.setValue("apple banana");
        nodeB.multitext_widget.editorInstance.monaco.setValue("apple cherry");
    }}""")

    print("Step 1: Global Search for 'apple'")
    # utils.find を直接叩いてグローバル検索をシミュレート
    page.evaluate("""() => {
        const utils = window.WebuiMonacoPromptUtils; 
        if (!utils) throw new Error("Utils not found");
        utils.find("apple", false, false, false);
    }""")
    
    # グローバルデコレーションが反映されるまでポーリング待機
    page.wait_for_function(f"""() => {{
        const app = window.app || window.ComfyApp;
        const nodes = app.graph._nodes.filter(n => n.multitext_widget);
        if (nodes.length !== 2) return false;
        return nodes.every(n => (n.multitext_widget.editorInstance.findDecorationIds || []).length > 0);
    }}""", timeout=10000)

    dec_counts = page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const nodes = app.graph._nodes.filter(n => n.multitext_widget);
        return nodes.map(n => ({{
            title: n.title,
            global: (n.multitext_widget.editorInstance.findDecorationIds || []).length,
            local: (n.multitext_widget.editorInstance.nodeDecorationIds || []).length
        }}));
    }}""")
    print(f"Decoration counts after global search: {dec_counts}")
    for res in dec_counts:
        assert res['global'] > 0, f"Global decoration missing in {res['title']}"
        assert res['local'] == 0, f"Local decoration should be 0 in {res['title']}"

    print("Step 2: Local Search in Node A for 'banana'")
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const nodeA = app.graph._nodes.find(n => n.title === '{node_a_title}');
        const w = nodeA.multitext_widget;
        w.elements.searchInput.value = "banana";
        w.executeSearch();
    }}""")

    # ローカルデコレーションが反映されるまで待機
    page.wait_for_function(f"""() => {{
        const app = window.app || window.ComfyApp;
        const nodeA = app.graph._nodes.find(n => n.title === '{node_a_title}');
        return (nodeA.multitext_widget.editorInstance.nodeDecorationIds || []).length > 0;
    }}""", timeout=10000)

    dec_counts2 = page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const nodes = app.graph._nodes.filter(n => n.multitext_widget);
        return nodes.map(n => ({{
            title: n.title,
            global: (n.multitext_widget.editorInstance.findDecorationIds || []).length,
            local: (n.multitext_widget.editorInstance.nodeDecorationIds || []).length
        }}));
    }}""")
    print(f"Decoration counts after local search: {dec_counts2}")
    
    nodeA_res = next(r for r in dec_counts2 if r['title'] == node_a_title)
    nodeB_res = next(r for r in dec_counts2 if r['title'] == node_b_title)
    
    assert nodeA_res['global'] > 0, "Global decoration should remain in Node A"
    assert nodeA_res['local'] > 0, "Local decoration missing in Node A"
    
    assert nodeB_res['global'] > 0, "Global decoration should remain in Node B"
    assert nodeB_res['local'] == 0, "Local decoration should be 0 in Node B"

    print("Step 3: Clear Local Search in Node A")
    page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const nodeA = app.graph._nodes.find(n => n.title === '{node_a_title}');
        const w = nodeA.multitext_widget;
        w.elements.searchInput.value = "";
        w.executeSearch();
    }}""")

    # ローカルデコレーションが消えるまで待機
    page.wait_for_function(f"""() => {{
        const app = window.app || window.ComfyApp;
        const nodeA = app.graph._nodes.find(n => n.title === '{node_a_title}');
        return (nodeA.multitext_widget.editorInstance.nodeDecorationIds || []).length === 0;
    }}""", timeout=10000)

    dec_counts3 = page.evaluate(f"""() => {{
        const app = window.app || window.ComfyApp;
        const nodes = app.graph._nodes.filter(n => n.multitext_widget);
        return nodes.map(n => ({{
            title: n.title,
            global: (n.multitext_widget.editorInstance.findDecorationIds || []).length,
            local: (n.multitext_widget.editorInstance.nodeDecorationIds || []).length
        }}));
    }}""")
    print(f"Decoration counts after clearing local search: {dec_counts3}")
    
    nodeA_res_final = next(r for r in dec_counts3 if r['title'] == node_a_title)
    assert nodeA_res_final['global'] > 0, "Global decoration should still remain in Node A"
    assert nodeA_res_final['local'] == 0, "Local decoration should be cleared in Node A"

    print("Success: Decorations are independent between global and local search.")
