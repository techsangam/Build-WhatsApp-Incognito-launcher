const { app, BrowserWindow, ipcMain, session } = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_NAME = 'WhatsApp Web Secure Launcher';
const WHATSAPP_URL = 'https://web.whatsapp.com';
const LAUNCHER_PARTITION = 'whatsapp-launcher-temporary-session';
const TEMP_DIR_PREFIX = 'wa-web-launcher-';
const TEMP_PROFILE_PREFIX = 'wa-web-profile-';

const electronTempDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIR_PREFIX));

let mainWindow = null;
let activeSession = null;
let isQuitting = false;

app.setName(APP_NAME);
app.setPath('userData', electronTempDir);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeSend(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function normalizePathValue(value) {
  if (!value) {
    return '';
  }

  return value.trim().replace(/^"(.*)"$/, '$1');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectChromeCandidates(customPath) {
  const envCandidates = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] &&
      path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];

  const candidates = [customPath, ...envCandidates].map(normalizePathValue);

  if (process.platform === 'win32') {
    try {
      const whereResult = spawnSync('where.exe', ['chrome'], {
        encoding: 'utf8',
        windowsHide: true
      });

      if (whereResult.status === 0 && whereResult.stdout) {
        candidates.push(...whereResult.stdout.split(/\r?\n/));
      }
    } catch (error) {
      // Ignore detection errors and fall back to known install paths.
    }
  }

  return unique(candidates);
}

function resolveChromePath(customPath = '') {
  const candidates = collectChromeCandidates(customPath);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (error) {
      // Ignore invalid path candidates.
    }
  }

  return '';
}

function buildState(overrides = {}) {
  const detectedChromePath = resolveChromePath('');
  const defaultStatus = activeSession ? 'running' : detectedChromePath ? 'ready' : 'missing';
  const defaultMessage = activeSession
    ? 'Temporary WhatsApp session is active in Chrome Incognito.'
    : detectedChromePath
      ? 'Ready to open a fresh WhatsApp Web session.'
      : 'Chrome was not auto-detected. Enter the path to chrome.exe and try again.';

  return {
    status: defaultStatus,
    message: defaultMessage,
    isRunning: Boolean(activeSession),
    detectedChromePath,
    activeChromePath: activeSession ? activeSession.chromePath : '',
    url: WHATSAPP_URL,
    ...overrides
  };
}

async function cleanupDirectory(targetPath, retries = 8) {
  if (!targetPath) {
    return;
  }

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      await delay(250);
    }
  }
}

async function clearElectronStorage() {
  const launcherSession = session.fromPartition(LAUNCHER_PARTITION);
  const tasks = [
    launcherSession.clearCache(),
    launcherSession.clearStorageData(),
    session.defaultSession.clearCache(),
    session.defaultSession.clearStorageData()
  ];

  await Promise.allSettled(tasks);
}

async function finalizeSession(sessionInfo, nextState) {
  if (!sessionInfo || sessionInfo.cleanedUp) {
    return;
  }

  sessionInfo.cleanedUp = true;

  if (activeSession && activeSession.process === sessionInfo.process) {
    activeSession = null;
  }

  await cleanupDirectory(sessionInfo.profileDir);
  if (sessionInfo.finish) {
    sessionInfo.finish();
  }
  safeSend('launcher:state', buildState(nextState));
}

async function launchChrome(customPath = '') {
  if (activeSession) {
    return {
      ok: false,
      message: 'A temporary WhatsApp Web session is already running.'
    };
  }

  const chromePath = resolveChromePath(customPath);

  if (!chromePath) {
    const message = 'Chrome could not be found. Enter the full path to chrome.exe and try again.';
    safeSend('launcher:state', buildState({ status: 'missing', message }));
    return { ok: false, message };
  }

  const profileDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), TEMP_PROFILE_PREFIX));
  const args = [
    `--user-data-dir=${profileDir}`,
    '--incognito',
    '--new-window',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--disable-sync',
    WHATSAPP_URL
  ];

  return new Promise((resolve) => {
    let launchResolved = false;
    const child = spawn(chromePath, args, {
      stdio: 'ignore',
      windowsHide: false
    });

    const sessionInfo = {
      process: child,
      chromePath,
      profileDir,
      cleanedUp: false,
      closeMessage: 'Chrome window closed. Session destroyed and temporary data removed.'
    };
    sessionInfo.finishedPromise = new Promise((resolveFinished) => {
      sessionInfo.finish = resolveFinished;
    });

    child.once('spawn', () => {
      activeSession = sessionInfo;
      safeSend(
        'launcher:state',
        buildState({
          status: 'running',
          message: 'WhatsApp Web opened in a fresh Chrome Incognito window.',
          activeChromePath: chromePath
        })
      );

      if (!launchResolved) {
        launchResolved = true;
        resolve({ ok: true, chromePath });
      }
    });

    child.once('error', async (error) => {
      await finalizeSession(sessionInfo, {
        status: 'error',
        message: `Unable to launch Chrome: ${error.message}`
      });

      if (!launchResolved) {
        launchResolved = true;
        resolve({ ok: false, message: `Unable to launch Chrome: ${error.message}` });
      }
    });

    child.once('exit', async () => {
      await finalizeSession(sessionInfo, {
        status: isQuitting ? 'closing' : 'ready',
        message: sessionInfo.closeMessage
      });

      if (!launchResolved) {
        launchResolved = true;
        resolve({
          ok: false,
          message: 'Chrome closed before the launcher could confirm the session.'
        });
      }
    });
  });
}

function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve();
      return;
    }

    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      });

      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
      return;
    }

    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      resolve();
      return;
    }

    resolve();
  });
}

async function closeChromeSession(reason = 'Session closed and cleaned up.') {
  if (!activeSession) {
    return {
      ok: true,
      message: 'No active session to close.'
    };
  }

  const sessionInfo = activeSession;
  sessionInfo.closeMessage = reason;

  await killProcessTree(sessionInfo.process.pid);
  await Promise.race([sessionInfo.finishedPromise, delay(4000)]);

  if (activeSession && activeSession.process === sessionInfo.process) {
    await finalizeSession(sessionInfo, {
      status: isQuitting ? 'closing' : 'ready',
      message: reason
    });
  }

  return { ok: true, message: reason };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: false,
    autoHideMenuBar: true,
    show: false,
    title: APP_NAME,
    backgroundColor: '#f2efe6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: LAUNCHER_PARTITION
    }
  });

  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('launcher:get-state', async () => buildState());
ipcMain.handle('launcher:open', async (_event, customPath) => launchChrome(customPath));
ipcMain.handle('launcher:close', async () => closeChromeSession());

app.whenReady().then(async () => {
  await createWindow();
  safeSend('launcher:state', buildState({ status: 'launching', message: 'Opening Chrome...' }));
  await launchChrome();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;

  Promise.allSettled([
    closeChromeSession('App closed. Temporary Chrome profile removed.'),
    clearElectronStorage()
  ])
    .then(() => cleanupDirectory(electronTempDir))
    .finally(() => {
      app.exit(0);
    });
});
