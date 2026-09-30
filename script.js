(() => {
  'use strict';

  const COLS = 10;
  const ROWS = 20;
  const BLOCK = 30;
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const scoreEl = document.getElementById('score');
  const highScoreEl = document.getElementById('highScore');
  const linesEl = document.getElementById('lines');
  const levelEl = document.getElementById('level');
  const nextBox = document.getElementById('nextBox');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const overlayIcon = document.getElementById('overlayIcon');
  const overlayBtn = document.getElementById('overlayBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const newGameBtn = document.getElementById('newGameBtn');
  const soundBtn = document.getElementById('soundBtn');
  const themeBtn = document.getElementById('themeBtn');

  const COLORS = {
    I: ['#4DE7E0', '#22A8B3'],
    J: ['#5B7CFF', '#2E46B8'],
    L: ['#FFB84D', '#D97616'],
    O: ['#FFE45E', '#C7A617'],
    S: ['#59E389', '#229A4C'],
    T: ['#B56BFF', '#6B32C2'],
    Z: ['#FF5F82', '#B92550']
  };

  const SHAPES = {
    I: [[1,1,1,1]],
    J: [[1,0,0],[1,1,1]],
    L: [[0,0,1],[1,1,1]],
    O: [[1,1],[1,1]],
    S: [[0,1,1],[1,1,0]],
    T: [[0,1,0],[1,1,1]],
    Z: [[1,1,0],[0,1,1]]
  };

  const TYPES = Object.keys(SHAPES);
  let board = [];
  let current = null;
  let nextQueue = [];
  let holdType = null;
  let canHold = true;
  let score = 0;
  let lines = 0;
  let level = 1;
  let highScore = Number(localStorage.getItem('neonTetrisHighScore') || 0);
  let paused = false;
  let gameOver = false;
  let dropCounter = 0;
  let lastTime = 0;
  let softDropping = false;
  let animationFrame = 0;
  let soundOn = true;
  let audioContext = null;

  highScoreEl.textContent = highScore.toLocaleString();

  function createBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function refillQueue() {
    while (nextQueue.length < 5) nextQueue.push(...shuffle([...TYPES]));
  }

  function makePiece(type = null) {
    const chosen = type || (nextQueue.shift());
    refillQueue();
    const shape = SHAPES[chosen].map(row => [...row]);
    return {
      type: chosen,
      matrix: shape,
      x: Math.floor((COLS - shape[0].length) / 2),
      y: -1
    };
  }

  function resetGame() {
    cancelAnimationFrame(animationFrame);
    board = createBoard();
    nextQueue = [];
    refillQueue();
    holdType = null;
    canHold = true;
    score = 0;
    lines = 0;
    level = 1;
    paused = false;
    gameOver = false;
    dropCounter = 0;
    softDropping = false;
    current = makePiece();
    hideOverlay();
    updateStats();
    renderNext();
    lastTime = performance.now();
    animationFrame = requestAnimationFrame(update);
    beep('start');
  }

  function getDropInterval() {
    return Math.max(70, 900 * Math.pow(0.82, level - 1));
  }

  function updateStats() {
    scoreEl.textContent = score.toLocaleString();
    linesEl.textContent = lines.toLocaleString();
    levelEl.textContent = level;
    if (score > highScore) {
      highScore = score;
      localStorage.setItem('neonTetrisHighScore', String(highScore));
      highScoreEl.textContent = highScore.toLocaleString();
    }
  }

  function rotateMatrix(matrix) {
    const result = matrix[0].map((_, i) => matrix.map(row => row[i]).reverse());
    return result;
  }

  function collides(piece, dx = 0, dy = 0, matrix = piece.matrix) {
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const px = piece.x + x + dx;
        const py = piece.y + y + dy;
        if (px < 0 || px >= COLS || py >= ROWS) return true;
        if (py >= 0 && board[py][px]) return true;
      }
    }
    return false;
  }

  function move(dx) {
    if (paused || gameOver) return;
    if (!collides(current, dx, 0)) {
      current.x += dx;
      beep('move');
    }
  }

  function softDrop() {
    if (paused || gameOver) return;
    if (!collides(current, 0, 1)) {
      current.y++;
      score += 1;
      updateStats();
    } else {
      lockPiece();
    }
    dropCounter = 0;
  }

  function hardDrop() {
    if (paused || gameOver) return;
    let distance = 0;
    while (!collides(current, 0, 1)) {
      current.y++;
      distance++;
    }
    score += distance * 2;
    beep('drop');
    lockPiece();
  }

  function rotate() {
    if (paused || gameOver) return;
    if (current.type === 'O') return;
    const rotated = rotateMatrix(current.matrix);
    const kicks = [0, -1, 1, -2, 2];
    for (const kick of kicks) {
      if (!collides(current, kick, 0, rotated)) {
        current.matrix = rotated;
        current.x += kick;
        beep('rotate');
        return;
      }
    }
  }

  function hold() {
    if (paused || gameOver || !canHold) return;
    canHold = false;
    if (holdType === null) {
      holdType = current.type;
      current = makePiece();
    } else {
      const swap = holdType;
      holdType = current.type;
      current = makePiece(swap);
    }
    beep('hold');
    renderNext();
  }

  function merge(piece) {
    for (let y = 0; y < piece.matrix.length; y++) {
      for (let x = 0; x < piece.matrix[y].length; x++) {
        if (piece.matrix[y][x]) {
          const py = piece.y + y;
          const px = piece.x + x;
          if (py >= 0 && py < ROWS) board[py][px] = piece.type;
        }
      }
    }
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (board[y].every(Boolean)) {
        board.splice(y, 1);
        board.unshift(Array(COLS).fill(null));
        cleared++;
        y++;
      }
    }
    if (cleared) {
      const rewards = [0, 100, 300, 500, 800];
      score += rewards[cleared] * level;
      lines += cleared;
      level = Math.floor(lines / 10) + 1;
      updateStats();
      beep(`line${cleared}`);
    }
  }

  function lockPiece() {
    merge(current);
    const wasAboveBoard = current.y < 0;
    clearLines();
    current = makePiece();
    canHold = true;
    renderNext();
    dropCounter = 0;
    if (wasAboveBoard || collides(current, 0, 0)) endGame();
  }

  function endGame() {
    gameOver = true;
    paused = false;
    beep('gameover');
    showOverlay('GAME OVER', `Final score: ${score.toLocaleString()}`, '↯', 'PLAY AGAIN', resetGame);
  }

  function togglePause() {
    if (gameOver) return;
    paused = !paused;
    if (paused) {
      showOverlay('PAUSED', 'Take a breath. The board is frozen.', '⏸', 'RESUME', togglePause);
      pauseBtn.textContent = 'RESUME';
    } else {
      hideOverlay();
      pauseBtn.textContent = 'PAUSE';
      lastTime = performance.now();
    }
  }

  function showOverlay(title, text, icon, buttonText, handler) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayIcon.textContent = icon;
    overlayBtn.textContent = buttonText;
    overlayBtn.onclick = handler;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  function drawCell(context, x, y, type, size, alpha = 1) {
    const [top, bottom] = COLORS[type];
    const px = x * size;
    const py = y * size;
    context.save();
    context.globalAlpha = alpha;
    const g = context.createLinearGradient(px, py, px + size, py + size);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    context.fillStyle = g;
    context.fillRect(px + 2, py + 2, size - 4, size - 4);
    context.fillStyle = 'rgba(255,255,255,.24)';
    context.fillRect(px + 4, py + 4, size - 8, Math.max(2, size * .15));
    context.fillStyle = 'rgba(255,255,255,.07)';
    context.fillRect(px + 4, py + 6, Math.max(2, size * .11), size - 12);
    context.strokeStyle = 'rgba(255,255,255,.15)';
    context.lineWidth = 1;
    context.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);
    context.restore();
  }

  function drawGrid() {
    ctx.fillStyle = '#060810';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * BLOCK + .5, 0); ctx.lineTo(x * BLOCK + .5, ROWS * BLOCK); ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * BLOCK + .5); ctx.lineTo(COLS * BLOCK, y * BLOCK + .5); ctx.stroke();
    }
  }

  function drawBoard() {
    drawGrid();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (board[y][x]) drawCell(ctx, x, y, board[y][x], BLOCK);
      }
    }

    if (!current || gameOver) return;

    // Ghost piece
    let ghostY = current.y;
    while (!collides({ ...current, y: ghostY }, 0, 1)) ghostY++;
    for (let y = 0; y < current.matrix.length; y++) {
      for (let x = 0; x < current.matrix[y].length; x++) {
        if (current.matrix[y][x] && ghostY + y >= 0) drawCell(ctx, current.x + x, ghostY + y, current.type, BLOCK, .16);
      }
    }
    for (let y = 0; y < current.matrix.length; y++) {
      for (let x = 0; x < current.matrix[y].length; x++) {
        if (current.matrix[y][x] && current.y + y >= 0) drawCell(ctx, current.x + x, current.y + y, current.type, BLOCK);
      }
    }
  }

  function renderNext() {
    nextBox.innerHTML = '';
    const c = document.createElement('canvas');
    c.width = 150;
    c.height = 120;
    c.style.width = '150px';
    c.style.height = '120px';
    nextBox.appendChild(c);
    const nctx = c.getContext('2d');
    const type = nextQueue[0];
    const matrix = SHAPES[type];
    const size = 26;
    const w = matrix[0].length * size;
    const h = matrix.length * size;
    const ox = (c.width - w) / 2;
    const oy = (c.height - h) / 2;
    matrix.forEach((row, y) => row.forEach((v, x) => {
      if (v) drawCell(nctx, (ox / size) + x, (oy / size) + y, type, size);
    }));
  }

  function update(time = 0) {
    const delta = time - lastTime;
    lastTime = time;
    if (!paused && !gameOver) {
      dropCounter += delta * (softDropping ? 2.3 : 1);
      if (dropCounter > getDropInterval()) softDrop();
    }
    drawBoard();
    animationFrame = requestAnimationFrame(update);
  }

  function handleAction(action) {
    switch (action) {
      case 'left': move(-1); break;
      case 'right': move(1); break;
      case 'down': softDrop(); break;
      case 'drop': hardDrop(); break;
      case 'rotate': rotate(); break;
      case 'hold': hold(); break;
    }
  }

  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (['arrowleft','arrowright','arrowdown','arrowup',' ','p'].includes(key)) e.preventDefault();
    if (key === 'arrowleft') move(-1);
    else if (key === 'arrowright') move(1);
    else if (key === 'arrowdown') { softDropping = true; softDrop(); }
    else if (key === 'arrowup' || key === 'x') rotate();
    else if (key === ' ') hardDrop();
    else if (key === 'p') togglePause();
    else if (key === 'c') hold();
  });

  document.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'arrowdown') softDropping = false;
  });

  document.querySelectorAll('.touch-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn.dataset.action));
  });
  newGameBtn.addEventListener('click', resetGame);
  pauseBtn.addEventListener('click', togglePause);
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
  });
  themeBtn.addEventListener('click', () => document.body.classList.toggle('light'));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !paused && !gameOver) togglePause();
  });

  // Simple Web Audio feedback; enabled after the first interaction in most browsers.
  function beep(kind) {
    if (!soundOn) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      const map = {
        move: [280, .025, .025], rotate: [420, .04, .04], drop: [120, .06, .07],
        hold: [330, .04, .08], line1: [520, .07, .10], line2: [660, .08, .11],
        line3: [780, .1, .13], line4: [980, .14, .18], gameover: [80, .12, .25], start: [440,.05,.08]
      };
      const [freq, volume, duration] = map[kind] || map.move;
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + .006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.start(now); osc.stop(now + duration + .01);
    } catch (_) { /* Sound is optional. */ }
  }

  // Click / touch anywhere once to prime audio on browsers requiring a user gesture.
  window.addEventListener('pointerdown', () => {
    if (!audioContext && soundOn) beep('move');
  }, { once: true });

  resetGame();
})();
