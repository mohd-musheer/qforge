from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import torch

from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM
)

from peft import PeftModel

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
# LOAD QFORGE ON STARTUP
# ==========================================================

BASE_MODEL = "Qwen/Qwen2.5-Coder-3B-Instruct"

ADAPTER_MODEL = "mohd-musheer/qforge-qwen-adapter"

print("Loading tokenizer...")

tokenizer = AutoTokenizer.from_pretrained(
    ADAPTER_MODEL,
    trust_remote_code=True
)

print("Loading base model...")

base_model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    torch_dtype=torch.float16,
    device_map="auto",
    trust_remote_code=True
)

print("Loading adapter...")

model = PeftModel.from_pretrained(
    base_model,
    ADAPTER_MODEL
)

model.eval()

print("QForge loaded successfully.")

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
- If asked to analyze code:
  - identify bugs
  - explain root causes
  - explain performance bottlenecks
  - suggest improvements
- If code is requested:
  - generate production-quality code
  - include comments where valuable
  - follow best practices
"""

# ==========================================================
# ROUTES
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

    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT
        },
        {
            "role": "user",
            "content": data.prompt
        }
    ]

    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True
    )

    inputs = tokenizer(
        text,
        return_tensors="pt"
    ).to(model.device)

    with torch.no_grad():

        outputs = model.generate(
            **inputs,
            max_new_tokens=4096,
            temperature=0.7,
            do_sample=True,
            top_p=0.95,
            repetition_penalty=1.05
        )

    generated_text = tokenizer.decode(
        outputs[0],
        skip_special_tokens=True
    )

    assistant_response = generated_text[len(text):].strip()

    return JSONResponse(
        {
            "response": assistant_response
        }
    )