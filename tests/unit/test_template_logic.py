import sys
import os
import json
import pytest
from unittest.mock import MagicMock
import importlib.util

# ComfyUI 依存モジュールのモック化（__init__.pyのインポート時にエラーにならないようにするため）
for mod in ['server', 'folder_paths', 'nodes']:
    sys.modules[mod] = MagicMock()

# 親パッケージをシミュレートして相対インポート (from . import snippets) を解決する
package_name = "webui_monaco_prompt_pkg"

# snippets.py をモジュールとしてロードして登録
snippets_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../snippets.py'))
spec_snippets = importlib.util.spec_from_file_location(f"{package_name}.snippets", snippets_path)
snippets_mod = importlib.util.module_from_spec(spec_snippets)
sys.modules[f"{package_name}.snippets"] = snippets_mod
spec_snippets.loader.exec_module(snippets_mod)

# __init__.py をパッケージとしてロードして登録
init_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../__init__.py'))
spec_init = importlib.util.spec_from_file_location(package_name, init_path)
init_mod = importlib.util.module_from_spec(spec_init)
init_mod.__package__ = package_name  # 相対インポート解決のためのパッケージ名設定
sys.modules[package_name] = init_mod
spec_init.loader.exec_module(init_mod)

# 正常にロードされたモジュールから関数/クラスを抽出
# (初期状態では AttributeError になるため、TDD Red が達成されます)
try:
    WebuiMonacoPromptTemplate = init_mod.WebuiMonacoPromptTemplate
    expand_templates = init_mod.expand_templates
except AttributeError as e:
    # TDD Red フェーズのために、属性がない場合はテスト実行で落ちるようにダミーを置くか、AttributeErrorをそのまま投げる
    raise e

def test_expand_templates_static():
    file_map = {
        "main.txt": "A girl, <include:outfit/dress.txt>, in the garden.",
        "outfit/dress.txt": "wearing a <include:color.txt> dress",
        "color.txt": "vibrant blue"
    }
    
    # 正常な静的インクルードの展開
    result = expand_templates("Hello, <include:main.txt>", file_map, seed=123)
    assert result == "Hello, A girl, wearing a vibrant blue dress, in the garden."

def test_expand_templates_random():
    file_map = {
        "main.txt": "a <random:color.txt> cat",
        "color.txt": "black\nwhite\norange\ngray\n\n# 空行や前後の空白テスト用\n  brown  "
    }
    
    # シード 42 での実行
    res1 = expand_templates("<include:main.txt>", file_map, seed=42)
    # シード 42 で再実行して結果が一致することを確認 (再現性)
    res2 = expand_templates("<include:main.txt>", file_map, seed=42)
    assert res1 == res2
    
    # 有効な選択肢（black, white, orange, gray, brown）のいずれかであることを確認
    valid_colors = ["black", "white", "orange", "gray", "brown"]
    color_chosen = res1.replace("a ", "").replace(" cat", "")
    assert color_chosen in valid_colors

    # 異なるシードで別の値が選択される可能性があることを確認
    # (確率的ですが、十分な回数試行すれば異なる値が出ます)
    different_results = set()
    for s in range(50):
        res = expand_templates("<include:main.txt>", file_map, seed=s)
        different_results.add(res)
    assert len(different_results) > 1

def test_expand_templates_tag_in_tag():
    file_map = {
        "hoge.txt": "final_output",
        "selector.txt": "hoge.txt"
    }
    
    # 内側のタグが展開されて hoge.txt になり、最終的に final_output になるテスト
    result = expand_templates("<include:<include:selector.txt>>", file_map, seed=0)
    assert result == "final_output"

def test_expand_templates_tag_in_tag_random():
    file_map = {
        "choices.txt": "a.txt\nb.txt",
        "a.txt": "Apple",
        "b.txt": "Banana"
    }
    
    # 動的にインクルード先ファイル名をランダム選択するテスト
    results = set()
    for s in range(20):
        res = expand_templates("<include:<random:choices.txt>>", file_map, seed=s)
        results.add(res)
    assert results == {"Apple", "Banana"}

def test_expand_templates_mixed_nesting():
    file_map = {
        "main.txt": "a <random:style_choice.txt> portrait",
        "style_choice.txt": "monochrome painting\ncolorful illustration, <include:details.txt>",
        "details.txt": "with high contrast"
    }
    
    # ランダムに選択された結果にさらに include が含まれているケースのテスト
    found_nested = False
    for s in range(20):
        result = expand_templates("<include:main.txt>", file_map, seed=s)
        if "with high contrast" in result:
            assert result == "a colorful illustration, with high contrast portrait"
            found_nested = True
            break
    assert found_nested, "Could not trigger nested include from random choice with seed 0-19"

def test_expand_templates_nesting_limit():
    # 10層を超える深いネストのテスト (max_depth=10)
    file_map = {f"level_{i}.txt": f"<include:level_{i+1}.txt>" for i in range(12)}
    file_map["level_12.txt"] = "deepest value"
    
    # level_0.txt から展開すると 12層のネストになるため、上限10を超えて例外を投げるべき
    with pytest.raises(ValueError) as excinfo:
        expand_templates("<include:level_0.txt>", file_map, seed=0)
        
    assert "[PromptTemplateError]" in str(excinfo.value)
    assert "depth limit exceeded" in str(excinfo.value)

def test_expand_templates_circular():
    file_map = {
        "a.txt": "referencing <include:b.txt>",
        "b.txt": "referencing <include:a.txt>"
    }
    
    # a.txt -> b.txt -> a.txt の循環参照
    with pytest.raises(ValueError) as excinfo:
        expand_templates("<include:a.txt>", file_map, seed=0)
    
    # エラーメッセージに循環参照検知の情報と、エラーが発生したファイル名が含まれていることを確認
    assert "[PromptTemplateError]" in str(excinfo.value)
    assert "Circular reference detected" in str(excinfo.value)
    assert "a.txt" in str(excinfo.value) or "b.txt" in str(excinfo.value)

def test_expand_templates_missing():
    file_map = {
        "main.txt": "referencing <include:nonexistent.txt>"
    }
    
    # 存在しないファイルの参照
    with pytest.raises(ValueError) as excinfo:
        expand_templates("<include:main.txt>", file_map, seed=0)
        
    assert "[PromptTemplateError]" in str(excinfo.value)
    assert "not found" in str(excinfo.value)
    assert "nonexistent.txt" in str(excinfo.value)
    assert "main.txt" in str(excinfo.value)

def test_node_process():
    # WebuiMonacoPromptTemplate ノードの process メソッドの検証
    node = WebuiMonacoPromptTemplate()
    
    # source_templates (全ファイル)
    source_templates = [
        json.dumps({"name": "style.txt", "type": "file", "content": "masterpiece, ultra-detailed"}),
        json.dumps({"name": "char.txt", "type": "file", "content": "1girl, <include:style.txt>"}),
        json.dumps({"name": "background.txt", "type": "file", "content": "in the room"})
    ]
    
    # entry_points (フィルタリング後の実際に出力したいファイル)
    # ここでは char.txt のみを出力対象とし、style.txt は source_templates にのみ存在する状態にする
    entry_points = [
        json.dumps({"name": "char.txt", "type": "file", "path": "char.txt", "content": "1girl, <include:style.txt>"})
    ]
    
    contents, jsons = node.process(source_templates, entry_points, seed=[0])
    
    assert len(contents) == 1
    assert contents[0] == "1girl, masterpiece, ultra-detailed"
    
    assert len(jsons) == 1
    item = json.loads(jsons[0])
    assert item["name"] == "char.txt"
    assert item["content"] == "1girl, masterpiece, ultra-detailed"
