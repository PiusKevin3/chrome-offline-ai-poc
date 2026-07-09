# Building a Local Chrome-Powered AI Gateway with Google Antigravity 2.0

*How I leveraged Antigravity's multi-agent orchestration, safety gates, and background execution to package headless Chrome's Gemini Nano and built-in AI APIs into an OpenAI-compatible server.*

---

![Header Image](https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80)

Local AI execution is the holy grail for modern web architecture: it offers zero latency, complete user privacy, and zero token costs. But running heavyweight models on-device has historically required complex native setups, specialized runtimes, or massive downloads.

What if the runtime you already have installed—**Google Chrome**—could act as your system-wide local AI provider?

Chrome v128+ comes shipped with built-in, hardware-accelerated client-side APIs including **Gemini Nano** (via the Prompt API), the **Translation API**, **Summarizer API**, **Writer/Rewriter APIs**, and **Language Detector**.

To turn this client-side client browser technology into a developer-ready backend service, I built [chrome-offline-ai-poc](https://github.com/PiusKevin3/chrome-offline-ai-poc)—an Express server that orchestrates headless Chrome via Puppeteer to expose all of Chrome's built-in AI capabilities via standard JSON REST endpoints and an **OpenAI-compatible streaming API**.

Building a project that crosses boundaries—handling native process spawns, headless browser automation, Express server setups, and API endpoint parity—would usually take days of manual debugging. Instead, I built this in hours using the new **Google Antigravity 2.0 IDE**. 

Here is a look behind the scenes at how Antigravity’s advanced multi-agent orchestration and safety features helped me build it.

---

## The Architecture: Connecting Server to Browser

The core idea of the project is simple but structurally tricky:
1. An **Express Server** starts up on your local machine.
2. It boots a **headless instance of Google Chrome** using Puppeteer, passing the required flags to enable experimental on-device AI.
3. The server maintains a persistent background page.
4. When clients request completion via `/v1/chat/completions`, the Express server evaluates code in the Puppeteer browser context to call `window.ai.assistant.create()`, streams the tokens back from the browser console, and pipes them back to the caller as Server-Sent Events (SSE).

```
                     +---------------------------------------+
                     |            Express Server             |
                     |           (http://localhost:3010)     |
                     +---+-------------------------------+---+
                         |                               |
          API Requests   |                               | Proxies calls to
        (OpenAI Schema)  v                               v window.ai / translation
                     +---+-----------+       +-----------+---+
                     | Client / Curl |       | Headless Chrome |
                     +---------------+       | (Puppeteer Tab) |
                                             +--------+--------+
                                                      |
                                                      v
                                             [ Gemini Nano / Local ]
```

---

## How Google Antigravity 2.0 Guided the Build

To tackle this full-stack challenge, I utilized several of Antigravity's core features designed specifically for complex software engineering.

### 1. Parallel Tasking with Dynamic Subagents

Rather than feeding a single agent a massive prompt and risking context window pollution or code hallucination, I used Antigravity's **Dynamic Subagents**. 

I spun up isolated, short-lived child agents to handle specific, standalone subtasks concurrently:
- **Subagent A (Puppeteer Specialist):** Focused exclusively on browser orchestration, writing the robust logic in `chrome-connector.js` to locate Chrome binaries across different Windows installations and handle headless browser pooling.
- **Subagent B (API Parity Engineer):** Wrote the Express routing logic, mapping incoming JSON payloads to the browser executor.
- **Subagent C (Streaming Architect):** Focused entirely on translating Chrome's client-side readable streams into standard OpenAI-compatible Server-Sent Events (`text/event-stream`).

This tree-based orchestration allowed me to keep the main agent thread clean, responsive, and focused on the overarching system architecture.

### 2. Guarding the System with Interactive Approval Gates

A major requirement of this project was executing system-level actions: installing node dependencies, verifying paths, and spawning Chrome processes (`child_process.spawn`) with specific experimental arguments:
```javascript
const args = [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${CHROME_PROFILE}`,
  '--enable-features=OptimizationGuideOnDeviceModel:compatible_on_device_performance_classes/*,PromptAPIForGeminiNano,PromptAPI',
  '--enable-experimental-web-platform-features'
];
```
In enterprise and local coding scenarios, giving an AI permission to execute arbitrary shell commands is a major security risk. Antigravity handles this beautifully through **Declarative Safety Policies** and **Interactive Human-in-the-Loop Approval Gates**.

Before executing any commands on my system, Antigravity paused execution and popped up a programmatic verification modal in the IDE. This "deny-by-default" framework allowed me to review, tweak, and approve the command execution without risking unexpected system state mutations.

### 3. ephemerality and Portability: Serverless Ad-hoc Skills

To automate the initial configuration checks (verifying that Google Chrome was installed in the default directory, checking Node version limits, and ensuring required Chrome flags were set), I created an ephemeral, file-based skill using Antigravity's **Serverless Ad-hoc Skill Engine**.

By defining a simple `SKILL.md` file containing markdown instructions and configuration parameters, I enabled the agent workspace to temporarily ingest execution steps to run automated pre-flight checks, verifying my development environment before writing a single line of backend code.

### 4. Continuous Verification & Headless Testing

Once the server and client-side bridge were in place, we needed to verify that the streaming response worked correctly, that connections were cleaned up, and that token counts were being calculated accurately.

Instead of jumping between terminal tabs and Postman, I used Antigravity’s **Non-Blocking Asynchronous Task Queues** and **Continuous Verification** features. I launched the Express server as a background task, which kept the main chat interface responsive. I then commanded Antigravity to run a suite of visual and API integration checks using curl commands to stream responses locally. We could inspect, verify, and resolve issues in real-time.

---

## The Outcome: Private, Fast, and Free Local AI

The resulting repository, **`chrome-offline-ai-poc`**, works like a charm. With a simple double-click of a batch file (`start.bat`), you get:
- A local API running on `http://localhost:3010`
- An interactive web playground dashboard (with real-time token usage logs and request history metrics)
- Parity with OpenAI client libraries—meaning you can point your existing AI workflows to your local machine by changing just the base URL.

```javascript
// Connect to Chrome's Gemini Nano via OpenAI's Client Library
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:3010/v1',
  apiKey: 'local-no-key' 
});

const stream = await openai.chat.completions.create({
  model: 'gemini-nano',
  messages: [{ role: 'user', content: 'Tell me a story about a coding AI.' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

---

## Reflections on the "Agentic Architect" Mindset

Building this POC highlighted a paradigm shift in how we build software with AI. Using Google Antigravity 2.0 felt less like using an autocomplete box or a standard chatbot, and more like managing a remote engineering team. 

By leveraging dynamic subagents, safety policies, background queues, and ephemeral skills, I shifted my focus from debugging Puppeteer connection failures and checking port configurations to designing the overall data flow and system architecture.

If you are a Google Developer Expert or engineer looking to participate in **The Agentic Architect Sprint** (running until July 10th, 2026), I highly recommend using Antigravity 2.0 to tackle complex, multi-repo, and on-device integrations. 

Check out the full repository and setup instructions here:  
👉 **[chrome-offline-ai-poc on GitHub](https://github.com/PiusKevin3/chrome-offline-ai-poc)**

*#GoogleAntigravity #AgenticArchitect #GenerativeAI #WebDev #Chrome*
