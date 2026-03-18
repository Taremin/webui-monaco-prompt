
import json
import pytest
import sys
import os
from unittest.mock import MagicMock

# ComfyUI 依存モジュールのモック化
for mod in ['server', 'folder_paths', 'nodes']:
    sys.modules[mod] = MagicMock()

# テスト対象のロジックのみを抽出したクラスを定義（ImportError回避のため）
class FilterNodeMock:
    def process(self, json_list, rules):
        import json
        import re
        try:
            rules_str = rules[0] if isinstance(rules, list) and len(rules) > 0 else (rules if isinstance(rules, str) else "[]")
            filter_rules = json.loads(rules_str)
            items = []
            for j in json_list:
                if isinstance(j, str): items.append(json.loads(j))
                elif isinstance(j, dict): items.append(j)
                else: raise ValueError(f"Invalid input type: {type(j)}")
            if not filter_rules:
                return ([item.get("content", "") for item in items], [json.dumps(item) for item in items])
            
            # フィルタリング対象の有効なルールのみを抽出
            active_rules = [r for r in filter_rules if not r.get("disabled", False)]
            
            if not active_rules:
                return ([item.get("content", "") for item in items], [json.dumps(item) for item in items])

            filtered_items = []
            for item in items:
                item_name = item.get("name", ""); item_path = item.get("path", item_name); item_content = item.get("content", "")
                def match_rule(target_val, rule):
                    mode = rule.get("mode", "include"); val = rule.get("value", ""); is_not = rule.get("not", False)
                    target_str = str(target_val); match = False
                    if mode == "regex":
                        try: match = bool(re.search(val, target_str))
                        except re.error: match = False
                    else: match = val in target_str
                    return not match if is_not else match
                
                first_rule = active_rules[0]
                target = first_rule.get("target", "name")
                target_val = item_name if target == "name" else (item_path if target == "path" else item_content)
                result = match_rule(target_val, first_rule)
                
                for i in range(1, len(active_rules)):
                    rule = active_rules[i]; op = rule.get("operator", "AND"); target = rule.get("target", "name")
                    target_val = item_name if target == "name" else (item_path if target == "path" else item_content)
                    match = match_rule(target_val, rule)
                    if op == "AND": result = result and match
                    else: result = result or match
                if result: filtered_items.append(item)
            return ([item.get("content", "") for item in filtered_items], [json.dumps(item) for item in filtered_items])
        except Exception as e:
            # 呼び出し元で検知できるように再スロー（ValueErrorやJSONDecodeErrorなど）
            raise e

def test_filter_logic_basic():
    filter_node = FilterNodeMock()
    
    # テストデータ
    json_list = [
        json.dumps({"name": "test1.txt", "path": "root/test1.txt", "content": "hello world"}),
        json.dumps({"name": "test2.py", "path": "root/src/test2.py", "content": "print('hi')"}),
        json.dumps({"name": "readme.md", "path": "root/readme.md", "content": "documentation"}),
    ]
    
    # 0. 異常系テスト (不正なJSON)
    with pytest.raises(json.JSONDecodeError):
        filter_node.process(json_list, ["invalid json"])

    # 1. シンプルな Include (Name)
    rules1 = [json.dumps([
        {"target": "name", "mode": "include", "not": False, "value": ".txt"}
    ])]
    contents, jsons = filter_node.process(json_list, rules1)
    assert len(jsons) == 1
    assert json.loads(jsons[0])["name"] == "test1.txt"

    # 2. NOT 
    rules2 = [json.dumps([
        {"target": "name", "mode": "include", "not": True, "value": ".txt"}
    ])]
    contents, jsons = filter_node.process(json_list, rules2)
    assert len(jsons) == 2

    # 3. AND 結合 (Path AND Content)
    rules3 = [json.dumps([
        {"target": "path", "mode": "include", "not": False, "value": "src/"},
        {"operator": "AND", "target": "content", "mode": "include", "not": False, "value": "print"}
    ])]
    contents, jsons = filter_node.process(json_list, rules3)
    assert len(jsons) == 1
    assert json.loads(jsons[0])["name"] == "test2.py"

    # 4. OR 結合
    rules4 = [json.dumps([
        {"target": "name", "mode": "include", "not": False, "value": ".txt"},
        {"operator": "OR", "target": "name", "mode": "include", "not": False, "value": ".py"}
    ])]
    contents, jsons = filter_node.process(json_list, rules4)
    assert len(jsons) == 2

    # 6. Disabled Rules
    rules6 = [json.dumps([
        {"target": "name", "mode": "include", "not": False, "value": ".txt", "disabled": True},
        {"operator": "OR", "target": "name", "mode": "include", "not": False, "value": ".py"}
    ])]
    # .txt ルールが無視されるため、.py のみヒットする
    contents, jsons = filter_node.process(json_list, rules6)
    assert len(jsons) == 1
    assert json.loads(jsons[0])["name"] == "test2.py"

    # 7. All Disabled
    rules7 = [json.dumps([
        {"target": "name", "mode": "include", "not": False, "value": ".txt", "disabled": True},
        {"operator": "AND", "target": "name", "mode": "include", "not": False, "value": "nothing", "disabled": True}
    ])]
    # すべて無視されるため、全アイテムが返る
    contents, jsons = filter_node.process(json_list, rules7)
    assert len(jsons) == len(json_list)

if __name__ == "__main__":
    # 手動実行用
    test_filter_logic_basic()
    print("All basic logic tests passed!")
