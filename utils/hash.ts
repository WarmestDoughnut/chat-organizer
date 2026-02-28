// hash.ts — deterministic djb2-variant string hash.
// Used to identify already-processed prompts without re-embedding them.

export function hashPrompt(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    // Math.imul keeps multiplication inside 32-bit int range
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  // Unsigned 32-bit hex — always 8 chars, no negatives
  return (h >>> 0).toString(16).padStart(8, '0');
}
