// background.ts — MV3 service worker.
//
// Acts as a CORS proxy for all Gemini API calls.
// Content scripts cannot fetch generativelanguage.googleapis.com directly
// because the request would originate from claude.ai's origin and be blocked.
// By routing through here, the request comes from the extension origin.
//
// Message protocol: see utils/gemini.ts

import type { GeminiRequest, GeminiResponse } from '../utils/gemini';
import { GEMINI_EMBEDDING_URL, GEMINI_FLASH_URL } from '../utils/gemini';
import { loadSettings } from '../utils/storage';

export default defineBackground(() => {
  console.log('[Chat Organizer] Background service worker started.');

  chrome.runtime.onMessage.addListener(
    (msg, _sender, sendResponse) => {
      // Non-Gemini messages handled synchronously
      if (msg?.type === 'OPEN_OPTIONS') {
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
      }

      handleMessage(msg as GeminiRequest)
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: String(err) }));

      // Return true to keep the message channel open for the async response.
      return true;
    },
  );
});

// ── Message dispatch ──────────────────────────────────────────────────────────

async function handleMessage(msg: GeminiRequest): Promise<GeminiResponse> {
  const { geminiApiKey } = await loadSettings();

  if (!geminiApiKey) {
    return {
      ok: false,
      error: 'No Gemini API key set. Open the Chat Organizer extension options to add one.',
    };
  }

  switch (msg.type) {
    case 'GEMINI_EMBED':
      return callEmbedding(msg.text, geminiApiKey);
    case 'GEMINI_LABEL':
      return callLabel(msg.context, msg.existingLabels, geminiApiKey);
    case 'GEMINI_LIST_MODELS':
      return listEmbedModels(geminiApiKey);
    default: {
      const _exhaustive: never = msg;
      return { ok: false, error: `Unknown message type` };
    }
  }
}

// ── Gemini text-embedding-004 ─────────────────────────────────────────────────

async function callEmbedding(text: string, apiKey: string): Promise<GeminiResponse> {
  let res: Response;
  try {
    res = await fetch(`${GEMINI_EMBEDDING_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: 'SEMANTIC_SIMILARITY',
      }),
    });
  } catch (err) {
    return { ok: false, error: `Embedding fetch error: ${err}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Embedding API ${res.status}: ${body}` };
  }

  const data = await res.json();
  const embedding: number[] = data?.embedding?.values ?? [];

  if (embedding.length === 0) {
    return { ok: false, error: 'Embedding API returned empty values array.' };
  }

  return { ok: true, type: 'GEMINI_EMBED', embedding };
}

// ── List available embedding models (diagnostic) ─────────────────────────────

async function listEmbedModels(apiKey: string): Promise<GeminiResponse> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `ListModels ${res.status}: ${body}` };
  }

  const data = await res.json();
  const allModels: string[] = (data.models ?? []).map(
    (m: any) => `${m.name} [${(m.supportedGenerationMethods ?? []).join(',')}]`,
  );

  console.log('[Chat Organizer] All models:', allModels);
  return { ok: true, type: 'GEMINI_LABEL', label: allModels.join(' | ') };
}

// ── Gemini 2.0 Flash (label generation) ──────────────────────────────────────

async function callLabel(
  context: string,
  existingLabels: string[],
  apiKey: string,
): Promise<GeminiResponse> {
  const existingStr = existingLabels.length ? existingLabels.join(', ') : 'none';

  const promptText = [
    'Generate a concise 2–5 word category label for the following conversation topic.',
    'The label should be clearly distinct from existing labels.',
    `Existing labels: ${existingStr}`,
    `Topic text: "${context}"`,
    'Respond ONLY with valid JSON in this exact shape: { "label": "Your Label Here" }',
  ].join('\n');

  let res: Response;
  try {
    res = await fetch(`${GEMINI_FLASH_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
  } catch (err) {
    return { ok: false, error: `Label fetch error: ${err}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `Label API ${res.status}: ${body}` };
  }

  const data = await res.json();
  const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';

  let label = context.slice(0, 40).trim(); // safe fallback
  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed?.label === 'string' && parsed.label.trim()) {
      label = parsed.label.trim();
    }
  } catch {
    // JSON parse failed — fallback label already set above
  }

  return { ok: true, type: 'GEMINI_LABEL', label };
}
