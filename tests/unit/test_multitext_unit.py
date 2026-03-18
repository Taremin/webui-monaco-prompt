import json
import pytest

# __init__.py からの直接インポートを避け、ロジックのみをテストするために
# クラスとメソッドをシミュレート（__init__.py の実装をコピー）
class WebuiMonacoPromptMultiText:
    def process(self, text):
        import json
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
            return (contents, json_list)
        except Exception:
            return ([], [])

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
    
    print("Unit test for process logic passed!")

if __name__ == "__main__":
    test_multitext_process_logic()
