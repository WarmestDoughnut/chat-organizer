# Chat Organizer

A Chrome extension that injects a collapsible outline sidebar into claude.ai, giving long conversations the navigation they deserve.

## What it does

As a conversation grows, finding something you discussed twenty messages ago means scrolling blindly through the whole thread. Chat Organizer reads every assistant response in real time, extracts a heading from each one, and displays them as a clickable outline in a fixed sidebar. Click any item — you jump straight there.

- Outline builds automatically as the conversation progresses
- Headings are extracted from the actual response content, not message numbers
- Filler openers ("Let me…", "I need to…") are skipped in favour of a more descriptive sentence
- Sidebar collapses to a slim toggle strip so it never gets in the way
- Runs entirely in the browser — no accounts, no servers, no data leaves your machine

## Why I built it

Claude produces genuinely long, structured responses. Over a working session the chat becomes a document — but it has no table of contents. I wanted a lightweight tool that imposes just enough structure to make those conversations navigable without changing how I use the product.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Extension framework | [WXT](https://wxt.dev) | Handles MV3 boilerplate, hot reload, and bundling without config overhead |
| UI | Vanilla DOM (no framework) | Avoids React hydration conflicts with claude.ai's own React instance |
| Styles | Plain CSS modules, shadow DOM scoped | Zero bleed into host page styles |
| Build | Vite 6 (via WXT) | Fast dev builds, `?inline` CSS imports for shadow DOM injection |
| Language | TypeScript | Type-safe DOM references and message structs |

## Install locally

**Requirements:** Node 18+, Chrome (or any Chromium browser)

```bash
git clone https://github.com/WarmestDoughnut/chat-organizer.git
cd chat-organizer
npm install
```

### Development (hot reload)

```bash
npm run dev
```

WXT opens a browser window automatically with the extension pre-loaded.

### Production build

```bash
npm run build
# Output is in .output/chrome-mv3/
```

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder
4. Open any conversation on [claude.ai](https://claude.ai) — the sidebar appears on the right

> **Selector note:** claude.ai's frontend changes occasionally. If the outline stops populating, open DevTools on the page, inspect an assistant message, find the nearest `data-testid` attribute, and update `ASSISTANT_SELECTORS` in `utils/domParser.ts`.

## Project structure

```
entrypoints/
  content.ts          — injected into claude.ai; builds sidebar, runs observer
  background.ts       — MV3 service worker stub
components/
  Sidebar.tsx         — React component (reserved for future use)
  OutlinePanel.tsx    — React component (reserved for future use)
utils/
  domParser.ts        — finds assistant messages, extracts headings
  structureBuilder.ts — stub for future outline tree logic
assets/
  sidebar.css         — all sidebar styles, shadow DOM scoped
```

## Planned for v2

- **Multi-platform support** — ChatGPT, Gemini, and other chat interfaces via an adapter pattern already sketched in `domParser.ts`
- **Knowledge graph** — visualise how topics connect across a conversation using [Cytoscape.js](https://js.cytoscape.org)
- **LLM-generated structure** — use the Claude API to produce smarter section titles and hierarchical groupings instead of first-sentence extraction
- **Nested headings** — detect sub-topics within a single response and render a collapsible tree
- **Cross-session persistence** — remember the outline for conversations you return to via `chrome.storage.local`
- **User-editable labels** — rename any heading to something more meaningful

## License

MIT
