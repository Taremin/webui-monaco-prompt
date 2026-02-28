import json
import pytest
import sys
import os

# プロジェクトルートをパスに追加
sys.path.append(os.getcwd())

from __init__ import WebuiMonacoPromptMultiText

def test_multitext_process_logic():
    node = WebuiMonacoPromptMultiText()
    
    test_data = {
        "tree": [
            {
                "id": "file1",
                "name": "root.txt",
                "type": "file",
                "content": "Root Content"
            },
            {
                "id": "folder1",
                "name": "Folder",
                "type": "folder",
                "children": [
                    {
                        "id": "file2",
                        "name": "sub.txt",
                        "type": "file",
                        "content": "Sub Content"
                    }
                ]
            }
        ]
    }
    
    input_text = json.dumps(test_data)
    contents, json_list = node.process(input_text)
    
    # contents の検証
    assert isinstance(contents, list)
    assert len(contents) == 2
    assert "Root Content" in contents
    assert "Sub Content" in contents
    
    # json の検証
    assert isinstance(json_list, list)
    assert len(json_list) == 2
    
    parsed_json = [json.loads(j) for j in json_list]
    names = [item["name"] for item in parsed_json]
    assert "root.txt" in names
    assert "sub.txt" in names
    
    # 階層構造が正しくフラット化されていることを確認
    print("Unit test for process logic passed!")

if __name__ == "__main__":
    test_multitext_process_logic()
