import json

def multitext_process_logic(text):
    """__init__.py の WebuiMonacoPromptMultiText.process から抽出した現在のロジック"""
    try:
        data = json.loads(text)
        tree = data.get("tree", [])
        
        contents = []
        json_list = []

        def traverse(items, current_path=""):
            for item in items:
                name = item.get("name", "")
                # パスの構築 (スラッシュ区切り)
                path = f"{current_path}/{name}" if current_path else name
                
                if item.get("type") == "file":
                    content = item.get("content", "")
                    contents.append(content)
                    
                    # path情報を付与したコピーを作成してJSON化
                    item_copy = item.copy()
                    item_copy["path"] = path
                    json_list.append(json.dumps(item_copy))
                
                children = item.get("children")
                if children:
                    traverse(children, path)

        traverse(tree)
        # ログ出力 (テスト用)
        # print(f"DEBUG - MultiText process: input_len={len(text)}, output_files={len(contents)}")
        return (contents, json_list)
    except Exception as e:
        # print(f"DEBUG - MultiText process ERROR: {str(e)}")
        # パース失敗時（非 JSON 入力等）は、入力テキストをそのまま一つのファイルコンテンツとして返す
        return ([text], [json.dumps({"name": "default.txt", "type": "file", "content": text, "path": "default.txt"})])

def test_multitext_logic():
    # 1. JSON 入力のテスト (正常系)
    test_data = {
        "tree": [
            {"id": "f1", "name": "test.txt", "type": "file", "content": "FINAL_CHECK_CONTENT"},
            {
                "id": "dir", "name": "Sub", "type": "folder", 
                "children": [{"id": "f2", "name": "sub.txt", "type": "file", "content": "SUB_CONTENT"}]
            }
        ]
    }
    contents, json_list = multitext_process_logic(json.dumps(test_data))
    
    assert len(contents) == 2
    assert contents[0] == "FINAL_CHECK_CONTENT"
    assert contents[1] == "SUB_CONTENT"
    
    parsed_json = [json.loads(j) for j in json_list]
    assert parsed_json[0]["path"] == "test.txt"
    assert parsed_json[1]["path"] == "Sub/sub.txt"
    
    # 2. 非 JSON 入力のテスト (フォールバック)
    fallback_text = "OLD_FORMAT_TEXT"
    contents, json_list = multitext_process_logic(fallback_text)
    
    assert len(contents) == 1
    assert contents[0] == "OLD_FORMAT_TEXT"
    assert "OLD_FORMAT_TEXT" in json_list[0]
    
    print("Backend Logic (extracted) PASSED!")

if __name__ == "__main__":
    test_multitext_logic()
