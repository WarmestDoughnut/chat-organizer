// gemini.ts — message contract for content script ↔ background proxy.
// All actual fetch() calls live in background.ts (CORS fix).
// Content scripts call sendToBackground() and await a typed response.

// ── Request types ─────────────────────────────────────────────────────────────

export type GeminiRequest =
  | { type: 'GEMINI_EMBED'; text: string }
  | { type: 'GEMINI_LABEL'; context: string; existingLabels: string[] }
  | { type: 'GEMINI_LIST_MODELS' };

// ── Response types ────────────────────────────────────────────────────────────

export type GeminiResponse =
  | { ok: true;  type: 'GEMINI_EMBED'; embedding: number[] }
  | { ok: true;  type: 'GEMINI_LABEL'; label: string }
  | { ok: false; error: string };

// ── Typed message sender ──────────────────────────────────────────────────────

export function sendToBackground(req: GeminiRequest): Promise<GeminiResponse> {
  return chrome.runtime.sendMessage(req);
}

// ── API endpoints (consumed by background.ts) ─────────────────────────────────

export const GEMINI_EMBEDDING_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

export const GEMINI_FLASH_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
