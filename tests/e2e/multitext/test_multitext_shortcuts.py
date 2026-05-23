import pytest
from playwright.sync_api import Page, expect

def test_multitext_keyboard_propagation(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """MultiTextウィジェットでのキー入力がComfyUI側に伝播しないことを確認する"""
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(comfyui_server)
    
    # コンソールログを収集
    page.on("console", lambda msg: print(f"Browser Console [{msg.type}]: {msg.text}"))
    wait_for_comfyui(page)
    
    page.wait_for_load_state("domcontentloaded")

    # ワークフローをクリア
    page.evaluate("() => { if (typeof app !== 'undefined' && app.graph) { app.graph.clear(); } }")
    wmp_helpers.wait_for_graph_clear(page)

    # MultiTextノード名を取得
    node_type = page.evaluate("""async () => {
        const check = () => {
            if (typeof window.LiteGraph === 'undefined') return null;
            const types = Object.keys(window.LiteGraph.registered_node_types);
            return types.find(t => t.includes('WebuiMonacoPromptMultiText') || t.includes('MultiText')) || null;
        };
        let match = check();
        if (match) return match;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 500));
            match = check();
            if (match) return match;
        }
        return null;
    }""")
    assert node_type, "MultiText node type not found"

    # ノード追加
    page.evaluate(f"""() => {{
        const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = getApp();
        const node = window.LiteGraph.createNode("{node_type}");
        node.pos = [400, 300];
        app.graph.add(node);
        app.canvas.centerOnNode(node);
        window.testNodeId = node.id;
    }}""")
    
    page.wait_for_function("() => app.graph && app.graph._nodes.length > 0")

    # エディターの準備完了を待つ
    wmp_helpers.wait_for_editor(page)
    
    # API経由でフォーカスを当てる (Shadow DOM内のtextareaフォーカス/クリックもカプセル化されています)
    page.evaluate("() => { const pe = document.querySelector('prompt-editor'); if (pe) pe.focus(); }")

    wmp_helpers.wait_for_ui_stabilize(page, 500)

    # 削除キー(DeleteやBackspace)を打つ。伝播していればノードが削除される。
    page.keyboard.press("Backspace")
    page.keyboard.press("Delete")
    page.keyboard.press("q") # q等も他のショートカットに割り当てられる可能性がある

    wmp_helpers.wait_for_ui_stabilize(page)

    # ノードが消滅せずに存在していることを確認する
    node_count = page.evaluate("() => app.graph._nodes.length")
    assert node_count == 1, f"Keyboard event propagated and deleted the node! Expected 1 node, got {node_count}"

