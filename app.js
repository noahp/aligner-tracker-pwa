'use strict';

// ─── Constants ──────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_SETTINGS = 'aligner_settings';
const STORAGE_HISTORY = 'aligner_history';

// ─── Storage ─────────────────────────────────────────────────────────────────

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(s));
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(h) {
  localStorage.setItem(STORAGE_HISTORY, JSON.stringify(h));
}

// ─── Calculations ─────────────────────────────────────────────────────────────

/** Latest history entry (currently-wearing aligner). */
function currentEntry(history) {
  return history.length ? history[history.length - 1] : null;
}

/** Date when the next rotation is due. */
function nextRotationDate(entry, settings) {
  const start = new Date(entry.startDate);
  return new Date(start.getTime() + settings.rotationInterval * DAY_MS);
}

/**
 * Countdown to next rotation.
 * Returns { days, hours, totalMs, overdue }.
 */
function countdown(entry, settings) {
  const target = nextRotationDate(entry, settings);
  const diff = target - Date.now();
  const absDiff = Math.abs(diff);
  const days = Math.floor(absDiff / DAY_MS);
  const hours = Math.floor((absDiff % DAY_MS) / (60 * 60 * 1000));
  return { days, hours, totalMs: diff, overdue: diff < 0 };
}

/** Number of aligners remaining after the current one (not including current). */
function remainingAligners(entry, settings) {
  return Math.max(0, settings.totalAligners - entry.alignerNumber);
}

/** Estimated total days remaining (including time left on current aligner). */
function remainingDays(entry, settings) {
  const cd = countdown(entry, settings);
  const daysOnCurrent = Math.max(0, cd.totalMs / DAY_MS);
  return Math.round(daysOnCurrent + remainingAligners(entry, settings) * settings.rotationInterval);
}

/** Estimated treatment end date. */
function estimatedEndDate(entry, settings) {
  return new Date(Date.now() + remainingDays(entry, settings) * DAY_MS);
}

/** Overall treatment progress percentage (0–100). */
function progressPercent(entry, settings) {
  if (settings.totalAligners === 0) return 0;
  const completed = entry.alignerNumber - 1;
  const cd = countdown(entry, settings);
  const partial = Math.max(0, Math.min(1, 1 - cd.totalMs / (settings.rotationInterval * DAY_MS)));
  return Math.min(100, ((completed + partial) / settings.totalAligners) * 100);
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const FMT_DATE = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function fmtDate(d) {
  return FMT_DATE.format(d instanceof Date ? d : new Date(d));
}

function fmtCountdown({ days, hours, overdue }) {
  if (days === 0 && hours === 0 && !overdue) return 'Due today!';
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days === 0) parts.push(`${hours}h`);
  return overdue ? `${parts.join(' ')} overdue` : parts.join(' ');
}

function fmtDuration(ms) {
  const days = Math.round(ms / DAY_MS);
  if (days === 1) return '1 day';
  return `${days} days`;
}

// ─── ICS Generation ──────────────────────────────────────────────────────────

function pad(n) {
  return String(n).padStart(2, '0');
}

function icsDateStr(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function icsUid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}@aligner-tracker`;
}

/**
 * Generate an ICS file with one all-day event per remaining rotation.
 * Includes a VALARM reminder on the same day.
 */
function generateICS(entry, settings) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aligner Tracker PWA//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  const start = nextRotationDate(entry, settings);
  const count = remainingAligners(entry, settings);

  for (let i = 0; i < count; i++) {
    const rotDate = new Date(start.getTime() + i * settings.rotationInterval * DAY_MS);
    const nextNum = entry.alignerNumber + 1 + i;
    const totalNum = settings.totalAligners;
    const dateStr = icsDateStr(rotDate);
    // End date for all-day event is exclusive (next calendar day)
    const rotDateNext = new Date(rotDate.getTime() + DAY_MS);
    const dateEndStr = icsDateStr(rotDateNext);

    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsUid()}`,
      `DTSTART;VALUE=DATE:${dateStr}`,
      `DTEND;VALUE=DATE:${dateEndStr}`,
      `SUMMARY:Rotate to Aligner ${nextNum} of ${totalNum}`,
      `DESCRIPTION:Switch to aligner ${nextNum} of ${totalNum} today.`,
      'BEGIN:VALARM',
      'TRIGGER:PT9H', // 9 AM on the event day (relative to all-day event start)
      'ACTION:DISPLAY',
      `DESCRIPTION:Rotate to Aligner ${nextNum} of ${totalNum}`,
      'END:VALARM',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadICS(content, filename) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer;

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2800);
}

// ─── Navigation ───────────────────────────────────────────────────────────────

let activeView = null;

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  const view = document.getElementById(`view-${name}`);
  if (!view) return;
  view.classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.target === name);
  });

  activeView = name;
  if (name === 'home') renderHome();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

// ─── Render: Home ─────────────────────────────────────────────────────────────

function renderHome() {
  const settings = loadSettings();
  const history = loadHistory();

  if (!settings) {
    showSetup();
    return;
  }

  const entry = currentEntry(history);
  if (!entry) {
    showSetup();
    return;
  }

  // Aligner card
  document.getElementById('h-num').textContent = entry.alignerNumber;
  document.getElementById('h-fraction').textContent = `of ${settings.totalAligners}`;

  const pct = progressPercent(entry, settings);
  document.getElementById('h-progress').style.width = `${pct.toFixed(1)}%`;
  document.getElementById('h-progress-label').textContent = `${Math.round(pct)}% complete`;

  // Countdown card
  const cd = countdown(entry, settings);
  const card = document.getElementById('h-countdown-card');
  const label = document.getElementById('h-countdown-label');
  const value = document.getElementById('h-countdown');
  const date = document.getElementById('h-countdown-date');

  card.classList.toggle('overdue', cd.overdue);
  label.textContent = cd.overdue ? 'Overdue' : 'Next rotation';
  value.textContent = fmtCountdown(cd);
  const nrd = nextRotationDate(entry, settings);
  date.textContent = cd.overdue ? `Was due ${fmtDate(nrd)}` : `Due ${fmtDate(nrd)}`;

  // Remaining card
  const remA = remainingAligners(entry, settings);
  const remD = remainingDays(entry, settings);
  document.getElementById('h-rem-aligners').textContent = remA;
  document.getElementById('h-rem-days').textContent = remD;

  const eed = estimatedEndDate(entry, settings);
  document.getElementById('h-est-end').textContent =
    remA > 0
      ? `Estimated completion: ${fmtDate(eed)}`
      : cd.overdue
        ? 'Treatment period complete - nice work!'
        : `Treatment ends ${fmtDate(nrd)}`;

  // Rotate button
  const rotBtn = document.getElementById('btn-rotate');
  const isLast = entry.alignerNumber >= settings.totalAligners;
  rotBtn.disabled = isLast;
  if (isLast) {
    rotBtn.innerHTML = 'All aligners done!';
  } else {
    rotBtn.innerHTML =
      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>` +
      `Rotate to Aligner ${entry.alignerNumber + 1}`;
  }
}

// ─── Render: History ──────────────────────────────────────────────────────────

function renderHistory() {
  const history = loadHistory();
  const settings = loadSettings();
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');

  if (!history.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  // Show newest first
  const reversed = [...history].reverse();
  const nowMs = Date.now();

  list.innerHTML = reversed
    .map((entry, idx) => {
      const isCurrent = idx === 0;
      const nextEntry = idx > 0 ? reversed[idx - 1] : null;
      const endMs = nextEntry ? new Date(nextEntry.startDate).getTime() : nowMs;
      const durationMs = endMs - new Date(entry.startDate).getTime();
      const durationStr = isCurrent ? 'current' : fmtDuration(durationMs);

      return `
      <div class="history-item">
        <div class="history-badge${isCurrent ? ' current' : ''}">${entry.alignerNumber}</div>
        <div class="history-info">
          <div class="history-aligner">Aligner ${entry.alignerNumber}${settings ? ` of ${settings.totalAligners}` : ''}</div>
          <div class="history-date">Started ${fmtDate(new Date(entry.startDate))}</div>
        </div>
        <div class="history-duration">${durationStr}</div>
      </div>
    `;
    })
    .join('');
}

// ─── Render: Settings ─────────────────────────────────────────────────────────

function renderSettings() {
  const settings = loadSettings();
  if (!settings) return;
  document.getElementById('s-total').value = settings.totalAligners;
  document.getElementById('s-interval').value = settings.rotationInterval;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function showSetup() {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById('view-setup').classList.remove('hidden');
  document.getElementById('bottom-nav').classList.add('hidden');

  // Default date to today
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = pad(today.getMonth() + 1);
  const dd = pad(today.getDate());
  document.getElementById('f-date').value = `${yyyy}-${mm}-${dd}`;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

let pendingRotation = null;

function openModal(nextNum, totalNum) {
  pendingRotation = nextNum;
  document.getElementById('modal-msg').textContent =
    `You're switching from aligner ${nextNum - 1} to aligner ${nextNum} of ${totalNum}. Confirm?`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-confirm').focus();
}

function closeModal() {
  pendingRotation = null;
  document.getElementById('modal').classList.add('hidden');
}

// ─── Copy History ─────────────────────────────────────────────────────────────

function copyHistoryToClipboard() {
  const history = loadHistory();
  const settings = loadSettings();
  if (!history.length) {
    showToast('No history to copy');
    return;
  }

  const lines = ['Aligner Rotation History', '========================'];
  history.forEach((entry, i) => {
    const next = history[i + 1];
    const durationMs = next
      ? new Date(next.startDate).getTime() - new Date(entry.startDate).getTime()
      : null;
    const total = settings ? ` of ${settings.totalAligners}` : '';
    const dur = durationMs != null ? `  (${fmtDuration(durationMs)})` : '  (current)';
    lines.push(
      `Aligner ${entry.alignerNumber}${total}: started ${fmtDate(new Date(entry.startDate))}${dur}`
    );
  });

  navigator.clipboard
    .writeText(lines.join('\n'))
    .then(() => showToast('Copied to clipboard'))
    .catch(() => showToast('Copy failed'));
}

// ─── Event Wiring ────────────────────────────────────────────────────────────

function init() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // ── Setup form
  document.getElementById('form-setup').addEventListener('submit', (e) => {
    e.preventDefault();
    const total = parseInt(document.getElementById('f-total').value, 10);
    const interval = parseInt(document.getElementById('f-interval').value, 10);
    const current = parseInt(document.getElementById('f-current').value, 10);
    const dateVal = document.getElementById('f-date').value; // YYYY-MM-DD

    if (!total || !interval || !current || !dateVal) return;
    if (current > total) {
      showToast('Current aligner cannot exceed total');
      return;
    }

    // Interpret entered date as local noon to avoid timezone boundary issues
    const startDate = new Date(`${dateVal}T12:00:00`);

    saveSettings({ totalAligners: total, rotationInterval: interval });
    saveHistory([{ alignerNumber: current, startDate: startDate.toISOString() }]);

    document.getElementById('bottom-nav').classList.remove('hidden');
    showView('home');
  });

  // ── Bottom nav
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.target));
  });

  // ── Rotate button
  document.getElementById('btn-rotate').addEventListener('click', () => {
    const settings = loadSettings();
    const history = loadHistory();
    const entry = currentEntry(history);
    if (!entry || !settings) return;

    const nextNum = entry.alignerNumber + 1;
    if (nextNum > settings.totalAligners) return;

    openModal(nextNum, settings.totalAligners);
  });

  // ── Modal confirm
  document.getElementById('modal-confirm').addEventListener('click', () => {
    if (pendingRotation == null) return;
    const history = loadHistory();
    history.push({
      alignerNumber: pendingRotation,
      startDate: new Date().toISOString(),
    });
    saveHistory(history);
    closeModal();
    renderHome();
    showToast(`Switched to aligner ${pendingRotation} 🎉`);
  });

  // ── Modal cancel / backdrop
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // ── Calendar button
  document.getElementById('btn-cal').addEventListener('click', () => {
    const settings = loadSettings();
    const history = loadHistory();
    const entry = currentEntry(history);
    if (!entry || !settings) return;

    const rem = remainingAligners(entry, settings);
    if (rem === 0) {
      showToast('No more rotations to schedule');
      return;
    }

    const ics = generateICS(entry, settings);
    downloadICS(ics, 'aligner-rotations.ics');
    showToast(`Downloaded ${rem} calendar event${rem > 1 ? 's' : ''}`);
  });

  // ── Copy history
  document.getElementById('btn-copy').addEventListener('click', copyHistoryToClipboard);

  // ── Settings form
  document.getElementById('form-settings').addEventListener('submit', (e) => {
    e.preventDefault();
    const total = parseInt(document.getElementById('s-total').value, 10);
    const interval = parseInt(document.getElementById('s-interval').value, 10);
    if (!total || !interval) return;

    saveSettings({ totalAligners: total, rotationInterval: interval });
    showToast('Settings saved');
    renderHome();
  });

  // ── Reset
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm('Reset all data? This cannot be undone.')) return;
    localStorage.removeItem(STORAGE_SETTINGS);
    localStorage.removeItem(STORAGE_HISTORY);
    document.getElementById('bottom-nav').classList.add('hidden');
    showSetup();
  });

  // ── Visibility: refresh countdown when app comes back to foreground
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeView === 'home') renderHome();
  });

  // ── Tick: update countdown every minute
  setInterval(() => {
    if (!document.hidden && activeView === 'home') renderHome();
  }, 60_000);

  // ── Initial routing
  const settings = loadSettings();
  const history = loadHistory();

  if (!settings || !history.length) {
    showSetup();
  } else {
    document.getElementById('bottom-nav').classList.remove('hidden');
    showView('home');
  }
}

document.addEventListener('DOMContentLoaded', init);
