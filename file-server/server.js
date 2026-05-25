require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const logdir = path.join(__dirname, 'logs');
if (!fs.existsSync(logdir)){
  fs.mkdirSync(logdir, { recursive: true });
}
const logStream = fs.createWriteStream(
  path.join(logdir, new Date().toISOString().replaceAll(':', '-') + '_file_server.log'),
   { flags: 'a' });

const log = (message, error = false) => {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} | ${error ? '[ERROR]' : '[INFO]'} ${message}\n`;
  error ? process.stderr.write(logMessage) : process.stdout.write(logMessage);
  logStream.write(logMessage);
};

const server = express();
server.use(express.json({ limit: '50mb' }));
server.use(express.urlencoded({ limit: process.env.UPLOAD_LIMIT || '500mb', extended: true }));

const delay = (delayMs) => {
  return new Promise(resolve => setTimeout(resolve, delayMs));
 };
const activeUploads = new Map();

const beginUpload = (sessionId) => {
  if (!sessionId) {
    return;
  }
  activeUploads.set(sessionId, (activeUploads.get(sessionId) || 0) + 1);
};

const endUpload = (sessionId) => {
  if (!sessionId) {
    return;
  }
  const nextCount = Math.max(0, (activeUploads.get(sessionId) || 0) - 1);
  if (nextCount === 0) {
    activeUploads.delete(sessionId);
    return;
  }
  activeUploads.set(sessionId, nextCount);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = file.originalname.split('_')[0];
    beginUpload(sessionId);
    const dir = path.join(__dirname, 'uploads', sessionId);
    if (!fs.existsSync(dir)){
      log(`Creating directory for session ${sessionId}: ${dir}`);
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => { // Removing redundant sessionId from filename for metadata
    if (file.originalname.endsWith('.json')) {
      const parts = file.originalname.split('_');
      parts.shift();
      const newName = parts.join('_');
      cb(null, newName);
      log(`Saved file: ${newName}`);
    } else {
      cb(null, file.originalname);
      log(`Saved file: ${file.originalname}`);
    }
  },
});

const handleFileProcessing = (dir) => {
  try{
  log(`Starting audio processing for directory: ${dir}`);
  const pythonProcess = spawn('python', ['./processing/merge_audio.py', dir], { cwd: __dirname });
  pythonProcess.stdout.on('data', (data) => {
    log(`[MergeAudio] ${data.toString().trim()}`);
  });
  pythonProcess.stderr.on('data', (data) => {
    log(`[MergeAudio Error] ${data.toString().trim()}`, true);
  });
  pythonProcess.on('close', (code) => {
    log(`Audio processing script exited with code ${code} for directory: ${dir}`);
  });
  pythonProcess.on('error', (err) => {
    log(`Error running audio processing script: ${err.message}`, true);
  });
  } catch (error) {
    log(`Exception during file processing: ${error.message}`, true);
  }
};

const waitForUploads = async (sessionId, timeoutMs = Number(process.env.FINISH_WAIT_TIMEOUT_MS || 15000)) => {
  const start = Date.now();
  // Initial delay to ensure any in-flight uploads are counted
  await delay(500);
  // Poll for active uploads to complete
  while ((activeUploads.get(sessionId) || 0) > 0) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for uploads to finish for session ${sessionId}`);
    }
    await delay(100);
  }
};

const upload = multer({ storage });

server.post('/upload', upload.single('file'), async (req, res) => {
  const sessionId = req.file?.originalname?.split('_')?.[0];
  let uploadFinalized = false;
  const finalizeUpload = () => {
    if (uploadFinalized) {
      return;
    }
    uploadFinalized = true;
    endUpload(sessionId);
  };

  res.once('finish', finalizeUpload);
  res.once('close', finalizeUpload);
  req.once('aborted', finalizeUpload);
  req.once('error', finalizeUpload);

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  res.json({ success: true, filename: req.file.filename });
});

server.post('/:sessionId/finish', async (req, res) => {
  const { sessionId } = req.params;
  log(`Finish request received for session: ${sessionId}`);
  try {
    await waitForUploads(sessionId);
  } catch (error) {
    log(`Error waiting for uploads in session ${sessionId}: ${error.message}`, true);
    return res.status(504).json({ success: false, message: error.message });
  }
  const dir = path.join(__dirname, 'uploads', sessionId);
  try{
    if (!fs.existsSync(dir)) {
      log(`Session directory not found: ${dir}`, true);
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    res.json({ success: true, message: `Processing files for session ${sessionId}` });
    handleFileProcessing(dir);
  } catch (error) {
      res.status(500).json({ success: false, message: 'Error processing files: ' + error.message });
  }
});

const PORT = process.env.PORT || 8885;
server.listen(PORT, '0.0.0.0', () => {
  log(`File server running on 0.0.0.0:${PORT}`);
});
