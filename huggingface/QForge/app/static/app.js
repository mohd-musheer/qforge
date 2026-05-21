const chatList = document.getElementById("chatList");
const chatForm = document.getElementById("chatForm");
const promptInput = document.getElementById("promptInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");

let isGenerating = false;

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

const welcomeText =
  "Hello. Ask me anything and I will reason it out step by step.";

if (window.marked) {
  window.marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
  });
}

const mathOptions = {
  delimiters: [
    { left: "$$", right: "$$", display: true },
    { left: "$", right: "$", display: false },
    { left: "\\(", right: "\\)", display: false },
    { left: "\\[", right: "\\]", display: true },
  ],
  throwOnError: false,
};

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(text) {
  if (!text) {
    return "";
  }

  if (!window.marked || !window.DOMPurify) {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  const raw = window.marked.parse(text, {
  highlight: function(code, lang) {
    if (window.hljs) {
      return hljs.highlightAuto(code).value;
    }
    return code;
  }
});
  return window.DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

function renderMath(container) {
  if (window.renderMathInElement) {
    window.renderMathInElement(container, mathOptions);
  }
}

function isNearBottom() {
  const threshold = 140;
  return (
    chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight <
    threshold
  );
}

let scrollFrame = null;
function autoScroll({ smooth = false, force = false } = {}) {
  if (!force && !isNearBottom()) {
    return;
  }

  if (scrollFrame) {
    window.cancelAnimationFrame(scrollFrame);
  }

  scrollFrame = window.requestAnimationFrame(() => {
    chatList.scrollTo({
      top: chatList.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  });
}

function createMessage(role) {
  const message = document.createElement("div");
  message.className = `message ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const content = document.createElement("div");
  content.className = "bubble-content";

  bubble.appendChild(content);
  message.appendChild(bubble);
  chatList.appendChild(message);
  autoScroll({ smooth: true, force: true });

  return { message, bubble, content };
}

function addUserMessage(text) {
  const { content } = createMessage("user");
  content.innerHTML = renderMarkdown(text);
  renderMath(content);
  if (window.hljs) {
  content.querySelectorAll("pre code").forEach((el) => {
    hljs.highlightElement(el);
  });
}
}

function addAssistantMessage(text) {
  const { content } = createMessage("assistant");
  content.innerHTML = renderMarkdown(text);
  renderMath(content);
  if (window.hljs) {
  content.querySelectorAll("pre code").forEach((el) => {
    hljs.highlightElement(el);
  });
}
}

function addThinkingIndicator() {
  const { bubble, content } = createMessage("assistant");
  bubble.classList.add("thinking");

  const label = document.createElement("span");
  label.className = "thinking-text";
  label.textContent = "Thinking...";
  content.appendChild(label);

  let timer = null;
  if (!prefersReducedMotion) {
    const frames = ["Thinking.", "Thinking..", "Thinking..."];
    let index = 0;
    timer = window.setInterval(() => {
      label.textContent = frames[index % frames.length];
      index += 1;
    }, 520);
  }

  return {
    bubble,
    content,
    stop: () => {
      if (timer) {
        window.clearInterval(timer);
      }
    },
  };
}

function setLoadingState(loading) {
  isGenerating = loading;
  sendBtn.disabled = loading;

  if (loading) {
    chatForm.dataset.generating = "true";
  } else {
    delete chatForm.dataset.generating;
  }
}

function resizeInput() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
}

function typewriter(content, fullText) {
  if (prefersReducedMotion) {
    content.innerHTML = renderMarkdown(fullText);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const total = fullText.length;
    if (total === 0) {
      content.innerHTML = "";
      resolve();
      return;
    }

    const targetFrames = 180;
    const chunkSize = Math.max(2, Math.ceil(total / targetFrames));
    let index = 0;

    const step = () => {
      index = Math.min(total, index + chunkSize);
      content.innerHTML = renderMarkdown(fullText.slice(0, index));
      autoScroll({ force: true });

      if (index >= total) {
        resolve();
        return;
      }

      window.setTimeout(step, 18);
    };

    step();
  });
}

// Attempts SSE / text-stream from /generate. Returns true if the server
// sent at least one data chunk, false if the endpoint is non-streaming.
async function streamCompletion(prompt, onDelta) {
  const response = await fetch("/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "";

  // Non-streaming JSON response — let the caller fall back to requestCompletion
  if (contentType.includes("application/json")) {
    const data = await response.json();
    const text = data.response || "";
    if (text) {
      onDelta(text);
    }
    return true;
  }

  // Streaming: read the body as an SSE / newline-delimited text stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedAny = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;

      const raw = trimmed.startsWith("data: ")
        ? trimmed.slice(6)
        : trimmed;

      try {
        const parsed = JSON.parse(raw);
        // OpenAI-style SSE delta
        const delta =
          parsed?.choices?.[0]?.delta?.content ??
          parsed?.response ??
          "";
        if (delta) {
          onDelta(delta);
          receivedAny = true;
        }
      } catch {
        // Not JSON — treat the raw text as a plain delta
        if (raw) {
          onDelta(raw);
          receivedAny = true;
        }
      }
    }
  }

  return receivedAny;
}

async function requestCompletion(prompt) {
  const response = await fetch("/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  const data = await response.json();
  return data.response || "";
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isGenerating) {
    return;
  }

  const prompt = promptInput.value.trim();
  if (!prompt) {
    return;
  }

  addUserMessage(prompt);
  promptInput.value = "";
  resizeInput();
  setLoadingState(true);

  const thinking = addThinkingIndicator();
  let responseText = "";
  let started = false;

  const applyDelta = (delta) => {
    if (!delta) return;

    if (!started) {
      thinking.stop();
      thinking.bubble.classList.remove("thinking");
      thinking.content.innerHTML = "";
      started = true;
    }

    responseText += delta;
    thinking.content.innerHTML = renderMarkdown(responseText);
    autoScroll({ force: true });
  };

  try {
    const streamed = await streamCompletion(prompt, applyDelta);

    if (!streamed) {
      // streamCompletion returned false — pure fallback (shouldn't normally happen)
      const output = await requestCompletion(prompt);
      responseText = output;
      if (!started) {
        thinking.stop();
        thinking.bubble.classList.remove("thinking");
        thinking.content.innerHTML = "";
      }
      await typewriter(thinking.content, output);
      thinking.content.innerHTML = renderMarkdown(output);
    } else if (!started) {
      thinking.stop();
      thinking.bubble.classList.remove("thinking");
      thinking.content.innerHTML = renderMarkdown("");
    }

    renderMath(thinking.content);
  } catch (error) {
    thinking.stop();
    thinking.bubble.classList.remove("thinking");
    thinking.content.innerHTML = renderMarkdown(
      "Sorry, I could not reach the model server. Please try again."
    );
    console.error(error);
  } finally {
    setLoadingState(false);
  }
}

function handleKeyDown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!isGenerating) {
      chatForm.requestSubmit();
    }
  }
}

function resetChat() {
  chatList.innerHTML = "";
  addAssistantMessage(welcomeText);
  autoScroll({ smooth: false, force: true });
}

promptInput.addEventListener("input", resizeInput);
promptInput.addEventListener("keydown", handleKeyDown);
chatForm.addEventListener("submit", handleSubmit);
clearBtn.addEventListener("click", resetChat);
window.addEventListener("resize", resizeInput);

resetChat();