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


NODE_CLASS_MAPPINGS = {
    "WebuiMonacoPromptFind": WebuiMonacoPromptFind,
    "WebuiMonacoPromptReplace": WebuiMonacoPromptReplace,
}
