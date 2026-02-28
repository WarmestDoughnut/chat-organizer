// content.ts — injected into claude.ai.
// Responsibilities:
//   1. Inject the sidebar shell via Shadow DOM
//   2. Restore ConversationIndex from storage on page load
//   3. Re-embed existing node labels (populate in-memory embeddings map)
//   4. Watch DOM for new assistant messages via MutationObserver
//   5. Run each new message through the classification pipeline (async)
//   6. Re-render the hierarchical sidebar tree after each classification
//   7. Persist updated index to chrome.storage.local after each change

import sidebarCss from '../assets/sidebar.css?inline';
import {
  parseMessages,
  findConversationContainer,
  type ParsedMessage,
} from '../utils/domParser';
import {
  createIndex,
  type ConversationIndex,
  type OutlineNode,
} from '../utils/tree';
import { classifyPrompt, initializeEmbeddings } from '../utils/pipeline';
import { loadSettings, loadConversation, saveConversation, type Settings } from '../utils/storage';
import { hashPrompt } from '../utils/hash';

export default defineContentScript({
  matches: ['https://claude.ai/*'],

  async main() {
    console.log('[Chat Organizer] Content script loaded on', window.location.href);

    if (document.getElementById('chat-organizer-host')) return;

    // ── Shadow DOM host ───────────────────────────────────────────────────────
    const host = document.createElement('div');
    host.id = 'chat-organizer-host';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = sidebarCss;
    shadow.appendChild(styleEl);

    // ── Sidebar shell ─────────────────────────────────────────────────────────
    const sidebar = document.createElement('div');
    sidebar.className = 'sidebar';

    const header = document.createElement('div');
    header.className = 'sidebar__header';

    const titleEl = document.createElement('span');
    titleEl.className = 'sidebar__title';
    titleEl.textContent = 'Chat Outline';

    const toggle = document.createElement('button');
    toggle.className = 'sidebar__toggle';
    toggle.setAttribute('aria-label', 'Collapse sidebar');
    toggle.textContent = '▶';

    header.appendChild(titleEl);
    header.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'sidebar__body';

    sidebar.appendChild(header);
    sidebar.appendChild(body);
    shadow.appendChild(sidebar);

    // ── Collapse toggle ───────────────────────────────────────────────────────
    let collapsed = false;
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      sidebar.classList.toggle('sidebar--collapsed', collapsed);
      toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      toggle.textContent = collapsed ? '◀' : '▶';
    });

    // ── Conversation state ────────────────────────────────────────────────────
    const conversationId = extractConversationId();
    let settings: Settings;
    let index: ConversationIndex;

    // Load settings first so we know if an API key is configured
    settings = await loadSettings();

    // Restore tree from storage
    const stored = await loadConversation(conversationId);
    if (stored) {
      index = createIndex(conversationId);
      index.nodes = stored.nodes;
      index.cache = stored.cache;
      index.prompts = stored.prompts;
      console.log(
        `[Chat Organizer] Restored ${Object.keys(stored.nodes).length - 1} node(s) from storage.`,
      );
    } else {
      index = createIndex(conversationId);
    }

    // Show what we have immediately (may be empty on first visit)
    renderTree();

    // Bail early with a hint if no API key is configured
    if (!settings.geminiApiKey) {
      showNoKeyPlaceholder();
      return;
    }

    // Diagnostic: log available embedding models so we can fix the model name if 404
    chrome.runtime.sendMessage({ type: 'GEMINI_LIST_MODELS' }).then((res) => {
      if (res?.ok) console.log('[Chat Organizer] Available embedding models:', res.label);
      else console.warn('[Chat Organizer] ListModels failed:', res?.error);
    });

    // Re-embed existing node labels so cosine-search works for new prompts
    // (embeddings are not persisted — only labels are stored)
    initializeEmbeddings(index, settings).catch((err) =>
      console.warn('[Chat Organizer] Embedding init error:', err),
    );

    // ── Processed-index tracking ──────────────────────────────────────────────
    // Track which message indices have already been classified to avoid duplicates.
    const processedHashes = new Set<string>(Object.keys(index.cache));
    let processingQueue: ParsedMessage[] = [];
    let isProcessing = false;

    // ── Queue processor ───────────────────────────────────────────────────────
    async function drainQueue() {
      if (isProcessing || processingQueue.length === 0) return;
      isProcessing = true;

      while (processingQueue.length > 0) {
        const msg = processingQueue.shift()!;
        const hash = hashPrompt(msg.fullText);
        if (processedHashes.has(hash)) continue;

        const promptRecord = {
          index: msg.index,
          fullText: msg.fullText,
          firstSentence: msg.headingText,
        };

        // Push to prompts list before classifying
        index.prompts.push({
          index: msg.index,
          fullText: msg.fullText,
          firstSentence: msg.headingText,
          hash,
        });

        try {
          const result = await classifyPrompt(index, promptRecord, settings);
          processedHashes.add(hash);

          console.log(
            `[Chat Organizer] Classified msg #${msg.index} → node "${index.nodes[result.nodeId]?.label}" ` +
            `(confidence ${result.confidence.toFixed(2)}, new=${result.isNewNode})`,
          );

          renderTree();

          await saveConversation({
            conversationId,
            prompts: index.prompts,
            nodes: index.nodes,
            cache: index.cache,
          });
        } catch (err) {
          console.error('[Chat Organizer] Pipeline error for msg #', msg.index, err);
          // Pop the prompt back out on failure so it can be retried
          index.prompts.pop();
        }
      }

      isProcessing = false;
    }

    // ── Initial parse (after claude.ai finishes its first render) ─────────────
    setTimeout(() => {
      const existing = parseMessages();
      const unseen = existing.filter((m) => !processedHashes.has(hashPrompt(m.fullText)));
      if (unseen.length > 0) {
        processingQueue.push(...unseen);
        drainQueue();
      }

      // ── MutationObserver ──────────────────────────────────────────────────
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const observer = new MutationObserver(() => {
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          const messages = parseMessages();
          const newMessages = messages.filter(
            (m) => !processedHashes.has(hashPrompt(m.fullText)),
          );
          if (newMessages.length > 0) {
            processingQueue.push(...newMessages);
            drainQueue();
          }
        }, 600);
      });

      const container = findConversationContainer();
      observer.observe(container, { childList: true, subtree: true });
    }, 1200);

    console.log('[Chat Organizer] Sidebar mounted.');

    // ── Sidebar rendering ─────────────────────────────────────────────────────

    // Persists which node IDs are collapsed across re-renders triggered by
    // the pipeline classifying new messages.
    const collapsedNodes = new Set<string>();

    function renderTree() {
      while (body.firstChild) body.removeChild(body.firstChild);

      const root = index.nodes['root'];
      if (!root || root.children.length === 0) {
        const p = document.createElement('p');
        p.className = 'outline-panel__placeholder';
        p.textContent = 'No messages classified yet…';
        body.appendChild(p);
        return;
      }

      body.appendChild(buildNodeList('root', 0));
    }

    function buildNodeList(parentId: string, depth: number): HTMLUListElement {
      const ul = document.createElement('ul');
      ul.className = 'outline-list';

      for (const childId of index.nodes[parentId].children) {
        const node = index.nodes[childId];
        if (!node) continue;

        const hasSubNodes = node.children.length > 0;
        const hasPrompts  = node.promptIndices.length > 0;
        const isExpandable = hasSubNodes || hasPrompts;
        const isCollapsed  = collapsedNodes.has(node.id);

        const li = document.createElement('li');
        li.className = `outline-item outline-item--rank${node.rank}`;

        // ── Header row ──────────────────────────────────────────────────────
        const row = document.createElement('div');
        row.className = 'outline-item__row';

        if (isExpandable) {
          const expandBtn = document.createElement('button');
          expandBtn.className = 'outline-item__expand';
          expandBtn.textContent = isCollapsed ? '▸' : '▾';
          expandBtn.setAttribute('aria-expanded', String(!isCollapsed));

          expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (collapsedNodes.has(node.id)) {
              collapsedNodes.delete(node.id);
            } else {
              collapsedNodes.add(node.id);
            }
            renderTree();
          });

          row.appendChild(expandBtn);
        }

        const btn = document.createElement('button');
        btn.className = 'outline-item__btn';
        btn.textContent = node.label;
        btn.title = node.label;
        btn.addEventListener('click', () => scrollToNode(node));

        const badge = document.createElement('span');
        badge.className = 'outline-item__badge';
        badge.textContent = String(node.promptCount);

        row.appendChild(btn);
        row.appendChild(badge);
        li.appendChild(row);

        // ── Expandable content (hidden when collapsed) ───────────────────────
        if (isExpandable && !isCollapsed) {
          // Nested sub-nodes (rank-2 under rank-1, etc.)
          if (hasSubNodes) {
            li.appendChild(buildNodeList(childId, depth + 1));
          }

          // Individual message items for direct prompts on this node
          if (hasPrompts) {
            const msgList = document.createElement('ul');
            msgList.className = 'outline-list outline-list--messages';

            for (const promptIdx of node.promptIndices) {
              const record = index.prompts.find((p) => p.index === promptIdx);
              if (!record) continue;

              const msgLi = document.createElement('li');
              msgLi.className = 'outline-item outline-item--message';

              const msgBtn = document.createElement('button');
              msgBtn.className = 'outline-item__btn outline-item__btn--message';
              msgBtn.textContent = record.firstSentence;
              msgBtn.title = record.firstSentence;
              msgBtn.addEventListener('click', () => scrollToPromptIndex(promptIdx));

              msgLi.appendChild(msgBtn);
              msgList.appendChild(msgLi);
            }

            li.appendChild(msgList);
          }
        }

        ul.appendChild(li);
      }

      return ul;
    }

    function showNoKeyPlaceholder() {
      while (body.firstChild) body.removeChild(body.firstChild);

      const p = document.createElement('p');
      p.className = 'outline-panel__placeholder';
      p.textContent = 'Add a Gemini API key to enable the outline.';
      body.appendChild(p);

      const btn = document.createElement('button');
      btn.className = 'outline-settings-btn';
      btn.textContent = 'Open Settings';
      btn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }));
      body.appendChild(btn);
    }

    function scrollToNode(node: OutlineNode) {
      const promptIndex = findFirstPromptIndex(node);
      if (promptIndex === null) return;
      scrollToPromptIndex(promptIndex);
    }

    function scrollToPromptIndex(promptIndex: number) {
      const messages = parseMessages();
      const target = messages.find((m) => m.index === promptIndex);
      target?.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function findFirstPromptIndex(node: OutlineNode): number | null {
      if (node.promptIndices.length > 0) return node.promptIndices[0];
      for (const childId of node.children) {
        const child = index.nodes[childId];
        if (child) {
          const idx = findFirstPromptIndex(child);
          if (idx !== null) return idx;
        }
      }
      return null;
    }
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractConversationId(): string {
  const match = window.location.pathname.match(/\/chat\/([^/?#]+)/);
  return match?.[1] ?? 'home';
}
