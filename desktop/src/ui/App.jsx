import React, { useCallback, useEffect, useState } from 'react';
import installCaptureBridge from './capture/captureBridge.js';
import StatusBar from './components/StatusBar.jsx';
import LoginView from './components/LoginView.jsx';
import LivePanel from './components/LivePanel.jsx';
import PhonePanel from './components/PhonePanel.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import LogsPanel from './components/LogsPanel.jsx';

const api = window.clear;

const App = () => {
  const [state, setState] = useState(null);
  const [settings, setSettings] = useState(null);
  const [info, setInfo] = useState(null);
  const [devices, setDevices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [tab, setTab] = useState('live');
  const [toast, setToast] = useState(null);

  // The renderer owns the audio engine; install it before anything else so the
  // main process can enumerate devices as soon as it boots.
  useEffect(() => {
    installCaptureBridge();
  }, []);

  const refreshDevices = useCallback(async () => {
    const result = await api.invoke('devices:list');
    if (result.ok) setDevices(result.devices);
    return result;
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const [initialState, initialSettings, appInfo, initialLogs] = await Promise.all([
        api.invoke('app:state'),
        api.invoke('settings:get'),
        api.invoke('app:info'),
        api.invoke('app:logs', 150),
      ]);
      if (!mounted) return;
      setState(initialState);
      setSettings(initialSettings);
      setInfo(appInfo);
      setLogs(initialLogs);
      refreshDevices();
    })();

    const offState = api.on('app:state', (next) => setState(next));
    const offLog = api.on('app:log', (entry) => setLogs((prev) => [...prev.slice(-299), entry]));
    const offAnswer = api.on('app:answer', (answer) => {
      setToast({ tone: 'good', message: answer.question ? `Answered: ${answer.question}` : 'New answer generated' });
    });

    return () => {
      mounted = false;
      offState();
      offLog();
      offAnswer();
    };
  }, [refreshDevices]);

  // Surface pipeline notices as toasts.
  useEffect(() => {
    if (!state?.notice) return;
    setToast({ tone: state.notice.type, message: state.notice.message });
  }, [state?.notice?.message, state?.notice?.type]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const patchSettings = useCallback(async (partial) => {
    const next = await api.invoke('settings:patch', partial);
    setSettings(next);
    return next;
  }, []);

  const handlers = {
    onToggle: async () => {
      const result = await api.invoke('capture:toggle');
      if (!result.ok) setToast({ tone: 'error', message: result.error });
    },
    onClear: () => api.invoke('transcript:clear'),
    onAsk: async (text) => {
      const result = await api.invoke('ask:manual', text);
      if (!result.ok) setToast({ tone: 'error', message: result.error });
    },
    onSelectDevice: async (deviceId) => {
      const result = await api.invoke('devices:select', deviceId);
      if (!result.ok) setToast({ tone: 'error', message: result.error });
    },
    onRefreshDevices: refreshDevices,
    onReconnect: async () => {
      const result = await api.invoke('connection:reconnect');
      setToast(
        result.ok
          ? { tone: 'good', message: 'Reconnected' }
          : { tone: 'error', message: result.error }
      );
    },
    onTestGemini: () => api.invoke('gemini:test'),
    onLogout: async () => {
      await api.invoke('auth:logout');
      setTab('live');
    },
    onOpenLogs: () => api.invoke('system:openLogs'),
    onRefreshLogs: async () => setLogs(await api.invoke('app:logs', 200)),
  };

  if (!state || !settings) {
    return (
      <div className="boot">
        <span className="spinner spinner--lg" />
        <p>Starting Clear…</p>
      </div>
    );
  }

  if (!state.auth?.signedIn) {
    return (
      <div className="app app--login">
        <LoginView
          settings={settings}
          onLogin={async (credentials) => {
            const result = await api.invoke('auth:login', credentials);
            if (result.ok) {
              setState(await api.invoke('app:state'));
              setSettings(await api.invoke('settings:get'));
              refreshDevices();
            }
            return result;
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <StatusBar state={state} tab={tab} setTab={setTab} onReconnect={handlers.onReconnect} />

      <main className="app__main">
        {tab === 'live' && (
          <LivePanel
            state={state}
            devices={devices}
            onToggle={handlers.onToggle}
            onClear={handlers.onClear}
            onAsk={handlers.onAsk}
            onSelectDevice={handlers.onSelectDevice}
            onRefreshDevices={handlers.onRefreshDevices}
          />
        )}

        {tab === 'pair' && <PhonePanel state={state} />}

        {tab === 'settings' && (
          <SettingsPanel
            settings={settings}
            info={info}
            devices={devices}
            state={state}
            onPatch={patchSettings}
            onTestGemini={handlers.onTestGemini}
            onSelectDevice={handlers.onSelectDevice}
            onLogout={handlers.onLogout}
            onOpenLogs={handlers.onOpenLogs}
          />
        )}

        {tab === 'logs' && (
          <LogsPanel logs={logs} onOpenLogs={handlers.onOpenLogs} onRefresh={handlers.onRefreshLogs} />
        )}
      </main>

      {toast && <div className={`toast toast--${toast.tone}`}>{toast.message}</div>}
    </div>
  );
};

export default App;
