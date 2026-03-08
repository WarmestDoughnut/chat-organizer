import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { loadSettings, saveSettings, type Settings } from '../../utils/storage';

const styles: Record<string, React.CSSProperties> = {
  container: { width: '100%', maxWidth: 520 },
  heading: { fontSize: 20, fontWeight: 700, marginBottom: 6 },
  sub: { color: '#555', marginBottom: 28, lineHeight: 1.5 },
  card: {
    background: '#fff',
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: '20px 24px',
    marginBottom: 16,
  },
  sectionTitle: { fontWeight: 600, fontSize: 13, marginBottom: 12, color: '#111' },
  label: { display: 'block', marginBottom: 14 },
  labelText: { display: 'block', marginBottom: 6, fontWeight: 500 },
  input: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #ccc',
    borderRadius: 6,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  hint: { display: 'block', marginTop: 5, fontSize: 12, color: '#777' },
  footer: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 },
  saveBtn: {
    padding: '9px 20px',
    background: '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  saved: { color: '#16a34a', fontWeight: 500, fontSize: 13 },
  warning: {
    background: '#fef3c7',
    border: '1px solid #fbbf24',
    borderRadius: 6,
    padding: '10px 14px',
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 1.5,
  },
  radioGroup: { display: 'flex', gap: 20, marginBottom: 4 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' },
};

function OptionsApp() {
  const [settings, setSettings] = useState<Settings>({
    geminiApiKey: '',
    provider: 'gemini',
    ollamaModel: 'qwen2.5:7b',
    ollamaUrl: 'http://localhost:11434',
  });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings().then((s) => { setSettings(s); setLoading(false); });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function patch(key: keyof Settings, value: Settings[typeof key]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  if (loading) return null;

  const needsConfig =
    (settings.provider === 'gemini' && !settings.geminiApiKey) ||
    (settings.provider === 'ollama' && !settings.ollamaModel);

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Chat Organizer</h1>
      <p style={styles.sub}>
        Automatically organises your Claude.ai conversations into a collapsible outline.
      </p>

      {needsConfig && (
        <div style={styles.warning}>
          <strong>Setup required.</strong>{' '}
          {settings.provider === 'gemini'
            ? 'Add a Gemini API key below to enable classification.'
            : 'Make sure Ollama is running and a model name is set below.'}
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* ── Provider ── */}
        <div style={styles.card}>
          <div style={styles.sectionTitle}>AI Provider</div>
          <div style={styles.radioGroup}>
            <label style={styles.radioLabel}>
              <input
                type="radio"
                name="provider"
                value="gemini"
                checked={settings.provider === 'gemini'}
                onChange={() => patch('provider', 'gemini')}
              />
              Gemini Flash (cloud)
            </label>
            <label style={styles.radioLabel}>
              <input
                type="radio"
                name="provider"
                value="ollama"
                checked={settings.provider === 'ollama'}
                onChange={() => patch('provider', 'ollama')}
              />
              Ollama (local / private)
            </label>
          </div>
          <span style={styles.hint}>
            Ollama runs entirely on your machine — no data leaves your device.
            Gemini requires an API key but needs no local setup.
          </span>
        </div>

        {/* ── Gemini API Key ── */}
        {settings.provider === 'gemini' && (
          <div style={styles.card}>
            <div style={styles.sectionTitle}>Gemini API Key</div>
            <label style={styles.label}>
              <span style={styles.labelText}>API Key</span>
              <input
                type="password"
                style={styles.input}
                value={settings.geminiApiKey}
                onChange={(e) => patch('geminiApiKey', e.target.value)}
                placeholder="AIza..."
                autoComplete="off"
              />
              <span style={styles.hint}>
                Free key available at{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                  Google AI Studio
                </a>
                . Uses <code>gemini-2.0-flash</code>. Free tier applies.
              </span>
            </label>
          </div>
        )}

        {/* ── Ollama settings ── */}
        {settings.provider === 'ollama' && (
          <div style={styles.card}>
            <div style={styles.sectionTitle}>Ollama Settings</div>
            <label style={styles.label}>
              <span style={styles.labelText}>Model</span>
              <input
                type="text"
                style={styles.input}
                value={settings.ollamaModel}
                onChange={(e) => patch('ollamaModel', e.target.value)}
                placeholder="qwen2.5:7b"
                autoComplete="off"
              />
              <span style={styles.hint}>
                Recommended: <code>qwen2.5:7b</code>. Run{' '}
                <code>ollama pull qwen2.5:7b</code> in your terminal to download it.
              </span>
            </label>
            <label style={styles.label}>
              <span style={styles.labelText}>Ollama URL</span>
              <input
                type="text"
                style={styles.input}
                value={settings.ollamaUrl}
                onChange={(e) => patch('ollamaUrl', e.target.value)}
                placeholder="http://localhost:11434"
                autoComplete="off"
              />
              <span style={styles.hint}>
                Default is <code>http://localhost:11434</code>. Only change this if you run
                Ollama on a custom port or remote host.
              </span>
            </label>
          </div>
        )}

        <div style={styles.footer}>
          <button type="submit" style={styles.saveBtn}>Save settings</button>
          {saved && <span style={styles.saved}>Saved!</span>}
        </div>
      </form>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<OptionsApp />);
