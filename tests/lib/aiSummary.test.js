import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildSummaryPrompt,
  extractSummaryFromAnthropicResponse,
  extractSummaryFromOpenAIResponse,
  summarizeChange,
  isAiEnabled,
  AI_PROVIDERS,
  PROVIDER_PRESETS,
  DEFAULT_INSTRUCTION,
} from '../../src/lib/aiSummary.js';

describe('aiSummary', () => {
  describe('buildSummaryPrompt', () => {
    it('produces a single-line prompt with monitor label, old, and new', () => {
      const monitor = { label: 'Job postings', url: 'https://x.com' };
      const change = { old: 'no listings', new: 'Senior Engineer' };
      const prompt = buildSummaryPrompt(monitor, change);
      expect(prompt).toContain('Job postings');
      expect(prompt).toContain('no listings');
      expect(prompt).toContain('Senior Engineer');
      expect(prompt.toLowerCase()).toContain('one sentence');
    });

    it('truncates very long old/new values to keep token cost bounded', () => {
      const monitor = { label: 'L', url: 'u' };
      const longText = 'x'.repeat(5000);
      const prompt = buildSummaryPrompt(monitor, { old: longText, new: longText });
      expect(prompt.length).toBeLessThan(3000);
    });

    it('uses DEFAULT_INSTRUCTION when no custom instruction is given', () => {
      const monitor = { label: 'L', url: 'u' };
      const change = { old: 'a', new: 'b' };
      const prompt = buildSummaryPrompt(monitor, change);
      expect(prompt).toContain(DEFAULT_INSTRUCTION);
    });

    it('falls back to DEFAULT_INSTRUCTION when instruction is empty string', () => {
      const monitor = { label: 'L', url: 'u' };
      const prompt = buildSummaryPrompt(monitor, { old: 'a', new: 'b' }, '');
      expect(prompt).toContain(DEFAULT_INSTRUCTION);
    });

    it('falls back to DEFAULT_INSTRUCTION when instruction is whitespace only', () => {
      const monitor = { label: 'L', url: 'u' };
      const prompt = buildSummaryPrompt(monitor, { old: 'a', new: 'b' }, '   \n\t  ');
      expect(prompt).toContain(DEFAULT_INSTRUCTION);
    });

    it('replaces the closing instruction with the custom one', () => {
      const monitor = { label: 'L', url: 'u' };
      const custom = 'Output the new price in dollars only.';
      const prompt = buildSummaryPrompt(monitor, { old: 'a', new: 'b' }, custom);
      expect(prompt).toContain(custom);
      expect(prompt).not.toContain(DEFAULT_INSTRUCTION);
      // Boilerplate framing must remain.
      expect(prompt).toContain('A webpage I am monitoring titled "L"');
      expect(prompt).toContain('Old text:');
      expect(prompt).toContain('New text:');
    });

    it('exports DEFAULT_INSTRUCTION matching the historical wording', () => {
      expect(DEFAULT_INSTRUCTION).toContain('one sentence');
      expect(DEFAULT_INSTRUCTION).toContain('plain English');
      expect(DEFAULT_INSTRUCTION).toContain('most important fact');
    });
  });

  describe('extractSummaryFromAnthropicResponse', () => {
    it('returns the text content from a well-formed response', () => {
      expect(extractSummaryFromAnthropicResponse({ content: [{ type: 'text', text: 'Hi.' }] })).toBe('Hi.');
    });
    it('joins multiple text blocks with a space', () => {
      expect(extractSummaryFromAnthropicResponse({ content: [{ type: 'text', text: 'A new posting' }, { type: 'text', text: 'appeared.' }] })).toBe('A new posting appeared.');
    });
    it('skips non-text content blocks', () => {
      expect(extractSummaryFromAnthropicResponse({ content: [{ type: 'tool_use', id: 'x' }, { type: 'text', text: 'Hello.' }] })).toBe('Hello.');
    });
    it('returns null for malformed responses', () => {
      expect(extractSummaryFromAnthropicResponse(null)).toBeNull();
      expect(extractSummaryFromAnthropicResponse({})).toBeNull();
      expect(extractSummaryFromAnthropicResponse({ content: [] })).toBeNull();
    });
  });

  describe('extractSummaryFromOpenAIResponse', () => {
    it('returns choices[0].message.content from a chat completion', () => {
      const r = { choices: [{ message: { role: 'assistant', content: 'Senior role posted.' } }] };
      expect(extractSummaryFromOpenAIResponse(r)).toBe('Senior role posted.');
    });
    it('returns null for empty choices', () => {
      expect(extractSummaryFromOpenAIResponse({ choices: [] })).toBeNull();
      expect(extractSummaryFromOpenAIResponse({})).toBeNull();
      expect(extractSummaryFromOpenAIResponse(null)).toBeNull();
    });
    it('returns null when message content is missing', () => {
      expect(extractSummaryFromOpenAIResponse({ choices: [{ message: {} }] })).toBeNull();
    });
    it('strips leading/trailing whitespace', () => {
      const r = { choices: [{ message: { content: '   summary text   ' } }] };
      expect(extractSummaryFromOpenAIResponse(r)).toBe('summary text');
    });
  });

  describe('isAiEnabled', () => {
    it('returns true when flag is on, key is set, provider is set', () => {
      expect(isAiEnabled({ aiSummaryEnabled: true, aiApiKey: 'sk', aiProvider: AI_PROVIDERS.OPENAI_COMPATIBLE })).toBe(true);
      expect(isAiEnabled({ aiSummaryEnabled: true, aiApiKey: 'sk', aiProvider: AI_PROVIDERS.ANTHROPIC })).toBe(true);
    });
    it('returns false if flag off', () => {
      expect(isAiEnabled({ aiSummaryEnabled: false, aiApiKey: 'sk', aiProvider: AI_PROVIDERS.ANTHROPIC })).toBe(false);
    });
    it('returns false if key missing', () => {
      expect(isAiEnabled({ aiSummaryEnabled: true, aiApiKey: '', aiProvider: AI_PROVIDERS.ANTHROPIC })).toBe(false);
    });
    it('returns false for unknown provider', () => {
      expect(isAiEnabled({ aiSummaryEnabled: true, aiApiKey: 'sk', aiProvider: 'unknown' })).toBe(false);
    });
  });

  describe('PROVIDER_PRESETS', () => {
    it('exposes a preset for each known provider with default url + model + label', () => {
      const presets = PROVIDER_PRESETS;
      expect(Array.isArray(presets)).toBe(true);
      expect(presets.length).toBeGreaterThanOrEqual(4);
      for (const p of presets) {
        expect(p.id).toBeTruthy();
        expect(p.label).toBeTruthy();
        expect(p.provider).toMatch(/anthropic|openai_compatible/);
        expect(p.apiUrl).toMatch(/^https?:\/\//);
        expect(p.model).toBeTruthy();
      }
      const ids = presets.map((p) => p.id);
      expect(ids).toContain('anthropic');
      expect(ids).toContain('nvidia');
      expect(ids).toContain('openai');
    });
  });

  describe('summarizeChange — Anthropic provider', () => {
    let fetchSpy;
    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: 'Anthropic summary.' }] }),
      });
      global.fetch = fetchSpy;
    });

    it('calls Anthropic endpoint with x-api-key + anthropic-version headers', async () => {
      await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.ANTHROPIC,
        apiKey: 'sk-ant-test',
        apiUrl: 'https://api.anthropic.com/v1/messages',
        model: 'claude-haiku-4-5-20251001',
      });
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(opts.headers['x-api-key']).toBe('sk-ant-test');
      expect(opts.headers['anthropic-version']).toBe('2023-06-01');
      expect(opts.headers['authorization']).toBeUndefined();
      const body = JSON.parse(opts.body);
      expect(body.model).toBe('claude-haiku-4-5-20251001');
      expect(body.messages[0].role).toBe('user');
    });

    it('returns the parsed Anthropic summary', async () => {
      const out = await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.ANTHROPIC, apiKey: 'sk', apiUrl: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-4-5',
      });
      expect(out).toBe('Anthropic summary.');
    });

    it('passes opts.instruction through to the request body user message', async () => {
      const customInstruction = 'Output the new price in dollars ONLY.';
      await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.ANTHROPIC,
        apiKey: 'sk',
        apiUrl: 'https://api.anthropic.com/v1/messages',
        model: 'claude-haiku-4-5',
        instruction: customInstruction,
      });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain(customInstruction);
      expect(body.messages[0].content).not.toContain(DEFAULT_INSTRUCTION);
    });
  });

  describe('summarizeChange — OpenAI-compatible provider (NVIDIA / OpenAI / Groq / etc.)', () => {
    let fetchSpy;
    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: 'assistant', content: 'NVIDIA summary.' } }] }),
      });
      global.fetch = fetchSpy;
    });

    it('calls the configured URL with Authorization: Bearer <key>', async () => {
      await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.OPENAI_COMPATIBLE,
        apiKey: 'nvapi-test',
        apiUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
        model: 'meta/llama-3.3-70b-instruct',
      });
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
      expect(opts.headers['authorization']).toBe('Bearer nvapi-test');
      expect(opts.headers['x-api-key']).toBeUndefined();
      const body = JSON.parse(opts.body);
      expect(body.model).toBe('meta/llama-3.3-70b-instruct');
      expect(body.messages[0].role).toBe('user');
    });

    it('returns the parsed OpenAI-format summary', async () => {
      const out = await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.OPENAI_COMPATIBLE, apiKey: 'k', apiUrl: 'https://x/v1/chat/completions', model: 'm',
      });
      expect(out).toBe('NVIDIA summary.');
    });

    it('works for OpenAI itself with same OPENAI_COMPATIBLE provider', async () => {
      await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.OPENAI_COMPATIBLE, apiKey: 'sk-x', apiUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini',
      });
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(opts.headers['authorization']).toBe('Bearer sk-x');
    });
  });

  describe('summarizeChange — error handling (provider-independent)', () => {
    let fetchSpy;
    beforeEach(() => {
      fetchSpy = vi.fn();
      global.fetch = fetchSpy;
    });

    it('returns null on a 4xx/5xx response', async () => {
      fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
      const result = await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.OPENAI_COMPATIBLE, apiKey: 'sk', apiUrl: 'https://x/v1/chat/completions', model: 'm',
      });
      expect(result).toBeNull();
    });

    it('returns null on network failure', async () => {
      fetchSpy.mockRejectedValue(new Error('network'));
      const result = await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.ANTHROPIC, apiKey: 'sk', apiUrl: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-4-5',
      });
      expect(result).toBeNull();
    });

    it('returns null when apiKey is missing', async () => {
      const result = await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.OPENAI_COMPATIBLE, apiKey: '', apiUrl: 'https://x', model: 'm',
      });
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns null when apiUrl is missing or invalid', async () => {
      const result1 = await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.OPENAI_COMPATIBLE, apiKey: 'sk', apiUrl: '', model: 'm',
      });
      const result2 = await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.OPENAI_COMPATIBLE, apiKey: 'sk', apiUrl: 'javascript:alert(1)', model: 'm',
      });
      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts via AbortController on timeout (any provider)', async () => {
      let signalSeen = null;
      fetchSpy.mockImplementation((url, opts) => {
        signalSeen = opts.signal;
        return new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      });
      const result = await summarizeChange({ label: 'L', url: 'u' }, { old: 'o', new: 'n' }, {
        provider: AI_PROVIDERS.OPENAI_COMPATIBLE, apiKey: 'sk', apiUrl: 'https://x/v1/chat/completions', model: 'm', timeoutMs: 10,
      });
      expect(result).toBeNull();
      expect(signalSeen.aborted).toBe(true);
    });
  });
});
