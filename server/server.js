require('dotenv').config();

const express = require('express');
const http = require('node:http');
const {Server} = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('node:path');
const fs = require('node:fs');

const logdir = path.join(__dirname, 'logs');
if (!fs.existsSync(logdir)){
  fs.mkdirSync(logdir, { recursive: true });
}
const logStream = fs.createWriteStream(
  path.join(logdir, new Date().toISOString().replaceAll(':', '-') + '_server.log'),
   { flags: 'a' });

const log = (message, error = false) => {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} | ${error ? '[ERROR]' : '[INFO]'} ${message}\n`;
  error ? process.stderr.write(logMessage) : process.stdout.write(logMessage);
  logStream.write(logMessage);
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
    transports: ['websocket', 'polling'],
  },
});

const fileServerAddress = process.env.FILE_SERVER_ADDRESS;
if (!fileServerAddress) {
    throw new Error('FILE_SERVER_ADDRESS is not defined in environment variables');
}

const handleSessionEnd = (sessionId) => {
  fetch(`${fileServerAddress}/${sessionId}/finish`, {
    method: 'POST',
  }).then(res => res.json())
    .then(data => {
      log(data.success ? `File server handling session ${sessionId}: ${data.message}` : `File server failed to handle session ${sessionId}: ${data.message}`);
    })
    .catch(err => {
      log(`Error notifying file server for session ${sessionId}:`, true);
      log(err, true);
    });
};

const rooms = {}; // { roomId: { sessionId, participants: [] } } (currently roomId is hardcoded client-side as test-room)

io.on('connection', socket => {
  const participantId = socket.id;
  socket.emit('participant-id', participantId);
  log('User connected: ' + participantId);

  socket.on('join-room', roomId => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        sessionId: uuidv4(),
        participants: [],
      };
      log('Created new session for room ' + roomId + ' : ' + rooms[roomId].sessionId);
    }

    const room = rooms[roomId];
    if (!room.participants.includes(participantId)) {
      room.participants.push(participantId);
    }

    socket.join(roomId);

    socket.emit('session-id', room.sessionId);
    socket.emit('room-participants', room.participants.filter(id => id !== participantId));
    socket.to(roomId).emit('participant-joined', { participantId });
    log(`User ${participantId} joined room ${roomId}`);
  });

  socket.on('leave-room', roomId => {
    const room = rooms[roomId];
    if (room) {
      room.participants = room.participants.filter(id => id !== participantId);
      socket.leave(roomId);
      socket.to(roomId).emit('participant-left', { participantId });
      log(`User ${participantId} left room ${roomId}`);
      if (room.participants.length === 0) {
        log(`Room ${roomId} is empty, deleting session`);
        handleSessionEnd(room.sessionId);
        delete rooms[roomId];
      }
    }
  });

  socket.on('get-server-time', (data, callback) => {
    callback(Date.now());
  });

  socket.on('offer', data => {
    if (!data?.target) {
      return;
    }
    io.to(data.target).emit('offer', {
      offer: data.offer,
      from: participantId,
    });
  });

  socket.on('answer', data => {
    if (!data?.target) {
      return;
    }
    io.to(data.target).emit('answer', {
      answer: data.answer,
      from: participantId,
    });
  });

  socket.on('ice-candidate', data => {
    if (!data?.target) {
      return;
    }
    io.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      from: participantId,
    });
  });

  socket.on('disconnect', () => {
    log('User disconnected: ' + participantId);
    Object.keys(rooms).forEach(roomId => {
      const room = rooms[roomId];
      const wasInRoom = room.participants.includes(participantId);
      room.participants = room.participants.filter(id => id !== participantId);
      if (wasInRoom) {
        socket.to(roomId).emit('participant-left', { participantId });
      }
      if (room.participants.length === 0) {
        log(`Room ${roomId} is empty, deleting session`);
        delete rooms[roomId];
        handleSessionEnd(room.sessionId);
      }
    });
  });
});

const PORT = process.env.PORT || 8888;
server.listen(PORT, '0.0.0.0', () => {
  log(`Communication server running on 0.0.0.0:${PORT}`);
});
