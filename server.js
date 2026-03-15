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
// STATIC FILE SERVER
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

const wss = new WebSocketServer({ server: httpServer });

// ============================================================
// ROOM & MATCHMAKING
// ============================================================

/*
  TEACHING: Room-Based Multiplayer + Random Matchmaking

  Two ways to play:
  1. PRIVATE ROOM: Create a room, share the 4-letter code with a friend
  2. RANDOM MATCH: Join a queue — server pairs you with the next person

  The random match queue is just an array. When someone joins:
  - If the queue is empty → add them, they wait
  - If someone is already waiting → pair them, create a room, start!
*/
const rooms = new Map();
let randomQueue = []; // Array of { ws, name } waiting for a random match

const CHOICES = ['rock', 'paper', 'scissors'];
const WIN_MAP = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const CHOOSE_TIME = 15; // 15 seconds to choose (was 5 — too short!)
const CONTINUE_TIME = 10;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createRoom(p1Name, p2Name) {
  const code = generateRoomCode();
  rooms.set(code, {
    players: [null, null],
    names: [p1Name || 'P1', p2Name || 'P2'],
    p1Score: 0,
    p2Score: 0,
    currentRound: 1,
    winsNeeded: 2,
    continued: false,
    choices: [null, null],
    chooseTimer: null,
    continueTimer: null,
    rematchVotes: [false, false],
    /*
      TEACHING: Ready Signals

      The old version used setTimeout to auto-advance between rounds.
      Problem: the server's timer didn't match the client's animation time,
      so the game would "play itself" — starting new rounds before players
      could even see the results.

      Fix: the server waits for BOTH players to send a "ready" signal
      after they've finished watching the battle/result animation.
      No more guessing how long the animation takes!
    */
    readyForNext: [false, false],
    state: 'waiting',
  });
  return code;
}

function resolveRound(p1Choice, p2Choice) {
  if (p1Choice === p2Choice) return 'draw';
  if (WIN_MAP[p1Choice] === p2Choice) return 'p1';
  return 'p2';
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) {
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
  room.readyForNext = [false, false];
  room.state = 'choosing';

  // Tell each player to choose — include opponent names so UI can display them
  room.players.forEach((ws, i) => {
    send(ws, {
      type: 'choose',
      round: room.currentRound,
      p1Score: room.p1Score,
      p2Score: room.p2Score,
      winsNeeded: room.winsNeeded,
      timeLimit: CHOOSE_TIME,
      p1Name: room.names[0],
      p2Name: room.names[1],
    });
  });

  // Timer: if time runs out, anyone who didn't choose FORFEITS (not random pick)
  room.chooseTimer = setTimeout(() => {
    const p1Chose = room.choices[0] !== null;
    const p2Chose = room.choices[1] !== null;

    if (!p1Chose && !p2Chose) {
      // Both AFK — it's a draw, nobody scores
      room.choices[0] = 'rock';
      room.choices[1] = 'rock';
    } else if (!p1Chose) {
      // P1 didn't choose — give P2 a free win
      room.choices[0] = 'rock';
      room.choices[1] = 'paper';
    } else if (!p2Chose) {
      // P2 didn't choose — give P1 a free win
      room.choices[0] = 'paper';
      room.choices[1] = 'rock';
    }

    resolveBattle(room, code);
  }, (CHOOSE_TIME + 1) * 1000);
}

function handleChoice(room, code, playerIndex, choice) {
  if (room.state !== 'choosing') return;
  if (!CHOICES.includes(choice)) return;
  if (room.choices[playerIndex] !== null) return;

  room.choices[playerIndex] = choice;

  send(room.players[playerIndex], { type: 'choice-confirmed', choice });

  const opponentIndex = playerIndex === 0 ? 1 : 0;
  send(room.players[opponentIndex], { type: 'opponent-ready' });

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

  if (result !== 'draw') {
    room.currentRound++;
  }

  const matchWinner = checkMatchEnd(room);

  // Send battle result — client will animate, then send 'ready-for-next'
  broadcast(room, {
    type: 'battle-result',
    p1Choice,
    p2Choice,
    result,
    p1Score: room.p1Score,
    p2Score: room.p2Score,
    round: room.currentRound - (result !== 'draw' ? 1 : 0),
    winsNeeded: room.winsNeeded,
    matchOver: !!matchWinner,
    matchWinner,
    p1Name: room.names[0],
    p2Name: room.names[1],
  });

  // Server does NOT auto-advance — it waits for 'ready-for-next' from both clients
}

function handleReadyForNext(room, code, playerIndex) {
  room.readyForNext[playerIndex] = true;

  if (room.readyForNext[0] && room.readyForNext[1]) {
    const matchWinner = checkMatchEnd(room);

    if (matchWinner) {
      if (!room.continued) {
        // Offer continue
        broadcast(room, {
          type: 'continue-offer',
          winner: matchWinner,
          p1Score: room.p1Score,
          p2Score: room.p2Score,
          timeLimit: CONTINUE_TIME,
          p1Name: room.names[0],
          p2Name: room.names[1],
        });
        room.state = 'continue';

        room.continueTimer = setTimeout(() => {
          broadcast(room, {
            type: 'gameover',
            winner: matchWinner,
            p1Score: room.p1Score,
            p2Score: room.p2Score,
            p1Name: room.names[0],
            p2Name: room.names[1],
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
          p1Name: room.names[0],
          p2Name: room.names[1],
        });
        room.state = 'gameover';
        room.rematchVotes = [false, false];
      }
    } else {
      // Next round
      startRound(room, code);
    }
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
  room.winsNeeded = 4;
  room.state = 'choosing';

  broadcast(room, {
    type: 'continued',
    winsNeeded: room.winsNeeded,
    p1Score: room.p1Score,
    p2Score: room.p2Score,
  });

  setTimeout(() => startRound(room, code), 500);
}

function handleRematch(room, code, playerIndex) {
  if (room.state !== 'gameover') return;

  room.rematchVotes[playerIndex] = true;

  const opponentIndex = playerIndex === 0 ? 1 : 0;
  send(room.players[opponentIndex], { type: 'opponent-wants-rematch' });

  if (room.rematchVotes[0] && room.rematchVotes[1]) {
    room.p1Score = 0;
    room.p2Score = 0;
    room.currentRound = 1;
    room.winsNeeded = 2;
    room.continued = false;
    room.rematchVotes = [false, false];

    broadcast(room, { type: 'rematch-start' });

    setTimeout(() => startRound(room, code), 1000);
  }
}

function handleReturnToLobby(room, code, playerIndex) {
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  send(room.players[opponentIndex], { type: 'opponent-left' });

  room.players[playerIndex] = null;

  if (!room.players[0] && !room.players[1]) {
    clearTimeout(room.chooseTimer);
    clearTimeout(room.continueTimer);
    rooms.delete(code);
  }
}

function removeFromRandomQueue(ws) {
  randomQueue = randomQueue.filter(entry => entry.ws !== ws);
}

// ============================================================
// CONNECTION HANDLER
// ============================================================

/*
  TEACHING: Per-Connection State

  We store room/code/name directly on the WebSocket object (ws._room, etc.)
  instead of using closure variables. This is critical for random matchmaking:
  when Player A is matched, the SERVER assigns them to a room, but Player A's
  message handler needs to know about it. If we used closure variables, only
  the player who triggered the match would have them set — the other player's
  closure would still be null.

  By storing state ON the ws object, any code that has the ws reference
  can read/write the room assignment — no closure scoping issues.
*/
wss.on('connection', (ws) => {
  ws._room = null;
  ws._code = null;
  ws._name = 'ANON';

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {

      // ---- SET NAME ----

      case 'set-name': {
        ws._name = (msg.name || '').trim().substring(0, 12).toUpperCase() || 'ANON';
        break;
      }

      // ---- LOBBY ----

      case 'create-room': {
        const code = createRoom(ws._name);
        const room = rooms.get(code);
        room.players[0] = ws;
        ws._room = room;
        ws._code = code;

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
        room.names[1] = ws._name;
        ws._room = room;
        ws._code = code;

        send(ws, { type: 'room-joined', code, playerNum: 2 });
        send(room.players[0], { type: 'opponent-joined', opponentName: ws._name });

        broadcast(room, {
          type: 'game-starting',
          p1Name: room.names[0],
          p2Name: room.names[1],
        });
        setTimeout(() => startRound(room, code), 2000);
        break;
      }

      /*
        TEACHING: Random Matchmaking Queue

        This is how most online games work behind the scenes:
        1. Player clicks "Find Match"
        2. Server adds them to a queue (just an array)
        3. When 2+ players are waiting, pair them up and start a game
        4. If someone cancels, remove them from the queue

        For a bigger game you'd add skill-based matching (ELO ratings),
        region-based matching (latency), etc. But the core is always a queue.
      */
      case 'random-match': {
        removeFromRandomQueue(ws);

        if (randomQueue.length > 0) {
          const opponent = randomQueue.shift();

          if (opponent.ws.readyState !== 1) {
            randomQueue.push({ ws, name: ws._name });
            send(ws, { type: 'random-waiting' });
            break;
          }

          const code = createRoom(opponent.ws._name, ws._name);
          const room = rooms.get(code);
          room.players[0] = opponent.ws;
          room.players[1] = ws;

          // Both players get room references — this is why we use ws._room
          opponent.ws._room = room;
          opponent.ws._code = code;
          ws._room = room;
          ws._code = code;

          send(opponent.ws, { type: 'random-matched', code, playerNum: 1, opponentName: ws._name });
          send(ws, { type: 'random-matched', code, playerNum: 2, opponentName: opponent.ws._name });

          broadcast(room, {
            type: 'game-starting',
            p1Name: room.names[0],
            p2Name: room.names[1],
          });
          setTimeout(() => startRound(room, code), 2000);
        } else {
          randomQueue.push({ ws, name: ws._name });
          send(ws, { type: 'random-waiting' });
        }
        break;
      }

      case 'cancel-random': {
        removeFromRandomQueue(ws);
        send(ws, { type: 'random-cancelled' });
        break;
      }

      // ---- GAMEPLAY ----

      case 'choice': {
        if (!ws._room) return;
        const idx = getPlayerIndex(ws._room, ws);
        if (idx === -1) return;
        handleChoice(ws._room, ws._code, idx, msg.choice);
        break;
      }

      case 'ready-for-next': {
        if (!ws._room) return;
        const idx = getPlayerIndex(ws._room, ws);
        if (idx === -1) return;
        handleReadyForNext(ws._room, ws._code, idx);
        break;
      }

      case 'continue': {
        if (!ws._room) return;
        handleContinue(ws._room, ws._code);
        break;
      }

      case 'rematch': {
        if (!ws._room) return;
        const idx = getPlayerIndex(ws._room, ws);
        if (idx === -1) return;
        handleRematch(ws._room, ws._code, idx);
        break;
      }

      case 'return-to-lobby': {
        if (!ws._room) return;
        const idx = getPlayerIndex(ws._room, ws);
        if (idx === -1) return;
        handleReturnToLobby(ws._room, ws._code, idx);
        ws._room = null;
        ws._code = null;
        break;
      }
    }
  });

  ws.on('close', () => {
    removeFromRandomQueue(ws);

    if (!ws._room) return;
    const idx = getPlayerIndex(ws._room, ws);
    if (idx === -1) return;

    clearTimeout(ws._room.chooseTimer);
    clearTimeout(ws._room.continueTimer);

    const opponentIndex = idx === 0 ? 1 : 0;
    send(ws._room.players[opponentIndex], { type: 'opponent-disconnected' });

    ws._room.players[idx] = null;

    if (!ws._room.players[0] && !ws._room.players[1]) {
      rooms.delete(ws._code);
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
