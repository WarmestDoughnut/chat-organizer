// gemini.ts — message contract for content script ↔ background proxy.
// All actual fetch() calls live in background.ts (CORS fix).
// Content scripts call sendToBackground() and await a typed response.

import type { BatchResult, IncrementalResult } from './outline';

// ── Request types ─────────────────────────────────────────────────────────────

export type GeminiRequest =
  | {
      type: 'BATCH_CLASSIFY';
      messages: Array<{ index: number; firstSentence: string }>;
    }
  | {
      type: 'INCREMENTAL_CLASSIFY';
      existingClusters: Array<{ label: string; subclusters: Array<{ label: string }> }>;
      newMessages: Array<{ index: number; firstSentence: string }>;
    }
  | { type: 'GEMINI_LIST_MODELS' };

// ── Response types ────────────────────────────────────────────────────────────

export type GeminiResponse =
  | { ok: true; type: 'BATCH_CLASSIFY';        result: BatchResult }
  | { ok: true; type: 'INCREMENTAL_CLASSIFY';  result: IncrementalResult }
  | { ok: true; type: 'GEMINI_LIST_MODELS';    label: string }
  | { ok: false; error: string };

// ── Typed message sender ──────────────────────────────────────────────────────

export function sendToBackground(req: GeminiRequest): Promise<GeminiResponse> {
  return chrome.runtime.sendMessage(req);
}

// ── API endpoint ──────────────────────────────────────────────────────────────

export const GEMINI_FLASH_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
