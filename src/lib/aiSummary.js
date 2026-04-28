/**
 * Optional AI-generated change summaries via the user's own LLM API key.
 * Provider-agnostic: supports the Anthropic native API and any
 * OpenAI-compatible endpoint (NVIDIA NIM, OpenAI, Groq, Together,
 * OpenRouter, local Ollama, etc.).
 *
 * Privacy: the user provides their own key and their own endpoint URL.
 * Fetches go directly from the browser to that endpoint — no PagePulse
 * server is involved. Key is stored in chrome.storage.local and is
 * NEVER synced via chrome.storage.sync.
 *
 * Configuration:
 *   settings.aiSummaryEnabled : boolean
 *   settings.aiProvider       : 'anthropic' | 'openai_compatible'
 *   settings.aiApiKey         : string (kept LOCAL only)
 *   settings.aiApiUrl         : string (full URL to the chat endpoint)
 *   settings.aiModel          : string (model name in provider's namespace)
 */

export const AI_PROVIDERS = Object.freeze({
  ANTHROPIC: 'anthropic',
  OPENAI_COMPATIBLE: 'openai_compatible',
});

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 80;
const DEFAULT_TIMEOUT_MS = 12000;
const TRUNCATE_LEN = 800;

export const DEFAULT_INSTRUCTION =
  'In one sentence, plain English, what meaningfully changed? Skip cosmetic differences. Lead with the most important fact.';

export const PROVIDER_PRESETS = Object.freeze([
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    provider: AI_PROVIDERS.ANTHROPIC,
    apiUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-haiku-4-5-20251001',
    keyHint: 'sk-ant-…',
    notes: 'Pay-per-use. Fast, accurate. ~200 tokens per summary.',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA (free tier)',
    provider: AI_PROVIDERS.OPENAI_COMPATIBLE,
    apiUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    model: 'meta/llama-3.3-70b-instruct',
    keyHint: 'nvapi-…',
    notes: 'Free credits. Get a key at build.nvidia.com.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: AI_PROVIDERS.OPENAI_COMPATIBLE,
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    keyHint: 'sk-…',
    notes: 'Pay-per-use. ~$0.0001 per summary on gpt-4o-mini.',
  },
  {
    id: 'groq',
    label: 'Groq (fast & cheap)',
    provider: AI_PROVIDERS.OPENAI_COMPATIBLE,
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    keyHint: 'gsk_…',
    notes: 'Free tier with generous limits.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (any model)',
    provider: AI_PROVIDERS.OPENAI_COMPATIBLE,
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    keyHint: 'sk-or-…',
    notes: 'Many free models. Pick any model from openrouter.ai.',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    provider: AI_PROVIDERS.OPENAI_COMPATIBLE,
    apiUrl: 'http://localhost:11434/v1/chat/completions',
    model: 'llama3.2',
    keyHint: 'any value (Ollama ignores)',
    notes: '100% local. Run `ollama serve` first.',
  },
]);

function truncate(s, n) {
  if (!s) return '';
  const str = String(s);
  if (str.length <= n) return str;
  return str.substring(0, n - 3) + '...';
}

function isValidApiUrl(u) {
  if (!u || typeof u !== 'string') return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildSummaryPrompt(monitor, change, instruction) {
  const oldText = truncate(change.old, TRUNCATE_LEN);
  const newText = truncate(change.new, TRUNCATE_LEN);
  const trimmed = typeof instruction === 'string' ? instruction.trim() : '';
  const closing = trimmed.length > 0 ? trimmed : DEFAULT_INSTRUCTION;
  return [
    `A webpage I am monitoring titled "${monitor.label}" just changed.`,
    'Old text:',
    '"""',
    oldText,
    '"""',
    'New text:',
    '"""',
    newText,
    '"""',
    closing,
  ].join('\n');
}

export function extractSummaryFromAnthropicResponse(response) {
  if (!response || !Array.isArray(response.content)) return null;
  const parts = response.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string');
  if (parts.length === 0) return null;
  return parts.map((b) => b.text).join(' ').trim() || null;
}

export function extractSummaryFromOpenAIResponse(response) {
  if (!response || !Array.isArray(response.choices) || response.choices.length === 0) return null;
  const msg = response.choices[0]?.message;
  if (!msg || typeof msg.content !== 'string') return null;
  const trimmed = msg.content.trim();
  return trimmed || null;
}

export function isAiEnabled(settings) {
  if (!settings || settings.aiSummaryEnabled !== true) return false;
  if (!settings.aiApiKey || settings.aiApiKey.length === 0) return false;
  const provider = settings.aiProvider;
  return provider === AI_PROVIDERS.ANTHROPIC || provider === AI_PROVIDERS.OPENAI_COMPATIBLE;
}

function buildRequest(provider, prompt, opts) {
  const model = opts.model;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (provider === AI_PROVIDERS.ANTHROPIC) {
    return {
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    };
  }
  // openai_compatible
  return {
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  };
}

function parseResponse(provider, json) {
  if (provider === AI_PROVIDERS.ANTHROPIC) return extractSummaryFromAnthropicResponse(json);
  return extractSummaryFromOpenAIResponse(json);
}

export async function summarizeChange(monitor, change, opts = {}) {
  if (!opts.apiKey) return null;
  if (!isValidApiUrl(opts.apiUrl)) return null;
  const provider = opts.provider === AI_PROVIDERS.ANTHROPIC ? AI_PROVIDERS.ANTHROPIC : AI_PROVIDERS.OPENAI_COMPATIBLE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const prompt = buildSummaryPrompt(monitor, change, opts.instruction);
  const { headers, body } = buildRequest(provider, prompt, opts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(opts.apiUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = await response.json();
    return parseResponse(provider, json);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
