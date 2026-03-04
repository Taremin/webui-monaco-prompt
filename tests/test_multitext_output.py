import pytest
import os
import json
import time
from playwright.sync_api import Page, expect

def test_multitext_output_final_verification(page: Page, comfyui_server, wait_for_comfyui):
    """LiteGraph の実行をトリガーし、バックエンドの process が期待通りの出力を生成するか検証する"""
    page.set_default_timeout(60000)
    page.goto(comfyui_server)
    wait_for_comfyui(page)

    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_output")
    os.makedirs(screenshot_dir, exist_ok=True)

    # 1. ワークフロー構築
    # MultiText -> PreviewAny (接続確認用)
    node_info = page.evaluate("""() => {
        const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = getApp();
        app.graph.clear();

        const mtType = Object.keys(window.LiteGraph.registered_node_types).find(t => t.includes('WebuiMonacoPromptMultiText'));
        const mtNode = window.LiteGraph.createNode(mtType);
        mtNode.pos = [100, 100];
        app.graph.add(mtNode);

        const paNode = window.LiteGraph.createNode("PreviewAny");
        paNode.pos = [500, 100];
        app.graph.add(paNode);

        mtNode.connect(0, paNode, 0);

        return { mtId: mtNode.id, paId: paNode.id };
    }""")

    # 2. 値のセットと実行トリガー
    # multitext_widget のメソッドを使用して内部状態とウィジェット値を正しく同期させる
    page.evaluate("""() => {
        const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
        const app = getApp();
        const mtNode = app.graph.getNodeById({mtId});
        
        // メソッドを使用してアイテムを追加 (これにより内部データとウィジェットが矛盾なく更新される)
        mtNode.multitext_widget.addItemWithName('file', 'test_output.txt', undefined, 'FINAL_CHECK_CONTENT');
        
        // グラフ変更を通知して確実にシリアライズの準備を整える
        app.graph.change();
        
        // 実行開始 (標準的な queuePrompt を使用)
        app.queuePrompt(0);
    }""".replace("{mtId}", str(node_info['mtId'])))

    # 3. 実行完了の待機と結果のポーリング
    # PreviewAny (paNode) のウィジェット値が更新されるのを待つ
    success = False
    final_val = ""
    for i in range(20):
        final_val = page.evaluate(f"""() => {{
            const getApp = () => window.app || (window.comfyAPI && window.comfyAPI.app) || window.ComfyApp;
            const app = getApp();
            const paNode = app.graph.getNodeById({node_info['paId']});
            return paNode.widgets ? paNode.widgets[0].value : "NO_WIDGET";
        }}""")
        
        # 期待する値が含まれているか確認
        if "FINAL_CHECK_CONTENT" in str(final_val):
            success = True
            break
        
        time.sleep(1)

    print(f"DEBUG - Final PreviewAny value: {final_val}")
    
    # 失敗時のスクショ
    if not success:
        page.screenshot(path=os.path.join(screenshot_dir, "failure_output.png"))
        
    assert success, f"Expected 'FINAL_CHECK_CONTENT' in PreviewAny, but got: {final_val}"
    
    # 成功時のスクショ
    page.screenshot(path=os.path.join(screenshot_dir, "success_output.png"))
