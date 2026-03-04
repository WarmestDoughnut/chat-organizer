// outline.ts — data structures for the v2 batch-classify approach.
// No embeddings, no cache, no rank system.
// Flash owns clustering; we own rendering and navigation.

export interface MessageRecord {
  index: number;         // DOM position — used for scrollIntoView
  firstSentence: string; // display text for sidebar leaf items
}

export interface SubCluster {
  id: string;
  label: string;
  messageIndices: number[];
}

export interface Cluster {
  id: string;
  label: string;
  subclusters: SubCluster[];   // empty = flat cluster
  messageIndices: number[];    // direct messages (only used when subclusters is empty)
}

export interface ConversationOutline {
  conversationId: string;
  clusters: Cluster[];
  messages: Record<number, MessageRecord>; // index → display record
  analyzedIndices: number[];               // which message indices Flash has seen
}

export function createOutline(conversationId: string): ConversationOutline {
  return {
    conversationId,
    clusters: [],
    messages: {},
    analyzedIndices: [],
  };
}

// ── Raw shapes returned by Flash (before we assign ids) ──────────────────────

export interface RawSubCluster {
  label: string;
  messageIndices: number[];
}

export interface RawCluster {
  label: string;
  messageIndices: number[];
  subclusters: RawSubCluster[];
}

export interface BatchResult {
  clusters: RawCluster[];
}

export interface IncrementalAssignment {
  messageIndex: number;
  clusterLabel: string;
  subclusterLabel?: string; // omitted for flat clusters
}

export interface IncrementalResult {
  assignments: IncrementalAssignment[];
}
