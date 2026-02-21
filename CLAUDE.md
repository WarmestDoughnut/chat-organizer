# Chat Organizer Extension — Project Brief

## What We're Building
A Chrome extension (Manifest V3) that injects a sidebar into LLM chat pages (starting with claude.ai) to create an organizational structure from the conversation — think collapsible headings, subheadings, and anchor links that let you jump to any point in a long chat instantly.

## MVP Scope (Build This First)
- [ ] Extension shell using WXT framework
- [ ] Content script that reads the chat DOM on claude.ai
- [ ] Sidebar UI injected into the page (React component)
- [ ] Basic outline panel: auto-generates headings from assistant responses
- [ ] Click a heading → scroll to that message in the chat
- [ ] Outline updates in real time as new messages appear (MutationObserver)

## Out of Scope for MVP
- Knowledge graph (v2)
- Multi-platform support beyond claude.ai (v2)
- LLM-generated structure / API calls (v2)
- User accounts or backend (v2)
- Cross-session persistence (v2)

## Tech Stack
- **Framework:** WXT (wxt.dev) — handles MV3 boilerplate, hot reload, content script injection
- **UI:** React + plain CSS modules (no Tailwind, keep bundle lean)
- **Graph (future):** Cytoscape.js
- **Storage:** chrome.storage.local for any persistence needs
- **No backend for MVP** — everything runs in the extension

## Project Structure (WXT default)
```
/
├── CLAUDE.md               ← you are here
├── package.json
├── wxt.config.ts
├── entrypoints/
│   ├── content.ts          ← injected into claude.ai, watches DOM
│   └── background.ts       ← service worker, message routing
├── components/
│   ├── Sidebar.tsx         ← main sidebar shell
│   └── OutlinePanel.tsx    ← renders the heading list
├── utils/
│   ├── domParser.ts        ← scrapes messages from claude.ai DOM
│   └── structureBuilder.ts ← converts raw messages into outline nodes
└── assets/
    └── sidebar.css
```

## Key Technical Decisions & Constraints

### DOM Parsing Strategy
- Target claude.ai first, make the adapter pattern explicit so other platforms can be added later
- Use `MutationObserver` to watch for new messages being added
- Extract: message index, role (user/assistant), first line or first sentence as heading candidate
- Assistant responses longer than ~100 words get a heading; short exchanges do not
- Store message DOM references so we can `scrollIntoView()` on click

### Sidebar Injection
- Inject sidebar as a shadow DOM element to avoid style conflicts with the host page
- Position: fixed right panel, ~280px wide, collapsible
- Should not interfere with claude.ai's own layout — adjust body margin rather than overlapping

### Message Passing Architecture
```
content script (DOM access) 
    ↕ chrome.runtime.sendMessage
background service worker (logic, storage)
    ↕ chrome.runtime.sendMessage  
sidebar UI (React, rendering)
```
Keep it simple for MVP — content script can talk directly to sidebar via custom events since they share the same page context.

### MutationObserver Setup
```typescript
// Watch for new messages being added to the chat container
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.addedNodes.length) {
      // re-parse and update outline
    }
  }
});
observer.observe(chatContainer, { childList: true, subtree: true });
```

## Claude.ai DOM Notes (verify these on first run, they change)
- Chat messages are likely in a container with a role or data attribute
- Assistant messages vs user messages are distinguished by class or data-role attribute
- **Always query by semantic attributes over class names** — classes change, semantic markup is more stable
- If selectors break, check the DOM in devtools and update `domParser.ts`

## Development Workflow
1. `npm run dev` — starts WXT dev server with hot reload
2. Open Chrome → `chrome://extensions` → Load unpacked → point to `.output/chrome-mv3`
3. Navigate to claude.ai and open a conversation
4. Sidebar should appear on the right
5. Open DevTools console on claude.ai to see content script logs

## Definition of Done for MVP
- Sidebar appears on claude.ai without breaking the page layout
- Outline auto-populates with assistant response headings as conversation progresses
- Clicking any heading smoothly scrolls to that message
- Outline updates in real time without page refresh
- No console errors in normal usage

## Known Risks
- **DOM fragility:** claude.ai frontend updates can break selectors overnight. Mitigate by using the most semantic selectors available and adding a fallback/error state in the sidebar when parsing fails.
- **Shadow DOM + React:** Injecting React into a shadow root has some quirks with event bubbling. Use ReactDOM.createRoot on the shadow root directly.
- **MV3 service worker sleep:** Don't rely on background script for anything that needs to be persistent — keep state in the content script or chrome.storage.

## First Task for Claude Code
Set up the WXT project from scratch:
```
npx wxt@latest init chat-organizer
```
Choose React + TypeScript when prompted. Then create the file structure above with empty stubs, and get a basic sidebar rendering on claude.ai that just says "Outline coming soon" — confirm injection works before writing any parsing logic.
