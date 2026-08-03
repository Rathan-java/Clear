import React, { useState } from 'react';
import { Button, Card, Field, Pill, Toggle } from './ui.jsx';

const SettingsPanel = ({
  settings,
  info,
  devices,
  state,
  aiInfo,
  onPatch,
  onTestAi,
  onSelectDevice,
  onLogout,
  onOpenLogs,
}) => {
  const [keyDraft, setKeyDraft] = useState('');
  const [firebaseKey, setFirebaseKey] = useState(settings.firebase?.apiKey || '');
  const [projectId, setProjectId] = useState(settings.firebase?.projectId || '');
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  const ai = settings.ai || {};
  const behaviour = settings.behaviour || {};
  const audio = settings.audio || {};

  const activeId = ai.provider || 'gemini';
  const provider = aiInfo?.providers?.find((p) => p.id === activeId) || {};
  const providerConfig = ai[activeId] || {};
  const storedKey = settings.keys?.[activeId] || {};

  const saveKey = async () => {
    if (!keyDraft.trim()) return;
    await onPatch({ [`${activeId}ApiKey`]: keyDraft.trim() });
    setKeyDraft('');
    setTest(null);
  };

  const runTest = async () => {
    setTesting(true);
    setTest(await onTestAi());
    setTesting(false);
  };

  return (
    <div className="settings">
      <Card
        title="AI provider"
        subtitle="Transcription and answers both run on the provider you pick here. Your key never leaves this PC."
      >
        <div className="provider-switch">
          {(aiInfo?.providers || []).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`provider-option${activeId === item.id ? ' is-active' : ''}`}
              onClick={() => onPatch({ ai: { provider: item.id } })}
            >
              <strong>{item.label}</strong>
              {item.configured ? <Pill tone="good">key saved</Pill> : <Pill tone="neutral">no key</Pill>}
            </button>
          ))}
        </div>

        <div className="settings__row">
          <Field
            label={`${provider.label || 'Provider'} API key`}
            hint={
              storedKey.present
                ? `Stored: ${storedKey.preview}`
                : `${provider.keyHint || ''} — get one at ${provider.keyUrl || ''}`
            }
          >
            <input
              type="password"
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              placeholder={storedKey.present ? '•••••••••••••• (replace)' : provider.keyHint}
            />
          </Field>
          <div className="settings__row-actions">
            <Button variant="primary" size="sm" onClick={saveKey} disabled={!keyDraft.trim()}>
              Save key
            </Button>
            <Button variant="ghost" size="sm" onClick={runTest} loading={testing} disabled={!storedKey.present}>
              Test
            </Button>
          </div>
        </div>

        {test && (
          <p className={`alert ${test.ok ? 'alert--good' : 'alert--error'}`}>
            {test.ok ? `Connected in ${test.latencyMs} ms using ${test.model}` : test.error}
          </p>
        )}

        {provider.keyUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.clear.invoke('system:openExternal', provider.keyUrl)}
          >
            Get a {provider.label} key ↗
          </Button>
        )}

        <div className="settings__grid">
          <Field label="Answer model">
            <select
              value={providerConfig.model}
              onChange={(event) => onPatch({ ai: { [activeId]: { model: event.target.value } } })}
            >
              {(provider.answerModels || []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Transcription model">
            <select
              value={providerConfig.transcribeModel}
              onChange={(event) => onPatch({ ai: { [activeId]: { transcribeModel: event.target.value } } })}
            >
              {(provider.transcribeModels || []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Creativity" hint={`temperature ${providerConfig.temperature}`}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={providerConfig.temperature ?? 0.3}
              onChange={(event) =>
                onPatch({ ai: { [activeId]: { temperature: Number(event.target.value) } } })
              }
            />
          </Field>
        </div>
      </Card>

      <Card title="Answer length" subtitle="How much the assistant says for each question">
        <div className="style-switch">
          {(aiInfo?.styles || []).map((style) => (
            <button
              key={style.id}
              type="button"
              className={`style-option${(ai.answerStyle || 'balanced') === style.id ? ' is-active' : ''}`}
              onClick={() => onPatch({ ai: { answerStyle: style.id } })}
            >
              <strong>{style.label}</strong>
              <span>{style.hint}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Audio" subtitle="System audio follows your Windows playback device - Bluetooth, USB or speakers.">
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

          <Field
            label="Voice sensitivity"
            hint={audio.vadSensitivity > 0.7 ? 'Picks up quiet speech' : 'Ignores background noise'}
          >
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
          hint="Off means every transcript segment is sent to the model - more answers, more quota"
        />
        <Toggle
          checked={behaviour.sendTranscriptToCloud}
          onChange={(value) => onPatch({ behaviour: { sendTranscriptToCloud: value } })}
          label="Sync transcript to the cloud"
          hint="Off keeps transcripts on this PC; answers still reach your phone"
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
