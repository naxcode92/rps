/*
  TEACHING: WebSocket Multiplayer Server

  HTTP is "request-response" — the browser asks, the server answers, done.
  But for a real-time multiplayer game, we need the server to PUSH messages
  to players without them asking (e.g., "your opponent just chose!").

  WebSockets solve this: they open a persistent two-way connection.
  Think of HTTP as sending letters, and WebSockets as a phone call.

  Architecture:
  - HTTP server serves static files (HTML, CSS, JS) — same as before
  - WebSocket server runs ON TOP of the HTTP server (same port!)
  - Each "room" holds two players who play against each other
  - Game logic runs on the SERVER to prevent cheating
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ============================================================
// STATIC FILE SERVER (same as before)
// ============================================================

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const httpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let filePath = urlPath === '/' ? '/index.html' : urlPath;

  filePath = path.normalize(filePath);
  const fullPath = path.join(__dirname, filePath);

  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ============================================================
// WEBSOCKET SERVER
// ============================================================

/*
  TEACHING: WebSocket Server Setup

  We pass the HTTP server to WebSocketServer so they share the same port.
  When a browser connects via WebSocket (ws:// or wss://), it starts as
  a normal HTTP request with an "Upgrade" header, then switches protocols.
  This is why one port can serve both HTTP files AND WebSocket connections.
*/
const wss = new WebSocketServer({ server: httpServer });

// ============================================================
// ROOM MANAGEMENT
// ============================================================

/*
  TEACHING: Room-Based Multiplayer

  Each "room" is a game session between two players. We use a Map
  (like a dictionary) to store rooms by their 4-letter code.

  Room lifecycle:
  1. Player 1 creates a room → gets a code like "ABCD"
  2. Player 1 shares the code with their friend
  3. Player 2 joins room "ABCD" → game starts
  4. After the match, both can rematch or leave
  5. When both leave, the room is deleted

  Why server-side game logic?
  If we let the client decide who wins, a player could hack their
  JavaScript to always report "I won!" The server is the authority.
*/
const rooms = new Map();

const CHOICES = ['rock', 'paper', 'scissors'];
const WIN_MAP = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const CHOOSE_TIME = 5;
const CONTINUE_TIME = 10;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code)); // Ensure unique
  return code;
}

function createRoom() {
  const code = generateRoomCode();
  rooms.set(code, {
    players: [null, null],       // WebSocket references
    names: ['P1', 'P2'],
    p1Score: 0,
    p2Score: 0,
    currentRound: 1,
    maxRounds: 3,
    winsNeeded: 2,
    continued: false,
    choices: [null, null],       // [p1Choice, p2Choice]
    chooseTimer: null,
    continueTimer: null,
    rematchVotes: [false, false],
    state: 'waiting',            // waiting, choosing, battle, result, gameover
  });
  return code;
}

function resolveRound(p1Choice, p2Choice) {
  if (p1Choice === p2Choice) return 'draw';
  if (WIN_MAP[p1Choice] === p2Choice) return 'p1';
  return 'p2';
}

function randomChoice() {
  return CHOICES[Math.floor(Math.random() * CHOICES.length)];
}

/*
  TEACHING: Sending Messages

  We use JSON to communicate between server and client.
  Every message has a "type" field so the client knows how to handle it.
  This is a common pattern called "message protocol" or "action pattern"
  (similar to Redux actions if you've used React).
*/
function send(ws, msg) {
  if (ws && ws.readyState === 1) { // 1 = WebSocket.OPEN
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room, msg) {
  room.players.forEach(ws => send(ws, msg));
}

function getPlayerIndex(room, ws) {
  return room.players.indexOf(ws);
}

// ============================================================
// GAME FLOW
// ============================================================

function startRound(room, code) {
  room.choices = [null, null];
  room.state = 'choosing';

  // Tell each player to choose (they both see the choose screen simultaneously)
  room.players.forEach((ws, i) => {
    send(ws, {
      type: 'choose',
      round: room.currentRound,
      p1Score: room.p1Score,
      p2Score: room.p2Score,
      winsNeeded: room.winsNeeded,
      timeLimit: CHOOSE_TIME,
    });
  });

  // Start server-side timer — if time runs out, pick random for those who didn't choose
  room.chooseTimer = setTimeout(() => {
    if (room.choices[0] === null) room.choices[0] = randomChoice();
    if (room.choices[1] === null) room.choices[1] = randomChoice();
    resolveBattle(room, code);
  }, (CHOOSE_TIME + 1) * 1000); // +1s grace for network latency
}

function handleChoice(room, code, playerIndex, choice) {
  if (room.state !== 'choosing') return;
  if (!CHOICES.includes(choice)) return;
  if (room.choices[playerIndex] !== null) return; // Already chose

  room.choices[playerIndex] = choice;

  // Confirm to the player that their choice was received
  send(room.players[playerIndex], { type: 'choice-confirmed', choice });

  // Tell opponent that the other player has locked in (but not WHAT they chose)
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  send(room.players[opponentIndex], { type: 'opponent-ready' });

  // If both have chosen, resolve immediately
  if (room.choices[0] !== null && room.choices[1] !== null) {
    clearTimeout(room.chooseTimer);
    resolveBattle(room, code);
  }
}

function resolveBattle(room, code) {
  room.state = 'battle';

  const p1Choice = room.choices[0];
  const p2Choice = room.choices[1];
  const result = resolveRound(p1Choice, p2Choice);

  if (result === 'p1') room.p1Score++;
  else if (result === 'p2') room.p2Score++;

  // Send battle result to both players
  broadcast(room, {
    type: 'battle-result',
    p1Choice,
    p2Choice,
    result,
    p1Score: room.p1Score,
    p2Score: room.p2Score,
    round: room.currentRound,
    winsNeeded: room.winsNeeded,
  });

  if (result !== 'draw') {
    room.currentRound++;
  }

  // Check if match is over
  const matchWinner = checkMatchEnd(room);

  if (matchWinner) {
    room.state = 'gameover';

    // Delay gameover message to let battle animation play
    setTimeout(() => {
      if (!room.continued) {
        // Offer continue
        broadcast(room, {
          type: 'continue-offer',
          winner: matchWinner,
          p1Score: room.p1Score,
          p2Score: room.p2Score,
          timeLimit: CONTINUE_TIME,
        });
        room.state = 'continue';

        room.continueTimer = setTimeout(() => {
          broadcast(room, {
            type: 'gameover',
            winner: matchWinner,
            p1Score: room.p1Score,
            p2Score: room.p2Score,
          });
          room.state = 'gameover';
          room.rematchVotes = [false, false];
        }, CONTINUE_TIME * 1000);
      } else {
        broadcast(room, {
          type: 'gameover',
          winner: matchWinner,
          p1Score: room.p1Score,
          p2Score: room.p2Score,
        });
        room.rematchVotes = [false, false];
      }
    }, 4000); // Wait for battle animation
  } else {
    // Next round after battle animation
    setTimeout(() => {
      if (room.state === 'battle') {
        startRound(room, code);
      }
    }, 4000);
  }
}

function checkMatchEnd(room) {
  if (room.p1Score >= room.winsNeeded) return 'p1';
  if (room.p2Score >= room.winsNeeded) return 'p2';
  return null;
}

function handleContinue(room, code) {
  if (room.state !== 'continue') return;

  clearTimeout(room.continueTimer);
  room.continued = true;
  room.maxRounds = 7;
  room.winsNeeded = 4;
  room.state = 'choosing';

  broadcast(room, {
    type: 'continued',
    winsNeeded: room.winsNeeded,
    p1Score: room.p1Score,
    p2Score: room.p2Score,
  });

  // Small delay then start next round
  setTimeout(() => startRound(room, code), 500);
}

function handleRematch(room, code, playerIndex) {
  if (room.state !== 'gameover') return;

  room.rematchVotes[playerIndex] = true;

  // Tell the OTHER player that this player wants a rematch
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  send(room.players[opponentIndex], { type: 'opponent-wants-rematch' });

  if (room.rematchVotes[0] && room.rematchVotes[1]) {
    // Both want rematch — reset and start
    room.p1Score = 0;
    room.p2Score = 0;
    room.currentRound = 1;
    room.maxRounds = 3;
    room.winsNeeded = 2;
    room.continued = false;
    room.rematchVotes = [false, false];

    broadcast(room, { type: 'rematch-start' });

    setTimeout(() => startRound(room, code), 1000);
  }
}

function handleReturnToLobby(room, code, playerIndex) {
  // Notify the other player
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  send(room.players[opponentIndex], { type: 'opponent-left' });

  // Disconnect this player from the room
  room.players[playerIndex] = null;

  // Clean up room if empty
  if (!room.players[0] && !room.players[1]) {
    clearTimeout(room.chooseTimer);
    clearTimeout(room.continueTimer);
    rooms.delete(code);
  }
}

// ============================================================
// CONNECTION HANDLER
// ============================================================

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentCode = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // Ignore malformed messages
    }

    switch (msg.type) {
      // ---- LOBBY ----

      case 'create-room': {
        const code = createRoom();
        const room = rooms.get(code);
        room.players[0] = ws;
        currentRoom = room;
        currentCode = code;

        send(ws, { type: 'room-created', code, playerNum: 1 });
        break;
      }

      case 'join-room': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);

        if (!room) {
          send(ws, { type: 'join-error', message: 'Room not found' });
          break;
        }

        if (room.players[1] !== null) {
          send(ws, { type: 'join-error', message: 'Room is full' });
          break;
        }

        room.players[1] = ws;
        currentRoom = room;
        currentCode = code;

        send(ws, { type: 'room-joined', code, playerNum: 2 });

        // Notify P1 that opponent joined
        send(room.players[0], { type: 'opponent-joined' });

        // Start the game after a brief countdown
        broadcast(room, { type: 'game-starting' });
        setTimeout(() => startRound(room, code), 2000);
        break;
      }

      // ---- GAMEPLAY ----

      case 'choice': {
        if (!currentRoom) return;
        const idx = getPlayerIndex(currentRoom, ws);
        if (idx === -1) return;
        handleChoice(currentRoom, currentCode, idx, msg.choice);
        break;
      }

      case 'continue': {
        if (!currentRoom) return;
        handleContinue(currentRoom, currentCode);
        break;
      }

      case 'rematch': {
        if (!currentRoom) return;
        const idx = getPlayerIndex(currentRoom, ws);
        if (idx === -1) return;
        handleRematch(currentRoom, currentCode, idx);
        break;
      }

      case 'return-to-lobby': {
        if (!currentRoom) return;
        const idx = getPlayerIndex(currentRoom, ws);
        if (idx === -1) return;
        handleReturnToLobby(currentRoom, currentCode, idx);
        currentRoom = null;
        currentCode = null;
        break;
      }
    }
  });

  /*
    TEACHING: Handling Disconnects

    When a player closes their browser or loses internet, the WebSocket
    fires a 'close' event. We need to:
    1. Notify the other player
    2. Clean up the room if it's empty

    Without this, "ghost rooms" would pile up and waste memory.
  */
  ws.on('close', () => {
    if (!currentRoom) return;
    const idx = getPlayerIndex(currentRoom, ws);
    if (idx === -1) return;

    clearTimeout(currentRoom.chooseTimer);
    clearTimeout(currentRoom.continueTimer);

    const opponentIndex = idx === 0 ? 1 : 0;
    send(currentRoom.players[opponentIndex], { type: 'opponent-disconnected' });

    currentRoom.players[idx] = null;

    // Clean up empty rooms
    if (!currentRoom.players[0] && !currentRoom.players[1]) {
      rooms.delete(currentCode);
    }
  });
});

// ============================================================
// START
// ============================================================

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Rock Paper Scissors server running on port ${PORT}`);
  console.log(`Open in browser: http://localhost:${PORT}`);
});
