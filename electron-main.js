const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow;
let pythonProcess = null;
const PORT = 8080;

function getPythonPath() {
  const os = process.platform;
  if (os === 'win32') {
    return 'python';
  }
  // Try common paths on macOS / Linux
  const brewPath = '/opt/homebrew/bin/python3';
  const usrPath = '/usr/bin/python3';
  if (fs.existsSync(brewPath)) {
    return brewPath;
  }
  if (fs.existsSync(usrPath)) {
    return usrPath;
  }
  return 'python3';
}

function startPythonServer() {
  let executablePath;
  let args = [];

  if (app.isPackaged) {
    const binaryName = process.platform === 'win32' ? 'rom_downloader_server.exe' : 'rom_downloader_server';
    executablePath = path.join(process.resourcesPath, 'bin', binaryName);
    console.log(`Starting packaged server binary: ${executablePath}`);
  } else {
    const pythonPath = getPythonPath();
    executablePath = pythonPath;
    args = [path.join(__dirname, 'rom_downloader_server.py')];
    console.log(`Starting python server: ${pythonPath} ${args[0]}`);
  }

  pythonProcess = spawn(executablePath, args, {
    cwd: __dirname,
    stdio: 'pipe',
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Server stdout]: ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Server stderr]: ${data.toString().trim()}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
    pythonProcess = null;
  });

  pythonProcess.on('error', (err) => {
    console.error('Failed to start server process:', err);
    dialog.showErrorBox(
      'Server Error',
      `Failed to start backend server.\n\nError: ${err.message}`
    );
  });
}

function checkServerReady(callback, retries = 30) {
  if (retries <= 0) {
    callback(new Error('Server failed to start.'));
    return;
  }

  const req = http.get(`http://localhost:${PORT}`, (res) => {
    if (res.statusCode === 200 || res.statusCode === 404 || res.statusCode === 302) {
      callback(null);
    } else {
      setTimeout(() => checkServerReady(callback, retries - 1), 200);
    }
  });

  req.on('error', () => {
    setTimeout(() => checkServerReady(callback, retries - 1), 200);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Aura Console',
    backgroundColor: '#0c0c14',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Start server
  startPythonServer();

  // Wait for server to start, then load BrowserWindow
  checkServerReady((err) => {
    if (err) {
      console.error(err);
      dialog.showErrorBox(
        'Server Timeout',
        'The backend server failed to respond in time. Closing application.'
      );
      app.quit();
    } else {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Make sure the Python child process is killed on app exit
app.on('will-quit', () => {
  if (pythonProcess) {
    console.log('Stopping python server...');
    pythonProcess.kill('SIGINT');
  }
});
