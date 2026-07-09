// DOM Elements
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const chromeHostStatus = document.getElementById('chrome-host-status');
const modelApiStatus = document.getElementById('model-api-status');
const expressPortStatus = document.getElementById('express-port-status');
const downloadProgressContainer = document.getElementById('download-progress-container');
const downloadProgressBar = document.getElementById('download-progress-bar');

const systemPromptInput = document.getElementById('system-prompt');
const tempInput = document.getElementById('param-temp');
const tempValLabel = document.getElementById('temp-val');
const topkInput = document.getElementById('param-topk');
const topkValLabel = document.getElementById('topk-val');
const streamCheckbox = document.getElementById('param-stream');

const metricSpeed = document.getElementById('metric-avg-speed');
const metricLatency = document.getElementById('metric-latency');

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const streamSpeedIndicator = document.getElementById('stream-speed-indicator');
const currentSpeedLabel = document.getElementById('current-speed');

const consoleLogs = document.getElementById('console-logs');

// Session State
let chatHistory = []; // Array of { role: 'user'|'assistant', content: string }
let pollingTimer = null;
let lastLogIds = new Set();
let latencyMetrics = [];

// Parameters Sync
tempInput.addEventListener('input', () => {
  tempValLabel.textContent = tempInput.value;
});
topkInput.addEventListener('input', () => {
  topkValLabel.textContent = topkInput.value;
});

// Initialize port indicator text
if (expressPortStatus) {
  expressPortStatus.textContent = `Running (Port ${window.location.port || '80'})`;
}

// Update Status Badge UI
function updateStatusUI(chromeConnected, modelStatus, modelDetails, downloadProgress) {
  statusBadge.className = 'status-badge';
  
  if (!chromeConnected) {
    statusBadge.classList.add('status-offline');
    statusText.textContent = 'Disconnected';
    chromeHostStatus.textContent = 'Offline';
    chromeHostStatus.className = 'info-value text-glow-red';
    modelApiStatus.textContent = 'Offline';
    modelApiStatus.className = 'info-value';
    if (downloadProgressContainer) downloadProgressContainer.classList.add('hidden');
  } else {
    chromeHostStatus.textContent = 'Connected (Port 9222)';
    chromeHostStatus.className = 'info-value text-glow-green';

    if (modelStatus === 'yes' || modelStatus === 'readily' || modelStatus === 'available') {
      statusBadge.classList.add('status-online');
      statusText.textContent = 'Ready (Gemini Nano)';
      modelApiStatus.textContent = 'Available';
      modelApiStatus.className = 'info-value text-glow-green';
      if (downloadProgressContainer) downloadProgressContainer.classList.add('hidden');
    } else if (modelStatus === 'after-download' || modelStatus === 'downloading' || modelStatus === 'downloadable') {
      statusBadge.classList.add('status-loading');
      statusText.textContent = 'Downloading Model...';
      if (downloadProgress) {
        const loadedMB = (downloadProgress.loaded / (1024 * 1024)).toFixed(0);
        const totalMB = (downloadProgress.total / (1024 * 1024)).toFixed(0);
        modelApiStatus.textContent = `Downloading (${downloadProgress.percentage}%) - ${loadedMB}/${totalMB} MB`;
        if (downloadProgressContainer) {
          downloadProgressContainer.classList.remove('hidden');
          if (downloadProgressBar) downloadProgressBar.style.width = `${downloadProgress.percentage}%`;
        }
      } else {
        modelApiStatus.textContent = 'Downloading (wait 1-2m)';
        if (downloadProgressContainer) downloadProgressContainer.classList.add('hidden');
      }
      modelApiStatus.className = 'info-value text-glow-yellow';
    } else if (modelStatus === 'no') {
      statusBadge.classList.add('status-offline');
      statusText.textContent = 'No Model';
      modelApiStatus.textContent = 'Not Enabled';
      modelApiStatus.className = 'info-value text-glow-red';
      if (downloadProgressContainer) downloadProgressContainer.classList.add('hidden');
    } else {
      statusBadge.classList.add('status-loading');
      statusText.textContent = 'Initializing...';
      modelApiStatus.textContent = 'Scanning...';
      modelApiStatus.className = 'info-value';
      if (downloadProgressContainer) downloadProgressContainer.classList.add('hidden');
    }
  }
  
  if (modelDetails) {
    // Show truncated capabilities or message in console if hovering
    modelApiStatus.title = modelDetails;
  }
}

// Render console API logs
function renderConsoleLogs(logs) {
  if (!logs || logs.length === 0) return;
  
  // Clear placeholder if we have entries
  if (consoleLogs.querySelector('.console-placeholder')) {
    consoleLogs.innerHTML = '';
  }

  logs.forEach(log => {
    if (lastLogIds.has(log.id)) return; // skip already rendered logs
    lastLogIds.add(log.id);

    const logRow = document.createElement('div');
    logRow.className = 'log-line';
    
    const timeStr = new Date(log.timestamp).toLocaleTimeString();
    const statusClass = log.status === 200 ? 'log-status-200' : 'log-status-error';
    const responseSizeInfo = log.responseSize ? `, size: ${log.responseSize}b` : '';
    const tokenInfo = log.tokenCount > 0 ? `, tokens: ${log.tokenCount}` : '';

    logRow.innerHTML = `
      <span class="log-time">[${timeStr}]</span>
      <span class="log-method">${log.method}</span>
      <span class="log-url">${log.url}</span>
      <span class="log-status ${statusClass}">${log.status}</span>
      <span class="log-metric">${log.durationMs}ms${tokenInfo}${responseSizeInfo}</span>
    `;

    consoleLogs.insertBefore(logRow, consoleLogs.firstChild);

    // Track latency metric
    if (log.status === 200) {
      latencyMetrics.push(log.durationMs);
      if (latencyMetrics.length > 10) latencyMetrics.shift();
      
      const avgDuration = Math.round(latencyMetrics.reduce((a, b) => a + b, 0) / latencyMetrics.length);
      metricLatency.textContent = `${(avgDuration / 1000).toFixed(2)}s`;

      if (log.tokenCount > 0) {
        const speed = (log.tokenCount / (log.durationMs / 1000)).toFixed(1);
        metricSpeed.textContent = speed;
      }
    }
  });
}

// Poll Status API
async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateStatusUI(data.chromeConnected, data.modelStatus, data.modelDetails, data.downloadProgress);
    renderConsoleLogs(data.requestLogs);
  } catch (err) {
    updateStatusUI(false);
  }
}

// Append chat bubbles
function appendMessage(role, content, metaText = '') {
  const msgWrapper = document.createElement('div');
  msgWrapper.className = `message ${role}-message`;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = content;

  if (metaText) {
    const metaSpan = document.createElement('span');
    metaSpan.className = 'message-meta';
    metaSpan.textContent = metaText;
    contentDiv.appendChild(metaSpan);
  }
  
  msgWrapper.appendChild(contentDiv);
  chatMessages.appendChild(msgWrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return contentDiv;
}

// Chat logic
async function handleSend() {
  const prompt = chatInput.value.trim();
  if (!prompt) return;

  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;

  // Add User Message
  appendMessage('user', prompt);
  chatHistory.push({ role: 'user', content: prompt });

  const useStream = streamCheckbox.checked;
  const sysPrompt = systemPromptInput.value.trim();
  const temp = parseFloat(tempInput.value);
  const topK = parseInt(topkInput.value);

  // Prepare OpenAI Payload
  const messages = [];
  if (sysPrompt) {
    messages.push({ role: 'system', content: sysPrompt });
  }
  chatHistory.forEach(h => messages.push(h));

  const payload = {
    model: 'gemini-nano',
    messages,
    temperature: temp,
    top_k: topK,
    stream: useStream
  };

  const startTime = Date.now();
  let assistantBubble = null;
  let accumulatedText = "";
  let tokenCount = 0;

  if (useStream) {
    streamSpeedIndicator.classList.remove('hidden');
    currentSpeedLabel.textContent = '0.0';
    
    try {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error?.message || 'Failed to initialize completions API');
      }

      // Add Assistant Message Placeholder
      assistantBubble = appendMessage('assistant', '');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last chunk segment in buffer

        for (const line of lines) {
          const cleaned = line.trim();
          if (!cleaned) continue;

          if (cleaned.startsWith('data: [DONE]')) {
            break;
          }

          if (cleaned.startsWith('data: ')) {
            const jsonStr = cleaned.slice(6);
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.error) {
                throw new Error(parsed.error.message);
              }
              const chunk = parsed.choices[0]?.delta?.content || '';
              if (chunk) {
                accumulatedText += chunk;
                assistantBubble.textContent = accumulatedText; // update bubble
                
                // Count dynamic speed
                tokenCount += chunk.split(/\s+/).length || 1;
                const elapsedSec = (Date.now() - startTime) / 1000;
                if (elapsedSec > 0.1) {
                  currentSpeedLabel.textContent = (tokenCount / elapsedSec).toFixed(1);
                }
              }
            } catch (err) {
              console.error("SSE parse error:", err);
            }
          }
        }
      }

      // Add completion timing metadata
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const tokensPerSec = (tokenCount / durationSec).toFixed(1);
      const metaSpan = document.createElement('span');
      metaSpan.className = 'message-meta';
      metaSpan.textContent = `Generated in ${durationSec}s (${tokensPerSec} tokens/sec)`;
      assistantBubble.appendChild(metaSpan);

      chatHistory.push({ role: 'assistant', content: accumulatedText });

    } catch (e) {
      appendMessage('system', `Error: ${e.message}`);
    } finally {
      streamSpeedIndicator.classList.add('hidden');
    }
  } else {
    // Non-Streaming POST
    try {
      appendMessage('system', 'Sending request (non-stream mode)...');
      
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      // Remove temporary system alert
      chatMessages.removeChild(chatMessages.lastChild);

      if (data.error) {
        throw new Error(data.error.message);
      }

      const answer = data.choices[0]?.message?.content || '';
      const wordsCount = answer.split(/\s+/).length || 1;
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const tokensPerSec = (wordsCount / durationSec).toFixed(1);

      appendMessage('assistant', answer, `Generated in ${durationSec}s (${tokensPerSec} tokens/sec)`);
      chatHistory.push({ role: 'assistant', content: answer });

    } catch (e) {
      appendMessage('system', `Error: ${e.message}`);
    }
  }

  // Trigger poll instantly to update server logs panel
  pollStatus();

  chatInput.disabled = false;
  sendBtn.disabled = false;
  chatInput.focus();
}

// Clear Chat Session
clearChatBtn.addEventListener('click', () => {
  chatHistory = [];
  chatMessages.innerHTML = '';
  const initialWelcome = document.createElement('div');
  initialWelcome.className = 'message system-message';
  initialWelcome.innerHTML = `<div class="message-content">Welcome to the Chrome Offline AI Developer Playground. Headless Chrome is powering this window! Ask a question to begin.</div>`;
  chatMessages.appendChild(initialWelcome);
});

// Event Listeners
sendBtn.addEventListener('click', handleSend);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    handleSend();
  }
});

// Tab Switching logic
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.getAttribute('data-tab');
    
    // Toggle active classes on tab buttons
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Toggle hidden classes on tab contents
    tabContents.forEach(content => {
      if (content.classList.contains(`${targetTab}-tab-content`)) {
        content.classList.remove('hidden');
      } else {
        content.classList.add('hidden');
      }
    });

    // Update Console Log label dynamically based on tab
    const apiSlug = document.querySelector('.api-slug');
    if (apiSlug) {
      if (targetTab === 'chat') apiSlug.textContent = 'POST /v1/chat/completions';
      else if (targetTab === 'summarize') apiSlug.textContent = 'POST /api/summarize';
      else if (targetTab === 'translate') apiSlug.textContent = 'POST /api/translate';
      else if (targetTab === 'detect') apiSlug.textContent = 'POST /api/detect';
      else if (targetTab === 'write') apiSlug.textContent = 'POST /api/write | /api/rewrite';
    }
  });
});

// Debounced Token Counter
const inputTokenCount = document.getElementById('input-token-count');
let tokenDebounceTimer = null;

async function updateTokenCount() {
  const text = chatInput.value;
  const systemPrompt = systemPromptInput.value.trim();
  const temp = parseFloat(tempInput.value);
  const topK = parseInt(topkInput.value);

  if (!text) {
    if (inputTokenCount) inputTokenCount.textContent = '0';
    return;
  }

  try {
    const res = await fetch('/api/count-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        systemPrompt,
        temperature: temp,
        top_k: topK
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (inputTokenCount) inputTokenCount.textContent = data.count;
    }
  } catch (err) {
    console.error("Error fetching token count:", err);
  }
}

chatInput.addEventListener('input', () => {
  clearTimeout(tokenDebounceTimer);
  tokenDebounceTimer = setTimeout(updateTokenCount, 400);
});

systemPromptInput.addEventListener('input', () => {
  clearTimeout(tokenDebounceTimer);
  tokenDebounceTimer = setTimeout(updateTokenCount, 400);
});

// Summarizer Elements
const summarizeInput = document.getElementById('summarize-input');
const summarizeType = document.getElementById('summarize-type');
const summarizeLength = document.getElementById('summarize-length');
const summarizeFormat = document.getElementById('summarize-format');
const summarizeBtn = document.getElementById('summarize-btn');
const summarizeResultContainer = document.getElementById('summarize-result-container');
const summarizeResult = document.getElementById('summarize-result');

summarizeBtn.addEventListener('click', async () => {
  const text = summarizeInput.value.trim();
  if (!text) return;

  summarizeBtn.disabled = true;
  summarizeBtn.textContent = 'Summarizing...';
  summarizeResultContainer.classList.remove('hidden');
  summarizeResult.textContent = 'Processing request locally...';

  try {
    const res = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        type: summarizeType.value,
        length: summarizeLength.value,
        format: summarizeFormat.value
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Summarization failed');
    summarizeResult.textContent = data.summary || 'Empty response';
  } catch (err) {
    summarizeResult.textContent = `Error: ${err.message}`;
  } finally {
    summarizeBtn.disabled = false;
    summarizeBtn.textContent = 'Summarize';
    pollStatus();
  }
});

// Translator Elements
const translateInput = document.getElementById('translate-input');
const translateSource = document.getElementById('translate-source');
const translateTarget = document.getElementById('translate-target');
const translateBtn = document.getElementById('translate-btn');
const translateResultContainer = document.getElementById('translate-result-container');
const translateResult = document.getElementById('translate-result');

translateBtn.addEventListener('click', async () => {
  const text = translateInput.value.trim();
  if (!text) return;

  translateBtn.disabled = true;
  translateBtn.textContent = 'Translating...';
  translateResultContainer.classList.remove('hidden');
  translateResult.textContent = 'Translating text locally...';

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        sourceLanguage: translateSource.value,
        targetLanguage: translateTarget.value
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Translation failed');
    translateResult.textContent = data.translation || 'Empty response';
  } catch (err) {
    translateResult.textContent = `Error: ${err.message}`;
  } finally {
    translateBtn.disabled = false;
    translateBtn.textContent = 'Translate';
    pollStatus();
  }
});

// Detector Elements
const detectInput = document.getElementById('detect-input');
const detectBtn = document.getElementById('detect-btn');
const detectResultContainer = document.getElementById('detect-result-container');
const detectResult = document.getElementById('detect-result');

detectBtn.addEventListener('click', async () => {
  const text = detectInput.value.trim();
  if (!text) return;

  detectBtn.disabled = true;
  detectBtn.textContent = 'Detecting...';
  detectResultContainer.classList.remove('hidden');
  detectResult.textContent = 'Analyzing text locally...';

  try {
    const res = await fetch('/api/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Detection failed');
    
    if (data.detections && data.detections.length > 0) {
      detectResult.innerHTML = '';
      const list = document.createElement('ul');
      list.className = 'detection-list';
      data.detections.forEach(d => {
        const item = document.createElement('li');
        item.className = 'detection-item';
        item.innerHTML = `
          <span class="detect-lang">Language: <strong>${d.detectedLanguage}</strong></span>
          <span class="detect-conf">Confidence: <strong>${(d.confidence * 100).toFixed(1)}%</strong></span>
        `;
        list.appendChild(item);
      });
      detectResult.appendChild(list);
    } else {
      detectResult.textContent = 'Could not detect language confidently.';
    }
  } catch (err) {
    detectResult.textContent = `Error: ${err.message}`;
  } finally {
    detectBtn.disabled = false;
    detectBtn.textContent = 'Detect Language';
    pollStatus();
  }
});

// Writer Elements
const modeWriteBtn = document.getElementById('mode-write');
const modeRewriteBtn = document.getElementById('mode-rewrite');
const writePromptGroup = document.getElementById('write-prompt-group');
const writeTextGroup = document.getElementById('write-text-group');
const writePrompt = document.getElementById('write-prompt');
const writeText = document.getElementById('write-text');
const writeContext = document.getElementById('write-context');
const writeTone = document.getElementById('write-tone');
const writeLength = document.getElementById('write-length');
const writeFormat = document.getElementById('write-format');
const writeSubmitBtn = document.getElementById('write-submit-btn');
const writeResultContainer = document.getElementById('write-result-container');
const writeResult = document.getElementById('write-result');

let writeMode = 'write';

if (modeWriteBtn && modeRewriteBtn) {
  modeWriteBtn.addEventListener('click', () => {
    writeMode = 'write';
    modeWriteBtn.classList.add('active');
    modeRewriteBtn.classList.remove('active');
    writePromptGroup.classList.remove('hidden');
    writeTextGroup.classList.add('hidden');
    writeSubmitBtn.textContent = 'Generate Text';
  });

  modeRewriteBtn.addEventListener('click', () => {
    writeMode = 'rewrite';
    modeWriteBtn.classList.remove('active');
    modeRewriteBtn.classList.add('active');
    writePromptGroup.classList.add('hidden');
    writeTextGroup.classList.remove('hidden');
    writeSubmitBtn.textContent = 'Rewrite Text';
  });
}

if (writeSubmitBtn) {
  writeSubmitBtn.addEventListener('click', async () => {
    const promptVal = writePrompt.value.trim();
    const textVal = writeText.value.trim();
    
    if (writeMode === 'write' && !promptVal) return;
    if (writeMode === 'rewrite' && !textVal) return;

    writeSubmitBtn.disabled = true;
    writeSubmitBtn.textContent = 'Generating...';
    writeResultContainer.classList.remove('hidden');
    writeResult.textContent = 'Thinking and processing locally...';

    const bodyPayload = {
      context: writeContext.value.trim() || undefined,
      tone: writeTone.value,
      length: writeLength.value,
      format: writeFormat.value
    };

    if (writeMode === 'write') {
      bodyPayload.prompt = promptVal;
    } else {
      bodyPayload.text = textVal;
    }

    const endpoint = writeMode === 'write' ? '/api/write' : '/api/rewrite';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      writeResult.textContent = data.result || 'Empty response';
    } catch (err) {
      writeResult.textContent = `Error: ${err.message}`;
    } finally {
      writeSubmitBtn.disabled = false;
      writeSubmitBtn.textContent = writeMode === 'write' ? 'Generate Text' : 'Rewrite Text';
      pollStatus();
    }
  });
}

// Copy to Clipboard buttons
document.addEventListener('click', async (e) => {
  if (e.target && e.target.classList.contains('copy-btn')) {
    const targetId = e.target.getAttribute('data-target');
    const box = document.getElementById(targetId);
    if (box) {
      const textToCopy = box.innerText || box.textContent;
      try {
        await navigator.clipboard.writeText(textToCopy);
        const originalText = e.target.textContent;
        e.target.textContent = 'Copied!';
        e.target.classList.add('copy-success');
        setTimeout(() => {
          e.target.textContent = originalText;
          e.target.classList.remove('copy-success');
        }, 1500);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
    }
  }
});

// Init
pollStatus();
pollingTimer = setInterval(pollStatus, 2500);
chatInput.focus();
