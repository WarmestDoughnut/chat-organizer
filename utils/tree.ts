// tree.ts — ConversationIndex types and all tree mutation operations.
// Embeddings are stored in-memory only (Map); everything else is persisted.

// ── Types ─────────────────────────────────────────────────────────────────────

export type NodeRank = 0 | 1 | 2 | 3;

export interface OutlineNode {
  id: string;
  label: string;
  rank: NodeRank;
  children: string[];      // ordered child node ids
  promptIndices: number[]; // indices into ConversationIndex.prompts (leaves only)
  promptCount: number;     // total prompts under this subtree (kept in sync)
  createdAt: number;
  updatedAt: number;
}

export interface PromptRecord {
  index: number;
  fullText: string;
  firstSentence: string;
  hash: string;
}

export interface CacheEntry {
  nodeId: string;
  confidence: number;
}

export interface ConversationIndex {
  conversationId: string;
  prompts: PromptRecord[];
  nodes: Record<string, OutlineNode>;
  embeddings: Map<string, number[]>; // nodeId → float[] — NOT persisted to storage
  cache: Record<string, CacheEntry>; // promptHash → node placement
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createIndex(conversationId: string): ConversationIndex {
  const root: OutlineNode = {
    id: 'root',
    label: 'root',
    rank: 0,
    children: [],
    promptIndices: [],
    promptCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return {
    conversationId,
    prompts: [],
    nodes: { root },
    embeddings: new Map(),
    cache: {},
  };
}

// ── Tree operations ───────────────────────────────────────────────────────────

/**
 * Spawn a new node as a child of parentId.
 * Optionally store its embedding immediately so it's discoverable on next pass.
 */
export function spawnNode(
  index: ConversationIndex,
  parentId: string,
  label: string,
  rank: NodeRank,
  embedding?: number[],
): OutlineNode {
  const id = `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const node: OutlineNode = {
    id,
    label,
    rank,
    children: [],
    promptIndices: [],
    promptCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  index.nodes[id] = node;

  const parent = index.nodes[parentId];
  if (parent) parent.children.push(id);

  if (embedding) index.embeddings.set(id, embedding);

  return node;
}

/**
 * Record that a prompt index lives under a given node.
 * Call updatePromptCounts() after this to propagate counts upward.
 */
export function insertPromptIntoNode(
  index: ConversationIndex,
  nodeId: string,
  promptIndex: number,
): void {
  const node = index.nodes[nodeId];
  if (!node) return;
  if (!node.promptIndices.includes(promptIndex)) {
    node.promptIndices.push(promptIndex);
  }
  node.updatedAt = Date.now();
}

/**
 * Recompute promptCount for every node in the tree.
 * Called after any insert or spawn.
 */
export function updatePromptCounts(index: ConversationIndex): void {
  recountSubtree(index, 'root');
}

function recountSubtree(index: ConversationIndex, nodeId: string): number {
  const node = index.nodes[nodeId];
  if (!node) return 0;

  let total = node.promptIndices.length;
  for (const childId of node.children) {
    total += recountSubtree(index, childId);
  }

  node.promptCount = total;
  return total;
}

/**
 * Return an array of { id, embedding } for all direct children of parentId
 * that have an embedding stored and match the given rank.
 */
export function getChildCandidates(
  index: ConversationIndex,
  parentId: string,
  rank?: NodeRank,
): Array<{ id: string; embedding: number[] }> {
  const parent = index.nodes[parentId];
  if (!parent) return [];

  return parent.children
    .filter((id) => {
      const n = index.nodes[id];
      return n && (rank === undefined || n.rank === rank) && index.embeddings.has(id);
    })
    .map((id) => ({ id, embedding: index.embeddings.get(id)! }));
}

/**
 * Return all nodes that have embeddings (for full-scan escalation).
 */
export function getAllEmbeddedCandidates(
  index: ConversationIndex,
): Array<{ id: string; embedding: number[] }> {
  return [...index.embeddings.entries()].map(([id, embedding]) => ({ id, embedding }));
}
