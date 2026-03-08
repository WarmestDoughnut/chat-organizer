# Chat Organizer

A Chrome extension that injects a collapsible outline sidebar into claude.ai, giving long conversations the navigation they deserve.

## What it does

As a conversation grows, finding something you discussed twenty messages ago means scrolling blindly through the whole thread. Chat Organizer reads every assistant response in real time, groups them into topic clusters, and displays them as a clickable outline in a fixed sidebar. Click any item — you jump straight there.

- Outline builds automatically as the conversation progresses
- Messages are grouped into topic clusters and subclusters by an AI model
- New messages are classified incrementally as the conversation continues
- Sidebar collapses to a slim toggle strip so it never gets in the way
- Choice of provider: Gemini Flash (cloud) or Ollama (fully local, no data leaves your machine)

## Why I built it

Claude produces genuinely long, structured responses. Over a working session the chat becomes a document — but it has no table of contents. I wanted a lightweight tool that imposes just enough structure to make those conversations navigable without changing how I use the product.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Extension framework | [WXT](https://wxt.dev) | Handles MV3 boilerplate, hot reload, and bundling without config overhead |
| UI | Vanilla DOM (no framework) | Avoids React hydration conflicts with claude.ai's own React instance |
| Styles | Plain CSS, shadow DOM scoped | Zero bleed into host page styles |
| Build | Vite 6 (via WXT) | Fast dev builds, `?inline` CSS imports for shadow DOM injection |
| Language | TypeScript | Type-safe DOM references and message structs |
| AI (cloud) | Gemini 2.0 Flash | Single batch call for full conversation clustering |
| AI (local) | Ollama (qwen2.5:7b) | Fully on-device, no data sent externally |

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

> **Note:** `.output` is a hidden folder. In the Load unpacked dialog press **Cmd + Shift + .** (Mac) to show hidden files.

4. Open any conversation on [claude.ai](https://claude.ai) — the sidebar appears on the right

## Setting up a provider

Open the extension settings by clicking the extension icon or pressing **⚙ Key needed** in the sidebar.

### Option A — Gemini Flash (cloud)

1. Get a free API key at [Google AI Studio](https://aistudio.google.com/apikey)
2. In Settings, select **Gemini Flash (cloud)**
3. Paste your key and click **Save settings**

Free tier: ~1,500 requests/day, resets daily.

### Option B — Ollama (local, fully private)

All classification runs on your machine. Nothing is sent to any external server.

**Step 1 — Install Ollama**

Download and install from [ollama.com](https://ollama.com). Once installed, open the app — an Ollama icon will appear in your menu bar.

**Step 2 — Pull the recommended model**

```bash
ollama pull qwen2.5:7b
```

This is a ~4.7 GB download. Any model that supports structured JSON output will work; `qwen2.5:7b` is recommended for the best balance of speed and quality.

**Step 3 — Allow the extension to reach Ollama**

By default Ollama blocks requests from browser extensions (they come from a `chrome-extension://` origin). You must set `OLLAMA_ORIGINS` to allow this.

Add the following to your `~/.zshrc` (or `~/.bashrc`) to make it permanent:

```bash
export OLLAMA_ORIGINS="*"
```

Then reload your shell:

```bash
source ~/.zshrc
```

After that, start Ollama from the terminal so it picks up the variable:

```bash
OLLAMA_ORIGINS="*" /Applications/Ollama.app/Contents/Resources/ollama serve
```

> **Why is this needed?** The extension's background service worker makes fetch requests to `http://localhost:11434`. Ollama's CORS policy rejects these by default because the request origin is `chrome-extension://...` rather than `localhost`. Setting `OLLAMA_ORIGINS="*"` tells Ollama to accept requests from any origin. Ollama still only listens on localhost, so this does not expose it to the network.

> **Symptom if not set:** the sidebar will show `Analysis failed: Ollama 403`.

**Step 4 — Configure the extension**

In Settings, select **Ollama (local / private)**, confirm the model name is `qwen2.5:7b`, and click **Save settings**.

## Project structure

```
entrypoints/
  content.ts          — injected into claude.ai; builds sidebar, runs observer
  background.ts       — MV3 service worker; CORS proxy for Gemini and Ollama
  options/            — settings page (provider toggle, API key, Ollama config)
components/
  Sidebar.tsx         — React component (reserved for future use)
  OutlinePanel.tsx    — React component (reserved for future use)
utils/
  domParser.ts        — finds assistant messages, builds clean snippets for classification
  classify.ts         — batch and incremental classify logic
  outline.ts          — ConversationOutline data structure
  gemini.ts           — background message protocol types
  storage.ts          — chrome.storage.local helpers
assets/
  sidebar.css         — all sidebar styles, shadow DOM scoped
```

> **Selector note:** claude.ai's frontend changes occasionally. If the outline stops populating, open DevTools on the page, run `[...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].sort()` in the Console, and update `ASSISTANT_SELECTORS` in `utils/domParser.ts` with any new assistant message testids.

## License

MIT
