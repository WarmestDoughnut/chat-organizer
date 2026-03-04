// content.ts — injected into claude.ai.
// Responsibilities:
//   1. Inject sidebar shell via Shadow DOM (once, persists across SPA navigation)
//   2. On each conversation load: restore stored outline, render read-only
//   3. "▶ Analyze" click: batch-classify all messages, save, render
//   4. MutationObserver: detect new messages, incrementally classify, save, render
//   5. SPA navigation: tear down observer, reinitialize for new conversation

import sidebarCss from '../assets/sidebar.css?inline';
import { parseMessages, findConversationContainer, type ParsedMessage } from '../utils/domParser';
import { createOutline, type ConversationOutline, type Cluster } from '../utils/outline';
import { batchClassify, incrementalClassify } from '../utils/classify';
import { loadSettings, loadConversation, saveConversation, type Settings } from '../utils/storage';

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

    const analyzeBtn = document.createElement('button');
    analyzeBtn.className = 'sidebar__enable-btn';

    const toggle = document.createElement('button');
    toggle.className = 'sidebar__toggle';
    toggle.setAttribute('aria-label', 'Collapse sidebar');
    toggle.textContent = '▶';

    header.appendChild(titleEl);
    header.appendChild(analyzeBtn);
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

    // ── Load settings once ────────────────────────────────────────────────────
    const settings: Settings = await loadSettings();

    // ── Per-conversation state ────────────────────────────────────────────────
    let currentObserver: MutationObserver | null = null;
    let currentGeneration = 0;
    let onAnalyzeClick: () => void = () => {};
    analyzeBtn.addEventListener('click', () => onAnalyzeClick());

    // ── SPA navigation loop ───────────────────────────────────────────────────
    let activeConversationId = extractConversationId();
    await initForConversation(activeConversationId);

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

      // Restore stored outline (or start fresh)
      let outline: ConversationOutline;
      const stored = await loadConversation(conversationId);
      if (isStale()) return;

      // Guard against old v1 storage shape (nodes/cache/prompts) — treat as fresh
      if (stored && Array.isArray(stored.clusters)) {
        outline = {
          conversationId: stored.conversationId,
          clusters: stored.clusters,
          messages: stored.messages ?? {},
          analyzedIndices: stored.analyzedIndices ?? [],
        };
        console.log(
          `[Chat Organizer] Restored ${stored.clusters.length} cluster(s) for ${conversationId}.`,
        );
      } else {
        if (stored) console.log('[Chat Organizer] Stale v1 storage detected — starting fresh.');
        outline = createOutline(conversationId);
      }

      let analyzing = false;
      const collapsedNodes = new Set<string>();

      // ── Analyze button state ────────────────────────────────────────────────
      function syncAnalyzeBtn() {
        if (!settings.geminiApiKey) {
          analyzeBtn.textContent = '⚙ Key needed';
          analyzeBtn.disabled = true;
        } else if (analyzing) {
          analyzeBtn.textContent = '⏳ Analyzing…';
          analyzeBtn.disabled = true;
        } else {
          analyzeBtn.textContent = '▶ Analyze';
          analyzeBtn.disabled = false;
        }
      }

      // Always starts fresh — wipes stored data and re-classifies from scratch.
      onAnalyzeClick = async () => {
        if (analyzing || isStale()) return;
        analyzing = true;
        syncAnalyzeBtn();

        // Clear previous state
        outline = createOutline(conversationId);
        collapsedNodes.clear();
        renderOutline();

        try {
          const messages = parseMessages();
          if (messages.length === 0) {
            showPlaceholder('No assistant messages found to analyze.');
            return;
          }

          console.log(`[Chat Organizer] Batch-classifying ${messages.length} message(s)…`);
          outline = await batchClassify(messages, conversationId);
          if (isStale()) return;

          console.log(`[Chat Organizer] Got ${outline.clusters.length} cluster(s).`);
          renderOutline();
          await saveConversation({
            conversationId,
            clusters: outline.clusters,
            messages: outline.messages,
            analyzedIndices: outline.analyzedIndices,
          });

          startObserver();
        } catch (err: any) {
          console.error('[Chat Organizer] Batch classify error:', err);
          const msg = err?.message ?? String(err);
          const isQuota = msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('exhausted');
          showPlaceholder(
            isQuota
              ? 'Gemini API quota exceeded. The free tier resets daily — try again tomorrow or use a paid key.'
              : `Analysis failed: ${msg}`,
          );
        } finally {
          if (!isStale()) {
            analyzing = false;
            syncAnalyzeBtn();
          }
        }
      };

      syncAnalyzeBtn();
      renderOutline();

      if (!settings.geminiApiKey) {
        showNoKeyPlaceholder();
        return;
      }

      // If we have a stored outline, resume watching for new messages silently.
      if (stored && stored.analyzedIndices.length > 0) {
        startObserver();
      }

      // ── MutationObserver ────────────────────────────────────────────────────

      function startObserver() {
        if (currentObserver) currentObserver.disconnect();

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        const observer = new MutationObserver(() => {
          if (isStale()) { observer.disconnect(); return; }
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            debounceTimer = null;
            if (isStale()) return;

            const allMessages = parseMessages();
            const newMessages = allMessages.filter(
              (m) => !outline.analyzedIndices.includes(m.index),
            );

            if (newMessages.length === 0) return;

            console.log(`[Chat Organizer] ${newMessages.length} new message(s) — incrementally classifying…`);

            try {
              await incrementalClassify(outline, newMessages);
              if (isStale()) return;
              renderOutline();
              await saveConversation({
                conversationId,
                clusters: outline.clusters,
                messages: outline.messages,
                analyzedIndices: outline.analyzedIndices,
              });
            } catch (err) {
              console.error('[Chat Organizer] Incremental classify error:', err);
            }
          }, 1500); // longer debounce: wait for streaming to finish
        });

        const container = findConversationContainer();
        observer.observe(container, { childList: true, subtree: true });
        currentObserver = observer;
      }

      // ── Rendering ───────────────────────────────────────────────────────────

      function renderOutline() {
        while (body.firstChild) body.removeChild(body.firstChild);

        if (outline.clusters.length === 0) {
          showPlaceholder(
            settings.geminiApiKey
              ? 'Press ▶ Analyze to build the outline for this chat.'
              : 'Add a Gemini API key to enable the outline.',
          );
          return;
        }

        const ul = document.createElement('ul');
        ul.className = 'outline-list';

        for (const cluster of outline.clusters) {
          ul.appendChild(buildClusterItem(cluster));
        }

        body.appendChild(ul);
      }

      function buildClusterItem(cluster: Cluster): HTMLLIElement {
        const hasSubclusters = cluster.subclusters.length > 0;
        const hasFlatMessages = cluster.messageIndices.length > 0;
        const isExpandable = hasSubclusters || hasFlatMessages;
        const isCollapsed = collapsedNodes.has(cluster.id);

        const li = document.createElement('li');
        li.className = 'outline-item outline-item--rank1';

        const row = document.createElement('div');
        row.className = 'outline-item__row';

        if (isExpandable) {
          const expandBtn = document.createElement('button');
          expandBtn.className = 'outline-item__expand';
          expandBtn.textContent = isCollapsed ? '▸' : '▾';
          expandBtn.setAttribute('aria-expanded', String(!isCollapsed));
          expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCollapsed(cluster.id);
          });
          row.appendChild(expandBtn);
        }

        const btn = document.createElement('button');
        btn.className = 'outline-item__btn';
        btn.textContent = cluster.label;
        btn.title = cluster.label;
        btn.addEventListener('click', () => scrollToFirst(cluster));

        const badge = document.createElement('span');
        badge.className = 'outline-item__badge';
        badge.textContent = String(countClusterMessages(cluster));

        row.appendChild(btn);
        row.appendChild(badge);
        li.appendChild(row);

        if (isExpandable && !isCollapsed) {
          const children = document.createElement('ul');
          children.className = 'outline-list';

          if (hasSubclusters) {
            for (const sub of cluster.subclusters) {
              children.appendChild(buildSubclusterItem(sub));
            }
          }

          // Flat messages (cluster has no subclusters, or overflow messages)
          if (hasFlatMessages) {
            for (const idx of cluster.messageIndices) {
              children.appendChild(buildMessageItem(idx));
            }
          }

          li.appendChild(children);
        }

        return li;
      }

      function buildSubclusterItem(sub: { id: string; label: string; messageIndices: number[] }): HTMLLIElement {
        const isCollapsed = collapsedNodes.has(sub.id);
        const isExpandable = sub.messageIndices.length > 0;

        const li = document.createElement('li');
        li.className = 'outline-item outline-item--rank2';

        const row = document.createElement('div');
        row.className = 'outline-item__row';

        if (isExpandable) {
          const expandBtn = document.createElement('button');
          expandBtn.className = 'outline-item__expand';
          expandBtn.textContent = isCollapsed ? '▸' : '▾';
          expandBtn.setAttribute('aria-expanded', String(!isCollapsed));
          expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCollapsed(sub.id);
          });
          row.appendChild(expandBtn);
        }

        const btn = document.createElement('button');
        btn.className = 'outline-item__btn';
        btn.textContent = sub.label;
        btn.title = sub.label;
        btn.addEventListener('click', () => {
          const firstIdx = sub.messageIndices[0];
          if (firstIdx !== undefined) scrollToMessageIndex(firstIdx);
        });

        const badge = document.createElement('span');
        badge.className = 'outline-item__badge';
        badge.textContent = String(sub.messageIndices.length);

        row.appendChild(btn);
        row.appendChild(badge);
        li.appendChild(row);

        if (isExpandable && !isCollapsed) {
          const msgList = document.createElement('ul');
          msgList.className = 'outline-list outline-list--messages';
          for (const idx of sub.messageIndices) {
            msgList.appendChild(buildMessageItem(idx));
          }
          li.appendChild(msgList);
        }

        return li;
      }

      function buildMessageItem(idx: number): HTMLLIElement {
        const record = outline.messages[idx];
        const li = document.createElement('li');
        li.className = 'outline-item outline-item--message';

        const btn = document.createElement('button');
        btn.className = 'outline-item__btn outline-item__btn--message';
        btn.textContent = record?.firstSentence ?? `Message ${idx}`;
        btn.title = btn.textContent;
        btn.addEventListener('click', () => scrollToMessageIndex(idx));

        li.appendChild(btn);
        return li;
      }

      function toggleCollapsed(id: string) {
        if (collapsedNodes.has(id)) {
          collapsedNodes.delete(id);
        } else {
          collapsedNodes.add(id);
        }
        renderOutline();
      }

      function showPlaceholder(text: string) {
        while (body.firstChild) body.removeChild(body.firstChild);
        const p = document.createElement('p');
        p.className = 'outline-panel__placeholder';
        p.textContent = text;
        body.appendChild(p);
      }

      function showNoKeyPlaceholder() {
        showPlaceholder('Add a Gemini API key to enable the outline.');
        const btn = document.createElement('button');
        btn.className = 'outline-settings-btn';
        btn.textContent = 'Open Settings';
        btn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }));
        body.appendChild(btn);
      }

      // ── Navigation helpers ────────────────────────────────────────────────────

      function scrollToFirst(cluster: Cluster) {
        const idx =
          cluster.subclusters[0]?.messageIndices[0] ??
          cluster.messageIndices[0];
        if (idx !== undefined) scrollToMessageIndex(idx);
      }

      function scrollToMessageIndex(targetIndex: number) {
        const messages = parseMessages();
        const target = messages.find((m) => m.index === targetIndex);
        target?.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      function countClusterMessages(cluster: Cluster): number {
        const subCount = cluster.subclusters.reduce(
          (n, sc) => n + sc.messageIndices.length, 0,
        );
        return subCount + cluster.messageIndices.length;
      }
    }
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractConversationId(): string {
  const match = window.location.pathname.match(/\/chat\/([^/?#]+)/);
  return match?.[1] ?? 'home';
}
