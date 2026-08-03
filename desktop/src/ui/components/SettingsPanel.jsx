import React, { useState } from 'react';
import { Button, Card, Field, Pill, Toggle } from './ui.jsx';

const SettingsPanel = ({ settings, info, devices, state, onPatch, onTestGemini, onSelectDevice, onLogout, onOpenLogs }) => {
  const [apiKey, setApiKey] = useState('');
  const [firebaseKey, setFirebaseKey] = useState(settings.firebase?.apiKey || '');
  const [projectId, setProjectId] = useState(settings.firebase?.projectId || '');
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  const behaviour = settings.behaviour || {};
  const gemini = settings.gemini || {};
  const audio = settings.audio || {};

  const saveKey = async () => {
    if (!apiKey.trim()) return;
    await onPatch({ geminiApiKey: apiKey.trim() });
    setApiKey('');
  };

  const runTest = async () => {
    setTesting(true);
    setTest(await onTestGemini());
    setTesting(false);
  };

  return (
    <div className="settings">
      <Card
        title="Gemini"
        subtitle="Your API key never leaves this machine - it is encrypted with Windows DPAPI and used only from the desktop process."
      >
        <div className="settings__row">
          <Field label="API key" hint={settings.hasGeminiKey ? `Stored: ${settings.geminiKeyPreview}` : 'Get one free at aistudio.google.com/apikey'}>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.hasGeminiKey ? '•••••••••••••• (replace)' : 'AIza…'}
            />
          </Field>
          <div className="settings__row-actions">
            <Button variant="primary" size="sm" onClick={saveKey} disabled={!apiKey.trim()}>
              Save key
            </Button>
            <Button variant="ghost" size="sm" onClick={runTest} loading={testing} disabled={!settings.hasGeminiKey}>
              Test
            </Button>
          </div>
        </div>

        {test && (
          <p className={`alert ${test.ok ? 'alert--good' : 'alert--error'}`}>
            {test.ok ? `Connected in ${test.latencyMs} ms using ${test.model}` : test.error}
          </p>
        )}

        {!settings.encryptionAvailable && (
          <p className="alert alert--warn">
            Windows encryption is unavailable, so the key is kept in memory for this session only.
          </p>
        )}

        <div className="settings__grid">
          <Field label="Answer model">
            <select value={gemini.model} onChange={(event) => onPatch({ gemini: { model: event.target.value } })}>
              <option value="gemini-2.5-flash">gemini-2.5-flash (fast, recommended)</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro (smarter, slower)</option>
              <option value="gemini-2.0-flash">gemini-2.0-flash</option>
            </select>
          </Field>

          <Field label="Transcription model">
            <select
              value={gemini.transcribeModel}
              onChange={(event) => onPatch({ gemini: { transcribeModel: event.target.value } })}
            >
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gemini-2.0-flash">gemini-2.0-flash</option>
            </select>
          </Field>

          <Field label="Answer style">
            <select
              value={gemini.answerStyle}
              onChange={(event) => onPatch({ gemini: { answerStyle: event.target.value } })}
            >
              <option value="concise">Concise (1-2 sentences)</option>
              <option value="detailed">Detailed (3-5 sentences)</option>
            </select>
          </Field>

          <Field label="Creativity" hint={`temperature ${gemini.temperature}`}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={gemini.temperature}
              onChange={(event) => onPatch({ gemini: { temperature: Number(event.target.value) } })}
            />
          </Field>
        </div>
      </Card>

      <Card title="Audio" subtitle="System audio follows your Windows playback device - Bluetooth, USB or laptop speakers.">
        <Field label="Capture source">
          <select value={audio.deviceId} onChange={(event) => onSelectDevice(event.target.value)}>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label} {device.description ? `— ${device.description}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="settings__grid">
          <Field label="Silence before a segment ends" hint={`${audio.silenceMs} ms`}>
            <input
              type="range"
              min="400"
              max="2000"
              step="100"
              value={audio.silenceMs}
              onChange={(event) => onPatch({ audio: { silenceMs: Number(event.target.value) } })}
            />
          </Field>

          <Field label="Voice sensitivity" hint={audio.vadSensitivity > 0.7 ? 'Picks up quiet speech' : 'Ignores background noise'}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={audio.vadSensitivity}
              onChange={(event) => onPatch({ audio: { vadSensitivity: Number(event.target.value) } })}
            />
          </Field>

          <Field label="Max segment length" hint={`${Math.round(audio.maxSegmentMs / 1000)}s`}>
            <input
              type="range"
              min="5000"
              max="30000"
              step="1000"
              value={audio.maxSegmentMs}
              onChange={(event) => onPatch({ audio: { maxSegmentMs: Number(event.target.value) } })}
            />
          </Field>
        </div>
      </Card>

      <Card title="Behaviour">
        <Toggle
          checked={behaviour.answerOnlyQuestions}
          onChange={(value) => onPatch({ behaviour: { answerOnlyQuestions: value } })}
          label="Only answer detected questions"
          hint="Off means every transcript segment is sent to Gemini - more answers, more quota"
        />
        <Toggle
          checked={behaviour.sendTranscriptToCloud}
          onChange={(value) => onPatch({ behaviour: { sendTranscriptToCloud: value } })}
          label="Sync transcript to the cloud"
          hint="Off keeps transcripts on this PC; answers are still sent to your phone"
        />
        <Toggle
          checked={behaviour.autoStartCapture}
          onChange={(value) => onPatch({ behaviour: { autoStartCapture: value } })}
          label="Start listening automatically"
        />
        <Toggle
          checked={behaviour.autoLaunch}
          onChange={(value) => onPatch({ behaviour: { autoLaunch: value } })}
          label="Start with Windows"
          hint="Launches minimised to the system tray"
        />
        <Toggle
          checked={behaviour.minimiseToTray}
          onChange={(value) => onPatch({ behaviour: { minimiseToTray: value } })}
          label="Close to tray instead of quitting"
        />
        <Toggle
          checked={behaviour.notifyOnAnswer}
          onChange={(value) => onPatch({ behaviour: { notifyOnAnswer: value } })}
          label="Windows notification for new answers"
        />
        <Toggle
          checked={settings.ui?.alwaysOnTop}
          onChange={(value) => onPatch({ ui: { alwaysOnTop: value } })}
          label="Keep the dashboard on top"
        />
      </Card>

      <Card title="Account & Firebase" subtitle="Where answers are published for your phone to pick up">
        <div className="settings__grid">
          <Field label="Firebase API key">
            <input
              value={firebaseKey}
              onChange={(event) => setFirebaseKey(event.target.value)}
              spellCheck={false}
              placeholder="AIzaSy…"
            />
          </Field>
          <Field label="Firebase project ID">
            <input
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              spellCheck={false}
              placeholder="your-project-id"
            />
          </Field>
        </div>
        <div className="settings__row-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPatch({ firebase: { apiKey: firebaseKey.trim(), projectId: projectId.trim() } })}
            disabled={firebaseKey === settings.firebase?.apiKey && projectId === settings.firebase?.projectId}
          >
            Save & reconnect
          </Button>
        </div>

        <dl className="facts">
          <div>
            <dt>Signed in as</dt>
            <dd>{state.auth?.email || '—'}</dd>
          </div>
          <div>
            <dt>This device</dt>
            <dd>
              {settings.device?.name} <span className="muted">({settings.device?.id?.slice(0, 14)}…)</span>
            </dd>
          </div>
          <div>
            <dt>App version</dt>
            <dd>
              {info?.version} <span className="muted">Electron {info?.electron}</span>
            </dd>
          </div>
          <div>
            <dt>Secrets storage</dt>
            <dd>
              <Pill tone={settings.encryptionAvailable ? 'good' : 'warn'}>
                {settings.encryptionAvailable ? 'DPAPI encrypted' : 'memory only'}
              </Pill>
            </dd>
          </div>
        </dl>

        <div className="settings__footer">
          <Button variant="ghost" size="sm" onClick={onOpenLogs}>
            Open log folder
          </Button>
          <Button variant="danger" size="sm" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default SettingsPanel;
