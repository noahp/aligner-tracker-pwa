'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

// Current storage keys
const STORAGE_SERIES = 'aligner_series'; // [{id, name, totalAligners, rotationInterval, history[]}]
const STORAGE_ACTIVE = 'aligner_active'; // active series id

// Legacy keys (used only for one-time migration)
const LEGACY_SETTINGS = 'aligner_settings';
const LEGACY_HISTORY = 'aligner_history';

// ─── ID Generation ───────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ─── Storage ─────────────────────────────────────────────────────────────────

function loadSeries() {
  try {
    const raw = localStorage.getItem(STORAGE_SERIES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSeries(series) {
  localStorage.setItem(STORAGE_SERIES, JSON.stringify(series));
}

function loadActiveId() {
  return localStorage.getItem(STORAGE_ACTIVE) || null;
}

function saveActiveId(id) {
  localStorage.setItem(STORAGE_ACTIVE, id);
}

function getActiveSeries() {
  const series = loadSeries();
  if (!series.length) return null;
  const id = loadActiveId();
  return series.find((s) => s.id === id) || series[0];
}

// ─── Migration ───────────────────────────────────────────────────────────────

function migrate() {
  if (localStorage.getItem(STORAGE_SERIES) !== null) return;
  const raw = localStorage.getItem(LEGACY_SETTINGS);
  if (!raw) return;
  try {
    const settings = JSON.parse(raw);
    const history = JSON.parse(localStorage.getItem(LEGACY_HISTORY) || '[]');
    const series = [
      {
        id: genId(),
        name: 'Series 1',
        totalAligners: settings.totalAligners,
        rotationInterval: settings.rotationInterval,
        history,
      },
    ];
    saveSeries(series);
    saveActiveId(series[0].id);
    localStorage.removeItem(LEGACY_SETTINGS);
    localStorage.removeItem(LEGACY_HISTORY);
  } catch {
    // Migration failed — start fresh
  }
}

// ─── Calculations ─────────────────────────────────────────────────────────────

function currentEntry(history) {
  return history.length ? history[history.length - 1] : null;
}

function nextRotationDate(entry, settings) {
  const start = new Date(entry.startDate);
  return new Date(start.getTime() + settings.rotationInterval * DAY_MS);
}

function countdown(entry, settings) {
  const target = nextRotationDate(entry, settings);
  const diff = target - Date.now();
  const absDiff = Math.abs(diff);
  const days = Math.floor(absDiff / DAY_MS);
  const hours = Math.floor((absDiff % DAY_MS) / (60 * 60 * 1000));
  return { days, hours, totalMs: diff, overdue: diff < 0 };
}

function remainingAligners(entry, settings) {
  return Math.max(0, settings.totalAligners - entry.alignerNumber);
}

function remainingDays(entry, settings) {
  const cd = countdown(entry, settings);
  const daysOnCurrent = Math.max(0, cd.totalMs / DAY_MS);
  return Math.round(daysOnCurrent + remainingAligners(entry, settings) * settings.rotationInterval);
}

function estimatedEndDate(entry, settings) {
  return new Date(Date.now() + remainingDays(entry, settings) * DAY_MS);
}

function progressPercent(entry, settings) {
  if (settings.totalAligners === 0) return 0;
  const completed = entry.alignerNumber - 1;
  const cd = countdown(entry, settings);
  const partial = Math.max(0, Math.min(1, 1 - cd.totalMs / (settings.rotationInterval * DAY_MS)));
  return Math.min(100, ((completed + partial) / settings.totalAligners) * 100);
}

// ─── Formatting ───────────────────────────────────────────────────────────────

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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    const dateEndStr = icsDateStr(new Date(rotDate.getTime() + DAY_MS));

    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsUid()}`,
      `DTSTART;VALUE=DATE:${dateStr}`,
      `DTEND;VALUE=DATE:${dateEndStr}`,
      `SUMMARY:Rotate to Aligner ${nextNum} of ${totalNum}`,
      `DESCRIPTION:Switch to aligner ${nextNum} of ${totalNum} today.`,
      'BEGIN:VALARM',
      'TRIGGER:PT9H',
      'ACTION:DISPLAY',
      `DESCRIPTION:Rotate to Aligner ${nextNum} of ${totalNum}`,
      'END:VALARM',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Export / Import ─────────────────────────────────────────────────────────

function exportData() {
  const series = loadSeries();
  const payload = { version: 1, exported: new Date().toISOString(), series };
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadFile(
    JSON.stringify(payload, null, 2),
    `aligners-backup-${dateStr}.json`,
    'application/json'
  );
  showToast('Backup downloaded');
}

function isValidImport(data) {
  return (
    data &&
    typeof data === 'object' &&
    Array.isArray(data.series) &&
    data.series.every(
      (s) =>
        s.id &&
        s.name &&
        typeof s.totalAligners === 'number' &&
        typeof s.rotationInterval === 'number' &&
        Array.isArray(s.history)
    )
  );
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

// ─── Setup ────────────────────────────────────────────────────────────────────

function showSetup(isNew = false) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById('view-setup').classList.remove('hidden');
  if (!isNew) document.getElementById('bottom-nav').classList.add('hidden');

  document.getElementById('setup-heading').textContent = isNew ? 'New Series' : 'Aligner Tracker';
  document.getElementById('setup-desc').textContent = isNew
    ? 'Configure your new aligner series.'
    : 'Enter your treatment details to get started.';

  const existingCount = loadSeries().length;
  document.getElementById('f-name').value = isNew ? `Series ${existingCount + 1}` : 'Series 1';
  document.getElementById('f-interval').value = '14';
  document.getElementById('f-current').value = '1';

  const today = new Date();
  document.getElementById('f-date').value =
    `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  document.getElementById('btn-setup-cancel').classList.toggle('hidden', !isNew);
}

// ─── Render: Home ─────────────────────────────────────────────────────────────

function renderHome() {
  const active = getActiveSeries();
  if (!active) {
    showSetup(false);
    return;
  }

  const entry = currentEntry(active.history);
  if (!entry) {
    showSetup(false);
    return;
  }

  const settings = {
    totalAligners: active.totalAligners,
    rotationInterval: active.rotationInterval,
  };

  // Series subtitle in top bar
  const allSeries = loadSeries();
  document.getElementById('h-series-sub').textContent = allSeries.length > 1 ? active.name : '';

  // Aligner card
  document.getElementById('h-num').textContent = entry.alignerNumber;
  document.getElementById('h-fraction').textContent = `of ${active.totalAligners}`;

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
        ? 'Treatment period complete — nice work!'
        : `Treatment ends ${fmtDate(nrd)}`;

  // Rotate button
  const rotBtn = document.getElementById('btn-rotate');
  const isLast = entry.alignerNumber >= active.totalAligners;
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
  const allSeries = loadSeries();
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');

  const allEntries = [];
  allSeries.forEach((s) => {
    s.history.forEach((entry, idx) => {
      allEntries.push({
        entry,
        seriesId: s.id,
        seriesName: s.name,
        entryIdx: idx,
        totalAligners: s.totalAligners,
        seriesHistory: s.history,
      });
    });
  });

  if (!allEntries.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  allEntries.sort((a, b) => new Date(b.entry.startDate) - new Date(a.entry.startDate));

  const nowMs = Date.now();
  const activeId = loadActiveId();
  const showSeriesTag = allSeries.length > 1;

  list.innerHTML = allEntries
    .map(({ entry, seriesId, seriesName, entryIdx, totalAligners, seriesHistory }) => {
      const isLastInSeries = entryIdx === seriesHistory.length - 1;
      const isCurrent = isLastInSeries && seriesId === activeId;
      const nextInSeries = isLastInSeries ? null : seriesHistory[entryIdx + 1];
      const endMs = nextInSeries
        ? new Date(nextInSeries.startDate).getTime()
        : isCurrent
          ? nowMs
          : null;
      const durationMs = endMs !== null ? endMs - new Date(entry.startDate).getTime() : null;
      const durationStr = isCurrent
        ? 'current'
        : durationMs != null
          ? fmtDuration(durationMs)
          : '—';
      const seriesTagHtml = showSeriesTag
        ? ` <span class="history-series-tag">${escapeHtml(seriesName)}</span>`
        : '';

      return `
        <div class="history-item">
          <div class="history-badge${isCurrent ? ' current' : ''}">${escapeHtml(String(entry.alignerNumber))}</div>
          <div class="history-info">
            <div class="history-aligner">Aligner ${entry.alignerNumber} of ${totalAligners}${seriesTagHtml}</div>
            <div class="history-date">Started ${fmtDate(new Date(entry.startDate))}</div>
          </div>
          <div class="history-right">
            <div class="history-duration">${durationStr}</div>
            <button class="history-edit" data-series="${escapeHtml(seriesId)}" data-idx="${entryIdx}" aria-label="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  list.querySelectorAll('.history-edit').forEach((btn) => {
    btn.addEventListener('click', () =>
      openEditModal(btn.dataset.series, parseInt(btn.dataset.idx, 10))
    );
  });
}

// ─── Render: Settings ─────────────────────────────────────────────────────────

function renderSettings() {
  const series = loadSeries();
  const activeId = loadActiveId();
  const active = series.find((s) => s.id === activeId) || series[0];
  if (!active) return;

  // Active series form
  document.getElementById('s-name').value = active.name;
  document.getElementById('s-total').value = active.totalAligners;
  document.getElementById('s-interval').value = active.rotationInterval;

  // Series list
  const listEl = document.getElementById('series-list');
  listEl.innerHTML = series
    .map(
      (s) => `
    <div class="series-item${s.id === activeId ? ' series-active' : ''}">
      <div class="series-info">
        <div class="series-name">${escapeHtml(s.name)}</div>
        <div class="series-desc">${s.totalAligners} aligners · ${s.rotationInterval}-day rotation</div>
      </div>
      <div class="series-actions">
        ${
          s.id === activeId
            ? '<span class="series-tag">Active</span>'
            : `<button class="btn-sm" data-switch="${escapeHtml(s.id)}">Switch</button>`
        }
        ${
          series.length > 1
            ? `<button class="btn-icon series-del" data-del="${escapeHtml(s.id)}" aria-label="Delete ${escapeHtml(s.name)}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>`
            : ''
        }
      </div>
    </div>
  `
    )
    .join('');

  listEl.querySelectorAll('[data-switch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveActiveId(btn.dataset.switch);
      renderSettings();
      showToast('Switched series');
    });
  });

  listEl.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.del;
      const s = series.find((x) => x.id === id);
      if (!s || !confirm(`Delete "${s.name}"? This cannot be undone.`)) return;
      const updated = series.filter((x) => x.id !== id);
      saveSeries(updated);
      if (loadActiveId() === id) saveActiveId(updated[0]?.id || null);
      renderSettings();
      showToast(`Deleted "${s.name}"`);
    });
  });
}

// ─── Modal ────────────────────────────────────────────────────────────────────

let pendingRotation = null;
let editTarget = null;

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

function openEditModal(seriesId, entryIdx) {
  const series = loadSeries();
  const s = series.find((x) => x.id === seriesId);
  if (!s || !s.history[entryIdx]) return;

  const entry = s.history[entryIdx];
  editTarget = { seriesId, entryIdx };

  document.getElementById('modal-edit-title').textContent = `Edit Aligner ${entry.alignerNumber}`;
  document.getElementById('edit-num').value = entry.alignerNumber;
  document.getElementById('edit-num').max = s.totalAligners;

  const d = new Date(entry.startDate);
  document.getElementById('edit-date').value =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  document.getElementById('modal-edit').classList.remove('hidden');
  document.getElementById('edit-num').focus();
}

function closeEditModal() {
  editTarget = null;
  document.getElementById('modal-edit').classList.add('hidden');
}

// ─── Copy History ─────────────────────────────────────────────────────────────

function copyHistoryToClipboard() {
  const active = getActiveSeries();
  if (!active || !active.history.length) {
    showToast('No history to copy');
    return;
  }

  const lines = [`${active.name} — Rotation History`, '========================'];
  active.history.forEach((entry, i) => {
    const next = active.history[i + 1];
    const durationMs = next
      ? new Date(next.startDate).getTime() - new Date(entry.startDate).getTime()
      : null;
    const dur = durationMs != null ? `  (${fmtDuration(durationMs)})` : '  (current)';
    lines.push(
      `Aligner ${entry.alignerNumber} of ${active.totalAligners}: started ${fmtDate(new Date(entry.startDate))}${dur}`
    );
  });

  navigator.clipboard
    .writeText(lines.join('\n'))
    .then(() => showToast('Copied to clipboard'))
    .catch(() => showToast('Copy failed'));
}

// ─── Event Wiring ────────────────────────────────────────────────────────────

function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
  }

  migrate();

  // ── Setup form
  document.getElementById('form-setup').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('f-name').value.trim();
    const total = parseInt(document.getElementById('f-total').value, 10);
    const interval = parseInt(document.getElementById('f-interval').value, 10);
    const current = parseInt(document.getElementById('f-current').value, 10);
    const dateVal = document.getElementById('f-date').value;

    if (!name || !total || !interval || !current || !dateVal) return;
    if (current > total) {
      showToast('Current aligner cannot exceed total');
      return;
    }

    const startDate = new Date(`${dateVal}T12:00:00`).toISOString();
    const newSeries = {
      id: genId(),
      name,
      totalAligners: total,
      rotationInterval: interval,
      history: [{ alignerNumber: current, startDate }],
    };

    const all = loadSeries();
    all.push(newSeries);
    saveSeries(all);
    saveActiveId(newSeries.id);

    document.getElementById('bottom-nav').classList.remove('hidden');
    showView('home');
  });

  // ── Setup cancel
  document.getElementById('btn-setup-cancel').addEventListener('click', () => {
    showView('settings');
  });

  // ── Bottom nav
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.target));
  });

  // ── Rotate button
  document.getElementById('btn-rotate').addEventListener('click', () => {
    const active = getActiveSeries();
    if (!active) return;
    const entry = currentEntry(active.history);
    if (!entry) return;
    const nextNum = entry.alignerNumber + 1;
    if (nextNum > active.totalAligners) return;
    openModal(nextNum, active.totalAligners);
  });

  // ── Modal confirm
  document.getElementById('modal-confirm').addEventListener('click', () => {
    if (pendingRotation == null) return;
    const series = loadSeries();
    const idx = series.findIndex((s) => s.id === loadActiveId());
    if (idx === -1) return;
    series[idx].history.push({
      alignerNumber: pendingRotation,
      startDate: new Date().toISOString(),
    });
    saveSeries(series);
    const confirmedNum = pendingRotation;
    closeModal();
    renderHome();
    showToast(`Switched to aligner ${confirmedNum} 🎉`);
  });

  // ── Modal cancel / backdrop / Escape
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeEditModal();
    }
  });

  // ── Edit history entry
  document.getElementById('form-edit').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!editTarget) return;
    const num = parseInt(document.getElementById('edit-num').value, 10);
    const dateVal = document.getElementById('edit-date').value;
    if (!num || !dateVal) return;

    const series = loadSeries();
    const idx = series.findIndex((s) => s.id === editTarget.seriesId);
    if (idx === -1) return;
    series[idx].history[editTarget.entryIdx] = {
      alignerNumber: num,
      startDate: new Date(`${dateVal}T12:00:00`).toISOString(),
    };
    saveSeries(series);
    closeEditModal();
    renderHistory();
    if (activeView === 'home') renderHome();
    showToast('Entry updated');
  });

  document.getElementById('modal-edit-cancel').addEventListener('click', closeEditModal);
  document.getElementById('modal-edit-backdrop').addEventListener('click', closeEditModal);

  // ── Calendar button
  document.getElementById('btn-cal').addEventListener('click', () => {
    const active = getActiveSeries();
    if (!active) return;
    const entry = currentEntry(active.history);
    if (!entry) return;
    const settings = {
      totalAligners: active.totalAligners,
      rotationInterval: active.rotationInterval,
    };
    const rem = remainingAligners(entry, settings);
    if (rem === 0) {
      showToast('No more rotations to schedule');
      return;
    }
    const ics = generateICS(entry, settings);
    const slug = active.name.toLowerCase().replace(/\s+/g, '-');
    downloadFile(ics, `${slug}-rotations.ics`, 'text/calendar;charset=utf-8');
    showToast(`Downloaded ${rem} calendar event${rem > 1 ? 's' : ''}`);
  });

  // ── Copy history
  document.getElementById('btn-copy').addEventListener('click', copyHistoryToClipboard);

  // ── Settings: save active series
  document.getElementById('form-settings').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('s-name').value.trim();
    const total = parseInt(document.getElementById('s-total').value, 10);
    const interval = parseInt(document.getElementById('s-interval').value, 10);
    if (!name || !total || !interval) return;

    const series = loadSeries();
    const idx = series.findIndex((s) => s.id === loadActiveId());
    if (idx === -1) return;
    series[idx] = { ...series[idx], name, totalAligners: total, rotationInterval: interval };
    saveSeries(series);
    showToast('Settings saved');
    renderHome();
  });

  // ── Add new series
  document.getElementById('btn-add-series').addEventListener('click', () => showSetup(true));

  // ── Export
  document.getElementById('btn-export').addEventListener('click', exportData);

  // ── Import
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('input-import').click();
  });

  document.getElementById('input-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        if (!isValidImport(data)) throw new Error('invalid');
        const count = data.series.length;
        if (!confirm(`Import ${count} series? This will replace all current data.`)) return;
        saveSeries(data.series);
        saveActiveId(data.series[0].id);
        document.getElementById('bottom-nav').classList.remove('hidden');
        showView('home');
        showToast(`Imported ${count} series`);
      } catch {
        showToast('Import failed — invalid file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ── Reset
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm('Reset all data? This cannot be undone.')) return;
    localStorage.removeItem(STORAGE_SERIES);
    localStorage.removeItem(STORAGE_ACTIVE);
    document.getElementById('bottom-nav').classList.add('hidden');
    showSetup(false);
  });

  // ── Refresh on foreground / tick
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeView === 'home') renderHome();
  });
  setInterval(() => {
    if (!document.hidden && activeView === 'home') renderHome();
  }, 60_000);

  // ── Initial routing
  const active = getActiveSeries();
  if (!active || !active.history.length) {
    showSetup(false);
  } else {
    document.getElementById('bottom-nav').classList.remove('hidden');
    showView('home');
  }
}

document.addEventListener('DOMContentLoaded', init);
