// classify.ts — two-mode classification using Gemini Flash.
//
// batchClassify()       — called on "Analyze": sends all messages at once,
//                         builds a fresh ConversationOutline from scratch.
//
// incrementalClassify() — called when new messages arrive: sends only the
//                         existing cluster labels + new message texts,
//                         merges assignments back into the existing outline.

import { sendToBackground } from './gemini';
import {
  createOutline,
  type ConversationOutline,
  type Cluster,
  type SubCluster,
} from './outline';
import type { ParsedMessage } from './domParser';

// ── Batch ─────────────────────────────────────────────────────────────────────

export async function batchClassify(
  messages: ParsedMessage[],
  conversationId: string,
): Promise<ConversationOutline> {
  const res = await sendToBackground({
    type: 'BATCH_CLASSIFY',
    messages: messages.map((m) => ({ index: m.index, firstSentence: m.headingText })),
  });

  if (!res.ok) throw new Error(`[classify] Batch failed: ${res.error}`);

  const outline = createOutline(conversationId);

  // Register all messages
  for (const m of messages) {
    outline.messages[m.index] = { index: m.index, firstSentence: m.headingText };
    outline.analyzedIndices.push(m.index);
  }

  // Build clusters from Flash result
  for (let ci = 0; ci < res.result.clusters.length; ci++) {
    const raw = res.result.clusters[ci];
    const cluster: Cluster = {
      id: `c${ci}`,
      label: raw.label,
      subclusters: raw.subclusters.map((sc, si) => ({
        id: `c${ci}s${si}`,
        label: sc.label,
        messageIndices: [...sc.messageIndices],
      })),
      messageIndices: [...raw.messageIndices],
    };
    outline.clusters.push(cluster);
  }

  return outline;
}

// ── Incremental ───────────────────────────────────────────────────────────────

export async function incrementalClassify(
  outline: ConversationOutline,
  newMessages: ParsedMessage[],
): Promise<void> {
  const res = await sendToBackground({
    type: 'INCREMENTAL_CLASSIFY',
    existingClusters: outline.clusters.map((c) => ({
      label: c.label,
      subclusters: c.subclusters.map((sc) => ({ label: sc.label })),
    })),
    newMessages: newMessages.map((m) => ({ index: m.index, firstSentence: m.headingText })),
  });

  if (!res.ok) throw new Error(`[classify] Incremental failed: ${res.error}`);

  for (const assignment of res.result.assignments) {
    const { messageIndex, clusterLabel, subclusterLabel } = assignment;

    // Register message
    const msg = newMessages.find((m) => m.index === messageIndex);
    if (msg) {
      outline.messages[messageIndex] = { index: messageIndex, firstSentence: msg.headingText };
    }

    // Find or create cluster (matched by label)
    let cluster = outline.clusters.find((c) => c.label === clusterLabel);
    if (!cluster) {
      cluster = {
        id: `c${outline.clusters.length}`,
        label: clusterLabel,
        subclusters: [],
        messageIndices: [],
      };
      outline.clusters.push(cluster);
    }

    if (subclusterLabel) {
      // Find or create subcluster
      let sub = cluster.subclusters.find((sc) => sc.label === subclusterLabel);
      if (!sub) {
        sub = {
          id: `${cluster.id}s${cluster.subclusters.length}`,
          label: subclusterLabel,
          messageIndices: [],
        } as SubCluster;
        cluster.subclusters.push(sub);
      }
      if (!sub.messageIndices.includes(messageIndex)) {
        sub.messageIndices.push(messageIndex);
      }
    } else {
      // Flat assignment
      if (!cluster.messageIndices.includes(messageIndex)) {
        cluster.messageIndices.push(messageIndex);
      }
    }

    outline.analyzedIndices.push(messageIndex);
  }
}
