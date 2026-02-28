import json

def process_logic(text):
    """__init__.py から抽出したロジック"""
    try:
        data = json.loads(text)
        tree = data.get("tree", [])
        contents = []
        json_list = []

        def traverse(items):
            for item in items:
                if item.get("type") == "file":
                    contents.append(item.get("content", ""))
                    json_list.append(json.dumps(item))
                
                children = item.get("children")
                if children:
                    traverse(children)

        traverse(tree)
        return (contents, json_list)
    except Exception as e:
        print(f"Error: {e}")
        return ([], [])

def test_multitext_logic_isolated():
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
    contents, json_list = process_logic(input_text)
    
    print(f"Contents result: {contents}")
    print(f"JSON result: {json_list}")

    # 検証
    assert len(contents) == 2
    assert "Root Content" in contents
    assert "Sub Content" in contents
    
    assert len(json_list) == 2
    parsed_json = [json.loads(j) for j in json_list]
    names = [item["name"] for item in parsed_json]
    assert "root.txt" in names
    assert "sub.txt" in names
    
    print("Isolated logic test passed!")

if __name__ == "__main__":
    test_multitext_logic_isolated()
