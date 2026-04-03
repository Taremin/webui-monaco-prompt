import pytest
import os
import json
import re
from playwright.sync_api import Page, expect

def test_multitext_selection_mode(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    Selection Modeのテスト
    1. ツールバーのボタンクリックでチェックボックスが現れること
    2. チェックボックスを切り替え、状態が変化すること
    3. 保存してリロードした際にも状態が維持されること
    """
    page.set_viewport_size({"width": 1280, "height": 720})

    screenshot_dir = os.path.join(os.getcwd(), "tests", "screenshots_features")
    os.makedirs(screenshot_dir, exist_ok=True)

    page.on("console", lambda msg: print(f"BROWSER: {msg.text}"))
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    wmp_helpers.wait_for_graph_clear(page)

    # MultiTextノードを作成
    wmp_helpers.create_node(page, "WebuiMonacoPromptMultiText", [100, 100])
    wmp_helpers.wait_for_ui_stabilize(page, 1000)

    # ダイアログのイベントハンドラを単一にまとめる
    dialog_text = ""
    def handle_dialog(dialog):
        print(f"DEBUG: Handling dialog, text={dialog_text}")
        dialog.accept(dialog_text)
    page.on("dialog", handle_dialog)

    # ツールバーとボタンの取得
    selection_btn = page.locator("button[title='Toggle Selection Mode']").first
    add_file_btn = page.locator("button[title='New File']").first
    add_folder_btn = page.locator("button[title='New Folder']").first

    # フォルダ1つ、ファイル2つを作成する (default.txtが既に存在している前提)

    # フォルダ "SubFolder" を作成
    dialog_text = "SubFolder"
    add_folder_btn.click()
    wmp_helpers.wait_for_ui_stabilize(page, 500)

    # SubFolder の ID を取得し、その中に "sub_file.txt" を作成する
    page.evaluate("""() => {
        const node = app.graph._nodes.find(n => n.type === 'WebuiMonacoPromptMultiText');
        const tree = node.multitext_widget.data.tree;
        const subFolder = tree.find(i => i.name === 'SubFolder');
        if (subFolder) {
            node.multitext_widget.addItemWithName('file', 'sub_file.txt', subFolder.id);
        }
    }""")
    wmp_helpers.wait_for_ui_stabilize(page, 500)

    # 1. Selection Mode を有効化し、チェックボックスが表示されることを確認
    selection_btn.click()
    wmp_helpers.wait_for_ui_stabilize(page, 500)
    expect(selection_btn).to_have_class(re.compile(r"active"))

    # wait_for_ui_stabilize でDOMの更新を待機
    wmp_helpers.wait_for_ui_stabilize(page, 1000)

    # 2. UI操作でのチェックボックスのトグル
    default_txt_item = page.locator("div").filter(has_text=re.compile(r"^default.txt$")).first
    default_checkbox = default_txt_item.locator("xpath=..").locator("input[type='checkbox']").first
    default_checkbox.click(force=True)
    expect(default_checkbox).not_to_be_checked()

    # SubFolder のチェックボックスと sub_file.txt のチェックボックスを取得
    sub_folder_item = page.locator("div").filter(has_text=re.compile(r"^SubFolder$")).first
    sub_folder_checkbox = sub_folder_item.locator("xpath=..").locator("input[type='checkbox']").first
    sub_file_item = page.locator("div").filter(has_text=re.compile(r"^sub_file.txt$")).first
    sub_file_checkbox = sub_file_item.locator("xpath=..").locator("input[type='checkbox']").first

    # (A) 親(SubFolder)をOFFにすると、子(sub_file.txt)もOFFになることの確認
    sub_folder_checkbox.click(force=True)
    expect(sub_folder_checkbox).not_to_be_checked()
    expect(sub_file_checkbox).not_to_be_checked()

    # (B) 子をONにすると、親もON(出力ルート確保のため)になることの確認
    sub_file_checkbox.click(force=True)
    expect(sub_file_checkbox).to_be_checked()
    expect(sub_folder_checkbox).to_be_checked() # 子が全てONなので親も完全なONになる

    # (C) 再度子をOFFにすると、子要素がすべてOFFになるため親もOFFになることの確認
    sub_file_checkbox.click(force=True)
    expect(sub_file_checkbox).not_to_be_checked()
    expect(sub_folder_checkbox).not_to_be_checked()

    # データへの反映を確実にする
    page.evaluate("""
        () => {
            const node = app.graph._nodes.find(n => n.type === 'WebuiMonacoPromptMultiText');        
            node.multitext_widget.commitData();
        }
    """)

    # 4. 保存とリロードによる状態維持 (Persistence)
    page.evaluate("""() => {
        if (window.comfyAPI && window.comfyAPI.api && window.comfyAPI.api.api) {
            window.comfyAPI.api.api.dispatchEvent(new CustomEvent('graphChanged'));
        } else if (window.api) {
            window.api.dispatchEvent(new CustomEvent('graphChanged'));
        } else {
            app.graph.change();
        }
    }""")
    wmp_helpers.wait_for_ui_stabilize(page, 2000)

    # リロードしてグラフを復元
    # on('dialog') がリロード後にエラーになるのを防ぐため、解除しておく
    page.remove_listener("dialog", handle_dialog)

    # localstorageに保存されていることを明示的に保証するため少し待機
    page.wait_for_timeout(1000)

    page.reload()
    wait_for_comfyui(page)

    # グラフがロードされるまで待機
    page.evaluate("""() => {
        return new Promise(resolve => {
            if (app.graph && app.graph._nodes && app.graph._nodes.length > 0) {
                resolve();
            } else {
                const interval = setInterval(() => {
                    if (app.graph && app.graph._nodes && app.graph._nodes.length > 0) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 100);
            }
        });
    }""")
    wmp_helpers.wait_for_ui_stabilize(page, 3000) # DOMが構築されるのを待機

    # 復元後、Selection Mode が有効で、内部データにチェックボックスの状態が維持されていることを確認
    # (DOMロケーターの不安定さを回避するためevaluateでデータを直接検証)
    is_persisted = page.evaluate("""() => {
        const node = app.graph._nodes.find(n => n.type === 'WebuiMonacoPromptMultiText');
        if (!node || !node.multitext_widget || !node.multitext_widget.data) return false;

        const data = node.multitext_widget.data;
        if (!data.selectionMode) return false;

        const defaultTxt = data.tree.find(i => i.name === 'default.txt');
        const subFolder = data.tree.find(i => i.name === 'SubFolder');
        const subFile = subFolder && subFolder.children ? subFolder.children.find(i => i.name === 'sub_file.txt') : null;

        // 全て output が false もしくは "false" となっていることを確認
        const isDefaultTxtUnchecked = defaultTxt && (defaultTxt.output === false || defaultTxt.output === "false");
        const isSubFolderUnchecked = subFolder && (subFolder.output === false || subFolder.output === "false");
        const isSubFileUnchecked = subFile && (subFile.output === false || subFile.output === "false");

        return isDefaultTxtUnchecked && isSubFolderUnchecked && isSubFileUnchecked;
    }""")

    assert is_persisted, "Selection Mode and uncheck states should be persisted after reload"

    print("E2E Test: Selection Mode persistence and logic verified.")