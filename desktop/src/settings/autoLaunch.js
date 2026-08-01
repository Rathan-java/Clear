'use strict';

const path = require('path');

/**
 * "Start with Windows" without a native dependency: Electron writes the
 * Run registry key for us. In dev (unpackaged) we point the entry at
 * electron.exe with the project path so it still behaves sensibly.
 */

const isPackaged = (app) => app.isPackaged;

const getOptions = (app, enabled) => {
  const options = {
    openAtLogin: enabled,
    openAsHidden: true,
    // --autostart lets the app know it was launched by Windows, so it can
    // start minimised to the tray instead of popping a window in your face.
    args: ['--autostart'],
  };

  if (!isPackaged(app)) {
    options.path = process.execPath;
    options.args = [path.resolve(process.argv[1] || '.'), '--autostart'];
  }

  return options;
};

const setAutoLaunch = (app, enabled, logger) => {
  try {
    app.setLoginItemSettings(getOptions(app, enabled));
    logger?.info('Auto-launch updated', { enabled });
    return true;
  } catch (error) {
    logger?.error('Failed to update auto-launch', { error: error.message });
    return false;
  }
};

const isAutoLaunchEnabled = (app) => {
  try {
    return Boolean(app.getLoginItemSettings(getOptions(app, true)).openAtLogin);
  } catch {
    return false;
  }
};

const wasAutoLaunched = (app) =>
  process.argv.includes('--autostart') || Boolean(app.getLoginItemSettings().wasOpenedAtLogin);

module.exports = { setAutoLaunch, isAutoLaunchEnabled, wasAutoLaunched };
