import pytest
import os
import re
from playwright.sync_api import Page, expect

def test_json_filter_full_workflow(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """MultiTextからJsonFilterへの連携と、UI操作によるフィルタリングの動的変化を検証する"""
    page.set_viewport_size({"width": 1280, "height": 720})
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)

    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_filter")
    os.makedirs(screenshot_dir, exist_ok=True)

    # 1. ノードの作成と接続
    wmp_helpers.wait_for_graph_clear(page)
    page.evaluate("""() => {
        const mt = LiteGraph.createNode("WebuiMonacoPromptMultiText");
        mt.pos = [100, 100];
        app.graph.add(mt);

        const filter = LiteGraph.createNode("WebuiMonacoPromptJsonFilter");
        filter.pos = [500, 100];
        app.graph.add(filter);

        const preview = LiteGraph.createNode("PreviewAny");
        if (preview) {
            preview.pos = [900, 100];
            app.graph.add(preview);
            filter.connect(0, preview, 0);
        }

        mt.connect(1, filter, 0);
        app.graph.change();
    }""")

    page.wait_for_selector("[class*='filter-container']", state="visible")
    
    # 2. テストデータ投入
    page.evaluate("""() => {
        const mt = app.graph._nodes.find(n => n.type.includes('MultiText'));
        mt.multitext_widget.addItemWithName('file', 'apple.txt');
        mt.multitext_widget.data.tree.find(i => i.name === 'apple.txt').content = "red fruit";
        mt.multitext_widget.addItemWithName('file', 'banana.txt');
        mt.multitext_widget.data.tree.find(i => i.name === 'banana.txt').content = "yellow fruit";
        app.graph.change();
    }""")

    # 3. フィルタールールの設定 (appleを含まないものに絞る)
    page.evaluate("() => document.querySelector(\"[class*='filter-add-btn']\").click()")
    page.wait_for_selector("[class*='filter-rule-row']")
    page.fill("[class*='filter-input']", "apple")
    
    # NOT条件を有効化
    page.evaluate("() => document.querySelector(\"[class*='filter-not-btn']\").click()")
    not_btn = page.locator("[class*='filter-not-btn']").first
    expect(not_btn).to_have_class(re.compile(r"active"))
    
    # 4. 実行
    preview_val = wmp_helpers.run_and_wait_output(page)

    # 5. 検証
    assert "yellow fruit" in str(preview_val)
    assert "red fruit" not in str(preview_val)

def test_json_filter_resize_tracking(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """ウィジェットの幅・高さがノードのリサイズに追従することを検証する"""
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    wmp_helpers.wait_for_graph_clear(page)

    # ノードを作成
    wmp_helpers.create_node(page, "WebuiMonacoPromptJsonFilter", [100, 100])
    page.wait_for_selector("[class*='filter-container']", state="visible")

    # 初期サイズ [400, 300] に設定
    node_id = page.evaluate("""() => {
        const node = app.graph._nodes[0];
        node.setSize([400, 300]);
        app.canvas.setDirty(true, true);
        return node.id;
    }""")
    wmp_helpers.wait_for_ui_stabilize(page, 500)

    # ルールを複数追加してコンテンツを増やす
    for _ in range(3):
        page.evaluate("() => document.querySelector(\"[class*='filter-add-btn']\").click()")
    wmp_helpers.wait_for_ui_stabilize(page, 500)

    # 現在のウィジェットコンテナのサイズを確認
    def get_container_size():
        return page.evaluate("""() => {
            const container = document.querySelector("[class*='filter-container']");
            const parent = container.parentElement;
            const node = app.graph._nodes[0];
            return {
                width: container.offsetWidth,
                height: container.offsetHeight,
                parentWidth: parent.offsetWidth,
                parentHeight: parent.offsetHeight,
                styleWidth: parent.style.width,
                styleHeight: parent.style.height,
                nodeWidth: node.size[0],
                nodeHeight: node.size[1]
            };
        }""")

    size_before = get_container_size()

    # ノードを大きくリサイズ [600, 500]
    page.evaluate(f"""(id) => {{
        const node = app.graph.getNodeById(id);
        node.setSize([600, 500]);
        app.canvas.setDirty(true, true);
        app.canvas.draw(true, true);
    }}""", node_id)
    wmp_helpers.wait_for_ui_stabilize(page, 500)

    size_after = get_container_size()
    print(f"DEBUG: Before: {size_before}")
    print(f"DEBUG: After: {size_after}")

    # 幅と高さが大きくなっていることを確認
    assert size_after["width"] > size_before["width"], f"Widget width should increase with node size. Before: {size_before}, After: {size_after}"
    assert size_after["height"] > size_before["height"], f"Widget height should increase with node size. Before: {size_before}, After: {size_after}"

    # ノードを小さくリサイズ [350, 200]
    page.evaluate(f"""(id) => {{
        const node = app.graph.getNodeById(id);
        node.setSize([350, 200]);
        app.canvas.setDirty(true, true);
        app.canvas.draw(true, true);
    }}""", node_id)
    wmp_helpers.wait_for_ui_stabilize(page, 500)

    size_final = get_container_size()

    # 小さくなったことを確認
    assert size_final["width"] < size_after["width"], f"Widget width should decrease with node size. After: {size_after}, Final: {size_final}"
    assert size_final["height"] < size_after["height"], f"Widget height should decrease with node size. After: {size_after}, Final: {size_final}"

def test_json_filter_persistence(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """シリアライズ・デシリアライズを通じて設定したルールが保持されているか検証する"""
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    
    # 1. 初期設定とシリアライズ
    serialized_data = page.evaluate("""() => {
        app.graph.clear();
        const filter = LiteGraph.createNode("WebuiMonacoPromptJsonFilter");
        app.graph.add(filter);
        const rules = [
            {id: 'p1', target: 'name', mode: 'include', not: true, value: 'persistence_test', operator: 'AND'}
        ];
        const widget = filter.widgets.find(w => w.name === 'rules');
        widget.value = JSON.stringify(rules);
        
        if (!filter.properties) filter.properties = {};
        filter.properties.rules = JSON.stringify(rules);

        return JSON.stringify(app.graph.serialize());
    }""")
    
    # 2. グラフをクリアして再構成
    page.evaluate(f"""async (data) => {{
        const obj = JSON.parse(data);
        await app.loadGraphData(obj);
        app.graph.change();
        app.canvas.draw(true);
    }}""", serialized_data)
    
    wmp_helpers.wait_for_ui_stabilize(page, timeout=1000)
    
    # 3. 検証
    page.wait_for_selector("[class*='filter-container']", state="attached")
    input_el = page.locator("[class*='filter-input']").first
    expect(input_el).to_have_value("persistence_test")
    not_btn = page.locator("[class*='filter-not-btn']").first
    expect(not_btn).to_have_class(re.compile(r"active"))
