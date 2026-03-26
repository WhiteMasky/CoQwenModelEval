"""
CoQwen Model Evaluator — Backend Server
Proxies API calls to Qwen/Gemini to avoid browser CORS issues.
Serves the frontend static files.

Usage:
    pip install -r requirements.txt
    python server.py
    # Open http://localhost:8765
"""

import asyncio
import base64
import json
import os
import sys
from pathlib import Path

try:
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse, JSONResponse
    from fastapi.middleware.cors import CORSMiddleware
    import httpx
    import uvicorn
except ImportError:
    print("Missing dependencies. Install with:")
    print("  pip install fastapi uvicorn httpx")
    sys.exit(1)

app = FastAPI(title="CoQwen Model Evaluator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Timeout for model API calls (some models are slow on large images)
API_TIMEOUT = 300.0
MAX_RETRIES = 30  # keep retrying until success, up to 30 attempts


@app.post("/api/evaluate")
async def evaluate_image(request: Request):
    """
    Proxy endpoint: receives image + config from frontend,
    forwards to Qwen or Gemini API, returns the response.
    Retries up to MAX_RETRIES times on timeout or 5xx errors.
    """
    body = await request.json()
    provider = body.get("provider", "qwen")
    model = body.get("model", "")
    endpoint = body.get("endpoint", "")
    api_key = body.get("apiKey", "")
    image_base64 = body.get("imageBase64", "")
    mime_type = body.get("mimeType", "image/jpeg")
    prompt = body.get("prompt", "")

    if not api_key:
        raise HTTPException(status_code=400, detail="API key is required")
    if not image_base64:
        raise HTTPException(status_code=400, detail="Image data is required")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
                if provider == "gemini":
                    result = await call_gemini(client, endpoint, model, api_key, prompt, image_base64, mime_type)
                else:
                    result = await call_qwen(client, endpoint, model, api_key, prompt, image_base64, mime_type)
            return JSONResponse(content={"text": result})
        except httpx.TimeoutException:
            if attempt < MAX_RETRIES:
                wait = min(5 + attempt * 2, 30)  # 7s, 9s, 11s ... capped at 30s
                print(f"[Attempt {attempt}/{MAX_RETRIES}] Timeout, retrying in {wait}s...")
                await asyncio.sleep(wait)
                continue
            raise HTTPException(status_code=504, detail=f"Model API timed out after {MAX_RETRIES} attempts ({API_TIMEOUT}s each)")
        except httpx.HTTPStatusError as e:
            if e.response.status_code >= 500 and attempt < MAX_RETRIES:
                wait = min(5 + attempt * 2, 30)
                print(f"[Attempt {attempt}/{MAX_RETRIES}] Server error {e.response.status_code}, retrying in {wait}s...")
                await asyncio.sleep(wait)
                continue
            raise HTTPException(status_code=e.response.status_code, detail=f"Model API error: {e.response.text[:500]}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


async def call_qwen(client, endpoint, model, api_key, prompt, image_base64, mime_type):
    url = f"{endpoint.rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_base64}"}}
                ]
            }
        ],
        "max_tokens": 2048,
        "enable_thinking": False
    }
    resp = await client.post(
        url,
        json=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


async def call_gemini(client, endpoint, model, api_key, prompt, image_base64, mime_type):
    url = f"{endpoint.rstrip('/')}/models/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": mime_type, "data": image_base64}}
            ]
        }],
        "generationConfig": {"maxOutputTokens": 2048}
    }
    resp = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
    resp.raise_for_status()
    data = resp.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]


# Serve frontend
static_dir = Path(__file__).parent
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.head("/")
@app.get("/")
async def serve_index():
    return FileResponse(static_dir / "index.html")


@app.head("/{path:path}")
@app.get("/{path:path}")
async def serve_file(path: str):
    file_path = static_dir / path
    if file_path.is_file():
        return FileResponse(file_path)
    return FileResponse(static_dir / "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    print(f"\n  CoQwen Model Evaluator")
    print(f"  Open http://localhost:{port}\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
