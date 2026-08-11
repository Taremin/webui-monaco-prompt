import os
import sys
import tempfile
import pytest

# リポジトリルートを sys.path に追加
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
import snippets



@pytest.fixture
def dummy_custom_node(tmp_path):
    """
    テスト用の仮想カスタムノード構造を構築するフィクスチャ
    node_a/
        snippets/
            test_snippet.json
        wildcards/
            animal.txt
            color.txt
            pose.txt
        subfolder/
            prefix_01.png
            prefix_02.png
    """
    node_dir = tmp_path / "custom_nodes" / "ComfyUI-Node-A"
    snippets_dir = node_dir / "snippets"
    wildcards_dir = node_dir / "wildcards"
    subfolder_dir = node_dir / "subfolder"

    snippets_dir.mkdir(parents=True)
    wildcards_dir.mkdir(parents=True)
    subfolder_dir.mkdir(parents=True)

    # テストファイル作成
    (wildcards_dir / "animal.txt").write_text("cat", encoding="utf-8")
    (wildcards_dir / "color.txt").write_text("red", encoding="utf-8")
    (wildcards_dir / "pose.txt").write_text("standing", encoding="utf-8")

    (subfolder_dir / "prefix_01.png").write_text("fake png 1", encoding="utf-8")
    (subfolder_dir / "prefix_02.png").write_text("fake png 2", encoding="utf-8")

    return node_dir, tmp_path / "custom_nodes"


def test_get_node_root_from_snippet_path(dummy_custom_node):
    node_dir, custom_nodes_dir = dummy_custom_node
    snippet_path = os.path.join(node_dir, "snippets", "test.json")

    root = snippets.get_node_root_from_snippet_path(snippet_path, str(custom_nodes_dir))
    assert os.path.abspath(root) == os.path.abspath(node_dir)


def test_expand_dir_snippets_choice_default(dummy_custom_node):
    node_dir, _ = dummy_custom_node
    insert_text = "Select wildcard: ${dir:wildcards/*.txt}"
    
    result = snippets.expand_dir_snippets(insert_text, str(node_dir))
    assert result == "Select wildcard: ${1|animal.txt,color.txt,pose.txt|}"


def test_expand_dir_snippets_choice_var_number(dummy_custom_node):
    node_dir, _ = dummy_custom_node
    insert_text = "Select wildcard: ${dir:wildcards/*.txt|var=2}"
    
    result = snippets.expand_dir_snippets(insert_text, str(node_dir))
    assert result == "Select wildcard: ${2|animal.txt,color.txt,pose.txt|}"



def test_expand_dir_snippets_pattern_remove_extension(dummy_custom_node):
    node_dir, _ = dummy_custom_node
    insert_text = "<include:${dir:wildcards/*.txt|pattern=\\.[^.]+$|format=choice}>"

    result = snippets.expand_dir_snippets(insert_text, str(node_dir))
    assert result == "<include:${1|animal,color,pose|}>"


def test_expand_dir_snippets_pattern_replace(dummy_custom_node):
    node_dir, _ = dummy_custom_node
    insert_text = "${dir:subfolder/*.png|pattern=prefix_|replace=custom_|format=choice}"

    result = snippets.expand_dir_snippets(insert_text, str(node_dir))
    assert result == "${1|custom_01.png,custom_02.png|}"


def test_expand_dir_snippets_lines_format(dummy_custom_node):
    node_dir, _ = dummy_custom_node
    insert_text = "Files:\n${dir:wildcards/*.txt|pattern=\\.[^.]+$|format=lines}"

    result = snippets.expand_dir_snippets(insert_text, str(node_dir))
    assert result == "Files:\nanimal\ncolor\npose"


def test_expand_dir_snippets_comma_format(dummy_custom_node):
    node_dir, _ = dummy_custom_node
    insert_text = "Files: ${dir:wildcards/*.txt|pattern=\\.[^.]+$|format=comma}"

    result = snippets.expand_dir_snippets(insert_text, str(node_dir))
    assert result == "Files: animal, color, pose"


def test_expand_dir_snippets_path_traversal_prevention(dummy_custom_node):
    node_dir, _ = dummy_custom_node
    # ベースディレクトリ外（../）への不当アクセス
    insert_text = "${dir:../../secret.txt}"

    result = snippets.expand_dir_snippets(insert_text, str(node_dir))
    assert result == ""


def test_load_snippets_integration(dummy_custom_node):
    node_dir, custom_nodes_dir = dummy_custom_node
    snippet_file = node_dir / "snippets" / "my_snippets.json"
    
    snippet_json_content = [
        {
            "label": "My Wildcard Snippet",
            "insertText": "<include:${dir:wildcards/*.txt|pattern=\\.[^.]+$|format=choice}>",
            "detail": "Test wildcard choices"
        }
    ]
    import json
    snippet_file.write_text(json.dumps(snippet_json_content), encoding="utf-8")

    snippets.load_snippets(str(custom_nodes_dir))
    loaded = snippets.get_snippets()

    assert loaded is not None
    assert len(loaded) == 1
    assert loaded[0]["label"] == "My Wildcard Snippet"
    assert loaded[0]["insertText"] == "<include:${1|animal,color,pose|}>"
    assert loaded[0]["detail"] == "Test wildcard choices"
