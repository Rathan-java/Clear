'use strict';

/**
 * `npm run build` - produces release/ARA Meeting Assistant Setup.exe
 *
 * Why this wrapper exists: electron-builder unpacks its winCodeSign bundle,
 * which contains macOS symlinks. Creating a symlink on Windows needs either
 * Developer Mode or an elevated shell, so on a stock machine the normal build
 * dies with "Cannot create symbolic link: A required privilege is not held".
 *
 * So we probe for that privilege first:
 *   have it  -> normal build, exe metadata (icon, version, product name) is
 *               stamped by rcedit
 *   lack it  -> package without rcedit, then build the NSIS installer from the
 *               packaged folder. You still get a working installer; the only
 *               loss is the metadata embedded in Clear.exe itself.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const builder = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');

const run = (command, args, extraEnv = {}) => {
  const useShell = process.platform === 'win32';
  console.log(`\n> ${command} ${args.join(' ')}\n`);

  // cmd.exe splits on the spaces in "…/Clear - AI Assistance/…", so quote
  // anything that contains one when we go through a shell.
  const quote = (value) => (useShell && /\s/.test(value) ? `"${value}"` : value);

  const result = spawnSync(quote(command), args.map(quote), {
    cwd: root,
    stdio: 'inherit',
    shell: useShell,
    env: { ...process.env, ...extraEnv },
  });
  return result.status === 0;
};

/** Can this process create a symlink? Developer Mode or admin grants it. */
const canCreateSymlinks = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-symlink-'));
  try {
    fs.writeFileSync(path.join(dir, 'target.txt'), 'x');
    fs.symlinkSync(path.join(dir, 'target.txt'), path.join(dir, 'link.txt'));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const main = () => {
  if (!run(process.execPath, [path.join('scripts', 'generate-icons.js')])) process.exit(1);
  if (!run('npx', ['vite', 'build'])) process.exit(1);

  const privileged = canCreateSymlinks();

  if (privileged) {
    if (!run(builder, ['--win', '--x64'])) process.exit(1);
  } else {
    console.log(
      [
        '',
        '  ! Symlink creation is not permitted for this shell.',
        '    Building without rcedit metadata stamping. The installer is fully',
        '    functional; Clear.exe just keeps the generic Electron file details.',
        '',
        '    To get the fully stamped build, either:',
        '      - turn on Settings > System > For developers > Developer Mode, or',
        '      - run this build from an Administrator terminal',
        '',
      ].join('\n')
    );

    const noEdit = ['-c.win.signAndEditExecutable=false'];
    const env = { CSC_IDENTITY_AUTO_DISCOVERY: 'false' };

    if (!run(builder, ['--win', '--dir', '--x64', ...noEdit], env)) process.exit(1);
    if (!run(builder, ['--prepackaged', path.join('release', 'win-unpacked'), '--win', 'nsis', ...noEdit], env)) {
      process.exit(1);
    }
  }

  const installer = path.join(root, 'release', 'ARA Meeting Assistant Setup.exe');
  if (!fs.existsSync(installer)) {
    console.error('\nBuild finished but the installer is missing. Check the log above.\n');
    process.exit(1);
  }

  const sizeMb = (fs.statSync(installer).size / 1024 / 1024).toFixed(1);
  console.log(`\n  Built release/ARA Meeting Assistant Setup.exe  (${sizeMb} MB)\n`);
};

main();
