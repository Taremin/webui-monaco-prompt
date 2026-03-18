import pytest
import os
import json
import time
from playwright.sync_api import Page, expect

def test_multitext_output_final_verification(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """LiteGraph の実行をトリガーし、バックエンドの process が期待通りの出力を生成するか検証する"""
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    wmp_helpers.wait_for_graph_clear(page)

    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_output")
    os.makedirs(screenshot_dir, exist_ok=True)

    # 1. ワークフロー構築
    # MultiText -> PreviewAny (接続確認用)
    mt_id = wmp_helpers.create_node(page, "WebuiMonacoPromptMultiText", [100, 100])
    pa_id = wmp_helpers.create_node(page, "PreviewAny", [500, 100])

    page.evaluate(f"""() => {{
        const mtNode = app.graph.getNodeById({mt_id});
        const paNode = app.graph.getNodeById({pa_id});
        mtNode.connect(0, paNode, 0);
    }}""")

    # 2. 値のセットと実行トリガー
    # multitext_widget のメソッドを使用して内部状態とウィジェット値を正しく同期させる
    page.evaluate(f"""() => {{
        const mtNode = app.graph.getNodeById({mt_id});
        
        // メソッドを使用してアイテムを追加 (これにより内部データとウィジェットが矛盾なく更新される)
        mtNode.multitext_widget.addItemWithName('file', 'test_output.txt', undefined, 'FINAL_CHECK_CONTENT');
    }}""")

    # 3. 実行完了の待機と結果のポーリング
    final_val = wmp_helpers.run_and_wait_output(page, "PreviewAny")

    print(f"DEBUG - Final PreviewAny value: {final_val}")
    
    assert "FINAL_CHECK_CONTENT" in str(final_val), f"Expected 'FINAL_CHECK_CONTENT' in PreviewAny, but got: {final_val}"
    
    # 成功時のスクショ
    page.screenshot(path=os.path.join(screenshot_dir, "success_output.png"))

