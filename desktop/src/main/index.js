'use strict';

const path = require('path');
const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  session,
  desktopCapturer,
  globalShortcut,
  dialog,
  Notification,
  safeStorage,
  nativeImage,
} = require('electron');

const logger = require('../core/logger');
const { SettingsStore } = require('../settings/SettingsStore');
const { setAutoLaunch, isAutoLaunchEnabled, wasAutoLaunched } = require('../settings/autoLaunch');
const { FirebaseAuth } = require('../firebase/FirebaseAuth');
const { FirestoreClient } = require('../firebase/FirestoreClient');
const { FirestoreSync } = require('../firebase/FirestoreSync');
const { AiService } = require('../ai');
const { ProfileStore } = require('../profile/ProfileStore');
const { SpeechService } = require('../speech/SpeechService');
const { AudioCaptureService } = require('../audio/AudioCaptureService');
const { Pipeline } = require('../core/Pipeline');
const { TrayManager } = require('../tray/TrayManager');

// Single instance: launching again just focuses the running app.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const DEV_SERVER = process.env.CLEAR_DEV_SERVER || null;

let mainWindow = null;
let tray = null;
let quitting = false;
let services = null;

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    title: 'Clear',
    icon: appIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  if (DEV_SERVER) {
    window.loadURL(DEV_SERVER);
    // Opt-in only: a detached DevTools window on every launch looks like the
    // app failed to start. Use CLEAR_DEVTOOLS=1, or Ctrl+Shift+I once running.
    if (process.env.CLEAR_DEVTOOLS === '1') window.webContents.openDevTools({ mode: 'detach' });
  } else {
    window.loadFile(path.join(__dirname, '..', '..', 'dist', 'ui', 'index.html'));
  }

  // Minimise stays a normal minimise - the window keeps its taskbar button.
  // Hiding here meant Win+D or "Show desktop" made the app vanish completely,
  // leaving only a tray icon most people never look for. Closing is what sends
  // it to the tray (see below), which is the behaviour people expect from a
  // background app.

  window.on('close', (event) => {
    if (!quitting && services?.settings.get('behaviour.minimiseToTray')) {
      event.preventDefault();
      window.hide();
      tray?.notify('Clear is still running', 'Listening continues in the background. Right-click the tray icon to quit.');
    }
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  // External links open in the real browser, never in the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return window;
};

const appIcon = () => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const icons = require('../tray/icons.js');
    return nativeImage.createFromBuffer(Buffer.from(icons.live.x32, 'base64'));
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// System audio (WASAPI loopback through Chromium)
// ---------------------------------------------------------------------------

const configureLoopbackAudio = () => {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        // 'loopback' = WASAPI loopback of the current default playback device.
        // We hand back a screen source because Chromium requires a video track
        // to exist; the renderer stops it immediately and keeps only audio.
        callback({ video: sources[0], audio: 'loopback' });
      } catch (error) {
        log.error('Loopback capture was refused', { error: error.message });
        callback({});
      }
    },
    { useSystemPicker: false }
  );

  // Microphone / specific-device capture still needs the normal permission grant.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(['media', 'audioCapture', 'notifications', 'display-capture'].includes(permission));
  });
};

const log = logger.scoped('main');

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const buildServices = () => {
  const settings = new SettingsStore({
    userDataPath: app.getPath('userData'),
    safeStorage,
    logger: logger.scoped('settings'),
  });

  const auth = new FirebaseAuth({ settings, logger: logger.scoped('auth') });
  const firestore = new FirestoreClient({ auth, settings, logger: logger.scoped('firestore') });

  // The profile is read lazily by the AI service, so the two can be built in
  // either order without a circular dependency.
  let profile = null;

  const ai = new AiService({
    getApiKey: (provider) => settings.getSecret(`${provider}ApiKey`),
    getConfig: () => settings.get('ai'),
    getProfile: () => profile?.get() || {},
    logger: logger.scoped('ai'),
  });

  profile = new ProfileStore({
    userDataPath: app.getPath('userData'),
    ai,
    logger: logger.scoped('profile'),
  });

  const speech = new SpeechService({ ai, settings, logger: logger.scoped('speech') });

  const audio = new AudioCaptureService({
    getWindow: () => mainWindow,
    settings,
    logger: logger.scoped('audio'),
  });

  const sync = new FirestoreSync({ auth, firestore, settings, logger: logger.scoped('sync') });

  const pipeline = new Pipeline({ audio, speech, ai, sync, auth, settings, logger: logger.scoped('pipeline') });

  return { settings, auth, firestore, ai, profile, speech, audio, sync, pipeline };
};

const broadcast = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

const registerIpc = () => {
  const { settings, auth, ai, profile, audio, sync, pipeline } = services;

  const ok = (data = {}) => ({ ok: true, ...data });
  const fail = (error) => ({ ok: false, error: error.message || String(error) });

  ipcMain.handle('app:state', () => pipeline.snapshot());
  ipcMain.handle('app:logs', (_event, count) => logger.recent(count || 120));
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    userData: app.getPath('userData'),
    logFile: logger.logFilePath(),
    autoLaunch: isAutoLaunchEnabled(app),
    encryptionAvailable: settings.encryptionAvailable,
  }));

  ipcMain.handle('settings:get', () => settings.public());
  ipcMain.handle('settings:patch', async (_event, partial) => {
    const beforeProject = settings.get('firebase.projectId');
    const result = settings.patch(partial || {});

    if (partial?.behaviour && 'autoLaunch' in partial.behaviour) {
      setAutoLaunch(app, partial.behaviour.autoLaunch, log);
    }
    if (partial?.ui && 'alwaysOnTop' in partial.ui) {
      mainWindow?.setAlwaysOnTop(Boolean(partial.ui.alwaysOnTop));
    }
    if (partial?.firebase?.projectId && partial.firebase.projectId !== beforeProject && auth.signedIn) {
      sync.connect().catch((error) => log.warn('Reconnect after project change failed', { error: error.message }));
    }

    pipeline.emitState();
    return result;
  });
  ipcMain.handle('settings:reset', () => {
    settings.reset();
    return settings.public();
  });

  ipcMain.handle('auth:login', async (_event, { email, password, firebase }) => {
    try {
      // The login screen can carry the Firebase config on first run.
      if (firebase?.apiKey && firebase?.projectId) settings.patch({ firebase });

      const user = await auth.signIn({ email, password });
      await sync.connect();
      pipeline.emitState();
      return ok({ user });
    } catch (error) {
      log.error('Sign-in failed', { code: error.code, error: error.message });
      return fail(error);
    }
  });

  ipcMain.handle('auth:logout', async () => {
    await pipeline.stop({ endMeeting: true }).catch(() => {});
    sync.disconnect();
    await auth.signOut();
    pipeline.emitState();
    return ok();
  });

  ipcMain.handle('devices:list', async () => {
    try {
      return ok({ devices: await audio.listAudioDevices() });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('devices:select', async (_event, deviceId) => {
    try {
      return ok({ selected: await audio.selectDevice(deviceId) });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('capture:start', async () => {
    try {
      await pipeline.start();
      return ok();
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('capture:stop', async () => {
    try {
      await pipeline.stop();
      return ok();
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('capture:toggle', async () => {
    try {
      await pipeline.toggle();
      return ok({ running: pipeline.running });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('transcript:clear', () => {
    pipeline.clearTranscript();
    return ok();
  });

  ipcMain.handle('ai:describe', () => ai.describe());

  ipcMain.handle('ai:test', async () => {
    try {
      return ok(await ai.testConnection());
    } catch (error) {
      return fail(error);
    }
  });

  // ---- candidate profile / CV --------------------------------------------

  ipcMain.handle('profile:get', (_event, options) => profile.public(options || {}));

  ipcMain.handle('profile:patch', (_event, partial) => ok({ profile: profile.patch(partial || {}) }));

  ipcMain.handle('profile:clearResume', () => ok({ profile: profile.clearResume() }));

  ipcMain.handle('profile:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose your CV',
      properties: ['openFile'],
      filters: [
        { name: 'CV / résumé', extensions: ['pdf', 'docx', 'txt', 'md'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };

    try {
      return ok({ profile: await profile.importFile(result.filePaths[0]) });
    } catch (error) {
      log.error('CV import failed', { error: error.message });
      return fail(error);
    }
  });

  ipcMain.handle('ask:manual', async (_event, text) => {
    try {
      const answer = await pipeline.answer({ transcript: text, question: text, manual: true });
      return answer ? ok({ answer }) : fail(new Error('No answer was generated'));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('history:list', async (_event, params) => {
    try {
      return ok({ answers: await sync.history(params || {}) });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('connection:reconnect', async () => {
    try {
      await sync.connect();
      return ok(sync.status());
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('window:minimise', () => {
    mainWindow?.minimize();
    return ok();
  });
  ipcMain.handle('window:hide', () => {
    mainWindow?.hide();
    return ok();
  });
  ipcMain.handle('window:setAlwaysOnTop', (_event, value) => {
    mainWindow?.setAlwaysOnTop(Boolean(value));
    settings.patch({ ui: { alwaysOnTop: Boolean(value) } });
    return ok();
  });
  ipcMain.handle('app:quit', () => {
    quitApp();
    return ok();
  });

  ipcMain.handle('system:openLogs', () => {
    const file = logger.logFilePath();
    if (file) shell.showItemInFolder(file);
    return ok();
  });
  ipcMain.handle('system:openExternal', (_event, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return ok();
  });

  // Audio engine messages (device lists, PCM frames, errors).
  ipcMain.on('capture:message', (_event, message) => audio.handleRendererMessage(message));
};

const wireNotifications = () => {
  const { pipeline, settings } = services;

  let lastStateAt = 0;
  pipeline.on('state', (state, { quiet } = {}) => {
    tray?.update(state);
    // Level updates arrive ~10x/second; do not flood the renderer with full state.
    const now = Date.now();
    if (quiet && now - lastStateAt < 200) return;
    lastStateAt = now;
    broadcast('app:state', state);
  });

  pipeline.on('answer', (answer) => {
    broadcast('app:answer', answer);

    if (settings.get('behaviour.notifyOnAnswer') && Notification.isSupported() && !mainWindow?.isVisible()) {
      const notification = new Notification({
        title: answer.question ? truncate(answer.question, 60) : 'Clear has an answer',
        body: truncate(answer.answer, 180),
        silent: false,
      });
      notification.on('click', () => {
        mainWindow?.show();
        mainWindow?.focus();
      });
      notification.show();
    }
  });

  logger.onEntry((entry) => {
    if (entry.level === 'debug') return;
    broadcast('app:log', entry);
  });
};

const bootstrap = async () => {
  const { settings, auth, sync, pipeline, audio } = services;

  // Restore the session silently if we still hold a refresh token.
  if (auth.signedIn && auth.configured) {
    try {
      await auth.ensureToken();
      await sync.connect();
      log.info('Session restored', { uid: auth.uid });
    } catch (error) {
      log.warn('Could not restore the session', { error: error.message });
    }
  }

  // Reflect the real Windows state rather than what we last wrote.
  const actualAutoLaunch = isAutoLaunchEnabled(app);
  if (actualAutoLaunch !== settings.get('behaviour.autoLaunch')) {
    settings.patch({ behaviour: { autoLaunch: actualAutoLaunch } });
  }

  // The renderer owns the audio engine, so wait for its bridge to attach
  // before asking it what devices exist.
  audio.whenReady().then((ready) => {
    if (!ready) return log.warn('Audio engine did not report ready - device list may be empty');
    return audio
      .listAudioDevices()
      .catch((error) => log.warn('Device enumeration failed', { error: error.message }));
  });

  if (settings.get('behaviour.autoStartCapture') && auth.signedIn) {
    setTimeout(() => {
      pipeline.start().catch((error) => log.warn('Auto-start failed', { error: error.message }));
    }, 2500);
  }

  pipeline.emitState();
};

const quitApp = async () => {
  quitting = true;
  try {
    await services?.pipeline.stop({ endMeeting: true });
  } catch {
    /* shutting down anyway */
  }
  services?.sync.destroy();
  services?.audio.destroy();
  tray?.destroy();
  app.quit();
};

// ---------------------------------------------------------------------------

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  logger.init(app.getPath('userData'));
  log.info('Clear starting', { version: app.getVersion(), electron: process.versions.electron });

  app.setAppUserModelId('app.clear.meetingassistant');
  configureLoopbackAudio();

  services = buildServices();
  mainWindow = createWindow();
  registerIpc();
  wireNotifications();

  tray = new TrayManager({
    app,
    getWindow: () => mainWindow,
    pipeline: services.pipeline,
    logger: logger.scoped('tray'),
    onQuit: quitApp,
  });
  tray.create();

  const startHidden = wasAutoLaunched(app) || services.settings.get('behaviour.startMinimised');
  log.info('Window created', { startHidden, devServer: Boolean(DEV_SERVER) });

  let shown = false;
  const reveal = (reason) => {
    if (shown || startHidden || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    mainWindow.show();
    mainWindow.focus();
    if (services.settings.get('ui.alwaysOnTop')) mainWindow.setAlwaysOnTop(true);
    log.info('Window shown', { reason });
  };

  mainWindow.once('ready-to-show', () => reveal('ready-to-show'));

  // Safety net: ready-to-show does not fire reliably in every situation - a
  // slow dev server, a renderer that throws before its first paint, or certain
  // GPU/compositor states. Never leave the user staring at an empty desktop.
  setTimeout(() => reveal('timeout'), 5000);

  globalShortcut.register('CommandOrControl+Shift+L', () => {
    services.pipeline.toggle().catch((error) => log.error('Hotkey toggle failed', { error: error.message }));
  });
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  await bootstrap();
  log.info('Startup complete');
}).catch((error) => {
  // Without this, anything that throws during startup vanishes silently and
  // the app just never appears.
  log.error('Startup failed', { error: error.message, stack: error.stack });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
});

app.on('window-all-closed', () => {
  // Tray app: closing the dashboard does not quit.
  if (process.platform !== 'win32' && !services?.settings.get('behaviour.minimiseToTray')) app.quit();
});

app.on('activate', () => {
  if (!mainWindow) {
    mainWindow = createWindow();
    mainWindow.once('ready-to-show', () => mainWindow.show());
  }
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception in main', { error: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection in main', {
    error: reason?.message || String(reason),
    stack: reason?.stack,
  });
});

const truncate = (text, max) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
