import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PROFILE = path.join(__dirname, '.chrome_profile');

// Find chrome executable on Windows
function findChrome() {
  const commonPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error("Google Chrome executable not found. Please install Google Chrome.");
}

// Check if Chrome debugging is available
async function isChromeRunning(port = 9222) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    return res.ok;
  } catch (e) {
    return false;
  }
}

let browser = null;
let page = null;
const activeStreams = new Map();
let currentDownloadProgress = null;

// Initialize chrome connection
export async function initChrome(port = 9222, expressPort = 3010) {
  const isRunning = await isChromeRunning(port);
  if (!isRunning) {
    console.log("Chrome is not running on port 9222. Launching headlessly...");
    const chromePath = findChrome();
    
    // Ensure profile dir exists
    if (!fs.existsSync(CHROME_PROFILE)) {
      fs.mkdirSync(CHROME_PROFILE, { recursive: true });
    }

    const args = [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${CHROME_PROFILE}`,
      '--enable-features=OptimizationGuideOnDeviceModel:compatible_on_device_performance_classes/*,PromptAPIForGeminiNano,PromptAPI',
      '--enable-experimental-web-platform-features',
      '--ignore-gpu-blocklist',
      '--no-first-run',
      '--no-default-browser-check'
    ];

    console.log(`Spawning Chrome: "${chromePath}" ${args.join(' ')}`);
    const proc = spawn(chromePath, args, {
      detached: true,
      stdio: 'ignore'
    });
    proc.unref();

    // Poll until Chrome is ready
    let attempts = 0;
    while (attempts < 20) {
      await new Promise(r => setTimeout(r, 500));
      if (await isChromeRunning(port)) {
        console.log("Chrome launched successfully and is listening!");
        break;
      }
      attempts++;
    }

    if (attempts >= 20) {
      throw new Error("Timeout waiting for headless Chrome to start.");
    }
  } else {
    console.log("Headless Chrome already running on port 9222.");
  }

  // Connect to Chrome
  browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null
  });

  // Create or find a persistent page for running commands
  const pages = await browser.pages();
  page = pages[0] || (await browser.newPage());
  
  await page.goto(`http://localhost:${expressPort}`);

  // Set up stream event bridge
  await page.exposeFunction('sendChunk', (reqId, chunk, isDone, isError, errorMessage) => {
    const callback = activeStreams.get(reqId);
    if (callback) {
      callback({ chunk, isDone, isError, errorMessage });
      if (isDone || isError) {
        activeStreams.delete(reqId);
      }
    }
  });

  await page.exposeFunction('sendDownloadProgress', (loaded, total) => {
    const percentage = total > 0 ? Math.round((loaded / total) * 100) : 0;
    currentDownloadProgress = { loaded, total, percentage };
    const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
    const totalMB = (total / (1024 * 1024)).toFixed(1);
    console.log(`[INFO] Downloading Gemini Nano: ${percentage}% (${loadedMB}MB / ${totalMB}MB)`);
  });

  // Proactively trigger download if model is downloadable
  await page.evaluate(async () => {
    try {
      const getAPI = () => {
        if (typeof window.ai !== 'undefined') {
          return window.ai.languageModel || window.ai.assistant || (typeof window.ai.createTextSession === 'function' ? { create: (opts) => window.ai.createTextSession(opts), availability: async () => 'yes' } : null);
        }
        if (typeof window.LanguageModel !== 'undefined') {
          return window.LanguageModel;
        }
        return null;
      };

      const api = getAPI();
      if (api) {
        let avail = 'yes';
        if (typeof api.availability === 'function') {
          avail = await api.availability();
        } else if (typeof api.capabilities === 'function') {
          const caps = await api.capabilities();
          avail = caps.available;
        }

        if (avail === 'downloadable' || avail === 'after-download') {
          console.log("Gemini Nano is downloadable. Triggering download now...");
          const createOptions = {
            monitor: (m) => {
              m.addEventListener('downloadprogress', (e) => {
                window.sendDownloadProgress(e.loaded, e.total);
              });
            }
          };
          api.create(createOptions).catch(() => {});
        }
      }
    } catch (e) {
      // ignore
    }
  });

  console.log("Puppeteer connected and background page initialized.");
}

// Get model availability status
export async function getModelStatus() {
  if (!page) throw new Error("Chrome connector not initialized");
  const result = await page.evaluate(async () => {
    try {
      const getAPI = () => {
        if (typeof window.ai !== 'undefined') {
          return window.ai.languageModel || window.ai.assistant || (typeof window.ai.createTextSession === 'function' ? { capabilities: async () => ({ available: 'yes' }) } : null);
        }
        if (typeof window.LanguageModel !== 'undefined') {
          return window.LanguageModel;
        }
        return null;
      };

      const apis = {
        promptApi: getAPI() !== null,
        summarizerApi: typeof window.ai !== 'undefined' && typeof window.ai.summarizer !== 'undefined',
        translatorApi: 'Translator' in window || (typeof window.ai !== 'undefined' && typeof window.ai.translator !== 'undefined'),
        languageDetectorApi: 'LanguageDetector' in window || (typeof window.ai !== 'undefined' && typeof window.ai.languageDetector !== 'undefined'),
        writerApi: typeof window.ai !== 'undefined' && typeof window.ai.writer !== 'undefined',
        rewriterApi: typeof window.ai !== 'undefined' && typeof window.ai.rewriter !== 'undefined'
      };

      const api = getAPI();
      if (!api) {
        return {
          status: 'unavailable',
          details: 'Prompt API (window.ai / window.LanguageModel) not found. Ensure Chrome version is 128+ and optimization guide/prompt flags are enabled.',
          apis
        };
      }

      let statusInfo = { status: 'yes', details: 'API detected' };

      if (typeof api.capabilities === 'function') {
        const caps = await api.capabilities();
        let status = caps.available;
        if (status === 'readily' || status === 'available') status = 'yes';
        statusInfo = {
          status: status,
          details: `Capabilities: ${JSON.stringify(caps)}`
        };
      } else if (typeof api.availability === 'function') {
        const avail = await api.availability();
        let status = 'no';
        if (avail === 'readily' || avail === 'available') {
          status = 'yes';
        } else if (avail === 'downloading' || avail === 'downloadable' || avail === 'after-download') {
          status = 'after-download';
        } else {
          status = avail;
        }
        statusInfo = {
          status: status,
          details: `Availability: ${avail}`
        };
      }

      return {
        ...statusInfo,
        apis
      };
    } catch (e) {
      return { status: 'error', details: e.message, apis: {} };
    }
  });
  if (result) {
    result.downloadProgress = currentDownloadProgress;
  }
  return result;
}

// Run text generation
export async function generateText(reqId, systemPrompt, promptText, options, onChunk) {
  if (!page) throw new Error("Chrome connector not initialized");

  activeStreams.set(reqId, onChunk);

  // We run the prompt inside the page context
  await page.evaluate(async (reqId, systemPrompt, promptText, options) => {
    try {
      const getAPI = () => {
        if (typeof window.ai !== 'undefined') {
          return window.ai.languageModel || window.ai.assistant || (typeof window.ai.createTextSession === 'function' ? { create: (opts) => window.ai.createTextSession(opts) } : null);
        }
        if (typeof window.LanguageModel !== 'undefined') {
          return window.LanguageModel;
        }
        return null;
      };

      const api = getAPI();
      if (!api) throw new Error("Built-in AI API is not available on this Chrome instance");

      const config = {};
      if (systemPrompt) config.systemPrompt = systemPrompt;
      if (options.temperature !== undefined) config.temperature = options.temperature;
      if (options.topK !== undefined) config.topK = options.topK;

      const session = await api.create(config);
      
      if (options.stream) {
        const stream = session.promptStreaming(promptText);
        let prevLength = 0;
        let prevText = "";
        let isAccumulated = null;
        for await (const chunk of stream) {
          if (isAccumulated === null && prevLength > 0) {
            isAccumulated = chunk.length > prevLength && chunk.startsWith(prevText);
          }
          let delta = chunk;
          if (isAccumulated) {
            delta = chunk.slice(prevLength);
          }
          prevLength = chunk.length;
          prevText = chunk;
          window.sendChunk(reqId, delta, false, false, null);
        }
        window.sendChunk(reqId, '', true, false, null);
      } else {
        const result = await session.prompt(promptText);
        window.sendChunk(reqId, result, true, false, null);
      }
      
      if (typeof session.destroy === 'function') {
        await session.destroy();
      }
    } catch (err) {
      window.sendChunk(reqId, null, false, true, err.message || String(err));
    }
  }, reqId, systemPrompt, promptText, options);
}

// Count prompt tokens
export async function countTokens(text, systemPrompt, options = {}) {
  if (!page) throw new Error("Chrome connector not initialized");
  return await page.evaluate(async (text, systemPrompt, options) => {
    try {
      const getAPI = () => {
        if (typeof window.ai !== 'undefined') {
          return window.ai.languageModel || window.ai.assistant || (typeof window.ai.createTextSession === 'function' ? { create: (opts) => window.ai.createTextSession(opts) } : null);
        }
        if (typeof window.LanguageModel !== 'undefined') {
          return window.LanguageModel;
        }
        return null;
      };

      const api = getAPI();
      if (!api) throw new Error("Built-in AI API is not available on this Chrome instance");

      const config = {};
      if (systemPrompt) config.systemPrompt = systemPrompt;
      if (options.temperature !== undefined) config.temperature = options.temperature;
      if (options.topK !== undefined) config.topK = options.topK;

      const session = await api.create(config);
      try {
        if (typeof session.countPromptTokens === 'function') {
          return await session.countPromptTokens(text);
        } else {
          // Fallback token estimation
          return text.split(/\s+/).length || 1;
        }
      } finally {
        if (typeof session.destroy === 'function') {
          await session.destroy();
        }
      }
    } catch (err) {
      throw new Error(err.message || String(err));
    }
  }, text, systemPrompt, options);
}

// 1. Text Summarization
export async function summarizeText(text, options) {
  if (!page) throw new Error("Chrome connector not initialized");
  return await page.evaluate(async (text, options) => {
    const getSummarizerAPI = () => {
      if (typeof window.ai !== 'undefined' && window.ai.summarizer) return window.ai.summarizer;
      return null;
    };
    const api = getSummarizerAPI();
    if (!api) throw new Error("Summarizer API is not available on this Chrome instance");

    let isAvailable = true;
    if (typeof api.capabilities === 'function') {
      const cap = await api.capabilities();
      if (cap.available === 'no') isAvailable = false;
    }
    if (!isAvailable) throw new Error("Summarizer model is not available");

    const summarizer = await api.create(options);
    try {
      return await summarizer.summarize(text);
    } finally {
      if (typeof summarizer.destroy === 'function') {
        await summarizer.destroy();
      }
    }
  }, text, options);
}

// 2. Text Translation
export async function translateText(text, options) {
  if (!page) throw new Error("Chrome connector not initialized");
  return await page.evaluate(async (text, options) => {
    const getTranslatorAPI = () => {
      if (typeof window.ai !== 'undefined' && window.ai.translator) return window.ai.translator;
      if (typeof window.Translator !== 'undefined') return window.Translator;
      return null;
    };
    const api = getTranslatorAPI();
    if (!api) throw new Error("Translator API is not available on this Chrome instance");

    let isAvailable = true;
    if (typeof api.availability === 'function') {
      const availability = await api.availability({
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage
      });
      if (availability === 'no' || availability === 'unavailable') isAvailable = false;
    }
    if (!isAvailable) throw new Error(`Translator model not available for ${options.sourceLanguage} -> ${options.targetLanguage}`);

    const translator = await api.create(options);
    try {
      return await translator.translate(text);
    } finally {
      if (typeof translator.destroy === 'function') {
        await translator.destroy();
      }
    }
  }, text, options);
}

// 3. Language Detection
export async function detectLanguage(text) {
  if (!page) throw new Error("Chrome connector not initialized");
  return await page.evaluate(async (text) => {
    const getDetectorAPI = () => {
      if (typeof window.ai !== 'undefined' && window.ai.languageDetector) return window.ai.languageDetector;
      if (typeof window.LanguageDetector !== 'undefined') return window.LanguageDetector;
      return null;
    };
    const api = getDetectorAPI();
    if (!api) throw new Error("Language Detector API is not available on this Chrome instance");

    let isAvailable = true;
    if (typeof api.availability === 'function') {
      const availability = await api.availability();
      if (availability === 'no' || availability === 'unavailable') isAvailable = false;
    }
    if (!isAvailable) throw new Error("Language Detector model is not available");

    const detector = await api.create();
    try {
      return await detector.detect(text);
    } finally {
      if (typeof detector.destroy === 'function') {
        await detector.destroy();
      }
    }
  }, text);
}

// 4. Content Writing
export async function writeText(prompt, options) {
  if (!page) throw new Error("Chrome connector not initialized");
  return await page.evaluate(async (prompt, options) => {
    const getWriterAPI = () => {
      if (typeof window.ai !== 'undefined' && window.ai.writer) return window.ai.writer;
      return null;
    };
    const api = getWriterAPI();
    if (!api) throw new Error("Writer API is not available on this Chrome instance");

    const writer = await api.create(options);
    try {
      return await writer.write(prompt, { context: options.context });
    } finally {
      if (typeof writer.destroy === 'function') {
        await writer.destroy();
      }
    }
  }, prompt, options);
}

// 5. Content Rewriting
export async function rewriteText(text, options) {
  if (!page) throw new Error("Chrome connector not initialized");
  return await page.evaluate(async (text, options) => {
    const getRewriterAPI = () => {
      if (typeof window.ai !== 'undefined' && window.ai.rewriter) return window.ai.rewriter;
      return null;
    };
    const api = getRewriterAPI();
    if (!api) throw new Error("Rewriter API is not available on this Chrome instance");

    const rewriter = await api.create(options);
    try {
      return await rewriter.rewrite(text, { context: options.context });
    } finally {
      if (typeof rewriter.destroy === 'function') {
        await rewriter.destroy();
      }
    }
  }, text, options);
}
