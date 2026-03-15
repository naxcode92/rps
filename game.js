/*
  ROCK PAPER SCISSORS — ONLINE MULTIPLAYER CLIENT
  =================================================

  TEACHING: Client-Server Architecture

  Game logic lives on the SERVER. This client:
  1. Sends player actions (name, choices, rematch votes) to the server
  2. Receives game events (battle results, opponent status) from the server
  3. Updates the UI based on those events
  4. Sends "ready-for-next" when done animating so the server can advance

  The client NEVER decides who wins — the server is the authority.
*/

// ============================================================
// CONSTANTS
// ============================================================

const CHOICE_EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };
const CHOOSE_TIME = 15;

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

let ws = null;
let myPlayerNum = null;   // 1 or 2
let myName = 'ANON';
let opponentName = 'OPP';
let currentRoomCode = null;
let chooseTimerId = null;
let continueTimerId = null;

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log('Connected to server');
    // Re-send name if we already have one (reconnection case)
    if (myName && myName !== 'ANON') {
      sendMsg({ type: 'set-name', name: myName });
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg);
  };

  ws.onclose = () => {
    console.log('Disconnected from server');
    const state = document.getElementById('game-frame').dataset.state;
    if (!['title', 'lobby', 'name'].includes(state)) {
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

function goToLobby() {
  currentRoomCode = null;
  myPlayerNum = null;
  opponentName = 'OPP';
  document.getElementById('btn-rematch').disabled = false;
  document.getElementById('lobby-error').textContent = '';
  document.getElementById('input-code').value = '';
  setState('lobby');
}

// ============================================================
// SERVER MESSAGE HANDLER
// ============================================================

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
      opponentName = msg.opponentName || 'OPP';
      break;

    case 'random-waiting':
      setState('random-waiting');
      break;

    case 'random-cancelled':
      goToLobby();
      break;

    case 'random-matched':
      myPlayerNum = msg.playerNum;
      currentRoomCode = msg.code;
      opponentName = msg.opponentName || 'OPP';
      break;

    case 'game-starting':
      if (msg.p1Name && msg.p2Name) {
        opponentName = myPlayerNum === 1 ? msg.p2Name : msg.p1Name;
      }
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
      break;

    case 'gameover':
      enterGameover(msg);
      break;

    case 'opponent-wants-rematch':
      document.getElementById('rematch-status').textContent = opponentName + ' WANTS REMATCH!';
      break;

    case 'rematch-start':
      document.getElementById('rematch-status').textContent = '';
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

  // Re-enable next round button for future use
  document.getElementById('btn-next-round').disabled = false;

  const myNameDisplay = myPlayerNum === 1 ? msg.p1Name : msg.p2Name;
  const oppNameDisplay = myPlayerNum === 1 ? msg.p2Name : msg.p1Name;
  opponentName = oppNameDisplay;

  updateHP(msg.p1Score, msg.p2Score, msg.winsNeeded);
  document.getElementById('round-num').textContent = msg.round;

  // Show names in HP bar
  document.getElementById('hp-label-p1').textContent = myPlayerNum === 1 ? 'YOU' : oppNameDisplay;
  document.getElementById('hp-label-p2').textContent = myPlayerNum === 2 ? 'YOU' : oppNameDisplay;

  document.getElementById('choose-label').textContent = 'YOUR MOVE';
  document.getElementById('choose-label').className =
    `player-turn-label ${myPlayerNum === 1 ? 'p1-color' : 'p2-color'}`;
  document.getElementById('choose-sub').textContent = `vs ${oppNameDisplay}`;

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
  void timerFill.offsetWidth; // Force reflow to restart animation
  timerFill.classList.add('running');

  let countdown = CHOOSE_TIME;
  chooseTimerId = setInterval(() => {
    countdown--;
    timerText.textContent = Math.max(0, countdown);
    if (countdown <= 0) clearChooseTimer();
  }, 1000);
}

function onChoiceConfirmed(choice) {
  clearChooseTimer();

  document.querySelectorAll('.btn-choice').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.choice === choice) {
      btn.classList.add('selected');
    } else {
      btn.classList.add('disabled-choice');
    }
  });

  document.getElementById('choose-sub').textContent = `Waiting for ${opponentName}...`;
}

function onOpponentReady() {
  const sub = document.getElementById('choose-sub');
  if (!sub.textContent.startsWith('Waiting')) {
    sub.textContent = `${opponentName} is ready!`;
  }
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

  // Show names above sprites
  const p1Name = msg.p1Name || 'P1';
  const p2Name = msg.p2Name || 'P2';
  document.getElementById('battle-label-p1').textContent =
    myPlayerNum === 1 ? 'YOU' : p1Name;
  document.getElementById('battle-label-p2').textContent =
    myPlayerNum === 2 ? 'YOU' : p2Name;

  spriteP1.textContent = '?';
  spriteP2.textContent = '?';
  battleText.textContent = '';

  await delay(500);
  spriteP1.textContent = CHOICE_EMOJI[msg.p1Choice];
  await typeText(battleText, `${p1Name} used ${msg.p1Choice.toUpperCase()}!`);

  await delay(600);
  spriteP2.textContent = CHOICE_EMOJI[msg.p2Choice];
  await typeText(battleText, `${p2Name} used ${msg.p2Choice.toUpperCase()}!`);

  await delay(500);

  if (msg.result === 'draw') {
    await typeText(battleText, "It's a DRAW! Going again...");
  } else if (msg.result === 'p1') {
    spriteP2.parentElement.classList.add('shake');
    await typeText(battleText, `It's super effective! ${p1Name} wins!`);
  } else {
    spriteP1.parentElement.classList.add('shake');
    await typeText(battleText, `It's super effective! ${p2Name} wins!`);
  }

  await delay(1200);

  spriteP1.parentElement.classList.remove('shake');
  spriteP2.parentElement.classList.remove('shake');

  if (msg.matchOver) {
    // Match is over — tell server we're ready for gameover/continue screen
    sendMsg({ type: 'ready-for-next' });
  } else if (msg.result === 'draw') {
    // Draw — tell server we're ready for next round immediately
    sendMsg({ type: 'ready-for-next' });
  } else {
    // Round won/lost — show result screen with "NEXT ROUND" button
    showResult(msg);
  }
}

function showResult(msg) {
  setState('result');

  const resultText = document.getElementById('result-text');
  const resultDetail = document.getElementById('result-detail');
  const resultRound = document.getElementById('result-round');
  const p1Name = msg.p1Name || 'P1';
  const p2Name = msg.p2Name || 'P2';

  document.getElementById('score-p1').textContent = msg.p1Score;
  document.getElementById('score-p2').textContent = msg.p2Score;
  document.getElementById('result-name-p1').textContent = myPlayerNum === 1 ? 'YOU' : p1Name;
  document.getElementById('result-name-p2').textContent = myPlayerNum === 2 ? 'YOU' : p2Name;
  document.getElementById('result-label-p1').textContent = myPlayerNum === 1 ? 'YOU' : p1Name;
  document.getElementById('result-label-p2').textContent = myPlayerNum === 2 ? 'YOU' : p2Name;
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
    loserText.textContent = `${opponentName} IS DOWN!`;
  }
  loserText.className = `continue-loser ${loserNum === 1 ? 'p1-color' : 'p2-color'}`;

  let count = msg.timeLimit;
  countdown.textContent = count;

  clearContinueTimer();
  continueTimerId = setInterval(() => {
    count--;
    countdown.textContent = Math.max(0, count);
    if (count <= 0) clearContinueTimer();
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
  document.getElementById('btn-rematch').disabled = false;

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

  // Title → Name Entry
  document.getElementById('btn-start').addEventListener('click', () => {
    setState('name');
    document.getElementById('input-name').focus();
  });

  // Name Entry → Lobby
  document.getElementById('btn-enter-name').addEventListener('click', submitName);
  document.getElementById('input-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitName();
  });

  function submitName() {
    const name = document.getElementById('input-name').value.trim().toUpperCase();
    if (!name) {
      document.getElementById('input-name').focus();
      return;
    }
    myName = name.substring(0, 12);
    sendMsg({ type: 'set-name', name: myName });
    document.getElementById('lobby-welcome').textContent = `Welcome, ${myName}!`;
    goToLobby();
  }

  // Lobby: Random Match
  document.getElementById('btn-random').addEventListener('click', () => {
    document.getElementById('lobby-error').textContent = '';
    sendMsg({ type: 'random-match' });
  });

  // Random Waiting: Cancel
  document.getElementById('btn-cancel-random').addEventListener('click', () => {
    sendMsg({ type: 'cancel-random' });
    goToLobby();
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

  document.getElementById('input-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });

  // Waiting: Cancel
  document.getElementById('btn-cancel-wait').addEventListener('click', () => {
    sendMsg({ type: 'return-to-lobby' });
    ws.close();
    connectWebSocket();
    goToLobby();
  });

  // Choice buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-choice');
    if (!btn || btn.disabled) return;
    sendMsg({ type: 'choice', choice: btn.dataset.choice });
  });

  // Result: Next Round — player signals they've seen the result
  document.getElementById('btn-next-round').addEventListener('click', () => {
    sendMsg({ type: 'ready-for-next' });
    // Show a brief "waiting" state
    document.getElementById('result-text').textContent = 'WAITING...';
    document.getElementById('btn-next-round').disabled = true;
  });

  // Continue
  document.getElementById('btn-continue').addEventListener('click', () => {
    sendMsg({ type: 'continue' });
  });

  // Game Over: Rematch
  document.getElementById('btn-rematch').addEventListener('click', () => {
    sendMsg({ type: 'rematch' });
    document.getElementById('rematch-status').textContent = 'WAITING FOR ' + opponentName + '...';
    document.getElementById('btn-rematch').disabled = true;
  });

  // Game Over: Back to Lobby
  document.getElementById('btn-lobby').addEventListener('click', () => {
    sendMsg({ type: 'return-to-lobby' });
    ws.close();
    connectWebSocket();
    goToLobby();
  });

  // Disconnect: Back to Lobby
  document.getElementById('btn-back-lobby').addEventListener('click', () => {
    hideDisconnect();
    if (ws.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    }
    goToLobby();
  });
});
