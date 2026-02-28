// similarity.ts — cosine similarity utilities for embedding comparison.

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// Find the highest-scoring node id from a set of candidates.
// Returns null if no candidate meets the threshold.
export function bestMatch(
  queryEmbedding: number[],
  candidates: Array<{ id: string; embedding: number[] }>,
  threshold: number,
): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;

  for (const { id, embedding } of candidates) {
    if (embedding.length === 0) continue;
    const score = cosineSimilarity(queryEmbedding, embedding);
    if (score >= threshold && (!best || score > best.score)) {
      best = { id, score };
    }
  }

  return best;
}
