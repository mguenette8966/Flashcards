'use strict';

// Local storage keys
const STORAGE_KEYS = {
  factStats: 'mf_fact_stats_v1',
  cycleQueue: 'mf_cycle_queue_v1',
  lastMissed: 'mf_last_missed_v1',
  best: 'mf_best_v1',
  previous: 'mf_previous_v1',
  // Profiles
  profiles: 'mf_profiles_v1',
  currentProfile: 'mf_current_profile_v1',
  recentProfiles: 'mf_recent_profiles_v1'
};

// Build all multiplication facts (0-10)
const ALL_FACTS = (() => {
  const facts = [];
  for (let a = 0; a <= 10; a += 1) {
    for (let b = 0; b <= 10; b += 1) {
      facts.push({ a, b });
    }
  }
  return facts;
})();

function factKey(a, b) {
  return `${a}x${b}`;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // ignore
  }
}

function nowMs() {
  return Date.now();
}

// Profiles persistence
let profilesByName = loadJSON(STORAGE_KEYS.profiles, {}); // { [name]: Profile }
let currentProfileName = loadJSON(STORAGE_KEYS.currentProfile, null);
let recentProfiles = loadJSON(STORAGE_KEYS.recentProfiles, []);

function createEmptyProfile(name) {
  return {
    name,
    theme: 'default',
    factStatsByKey: {},
    cycleQueue: [],
    unmasteredQueue: ALL_FACTS.map(({ a, b }) => factKey(a, b)),
    lastMissedKeys: [],
    bestRecords: { bestStreak: 0, bestPercent: 0, bestAvgTimeSec: null },
    previousGame: { percent: 0, avgTimeSec: null, maxStreak: 0 },
    achievements: { levelsEarned: [] }, // e.g., [1,2,3] for 1x,2x,3x mastery of all
    createdAtMs: nowMs(),
    lastPlayedMs: nowMs(),
    globalStreak: 0, // carries across games
    totalGamesPlayed: 0
  };
}

function saveProfiles() {
  saveJSON(STORAGE_KEYS.profiles, profilesByName);
}

function setCurrentProfile(name) {
  currentProfileName = name;
  saveJSON(STORAGE_KEYS.currentProfile, currentProfileName);
}

function pushRecentProfile(name) {
  const trimmed = name.trim();
  const without = recentProfiles.filter((n) => n !== trimmed);
  without.unshift(trimmed);
  recentProfiles = without.slice(0, 10);
  saveJSON(STORAGE_KEYS.recentProfiles, recentProfiles);
}

function maybeMigrateLegacyData() {
  // If we already have profiles, skip
  if (Object.keys(profilesByName).length > 0) return;
  // Check legacy keys
  const legacyFactStats = loadJSON(STORAGE_KEYS.factStats, null);
  const legacyCycle = loadJSON(STORAGE_KEYS.cycleQueue, null);
  const legacyMissed = loadJSON(STORAGE_KEYS.lastMissed, null);
  const legacyBest = loadJSON(STORAGE_KEYS.best, null);
  const legacyPrev = loadJSON(STORAGE_KEYS.previous, null);
  if (
    legacyFactStats || legacyCycle || legacyMissed || legacyBest || legacyPrev
  ) {
    const name = 'Player';
    const profile = createEmptyProfile(name);
    if (legacyFactStats) profile.factStatsByKey = legacyFactStats;
    if (legacyCycle) profile.cycleQueue = legacyCycle;
    if (legacyMissed) profile.lastMissedKeys = legacyMissed;
    if (legacyBest) profile.bestRecords = legacyBest;
    if (legacyPrev) profile.previousGame = legacyPrev;
    profilesByName[name] = profile;
    saveProfiles();
    setCurrentProfile(name);
    pushRecentProfile(name);
  }
}

function getActiveProfile() {
  if (!currentProfileName || !profilesByName[currentProfileName]) return null;
  return profilesByName[currentProfileName];
}

function switchToProfile(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (!profilesByName[trimmed]) {
    profilesByName[trimmed] = createEmptyProfile(trimmed);
    saveProfiles();
  }
  setCurrentProfile(trimmed);
  pushRecentProfile(trimmed);
  loadActiveProfileData();
  updateCurrentPlayerPill();
  applyActiveProfileTheme();
  refreshTopRecords();
  startNewGame();
}

// Load active profile data into module-level stores
let factStatsByKey = {};
let cycleQueue = [];
let lastMissedKeys = [];
let bestRecords = { bestStreak: 0, bestPercent: 0, bestAvgTimeSec: null };
let previousGame = { percent: 0, avgTimeSec: null, maxStreak: 0 };
let unmasteredQueue = [];
let globalStreak = 0; // carries across games
let totalGamesPlayed = 0;

function loadActiveProfileData() {
  const profile = getActiveProfile();
  if (!profile) return;
  factStatsByKey = profile.factStatsByKey || {};
  cycleQueue = profile.cycleQueue || [];
  lastMissedKeys = profile.lastMissedKeys || [];
  bestRecords = profile.bestRecords || { bestStreak: 0, bestPercent: 0, bestAvgTimeSec: null };
  previousGame = profile.previousGame || { percent: 0, avgTimeSec: null, maxStreak: 0 };
  if (!Array.isArray(profile.unmasteredQueue)) {
    profile.unmasteredQueue = ALL_FACTS
      .map(({ a, b }) => factKey(a, b))
      .filter((k) => !(factStatsByKey[k] && factStatsByKey[k].correct > 0));
  }
  unmasteredQueue = profile.unmasteredQueue;
  const masteredKeys = ALL_FACTS
    .map(({ a, b }) => factKey(a, b))
    .filter((k) => factStatsByKey[k] && factStatsByKey[k].correct > 0);
  masteredKeys.forEach((k) => { if (!cycleQueue.includes(k)) cycleQueue.push(k); });
  globalStreak = Number(profile.globalStreak || 0);
  totalGamesPlayed = Number(profile.totalGamesPlayed || 0);
}

function saveActiveProfileData() {
  const profile = getActiveProfile();
  if (!profile) return;
  profile.factStatsByKey = factStatsByKey;
  profile.cycleQueue = cycleQueue;
  profile.lastMissedKeys = lastMissedKeys;
  profile.bestRecords = bestRecords;
  profile.previousGame = previousGame;
  profile.unmasteredQueue = unmasteredQueue;
  profile.globalStreak = globalStreak;
  profile.totalGamesPlayed = totalGamesPlayed;
  profile.lastPlayedMs = nowMs();
  saveProfiles();
}

// Session state
const GAME_LENGTH = 20;
let askedCount = 0; // attempts
let correctCount = 0;
let currentStreak = 0;
let maxStreak = 0;
let totalAnswerTimeMs = 0;
let currentQuestion = null; // { a, b, key }
let questionStartTimeMs = null;
const askedThisGame = new Set(); // unique keys this game
const missedThisGame = new Set();
const retryQueue = []; // keys to immediately retry until correct

// Modal state
let modalOpenCount = 0;
let isFeedbackOpen = false;

// Elements
const factorAEl = document.getElementById('factor-a');
const factorBEl = document.getElementById('factor-b');
const percentEl = document.getElementById('stat-percent');
const streakEl = document.getElementById('stat-streak');
const avgTimeEl = document.getElementById('stat-avgtime');
const gamesEl = document.getElementById('stat-games');
const progressEl = document.getElementById('progress');
const tipsEl = document.getElementById('tips');

const formEl = document.getElementById('answer-form');
const answerInputEl = document.getElementById('answer-input');
const submitBtnEl = document.getElementById('submit-btn');

const feedbackModalEl = document.getElementById('feedback-modal');
const feedbackTitleEl = document.getElementById('feedback-title');
const feedbackMsgEl = document.getElementById('feedback-message');
const nextBtnEl = document.getElementById('next-btn');

const endModalEl = document.getElementById('end-modal');
const summaryEl = document.getElementById('summary');
const missedListEl = document.getElementById('missed-list');
const playAgainBtnEl = document.getElementById('play-again-btn');
const closeReportBtnEl = document.getElementById('close-report-btn');

// Best/Prev elements
const bestStreakEl = document.getElementById('best-streak');
const bestPercentEl = document.getElementById('best-percent');
const bestAvgTimeEl = document.getElementById('best-avgtime');
const prevStreakEl = document.getElementById('prev-streak');
const prevPercentEl = document.getElementById('prev-percent');
const prevAvgTimeEl = document.getElementById('prev-avgtime');

// Header actions
const changePlayerBtnEl = document.getElementById('change-player-btn');
const leaderboardBtnEl = document.getElementById('leaderboard-btn');
const currentPlayerEl = document.getElementById('current-player');
const themeBtnEl = document.getElementById('theme-btn');
const badgesTrayEl = document.getElementById('badges-tray');

// Profile modal
const profileModalEl = document.getElementById('profile-modal');
const profileNameInputEl = document.getElementById('profile-name-input');
const profileStartBtnEl = document.getElementById('profile-start-btn');
const recentProfilesEl = document.getElementById('recent-profiles');

// Leaderboard modal
const leaderboardModalEl = document.getElementById('leaderboard-modal');
const leaderboardTableEl = document.getElementById('leaderboard-table');
const closeLeaderboardBtnEl = document.getElementById('close-leaderboard-btn');

// Theme modal
const themeModalEl = document.getElementById('theme-modal');
const themeOptionsEl = document.getElementById('theme-options');
const closeThemeBtnEl = document.getElementById('close-theme-btn');

// Achievement modal
const achievementModalEl = document.getElementById('achievement-modal');
const achievementOkBtnEl = document.getElementById('achievement-ok-btn');
const achievementTitleEl = document.getElementById('achievement-title');
const achievementMessageEl = document.getElementById('achievement-message');

// Sounds
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playTone(freq, durationMs, type = 'sine', gainValue = 0.04) {
  try {
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = gainValue;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); }, durationMs);
  } catch (_) { /* ignore */ }
}

function playSuccess() {
  playTone(880, 80, 'triangle', 0.06);
  setTimeout(() => playTone(1320, 80, 'triangle', 0.05), 80);
}

function playError() {
  playTone(220, 120, 'sawtooth', 0.05);
}

function playNav() {
  playTone(660, 40, 'square', 0.03);
}

function playExplosion() {
  try {
    ensureAudio();
    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
    }
    const whiteNoise = audioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, audioCtx.currentTime);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.8);
    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    whiteNoise.start();
    whiteNoise.stop(audioCtx.currentTime + 0.9);
  } catch (_) { /* ignore */ }
}

function updateBadgesTray() {
  const profile = getActiveProfile();
  if (!profile || !badgesTrayEl) return;
  const levels = profile.achievements?.levelsEarned || [];
  if (levels.length === 0) {
    badgesTrayEl.classList.remove('active');
    badgesTrayEl.innerHTML = '';
    return;
  }
  badgesTrayEl.classList.add('active');
  badgesTrayEl.innerHTML = '';
  levels.forEach((lvl) => {
    const d = document.createElement('div');
    d.className = 'badge';
    const lv = document.createElement('span');
    lv.className = 'level';
    lv.textContent = `${lvl}×`;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = lvl === 1 ? 'All Facts Mastered' : `All Facts ${lvl}x`;
    d.appendChild(lv);
    d.appendChild(label);
    badgesTrayEl.appendChild(d);
  });
}

function checkAndAwardAchievements() {
  const profile = getActiveProfile();
  if (!profile) return;
  // Count facts with at least n corrects
  const countsByThreshold = new Map();
  for (let n = 1; n <= 10; n += 1) countsByThreshold.set(n, 0);
  for (const key of ALL_FACTS.map(({ a, b }) => factKey(a, b))) {
    const s = factStatsByKey[key];
    const corr = s?.correct || 0;
    for (let n = 1; n <= Math.min(corr, 10); n += 1) {
      countsByThreshold.set(n, (countsByThreshold.get(n) || 0) + 1);
    }
  }
  // Determine highest newly completed level
  let earnedLevel = null;
  for (let n = 1; n <= 10; n += 1) {
    if (countsByThreshold.get(n) === 121 && !profile.achievements.levelsEarned.includes(n)) {
      earnedLevel = n;
    }
  }
  if (earnedLevel != null) {
    profile.achievements.levelsEarned.push(earnedLevel);
    profile.achievements.levelsEarned.sort((a, b) => a - b);
    saveProfiles();
    updateBadgesTray();
    showAchievementModal(earnedLevel);
  }
}

function showAchievementModal(level) {
  achievementTitleEl.textContent = 'Achievement unlocked!';
  achievementMessageEl.textContent = level === 1
    ? 'You mastered all 121 facts! Incredible! 💥'
    : `You mastered all 121 facts ${level} times! WOW! 💥`;
  openModal(achievementModalEl, 'modal--success');
  playExplosion();
}

// Theme management
const THEMES = [
  { id: 'default', label: 'Default', className: '', colors: ['#ffe6f7', '#e8f4ff', '#ffffff'], primary: '#6a5ae0' },
  { id: 'orange', label: 'Orange', className: 'theme-orange', colors: ['#fff1e6', '#fff7ef', '#ffffff'], primary: '#ff8a34' },
  { id: 'pink', label: 'Pink', className: 'theme-pink', colors: ['#ffe6f5', '#fff0fa', '#ffffff'], primary: '#e0569a' },
  { id: 'blue', label: 'Blue', className: 'theme-blue', colors: ['#e6f0ff', '#f3f8ff', '#ffffff'], primary: '#3d7eff' },
  { id: 'mint', label: 'Mint', className: 'theme-mint', colors: ['#e6fff8', '#effffb', '#ffffff'], primary: '#2dc5a3' },
  { id: 'purple', label: 'Purple', className: 'theme-purple', colors: ['#efe6ff', '#f7f1ff', '#ffffff'], primary: '#7a5af8' },
  { id: 'contrast', label: 'Bold', className: 'theme-contrast', colors: ['#fdfdfd', '#ffffff', '#ffffff'], primary: '#111827' }
];

function applyTheme(themeId) {
  const { classList } = document.documentElement; // apply on <html>
  // Remove all theme classes
  THEMES.forEach((t) => {
    if (t.className) classList.remove(t.className);
  });
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  if (theme.className) classList.add(theme.className);
}

function openThemeModal() {
  themeOptionsEl.innerHTML = '';
  THEMES.forEach((theme) => {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    const colors = document.createElement('div');
    colors.className = 'colors';
    colors.style.background = `linear-gradient(90deg, ${theme.colors.join(', ')})`;
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = theme.label;
    sw.appendChild(colors);
    sw.appendChild(label);
    sw.addEventListener('click', () => {
      const profile = getActiveProfile();
      if (profile) {
        profile.theme = theme.id;
        saveProfiles();
      }
      applyTheme(theme.id);
      closeModal(themeModalEl);
    });
    themeOptionsEl.appendChild(sw);
  });
  openModal(themeModalEl);
}

function applyActiveProfileTheme() {
  const profile = getActiveProfile();
  if (profile && profile.theme) {
    applyTheme(profile.theme);
  } else {
    applyTheme('default');
  }
}

function setText(el, text) { el.textContent = text; }

function formatPercent(n) {
  return `${Math.round(n)}%`;
}

function updateLiveStats() {
  const percent = askedCount > 0 ? (100 * (correctCount / askedCount)) : 0;
  const avgTimeSec = askedCount > 0 ? Math.round(totalAnswerTimeMs / askedCount / 1000) : 0;

  setText(streakEl, `${globalStreak}`);
  setText(percentEl, formatPercent(percent));
  setText(avgTimeEl, `${avgTimeSec}s`);
  gamesEl && setText(gamesEl, `${totalGamesPlayed}`);
  const displayCount = Math.min(askedThisGame.size + (currentQuestion ? 1 : 0), GAME_LENGTH);
  setText(progressEl, `Question ${displayCount} / ${GAME_LENGTH}`);
}

function refreshTopRecords() {
  setText(bestStreakEl, `${bestRecords.bestStreak ?? 0}`);
  setText(bestPercentEl, bestRecords.bestPercent != null ? formatPercent(bestRecords.bestPercent) : '0%');
  setText(bestAvgTimeEl, (bestRecords.bestAvgTimeSec != null) ? `${bestRecords.bestAvgTimeSec}s` : '—');

  setText(prevStreakEl, `${previousGame.maxStreak ?? 0}`);
  setText(prevPercentEl, previousGame.percent != null ? formatPercent(previousGame.percent) : '0%');
  setText(prevAvgTimeEl, (previousGame.avgTimeSec != null) ? `${previousGame.avgTimeSec}s` : '—');
}

function updateCurrentPlayerPill() {
  const name = currentProfileName || '—';
  setText(currentPlayerEl, `Player: ${name}`);
}

function pickNextQuestionKey() {
  if (askedThisGame.size >= GAME_LENGTH) return null;

  // Consume one scheduled missed around the 3rd question of this game
  if (askedThisGame.size === 2 && lastMissedKeys.length > 0) {
    const k = lastMissedKeys.shift();
    saveActiveProfileData();
    if (!askedThisGame.has(k)) return k;
  }

  // Unmastered first: pick first not yet used this game (no rotation)
  if (unmasteredQueue.length > 0) {
    for (let i = 0; i < unmasteredQueue.length; i += 1) {
      const k = unmasteredQueue[i];
      if (!askedThisGame.has(k)) {
        return k;
      }
    }
  }

  // Mastered cycle: pick first not yet used this game
  if (cycleQueue.length > 0) {
    for (let i = 0; i < cycleQueue.length; i += 1) {
      const k = cycleQueue[i];
      if (!askedThisGame.has(k)) {
        return k;
      }
    }
  }

  // Fallback
  const remaining = ALL_FACTS
    .map(({ a, b }) => factKey(a, b))
    .filter((k) => !askedThisGame.has(k));
  if (remaining.length === 0) return null;
  return remaining[Math.floor(Math.random() * remaining.length)];
}

function keyToFact(key) {
  const [aStr, bStr] = key.split('x');
  return { a: Number(aStr), b: Number(bStr) };
}

function showQuestionByKey(key) {
  const { a, b } = keyToFact(key);
  currentQuestion = { a, b, key };
  questionStartTimeMs = nowMs();
  setText(factorAEl, `${a}`);
  setText(factorBEl, `${b}`);
  answerInputEl.value = '';
  answerInputEl.focus();
  tipsEl.textContent = randomTip();
}

const TIPS = [
  'Try skip counting! 4, 8, 12, 16... ✨',
  'Zero times anything is zero! 0️⃣',
  'Tens are easy: add a zero at the end! 🔟',
  'Fives end with 0 or 5! 🙌',
  'Practice makes progress! 🌟',
  'Nine trick: digits add to 9! 🪄'
];
function randomTip() { return TIPS[Math.floor(Math.random() * TIPS.length)]; }

function openModal(modalEl, variant) {
  modalEl.setAttribute('aria-hidden', 'false');
  modalEl.classList.remove('modal--success', 'modal--error');
  if (variant) modalEl.classList.add(variant);
  modalOpenCount += 1;
  // Disable form while modal is open to avoid background submit
  answerInputEl.blur();
  submitBtnEl.disabled = true;
  answerInputEl.disabled = true;
  if (modalEl === feedbackModalEl) {
    isFeedbackOpen = true;
    setTimeout(() => { try { nextBtnEl.focus(); } catch (_) {} }, 0);
  }
}

function closeModal(modalEl) {
  modalEl.setAttribute('aria-hidden', 'true');
  modalOpenCount = Math.max(0, modalOpenCount - 1);
  if (modalOpenCount === 0) {
    submitBtnEl.disabled = false;
    answerInputEl.disabled = false;
  }
  if (modalEl === feedbackModalEl) {
    isFeedbackOpen = false;
  }
}

function handleSubmitAnswer(event) {
  event.preventDefault();
  if (isFeedbackOpen || modalOpenCount > 0) return;
  if (!currentQuestion) return;
  const raw = answerInputEl.value.trim();
  if (raw === '') { answerInputEl.focus(); return; }
  const userValue = Number(raw);
  if (!Number.isFinite(userValue)) return;

  const elapsedMs = nowMs() - questionStartTimeMs;
  totalAnswerTimeMs += elapsedMs;

  const { a, b, key } = currentQuestion;
  const correctAnswer = a * b;
  const isCorrect = userValue === correctAnswer;

  askedCount += 1;
  if (!askedThisGame.has(key)) askedThisGame.add(key);

  const stats = factStatsByKey[key] || { correct: 0, wrong: 0, lastSeenMs: 0 };
  stats.lastSeenMs = nowMs();
  if (isCorrect) {
    stats.correct += 1;
    correctCount += 1;
    globalStreak += 1;
    currentStreak += 1;
    if (globalStreak > (bestRecords.bestStreak || 0)) bestRecords.bestStreak = globalStreak;
    if (currentStreak > maxStreak) maxStreak = currentStreak;

    // First time mastered -> move from unmastered to mastered
    if (stats.correct === 1) {
      const idx = unmasteredQueue.indexOf(key);
      if (idx !== -1) unmasteredQueue.splice(idx, 1);
      if (!cycleQueue.includes(key)) cycleQueue.push(key);
    }
  } else {
    stats.wrong += 1;
    currentStreak = 0;
    globalStreak = 0; // reset global streak on any miss
    missedThisGame.add(key);
  }
  factStatsByKey[key] = stats;
  saveActiveProfileData();

  // Update stats immediately so streak shows right away
  updateLiveStats();

  if (isCorrect) {
    checkAndAwardAchievements();
  }

  // If this was the final unique question, go straight to the end report
  if (askedThisGame.size >= GAME_LENGTH) {
    showEndSummary();
    return;
  }

  // Otherwise, show feedback for this question
  if (isCorrect) {
    feedbackTitleEl.textContent = randomPraise();
    feedbackMsgEl.textContent = `${a} × ${b} = ${correctAnswer}. High five! ✋`;
    openModal(feedbackModalEl, 'modal--success');
    playSuccess();
  } else {
    feedbackTitleEl.textContent = randomEncouragement();
    feedbackMsgEl.textContent = `Oops, the answer is ${a} × ${b} = ${correctAnswer}. You can do it next time!`;
    openModal(feedbackModalEl, 'modal--error');
    playError();
  }

  nextBtnEl.dataset.nextAction = 'question';
  nextBtnEl.textContent = 'Next';
}

const PRAISE = [
  'Correct! 🎉',
  'Awesome! 🌟',
  'You nailed it! 💥',
  'Yes! Great work! ✅',
  'Boom! Math star! ⭐️'
];
const ENCOURAGE = [
  'Nice try! 💪',
  "Keep going! You've got this! 🚀",
  'So close! Try the next one! ✨',
  'Don’t give up! 🌈',
  'Every try makes you stronger! 🧠'
];
function randomPraise() { return PRAISE[Math.floor(Math.random() * PRAISE.length)]; }
function randomEncouragement() { return ENCOURAGE[Math.floor(Math.random() * ENCOURAGE.length)]; }

function handleNext() {
  closeModal(feedbackModalEl);
  const action = nextBtnEl.dataset.nextAction || 'question';
  if (action === 'end') {
    showEndSummary();
  } else {
    askNextQuestion();
  }
  playNav();
}

function askNextQuestion() {
  const key = pickNextQuestionKey();
  if (!key) {
    showEndSummary();
    return;
  }
  showQuestionByKey(key);
  updateLiveStats();
}

function showEndSummary() {
  const percent = askedCount > 0 ? (100 * (correctCount / askedCount)) : 0;
  const avgTimeSec = askedCount > 0 ? Math.round(totalAnswerTimeMs / askedCount / 1000) : 0;

  if (maxStreak > (bestRecords.bestStreak ?? 0)) bestRecords.bestStreak = maxStreak;
  if (percent > (bestRecords.bestPercent ?? 0)) bestRecords.bestPercent = percent;
  if (avgTimeSec > 0 && (bestRecords.bestAvgTimeSec == null || avgTimeSec < bestRecords.bestAvgTimeSec)) {
    bestRecords.bestAvgTimeSec = avgTimeSec;
  }
  previousGame = { percent, avgTimeSec, maxStreak };
  totalGamesPlayed += 1;

  // Re-check achievements at end (in case threshold crossed on last Q)
  checkAndAwardAchievements();

  // Schedule missed for next game (cap 10)
  lastMissedKeys = Array.from(missedThisGame).slice(0, 10);

  saveActiveProfileData();

  // Update header stats immediately to reflect games increment
  updateLiveStats();

  // Build summary content
  summaryEl.innerHTML = '';
  const summaryLines = [
    `Score: <strong>${correctCount}</strong> / ${askedCount} (${formatPercent(percent)})`,
    `Average time: <strong>${avgTimeSec}s</strong>`,
    `Longest streak: <strong>${maxStreak}</strong>`
  ];
  summaryLines.forEach((line) => {
    const p = document.createElement('p');
    p.innerHTML = line;
    summaryEl.appendChild(p);
  });

  // Missed list (up to 10)
  missedListEl.innerHTML = '';
  const missedKeys = Array.from(missedThisGame);
  const maxShow = 10;
  missedKeys.slice(0, maxShow).forEach((key) => {
    const { a, b } = keyToFact(key);
    const li = document.createElement('li');
    li.textContent = `${a} × ${b} = ${a * b}`;
    missedListEl.appendChild(li);
  });
  if (missedKeys.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No misses this time — amazing! 🌟';
    missedListEl.appendChild(li);
  }

  refreshTopRecords();
  openModal(endModalEl);
}

function resetGame() {
  askedCount = 0;
  correctCount = 0;
  currentStreak = 0;
  maxStreak = 0;
  totalAnswerTimeMs = 0;
  currentQuestion = null;
  questionStartTimeMs = null;
  askedThisGame.clear();
  missedThisGame.clear();
  retryQueue.length = 0;
  updateLiveStats();
  refreshTopRecords();
}

function startNewGame() {
  resetGame();
  askNextQuestion();
}

function populateRecentProfilesChips() {
  if (!recentProfilesEl) return;
  recentProfilesEl.innerHTML = '';
  recentProfiles.forEach((name) => {
    const d = document.createElement('div');
    d.className = 'chip';
    d.textContent = name;
    d.addEventListener('click', () => {
      switchToProfile(name);
      closeModal(profileModalEl);
    });
    recentProfilesEl.appendChild(d);
  });
}

function openProfileModal() {
  openModal(profileModalEl);
  populateRecentProfilesChips();
  setTimeout(() => { try { profileNameInputEl.focus(); } catch (_) {} }, 0);
}

function buildLeaderboardRows(metric = 'percent') {
  const tbody = leaderboardTableEl.querySelector('tbody');
  tbody.innerHTML = '';
  const rows = Object.values(profilesByName).map((p) => ({
    name: p.name,
    best: p.bestRecords || { bestStreak: 0, bestPercent: 0, bestAvgTimeSec: null },
    totalGames: Number(p.totalGamesPlayed || 0)
  }));
  rows.sort((a, b) => {
    if (metric === 'percent') {
      const ap = a.best.bestPercent || 0;
      const bp = b.best.bestPercent || 0;
      return bp - ap;
    }
    if (metric === 'streak') {
      const as = a.best.bestStreak || 0;
      const bs = b.best.bestStreak || 0;
      return bs - as;
    }
    if (metric === 'avgtime') {
      const at = a.best.bestAvgTimeSec == null ? Infinity : a.best.bestAvgTimeSec;
      const bt = b.best.bestAvgTimeSec == null ? Infinity : b.best.bestAvgTimeSec;
      return at - bt;
    }
    if (metric === 'games') {
      return (b.totalGames || 0) - (a.totalGames || 0);
    }
    return 0;
  });
  rows.forEach(({ name, best, totalGames }) => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    const tdStreak = document.createElement('td');
    const tdPercent = document.createElement('td');
    const tdAvg = document.createElement('td');
    const tdGames = document.createElement('td');
    tdName.textContent = name;
    tdStreak.textContent = `${best.bestStreak ?? 0}`;
    tdPercent.textContent = `${Math.round(best.bestPercent ?? 0)}%`;
    tdAvg.textContent = best.bestAvgTimeSec != null ? `${best.bestAvgTimeSec}s` : '—';
    tdGames.textContent = `${totalGames || 0}`;
    tr.appendChild(tdName);
    tr.appendChild(tdStreak);
    tr.appendChild(tdPercent);
    tr.appendChild(tdAvg);
    tr.appendChild(tdGames);
    tbody.appendChild(tr);
  });
}

function init() {
  // Always start with player selection on refresh
  currentProfileName = null;
  saveJSON(STORAGE_KEYS.currentProfile, null);

  maybeMigrateLegacyData();
  updateCurrentPlayerPill();
  applyActiveProfileTheme();
  refreshTopRecords();
  updateLiveStats();
  updateBadgesTray();

  // Show profile picker on load
  openProfileModal();

  formEl.addEventListener('submit', handleSubmitAnswer);
  nextBtnEl.addEventListener('click', handleNext);

  document.addEventListener('keydown', (e) => {
    if (isFeedbackOpen && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      handleNext();
    }
  });

  playAgainBtnEl.addEventListener('click', () => {
    closeModal(endModalEl);
    startNewGame();
  });

  closeReportBtnEl.addEventListener('click', () => {
    closeModal(endModalEl);
  });

  changePlayerBtnEl.addEventListener('click', () => {
    openProfileModal();
    playNav();
  });

  profileStartBtnEl.addEventListener('click', () => {
    const name = profileNameInputEl.value.trim();
    if (!name) return;
    switchToProfile(name);
    updateBadgesTray();
    closeModal(profileModalEl);
  });

  profileNameInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      profileStartBtnEl.click();
    }
  });

  leaderboardBtnEl.addEventListener('click', () => {
    // Default metric percent
    buildLeaderboardRows('percent');
    openModal(leaderboardModalEl);
    playNav();
  });
  const lbControls = document.getElementById('leaderboard-controls');
  lbControls.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-metric]');
    if (!btn) return;
    lbControls.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const metric = btn.getAttribute('data-metric');
    buildLeaderboardRows(metric);
  });

  closeLeaderboardBtnEl.addEventListener('click', () => {
    closeModal(leaderboardModalEl);
  });

  themeBtnEl.addEventListener('click', () => {
    openThemeModal();
    playNav();
  });

  closeThemeBtnEl.addEventListener('click', () => {
    closeModal(themeModalEl);
  });

  achievementOkBtnEl.addEventListener('click', () => {
    closeModal(achievementModalEl);
  });
}

document.addEventListener('DOMContentLoaded', init);