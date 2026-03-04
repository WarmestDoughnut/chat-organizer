// storage.ts — chrome.storage.local helpers.
// Stores the conversation outline (clusters/subclusters/messages) and settings.
// No embeddings — those lived in v1 and are gone.

import type { Cluster, MessageRecord } from './outline';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoredConversation {
  conversationId: string;
  clusters: Cluster[];
  messages: Record<number, MessageRecord>;
  analyzedIndices: number[];
}

export interface Settings {
  geminiApiKey: string;
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
};

export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...patch } });
}
