from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import requests

# ==========================================================
# FASTAPI
# ==========================================================

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/static",
    StaticFiles(directory="app/static"),
    name="static"
)

templates = Jinja2Templates(
    directory="app/templates"
)

# ==========================================================
# REQUEST MODEL
# ==========================================================

class PromptRequest(BaseModel):
    prompt: str

# ==========================================================
# LLAMA SERVER
# ==========================================================

LLAMA_SERVER_URL = "http://127.0.0.1:8080/v1/chat/completions"

# ==========================================================
# SYSTEM PROMPT
# ==========================================================

SYSTEM_PROMPT = """
You are QForge, an expert software engineering and code reasoning assistant.

Rules:

- Format responses using markdown.
- Use headings when useful.
- Use bullet points for analysis.
- Use code blocks for code.
- Explain reasoning clearly.
- Focus on software engineering, architecture, debugging, optimization, security, testing and code review.

If asked to analyze code:
- identify bugs
- explain root causes
- explain performance bottlenecks
- suggest improvements

If code is requested:
- generate production-quality code
- include comments where valuable
- follow best practices
"""

# ==========================================================
# HOME
# ==========================================================

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):

    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={}
    )

# ==========================================================
# GENERATE
# ==========================================================

@app.post("/generate")
async def generate(data: PromptRequest):

    payload = {
        "messages": [
            {
                "role": "system",
                "content": SYSTEM_PROMPT
            },
            {
                "role": "user",
                "content": data.prompt
            }
        ],
        "temperature": 0.7,
        "top_p": 0.95,
        "max_tokens": 4096
    }

    try:

        response = requests.post(
            LLAMA_SERVER_URL,
            json=payload,
            timeout=600
        )

        response.raise_for_status()

        result = response.json()

        text = result["choices"][0]["message"]["content"]

        return JSONResponse(
            {
                "response": text
            }
        )

    except Exception as e:

        return JSONResponse(
            {
                "error": str(e)
            },
            status_code=500
        )