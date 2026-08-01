'use strict';

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * System tray: status at a glance, and the controls you actually need while a
 * meeting is running. Icon colour encodes state - green live, slate idle,
 * red when the backend link is down.
 */

const loadIcons = () => {
  const generated = path.join(__dirname, 'icons.js');
  if (fs.existsSync(generated)) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(generated);
  }
  return null;
};

class TrayManager {
  constructor({ app, getWindow, pipeline, logger, onQuit }) {
    this.app = app;
    this.getWindow = getWindow;
    this.pipeline = pipeline;
    this.log = logger;
    this.onQuit = onQuit;
    this.tray = null;
    this.icons = loadIcons();
    this.lastKey = null;
  }

  icon(name) {
    if (this.icons?.[name]) {
      const image = nativeImage.createFromBuffer(Buffer.from(this.icons[name].x32, 'base64'));
      return image.resize({ width: 16, height: 16 });
    }
    // Fallback: a 1x1 transparent pixel keeps Tray happy if icons were not generated.
    return nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    );
  }

  create() {
    if (this.tray) return this.tray;

    this.tray = new Tray(this.icon('idle'));
    this.tray.setToolTip('Clear - AI Meeting Assistant');

    this.tray.on('double-click', () => this.showWindow());
    this.tray.on('click', () => this.showWindow());

    this.update(this.pipeline.snapshot());
    return this.tray;
  }

  showWindow() {
    const window = this.getWindow();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  update(state) {
    if (!this.tray) return;

    const connected = state.connection?.connected;
    const key = `${state.running}-${connected}-${state.thinking}-${state.connection?.presence?.mobile?.length || 0}`;

    const iconName = !connected ? 'offline' : state.running ? 'live' : 'idle';
    if (this.lastKey !== key) {
      this.tray.setImage(this.icon(iconName));
      this.lastKey = key;
    }

    const phones = state.connection?.presence?.mobile?.length || 0;
    const latency = state.connection?.latencyMs;

    this.tray.setToolTip(
      [
        'Clear - AI Meeting Assistant',
        state.running ? 'Listening' : 'Idle',
        connected ? `Backend online${latency != null ? ` (${latency} ms)` : ''}` : 'Backend offline',
        `${phones} phone${phones === 1 ? '' : 's'} connected`,
      ].join('\n')
    );

    const answer = state.answer;
    const menu = Menu.buildFromTemplate([
      {
        label: state.running ? 'Listening to system audio' : 'Not listening',
        enabled: false,
      },
      {
        label: connected ? `Backend online${latency != null ? ` - ${latency} ms` : ''}` : 'Backend offline',
        enabled: false,
      },
      { label: `Phones paired: ${phones}`, enabled: false },
      { type: 'separator' },
      {
        label: state.running ? 'Stop listening' : 'Start listening',
        accelerator: 'CommandOrControl+Shift+L',
        click: () => this.pipeline.toggle().catch((error) => this.log?.error(error.message)),
      },
      {
        label: 'Open dashboard',
        click: () => this.showWindow(),
      },
      { type: 'separator' },
      {
        label: answer ? `Last answer: ${truncate(answer.question || answer.answer, 42)}` : 'No answers yet',
        enabled: Boolean(answer),
        click: () => this.showWindow(),
      },
      { type: 'separator' },
      {
        label: 'Quit Clear',
        click: () => this.onQuit(),
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  notify(title, body) {
    if (!this.tray) return;
    try {
      this.tray.displayBalloon({ title, content: body, iconType: 'info' });
    } catch {
      /* balloons are Windows-only and best effort */
    }
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

const truncate = (text, max) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

module.exports = { TrayManager };
