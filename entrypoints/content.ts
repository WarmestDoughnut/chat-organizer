// content.ts — injected into claude.ai.
// Responsibilities:
//   1. Inject the sidebar shell via Shadow DOM (once, persists across navigation)
//   2. On each conversation load/navigation: restore index, check enabled state, render
//   3. When user enables: re-embed labels, parse existing messages, watch for new ones
//   4. On SPA navigation: tear down observer, reinitialize for the new conversation

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

    // ── Shadow DOM host (created once, persists across SPA navigation) ────────
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

    const enableBtn = document.createElement('button');
    enableBtn.className = 'sidebar__enable-btn';

    const toggle = document.createElement('button');
    toggle.className = 'sidebar__toggle';
    toggle.setAttribute('aria-label', 'Collapse sidebar');
    toggle.textContent = '▶';

    header.appendChild(titleEl);
    header.appendChild(enableBtn);
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

    // ── Load settings once (shared across conversations) ──────────────────────
    const settings: Settings = await loadSettings();

    // ── Per-conversation teardown handles ─────────────────────────────────────
    let currentObserver: MutationObserver | null = null;

    // Generation counter — incremented on every navigation.
    // Any async callback captures its generation at creation time and checks
    // isStale() before touching shared DOM or state. Stale callbacks abort.
    let currentGeneration = 0;

    // Single permanent click handler — delegates to whatever the current
    // conversation's enable action is. Replaced on each navigation.
    let onEnableClick: (() => void) = () => {};
    enableBtn.addEventListener('click', () => onEnableClick());

    // ── Initialize for current conversation, then watch for navigation ────────
    let activeConversationId = extractConversationId();
    await initForConversation(activeConversationId);

    // Poll for SPA navigation — claude.ai uses history.pushState which doesn't
    // fire standard events, so we watch the pathname ourselves.
    setInterval(async () => {
      const newId = extractConversationId();
      if (newId !== activeConversationId) {
        console.log(`[Chat Organizer] Navigation: ${activeConversationId} → ${newId}`);
        activeConversationId = newId;
        currentObserver?.disconnect();
        currentObserver = null;
        await initForConversation(newId);
      }
    }, 500);

    // ── Per-conversation initializer ──────────────────────────────────────────

    async function initForConversation(conversationId: string) {
      const myGen = ++currentGeneration;
      const isStale = () => myGen !== currentGeneration;


      // Load stored tree
      let index: ConversationIndex;
      const stored = await loadConversation(conversationId);
      if (isStale()) return; // navigation happened while awaiting storage
      if (stored) {
        index = createIndex(conversationId);
        index.nodes = stored.nodes;
        index.cache = stored.cache;
        index.prompts = stored.prompts;
        console.log(
          `[Chat Organizer] Restored ${Object.keys(stored.nodes).length - 1} node(s) for ${conversationId}.`,
        );
      } else {
        index = createIndex(conversationId);
      }

      // Pipeline is always off on page load / navigation — user must click
      // ▶ Analyze to start live monitoring for this session.
      // Stored outline data still shows in read-only mode without it.
      let pipelineEnabled = false;

      // Reset collapse state for the new conversation
      const collapsedNodes = new Set<string>();

      // ── Sync enable button ────────────────────────────────────────────────
      function syncEnableBtn() {
        if (!settings.geminiApiKey) {
          enableBtn.textContent = '⚙ Key needed';
          enableBtn.disabled = true;
        } else if (pipelineEnabled) {
          enableBtn.textContent = '● Live';
          enableBtn.disabled = true;
        } else {
          enableBtn.textContent = '▶ Analyze';
          enableBtn.disabled = false;
        }
      }

      // Point the permanent click handler at this conversation's action.
      // Always starts fresh — wipes stored data and reclassifies from scratch.
      onEnableClick = async () => {
        index = createIndex(conversationId);
        await saveConversation({ conversationId, prompts: [], nodes: index.nodes, cache: {} });
        startPipeline(true);
      };

      syncEnableBtn();
      renderTree();

      if (!settings.geminiApiKey) {
        showNoKeyPlaceholder();
        return;
      }

      // Pipeline never auto-starts — ▶ Analyze is required each session.

      // ── Pipeline startup ────────────────────────────────────────────────────

      function startPipeline(fresh: boolean) {
        pipelineEnabled = true;
        syncEnableBtn();
        renderTree();

        initializeEmbeddings(index, settings).catch((err) =>
          console.warn('[Chat Organizer] Embedding init error:', err),
        );

        // Fresh start: ignore existing cache so all messages get reclassified.
        // Auto-resume: skip messages already in the cache.
        const processedHashes = fresh
          ? new Set<string>()
          : new Set<string>(Object.keys(index.cache));
        let processingQueue: ParsedMessage[] = [];
        let isProcessing = false;

        async function drainQueue() {
          if (isProcessing || processingQueue.length === 0) return;
          isProcessing = true;

          while (processingQueue.length > 0) {
            if (isStale()) { isProcessing = false; return; }

            const msg = processingQueue.shift()!;
            const hash = hashPrompt(msg.fullText);
            if (processedHashes.has(hash)) continue;

            index.prompts.push({
              index: msg.index,
              fullText: msg.fullText,
              firstSentence: msg.headingText,
              hash,
            });

            try {
              const result = await classifyPrompt(
                index,
                { index: msg.index, fullText: msg.fullText, firstSentence: msg.headingText },
                settings,
              );
              if (isStale()) { isProcessing = false; return; }

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
              index.prompts.pop();
            }
          }

          isProcessing = false;
        }

        setTimeout(() => {
          if (isStale()) return; // navigated away during the initial delay

          const existing = parseMessages();
          const unseen = existing.filter((m) => !processedHashes.has(hashPrompt(m.fullText)));
          if (unseen.length > 0) {
            processingQueue.push(...unseen);
            drainQueue();
          }

          let debounceTimer: ReturnType<typeof setTimeout> | null = null;

          const observer = new MutationObserver(() => {
            if (isStale()) { observer.disconnect(); return; }
            if (debounceTimer !== null) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              debounceTimer = null;
              if (isStale()) return;
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
          currentObserver = observer;
        }, 1200);
      }

      // ── Sidebar rendering ─────────────────────────────────────────────────

      function renderTree() {
        while (body.firstChild) body.removeChild(body.firstChild);

        const root = index.nodes['root'];
        if (!root || root.children.length === 0) {
          const p = document.createElement('p');
          p.className = 'outline-panel__placeholder';
          p.textContent = pipelineEnabled
            ? 'No messages classified yet…'
            : 'Press ▶ Analyze to build the outline for this chat.';
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

          if (isExpandable && !isCollapsed) {
            if (hasSubNodes) li.appendChild(buildNodeList(childId, depth + 1));

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
    }
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractConversationId(): string {
  const match = window.location.pathname.match(/\/chat\/([^/?#]+)/);
  return match?.[1] ?? 'home';
}
