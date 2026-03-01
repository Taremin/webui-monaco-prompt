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
    for path in glob.glob(os.path.join(extension_root_path, "csv", "*.csv"), recursive=True):
        basename = os.path.basename(path)
        comfy_path = os.path.join(extension_root_path, "comfy", basename)

        if not os.path.isfile(comfy_path):
            shutil.copy2(path, comfy_path)

    files = list(map(
        lambda x: os.path.basename(x),
        glob.glob(extension_root_path + "/comfy/*.csv", recursive=True)
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
            # パース失敗時は空リストを返す（あるいは入力テキストをそのまま入れるフォールバックも考えられるが、
            # 基本的に tree 構造が期待されるため空を優先）
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

        # rules はリストとして渡される（INPUT_IS_LIST=True のため）
        # 最初の要素を取得してパース。失敗した場合は例外をそのまま投げる
        rules_str = rules[0] if isinstance(rules, list) and len(rules) > 0 else (rules if isinstance(rules, str) else "[]")
        filter_rules = json.loads(rules_str)
        
        # json_list の全要素をパースしてアイテムリストを作成
        items = []
        for j in json_list:
            if isinstance(j, str):
                items.append(json.loads(j))
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

            # 最初のルール
            first_rule = filter_rules[0]
            target = first_rule.get("target", "name")
            target_val = item_name if target == "name" else (item_path if target == "path" else item_content)
            result = match_rule(target_val, first_rule)

            # 2番目以降のルール（AND/OR結合）
            for i in range(1, len(filter_rules)):
                rule = filter_rules[i]
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


NODE_CLASS_MAPPINGS = {
    "WebuiMonacoPromptFind": WebuiMonacoPromptFind,
    "WebuiMonacoPromptReplace": WebuiMonacoPromptReplace,
    "WebuiMonacoPromptMultiText": WebuiMonacoPromptMultiText,
    "WebuiMonacoPromptJsonFilter": WebuiMonacoPromptJsonFilter,
}
