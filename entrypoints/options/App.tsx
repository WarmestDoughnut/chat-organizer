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
  range: { width: '100%', marginTop: 4 },
  rangeRow: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555', marginTop: 2 },
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
  const [settings, setSettings] = useState<Settings>({
    geminiApiKey: '',
    thresholdHigh: 0.8,
    thresholdLow: 0.5,
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

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Chat Organizer</h1>
      <p style={styles.sub}>
        Automatically organises your Claude.ai conversations into a collapsible outline
        powered by semantic embeddings.
      </p>

      {!settings.geminiApiKey && (
        <div style={styles.warning}>
          <strong>No API key set.</strong> The sidebar will not classify messages until you
          add a Gemini API key below.
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* ── API Key ── */}
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
              . Used for <code>text-embedding-004</code> (similarity) and{' '}
              <code>gemini-2.0-flash</code> (label generation). Free tier: ~1,500 embedding calls/day.
            </span>
          </label>
        </div>

        {/* ── Similarity Thresholds ── */}
        <div style={styles.card}>
          <div style={styles.sectionTitle}>Similarity Thresholds</div>

          <label style={styles.label}>
            <span style={styles.labelText}>
              High confidence — direct match &nbsp;
              <strong>{settings.thresholdHigh.toFixed(2)}</strong>
            </span>
            <input
              type="range"
              style={styles.range}
              min={0.5} max={1} step={0.05}
              value={settings.thresholdHigh}
              onChange={(e) => patch('thresholdHigh', Number(e.target.value))}
            />
            <div style={styles.rangeRow}>
              <span>← broader matching</span>
              <span>stricter matching →</span>
            </div>
            <span style={styles.hint}>
              Above this score the prompt is inserted directly under the matched header.
              Raise it if unrelated messages are being grouped together.
            </span>
          </label>

          <label style={styles.label}>
            <span style={styles.labelText}>
              Low confidence — escalation cutoff &nbsp;
              <strong>{settings.thresholdLow.toFixed(2)}</strong>
            </span>
            <input
              type="range"
              style={styles.range}
              min={0} max={0.79} step={0.05}
              value={settings.thresholdLow}
              onChange={(e) => patch('thresholdLow', Number(e.target.value))}
            />
            <div style={styles.rangeRow}>
              <span>← more new headers</span>
              <span>fewer new headers →</span>
            </div>
            <span style={styles.hint}>
              If the full-text scan scores below this, a brand-new header is spawned.
              Lower it if the outline is getting too sparse.
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
