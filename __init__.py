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

WEB_DIRECTORY = "./comfy"

extension_root_path = os.path.dirname(__file__)


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

snippets = None


@server.PromptServer.instance.routes.get("/webui-monaco-prompt/snippet")
async def get_snippets(request):
    if (snippets is None):
        load_snippets()
    return web.Response(text=json.dumps(snippets), content_type='application/json')


@server.PromptServer.instance.routes.get("/webui-monaco-prompt/snippet-refresh")
async def reload_snippets(request):
    load_snippets()

    return web.Response(text=json.dumps(snippets), content_type='application/json')


def load_snippets():
    global snippets
    snippets = []
    custom_nodes_path = folder_paths.get_folder_paths("custom_nodes")[0]
    for path in glob.glob(os.path.join(custom_nodes_path, "*", "snippets", "*.json")):
        try:
            with open(path, "r") as fp:
                loaded_snippets = json.load(fp)

                for loaded_snippet in (loaded_snippets if isinstance(loaded_snippets, list) else [loaded_snippets]):
                    label_text = loaded_snippet.get("label")
                    insert_text = loaded_snippet.get("insertText")
                    if (
                        label_text is not None and isinstance(label_text, str) and
                        insert_text is not None and isinstance(insert_text, str)
                    ):
                        snippet = {}
                        snippet["label"] = label_text
                        snippet["insertText"] = insert_text
                        snippet["path"] = os.path.relpath(path, custom_nodes_path)

                        detail_text = loaded_snippet.get("detail")
                        if detail_text is not None:
                            snippet["detail"] = detail_text

                        snippets.append(snippet)
        except Exception:
            print("[SKIP] Webui Monaco Prompt: invalid json:", path)


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


NODE_CLASS_MAPPINGS = {
    "WebuiMonacoPromptFind": WebuiMonacoPromptFind,
    "WebuiMonacoPromptReplace": WebuiMonacoPromptReplace,
}
