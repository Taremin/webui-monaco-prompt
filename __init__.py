#
# This file is the entry point for ComfyUI
#
import os
import server
import folder_paths
from aiohttp import web
import glob
import json
import shutil
from . import snippets

WEB_DIRECTORY = "./comfy"

extension_root_path = os.path.dirname(__file__)
custom_nodes_path = folder_paths.get_folder_paths("custom_nodes")[0]


@server.PromptServer.instance.routes.get("/webui-monaco-prompt/csv")
async def get_csv_fils(request):
    comfy_dir = os.path.join(extension_root_path, "comfy")
    os.makedirs(comfy_dir, exist_ok=True)
    
    for path in glob.glob(os.path.join(extension_root_path, "csv", "*.csv"), recursive=True):
        basename = os.path.basename(path)
        comfy_path = os.path.join(comfy_dir, basename)

        needs_copy = False
        if not os.path.isfile(comfy_path):
            needs_copy = True
        elif os.path.getmtime(path) > os.path.getmtime(comfy_path):
            needs_copy = True
            
        if needs_copy:
            shutil.copy2(path, comfy_path)

    files = list(map(
        lambda x: os.path.basename(x),
        glob.glob(os.path.join(comfy_dir, "*.csv"), recursive=True)
    ))

    return web.Response(text=json.dumps(files), content_type='application/json')


@server.PromptServer.instance.routes.get("/webui-monaco-prompt/snippet")
async def get_snippets(request):
    if (snippets.get_snippets() is None):
        snippets.load_snippets(custom_nodes_path)
    return web.Response(text=json.dumps(snippets.get_snippets()), content_type='application/json')


@server.PromptServer.instance.routes.get("/webui-monaco-prompt/snippet-refresh")
async def reload_snippets(request):
    snippets.load_snippets(custom_nodes_path)

    return web.Response(text=json.dumps(snippets.get_snippets()), content_type='application/json')


class WebuiMonacoPromptFind:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {}

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "process"
    CATEGORY = "WebuiMonacoPrompt"

    def process(self, *args, **kwargs):
        return ()


class WebuiMonacoPromptReplace(WebuiMonacoPromptFind):
    pass


class WebuiMonacoPromptMultiText:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": '{}'}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("contents", "json")
    OUTPUT_IS_LIST = (True, True)
    FUNCTION = "process"
    CATEGORY = "WebuiMonacoPrompt"

    def process(self, text):
        import json
        try:
            # text がリストで渡される場合の対応 (INPUT_IS_LIST=True ではないが、念のため)
            input_str = text[0] if isinstance(text, list) and len(text) > 0 else text
            
            try:
                data = json.loads(input_str)
            except Exception:
                # パース失敗時はそのまま返す
                return ([input_str], [json.dumps({"name": "default.txt", "type": "file", "content": input_str, "path": "default.txt"})])
            
            tree = data.get("tree", [])
            contents = []
            json_list = []
            selection_mode = data.get("selectionMode", False)

            def traverse(items, current_path=""):
                for item in items:
                    if selection_mode and not item.get("output", True):
                        continue

                    name = item.get("name", "")
                    path = f"{current_path}/{name}" if current_path else name
                    
                    if item.get("type") == "file":
                        content = item.get("content", "")
                        contents.append(content)
                        
                        item_copy = item.copy()
                        item_copy["path"] = path
                        json_list.append(json.dumps(item_copy))
                    
                    children = item.get("children")
                    if children:
                        traverse(children, path)

            traverse(tree)
            return (contents, json_list)
        except Exception:
            # 最後の手段として空のリストを返してクラッシュを避ける
            return ([], [])


class WebuiMonacoPromptJsonFilter:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "json_list": ("STRING", {"forceInput": True}),
                "rules": ("STRING", {"multiline": True, "default": '[]'}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("contents", "json")
    OUTPUT_IS_LIST = (True, True)
    INPUT_IS_LIST = True
    FUNCTION = "process"
    CATEGORY = "WebuiMonacoPrompt"

    def process(self, json_list, rules):
        import json
        import re

        print("RULES:", rules)

        # rules はリストとして渡される（INPUT_IS_LIST=True のため）
        # 最初の要素を取得してパース。失敗した場合は例外をそのまま投げる
        rules_str = rules[0] if isinstance(rules, list) and len(rules) > 0 else (rules if isinstance(rules, str) else "[]")
        try:
            filter_rules = json.loads(rules_str)
        except json.JSONDecodeError as e:
            print(f"WebuiMonacoPrompt [JsonFilter]: Error decoding rules JSON: {e}")
            print(f"Invalid JSON string: {rules_str}")
            raise e
        
        # json_list の全要素をパースしてアイテムリストを作成
        items = []
        for j in json_list:
            if isinstance(j, str):
                try:
                    items.append(json.loads(j))
                except json.JSONDecodeError as e:
                    print(f"WebuiMonacoPrompt [JsonFilter]: Error decoding item JSON: {e}")
                    print(f"Invalid JSON string: {j}")
                    raise e
            elif isinstance(j, dict):
                items.append(j)
            else:
                # 明らかに型が違う場合はエラーにする
                raise ValueError(f"Invalid input type in json_list: {type(j)}")
        
        if not filter_rules:
            # ルールがない場合はそのまま返す
            contents = [item.get("content", "") for item in items]
            jsons = [json.dumps(item) for item in items]
            return (contents, jsons)

        # フィルタリング対象の有効なルールのみを抽出
        active_rules = [r for r in filter_rules if not r.get("disabled", False)]
        
        if not active_rules:
            # 有効なルールがない場合は全アイテムを返す
            contents = [item.get("content", "") for item in items]
            jsons = [json.dumps(item) for item in items]
            return (contents, jsons)

        filtered_items = []
        
        for item in items:
            item_name = item.get("name", "")
            item_path = item.get("path", item_name)
            item_content = item.get("content", "")

            def match_rule(target_val, rule):
                mode = rule.get("mode", "include")
                val = rule.get("value", "")
                is_not = rule.get("not", False)
                
                target_str = str(target_val)
                match = False
                if mode == "regex":
                    try:
                        match = bool(re.search(val, target_str))
                    except re.error:
                        match = False
                else: # include
                    match = val in target_str
                
                return not match if is_not else match

            # 最初の有効なルール
            first_rule = active_rules[0]
            target = first_rule.get("target", "name")
            target_val = item_name if target == "name" else (item_path if target == "path" else item_content)
            result = match_rule(target_val, first_rule)

            # 2番目以降の有効なルール（AND/OR結合）
            for i in range(1, len(active_rules)):
                rule = active_rules[i]
                op = rule.get("operator", "AND")
                target = rule.get("target", "name")
                target_val = item_name if target == "name" else (item_path if target == "path" else item_content)
                match = match_rule(target_val, rule)
                
                if op == "AND":
                    result = result and match
                else:
                    result = result or match
            
            if result:
                filtered_items.append(item)

        contents = [item.get("content", "") for item in filtered_items]
        jsons = [json.dumps(item) for item in filtered_items]
        return (contents, jsons)


def expand_templates(content, file_map, seed, resolving=None, resolving_stack=None, max_depth=10):
    import re
    import os
    import random

    # 入力が文字列でない場合への防御処理
    if not isinstance(content, str):
        content = str(content) if content is not None else ""

    if resolving is None:
        resolving = set()
    if resolving_stack is None:
        resolving_stack = []
        
    if max_depth <= 0:
        raise ValueError(f"[PromptTemplateError] In file '{resolving_stack[-1] if resolving_stack else 'entry'}': Template recursion depth limit exceeded")
        
    # <include:path> および <random:path> の検出
    pattern = re.compile(r'<(include|random):([a-zA-Z0-9_\-\/.]+)>')
    rng = random.Random(seed)

    def replace_match(match):
        mode = match.group(1) # 'include' or 'random'
        key = match.group(2)
        target_content = None
        target_path = None
        
        for path, val in file_map.items():
            path_no_ext = os.path.splitext(path)[0]
            basename = os.path.basename(path)
            basename_no_ext = os.path.splitext(basename)[0]
            
            if key in (path, path_no_ext, basename, basename_no_ext):
                target_content = val
                target_path = path
                break
                
        if target_path is None:
            raise ValueError(f"[PromptTemplateError] In file '{resolving_stack[-1] if resolving_stack else 'entry'}': {mode.capitalize()} target not found: '{key}'")
            
        if target_path in resolving:
            raise ValueError(f"[PromptTemplateError] In file '{resolving_stack[-1] if resolving_stack else 'entry'}': Circular reference detected for '{target_path}'")
            
        resolving.add(target_path)
        resolving_stack.append(target_path)
        
        if mode == "random":
            lines = [line.strip() for line in target_content.splitlines() if line.strip()]
            if not lines:
                resolved_raw = ""
            else:
                resolved_raw = rng.choice(lines)
        else:
            resolved_raw = target_content

        expanded = expand_templates(resolved_raw, file_map, seed, resolving, resolving_stack, max_depth - 1)
        
        resolving_stack.pop()
        resolving.remove(target_path)
        
        return expanded

    substituted = pattern.sub(replace_match, content)
    # 置換結果にまだ未展開のタグが残っている場合、再帰的に再度展開する
    if pattern.search(substituted):
        return expand_templates(substituted, file_map, seed, resolving, resolving_stack, max_depth - 1)
    return substituted


class WebuiMonacoPromptTemplate:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "source_templates": ("STRING", {"forceInput": True}),
                "entry_points": ("STRING", {"forceInput": True}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("contents", "json")
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True, True)
    FUNCTION = "process"
    CATEGORY = "WebuiMonacoPrompt"

    def process(self, source_templates=None, entry_points=None, seed=None):
        import json
        
        # 接続されていない（Noneが渡された）場合への安全なフォールバック
        source_templates = source_templates or []
        entry_points = entry_points or []
        seed = seed or [0]
        
        # 1. source_templates から file_map を構築
        file_map = {}
        for s_json in source_templates:
            if not s_json:
                continue
            try:
                item = json.loads(s_json)
                if isinstance(item, dict) and item.get("type") == "file":
                    path = item.get("path", item.get("name", ""))
                    if path:
                        file_map[path] = item.get("content", "")
            except Exception:
                pass

        # 2. entry_points から処理対象ファイルを抽出
        entries = []
        for e_json in entry_points:
            if not e_json:
                continue
            try:
                item = json.loads(e_json)
                if isinstance(item, dict) and item.get("type") == "file":
                    entries.append(item)
            except Exception:
                pass

        # 3. 乱数のシード（リストで渡されるため、最初の要素を取得）
        seed_val = seed[0] if isinstance(seed, list) and len(seed) > 0 else (seed if isinstance(seed, int) else 0)

        # 4. 各エントリポイントを展開
        contents = []
        json_list = []
        
        for entry in entries:
            raw_content = entry.get("content", "")
            path = entry.get("path", entry.get("name", ""))
            
            # 各ファイルのルートとして現在ファイルをスタックに積んで開始
            resolving = {path} if path else set()
            resolving_stack = [path] if path else []
            
            expanded_content = expand_templates(raw_content, file_map, seed_val, resolving, resolving_stack)
            contents.append(expanded_content)
            
            entry_copy = entry.copy()
            entry_copy["content"] = expanded_content
            json_list.append(json.dumps(entry_copy))

        return (contents, json_list)


NODE_CLASS_MAPPINGS = {
    "WebuiMonacoPromptFind": WebuiMonacoPromptFind,
    "WebuiMonacoPromptReplace": WebuiMonacoPromptReplace,
    "WebuiMonacoPromptMultiText": WebuiMonacoPromptMultiText,
    "WebuiMonacoPromptJsonFilter": WebuiMonacoPromptJsonFilter,
    "WebuiMonacoPromptTemplate": WebuiMonacoPromptTemplate,
}
