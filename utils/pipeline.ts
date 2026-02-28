// pipeline.ts — 6-step classification pipeline for a single prompt.
// Called from content.ts for each new assistant message.
//
// Step 1  Hash → cache hit? → done
// Step 2  Embed first sentence
// Step 3  Walk rank-1 headers via cosine similarity (threshold: high)
// Step 4  If rank-1 hit → drill into rank-2 subheaders (threshold: high)
// Step 5  No hit at any level → re-embed full text, scan all nodes (threshold: low)
// Step 6  Still nothing → spawn new rank-1 header via Gemini Flash label

import { hashPrompt } from './hash';
import { bestMatch } from './similarity';
import { sendToBackground } from './gemini';
import {
  type ConversationIndex,
  type NodeRank,
  spawnNode,
  insertPromptIntoNode,
  updatePromptCounts,
  getChildCandidates,
  getAllEmbeddedCandidates,
} from './tree';
import { type Settings } from './storage';

// ── Public API ────────────────────────────────────────────────────────────────

export interface ClassifyResult {
  nodeId: string;
  confidence: number;
  isNewNode: boolean;
}

export interface PromptInput {
  index: number;
  fullText: string;
  firstSentence: string;
}

/**
 * Classify a single prompt into the ConversationIndex tree.
 * Mutates `index` in place (nodes, cache, embeddings).
 * Returns which node the prompt was placed into.
 */
export async function classifyPrompt(
  index: ConversationIndex,
  prompt: PromptInput,
  settings: Settings,
): Promise<ClassifyResult> {
  // ── Step 1: Cache check ───────────────────────────────────────────────────
  const hash = hashPrompt(prompt.fullText);
  const cached = index.cache[hash];
  if (cached) {
    insertPromptIntoNode(index, cached.nodeId, prompt.index);
    updatePromptCounts(index);
    return { ...cached, isNewNode: false };
  }

  // ── Step 2: Embed first sentence (short text → fast + cheap) ─────────────
  const embedRes = await sendToBackground({ type: 'GEMINI_EMBED', text: prompt.firstSentence });
  if (!embedRes.ok) throw new Error(`[pipeline] Embed failed: ${embedRes.error}`);
  const sentenceEmbedding = embedRes.embedding;

  // ── Step 3: Walk rank-1 headers ───────────────────────────────────────────
  const rank1Candidates = getChildCandidates(index, 'root', 1);
  const rank1Hit = bestMatch(sentenceEmbedding, rank1Candidates, settings.thresholdHigh);

  if (rank1Hit) {
    // ── Step 4: Drill into rank-2 subheaders ─────────────────────────────
    const rank2Candidates = getChildCandidates(index, rank1Hit.id, 2);
    const rank2Hit = bestMatch(sentenceEmbedding, rank2Candidates, settings.thresholdHigh);

    if (rank2Hit) {
      return commit(index, hash, rank2Hit.id, rank2Hit.score, false, prompt.index);
    }

    // rank-2 miss — spawn new subheader under the matched header
    const label = await fetchLabel(prompt.firstSentence, index, settings);
    const sub = spawnNode(index, rank1Hit.id, label, 2, sentenceEmbedding);
    return commit(index, hash, sub.id, rank1Hit.score, true, prompt.index);
  }

  // ── Step 5: Escalate — re-embed full text, scan all nodes ─────────────────
  if (Object.keys(index.nodes).length > 1) {
    const fullEmbedRes = await sendToBackground({ type: 'GEMINI_EMBED', text: prompt.fullText });
    if (fullEmbedRes.ok) {
      const allCandidates = getAllEmbeddedCandidates(index);
      const fullHit = bestMatch(fullEmbedRes.embedding, allCandidates, settings.thresholdLow);
      if (fullHit) {
        // Place under the best match; if it's a header (rank 1), spawn a subheader
        const hitNode = index.nodes[fullHit.id];
        if (hitNode && hitNode.rank === 1) {
          const label = await fetchLabel(prompt.firstSentence, index, settings);
          const sub = spawnNode(index, fullHit.id, label, 2, fullEmbedRes.embedding);
          return commit(index, hash, sub.id, fullHit.score, true, prompt.index);
        }
        return commit(index, hash, fullHit.id, fullHit.score, false, prompt.index);
      }
    }
  }

  // ── Step 6: No match — spawn a new rank-1 header ─────────────────────────
  const label = await fetchLabel(prompt.firstSentence, index, settings);
  const header = spawnNode(index, 'root', label, 1, sentenceEmbedding);
  return commit(index, hash, header.id, 0, true, prompt.index);
}

/**
 * Re-embed all existing node labels on page load to populate the in-memory
 * embeddings map. Called once after restoring ConversationIndex from storage.
 * Only makes API calls for nodes that don't already have embeddings.
 */
export async function initializeEmbeddings(
  index: ConversationIndex,
  settings: Settings,
): Promise<void> {
  if (!settings.geminiApiKey) return;

  const needsEmbed = Object.values(index.nodes).filter(
    (n) => n.rank > 0 && !index.embeddings.has(n.id),
  );

  for (const node of needsEmbed) {
    const res = await sendToBackground({ type: 'GEMINI_EMBED', text: node.label });
    if (res.ok) {
      index.embeddings.set(node.id, res.embedding);
    }
  }

  if (needsEmbed.length > 0) {
    console.log(`[Chat Organizer] Re-embedded ${needsEmbed.length} node(s) from storage.`);
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function commit(
  index: ConversationIndex,
  hash: string,
  nodeId: string,
  confidence: number,
  isNewNode: boolean,
  promptIndex: number,
): ClassifyResult {
  insertPromptIntoNode(index, nodeId, promptIndex);
  updatePromptCounts(index);
  index.cache[hash] = { nodeId, confidence };
  return { nodeId, confidence, isNewNode };
}

async function fetchLabel(
  text: string,
  index: ConversationIndex,
  settings: Settings,
): Promise<string> {
  const existingLabels = Object.values(index.nodes)
    .filter((n) => n.rank > 0)
    .map((n) => n.label);

  const res = await sendToBackground({
    type: 'GEMINI_LABEL',
    context: text,
    existingLabels,
  });

  // Graceful fallback: use truncated first sentence if label call fails
  return res.ok ? res.label : text.slice(0, 40).trim();
}
