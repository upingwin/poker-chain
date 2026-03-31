// ─── API Integration ──────────────────────────────────────────────────────────
// After deploying the Cloudflare Worker, replace this URL:
const API_BASE = 'https://poker-chain-api.pokerchain.workers.dev';
const API_READY = API_BASE && !API_BASE.includes('YOURSUBDOMAIN');

function getTgUser() {
  return window.Telegram?.WebApp?.initDataUnsafe?.user || null;
}
function getTgInitData() {
  return window.Telegram?.WebApp?.initData || '';
}

async function apiPost(path, body) {
  if (!API_READY) return null;
  try {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tg-Init-Data': getTgInitData() },
      body: JSON.stringify(body),
    });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

async function apiGet(path) {
  if (!API_READY) return null;
  try {
    const res = await fetch(API_BASE + path);
    return res.ok ? res.json() : null;
  } catch { return null; }
}

async function submitScore(levelId, score, stars) {
  return apiPost('/api/score', { level_id: levelId, score, stars });
}

async function fetchChampions(from, to) {
  const data = await apiGet(`/api/champions?from=${from}&to=${to}`);
  return data?.champions || {};
}

async function fetchLevelTop(levelId) {
  const data = await apiGet(`/api/level/${levelId}`);
  return data?.top || [];
}

async function fetchGlobal() {
  const user = getTgUser();
  const q    = user?.id ? `?user_id=${user.id}` : '';
  return apiGet(`/api/global${q}`);
}

// ─── Chapter & Level Config ───────────────────────────────────────────────────
// 15 chapters × 10 levels = 150 total
// rank: 1-13 = card rank, 14 = Small Joker chapter, 15 = Big Joker chapter
const CHAPTERS = [
  { id:  1, rank:  1, symbol: 'A',  name: 'Aces',        from:   1, to:  10, targetMin:  1500, targetMax:  2500, lockedMin:  0, lockedMax:  2, jokers: 0 },
  { id:  2, rank:  2, symbol: '2',  name: 'Twos',        from:  11, to:  20, targetMin:  2500, targetMax:  4000, lockedMin:  2, lockedMax:  4, jokers: 0 },
  { id:  3, rank:  3, symbol: '3',  name: 'Threes',      from:  21, to:  30, targetMin:  4000, targetMax:  6000, lockedMin:  3, lockedMax:  5, jokers: 0 },
  { id:  4, rank:  4, symbol: '4',  name: 'Fours',       from:  31, to:  40, targetMin:  6000, targetMax:  8500, lockedMin:  4, lockedMax:  6, jokers: 1 },
  { id:  5, rank:  5, symbol: '5',  name: 'Fives',       from:  41, to:  50, targetMin:  8500, targetMax: 11500, lockedMin:  5, lockedMax:  7, jokers: 1 },
  { id:  6, rank:  6, symbol: '6',  name: 'Sixes',       from:  51, to:  60, targetMin: 11500, targetMax: 15000, lockedMin:  6, lockedMax:  8, jokers: 1 },
  { id:  7, rank:  7, symbol: '7',  name: 'Sevens',      from:  61, to:  70, targetMin: 15000, targetMax: 19000, lockedMin:  7, lockedMax:  9, jokers: 2 },
  { id:  8, rank:  8, symbol: '8',  name: 'Eights',      from:  71, to:  80, targetMin: 19000, targetMax: 23500, lockedMin:  8, lockedMax:  9, jokers: 2 },
  { id:  9, rank:  9, symbol: '9',  name: 'Nines',       from:  81, to:  90, targetMin: 23500, targetMax: 28500, lockedMin:  8, lockedMax: 10, jokers: 2 },
  { id: 10, rank: 10, symbol: '10', name: 'Tens',        from:  91, to: 100, targetMin: 28500, targetMax: 34000, lockedMin:  9, lockedMax: 10, jokers: 2 },
  { id: 11, rank: 11, symbol: 'J',  name: 'Jacks',       from: 101, to: 110, targetMin: 34000, targetMax: 40000, lockedMin:  9, lockedMax: 11, jokers: 3 },
  { id: 12, rank: 12, symbol: 'Q',  name: 'Queens',      from: 111, to: 120, targetMin: 40000, targetMax: 46500, lockedMin: 10, lockedMax: 11, jokers: 3 },
  { id: 13, rank: 13, symbol: 'K',  name: 'Kings',       from: 121, to: 130, targetMin: 46500, targetMax: 53500, lockedMin: 10, lockedMax: 12, jokers: 3 },
  { id: 14, rank: 14, symbol: '🃏', name: 'Little Wild', from: 131, to: 140, targetMin: 53500, targetMax: 61000, lockedMin: 11, lockedMax: 12, jokers: 3 },
  { id: 15, rank: 15, symbol: '★',  name: 'Big Wild',    from: 141, to: 150, targetMin: 61000, targetMax: 70000, lockedMin: 11, lockedMax: 12, jokers: 4 },
];

function generateLevels() {
  const levels = [];
  CHAPTERS.forEach(ch => {
    const count = ch.to - ch.from + 1;
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      levels.push({
        id:          ch.from + i,
        chapter:     ch.id,
        chapterName: ch.name,
        chapterRank: ch.rank,
        target:      Math.round(ch.targetMin + t * (ch.targetMax - ch.targetMin)),
        lockedCount: Math.round(ch.lockedMin + t * (ch.lockedMax - ch.lockedMin)),
        jokers:      ch.jokers,
      });
    }
  });
  return levels;
}
const LEVELS = generateLevels();

const STAR_THRESHOLDS = [1.0, 1.15, 1.3];

// New players get 3 of each tool (stored in localStorage, not per-level)
function getInitialTools() {
  return { shuffle: 0, undo: 0 }; // always start level with 0; tools come from inventory
}

function getToolInventory() {
  const p = loadProgress();
  if (!p._toolsGiven) {
    // First-time gift: 3 of each
    p._toolsGiven = true;
    p._tools = { shuffle: 3, undo: 3, timecard: 3 };
    saveProgress(p);
  }
  // Patch existing saves that predate timecard
  if (p._tools && p._tools.timecard === undefined) {
    p._tools.timecard = 3;
    saveProgress(p);
  }
  return p._tools || { shuffle: 0, undo: 0, timecard: 0 };
}

function saveToolInventory(tools) {
  const p = loadProgress();
  p._tools = tools;
  saveProgress(p);
}

// ─── Chapter Mastery (Power Cards) ────────────────────────────────────────────
// A chapter is mastered when all 10 levels earn 3 stars.
// Mastered rank → each card of that rank in a chain adds +1 to effective length.
function getMasteredRanks() {
  const stars = loadProgress().stars || {};
  const mastered = new Set();
  CHAPTERS.forEach(ch => {
    let all = true;
    for (let id = ch.from; id <= ch.to; id++) {
      if ((stars[id] || 0) < 3) { all = false; break; }
    }
    if (all) mastered.add(ch.rank);
  });
  return mastered;
}

function isChapterMastered(chapterId) {
  const ch = CHAPTERS.find(c => c.id === chapterId);
  if (!ch) return false;
  const stars = loadProgress().stars || {};
  for (let id = ch.from; id <= ch.to; id++) {
    if ((stars[id] || 0) < 3) return false;
  }
  return true;
}

// Map a card to its chapter rank key (for mastery lookup)
function cardRankKey(card) {
  if (!card.isJoker) return card.rank;           // 1-13
  return card.isBig ? 15 : 14;                  // Big=15, Small=14
}


// ─── Constants ────────────────────────────────────────────────────────────────
const COLS = 5, ROWS = 6;
const RANK_LABEL  = ['','A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUIT_SYMBOL = ['♠','♥','♦','♣'];
const RED_SUITS   = new Set([1, 2]);
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 18; // ≈ 113.1
const LEVEL_TIME_START    = 90;   // seconds at level start
const MAX_TIME            = 90;   // time cap

// Stars pricing per tool
const TOOL_STARS = { shuffle: 5, undo: 3 };

const TOOL_INFO = {
  shuffle:  { icon: '⇌', name: 'Shuffle',   desc: 'Rearrange all face-up cards on the board.' },
  undo:     { icon: '↩', name: 'Undo',      desc: 'Roll back your last move.' },
  timecard: { icon: '⏱', name: '+60s Card', desc: 'Add 60 seconds — no cap applied.' },
};

// ─── State ────────────────────────────────────────────────────────────────────
let board = [], deck = [], discardPile = [];
let score = 0;
let timeLeft = 0, timerId = null;
let isDragging = false, selectedCells = [];
let currentLevel = null;
let toolsLeft = { shuffle: 0, undo: 0 };
let prevState  = null;
let isMuted    = false;
let pendingStarsTool = null;
let activeChapter    = 1;

// ─── Telegram Init ────────────────────────────────────────────────────────────
function initTelegram() {
  if (!window.Telegram?.WebApp) return;
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();

  // Apply Telegram theme colors via CSS variables
  const tp = tg.themeParams || {};
  const root = document.documentElement;
  if (tp.bg_color)           root.style.setProperty('--tg-bg',     tp.bg_color);
  if (tp.text_color)         root.style.setProperty('--tg-text',   tp.text_color);
  if (tp.button_color)       root.style.setProperty('--tg-btn',    tp.button_color);
  if (tp.button_text_color)  root.style.setProperty('--tg-btn-txt',tp.button_text_color);

  // Handle back button
  tg.BackButton.onClick(() => {
    if (!document.getElementById('screen-game').classList.contains('hidden')) goBack();
  });
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function loadProgress() {
  try { return JSON.parse(localStorage.getItem('pokerConnect') || '{}'); }
  catch { return {}; }
}
function saveProgress(data) { localStorage.setItem('pokerConnect', JSON.stringify(data)); }
function getUnlocked()      { return loadProgress().unlocked || 1; }
function getStars(id)       { return (loadProgress().stars || {})[id] || 0; }
function recordWin(id, earned) {
  const p = loadProgress();
  p.stars = p.stars || {};
  const prevStars = p.stars[id] || 0;
  p.stars[id] = Math.max(prevStars, earned);
  p.unlocked  = Math.max(p.unlocked || 1, id + 1);
  saveProgress(p);

  // Check if this completes chapter mastery for the first time
  const level   = LEVELS[id - 1];
  const ch      = CHAPTERS.find(c => c.id === level.chapter);
  if (ch && earned === 3 && isChapterMastered(ch.id)) {
    const wasMastered = (loadProgress()._mastered || {})[ch.id];
    if (!wasMastered) {
      const pm = loadProgress();
      pm._mastered = pm._mastered || {};
      pm._mastered[ch.id] = true;
      saveProgress(pm);
      // Show mastery unlock after overlay settles
      setTimeout(() => showMasteryUnlock(ch), 1600);
    }
  }
}

// ─── Deck ─────────────────────────────────────────────────────────────────────
function buildDeck(jokerCount) {
  const cards = [];
  for (let s = 0; s < 4; s++)
    for (let r = 1; r <= 13; r++)
      cards.push({ suit: s, rank: r, faceUp: false });
  for (let i = 0; i < jokerCount; i++)
    cards.push({ suit: -1, rank: 0, faceUp: false, isJoker: true, isBig: i % 2 === 0 });
  return shuffle(cards);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawCard() {
  if (!deck.length) {
    if (!discardPile.length) return null;
    deck = shuffle(discardPile.map(c => ({ ...c, faceUp: false })));
    discardPile = [];
  }
  return { ...deck.pop(), faceUp: false };
}

// ─── Tutorial Board Builder ───────────────────────────────────────────────────
// helper used by hint system
function couldBeConsecutive(ranks) {
  const sorted = [...ranks].sort((a, b) => a - b);
  if (new Set(sorted).size !== sorted.length) return false;
  return sorted[sorted.length - 1] - sorted[0] <= 4;
}

// ─── Level Select ─────────────────────────────────────────────────────────────
// Suit assignment per chapter: A♠ 2♥ 3♦ 4♣ 5♠ 6♥ 7♦ 8♣ 9♠ 10♥ J♦ Q♣ K♠ joker joker
const CH_SUITS  = ['♠','♥','♦','♣','♠','♥','♦','♣','♠','♥','♦','♣','♠','',''];
const CH_RED_IDS = new Set([2, 3, 6, 7, 10, 11]); // hearts & diamonds chapters

function showLevelSelect() {
  stopTimer();
  document.getElementById('screen-game').classList.add('hidden');
  document.getElementById('screen-select').classList.remove('hidden');
  hideOverlay();
  closeStarsModal();

  renderPlayerProfile();
  renderChapterGrid();
  showChapterGridView();
  updateStarsBadge();

  if (window.Telegram?.WebApp?.BackButton) window.Telegram.WebApp.BackButton.hide();
}

function showChapterGridView() {
  document.getElementById('chapter-grid-view').classList.remove('hidden');
  document.getElementById('level-grid-view').classList.add('hidden');
}

function openChapter(chId) {
  activeChapter = chId;
  const ch = CHAPTERS.find(c => c.id === chId);
  document.getElementById('chapter-grid-view').classList.add('hidden');
  document.getElementById('level-grid-view').classList.remove('hidden');
  if (ch) {
    document.getElementById('lgv-chapter-title').textContent = `${ch.symbol}  ${ch.name}`;
  }
  renderLevelGrid();
}

function renderPlayerProfile() {
  const user = getTgUser();
  const el = document.getElementById('player-profile');
  if (!user || !el) return;
  el.classList.remove('hidden');
  const avatarEl = document.getElementById('player-avatar');
  const nameEl   = document.getElementById('player-name');
  if (user.photo_url) {
    avatarEl.innerHTML = `<img src="${user.photo_url}" onerror="this.style.display='none'">`;
  } else {
    avatarEl.textContent = (user.first_name || '?')[0].toUpperCase();
  }
  nameEl.textContent = user.first_name || user.username || 'Player';
}

function updateStarsBadge() {
  const allStars = loadProgress().stars || {};
  const total = Object.values(allStars).reduce((s, v) => s + v, 0);
  const badge = document.getElementById('select-stars-badge');
  const owned = document.getElementById('stars-owned');
  if (!badge || !owned) return;
  if (total > 0) {
    owned.textContent = total;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderChapterGrid() {
  const grid = document.getElementById('chapter-card-grid');
  if (!grid) return;
  const unlocked  = getUnlocked();
  const allStars  = loadProgress().stars || {};

  grid.innerHTML = '';
  CHAPTERS.forEach((ch, idx) => {
    const isAvail  = ch.from <= unlocked;
    const mastered = isAvail && isChapterMastered(ch.id);
    const isRed    = CH_RED_IDS.has(ch.id);
    const suit     = CH_SUITS[ch.id - 1] || '';

    // Stars for this chapter
    let earned = 0;
    for (let id = ch.from; id <= ch.to; id++) earned += allStars[id] || 0;

    const card = document.createElement('div');
    card.className = `ch-card ${isAvail ? (isRed ? 'unlocked red' : 'unlocked black') : 'locked'}${mastered ? ' mastered' : ''}`;
    card.style.setProperty('--i', idx);

    if (isAvail) {
      const centerSymbol = suit || ch.symbol;
      card.innerHTML = `
        <div class="chc-corner tl">
          <div class="chc-rank">${ch.symbol}</div>
          <div class="chc-suit-sm">${suit}</div>
        </div>
        <div class="chc-body">
          <div class="chc-suit-big">${centerSymbol}</div>
          <div class="chc-chapter-name">${ch.name}</div>
        </div>
        <div class="chc-progress">
          <div class="chc-stars-count">${earned}/30★</div>
        </div>
        <div class="chc-corner br">
          <div class="chc-rank">${ch.symbol}</div>
          <div class="chc-suit-sm">${suit}</div>
        </div>
      `;
      card.addEventListener('click', () => openChapter(ch.id));
    } else {
      card.innerHTML = `
        <div class="chc-lock-face">
          <div class="chc-lock-symbol">${ch.symbol}</div>
          <div class="chc-lock-icon">🔒</div>
        </div>
      `;
    }
    grid.appendChild(card);
  });
}

function renderLevelGrid() {
  const grid = document.getElementById('level-grid');
  if (!grid) return;
  const unlocked  = getUnlocked();
  const ch        = CHAPTERS.find(c => c.id === activeChapter);
  if (!ch) return;
  const mastered  = isChapterMastered(ch.id);
  grid.innerHTML  = '';

  // Power status hint inside level grid
  const header = document.createElement('div');
  header.className = 'chapter-grid-header';
  header.innerHTML = mastered
    ? `<span class="cgh-badge">✦ Power Unlocked</span>`
    : `<span class="cgh-hint">3★ all 10 to unlock Power Card</span>`;
  grid.appendChild(header);

  for (let id = ch.from; id <= ch.to; id++) {
    const stars      = getStars(id);
    const isUnlocked = id <= unlocked;
    const isCurrent  = id === unlocked;
    const el = document.createElement('div');
    el.className = 'level-card ' + (isUnlocked ? 'unlocked' : 'locked') + (isCurrent ? ' current' : '');
    el.dataset.level = id;
    if (isUnlocked) {
      const localNum = id - ch.from + 1;
      el.innerHTML = `
        <div class="lc-num">${localNum}</div>
        <div class="lc-stars">${starStr(stars)}</div>
        <div class="lc-champion" style="display:none"></div>
      `;
      el.addEventListener('click', () => startLevel(id));
    } else {
      el.innerHTML = `
        <div class="lc-lock">🔒</div>
        <div class="lc-num" style="opacity:.4;font-size:12px">${id}</div>
      `;
    }
    grid.appendChild(el);
  }

  // Scroll active chapter's first unlocked level into view
  const firstCurrent = grid.querySelector('.current');
  if (firstCurrent) setTimeout(() => firstCurrent.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 100);

  // Load champion avatars async
  if (API_READY) {
    fetchChampions(ch.from, ch.to).then(champions => {
      Object.entries(champions).forEach(([lvlId, champ]) => {
        const cell = grid.querySelector(`[data-level="${lvlId}"]`);
        if (!cell) return;
        const avatarEl = cell.querySelector('.lc-champion');
        if (!avatarEl) return;
        if (champ.avatar_url) {
          avatarEl.innerHTML = `<img src="${champ.avatar_url}" loading="lazy" onerror="this.parentNode.style.display='none'">`;
        } else {
          avatarEl.textContent = (champ.first_name || '?')[0].toUpperCase();
        }
        avatarEl.title = `${champ.first_name}: ${Number(champ.score).toLocaleString()}`;
        avatarEl.style.display = '';
      });
    });
  }
}

function starStr(n) {
  return '⭐'.repeat(n) + (n < 3 ? '<span style="opacity:.2">⭐</span>'.repeat(3 - n) : '');
}

// ─── Start Level ──────────────────────────────────────────────────────────────
function startLevel(id) {
  currentLevel      = LEVELS[id - 1];
  score         = 0;
  selectedCells = [];
  isDragging        = false;
  discardPile       = [];
  prevState         = null;
  window._targetToastShown = false;

  toolsLeft = { ...getToolInventory() };

  deck  = buildDeck(currentLevel.jokers);
  board = [];
  for (let r = 0; r < ROWS; r++) {
    board[r] = [];
    for (let c = 0; c < COLS; c++) board[r][c] = { ...deck.pop() };
  }
  // All face-up first, then lock outer cells
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      board[r][c].faceUp = true;

  const outerCells = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (r !== 2 && r !== 3 && !board[r][c]?.isJoker)
        outerCells.push([r, c]);
  shuffle(outerCells).slice(0, currentLevel.lockedCount)
    .forEach(([r, c]) => { board[r][c].faceUp = false; });

  // Screen switch
  document.getElementById('screen-select').classList.add('hidden');
  document.getElementById('screen-game').classList.remove('hidden');
  hideOverlay();
  closeStarsModal();

  // Header
  document.getElementById('level-label').textContent  = `Level ${currentLevel.id} · ${currentLevel.chapterName}`;
  document.getElementById('level-name').textContent   = `Target ${currentLevel.target.toLocaleString()}`;
  document.getElementById('target-value').textContent = currentLevel.target.toLocaleString();

  // Telegram BackButton
  if (window.Telegram?.WebApp?.BackButton) window.Telegram.WebApp.BackButton.show();

  updateHUD();
  updateToolsUI();
  renderBoard(new Set());
  clearConnectionLine();
  startTimer();
  setTimeout(checkStuck, 400);

  // First-time tutorial popup on level 1
  if (id === 1 && !loadProgress().tutorialSeen) showTutorialPopup();
}

function goBack() {
  if (isDragging) { isDragging = false; clearSelection(); }
  stopTimer();
  showLevelSelect();
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTimer() {
  stopTimer();
  timeLeft = LEVEL_TIME_START;
  renderTimer();
  timerId = setInterval(timerTick, 1000);
}

function stopTimer() {
  if (timerId) { clearInterval(timerId); timerId = null; }
}

function timerTick() {
  timeLeft--;
  renderTimer();
  if (timeLeft <= 0) {
    stopTimer();
    setTimeout(settleGame, 200);
  }
}

function renderTimer() {
  const m  = Math.floor(timeLeft / 60);
  const s  = timeLeft % 60;
  const el = document.getElementById('timer-value');
  if (el) {
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    el.classList.toggle('warning', timeLeft <= 30 && timeLeft > 0);
  }
  // Last 30s urgency on board container
  const boardEl = document.getElementById('board-container');
  if (boardEl) boardEl.classList.toggle('urgency', timeLeft <= 30 && timeLeft > 0 && !!timerId);
  updateTimerRing();
}

function updateTimerRing() {
  const arc = document.getElementById('timer-arc');
  if (!arc) return;
  const ratio = Math.min(1, Math.max(0, timeLeft / MAX_TIME));
  const offset = TIMER_CIRCUMFERENCE * (1 - ratio);
  arc.style.strokeDasharray  = TIMER_CIRCUMFERENCE;
  arc.style.strokeDashoffset = offset;
  // Color shift: normal → amber → danger
  if (timeLeft > 60)       arc.style.stroke = 'var(--red)';
  else if (timeLeft > 30)  arc.style.stroke = '#d97706';
  else                     arc.style.stroke = '#dc2626';
}

function settleGame() {
  stopTimer();
  document.getElementById('board-container')?.classList.remove('urgency');
  const earned = STAR_THRESHOLDS.filter(t => score >= currentLevel.target * t).length;
  if (earned > 0) {
    recordWin(currentLevel.id, earned);
    showWin(score, earned);
    // Submit score async; show rank when response arrives
    submitScore(currentLevel.id, score, earned).then(result => {
      if (result?.ok) showWinRank(result.rank, result.total);
    });
  } else {
    showLose(score, currentLevel.target);
  }
}

function showWinRank(rank, total) {
  const el = document.getElementById('win-rank');
  if (!el) return;
  const medal = rank === 1 ? '🥇 ' : rank === 2 ? '🥈 ' : rank === 3 ? '🥉 ' : '';
  el.textContent = `${medal}Global #${rank.toLocaleString()} of ${total.toLocaleString()} players`;
  el.classList.remove('hidden');
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function updateHUD() {
  document.getElementById('score-value').textContent = score.toLocaleString();
  const pct = Math.min(score / currentLevel.target * 100, 100);
  document.getElementById('progress-fill').style.width = pct + '%';
}

function updateToolsUI() {
  const su = toolsLeft.shuffle, uu = toolsLeft.undo;
  const bs = document.getElementById('btn-shuffle');
  const bu = document.getElementById('btn-undo');
  bs.disabled = false;
  bu.disabled = !prevState;
  const tc = toolsLeft.timecard || 0;
  document.getElementById('shuffle-count').textContent  = su > 0 ? `×${su}` : 'Ad';
  document.getElementById('undo-count').textContent     = uu > 0 ? `×${uu}` : (prevState ? 'Ad' : '');
  document.getElementById('timecard-count').textContent = tc > 0 ? `×${tc}` : 'Ad';
  document.getElementById('btn-timecard').disabled = !timerId;
}


// "+Xs" floating near the timer
function showTimerBonus(seconds) {
  const wrap = document.getElementById('timer-wrap');
  if (!wrap) return;
  const tag = document.createElement('div');
  tag.className = 'timer-bonus';
  tag.textContent = `+${seconds}s`;
  wrap.appendChild(tag);
  setTimeout(() => tag.remove(), 900);
}

function getConnectionLabel(cells) {
  const len        = cells.length;
  const cards      = cells.map(({ row, col }) => board[row][col]);
  const nonJokers  = cards.filter(c => !c.isJoker);
  const hasJoker   = nonJokers.length < cards.length;
  const suits      = new Set(nonJokers.map(c => c.suit));
  const straight   = nonJokers.length >= 3 && checkStraight(nonJokers.map(c => c.rank));

  // Base type label
  let type = '';
  if (hasJoker)                                       type = 'WILD';
  else if (suits.size === 1 && straight)              type = 'ROYAL FLUSH';
  else if (new Set(nonJokers.map(c => c.rank)).size === 1) type = 'SET';
  else if (straight)                                  type = 'STRAIGHT';
  else if (suits.size === 1)                          type = 'FLUSH';

  // Long-chain override — replaces base label for 6+
  if (len >= 8) return 'LEGENDARY!!';
  if (len >= 7) return type ? `EPIC · ${type}` : 'EPIC';
  if (len >= 6) return type ? `MONSTER · ${type}` : 'MONSTER';
  if (len >= 5) return type ? `BIG HAND · ${type}` : 'BIG HAND';

  return type;
}

function showScorePopup(cells, gained, mult = 1.0, powerBonus = 0) {
  const container = document.getElementById('board-container');
  const cr = container.getBoundingClientRect();
  let sx = 0, sy = 0;
  cells.forEach(({ row, col }) => {
    const el = getCardEl(row, col);
    if (!el) return;
    const r = el.getBoundingClientRect();
    sx += r.left + r.width / 2; sy += r.top + r.height / 2;
  });
  const x = sx / cells.length - cr.left;
  const y = sy / cells.length - cr.top;

  const label = getConnectionLabel(cells);
  const multStr = mult > 1.0 ? `×${mult.toFixed(1)}` : '';

  const pop = document.createElement('div');
  pop.className = 'score-popup';
  pop.style.left = x + 'px';
  pop.style.top  = y + 'px';

  let inner = `<span class="sp-points">+${gained}</span>`;
  if (powerBonus > 0) inner += `<span class="sp-power">+${powerBonus} POWER</span>`;
  if (multStr) inner += `<span class="sp-mult">${multStr}</span>`;
  if (label)   inner += `<span class="pop-type">${label}</span>`;
  pop.innerHTML = inner;

  container.appendChild(pop);
  setTimeout(() => pop.remove(), 1650);
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderBoard(flipSet = new Set()) {
  const boardEl  = document.getElementById('board');
  const mastered = getMasteredRanks();
  boardEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const card = board[r][c];
      const el   = document.createElement('div');
      el.className = 'card';
      el.dataset.row = r; el.dataset.col = c;
      const key = `${r},${c}`;

      if (!card) {
        el.classList.add('empty');
      } else if (card.isJoker && card.faceUp) {
        el.classList.add('face-up', 'joker', card.isBig ? 'joker-big' : 'joker-small');
        el.innerHTML = jokerHTML(card.isBig);
        if (flipSet.has(key)) el.classList.add('flip-in');
      } else if (!card.faceUp) {
        el.classList.add('face-down');
        const suitHint = card.suit >= 0
          ? `<span class="back-suit ${RED_SUITS.has(card.suit) ? 'red' : ''}">${SUIT_SYMBOL[card.suit]}</span>`
          : '';
        el.innerHTML = `<div class="card-back">${suitHint}</div>`;
        if (flipSet.has(key)) el.classList.add('flip-in');
      } else {
        const isRed = RED_SUITS.has(card.suit);
        el.classList.add('face-up', isRed ? 'red' : 'black');
        if (mastered.has(cardRankKey(card))) el.classList.add('power-card');
        const rl = RANK_LABEL[card.rank], ss = SUIT_SYMBOL[card.suit];
        el.innerHTML = `
          <div class="card-tl">${rl}</div>
          <div class="card-center">${ss}</div>
          <div class="card-br">${rl}</div>
        `;
        if (flipSet.has(key)) el.classList.add('flip-in');
      }
      boardEl.appendChild(el);
    }
  }
}

function getCardEl(r, c) {
  return document.querySelector(`.card[data-row="${r}"][data-col="${c}"]`);
}

// ─── Connection Line ──────────────────────────────────────────────────────────
function updateConnectionLine() {
  const line  = document.getElementById('connection-line');
  const svgEl = document.getElementById('connection-svg');
  if (selectedCells.length < 2) { line.setAttribute('points', ''); return; }
  const sr = svgEl.getBoundingClientRect();
  const pts = selectedCells.map(({ row, col }) => {
    const el = getCardEl(row, col);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return `${r.left - sr.left + r.width/2},${r.top - sr.top + r.height/2}`;
  }).filter(Boolean).join(' ');
  line.setAttribute('points', pts);
}

function clearConnectionLine() {
  document.getElementById('connection-line').setAttribute('points', '');
}

// ─── Hint Highlighting ────────────────────────────────────────────────────────
function updateHints() {
  document.querySelectorAll('.hint-next').forEach(el => el.classList.remove('hint-next'));
  if (!isDragging || selectedCells.length === 0) return;
  const last = selectedCells[selectedCells.length - 1];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = last.row + dr, nc = last.col + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      if (!board[nr]?.[nc]?.faceUp) continue;
      if (selectedCells.some(p => p.row === nr && p.col === nc)) continue;
      const testCells = [...selectedCells, { row: nr, col: nc }];
      if ((testCells.length >= 3 && validateConnection(testCells)) ||
          (testCells.length < 3  && couldBeValid(testCells))) {
        getCardEl(nr, nc)?.classList.add('hint-next');
      }
    }
  }
}

function couldBeValid(cells) {
  const cards = cells.map(({ row, col }) => board[row][col]);
  if (cards.some(c => c.isJoker)) return true;
  const suits = new Set(cards.map(c => c.suit));
  if (suits.size === 1) return true;
  if (new Set(cards.map(c => c.rank)).size === 1) return true;
  return couldBeConsecutive(cards.map(c => c.rank));
}

// ─── Validation & Scoring ─────────────────────────────────────────────────────
function isAdjacent(r1, c1, r2, c2) {
  return Math.abs(r1-r2) <= 1 && Math.abs(c1-c2) <= 1 && !(r1===r2 && c1===c2);
}

// Strict consecutive check (no duplicates, exact sequence)
function checkStraight(ranks) {
  if (new Set(ranks).size !== ranks.length) return false; // no duplicate ranks
  const sorted = [...ranks].sort((a, b) => a - b);
  // Low-A: check as-is
  let ok = true;
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i] !== sorted[i-1] + 1) { ok = false; break; }
  if (ok) return true;
  // High-A: treat A(1) as 14 and recheck
  if (sorted[0] === 1) {
    const high = [...sorted.slice(1), 14].sort((a, b) => a - b);
    for (let i = 1; i < high.length; i++)
      if (high[i] !== high[i-1] + 1) return false;
    return true;
  }
  return false;
}

function validateConnection(cells) {
  if (cells.length < 3) return false;
  const cards = cells.map(({ row, col }) => board[row][col]);
  if (cards.some(c => !c)) return false; // null guard

  const nonJokers = cards.filter(c => !c.isJoker);
  const jokerCount = cards.length - nonJokers.length;

  // Pure jokers or single non-joker: valid (wild card play)
  if (nonJokers.length <= 1) return true;

  const suits  = new Set(nonJokers.map(c => c.suit));
  const ranks  = nonJokers.map(c => c.rank);
  const rankSet = new Set(ranks);

  // Same suit (joker augments flush)
  if (suits.size === 1) return true;

  // Same rank (joker augments set)
  if (rankSet.size === 1) return true;

  // Straight: non-joker ranks must fit within a window of `cells.length`
  // consecutive slots, with no duplicate ranks. Jokers fill gaps.
  if (rankSet.size === ranks.length) {
    const sorted = [...ranks].sort((a, b) => a - b);
    // Low-A window
    if (sorted[sorted.length - 1] - sorted[0] < cells.length) return true;
    // High-A window: treat A(1) as 14
    if (sorted[0] === 1) {
      const high = [...sorted.slice(1), 14].sort((a, b) => a - b);
      if (high[high.length - 1] - high[0] < cells.length) return true;
    }
  }

  return false;
}

function calculateScore(cells) {
  const cards     = cells.map(({ row, col }) => board[row][col]);
  const nonJokers = cards.filter(c => !c.isJoker);
  const hasJoker  = nonJokers.length < cards.length;

  // Power card bonus: each mastered-rank card in chain adds +1 to effective length
  const mastered   = getMasteredRanks();
  const powerBonus = cards.reduce((acc, card) => {
    if (!card) return acc;
    return acc + (mastered.has(cardRankKey(card)) ? 1 : 0);
  }, 0);

  const len    = cells.length;              // actual chain length (for time bonus etc.)
  const effLen = len + powerBonus;          // effective length (for scoring)

  const base = effLen <= 3 ? 100
             : effLen === 4 ? 250
             : effLen === 5 ? 500
             : effLen === 6 ? 800
             : 800 + (effLen - 6) * 200;

  const suits    = new Set(nonJokers.map(c => c.suit));
  const rankSet  = new Set(nonJokers.map(c => c.rank));
  const straight = nonJokers.length >= 2 && checkStraight(nonJokers.map(c => c.rank));

  let mult = 1.0;
  if (!hasJoker && suits.size === 1 && straight) mult = 2.0; // Royal Flush
  else if (!hasJoker && rankSet.size === 1)       mult = 1.4; // Set
  else if (!hasJoker && straight)                 mult = 1.3; // Straight
  else if (!hasJoker && suits.size === 1)         mult = 1.2; // Flush
  else if (hasJoker)                              mult = 1.1; // Wild

  return { points: Math.round(base * mult), mult, powerBonus, effLen };
}

// ─── Eliminate ────────────────────────────────────────────────────────────────
function eliminateCells(cells) {
  prevState = { board: cloneBoard(board), score };
  const { points: gained, mult, powerBonus } = calculateScore(cells);
  score += gained;

  // Time bonus: chain length in seconds (3 cards = +3s, 8 cards = +8s), cap at MAX_TIME
  const timeBonus  = cells.length;
  const prevTime   = timeLeft;
  timeLeft = Math.min(timeLeft + timeBonus, MAX_TIME);
  const actualAdded = timeLeft - prevTime;
  if (actualAdded > 0) showTimerBonus(actualAdded);
  renderTimer();

  playSound('eliminate', cells.length);
  cells.forEach(({ row, col }) => getCardEl(row, col)?.classList.add('flash-valid'));

  setTimeout(() => {
    const toFlip = new Set();
    const ORTHO = [[-1,0],[1,0],[0,-1],[0,1]]; // up/down/left/right only
    cells.forEach(({ row, col }) => {
      ORTHO.forEach(([dr, dc]) => {
        const nr = row+dr, nc = col+dc;
        if (nr>=0 && nr<ROWS && nc>=0 && nc<COLS && board[nr][nc] && !board[nr][nc].faceUp)
          toFlip.add(`${nr},${nc}`);
      });
    });

    const flipSet = new Set();
    cells.forEach(({ row, col }) => {
      discardPile.push(board[row][col]);
      board[row][col] = drawCard();
      flipSet.add(`${row},${col}`);
    });
    toFlip.forEach(key => {
      const [r, c] = key.split(',').map(Number);
      if (board[r][c] && !board[r][c].faceUp) { board[r][c].faceUp = true; flipSet.add(key); }
    });

    updateHUD();
    updateToolsUI();
    showScorePopup(cells, gained, mult, powerBonus);
    renderBoard(flipSet);
    clearSelection();

    if (score >= currentLevel.target && !window._targetToastShown) {
      window._targetToastShown = true;
      showToast('Target reached! Keep going for more stars');
      playSound('target');
    }
    setTimeout(checkStuck, 350);
  }, 240);
}

// ─── Selection ────────────────────────────────────────────────────────────────
function clearSelection() {
  selectedCells = [];
  clearConnectionLine();
  updateHints();
  document.querySelectorAll('.card.selected').forEach(el => el.classList.remove('selected'));
}

function startSelect(cell) {
  if (!cell) return;
  const card = board[cell.row][cell.col];
  if (!card || !card.faceUp) return;
  isDragging = true;
  selectedCells = [cell];
  getCardEl(cell.row, cell.col)?.classList.add('selected');
  playSound('select');
  updateConnectionLine();
  updateHints();
}

function extendSelect(cell, px, py) {
  if (!isDragging || !cell) return;
  const card = board[cell.row][cell.col];
  if (!card || !card.faceUp) return;

  // Diagonal misfire guard: must be within 46% of card center
  if (px !== undefined && py !== undefined) {
    const el = getCardEl(cell.row, cell.col);
    if (el) {
      const r = el.getBoundingClientRect();
      if (Math.hypot(px - (r.left + r.width/2), py - (r.top + r.height/2)) > Math.min(r.width, r.height) * 0.46) return;
    }
  }

  // Back-drag: un-select second-to-last card
  if (selectedCells.length >= 2) {
    const prev = selectedCells[selectedCells.length - 2];
    if (prev.row === cell.row && prev.col === cell.col) {
      const rm = selectedCells.pop();
      getCardEl(rm.row, rm.col)?.classList.remove('selected');
      updateConnectionLine();
      updateHints();
      return;
    }
  }

  if (selectedCells.some(c => c.row===cell.row && c.col===cell.col)) return;
  const last = selectedCells[selectedCells.length - 1];
  if (!isAdjacent(last.row, last.col, cell.row, cell.col)) return;

  selectedCells.push(cell);
  getCardEl(cell.row, cell.col)?.classList.add('selected');
  updateConnectionLine();
  updateHints();
}

function endSelect() {
  if (!isDragging) return;
  isDragging = false;
  if (selectedCells.length >= 3 && validateConnection(selectedCells)) {
    eliminateCells([...selectedCells]);
  } else {
    if (selectedCells.length >= 3) {
      playSound('invalid');
      selectedCells.forEach(({ row, col }) => {
        const el = getCardEl(row, col);
        if (el) { el.classList.add('flash-invalid'); setTimeout(() => el.classList.remove('flash-invalid'), 400); }
      });
    }
    clearSelection();
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────
function cellFromEl(el) {
  const c = el?.closest?.('.card');
  if (!c) return null;
  const row = +c.dataset.row, col = +c.dataset.col;
  return isNaN(row)||isNaN(col) ? null : { row, col };
}
function cellFromPoint(x, y) { return cellFromEl(document.elementFromPoint(x, y)); }

document.addEventListener('mousedown',  e => startSelect(cellFromEl(e.target)));
document.addEventListener('mousemove',  e => { if (isDragging) extendSelect(cellFromEl(e.target), e.clientX, e.clientY); });
document.addEventListener('mouseup',    () => endSelect());
document.addEventListener('touchstart', e => {
  const boardContainer = document.getElementById('board-container');
  if (!boardContainer || !boardContainer.contains(e.target)) return;
  e.preventDefault();
  const t = e.touches[0];
  startSelect(cellFromPoint(t.clientX, t.clientY));
}, { passive: false });
document.addEventListener('touchmove', e => {
  const boardContainer = document.getElementById('board-container');
  if (!boardContainer || !boardContainer.contains(e.target)) return;
  e.preventDefault();
  const t = e.touches[0];
  extendSelect(cellFromPoint(t.clientX, t.clientY), t.clientX, t.clientY);
}, { passive: false });
document.addEventListener('touchend', () => endSelect());

// ─── Overlay ──────────────────────────────────────────────────────────────────
function hideOverlay() { document.getElementById('overlay').classList.add('hidden'); }

function showToast(msg) {
  const existing = document.getElementById('game-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'game-toast'; t.textContent = msg;
  document.getElementById('screen-game').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2800);
}

function showWin(finalScore, earned) {
  playSound('win');
  // Reset rank badge (filled async when API responds)
  const rankEl = document.getElementById('win-rank');
  if (rankEl) rankEl.classList.add('hidden');
  document.getElementById('overlay-emoji').textContent = earned === 3 ? '🎉' : '✨';
  document.getElementById('overlay-title').textContent = 'Level Clear!';
  document.getElementById('overlay-sub').textContent   = `Score: ${finalScore.toLocaleString()}`;
  const starsRow = document.getElementById('stars-row');
  starsRow.innerHTML = '';
  for (let i = 1; i <= 3; i++) {
    const s = document.createElement('div');
    s.className = 'star' + (i > earned ? ' empty-star' : '');
    s.textContent = '⭐';
    starsRow.appendChild(s);
  }
  const hasNext = currentLevel.id < LEVELS.length;
  document.getElementById('overlay-btns').innerHTML = `
    <button class="ov-btn primary" onclick="${hasNext ? `startLevel(${currentLevel.id + 1})` : 'showLevelSelect()'}">
      ${hasNext ? 'Next Level' : 'Back'}
    </button>
    <button class="ov-btn secondary" onclick="startLevel(${currentLevel.id})">Retry</button>
    <button class="ov-btn secondary" onclick="openLevelLeaderboard(${currentLevel.id})"${!API_READY ? ' style="opacity:.4;pointer-events:none"' : ''}>🏆 Rankings</button>
    <button class="ov-btn secondary" onclick="showLevelSelect()">Back</button>
  `;
  document.getElementById('overlay').classList.remove('hidden');
  starsRow.querySelectorAll('.star:not(.empty-star)').forEach((s, i) => {
    setTimeout(() => s.classList.add('lit'), 300 + i * 250);
  });
  starsRow.querySelectorAll('.empty-star').forEach(s => setTimeout(() => s.classList.add('lit'), 300));
}

function showLose(finalScore, target) {
  playSound('lose');
  document.getElementById('overlay-emoji').textContent = '⏱';
  document.getElementById('overlay-title').textContent = "Time's Up";
  document.getElementById('overlay-sub').textContent   = `${finalScore.toLocaleString()} / ${target.toLocaleString()}`;
  document.getElementById('stars-row').innerHTML = '';
  document.getElementById('overlay-btns').innerHTML = `
    <button class="ov-btn primary"   onclick="startLevel(${currentLevel.id})">Try Again</button>
    <button class="ov-btn secondary" onclick="showLevelSelect()">Levels</button>
  `;
  document.getElementById('overlay').classList.remove('hidden');
}

// ─── Dead-end Detection ───────────────────────────────────────────────────────
function hasValidMove() {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c]?.faceUp && dfsCheck([{ row: r, col: c }])) return true;
  return false;
}

function dfsCheck(path) {
  if (path.length >= 3 && validateConnection(path)) return true;
  if (path.length >= 6) return false;
  const last = path[path.length - 1];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = last.row+dr, nc = last.col+dc;
      if (nr<0||nr>=ROWS||nc<0||nc>=COLS) continue;
      if (!board[nr][nc]?.faceUp) continue;
      if (path.some(p => p.row===nr && p.col===nc)) continue;
      if (dfsCheck([...path, { row: nr, col: nc }])) return true;
    }
  return false;
}

function checkStuck() {
  if (!timerId) return;
  if (hasValidMove()) return;
  if (toolsLeft.shuffle > 0) {
    toolsLeft.shuffle--;
    showToast('No moves — auto shuffling');
    setTimeout(() => executeShuffle(), 700);
  } else {
    showToast('No moves — free shuffle');
    setTimeout(() => executeShuffle(true), 700);
  }
}

// ─── Tools ────────────────────────────────────────────────────────────────────
function cloneBoard(b) { return b.map(row => row.map(card => card ? { ...card } : null)); }

function useTool(type) {
  if (type === 'shuffle') {
    if (toolsLeft.shuffle > 0) {
      toolsLeft.shuffle--;
      saveToolInventory(toolsLeft);
      executeShuffle();
    } else {
      showAdModal('shuffle'); // TODO: integrate real ad SDK
    }
  } else if (type === 'undo') {
    if (!prevState) return;
    if (toolsLeft.undo > 0) {
      toolsLeft.undo--;
      saveToolInventory(toolsLeft);
      applyUndo();
    } else {
      showAdModal('undo'); // TODO: integrate real ad SDK
    }
  } else if (type === 'timecard') {
    if (!timerId) return; // game not running
    if (toolsLeft.timecard > 0) {
      toolsLeft.timecard--;
      saveToolInventory(toolsLeft);
      timeLeft += 60; // no cap — can exceed MAX_TIME
      renderTimer();
      showTimerBonus(60);
      updateToolsUI();
      playSound('undo'); // satisfying click sound
    } else {
      showAdModal('timecard'); // TODO: integrate real ad SDK
    }
  }
}

function applyUndo() {
  board     = prevState.board;
  score     = prevState.score;
  prevState = null;
  playSound('undo');
  updateHUD();
  updateToolsUI();
  renderBoard(new Set());
  clearConnectionLine();
  showToast('Undone');
  setTimeout(checkStuck, 300);
}

function executeShuffle(free = false) {
  if (!free) updateToolsUI();
  const faceUpPos = [], faceUpCards = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c]?.faceUp) { faceUpPos.push([r,c]); faceUpCards.push(board[r][c]); }
  const shuffled = shuffle(faceUpCards);
  faceUpPos.forEach(([r,c], i) => { board[r][c] = shuffled[i]; });
  playSound('shuffle');
  renderBoard(new Set(faceUpPos.map(([r,c]) => `${r},${c}`)));
  showToast('Shuffled');
  setTimeout(checkStuck, 400);
}

// ─── Ad Modal (TODO: replace stub with real ad SDK) ──────────────────────────
function showAdModal(toolType) {
  stopTimer();
  pendingStarsTool = toolType;
  const info = TOOL_INFO[toolType];
  // Reuse stars modal UI but change button label
  document.getElementById('sm-icon').textContent         = info.icon;
  document.getElementById('sm-title').textContent        = `Get a ${info.name}`;
  document.getElementById('sm-desc').textContent         = info.desc + '\nWatch a short ad to earn one.';
  document.getElementById('sm-stars-amount').textContent = '▶';
  document.getElementById('sm-label').textContent        = 'Watch Ad';
  const payBtn = document.getElementById('sm-pay-btn');
  payBtn.textContent = 'Watch Ad ▶';
  payBtn.onclick = () => {
    // TODO: Call real ad SDK here (e.g. AdMob, Telegram Ad)
    // For now: simulate instant reward
    closeStarsModal();
    grantTool(toolType);
    showToast('Ad watched — tool granted!');
    // Restore button for stars flow
    payBtn.textContent = 'Pay with Stars ⭐';
    payBtn.onclick = payWithStars;
    document.getElementById('sm-label').textContent = 'Telegram Stars';
  };
  document.getElementById('stars-modal').classList.remove('hidden');
}

// ─── Stars Payment Modal ──────────────────────────────────────────────────────
function showStarsModal(toolType) {
  stopTimer();
  pendingStarsTool = toolType;
  const info  = TOOL_INFO[toolType];
  const stars = TOOL_STARS[toolType];
  document.getElementById('sm-icon').textContent         = info.icon;
  document.getElementById('sm-title').textContent        = `Get a ${info.name}`;
  document.getElementById('sm-desc').textContent         = info.desc;
  document.getElementById('sm-stars-amount').textContent = stars;
  document.getElementById('stars-modal').classList.remove('hidden');
}

function closeStarsModal() {
  const modal = document.getElementById('stars-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  pendingStarsTool = null;
  // Resume timer if game is still active
  if (!timerId && timeLeft > 0 && currentLevel) {
    timerId = setInterval(timerTick, 1000);
  }
}

function payWithStars() {
  if (!pendingStarsTool) { closeStarsModal(); return; }
  const toolType = pendingStarsTool;
  const stars    = TOOL_STARS[toolType];
  const info     = TOOL_INFO[toolType];

  // Telegram Stars invoice
  if (window.Telegram?.WebApp?.openInvoice) {
    // TODO: Replace with your actual invoice link from your bot backend
    // The bot must create an invoice via Telegram Bot API and return a link.
    // Example: window.Telegram.WebApp.openInvoice('https://t.me/invoice/...', callback)
    const invoiceUrl = null; // Replace with real invoice URL from your bot

    if (invoiceUrl) {
      window.Telegram.WebApp.openInvoice(invoiceUrl, status => {
        if (status === 'paid') {
          grantTool(toolType);
        } else if (status === 'cancelled' || status === 'failed') {
          closeStarsModal();
          showToast('Payment cancelled');
        }
      });
      return;
    }
  }

  // Fallback: simulate payment in dev/browser context
  closeStarsModal();
  showToast(`[Dev] ${info.icon} ${info.name} granted (${stars}⭐ — payment stub)`);
  grantTool(toolType);
}

function grantTool(toolType) {
  toolsLeft[toolType] = (toolsLeft[toolType] || 0) + 1;
  saveToolInventory(toolsLeft);
  closeStarsModal();
  updateToolsUI();
  const info = TOOL_INFO[toolType];
  showToast(`${info.icon} ${info.name} added!`);
}

// ─── Audio ────────────────────────────────────────────────────────────────────
let _audioCtx = null;
function getACtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}
function beep(freq, dur, type='sine', vol=0.25, delay=0) {
  if (isMuted) return;
  try {
    const ctx = getACtx();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    gain.gain.setValueAtTime(vol, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + dur + 0.01);
  } catch (_) {}
}
function playSound(type, len = 3) {
  if (isMuted) return;
  switch (type) {
    case 'select':    beep(900, 0.04, 'sine', 0.1); break;
    case 'eliminate': { const n=[523,659,784,1047,1319]; for(let i=0;i<Math.min(len,5);i++) beep(n[i],0.18,'sine',0.22,i*0.055); break; }
    case 'invalid':   beep(180, 0.18, 'sawtooth', 0.18); break;
    case 'target':    [784,988,1319].forEach((f,i)=>beep(f,0.2,'sine',0.25,i*0.1)); break;
    case 'shuffle':   [400,500,600,500,400].forEach((f,i)=>beep(f,0.08,'sine',0.15,i*0.06)); break;
    case 'undo':      [600,400].forEach((f,i)=>beep(f,0.1,'sine',0.2,i*0.08)); break;
    case 'win':       [523,659,784,1047,1319,1568].forEach((f,i)=>beep(f,0.22,'sine',0.28,i*0.1)); break;
    case 'lose':      [400,330,262].forEach((f,i)=>beep(f,0.3,'sine',0.25,i*0.15)); break;
  }
}
function toggleMute() {
  isMuted = !isMuted;
  document.getElementById('icon-sound').classList.toggle('hidden', isMuted);
  document.getElementById('icon-mute').classList.toggle('hidden', !isMuted);
}

// ─── Joker Card HTML ──────────────────────────────────────────────────────────
function jokerHTML(isBig) {
  const hC = isBig ? '#c0392b' : '#2c2c2c';
  const bC = isBig ? '#e67e22' : '#555';
  const fC = isBig ? '#f39c12' : '#888';
  const svg = `<svg viewBox="0 0 40 44" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 22 Q4 12 12 8 Q14 16 18 20Z" fill="${hC}"/>
    <path d="M32 22 Q36 12 28 8 Q26 16 22 20Z" fill="${bC}"/>
    <path d="M14 22 Q20 6 26 22Z" fill="${isBig?'#e74c3c':'#444'}"/>
    <circle cx="10" cy="8" r="3.5" fill="${bC}"/><circle cx="10" cy="8" r="1" fill="${isBig?'#f1c40f':'#aaa'}"/>
    <circle cx="30" cy="8" r="3.5" fill="${hC}"/><circle cx="30" cy="8" r="1" fill="${isBig?'#f1c40f':'#aaa'}"/>
    <circle cx="20" cy="5" r="3.5" fill="${fC}"/><circle cx="20" cy="5" r="1" fill="${isBig?'#f1c40f':'#aaa'}"/>
    <ellipse cx="20" cy="30" rx="9" ry="10" fill="${isBig?'#fdebd0':'#e0e0e0'}"/>
    <ellipse cx="17" cy="28" rx="1.8" ry="2.2" fill="${isBig?'#c0392b':'#333'}"/>
    <ellipse cx="23" cy="28" rx="1.8" ry="2.2" fill="${isBig?'#2980b9':'#333'}"/>
    <circle cx="20" cy="31.5" r="1.8" fill="${isBig?'#e74c3c':'#888'}"/>
    <path d="M15.5 35 Q20 38.5 24.5 35" stroke="${isBig?'#c0392b':'#555'}" stroke-width="1.2" fill="none" stroke-linecap="round"/>
  </svg>`;
  const label = isBig ? 'BIG' : 'SML';
  return `
    <div class="joker-corner tl"><span class="jc-rank">★</span><span class="jc-suit">${label}</span></div>
    <div class="joker-art">${svg}</div>
    <div class="joker-corner br"><span class="jc-rank">★</span><span class="jc-suit">${label}</span></div>
  `;
}

// ─── Tutorial Popup (first-time, Level 1 only) ────────────────────────────────
function showTutorialPopup() {
  const modal = document.createElement('div');
  modal.id = 'tut-modal';
  modal.innerHTML = `
    <div id="tut-box">
      <div id="tut-title">How to Connect</div>
      <p id="tut-sub">Slide to chain 3 or more adjacent cards</p>
      <div id="tut-rows">
        <div class="tut-row" style="--d:0s">
          <div class="tut-cards">
            <div class="tut-card red">3<span>♥</span></div>
            <div class="tut-arrow"></div>
            <div class="tut-card red">8<span>♥</span></div>
            <div class="tut-arrow"></div>
            <div class="tut-card red">Q<span>♥</span></div>
          </div>
          <div class="tut-label">Same Suit</div>
        </div>
        <div class="tut-row" style="--d:0.45s">
          <div class="tut-cards">
            <div class="tut-card black">K<span>♠</span></div>
            <div class="tut-arrow"></div>
            <div class="tut-card red">K<span>♥</span></div>
            <div class="tut-arrow"></div>
            <div class="tut-card red">K<span>♦</span></div>
          </div>
          <div class="tut-label">Same Rank</div>
        </div>
        <div class="tut-row" style="--d:0.9s">
          <div class="tut-cards">
            <div class="tut-card black">5<span>♠</span></div>
            <div class="tut-arrow"></div>
            <div class="tut-card red">6<span>♥</span></div>
            <div class="tut-arrow"></div>
            <div class="tut-card red">7<span>♦</span></div>
          </div>
          <div class="tut-label">Consecutive</div>
        </div>
      </div>
      <button id="tut-btn" onclick="closeTutorialPopup()">Got it!</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeTutorialPopup() {
  const modal = document.getElementById('tut-modal');
  if (!modal) return;
  modal.classList.add('tut-exit');
  setTimeout(() => modal.remove(), 280);
  const p = loadProgress();
  p.tutorialSeen = true;
  saveProgress(p);
}

// ─── Mastery Unlock Toast ─────────────────────────────────────────────────────
function showMasteryUnlock(ch) {
  const modal = document.createElement('div');
  modal.id = 'mastery-modal';
  modal.innerHTML = `
    <div id="mastery-box">
      <div id="mastery-symbol">${ch.symbol}</div>
      <div id="mastery-title">Power Unlocked!</div>
      <div id="mastery-desc">
        Every <strong>${ch.symbol}</strong> in a chain now counts as
        <strong>+1 extra card</strong> — making your chains longer and your scores bigger.
      </div>
      <button id="mastery-btn" onclick="this.closest('#mastery-modal').remove()">Awesome!</button>
    </div>
  `;
  document.body.appendChild(modal);
}

// ─── Leaderboard Modal ────────────────────────────────────────────────────────
let _lbCurrentTab  = 'level';
let _lbCurrentLevel = null;

function avatarHTML(row) {
  if (row.avatar_url) {
    return `<img src="${row.avatar_url}" loading="lazy" onerror="this.style.display='none';this.nextSibling.style.display=''">
            <span style="display:none">${(row.first_name||'?')[0].toUpperCase()}</span>`;
  }
  return `<span>${(row.first_name||'?')[0].toUpperCase()}</span>`;
}

function rankClass(i) {
  return i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
}

function rankLabel(i) {
  return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
}

function renderLbRows(rows, myId) {
  const list = document.getElementById('lb-list');
  if (!rows.length) {
    list.innerHTML = '<div style="text-align:center;padding:32px;color:var(--ink-dim);font-size:14px">No scores yet — be the first!</div>';
    return;
  }
  list.innerHTML = rows.map((row, i) => {
    const isMe = row.user_id == myId;
    const score = row.score ?? row.total_score ?? 0;
    const meta  = row.levels_played != null ? `${row.levels_played} levels · ${row.perfect_levels} ★★★` : ``;
    return `<div class="lb-row">
      <div class="lb-rank ${rankClass(i)}">${rankLabel(i)}</div>
      <div class="lb-avatar">${avatarHTML(row)}</div>
      <div class="lb-info">
        <div class="lb-name${isMe ? ' is-me' : ''}">${row.first_name || row.username || 'Player'}${isMe ? ' (you)' : ''}</div>
        ${meta ? `<div class="lb-meta">${meta}</div>` : ''}
      </div>
      <div class="lb-score">${Number(score).toLocaleString()}</div>
    </div>`;
  }).join('');
}

function renderMyRank(rank, score, total) {
  const el = document.getElementById('lb-my-rank');
  if (!rank) { el.classList.add('hidden'); return; }
  const me = getTgUser();
  el.innerHTML = `
    <div class="lb-rank">#${rank.toLocaleString()}</div>
    <div class="lb-avatar">${me?.photo_url ? `<img src="${me.photo_url}" loading="lazy">` : `<span>${(me?.first_name||'?')[0].toUpperCase()}</span>`}</div>
    <div class="lb-info"><div class="lb-name is-me">${me?.first_name || 'You'} (you)</div></div>
    <div class="lb-score">${Number(score).toLocaleString()}</div>
  `;
  el.classList.remove('hidden');
}

async function openLevelLeaderboard(levelId) {
  _lbCurrentLevel = levelId;
  _lbCurrentTab   = 'level';
  showLeaderboardModal();
  await loadLbTab('level');
}

async function openGlobalLeaderboard() {
  _lbCurrentTab = 'global';
  showLeaderboardModal();
  await loadLbTab('global');
}

function showLeaderboardModal() {
  document.getElementById('lb-modal').classList.remove('hidden');
  document.getElementById('lb-tab-level').classList.toggle('active', _lbCurrentTab === 'level');
  document.getElementById('lb-tab-global').classList.toggle('active', _lbCurrentTab === 'global');
  document.getElementById('lb-list').innerHTML = '';
  document.getElementById('lb-loading').style.display = '';
  document.getElementById('lb-my-rank').classList.add('hidden');
}

async function loadLbTab(tab) {
  _lbCurrentTab = tab;
  document.getElementById('lb-tab-level').classList.toggle('active', tab === 'level');
  document.getElementById('lb-tab-global').classList.toggle('active', tab === 'global');
  document.getElementById('lb-list').innerHTML = '';
  document.getElementById('lb-loading').style.display = '';
  document.getElementById('lb-my-rank').classList.add('hidden');

  const me = getTgUser();
  const myId = me?.id || null;

  if (tab === 'level') {
    const levelId = _lbCurrentLevel || currentLevel?.id || 1;
    const top = await fetchLevelTop(levelId);
    document.getElementById('lb-loading').style.display = 'none';
    renderLbRows(top, myId);
    // Show my rank if I'm in the list
    const myRow = top.findIndex(r => r.user_id == myId);
    if (myRow >= 0) {
      renderMyRank(myRow + 1, top[myRow].score, top.length);
    }
  } else {
    const data = await fetchGlobal();
    document.getElementById('lb-loading').style.display = 'none';
    if (!data) return;
    renderLbRows(data.top || [], myId);
    if (data.my_rank) renderMyRank(data.my_rank, data.my_score, null);
  }
}

function switchLbTab(tab) {
  loadLbTab(tab);
}

function closeLeaderboard() {
  document.getElementById('lb-modal').classList.add('hidden');
}

// Close leaderboard on backdrop click
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('lb-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('lb-modal')) closeLeaderboard();
  });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initTelegram();
  showLevelSelect();
});
