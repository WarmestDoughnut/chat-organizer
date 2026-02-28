import { defineConfig } from 'wxt';

export default defineConfig({
  extensionApi: 'chrome',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Chat Organizer',
    description: 'Inject an outline sidebar into LLM chat pages',
    version: '0.0.1',
    permissions: ['storage'],
    // Background script needs to fetch the Gemini API (CORS proxy pattern).
    // Content scripts cannot fetch external origins directly.
    host_permissions: ['https://generativelanguage.googleapis.com/*'],
  },
});
