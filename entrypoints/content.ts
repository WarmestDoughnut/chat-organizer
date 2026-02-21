import sidebarCss from '../assets/sidebar.css?inline';
import {
  parseMessages,
  findConversationContainer,
  type ParsedMessage,
} from '../utils/domParser';

export default defineContentScript({
  matches: ['https://claude.ai/*'],

  main() {
    console.log('[Chat Organizer] Content script loaded on', window.location.href);

    // Bail out if already injected (e.g. SPA navigation re-triggering the script)
    if (document.getElementById('chat-organizer-host')) return;

    // ── Shadow DOM host ───────────────────────────────────────────────────────
    const host = document.createElement('div');
    host.id = 'chat-organizer-host';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = sidebarCss;
    shadow.appendChild(style);

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

    // ── Outline rendering ─────────────────────────────────────────────────────
    function renderOutline(messages: ParsedMessage[]) {
      // Clear previous content
      while (body.firstChild) body.removeChild(body.firstChild);

      if (messages.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'outline-panel__placeholder';
        empty.textContent = 'No assistant messages yet…';
        body.appendChild(empty);
        return;
      }

      const list = document.createElement('ul');
      list.className = 'outline-list';

      messages.forEach((msg) => {
        const li = document.createElement('li');
        li.className = 'outline-item';

        const btn = document.createElement('button');
        btn.className = 'outline-item__btn';
        btn.textContent = msg.headingText;
        btn.title = msg.headingText; // tooltip for truncated text
        btn.addEventListener('click', () => {
          msg.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });

        li.appendChild(btn);
        list.appendChild(li);
      });

      body.appendChild(list);
    }

    // ── Debounced re-parse helper ─────────────────────────────────────────────
    // MutationObserver fires on every streamed token — debounce so we only
    // re-parse once the burst of mutations settles.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleParse() {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        renderOutline(parseMessages());
      }, 400);
    }

    // ── Initial parse ─────────────────────────────────────────────────────────
    // Delay slightly to let claude.ai finish its own first render.
    setTimeout(() => {
      renderOutline(parseMessages());

      // ── MutationObserver ────────────────────────────────────────────────────
      // Start watching only after the initial render so we don't double-parse.
      const container = findConversationContainer();
      const observer = new MutationObserver(scheduleParse);
      observer.observe(container, { childList: true, subtree: true });
    }, 1200);

    console.log('[Chat Organizer] Sidebar mounted (vanilla DOM).');
  },
});
