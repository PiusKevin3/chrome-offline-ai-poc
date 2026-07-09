import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { initChrome, getModelStatus, generateText, countTokens, summarizeText, translateText, detectLanguage, writeText, rewriteText } from './chrome-connector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3010;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store simple metric history for dashboard
const requestLogs = [];

function logRequest(ip, method, url, status, durationMs, payloadSize, responseSize, tokenCount = -1) {
  const logEntry = {
    id: crypto.randomUUID().substring(0, 8),
    timestamp: new Date().toISOString(),
    ip,
    method,
    url,
    status,
    durationMs,
    payloadSize,
    responseSize,
    tokenCount
  };
  requestLogs.unshift(logEntry);
  if (requestLogs.length > 50) {
    requestLogs.pop(); // limit log history to last 50
  }
}

// 1. Status API
app.get('/api/status', async (req, res) => {
  try {
    const status = await getModelStatus();
    res.json({
      chromeConnected: true,
      modelStatus: status.status,
      modelDetails: status.details,
      requestLogs
    });
  } catch (error) {
    res.status(500).json({
      chromeConnected: false,
      modelStatus: 'error',
      modelDetails: error.message,
      requestLogs
    });
  }
});

// 2. OpenAI Models Endpoint
app.get('/v1/models', (req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: "gemini-nano",
        object: "model",
        created: Math.floor(Date.now() / 1000) - 100000,
        owned_by: "chrome"
      }
    ]
  });
});

// 3. OpenAI Chat Completions Endpoint
app.post('/v1/chat/completions', async (req, res) => {
  const startTime = Date.now();
  const reqId = crypto.randomUUID();
  const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const payloadSize = JSON.stringify(req.body).length;

  const {
    model = 'gemini-nano',
    messages = [],
    temperature,
    top_k,
    stream = false
  } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    logRequest(clientIp, 'POST', '/v1/chat/completions', 400, Date.now() - startTime, payloadSize, 0);
    return res.status(400).json({
      error: { message: "Invalid payload: 'messages' is required and must be a non-empty array." }
    });
  }

  // Format history for Gemini Nano Prompt API
  let systemPrompt = "";
  let promptText = "";

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else if (msg.role === 'user') {
      promptText += `User: ${msg.content}\n`;
    } else if (msg.role === 'assistant') {
      promptText += `Model: ${msg.content}\n`;
    }
  }
  promptText += `Model:`;

  const options = {
    stream,
    temperature: temperature !== undefined ? Number(temperature) : undefined,
    topK: top_k !== undefined ? Number(top_k) : undefined
  };

  try {
    if (stream) {
      // Set Server-Sent Events headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let responseText = "";
      let tokenEstimate = 0;

      await generateText(reqId, systemPrompt, promptText, options, ({ chunk, isDone, isError, errorMessage }) => {
        if (isError) {
          console.error("Inference streaming error:", errorMessage);
          const errorData = { error: { message: errorMessage } };
          res.write(`data: ${JSON.stringify(errorData)}\n\n`);
          logRequest(clientIp, 'POST', '/v1/chat/completions', 500, Date.now() - startTime, payloadSize, responseText.length, tokenEstimate);
          res.end();
          return;
        }

        if (chunk) {
          responseText += chunk;
          tokenEstimate += chunk.split(/\s+/).length || 1; // estimate token count based on whitespace
          
          const sseChunk = {
            id: `chatcmpl-${reqId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
              index: 0,
              delta: { content: chunk },
              finish_reason: null
            }]
          };
          res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
        }

        if (isDone) {
          const sseFinal = {
            id: `chatcmpl-${reqId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: "stop"
            }]
          };
          res.write(`data: ${JSON.stringify(sseFinal)}\n\n`);
          res.write("data: [DONE]\n\n");
          logRequest(clientIp, 'POST', '/v1/chat/completions', 200, Date.now() - startTime, payloadSize, responseText.length, tokenEstimate);
          res.end();
        }
      });

    } else {
      // Non-streaming completion
      let fullText = "";
      await generateText(reqId, systemPrompt, promptText, options, ({ chunk, isDone, isError, errorMessage }) => {
        if (isError) {
          logRequest(clientIp, 'POST', '/v1/chat/completions', 500, Date.now() - startTime, payloadSize, 0);
          return res.status(500).json({ error: { message: errorMessage } });
        }

        if (chunk) {
          fullText += chunk;
        }

        if (isDone) {
          const responsePayload = {
            id: `chatcmpl-${reqId}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: fullText
              },
              finish_reason: "stop"
            }],
            usage: {
              prompt_tokens: -1,
              completion_tokens: -1,
              total_tokens: -1
            }
          };
          const textLength = fullText.length;
          const tokenCount = fullText.split(/\s+/).length || 1;
          logRequest(clientIp, 'POST', '/v1/chat/completions', 200, Date.now() - startTime, payloadSize, textLength, tokenCount);
          res.json(responsePayload);
        }
      });
    }

  } catch (error) {
    console.error("API error:", error);
    logRequest(clientIp, 'POST', '/v1/chat/completions', 500, Date.now() - startTime, payloadSize, 0);
    res.status(500).json({
      error: { message: `Internal server error during prompt execution: ${error.message}` }
    });
  }
});

// Summarizer endpoint
app.post('/api/summarize', async (req, res) => {
  const startTime = Date.now();
  const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const payloadSize = JSON.stringify(req.body).length;
  const { text, type, length, format } = req.body;

  if (!text) {
    logRequest(clientIp, 'POST', '/api/summarize', 400, Date.now() - startTime, payloadSize, 0);
    return res.status(400).json({ error: "Missing 'text' in request body." });
  }

  try {
    const summary = await summarizeText(text, { type, length, format });
    logRequest(clientIp, 'POST', '/api/summarize', 200, Date.now() - startTime, payloadSize, summary.length);
    res.json({ summary });
  } catch (error) {
    console.error("Summarizer API error:", error);
    logRequest(clientIp, 'POST', '/api/summarize', 500, Date.now() - startTime, payloadSize, 0);
    res.status(500).json({ error: error.message });
  }
});

// Translator endpoint
app.post('/api/translate', async (req, res) => {
  const startTime = Date.now();
  const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const payloadSize = JSON.stringify(req.body).length;
  const { text, sourceLanguage, targetLanguage } = req.body;

  if (!text || !sourceLanguage || !targetLanguage) {
    logRequest(clientIp, 'POST', '/api/translate', 400, Date.now() - startTime, payloadSize, 0);
    return res.status(400).json({ error: "Missing 'text', 'sourceLanguage', or 'targetLanguage' in request body." });
  }

  try {
    const translation = await translateText(text, { sourceLanguage, targetLanguage });
    logRequest(clientIp, 'POST', '/api/translate', 200, Date.now() - startTime, payloadSize, translation.length);
    res.json({ translation });
  } catch (error) {
    console.error("Translator API error:", error);
    logRequest(clientIp, 'POST', '/api/translate', 500, Date.now() - startTime, payloadSize, 0);
    res.status(500).json({ error: error.message });
  }
});

// Language Detector endpoint
app.post('/api/detect', async (req, res) => {
  const startTime = Date.now();
  const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const payloadSize = JSON.stringify(req.body).length;
  const { text } = req.body;

  if (!text) {
    logRequest(clientIp, 'POST', '/api/detect', 400, Date.now() - startTime, payloadSize, 0);
    return res.status(400).json({ error: "Missing 'text' in request body." });
  }

  try {
    const detections = await detectLanguage(text);
    const responseSize = JSON.stringify({ detections }).length;
    logRequest(clientIp, 'POST', '/api/detect', 200, Date.now() - startTime, payloadSize, responseSize);
    res.json({ detections });
  } catch (error) {
    console.error("Detector API error:", error);
    logRequest(clientIp, 'POST', '/api/detect', 500, Date.now() - startTime, payloadSize, 0);
    res.status(500).json({ error: error.message });
  }
});

// Token Counter endpoint
app.post('/api/count-tokens', async (req, res) => {
  const { text, systemPrompt, temperature, top_k } = req.body;

  if (text === undefined || text === null) {
    return res.status(400).json({ error: "Missing 'text' in request body." });
  }

  try {
    const count = await countTokens(text, systemPrompt, { 
      temperature: temperature !== undefined ? Number(temperature) : undefined, 
      topK: top_k !== undefined ? Number(top_k) : undefined 
    });
    res.json({ count });
  } catch (error) {
    console.error("Token counter API error:", error);
    res.status(500).json({ error: error.message });
  }
});


// Content Writer endpoint
app.post('/api/write', async (req, res) => {
  const startTime = Date.now();
  const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const payloadSize = JSON.stringify(req.body).length;
  const { prompt, context, tone, length, format } = req.body;

  if (!prompt) {
    logRequest(clientIp, 'POST', '/api/write', 400, Date.now() - startTime, payloadSize, 0);
    return res.status(400).json({ error: "Missing 'prompt' in request body." });
  }

  try {
    const result = await writeText(prompt, { context, tone, length, format });
    logRequest(clientIp, 'POST', '/api/write', 200, Date.now() - startTime, payloadSize, result.length);
    res.json({ result });
  } catch (error) {
    console.error("Writer API error:", error);
    logRequest(clientIp, 'POST', '/api/write', 500, Date.now() - startTime, payloadSize, 0);
    res.status(500).json({ error: error.message });
  }
});

// Content Rewriter endpoint
app.post('/api/rewrite', async (req, res) => {
  const startTime = Date.now();
  const clientIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const payloadSize = JSON.stringify(req.body).length;
  const { text, context, tone, length, format } = req.body;

  if (!text) {
    logRequest(clientIp, 'POST', '/api/rewrite', 400, Date.now() - startTime, payloadSize, 0);
    return res.status(400).json({ error: "Missing 'text' in request body." });
  }

  try {
    const result = await rewriteText(text, { context, tone, length, format });
    logRequest(clientIp, 'POST', '/api/rewrite', 200, Date.now() - startTime, payloadSize, result.length);
    res.json({ result });
  } catch (error) {
    console.error("Rewriter API error:", error);
    logRequest(clientIp, 'POST', '/api/rewrite', 500, Date.now() - startTime, payloadSize, 0);
    res.status(500).json({ error: error.message });
  }
});

// Start Express and initialize background Chrome
app.listen(PORT, async () => {
  console.log(`========================================`);
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`========================================`);
  try {
    await initChrome(9222, PORT);
  } catch (err) {
    console.error("CRITICAL: Failed to initialize headless Chrome connection.");
    console.error(err.message);
    console.error("Please ensure Google Chrome (v128+) is installed and optimization flags are enabled.");
  }
});
