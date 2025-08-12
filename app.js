'use strict';

// Local storage keys
const STORAGE_KEYS = {
  factStats: 'mf_fact_stats_v1',
  cycleQueue: 'mf_cycle_queue_v1',
  lastMissed: 'mf_last_missed_v1',
  best: 'mf_best_v1',
  previous: 'mf_previous_v1'
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

// Persistent stores
let factStatsByKey = loadJSON(STORAGE_KEYS.factStats, {}); // { [key]: { correct, wrong, lastSeenMs } }
let cycleQueue = loadJSON(STORAGE_KEYS.cycleQueue, []); // array of keys for rotation of mastered facts
let lastMissedKeys = loadJSON(STORAGE_KEYS.lastMissed, []); // array of keys from last game that were missed
let bestRecords = loadJSON(STORAGE_KEYS.best, { bestStreak: 0, bestPercent: 0, bestAvgTimeSec: null });
let previousGame = loadJSON(STORAGE_KEYS.previous, { percent: 0, avgTimeSec: null, maxStreak: 0 });

function isMastered(key) {
  const s = factStatsByKey[key];
  return !!s && s.correct > 0;
}

function updateCycleQueueForMastered(key) {
  if (!cycleQueue.includes(key)) {
    cycleQueue.push(key);
    saveJSON(STORAGE_KEYS.cycleQueue, cycleQueue);
  }
}

// Session state
const GAME_LENGTH = 20;
let askedCount = 0;
let correctCount = 0;
let currentStreak = 0;
let maxStreak = 0;
let totalAnswerTimeMs = 0;
let currentQuestion = null; // { a, b, key }
let questionStartTimeMs = null;
const askedThisGame = new Set();
const missedThisGame = new Set();

// Elements
const factorAEl = document.getElementById('factor-a');
const factorBEl = document.getElementById('factor-b');
const percentEl = document.getElementById('stat-percent');
const streakEl = document.getElementById('stat-streak');
const avgTimeEl = document.getElementById('stat-avgtime');
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

function setText(el, text) { el.textContent = text; }

function formatPercent(n) {
  return `${Math.round(n)}%`;
}

function updateLiveStats() {
  const percent = askedCount > 0 ? (100 * (correctCount / askedCount)) : 0;
  const avgTimeSec = askedCount > 0 ? Math.round(totalAnswerTimeMs / askedCount / 1000) : 0;

  setText(streakEl, `${currentStreak}`);
  setText(percentEl, formatPercent(percent));
  setText(avgTimeEl, `${avgTimeSec}s`);
  const displayCount = Math.min(askedCount + (currentQuestion ? 1 : 0), GAME_LENGTH);
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

function pickNextQuestionKey() {
  if (askedCount >= GAME_LENGTH) return null;

  // 1) Prioritize last missed facts
  for (const key of lastMissedKeys) {
    if (!askedThisGame.has(key)) return key;
  }

  // 2) Facts never answered correctly
  const neverMastered = ALL_FACTS
    .map(({ a, b }) => factKey(a, b))
    .filter((k) => !askedThisGame.has(k) && !isMastered(k));
  if (neverMastered.length > 0) {
    return neverMastered[Math.floor(Math.random() * neverMastered.length)];
  }

  // 3) Rotate through mastered facts via cycle queue
  if (cycleQueue.length > 0) {
    // Find the next in queue that we have not used this game
    for (let i = 0; i < cycleQueue.length; i += 1) {
      const k = cycleQueue[0];
      cycleQueue.push(cycleQueue.shift()); // rotate
      if (!askedThisGame.has(k)) {
        saveJSON(STORAGE_KEYS.cycleQueue, cycleQueue);
        return k;
      }
    }
  }

  // 4) As a fallback (should be rare), sample any fact not used this game
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
}

function closeModal(modalEl) {
  modalEl.setAttribute('aria-hidden', 'true');
}

function handleSubmitAnswer(event) {
  event.preventDefault();
  if (!currentQuestion) return;
  const raw = answerInputEl.value.trim();
  if (raw === '') {
    answerInputEl.focus();
    return;
  }
  const userValue = Number(raw);
  if (!Number.isFinite(userValue)) return;

  const elapsedMs = nowMs() - questionStartTimeMs;
  totalAnswerTimeMs += elapsedMs;

  const { a, b, key } = currentQuestion;
  const correctAnswer = a * b;
  const isCorrect = userValue === correctAnswer;

  // Update stats
  askedCount += 1;
  askedThisGame.add(key);
  const stats = factStatsByKey[key] || { correct: 0, wrong: 0, lastSeenMs: 0 };
  stats.lastSeenMs = nowMs();
  if (isCorrect) {
    stats.correct += 1;
    correctCount += 1;
    currentStreak += 1;
    if (currentStreak > maxStreak) maxStreak = currentStreak;
  } else {
    stats.wrong += 1;
    currentStreak = 0;
    missedThisGame.add(key);
  }
  factStatsByKey[key] = stats;
  saveJSON(STORAGE_KEYS.factStats, factStatsByKey);

  if (isCorrect && !isMastered(key)) {
    updateCycleQueueForMastered(key);
  }

  // Feedback modal
  if (isCorrect) {
    feedbackTitleEl.textContent = randomPraise();
    feedbackMsgEl.textContent = `${a} × ${b} = ${correctAnswer}. High five! ✋`;
    openModal(feedbackModalEl, 'modal--success');
  } else {
    feedbackTitleEl.textContent = randomEncouragement();
    feedbackMsgEl.textContent = `Oops, the answer is ${a} × ${b} = ${correctAnswer}. You can do it next time!`;
    openModal(feedbackModalEl, 'modal--error');
  }

  updateLiveStats();

  // If game complete, next goes to summary
  if (askedCount >= GAME_LENGTH) {
    nextBtnEl.dataset.nextAction = 'end';
  } else {
    nextBtnEl.dataset.nextAction = 'question';
  }
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
}

function askNextQuestion() {
  const key = pickNextQuestionKey();
  if (!key) {
    // No more questions available; end game
    showEndSummary();
    return;
  }
  showQuestionByKey(key);
  updateLiveStats();
}

function showEndSummary() {
  // Compute final stats
  const percent = askedCount > 0 ? (100 * (correctCount / askedCount)) : 0;
  const avgTimeSec = askedCount > 0 ? Math.round(totalAnswerTimeMs / askedCount / 1000) : 0;

  // Update bests
  if (maxStreak > (bestRecords.bestStreak ?? 0)) bestRecords.bestStreak = maxStreak;
  if (percent > (bestRecords.bestPercent ?? 0)) bestRecords.bestPercent = percent;
  if (avgTimeSec > 0 && (bestRecords.bestAvgTimeSec == null || avgTimeSec < bestRecords.bestAvgTimeSec)) {
    bestRecords.bestAvgTimeSec = avgTimeSec;
  }
  saveJSON(STORAGE_KEYS.best, bestRecords);

  // Save previous game
  previousGame = { percent, avgTimeSec, maxStreak };
  saveJSON(STORAGE_KEYS.previous, previousGame);

  // Save last missed for next run prioritization
  lastMissedKeys = Array.from(missedThisGame);
  saveJSON(STORAGE_KEYS.lastMissed, lastMissedKeys);

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
  updateLiveStats();
  refreshTopRecords();
}

function startNewGame() {
  resetGame();
  askNextQuestion();
}

function init() {
  refreshTopRecords();
  updateLiveStats();
  askNextQuestion();

  formEl.addEventListener('submit', handleSubmitAnswer);
  nextBtnEl.addEventListener('click', handleNext);

  // Allow Enter to continue from feedback modal
  feedbackModalEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
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
}

document.addEventListener('DOMContentLoaded', init);