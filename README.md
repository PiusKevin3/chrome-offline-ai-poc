# Chrome Offline AI POC (`chrome-offline-ai-poc`)

An experimental, local proof-of-concept (POC) Express server that runs a headless instance of Google Chrome via Puppeteer to expose Chrome's built-in offline AI features (Gemini Nano, Translation, Summarization, and Writing APIs) through standard, OpenAI-compatible web endpoints.

This project enables fully local, private, and offline AI inference directly in your terminal, client apps, or developer pipelines by leveraging the AI hardware-acceleration built directly into modern Chrome installations.

---

## How It Works

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

1. **Express Server Start:** Spawns a headless Google Chrome process using Puppeteer with flags enabling experimental on-device models.
2. **Browser Connection:** Puppeteer opens a persistent background page.
3. **Execution Proxy:** When you query the Express APIs, the server evaluates JavaScript commands on the headless page to execute Chrome's experimental browser APIs (`window.ai`, `translation`, etc.).
4. **Result Stream:** The response or stream is returned back to the server and client.

---

## Features

- **OpenAI Compatibility:** `/v1/chat/completions` endpoint supporting streaming (`text/event-stream`) and non-streaming modes with Gemini Nano.
- **Built-in Browser AI Wrappers:**
  - **Prompt API** (`gemini-nano`)
  - **Summarizer API** (`/api/summarize`)
  - **Translation API** (`/api/translate`)
  - **Language Detector API** (`/api/detect`)
  - **Token Counter API** (`/api/count-tokens`)
  - **Writer & Rewriter APIs** (`/api/write`, `/api/rewrite`)
- **Dashboard Playground:** An interactive UI dashboard served at `http://localhost:3010` to test models, check server status, view logs, and monitor token/request history.

---

## Prerequisites

1. **Google Chrome (v128+)** installed.
2. **On-Device AI Configured in Chrome:**
   - Open Chrome and navigate to `chrome://flags/`
   - Enable **Enables optimization guide on-device model** (`#optimization-guide-on-device-model`) -> Set to `Enabled BypassPrefRequirement`.
   - Enable **Prompt API for Gemini Nano** (`#prompt-api-for-gemini-nano`) -> Set to `Enabled`.
   - Navigate to `chrome://components/` and check for updates under **Optimization Guide On Device Model** to ensure the Gemini Nano model is fully downloaded.
3. **Node.js** (v18 or higher) installed on your system.

---

## Getting Started

### Windows (Quick Start)
Simply double-click the **`start.bat`** file. It will:
1. Verify Node.js is installed.
2. Run `npm install` if `node_modules` is missing.
3. Open the playground in your default browser (`http://localhost:3010`).
4. Launch the local API server.

### Manual Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```

---

## API Endpoints

### 1. OpenAI Chat Completions
* **Endpoint:** `POST /v1/chat/completions`
* **Headers:** `Content-Type: application/json`
* **Body:**
  ```json
  {
    "model": "gemini-nano",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Explain quantum computing in one sentence." }
    ],
    "temperature": 0.7,
    "stream": false
  }
  ```

* **cURL Example (Streaming):**
  ```bash
  curl http://localhost:3010/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{
      "model": "gemini-nano",
      "messages": [{"role": "user", "content": "Hello!"}],
      "stream": true
    }'
  ```

### 2. Summarizer API
* **Endpoint:** `POST /api/summarize`
* **Body:**
  ```json
  {
    "text": "Your long text here...",
    "type": "key-points", 
    "length": "short",
    "format": "markdown"
  }
  ```
  *(Parameters `type`, `length`, and `format` match Chrome's Summarizer options).*

### 3. Translation API
* **Endpoint:** `POST /api/translate`
* **Body:**
  ```json
  {
    "text": "Hello, how are you?",
    "sourceLanguage": "en",
    "targetLanguage": "es"
  }
  ```

### 4. Language Detector API
* **Endpoint:** `POST /api/detect`
* **Body:**
  ```json
  {
    "text": "Bonjour tout le monde"
  }
  ```

### 5. Writing and Rewriting APIs
* **Endpoint:** `POST /api/write` or `POST /api/rewrite`
* **Body (`/api/write`):**
  ```json
  {
    "prompt": "Write an email template inviting people to a workshop.",
    "context": "Professional setting, Friday afternoon, technology theme.",
    "tone": "casual",
    "length": "medium",
    "format": "plain-text"
  }
  ```

---

## Repository Structure

- [server.js](file:///d:/dev/offline-inference/server.js) — The Express server defining the REST and SSE endpoints.
- [chrome-connector.js](file:///d:/dev/offline-inference/chrome-connector.js) — Puppeteer connector orchestration, Chrome capability validation, and browser-to-server function wrappers.
- [public/](file:///d:/dev/offline-inference/public/) — Contains the static assets (HTML, CSS, JS) for the playground web dashboard.
- [start.bat](file:///d:/dev/offline-inference/start.bat) — Windows automated initialization batch script.
- [.gitignore](file:///d:/dev/offline-inference/.gitignore) — Configured git exclusion rules.
