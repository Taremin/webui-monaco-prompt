from modules import script_callbacks
from typing import Optional
import json

from gradio import Blocks
import fastapi
from fastapi import FastAPI, HTTPException, status
from modules.api.api import Api

import os
extension_base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
with open(os.path.join(extension_base_dir, "extension.json"), mode="r") as f:
    try:
        extension_settings = json.load(f)
    except Exception:
        print(__file__, "can't load extension settings")
        extension_settings = {}

def hook(callback):
    return lambda *args: callback(None, *args)
   
def on_app_started(demo: Optional[Blocks], app: FastAPI):
    def get_settings_path(auth, user):
        return os.path.join(
            extension_base_dir,
            f"settings/{'user_' + user if auth is not None else 'global'}.json"
        )
    
    def get_current_user(request: fastapi.Request) -> Optional[str]:
        token = request.cookies.get("access-token") or request.cookies.get(
            "access-token-unsecure"
        )
        return app.tokens.get(token)
    
    def get(request: fastapi.Request):
        user = get_current_user(request)
        if app.auth is None or user is not None:
            settings_path = get_settings_path(app.auth, user)
            if not os.path.isfile(settings_path):
                return {}
            
            with open(settings_path, mode="r") as f:
                try:
                    return json.load(f)
                except Exception:
                    print(__file__, "can't load JSON")
                return {}
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    async def post(request: fastapi.Request):
        user = get_current_user(request)
        if app.auth is None or user is not None:
            with open(get_settings_path(app.auth, user), mode="w") as f:
                try:
                    settings = await request.json() # json check
                    json.dump(settings, f)
                    return {"success": True}
                except Exception as e:
                    return {"success": False, "error": e}
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    def get_embeddings(request: fastapi.Request):
        return Api.get_embeddings(None)
    app.add_api_route(extension_settings.get("EndPoint"), get, methods=["GET"])
    app.add_api_route(extension_settings.get("EndPoint"), post, methods=["POST"])
    app.add_api_route(extension_settings.get("GetEmbeddings"), get_embeddings, methods=["GET"])

script_callbacks.on_app_started(on_app_started)