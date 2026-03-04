// background.ts — MV3 service worker.
//
// Acts as a CORS proxy for all Gemini Flash calls.
// Handles two classify modes: full batch on "Analyze", incremental on new messages.
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
  const { geminiApiKey } = await loadSettings();

  if (!geminiApiKey) {
    return {
      ok: false,
      error: 'No Gemini API key set. Open the Chat Organizer extension options to add one.',
    };
  }

  switch (msg.type) {
    case 'BATCH_CLASSIFY':
      return callBatchClassify(msg.messages, geminiApiKey);
    case 'INCREMENTAL_CLASSIFY':
      return callIncrementalClassify(msg.existingClusters, msg.newMessages, geminiApiKey);
    case 'GEMINI_LIST_MODELS':
      return listModels(geminiApiKey);
    default: {
      const _exhaustive: never = msg;
      return { ok: false, error: 'Unknown message type' };
    }
  }
}

// ── Batch classify ────────────────────────────────────────────────────────────

async function callBatchClassify(
  messages: Array<{ index: number; firstSentence: string }>,
  apiKey: string,
): Promise<GeminiResponse> {
  const messageLines = messages
    .map((m) => `[${m.index}] "${m.firstSentence}"`)
    .join('\n');

  const prompt = [
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

  return callFlash(prompt, BATCH_SCHEMA, apiKey, 'BATCH_CLASSIFY');
}

// ── Incremental classify ──────────────────────────────────────────────────────

async function callIncrementalClassify(
  existingClusters: Array<{ label: string; subclusters: Array<{ label: string }> }>,
  newMessages: Array<{ index: number; firstSentence: string }>,
  apiKey: string,
): Promise<GeminiResponse> {
  const outlineLines = existingClusters.map((c, ci) => {
    const header = `Cluster ${ci}: "${c.label}"`;
    const subs = c.subclusters.length
      ? c.subclusters.map((sc, si) => `  Subcluster ${ci}.${si}: "${sc.label}"`).join('\n')
      : '  (flat — no subclusters)';
    return `${header}\n${subs}`;
  }).join('\n');

  const newLines = newMessages
    .map((m) => `[${m.index}] "${m.firstSentence}"`)
    .join('\n');

  const prompt = [
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

  return callFlash(prompt, INCREMENTAL_SCHEMA, apiKey, 'INCREMENTAL_CLASSIFY');
}

// ── Shared Flash caller ───────────────────────────────────────────────────────

async function callFlash(
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
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
    });
  } catch (err) {
    return { ok: false, error: `Flash fetch error: ${err}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Flash API ${res.status}: ${body}` };
  }

  const data = await res.json();
  const rawText: string = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(rawText);
    if (responseType === 'BATCH_CLASSIFY') {
      return { ok: true, type: 'BATCH_CLASSIFY', result: parsed };
    } else {
      return { ok: true, type: 'INCREMENTAL_CLASSIFY', result: parsed };
    }
  } catch (err) {
    console.warn('[Chat Organizer] Flash JSON parse failed —', rawText, err);
    return { ok: false, error: `JSON parse error: ${err}` };
  }
}

// ── JSON schemas for Flash structured output ──────────────────────────────────

const SUBCLUSTER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    label:          { type: 'STRING' },
    messageIndices: { type: 'ARRAY', items: { type: 'INTEGER' } },
  },
  required: ['label', 'messageIndices'],
};

const CLUSTER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    label:          { type: 'STRING' },
    messageIndices: { type: 'ARRAY', items: { type: 'INTEGER' } },
    subclusters:    { type: 'ARRAY', items: SUBCLUSTER_SCHEMA },
  },
  required: ['label', 'messageIndices', 'subclusters'],
};

const BATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    clusters: { type: 'ARRAY', items: CLUSTER_SCHEMA },
  },
  required: ['clusters'],
};

const ASSIGNMENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    messageIndex:    { type: 'INTEGER' },
    clusterLabel:    { type: 'STRING' },
    subclusterLabel: { type: 'STRING' },
  },
  required: ['messageIndex', 'clusterLabel'],
};

const INCREMENTAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    assignments: { type: 'ARRAY', items: ASSIGNMENT_SCHEMA },
  },
  required: ['assignments'],
};

// ── Diagnostic ────────────────────────────────────────────────────────────────

async function listModels(apiKey: string): Promise<GeminiResponse> {
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
