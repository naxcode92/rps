/*
  ROCK PAPER SCISSORS — ONLINE MULTIPLAYER CLIENT
  =================================================

  TEACHING: Client-Server Architecture

  The old version ran everything locally (pass-the-phone).
  Now, game logic lives on the SERVER and this client just:
  1. Sends player actions (choices, rematch votes) to the server
  2. Receives game events (battle results, opponent status) from the server
  3. Updates the UI based on those events

  The client NEVER decides who wins — the server is the authority.
  This prevents cheating and ensures both players see the same result.
*/

// ============================================================
// CONSTANTS
// ============================================================

const CHOICE_EMOJI = {
  rock: '✊',
  paper: '✋',
  scissors: '✌️'
};

const CHOOSE_TIME = 5;

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function typeText(element, text, speed = 35) {
  return new Promise(resolve => {
    let i = 0;
    element.textContent = '';
    const interval = setInterval(() => {
      element.textContent += text[i];
      i++;
      if (i >= text.length) {
        clearInterval(interval);
        resolve();
      }
    }, speed);
  });
}

// ============================================================
// WEBSOCKET CONNECTION
// ============================================================

/*
  TEACHING: WebSocket URL Construction

  We need to connect to the same server that served this page.
  - window.location.host gives us "example.com:8080" (or just "example.com")
  - If the page was loaded over HTTPS, we use WSS (WebSocket Secure)
  - If over HTTP (local dev), we use plain WS

  This means the code works in BOTH local development AND production
  without changing any configuration.
*/

let ws = null;
let myPlayerNum = null;  // 1 or 2
let currentRoomCode = null;
let chooseTimerId = null;
let continueTimerId = null;

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log('Connected to server');
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg);
  };

  ws.onclose = () => {
    console.log('Disconnected from server');
    // If we're in a game, show disconnect overlay
    const state = document.getElementById('game-frame').dataset.state;
    if (state !== 'title' && state !== 'lobby') {
      showDisconnect('CONNECTION LOST');
    }
  };
}

function sendMsg(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ============================================================
// STATE MANAGEMENT
// ============================================================

function setState(newState) {
  document.getElementById('game-frame').dataset.state = newState;
}

function clearChooseTimer() {
  if (chooseTimerId) {
    clearInterval(chooseTimerId);
    chooseTimerId = null;
  }
}

function clearContinueTimer() {
  if (continueTimerId) {
    clearInterval(continueTimerId);
    continueTimerId = null;
  }
}

// ============================================================
// SERVER MESSAGE HANDLER
// ============================================================

/*
  TEACHING: Message-Driven Architecture

  Instead of the client controlling game flow, the SERVER tells us
  what's happening and we react. Each message type maps to a UI update.
  This is similar to how multiplayer games like Among Us or Fortnite work —
  your client is just a "view" of the server's game state.
*/

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'room-created':
      myPlayerNum = msg.playerNum;
      currentRoomCode = msg.code;
      document.getElementById('display-room-code').textContent = msg.code;
      setState('waiting');
      break;

    case 'room-joined':
      myPlayerNum = msg.playerNum;
      currentRoomCode = msg.code;
      break;

    case 'join-error':
      document.getElementById('lobby-error').textContent = msg.message;
      break;

    case 'opponent-joined':
      // P1 sees this when P2 joins their room
      break;

    case 'game-starting':
      setState('choose'); // Brief moment before choose arrives
      break;

    case 'choose':
      enterChoose(msg);
      break;

    case 'choice-confirmed':
      onChoiceConfirmed(msg.choice);
      break;

    case 'opponent-ready':
      onOpponentReady();
      break;

    case 'battle-result':
      enterBattle(msg);
      break;

    case 'continue-offer':
      enterContinue(msg);
      break;

    case 'continued':
      clearContinueTimer();
      // Game will restart shortly via 'choose' message
      break;

    case 'gameover':
      enterGameover(msg);
      break;

    case 'opponent-wants-rematch':
      document.getElementById('rematch-status').textContent = 'OPPONENT WANTS REMATCH!';
      break;

    case 'rematch-start':
      document.getElementById('rematch-status').textContent = '';
      // Will receive 'choose' message shortly
      break;

    case 'opponent-left':
      showDisconnect('OPPONENT LEFT');
      break;

    case 'opponent-disconnected':
      showDisconnect('OPPONENT DISCONNECTED');
      break;
  }
}

// ============================================================
// SCREEN: CHOOSE
// ============================================================

function enterChoose(msg) {
  setState('choose');
  clearChooseTimer();

  // Update score display
  updateHP(msg.p1Score, msg.p2Score, msg.winsNeeded);
  document.getElementById('round-num').textContent = msg.round;

  // Update labels to show which player YOU are
  const youLabel = myPlayerNum === 1 ? 'YOU' : 'YOU';
  const oppLabel = myPlayerNum === 1 ? 'OPP' : 'OPP';
  document.getElementById('hp-label-p1').textContent = myPlayerNum === 1 ? 'YOU' : 'OPP';
  document.getElementById('hp-label-p2').textContent = myPlayerNum === 2 ? 'YOU' : 'OPP';

  document.getElementById('choose-label').textContent = 'YOUR MOVE';
  document.getElementById('choose-label').className = `player-turn-label ${myPlayerNum === 1 ? 'p1-color' : 'p2-color'}`;
  document.getElementById('choose-sub').textContent = 'Choose your weapon!';

  // Re-enable buttons
  document.querySelectorAll('.btn-choice').forEach(btn => {
    btn.disabled = false;
    btn.classList.remove('selected', 'disabled-choice');
  });

  // Start timer
  const timerFill = document.getElementById('timer-fill');
  const timerText = document.getElementById('timer-text');

  timerText.textContent = CHOOSE_TIME;
  timerFill.classList.remove('running');
  void timerFill.offsetWidth; // Force reflow
  timerFill.classList.add('running');

  let countdown = CHOOSE_TIME;
  chooseTimerId = setInterval(() => {
    countdown--;
    timerText.textContent = Math.max(0, countdown);
    if (countdown <= 0) {
      clearChooseTimer();
    }
  }, 1000);
}

function onChoiceConfirmed(choice) {
  clearChooseTimer();

  // Visually lock in the choice
  document.querySelectorAll('.btn-choice').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.choice === choice) {
      btn.classList.add('selected');
    } else {
      btn.classList.add('disabled-choice');
    }
  });

  document.getElementById('choose-sub').textContent = 'Waiting for opponent...';
}

function onOpponentReady() {
  // Could add a visual indicator that opponent has chosen
  document.getElementById('choose-sub').textContent =
    document.getElementById('choose-sub').textContent === 'Waiting for opponent...'
      ? 'Waiting for opponent...'
      : 'Opponent is ready!';
}

// ============================================================
// SCREEN: BATTLE
// ============================================================

async function enterBattle(msg) {
  setState('battle');
  clearChooseTimer();

  const battleText = document.getElementById('battle-text');
  const spriteP1 = document.getElementById('sprite-p1');
  const spriteP2 = document.getElementById('sprite-p2');

  // Update labels
  document.getElementById('battle-label-p1').textContent = myPlayerNum === 1 ? 'YOU' : 'OPP';
  document.getElementById('battle-label-p2').textContent = myPlayerNum === 2 ? 'YOU' : 'OPP';

  spriteP1.textContent = '?';
  spriteP2.textContent = '?';
  battleText.textContent = '';

  // Reveal P1's choice
  await delay(500);
  spriteP1.textContent = CHOICE_EMOJI[msg.p1Choice];
  await typeText(battleText, `P1 used ${msg.p1Choice.toUpperCase()}!`);

  // Reveal P2's choice
  await delay(600);
  spriteP2.textContent = CHOICE_EMOJI[msg.p2Choice];
  await typeText(battleText, `P2 used ${msg.p2Choice.toUpperCase()}!`);

  // Show result
  await delay(500);

  if (msg.result === 'draw') {
    await typeText(battleText, "It's a DRAW! Going again...");
  } else if (msg.result === 'p1') {
    spriteP2.parentElement.classList.add('shake');
    await typeText(battleText, "It's super effective! P1 wins!");
  } else {
    spriteP1.parentElement.classList.add('shake');
    await typeText(battleText, "It's super effective! P2 wins!");
  }

  await delay(1200);

  spriteP1.parentElement.classList.remove('shake');
  spriteP2.parentElement.classList.remove('shake');

  // Show result screen (only for non-draws — draws auto-restart via server)
  if (msg.result !== 'draw') {
    showResult(msg);
  }
  // For draws, the server will send a new 'choose' message automatically
}

function showResult(msg) {
  setState('result');

  const resultText = document.getElementById('result-text');
  const resultDetail = document.getElementById('result-detail');
  const resultRound = document.getElementById('result-round');

  document.getElementById('score-p1').textContent = msg.p1Score;
  document.getElementById('score-p2').textContent = msg.p2Score;
  updateHP(msg.p1Score, msg.p2Score, msg.winsNeeded);

  resultRound.textContent = `ROUND ${msg.round}`;

  if (msg.result === 'p1') {
    resultText.textContent = myPlayerNum === 1 ? 'YOU WIN!' : 'YOU LOSE!';
    resultText.className = 'result-outcome p1-color';
    resultDetail.textContent = `${msg.p1Choice.toUpperCase()} beats ${msg.p2Choice.toUpperCase()}`;
  } else {
    resultText.textContent = myPlayerNum === 2 ? 'YOU WIN!' : 'YOU LOSE!';
    resultText.className = 'result-outcome p2-color';
    resultDetail.textContent = `${msg.p2Choice.toUpperCase()} beats ${msg.p1Choice.toUpperCase()}`;
  }

  // Result screen auto-advances (server will send next 'choose' or 'gameover')
}

// ============================================================
// SCREEN: CONTINUE
// ============================================================

function enterContinue(msg) {
  setState('continue');

  const loserText = document.getElementById('continue-loser');
  const countdown = document.getElementById('continue-countdown');

  const loserNum = msg.winner === 'p1' ? 2 : 1;
  if (loserNum === myPlayerNum) {
    loserText.textContent = "YOU'RE DOWN!";
  } else {
    loserText.textContent = 'OPPONENT IS DOWN!';
  }
  loserText.className = `continue-loser ${loserNum === 1 ? 'p1-color' : 'p2-color'}`;

  let count = msg.timeLimit;
  countdown.textContent = count;

  clearContinueTimer();
  continueTimerId = setInterval(() => {
    count--;
    countdown.textContent = Math.max(0, count);
    if (count <= 0) {
      clearContinueTimer();
    }
  }, 1000);
}

// ============================================================
// SCREEN: GAME OVER
// ============================================================

function enterGameover(msg) {
  setState('gameover');
  clearContinueTimer();

  const icon = document.getElementById('gameover-icon');
  const title = document.getElementById('gameover-title');
  const score = document.getElementById('gameover-score');
  const screen = document.getElementById('screen-gameover');

  screen.classList.remove('p1-wins', 'p2-wins');
  document.getElementById('rematch-status').textContent = '';

  const iWon = (msg.winner === 'p1' && myPlayerNum === 1) ||
               (msg.winner === 'p2' && myPlayerNum === 2);

  if (iWon) {
    icon.textContent = '🏆';
    title.textContent = 'YOU WIN!';
  } else {
    icon.textContent = '💀';
    title.textContent = 'YOU LOSE!';
  }

  screen.classList.add(msg.winner === 'p1' ? 'p1-wins' : 'p2-wins');
  score.textContent = `${msg.p1Score} — ${msg.p2Score}`;
}

// ============================================================
// DISCONNECT OVERLAY
// ============================================================

function showDisconnect(text) {
  document.getElementById('disconnect-text').textContent = text;
  document.getElementById('disconnect-overlay').classList.remove('hidden');
}

function hideDisconnect() {
  document.getElementById('disconnect-overlay').classList.add('hidden');
}

// ============================================================
// HP BAR UPDATE
// ============================================================

function updateHP(p1Score, p2Score, winsNeeded) {
  const root = document.documentElement;
  const p1Hp = Math.max(0, ((winsNeeded - p2Score) / winsNeeded) * 100);
  const p2Hp = Math.max(0, ((winsNeeded - p1Score) / winsNeeded) * 100);
  root.style.setProperty('--p1-hp', `${p1Hp}%`);
  root.style.setProperty('--p2-hp', `${p2Hp}%`);
}

// ============================================================
// EVENT LISTENERS
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();

  // Title → Lobby
  document.getElementById('btn-start').addEventListener('click', () => {
    setState('lobby');
  });

  // Lobby: Create Room
  document.getElementById('btn-create').addEventListener('click', () => {
    document.getElementById('lobby-error').textContent = '';
    sendMsg({ type: 'create-room' });
  });

  // Lobby: Join Room
  document.getElementById('btn-join').addEventListener('click', () => {
    const code = document.getElementById('input-code').value.trim().toUpperCase();
    if (code.length !== 4) {
      document.getElementById('lobby-error').textContent = 'Enter a 4-letter code';
      return;
    }
    document.getElementById('lobby-error').textContent = '';
    sendMsg({ type: 'join-room', code });
  });

  // Allow Enter key in code input
  document.getElementById('input-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('btn-join').click();
    }
  });

  // Waiting: Cancel
  document.getElementById('btn-cancel-wait').addEventListener('click', () => {
    sendMsg({ type: 'return-to-lobby' });
    currentRoomCode = null;
    myPlayerNum = null;
    // Reconnect to get a fresh connection
    ws.close();
    connectWebSocket();
    setState('lobby');
  });

  // Choice buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-choice');
    if (!btn || btn.disabled) return;
    sendMsg({ type: 'choice', choice: btn.dataset.choice });
  });

  // Continue
  document.getElementById('btn-continue').addEventListener('click', () => {
    sendMsg({ type: 'continue' });
  });

  // Game Over: Rematch
  document.getElementById('btn-rematch').addEventListener('click', () => {
    sendMsg({ type: 'rematch' });
    document.getElementById('rematch-status').textContent = 'WAITING FOR OPPONENT...';
    document.getElementById('btn-rematch').disabled = true;
  });

  // Game Over: Back to Lobby
  document.getElementById('btn-lobby').addEventListener('click', () => {
    sendMsg({ type: 'return-to-lobby' });
    currentRoomCode = null;
    myPlayerNum = null;
    document.getElementById('btn-rematch').disabled = false;
    ws.close();
    connectWebSocket();
    setState('lobby');
  });

  // Disconnect: Back to Lobby
  document.getElementById('btn-back-lobby').addEventListener('click', () => {
    hideDisconnect();
    currentRoomCode = null;
    myPlayerNum = null;
    document.getElementById('btn-rematch').disabled = false;
    if (ws.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    }
    setState('lobby');
  });
});
