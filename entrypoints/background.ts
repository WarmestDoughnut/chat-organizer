// background.ts — MV3 service worker.
//
// Acts as a CORS proxy for all AI provider calls (Gemini Flash or Ollama).
// Handles two classify modes: full batch on "Analyze", incremental on new messages.
// Provider is selected in settings; both share the same message protocol.
//
// Message protocol: see utils/gemini.ts

import type { GeminiRequest, GeminiResponse } from '../utils/gemini';
import { GEMINI_FLASH_URL } from '../utils/gemini';
import { loadSettings } from '../utils/storage';

export default defineBackground(() => {
  console.log('[Chat Organizer] Background service worker started.');

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'OPEN_OPTIONS') {
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return;
    }

    handleMessage(msg as GeminiRequest)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err) }));

    return true; // keep channel open for async response
  });
});

// ── Dispatch ──────────────────────────────────────────────────────────────────

async function handleMessage(msg: GeminiRequest): Promise<GeminiResponse> {
  const settings = await loadSettings();

  switch (msg.type) {
    case 'BATCH_CLASSIFY':
      return settings.provider === 'ollama'
        ? callOllamaBatch(msg.messages, settings.ollamaModel, settings.ollamaUrl)
        : callGeminiBatch(msg.messages, settings.geminiApiKey);

    case 'INCREMENTAL_CLASSIFY':
      return settings.provider === 'ollama'
        ? callOllamaIncremental(msg.existingClusters, msg.newMessages, settings.ollamaModel, settings.ollamaUrl)
        : callGeminiIncremental(msg.existingClusters, msg.newMessages, settings.geminiApiKey);

    case 'GEMINI_LIST_MODELS':
      return listGeminiModels(settings.geminiApiKey);

    default: {
      const _exhaustive: never = msg;
      return { ok: false, error: 'Unknown message type' };
    }
  }
}

// ── Shared prompt builders ────────────────────────────────────────────────────

function buildBatchPrompt(messages: Array<{ index: number; text: string }>): string {
  const messageLines = messages.map((m) => `[${m.index}] "${m.text}"`).join('\n');
  return [
    'You are a conversation topic organiser.',
    'Below are assistant messages from a chat, each labelled with its index number.',
    'Group them into 2–7 topic clusters.',
    'Only add subclusters when a cluster has 4 or more messages AND those messages',
    'clearly split into distinct subtopics. Flat clusters (no subclusters) are preferred',
    'for small or tightly focused topics.',
    'Cluster and subcluster labels must be concise 2–5 word noun phrases, Title Case,',
    'no punctuation. Every message index must appear exactly once in the output.',
    '',
    'Messages:',
    messageLines,
  ].join('\n');
}

function buildIncrementalPrompt(
  existingClusters: Array<{ label: string; example?: string; subclusters: Array<{ label: string; example?: string }> }>,
  newMessages: Array<{ index: number; text: string }>,
): string {
  const outlineLines = existingClusters.map((c, ci) => {
    const header = `Cluster ${ci}: "${c.label}"${c.example ? ` — e.g. "${c.example}"` : ''}`;
    const subs = c.subclusters.length
      ? c.subclusters.map((sc, si) =>
          `  Subcluster ${ci}.${si}: "${sc.label}"${sc.example ? ` — e.g. "${sc.example}"` : ''}`
        ).join('\n')
      : '  (flat — no subclusters)';
    return `${header}\n${subs}`;
  }).join('\n');
  const newLines = newMessages.map((m) => `[${m.index}] "${m.text}"`).join('\n');
  return [
    'You are adding new messages to an existing conversation outline.',
    'Assign each new message to the most fitting existing cluster and subcluster.',
    'If no existing cluster fits, create a new one with a 2–5 word noun-phrase label.',
    'If a message is assigned to a cluster that has existing subclusters, you must',
    'also provide a subclusterLabel (existing or new).',
    'If a message is assigned to a flat cluster (no subclusters), omit subclusterLabel.',
    'Labels: Title Case, no punctuation.',
    '',
    'Existing outline:',
    outlineLines,
    '',
    'New messages to classify:',
    newLines,
  ].join('\n');
}

// ── Gemini Flash ──────────────────────────────────────────────────────────────

async function callGeminiBatch(
  messages: Array<{ index: number; text: string }>,
  apiKey: string,
): Promise<GeminiResponse> {
  if (!apiKey) return { ok: false, error: 'No Gemini API key set. Open Settings to add one.' };
  return callGeminiFlash(buildBatchPrompt(messages), GEMINI_BATCH_SCHEMA, apiKey, 'BATCH_CLASSIFY');
}

async function callGeminiIncremental(
  existingClusters: Array<{ label: string; subclusters: Array<{ label: string }> }>,
  newMessages: Array<{ index: number; text: string }>,
  apiKey: string,
): Promise<GeminiResponse> {
  if (!apiKey) return { ok: false, error: 'No Gemini API key set. Open Settings to add one.' };
  return callGeminiFlash(
    buildIncrementalPrompt(existingClusters, newMessages),
    GEMINI_INCREMENTAL_SCHEMA,
    apiKey,
    'INCREMENTAL_CLASSIFY',
  );
}

// Gemini requires uppercase type names in its schema
const GEMINI_BATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    clusters: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label:          { type: 'STRING' },
          messageIndices: { type: 'ARRAY', items: { type: 'INTEGER' } },
          subclusters: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                label:          { type: 'STRING' },
                messageIndices: { type: 'ARRAY', items: { type: 'INTEGER' } },
              },
              required: ['label', 'messageIndices'],
            },
          },
        },
        required: ['label', 'messageIndices', 'subclusters'],
      },
    },
  },
  required: ['clusters'],
};

const GEMINI_INCREMENTAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    assignments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          messageIndex:    { type: 'INTEGER' },
          clusterLabel:    { type: 'STRING' },
          subclusterLabel: { type: 'STRING' },
        },
        required: ['messageIndex', 'clusterLabel'],
      },
    },
  },
  required: ['assignments'],
};

async function callGeminiFlash(
  promptText: string,
  schema: object,
  apiKey: string,
  responseType: 'BATCH_CLASSIFY' | 'INCREMENTAL_CLASSIFY',
): Promise<GeminiResponse> {
  let res: Response;
  try {
    res = await fetch(`${GEMINI_FLASH_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
      }),
    });
  } catch (err) {
    return { ok: false, error: `Gemini fetch error: ${err}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Gemini API ${res.status}: ${body}` };
  }
  const data = await res.json();
  const rawText: string = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  return parseClassifyResponse(rawText, responseType);
}

// ── Ollama ────────────────────────────────────────────────────────────────────

const OLLAMA_BATCH_SCHEMA = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label:          { type: 'string' },
          messageIndices: { type: 'array', items: { type: 'integer' } },
          subclusters: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label:          { type: 'string' },
                messageIndices: { type: 'array', items: { type: 'integer' } },
              },
              required: ['label', 'messageIndices'],
            },
          },
        },
        required: ['label', 'messageIndices', 'subclusters'],
      },
    },
  },
  required: ['clusters'],
};

const OLLAMA_INCREMENTAL_SCHEMA = {
  type: 'object',
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          messageIndex:    { type: 'integer' },
          clusterLabel:    { type: 'string' },
          subclusterLabel: { type: 'string' },
        },
        required: ['messageIndex', 'clusterLabel'],
      },
    },
  },
  required: ['assignments'],
};

async function callOllamaBatch(
  messages: Array<{ index: number; text: string }>,
  model: string,
  baseUrl: string,
): Promise<GeminiResponse> {
  return callOllama(buildBatchPrompt(messages), OLLAMA_BATCH_SCHEMA, model, baseUrl, 'BATCH_CLASSIFY');
}

async function callOllamaIncremental(
  existingClusters: Array<{ label: string; subclusters: Array<{ label: string }> }>,
  newMessages: Array<{ index: number; text: string }>,
  model: string,
  baseUrl: string,
): Promise<GeminiResponse> {
  return callOllama(
    buildIncrementalPrompt(existingClusters, newMessages),
    OLLAMA_INCREMENTAL_SCHEMA,
    model,
    baseUrl,
    'INCREMENTAL_CLASSIFY',
  );
}

async function callOllama(
  promptText: string,
  schema: object,
  model: string,
  baseUrl: string,
  responseType: 'BATCH_CLASSIFY' | 'INCREMENTAL_CLASSIFY',
): Promise<GeminiResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: promptText, format: schema, stream: false }),
    });
  } catch (err) {
    return { ok: false, error: `Ollama fetch error: ${err}. Is Ollama running?` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Ollama ${res.status}: ${body}` };
  }
  const data = await res.json();
  return parseClassifyResponse((data?.response ?? '{}').trim(), responseType);
}

// ── Shared response parser ────────────────────────────────────────────────────

function parseClassifyResponse(
  rawText: string,
  responseType: 'BATCH_CLASSIFY' | 'INCREMENTAL_CLASSIFY',
): GeminiResponse {
  try {
    const parsed = JSON.parse(rawText);
    return responseType === 'BATCH_CLASSIFY'
      ? { ok: true, type: 'BATCH_CLASSIFY', result: parsed }
      : { ok: true, type: 'INCREMENTAL_CLASSIFY', result: parsed };
  } catch (err) {
    console.warn('[Chat Organizer] JSON parse failed —', rawText, err);
    return { ok: false, error: `JSON parse error: ${err}` };
  }
}

// ── Diagnostic ────────────────────────────────────────────────────────────────

async function listGeminiModels(apiKey: string): Promise<GeminiResponse> {
  if (!apiKey) return { ok: false, error: 'No Gemini API key set.' };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `ListModels ${res.status}: ${body}` };
  }
  const data = await res.json();
  const models: string[] = (data.models ?? []).map(
    (m: any) => `${m.name} [${(m.supportedGenerationMethods ?? []).join(',')}]`,
  );
  console.log('[Chat Organizer] All models:', models);
  return { ok: true, type: 'GEMINI_LIST_MODELS', label: models.join(' | ') };
}
