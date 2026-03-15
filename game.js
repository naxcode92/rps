/*
  ROCK PAPER SCISSORS — BATTLE EDITION
  =====================================

  TEACHING: State Machine Pattern

  The entire game is organized as a STATE MACHINE. At any moment, the game
  is in exactly ONE state (like "title", "p1-choose", "battle", etc.).

  Each state has:
  - A screen that's visible (handled by CSS via data-state attribute)
  - An "enter" function that runs when we switch TO that state
  - Specific user actions that trigger transitions to OTHER states

  This pattern prevents bugs like "what happens if the player clicks while
  the battle animation is playing?" — the answer is nothing, because
  choice buttons only work in the "choose" state.

  State flow:
  TITLE → P1_CHOOSE → HANDOFF → P2_CHOOSE → BATTLE → RESULT
                                                        ↓
                                            (loop to P1_CHOOSE)
                                            (or GAMEOVER / CONTINUE)
*/

// ============================================================
// CONSTANTS
// ============================================================

/*
  TEACHING: Named Constants

  Instead of scattering magic strings and numbers throughout the code,
  we define them here. If you want to change the timer from 5 seconds
  to 3, you change ONE line. If you want to add "lizard" and "spock",
  you update these two objects.
*/

const CHOICES = ['rock', 'paper', 'scissors'];

// What each choice beats. Rock beats scissors, scissors beats paper, etc.
const WIN_MAP = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock'
};

// Emoji for each choice (displayed in battle sprites)
const CHOICE_EMOJI = {
  rock: '✊',
  paper: '✋',
  scissors: '✌️'
};

const CHOOSE_TIME = 5;     // Seconds to pick a move
const CONTINUE_TIME = 10;  // Seconds on the continue screen

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/*
  TEACHING: Promise-based delay

  Instead of deeply nested setTimeout callbacks like:
    setTimeout(() => {
      doThing1();
      setTimeout(() => {
        doThing2();
        setTimeout(() => { ... }, 500);
      }, 500);
    }, 500);

  We can write:
    await delay(500);
    doThing1();
    await delay(500);
    doThing2();

  This makes the battle sequence read like a movie script!
*/
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/*
  TEACHING: Typewriter Effect

  This simulates the Pokemon text box where characters appear one by one.
  It returns a Promise so we can "await" it and continue only after
  the text is fully displayed.

  The trick: we build the string character by character using setInterval,
  and resolve the Promise when we reach the end.
*/
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

/*
  TEACHING: Pure Functions

  resolveRound() is a "pure function" — given the same inputs, it ALWAYS
  returns the same output, and it doesn't change anything outside itself.

  Why does this matter?
  - Easy to test: resolveRound('rock', 'scissors') always returns 'p1'
  - Easy to reason about: no hidden side effects
  - Easy to debug: if the result is wrong, the bug is in these 3 lines
*/
function resolveRound(p1Choice, p2Choice) {
  if (p1Choice === p2Choice) return 'draw';
  if (WIN_MAP[p1Choice] === p2Choice) return 'p1';
  return 'p2';
}

// Returns a random choice (used when the timer expires)
function randomChoice() {
  return CHOICES[Math.floor(Math.random() * CHOICES.length)];
}

// ============================================================
// GAME STATE
// ============================================================

/*
  TEACHING: The Game Object

  All game state lives in ONE object. This is simpler than scattering
  variables everywhere, and makes it easy to reset the game — just
  re-initialize the properties.

  Think of this like a "save file" — it contains everything needed
  to describe the current state of the game.
*/
const Game = {
  state: 'title',
  p1Score: 0,
  p2Score: 0,
  currentRound: 1,
  maxRounds: 3,       // Becomes 7 after continue
  winsNeeded: 2,      // Becomes 4 after continue
  continued: false,    // Has the continue been used?
  p1Choice: null,
  p2Choice: null,

  // Timer references (so we can clear them when needed)
  chooseTimerId: null,
  chooseCountdown: CHOOSE_TIME,
  continueTimerId: null,
  continueCountdown: CONTINUE_TIME,

  // Track who lost (for the continue screen)
  loser: null,

  // ============================================================
  // STATE MACHINE: Transition
  // ============================================================

  /*
    TEACHING: Single Point of Control

    Every state change in the game goes through this ONE function.
    This means:
    - You can add logging here to debug any state issue
    - You can add validation (e.g., "can't go to battle from title")
    - The CSS data-state attribute is ALWAYS in sync with the JS state
  */
  transition(newState) {
    // Clean up any running timers from the previous state
    this.clearTimers();

    this.state = newState;
    document.getElementById('game-frame').dataset.state = newState;

    // Call the enter function for the new state
    switch (newState) {
      case 'title':      this.enterTitle(); break;
      case 'p1-choose':  this.enterChoose(1); break;
      case 'handoff':    this.enterHandoff(); break;
      case 'p2-choose':  this.enterChoose(2); break;
      case 'battle':     this.enterBattle(); break;
      case 'result':     this.enterResult(); break;
      case 'gameover':   this.enterGameover(); break;
      case 'continue':   this.enterContinue(); break;
    }
  },

  // ============================================================
  // RESET
  // ============================================================

  reset() {
    this.p1Score = 0;
    this.p2Score = 0;
    this.currentRound = 1;
    this.maxRounds = 3;
    this.winsNeeded = 2;
    this.continued = false;
    this.p1Choice = null;
    this.p2Choice = null;
    this.loser = null;
    this.updateScoreDisplay();
  },

  // ============================================================
  // TIMER MANAGEMENT
  // ============================================================

  /*
    TEACHING: Cleaning Up Timers

    If we don't clear timers when leaving a state, they keep running
    in the background and can cause bugs (e.g., the choose timer expires
    AFTER you've already moved to the battle screen).

    This is a common source of bugs in games and apps — always clean
    up intervals and timeouts when they're no longer needed!
  */
  clearTimers() {
    if (this.chooseTimerId) {
      clearInterval(this.chooseTimerId);
      this.chooseTimerId = null;
    }
    if (this.continueTimerId) {
      clearInterval(this.continueTimerId);
      this.continueTimerId = null;
    }
  },

  // ============================================================
  // STATE: TITLE
  // ============================================================

  enterTitle() {
    // Nothing special — the CSS handles showing the title screen
  },

  // ============================================================
  // STATE: CHOOSE (shared by P1 and P2)
  // ============================================================

  enterChoose(playerNum) {
    // Update round display
    document.getElementById(`round-num-p1`).textContent = this.currentRound;
    document.getElementById(`round-num-p2`).textContent = this.currentRound;

    // Reset timer display
    this.chooseCountdown = CHOOSE_TIME;
    const timerFill = document.getElementById(`timer-p${playerNum}`);
    const timerText = document.getElementById(`timer-text-p${playerNum}`);

    timerText.textContent = CHOOSE_TIME;
    timerFill.classList.remove('running');

    // Force a browser reflow so the animation restarts cleanly
    // (without this, removing and re-adding the class wouldn't replay the animation)
    void timerFill.offsetWidth;

    timerFill.classList.add('running');

    // Start the countdown (game logic timer, separate from CSS animation)
    this.chooseTimerId = setInterval(() => {
      this.chooseCountdown--;
      timerText.textContent = this.chooseCountdown;

      if (this.chooseCountdown <= 0) {
        // Time's up! Auto-pick a random choice for this player
        this.handleChoice(playerNum, randomChoice(), true);
      }
    }, 1000);

    // Update HP bars
    this.updateScoreDisplay();
  },

  // ============================================================
  // HANDLE CHOICE
  // ============================================================

  handleChoice(playerNum, choice, wasTimeout = false) {
    // Prevent double-picks (e.g., clicking fast or timer + click race)
    if (playerNum === 1 && this.state !== 'p1-choose') return;
    if (playerNum === 2 && this.state !== 'p2-choose') return;

    this.clearTimers();

    if (playerNum === 1) {
      this.p1Choice = choice;
      // Move to handoff screen so P2 doesn't see P1's choice
      this.transition('handoff');
    } else {
      this.p2Choice = choice;
      // Both players have chosen — time for battle!
      this.transition('battle');
    }
  },

  // ============================================================
  // STATE: HANDOFF
  // ============================================================

  enterHandoff() {
    // Nothing special — just shows "Pass to Player 2" with a Ready button
  },

  // ============================================================
  // STATE: BATTLE
  // ============================================================

  /*
    TEACHING: async/await for Animation Sequences

    The battle is a scripted sequence of events with specific timing.
    Using async/await, we write it like a screenplay:
      1. Show P1's move
      2. Wait
      3. Show P2's move
      4. Wait
      5. Show result
      6. Advance

    Without async/await, this would be deeply nested setTimeout
    callbacks (often called "callback hell"). async/await makes
    the timing logic flat and readable.
  */
  async enterBattle() {
    const battleText = document.getElementById('battle-text');
    const spriteP1 = document.getElementById('sprite-p1');
    const spriteP2 = document.getElementById('sprite-p2');

    // Reset sprites
    spriteP1.textContent = '?';
    spriteP2.textContent = '?';
    battleText.textContent = '';

    // Step 1: Reveal P1's choice
    await delay(500);
    spriteP1.textContent = CHOICE_EMOJI[this.p1Choice];
    await typeText(battleText, `P1 used ${this.p1Choice.toUpperCase()}!`);

    // Step 2: Reveal P2's choice
    await delay(600);
    spriteP2.textContent = CHOICE_EMOJI[this.p2Choice];
    await typeText(battleText, `P2 used ${this.p2Choice.toUpperCase()}!`);

    // Step 3: Determine result and show flavor text
    const result = resolveRound(this.p1Choice, this.p2Choice);
    await delay(500);

    if (result === 'draw') {
      await typeText(battleText, 'It\'s a DRAW!');
    } else if (result === 'p1') {
      spriteP2.parentElement.classList.add('shake');
      await typeText(battleText, 'It\'s super effective! P1 wins!');
    } else {
      spriteP1.parentElement.classList.add('shake');
      await typeText(battleText, 'It\'s super effective! P2 wins!');
    }

    // Step 4: Brief pause to let the result sink in, then advance
    await delay(1200);

    // Remove shake animation classes
    spriteP1.parentElement.classList.remove('shake');
    spriteP2.parentElement.classList.remove('shake');

    // Process the round result
    if (result === 'draw') {
      // Draws don't count — go back to P1 choose for the same round
      this.p1Choice = null;
      this.p2Choice = null;
      this.transition('p1-choose');
    } else {
      if (result === 'p1') this.p1Score++;
      else this.p2Score++;
      this.transition('result');
    }
  },

  // ============================================================
  // STATE: RESULT
  // ============================================================

  enterResult() {
    const resultText = document.getElementById('result-text');
    const resultDetail = document.getElementById('result-detail');
    const resultRound = document.getElementById('result-round');

    // Update score display
    document.getElementById('score-p1').textContent = this.p1Score;
    document.getElementById('score-p2').textContent = this.p2Score;
    this.updateScoreDisplay();

    resultRound.textContent = `ROUND ${this.currentRound}`;

    // Determine who won this round
    const lastResult = resolveRound(this.p1Choice, this.p2Choice);
    if (lastResult === 'p1') {
      resultText.textContent = 'PLAYER 1 WINS!';
      resultText.className = 'result-outcome p1-color';
      resultDetail.textContent = `${this.p1Choice.toUpperCase()} beats ${this.p2Choice.toUpperCase()}`;
    } else {
      resultText.textContent = 'PLAYER 2 WINS!';
      resultText.className = 'result-outcome p2-color';
      resultDetail.textContent = `${this.p2Choice.toUpperCase()} beats ${this.p1Choice.toUpperCase()}`;
    }

    this.currentRound++;

    // Check if the match is over
    const matchResult = this.checkMatchEnd();
    const nextBtn = document.getElementById('btn-next-round');

    if (matchResult) {
      nextBtn.textContent = 'SEE RESULTS';
    } else {
      nextBtn.textContent = 'NEXT ROUND';
    }
  },

  // ============================================================
  // CHECK MATCH END
  // ============================================================

  /*
    TEACHING: Separation of Concerns

    This function ONLY checks whether the match is over.
    It doesn't update the UI, it doesn't transition states.
    It just answers a question: "who won, or null?"

    The calling code (enterResult, btn-next-round handler) decides
    what to DO with that information. This makes the code easier
    to understand and modify.
  */
  checkMatchEnd() {
    if (this.p1Score >= this.winsNeeded) return 'p1';
    if (this.p2Score >= this.winsNeeded) return 'p2';
    return null;
  },

  // ============================================================
  // STATE: GAME OVER
  // ============================================================

  enterGameover() {
    const icon = document.getElementById('gameover-icon');
    const title = document.getElementById('gameover-title');
    const score = document.getElementById('gameover-score');
    const screen = document.getElementById('screen-gameover');

    // Remove old winner classes
    screen.classList.remove('p1-wins', 'p2-wins');

    const winner = this.checkMatchEnd();

    if (winner === 'p1') {
      icon.textContent = '🏆';
      title.textContent = 'PLAYER 1 WINS!';
      screen.classList.add('p1-wins');
    } else {
      icon.textContent = '🏆';
      title.textContent = 'PLAYER 2 WINS!';
      screen.classList.add('p2-wins');
    }

    score.textContent = `${this.p1Score} — ${this.p2Score}`;
  },

  // ============================================================
  // STATE: CONTINUE
  // ============================================================

  enterContinue() {
    const loserText = document.getElementById('continue-loser');
    const countdown = document.getElementById('continue-countdown');

    // Figure out who lost
    this.loser = this.checkMatchEnd() === 'p1' ? 'p2' : 'p1';
    loserText.textContent = this.loser === 'p1' ? 'PLAYER 1' : 'PLAYER 2';
    loserText.className = `continue-loser ${this.loser === 'p1' ? 'p1-color' : 'p2-color'}`;

    // Start 10-second countdown
    this.continueCountdown = CONTINUE_TIME;
    countdown.textContent = CONTINUE_TIME;

    this.continueTimerId = setInterval(() => {
      this.continueCountdown--;
      countdown.textContent = this.continueCountdown;

      if (this.continueCountdown <= 0) {
        this.clearTimers();
        this.transition('gameover');
      }
    }, 1000);
  },

  // ============================================================
  // HANDLE CONTINUE
  // ============================================================

  /*
    TEACHING: Continue System

    When a player pays $1 to continue:
    - maxRounds goes from 3 to 7
    - winsNeeded goes from 2 to 4
    - Scores are PRESERVED (so if it was 2-1, the losing player
      needs 3 more wins while the winner needs 2 more)
    - The continued flag prevents using continue twice

    This creates an interesting dynamic: the player who was ahead
    still has an advantage, but the other player has a fighting chance.
  */
  handleContinue() {
    this.clearTimers();
    this.continued = true;
    this.maxRounds = 7;
    this.winsNeeded = 4;

    // Reset choices for the next round
    this.p1Choice = null;
    this.p2Choice = null;

    this.updateScoreDisplay();
    this.transition('p1-choose');
  },

  // ============================================================
  // UPDATE SCORE DISPLAY
  // ============================================================

  /*
    TEACHING: CSS Custom Properties from JavaScript

    Instead of directly manipulating DOM element widths, we update
    CSS custom properties (variables). The CSS already knows how to
    use these variables for the HP bar widths + transitions.

    JavaScript:  style.setProperty('--p1-hp', '66%')
    CSS:         width: var(--p1-hp)  with  transition: width 0.6s

    This keeps the visual logic in CSS where it belongs, and
    JavaScript only provides the DATA.
  */
  updateScoreDisplay() {
    const root = document.documentElement;

    // HP represents how many more losses you can take
    // Full HP = opponent hasn't scored at all
    // Empty HP = opponent has reached winsNeeded
    const p1Hp = Math.max(0, ((this.winsNeeded - this.p2Score) / this.winsNeeded) * 100);
    const p2Hp = Math.max(0, ((this.winsNeeded - this.p1Score) / this.winsNeeded) * 100);

    root.style.setProperty('--p1-hp', `${p1Hp}%`);
    root.style.setProperty('--p2-hp', `${p2Hp}%`);
  }
};

// ============================================================
// EVENT LISTENERS
// ============================================================

/*
  TEACHING: Event Delegation vs Direct Binding

  For the choice buttons, we use "event delegation" — ONE listener
  on the parent container that checks which button was clicked.
  This is more efficient than 6 separate listeners (3 per player).

  For unique buttons (start, ready, continue, play again), we use
  direct binding since there's only one of each.
*/

document.addEventListener('DOMContentLoaded', () => {
  // Title: Press Start
  document.getElementById('btn-start').addEventListener('click', () => {
    Game.reset();
    Game.transition('p1-choose');
  });

  // Handoff: Ready button (P2 is ready to choose)
  document.getElementById('btn-ready').addEventListener('click', () => {
    Game.transition('p2-choose');
  });

  // Choice buttons — event delegation
  // We listen on the entire document for clicks on .btn-choice elements
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-choice');
    if (!btn) return;

    const choice = btn.dataset.choice;
    const player = parseInt(btn.dataset.player);

    Game.handleChoice(player, choice);
  });

  // Result: Next Round / See Results
  document.getElementById('btn-next-round').addEventListener('click', () => {
    const matchResult = Game.checkMatchEnd();

    if (matchResult) {
      // Match is over
      if (!Game.continued) {
        // First loss — offer continue
        Game.transition('continue');
      } else {
        // Already used continue — final game over
        Game.transition('gameover');
      }
    } else {
      // Match continues — next round
      Game.p1Choice = null;
      Game.p2Choice = null;
      Game.transition('p1-choose');
    }
  });

  // Continue: Pay $1
  document.getElementById('btn-continue').addEventListener('click', () => {
    Game.handleContinue();
  });

  // Game Over: Play Again
  document.getElementById('btn-play-again').addEventListener('click', () => {
    Game.reset();
    Game.transition('title');
  });
});
