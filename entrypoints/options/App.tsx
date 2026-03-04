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
};

function OptionsApp() {
  const [settings, setSettings] = useState<Settings>({ geminiApiKey: '' });
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

  if (loading) return null;

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Chat Organizer</h1>
      <p style={styles.sub}>
        Automatically organises your Claude.ai conversations into a collapsible outline
        powered by Gemini 2.0 Flash.
      </p>

      {!settings.geminiApiKey && (
        <div style={styles.warning}>
          <strong>No API key set.</strong> The sidebar will not classify messages until you
          add a Gemini API key below.
        </div>
      )}

      <form onSubmit={handleSave}>
        <div style={styles.card}>
          <div style={styles.sectionTitle}>Gemini API Key</div>
          <label style={styles.label}>
            <span style={styles.labelText}>API Key</span>
            <input
              type="password"
              style={styles.input}
              value={settings.geminiApiKey}
              onChange={(e) => setSettings((s) => ({ ...s, geminiApiKey: e.target.value }))}
              placeholder="AIza..."
              autoComplete="off"
            />
            <span style={styles.hint}>
              Free key available at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                Google AI Studio
              </a>
              . Used for <code>gemini-2.0-flash</code> (topic clustering). Free tier applies.
            </span>
          </label>
        </div>

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
