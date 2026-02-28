// storage.ts — chrome.storage.local helpers.
// NOTE: embeddings are NOT stored here — only tree structure and cache.
// Embeddings are re-computed in-memory on page load via initializeEmbeddings().

import type { OutlineNode, PromptRecord, CacheEntry } from './tree';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoredConversation {
  conversationId: string;
  prompts: PromptRecord[];
  nodes: Record<string, OutlineNode>;
  cache: Record<string, CacheEntry>;
}

export interface Settings {
  geminiApiKey: string;
  thresholdHigh: number; // cosine similarity for confident match (default 0.8)
  thresholdLow: number;  // cosine similarity for escalation cutoff (default 0.5)
}

// ── Keys ──────────────────────────────────────────────────────────────────────

const CONV_PREFIX = 'co_conv_';
const SETTINGS_KEY = 'co_settings';

// ── Conversation storage ──────────────────────────────────────────────────────

export async function loadConversation(conversationId: string): Promise<StoredConversation | null> {
  const key = CONV_PREFIX + conversationId;
  const result = await chrome.storage.local.get(key);
  return (result[key] as StoredConversation) ?? null;
}

export async function saveConversation(stored: StoredConversation): Promise<void> {
  const key = CONV_PREFIX + stored.conversationId;
  await chrome.storage.local.set({ [key]: stored });
}

// ── Settings storage ──────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  geminiApiKey: '',
  thresholdHigh: 0.8,
  thresholdLow: 0.5,
};

export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...patch } });
}
