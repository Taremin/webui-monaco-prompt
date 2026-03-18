import pytest
from playwright.sync_api import Page, expect

def test_jinja2_comment_vs_hash_comment(page: Page, comfyui_server, wait_for_comfyui, wmp_helpers):
    """
    Jinja2コメント {# ... #} とハッシュコメント # ... の競合を検証する。
    """
    wmp_helpers.load_comfyui(page, comfyui_server, wait_for_comfyui)
    
    # 完全にクリーンな状態で開始
    page.evaluate("localStorage.clear()")
    page.reload()
    wait_for_comfyui(page)

    wmp_helpers.wait_for_graph_clear(page)

    # ノードを追加
    wmp_helpers.create_node(page, "CLIPTextEncode", [400, 300])
    
    # エディタのアタッチを待機
    wmp_helpers.wait_for_editor(page)
    
    # 全機能ONのプリセットに設定
    page.evaluate("""() => {
        const editorEl = document.querySelector('prompt-editor');
        if (editorEl) {
            editorEl.applyPreset('full-features');
        }
    }""")
    wmp_helpers.wait_for_ui_stabilize(page)

    # テキストを入力
    prompt_text = (
        "{# jinja comment #}\n"
        "# hash comment\n"
        "text # hash comment with {# no jinja #}\n"
        "{# jinja with # hash inside #}\n"
        "text {# jinja after text #}"
    )
    
    page.evaluate(f"""() => {{
        const editorEl = document.querySelector('prompt-editor');
        if (editorEl && editorEl.monaco) {{
            editorEl.monaco.setValue({repr(prompt_text)});
        }}
    }}""")
    
    # Valueが反映されるまで待機
    page.wait_for_function(f"""() => {{
        const editorEl = document.querySelector('prompt-editor');
        return editorEl && editorEl.monaco && editorEl.monaco.getValue().includes('jinja comment');
    }}""")
    wmp_helpers.wait_for_ui_stabilize(page, 2000)

    # DOMベースでトークン境界とクラスを詳細に解析
    token_info = page.evaluate("""() => {
        const editorEl = document.querySelector('prompt-editor');
        const root = editorEl.shadowRoot || editorEl;
        // view-line のクラスを持つ要素を行ごとに取得
        const viewLines = Array.from(root.querySelectorAll('.view-line'));
        return viewLines.map(line => {
             const spans = Array.from(line.querySelectorAll('span'));
             return spans.map(s => ({
                 text: s.textContent,
                 className: s.className
             }));
        });
    }""")
    
    print("Token info from DOM:")
    for i, line in enumerate(token_info):
        print(f"  Line {i+1}:")
        for t in line:
            print(f"    {t}")

    # 検証1: 1行目は単一のトークン（またはJinja2コメントの開始/終了に分かれている）
    # {# jinja comment #}
    # 結果の表示のみ
    print("-" * 20)
    for i, line in enumerate(token_info):
        print(f"Line {i+1}:")
        text_full = "".join(t['text'] for t in line)
        print(f"  Full text: {repr(text_full)}")
        for j, t in enumerate(line):
            print(f"  Span {j}: {repr(t['text'])} (Class: {t['className']})")
    print("-" * 20)

    # 失敗させて出力を確認する
    # assert False

if __name__ == "__main__":
    pytest.main([__file__, "-s"])
