import pytest
from playwright.sync_api import Page, expect
import os
from pathlib import Path

def test_template_autocomplete(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.on("console", lambda msg: print(f"BROWSER: {msg.text}"))
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    wmp_helpers.wait_for_graph_clear(page)

    # 1. MultiText ノードの作成
    node_id = wmp_helpers.create_node(page, "WebuiMonacoPromptMultiText")
    wmp_helpers.wait_for_editor(page)
    page.evaluate(f"""() => {{
        const node = window.app.graph.getNodeById({node_id});
        node.setSize([800, 600]);
        if (node.onResize) node.onResize(node.size);
    }}""")

    # 2. サブフォルダとテストファイルの作成（JSAPI経由でツリーを構築）
    page.evaluate(f"""() => {{
        const node = app.graph.getNodeById({node_id});
        const widget = node.multitext_widget;
        
        // addItemWithName を使ってダイアログを起動せずに追加
        const folderId = widget.addItemWithName('folder', 'sub_folder');
        const fileId = widget.addItemWithName('file', 'target_file.txt', folderId, 'Sub file content');
        
        // メインのファイル（treeの2番目など、最初にデフォルトで作られるファイル）を開いてフォーカス
        // 通常デフォルトで "main.txt" があるため、それをアクティブに
        const mainFile = widget.data.tree.find(item => item.type === 'file' && item.name === 'main.txt') 
                        || widget.data.tree.find(item => item.type === 'file');
        if (mainFile) {{
            widget.openFile(mainFile.id);
        }}
    }}""")

    # エディタの準備完了を待つ
    wmp_helpers.wait_for_ui_stabilize(page)
    
    # 3. エディタにフォーカスして「<」を入力
    page.evaluate("() => { const pe = document.querySelector('prompt-editor'); if (pe) pe.focus(); }")
    wmp_helpers.wait_for_ui_stabilize(page, 200)
    
    page.keyboard.type("<")
    # 自動挿入された '>' を削除して重複を防ぐ
    page.keyboard.press("Delete")
    wmp_helpers.wait_for_ui_stabilize(page, 200)
    
    # サジェスト起動
    page.evaluate("() => { const pe = document.querySelector('prompt-editor'); if (pe) pe.triggerSuggest(); }")
    page.wait_for_function("() => { const pe = document.querySelector('prompt-editor'); return pe && pe.isSuggestVisible(); }", timeout=5000)
    
    # 4. サジェスト候補の検証
    suggest_list = page.evaluate("() => { const pe = document.querySelector('prompt-editor'); return pe ? pe.getSuggestList() : []; }")
    
    # サジェスト項目に `include:sub_folder/target_file.txt` などが含まれていることを検証
    expected_suggestions = [
        "include:sub_folder/target_file.txt",
        "random:sub_folder/target_file.txt",
        "include:sub_folder/target_file",
        "random:sub_folder/target_file"
    ]
    
    for s in expected_suggestions:
        assert any(s in item for item in suggest_list), f"Suggestion '{s}' should be present in: {suggest_list}"

    # 5. 補完の確定と挿入テキストの検証
    # ここで "include:sub_folder/target_file.t" と入力して候補を絞り込み、確実にターゲットファイルを選択できるようにする
    page.keyboard.type("include:sub_folder/target_file.t")
    wmp_helpers.wait_for_ui_stabilize(page, 200)
    
    # Enterで確定
    page.keyboard.press("Enter")
    wmp_helpers.wait_for_ui_stabilize(page)
    
    editor_val = page.evaluate("() => { const pe = document.querySelector('prompt-editor'); return pe ? pe.monaco.getValue() : ''; }")
    assert editor_val == "<include:sub_folder/target_file.txt>", f"Editor value should be updated, got: {editor_val}"


def test_template_error_marker(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.on("console", lambda msg: print(f"BROWSER: {msg.text}"))
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    wmp_helpers.wait_for_graph_clear(page)

    # 1. ノードの作成
    # WebuiMonacoPromptMultiText
    mt_id = wmp_helpers.create_node(page, "WebuiMonacoPromptMultiText", pos=[100, 100])
    wmp_helpers.wait_for_editor(page)
    page.evaluate(f"""() => {{
        const node = window.app.graph.getNodeById({mt_id});
        node.setSize([800, 600]);
        if (node.onResize) node.onResize(node.size);
    }}""")
    
    # WebuiMonacoPromptTemplate
    tmpl_id = wmp_helpers.create_node(page, "WebuiMonacoPromptTemplate", pos=[500, 100])
    
    # PreviewAny
    preview_id = wmp_helpers.create_node(page, "PreviewAny", pos=[900, 100])

    # 2. ノードの接続とエラーデータの流し込み
    page.evaluate(f"""() => {{
        const mtNode = app.graph.getNodeById({mt_id});
        const tmplNode = app.graph.getNodeById({tmpl_id});
        const previewNode = app.graph.getNodeById({preview_id});
        
        // 接続:
        // MultiText (output 1: json) -> Template (input 0: source_templates)
        mtNode.connect(1, tmplNode, 0);
        // MultiText (output 1: json) -> Template (input 1: entry_points)
        mtNode.connect(1, tmplNode, 1);
        // Template (output 0: contents) -> PreviewAny (input 0)
        tmplNode.connect(0, previewNode, 0);
        
        // MultiText の中身に存在しないファイルを include する
        const widget = mtNode.multitext_widget;
        const mainFile = widget.data.tree.find(i => i.name === 'main.txt') || widget.data.tree[0];
        
        // モデルの中身を変更
        widget.openFile(mainFile.id);
        widget.models[mainFile.id].setValue("a girl, <include:nonexistent.txt>");
        widget.commitData();
    }}""")

    wmp_helpers.wait_for_ui_stabilize(page)

    # 3. 実行（Queue Prompt）
    page.evaluate("app.queuePrompt(0)")

    # 4. エラーダイアログの表示待機
    # ComfyUIでエラーが発生すると、ダイアログが表示される
    dialog_selector = ".p-dialog:visible, .comfy-modal:visible"
    page.wait_for_selector(dialog_selector, state="visible", timeout=15000)
    
    # 5. エラーリンクの存在確認とクリック
    link_selector = ".monaco-template-error-link"
    page.wait_for_selector(link_selector, state="visible", timeout=5000)
    
    # リンクをクリック
    page.locator(link_selector).first.click()
    
    # ダイアログが閉じるのを待つ
    page.wait_for_selector(dialog_selector, state="hidden", timeout=5000)
    
    # MultiTextノードにカメラを合わせてDOM表示をアクティブにする
    page.evaluate(f"() => {{ const node = app.graph.getNodeById({mt_id}); if (node && app.canvas) app.canvas.centerOnNode(node); }}")
    wmp_helpers.wait_for_ui_stabilize(page, 500)
    
    # 6. エディタ上の波線 (squiggly marker) の描画検証
    # 波線要素 (.squiggly-error) が Monaco Editor のDOM内に描画されているか
    page.wait_for_selector(".monaco-editor .squiggly-error", state="visible", timeout=5000)
    
    # テスト完了 (Redフェーズでは、ここまでのどこかで失敗する)
