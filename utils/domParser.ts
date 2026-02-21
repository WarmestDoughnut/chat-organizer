// domParser.ts — scrapes assistant messages from the claude.ai DOM.
// Selectors are listed most-specific first; update them here when claude.ai
// changes its markup (check devtools and look for data-* attributes).

export interface ParsedMessage {
  index: number;
  role: 'user' | 'assistant';
  headingText: string;
  element: Element;
}

// Minimum visible text length (chars) for a message to earn a heading.
// Keeps one-liners like "Sure!" out of the outline.
const MIN_TEXT_LENGTH = 60;

// Ordered list of selectors to locate assistant message containers.
// Each entry is tried in sequence; the first that returns nodes wins.
const ASSISTANT_SELECTORS = [
  '[data-testid="ai-turn"]',
  '[data-testid="assistant-message"]',
  '[data-is-streaming]',
  // Fallback: any article/section whose aria role hints at assistant output
  '[role="presentation"] + [role="presentation"]',
];

// Ordered list of selectors to find the scrollable conversation container
// that the MutationObserver should watch.
const CONTAINER_SELECTORS = [
  '[data-testid="conversation-turn-list"]',
  '[data-testid="virtuoso-item-list"]',
  '[data-testid="chat-messages-container"]',
  'main',
  '[role="main"]',
];

export function findConversationContainer(): Element {
  for (const sel of CONTAINER_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      console.log(`[Chat Organizer] Watching container: "${sel}"`);
      return el;
    }
  }
  console.warn('[Chat Organizer] No conversation container found — falling back to <body>. Check CONTAINER_SELECTORS in domParser.ts.');
  return document.body;
}

export function parseMessages(): ParsedMessage[] {
  let elements: NodeListOf<Element> | null = null;
  let matchedSelector = '';

  for (const sel of ASSISTANT_SELECTORS) {
    const found = document.querySelectorAll(sel);
    if (found.length > 0) {
      elements = found;
      matchedSelector = sel;
      break;
    }
  }

  if (!elements || elements.length === 0) {
    console.warn('[Chat Organizer] No assistant messages found. Check ASSISTANT_SELECTORS in domParser.ts.');
    return [];
  }

  const results: ParsedMessage[] = [];

  elements.forEach((el, index) => {
    const text = extractVisibleText(el);
    if (text.length < MIN_TEXT_LENGTH) return;

    results.push({
      index,
      role: 'assistant',
      headingText: extractFirstSentence(text),
      element: el,
    });
  });

  console.log(`[Chat Organizer] Parsed ${results.length} heading(s) via "${matchedSelector}"`);
  return results;
}

// Walk the element's text nodes rather than using .textContent so that
// block-level elements (p, li, div) contribute a space between them,
// preventing words from being joined across element boundaries.
function extractVisibleText(el: Element): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const val = node.nodeValue?.trim();
    if (val) parts.push(val);
  }
  return parts.join(' ');
}

// Phrases that make poor headings — if the first sentence starts with one
// of these, we skip to the next sentence instead.
const FILLER_PREFIXES: RegExp[] = [
  /^i need to\b/i,
  /^i see (the|that|you)\b/i,
  /^let me\b/i,
];

function extractFirstSentence(text: string): string {
  // Strip common markdown artifacts that leak into .textContent
  const cleaned = text
    .replace(/^#{1,6}\s+/m, '')                   // leading ATX headings
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')      // bold / italic
    .replace(/`[^`]+`/g, '')                       // inline code
    .trim();

  // Split into sentences on sentence-ending punctuation followed by whitespace.
  // Filter out fragments shorter than 15 chars ("Ok." etc.).
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15);

  // Walk sentences, skipping filler openers, and return the first good one.
  const chosen =
    sentences.find((s) => !FILLER_PREFIXES.some((re) => re.test(s))) ??
    sentences[0] ??
    cleaned;

  // Hard cap at 120 chars with ellipsis
  return chosen.length > 120 ? chosen.slice(0, 117) + '…' : chosen;
}
