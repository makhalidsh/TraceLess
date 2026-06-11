const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;

// Paths to bundled ExifTool (unpacked from ASAR if packaged)
let binDir = path.join(__dirname, 'bin');
if (binDir.includes('app.asar')) {
  binDir = binDir.replace('app.asar', 'app.asar.unpacked');
}
const perlPath = path.join(binDir, 'perl.exe');
const exiftoolScript = path.join(binDir, 'exiftool.pl');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1b1b1f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'TraceLess',
    icon: path.join(__dirname, 'logo.png'),
    autoHideMenuBar: true,
    frame: false,
    show: false,
  });

  mainWindow.loadFile('index.html');
  
  // Prevent keyboard shortcuts from opening developer tools (F12, Ctrl+Shift+I, Cmd+Alt+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = (input.key || '').toLowerCase();
    if (key === 'f12' || 
        (input.control && input.shift && key === 'i') || 
        (input.meta && input.alt && key === 'i')) {
      event.preventDefault();
    }
  });

  // Open external links in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // File Logging Setup
  const logPath = path.join(app.getPath('userData'), 'traceless_debug.log');
  fs.writeFileSync(logPath, `--- TraceLess Packaged Debug Log Start ---\nLog Path: ${logPath}\n\n`);
  
  function writeLog(msg) {
    try {
      fs.appendFileSync(logPath, msg + '\n');
    } catch (e) {
      console.error('Failed to write to debug log:', e);
    }
  }

  writeLog('createWindow started');

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    writeLog(`[RENDERER CONSOLE] ${message} (${sourceId}:${line})`);
  });

  mainWindow.once('ready-to-show', () => {
    writeLog('ready-to-show fired');
    mainWindow.show();
    mainWindow.focus();
  });
}

process.on('uncaughtException', (err) => {
  try {
    const logPath = path.join(require('electron').app.getPath('userData'), 'traceless_debug.log');
    fs.appendFileSync(logPath, `[MAIN PROCESS EXCEPTION] ${err.stack || err.message}\n`);
  } catch (e) {}
});

app.whenReady().then(() => {
  // Set up standard Edit menu to enable copy/paste shortcuts on Windows/Linux in frameless window
  const template = [
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  createWindow();

  // ===== AUTO-UPDATER SETUP =====
  initAutoUpdater();

  // Setup IPC handlers for custom titlebar controls
  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// --- ExifTool Runner ---
function runExifTool(args) {
  return new Promise((resolve, reject) => {
    const libDir = path.join(binDir, 'lib');
    const child = spawn(perlPath, [exiftoolScript, ...args], {
      cwd: binDir,
      windowsHide: true,
      env: { ...process.env, PERL5LIB: libDir },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `ExifTool exited with code ${code}`));
    });
  });
}

// --- IPC Handlers ---
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'tiff', 'tif', 'avif'] },
      { name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
      { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg'] },
      { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('read-metadata', async (_event, filePath) => {
  try {
    const { stdout } = await runExifTool(['-json', '-g', '-a', filePath]);
    return { success: true, data: JSON.parse(stdout)[0] };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('write-metadata', async (_event, { filePath, tags, overwrite }) => {
  try {
    const args = overwrite ? ['-overwrite_original'] : [];
    for (const [tag, value] of Object.entries(tags)) {
      args.push(`-${tag}=${value}`);
    }
    args.push(filePath);
    await runExifTool(args);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clean-metadata', async (_event, { filePath, overwrite }) => {
  try {
    const args = overwrite ? ['-overwrite_original'] : [];
    args.push('-all=', filePath);
    await runExifTool(args);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('rename-file', async (_event, { oldPath, newName }) => {
  try {
    const dir = path.dirname(oldPath);
    const oldExt = path.extname(oldPath);
    
    // Auto-append original extension if user omitted it
    let targetName = newName.trim();
    if (!path.extname(targetName) && oldExt) {
      targetName += oldExt;
    }
    
    const newPath = path.join(dir, targetName);
    
    // Check if destination already exists to avoid overwriting accidentally
    if (fs.existsSync(newPath) && newPath.toLowerCase() !== oldPath.toLowerCase()) {
      throw new Error(`A file named "${targetName}" already exists in this directory.`);
    }

    await fs.promises.rename(oldPath, newPath);
    return { success: true, newPath, newName: targetName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('show-item-in-folder', async (_event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('copy-file-to-clipboard', async (_event, filePath) => {
  try {
    if (process.platform === 'win32') {
      // Write to FileNameW format on Windows
      const buffer = Buffer.from(filePath + '\0', 'ucs2');
      clipboard.writeBuffer('FileNameW', buffer);
    } else if (process.platform === 'darwin') {
      // Write to public.file-url on macOS
      clipboard.write({
        'public.file-url': `file://${filePath}`
      });
    } else {
      // Fallback/Linux: write file path text
      clipboard.writeText(filePath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('copy-text-to-clipboard', async (_event, text) => {
  try {
    clipboard.writeText(text);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('show-save-dialog', async (_event, { defaultPath, filters }) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultPath,
      filters: filters,
      properties: ['showOverwriteConfirmation', 'createDirectory']
    });
    if (result.canceled) return null;
    return result.filePath;
  } catch (err) {
    console.error('Save dialog error:', err);
    return null;
  }
});

ipcMain.handle('save-as', async (_event, { sourcePath, targetPath, tags, cleanAll }) => {
  try {
    // 1. Copy source file to target file path
    await fs.promises.copyFile(sourcePath, targetPath);
    
    // 2. Perform ExifTool clean or write operation on the *target* file
    const args = ['-overwrite_original'];
    if (cleanAll) {
      args.push('-all=');
    } else if (tags && Object.keys(tags).length > 0) {
      for (const [tag, value] of Object.entries(tags)) {
        args.push(`-${tag}=${value}`);
      }
    } else {
      // Just a copy operation with no metadata updates required
      return { success: true, targetPath };
    }
    
    args.push(targetPath);
    await runExifTool(args);
    return { success: true, targetPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ===================================================================
// AUTO-UPDATER — checks GitHub releases for new versions
// ===================================================================
function initAutoUpdater() {
  // Don't check for updates in development mode
  if (!app.isPackaged) {
    console.log('[AutoUpdater] Skipping update check in development mode');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes || '',
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus('not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus('downloaded', {
      version: info.version,
      releaseNotes: info.releaseNotes || '',
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err.message);
    sendUpdateStatus('error', { message: err.message });
  });

  // Check for updates after a short delay so the window is ready
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[AutoUpdater] Check failed:', err.message);
    });
  }, 3000);
}

function sendUpdateStatus(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, ...data });
  }
}

// IPC: Renderer requests to download the update
ipcMain.on('update-download', () => {
  autoUpdater.downloadUpdate().catch((err) => {
    console.error('[AutoUpdater] Download failed:', err.message);
  });
});

// IPC: Renderer requests to install the update (quit & install)
ipcMain.on('update-install', () => {
  autoUpdater.quitAndInstall(false, true);
});

// IPC: Renderer requests to check for updates manually
ipcMain.on('update-check', () => {
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[AutoUpdater] Manual check failed:', err.message);
  });
});
