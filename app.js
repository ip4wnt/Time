'use strict';

/* =========================================================================
   ДАННЫЕ И ХРАНИЛИЩЕ (IndexedDB)
   Структура: база "TimeTrackerDB" -> store "years"
   Запись в сторе: { year: 2026, days: [ {...}, {...}, ... 365/366 штук ] }
   Каждый день: { doy: 1..366, hours: [24 x {color: 'green'|null, noteId: n|null}],
                  notes: { [noteId]: { text: '', hours: [h1,h2,...] } }, nextNoteId: 1 }
   ========================================================================= */

const DB_NAME = 'TimeTrackerDB';
const DB_VERSION = 1;
const STORE = 'years';

const COLORS = [
  { id: 'green', hex: '#7bd694', label: 'Зелёный', dark: false },
  { id: 'sleep', hex: '#1a1a1a', label: 'Сон', dark: true },
  { id: 'white', hex: '#f5f5f0', label: 'Белый', dark: false },
  { id: 'blue', hex: '#5b7fc4', label: 'Синий', dark: true },
  { id: 'purple', hex: '#3a1361', label: 'Фиолетовый', dark: true },
  { id: 'pink', hex: '#ef8fc0', label: 'Розовый', dark: false },
  { id: 'red', hex: '#c62c22', label: 'Красный', dark: true },
  { id: 'olive', hex: '#a5872e', label: 'Оливковый', dark: false },
];
const COLOR_MAP = Object.fromEntries(COLORS.map((c) => [c.id, c]));
const SLEEP_ID = 'sleep';

const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTH_NAMES_FULL = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];
const DOW_NAMES = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

/* ---------- IndexedDB helpers ---------- */

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB недоступен в этом браузере'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'year' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function dbGetYear(year) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(year);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function dbPutYear(yearRecord) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put(yearRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAllYears() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbClearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- Date helpers ---------- */

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInYear(y) {
  return isLeapYear(y) ? 366 : 365;
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / 86400000) + 1;
}

function dateFromDOY(year, doy) {
  const d = new Date(year, 0, 1);
  d.setDate(doy);
  return d;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function makeEmptyDay(doy) {
  return {
    doy,
    hours: Array.from({ length: 24 }, () => ({ color: null, noteId: null })),
    notes: {},
    nextNoteId: 1,
  };
}

function makeEmptyYear(year) {
  const n = daysInYear(year);
  return {
    year,
    days: Array.from({ length: n }, (_, i) => makeEmptyDay(i + 1)),
    plan: {
      days: Array.from({ length: n }, () => ({ color: null, noteId: null })),
      notes: {},
      nextNoteId: 1,
    },
  };
}

function ensurePlanShape(rec) {
  const n = daysInYear(rec.year);
  if (!rec.plan) {
    rec.plan = { days: Array.from({ length: n }, () => ({ color: null, noteId: null })), notes: {}, nextNoteId: 1 };
  }
  if (!Array.isArray(rec.plan.days)) rec.plan.days = [];
  if (rec.plan.days.length < n) {
    for (let i = rec.plan.days.length; i < n; i++) rec.plan.days.push({ color: null, noteId: null });
  }
  if (!rec.plan.notes) rec.plan.notes = {};
  if (!rec.plan.nextNoteId) rec.plan.nextNoteId = 1;
}

/* ---------- App state ---------- */

const state = {
  yearData: null, // currently loaded year record
  currentYear: new Date().getFullYear(),
  monthCursor: new Date().getMonth(), // month shown in month view
  monthCursorYear: new Date().getFullYear(),
  currentDOY: dayOfYear(new Date()), // day shown in day view
  currentDayYear: new Date().getFullYear(),
  selection: [], // array of hour indices currently selected (day view)
  monthMode: 'fact', // 'fact' | 'plan'
  planSelection: [], // array of doy currently selected in plan mode
};

async function ensureYearLoaded(year) {
  if (state.yearData && state.yearData.year === year) return state.yearData;
  let rec = await dbGetYear(year);
  if (!rec) {
    rec = makeEmptyYear(year);
    await dbPutYear(rec);
  }
  // migration safety: if day count mismatches (leap year edge), pad
  const expected = daysInYear(year);
  if (rec.days.length < expected) {
    for (let i = rec.days.length; i < expected; i++) {
      rec.days.push(makeEmptyDay(i + 1));
    }
  }
  ensurePlanShape(rec);
  state.yearData = rec;
  return rec;
}

async function saveCurrentYear() {
  if (state.yearData) {
    await dbPutYear(state.yearData);
  }
}

function getDay(year, doy) {
  if (!state.yearData || state.yearData.year !== year) return null;
  return state.yearData.days[doy - 1] || null;
}

/* =========================================================================
   РЕНДЕР: ПРЕДСТАВЛЕНИЕ "ДЕНЬ"
   ========================================================================= */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const screenMonth = $('#screen-month');
const screenDay = $('#screen-day');
const hourGrid = $('#hour-grid');
const dayNotesEl = $('#day-notes');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function renderDayHeader() {
  const date = dateFromDOY(state.currentDayYear, state.currentDOY);
  $('#day-num').textContent = date.getDate();
  $('#day-mon').textContent = MONTH_NAMES[date.getMonth()];
  $('#day-dow').textContent = DOW_NAMES[date.getDay()];
}

function cellShadeClass(colorId) {
  if (!colorId) return 'is-empty';
  const c = COLOR_MAP[colorId];
  return c.dark ? 'is-dark' : 'is-light';
}

async function renderDayGrid() {
  await ensureYearLoaded(state.currentDayYear);
  const day = getDay(state.currentDayYear, state.currentDOY) || makeEmptyDay(state.currentDOY);

  hourGrid.innerHTML = '';
  for (let h = 0; h < 24; h++) {
    const hourData = day.hours[h] || { color: null, noteId: null };
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'hour-cell ' + cellShadeClass(hourData.color);
    cell.dataset.hour = String(h);
    cell.setAttribute('aria-label', `${h}:00 — ${hourData.color ? COLOR_MAP[hourData.color].label : 'не отмечено'}`);
    if (hourData.color) {
      cell.style.background = COLOR_MAP[hourData.color].hex;
    }
    if (hourData.noteId != null) cell.classList.add('has-note');
    if (state.selection.includes(h)) cell.classList.add('is-selected');

    const label = document.createElement('span');
    label.className = 'hour-label';
    label.textContent = h;
    cell.appendChild(label);

    attachHourCellEvents(cell, h);
    hourGrid.appendChild(cell);
  }

  renderDayNotesSummary(day);
}

function renderDayNotesSummary(day) {
  const noteIds = Object.keys(day.notes || {});
  if (!noteIds.length) {
    dayNotesEl.innerHTML = '';
    dayNotesEl.classList.add('empty');
    dayNotesEl.textContent = 'Пока нет заметок. Нажмите на час, чтобы добавить.';
    return;
  }
  dayNotesEl.classList.remove('empty');

  // Sort notes by first hour they apply to
  const entries = noteIds
    .map((id) => day.notes[id])
    .filter((n) => n && n.text && n.text.trim() && n.hours && n.hours.length)
    .sort((a, b) => Math.min(...a.hours) - Math.min(...b.hours));

  if (!entries.length) {
    dayNotesEl.classList.add('empty');
    dayNotesEl.textContent = 'Пока нет заметок. Нажмите на час, чтобы добавить.';
    return;
  }

  dayNotesEl.innerHTML = entries
    .map((n) => {
      const hrs = [...n.hours].sort((a, b) => a - b);
      const rangeLabel = formatHourRangeLabel(hrs);
      return `<div class="note-entry"><span class="range">${rangeLabel}</span> ${escapeHTML(n.text.trim())}</div>`;
    })
    .join('');
}

function formatHourRangeLabel(sortedHours) {
  // Group consecutive runs for display, e.g. "13" or "18–21"
  const groups = [];
  let start = sortedHours[0];
  let prev = sortedHours[0];
  for (let i = 1; i <= sortedHours.length; i++) {
    const h = sortedHours[i];
    if (h === prev + 1) {
      prev = h;
      continue;
    }
    groups.push([start, prev]);
    start = h;
    prev = h;
  }
  return groups.map(([a, b]) => (a === b ? `${a}` : `${a}–${b + 1}`)).join(', ');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- Hour cell interaction (tap toggles selection) ---------- */

function attachHourCellEvents(cell, hourIndex) {
  cell.addEventListener('click', () => {
    toggleSelection(hourIndex);
    renderDayGrid();
    updateSelectionBar();
  });
}

function toggleSelection(hourIndex) {
  const idx = state.selection.indexOf(hourIndex);
  if (idx >= 0) {
    state.selection.splice(idx, 1);
  } else {
    state.selection.push(hourIndex);
  }
}

function updateSelectionBar() {
  const bar = $('#selection-bar');
  const hint = $('#day-hint');
  if (state.selection.length > 0) {
    bar.hidden = false;
    if (hint) hint.style.visibility = 'hidden';
    $('#selection-count').textContent = `Выбрано часов: ${state.selection.length}`;
  } else {
    bar.hidden = true;
    if (hint) hint.style.visibility = 'visible';
  }
}

function exitMultiSelect() {
  state.selection = [];
  updateSelectionBar();
  renderDayGrid();
}

$('#selection-cancel').addEventListener('click', exitMultiSelect);
$('#selection-confirm').addEventListener('click', () => {
  if (state.selection.length === 0) return;
  openHourSheet();
});

/* =========================================================================
   ЦВЕТОВАЯ ПАЛИТРА / ЛИСТ ВЫБОРА
   ========================================================================= */

const sheetOverlay = $('#sheet-overlay');
const sheetSubtitle = $('#sheet-subtitle');
const paletteGrid = $('#palette-grid');
const noteField = $('#note-field');

let pendingColorId = null; // color chosen in current sheet session (before save)

function buildPaletteGrid() {
  paletteGrid.innerHTML = '';
  COLORS.forEach((c) => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'palette-swatch' + (c.dark ? ' is-dark' : '');
    sw.style.background = c.hex;
    sw.dataset.color = c.id;
    sw.setAttribute('aria-label', c.label);
    sw.innerHTML = `<span class="check"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`;
    sw.addEventListener('click', () => {
      pendingColorId = pendingColorId === c.id ? null : c.id;
      updatePaletteActiveState();
    });
    paletteGrid.appendChild(sw);
  });

  const clearSw = document.createElement('button');
  clearSw.type = 'button';
  clearSw.className = 'palette-swatch clear-swatch';
  clearSw.dataset.color = '';
  clearSw.textContent = 'Очистить';
  clearSw.addEventListener('click', () => {
    pendingColorId = null;
    updatePaletteActiveState();
  });
  paletteGrid.appendChild(clearSw);
}

function updatePaletteActiveState() {
  $$('.palette-swatch').forEach((sw) => {
    const isActive = sw.dataset.color === (pendingColorId || '');
    sw.classList.toggle('is-active', isActive && sw.dataset.color !== '');
  });
}

let sheetTarget = 'hour'; // 'hour' | 'plan'
const sheetTitleText = $('#sheet-title-text');

function openHourSheet() {
  sheetTarget = 'hour';
  const day = getDay(state.currentDayYear, state.currentDOY);
  const hrs = [...state.selection].sort((a, b) => a - b);

  sheetTitleText.textContent = 'Час';
  sheetSubtitle.textContent =
    hrs.length === 1 ? `${hrs[0]}:00 – ${hrs[0] + 1}:00` : `${formatHourRangeLabel(hrs)} ч`;

  // Determine current color if uniform across selection, and existing note text if shared
  const colorsInSel = new Set(hrs.map((h) => day.hours[h].color));
  pendingColorId = colorsInSel.size === 1 ? [...colorsInSel][0] : null;
  updatePaletteActiveState();

  // If all selected hours share the exact same noteId, prefill text
  const noteIds = new Set(hrs.map((h) => day.hours[h].noteId));
  if (noteIds.size === 1 && [...noteIds][0] != null) {
    const note = day.notes[[...noteIds][0]];
    noteField.value = note ? note.text : '';
  } else {
    noteField.value = '';
  }

  sheetOverlay.classList.add('is-open');
}

function closeSheet() {
  sheetOverlay.classList.remove('is-open');
  if (sheetTarget === 'plan') {
    state.planSelection = [];
    updatePlanSelectionBar();
    renderMonthView();
  } else {
    state.selection = [];
    updateSelectionBar();
    renderDayGrid();
  }
}

async function saveSheet() {
  if (sheetTarget === 'plan') {
    await savePlanSheet();
    return;
  }
  const day = getDay(state.currentDayYear, state.currentDOY);
  const hrs = [...state.selection].sort((a, b) => a - b);
  const text = noteField.value.trim();

  // Remove these hours from any note groups they previously belonged to
  hrs.forEach((h) => {
    const oldNoteId = day.hours[h].noteId;
    if (oldNoteId != null && day.notes[oldNoteId]) {
      day.notes[oldNoteId].hours = day.notes[oldNoteId].hours.filter((x) => x !== h);
      if (day.notes[oldNoteId].hours.length === 0) delete day.notes[oldNoteId];
    }
  });

  if (pendingColorId === null) {
    // Clearing color entirely
    hrs.forEach((h) => {
      day.hours[h].color = null;
      day.hours[h].noteId = null;
    });
  } else {
    let noteId = null;
    if (text) {
      noteId = day.nextNoteId++;
      day.notes[noteId] = { text, hours: [...hrs] };
    }
    hrs.forEach((h) => {
      day.hours[h].color = pendingColorId;
      day.hours[h].noteId = noteId;
    });
  }

  await saveCurrentYear();
  closeSheet();
  showToast('Сохранено');
}

$('#sheet-cancel').addEventListener('click', closeSheet);
$('#sheet-save').addEventListener('click', saveSheet);
sheetOverlay.addEventListener('click', (e) => {
  if (e.target === sheetOverlay) closeSheet();
});

/* =========================================================================
   ПРЕДСТАВЛЕНИЕ "МЕСЯЦ"
   ========================================================================= */

const monthTitle = $('#month-title');
const monthYearEl = $('#month-year');
const monthGrid = $('#month-grid');
const monthNotesEl = $('#month-notes');
const modePlanBtn = $('#mode-plan-btn');
const modeFactBtn = $('#mode-fact-btn');
const planSelectionBar = $('#plan-selection-bar');
const planSelectionCount = $('#plan-selection-count');

function computeDayColor(day) {
  // Count colored hours per color, ignoring sleep, ignoring empty
  const counts = {};
  for (let h = 0; h < 24; h++) {
    const c = day.hours[h].color;
    if (!c || c === SLEEP_ID) continue;
    counts[c] = (counts[c] || 0) + 1;
  }
  let best = null;
  let bestCount = 0;
  for (const [c, n] of Object.entries(counts)) {
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best; // null if no non-sleep colored hours
}

function findLongRunsForMonth(day) {
  // Find runs of >3 consecutive hours of the same color (excluding sleep),
  // and collect associated note texts (deduped by noteId) for that run.
  const runs = [];
  let h = 0;
  while (h < 24) {
    const color = day.hours[h].color;
    if (!color || color === SLEEP_ID) {
      h++;
      continue;
    }
    let end = h;
    while (end + 1 < 24 && day.hours[end + 1].color === color) end++;
    const length = end - h + 1;
    if (length > 3) {
      runs.push({ start: h, end, color });
    }
    h = end + 1;
  }

  // Collect distinct note texts touched by these runs
  const seenNoteIds = new Set();
  const texts = [];
  runs.forEach((run) => {
    for (let h2 = run.start; h2 <= run.end; h2++) {
      const noteId = day.hours[h2].noteId;
      if (noteId != null && !seenNoteIds.has(noteId)) {
        seenNoteIds.add(noteId);
        const note = day.notes[noteId];
        if (note && note.text && note.text.trim()) {
          texts.push(note.text.trim());
        }
      }
    }
  });
  return texts;
}

async function renderMonthView() {
  const year = state.monthCursorYear;
  const month = state.monthCursor;
  const rec = await ensureYearLoaded(year);

  monthTitle.textContent = MONTH_NAMES[month];
  monthYearEl.textContent = String(year % 100).padStart(2, '0');

  const firstOfMonth = new Date(year, month, 1);
  // JS getDay(): 0=Sun..6=Sat. We want Monday-first index: 0=Mon..6=Sun
  const jsDow = firstOfMonth.getDay();
  const mondayFirstOffset = (jsDow + 6) % 7;
  const totalDays = daysInMonth(year, month);

  monthGrid.innerHTML = '';

  // Leading days from previous month (shown, muted, non-interactive but numbered like mockup)
  const prevMonthDays = daysInMonth(year, month === 0 ? 11 : month - 1);
  for (let i = 0; i < mondayFirstOffset; i++) {
    const dayNum = prevMonthDays - mondayFirstOffset + i + 1;
    const cell = document.createElement('div');
    cell.className = 'month-cell is-empty';
    cell.textContent = dayNum;
    cell.style.opacity = '0.35';
    monthGrid.appendChild(cell);
  }

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const monthNoteBlocks = [];
  const isPlan = state.monthMode === 'plan';

  for (let d = 1; d <= totalDays; d++) {
    const dateObj = new Date(year, month, d);
    const doy = dayOfYear(dateObj);
    const day = getDay(year, doy) || makeEmptyDay(doy);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.textContent = d;
    cell.dataset.doy = String(doy);

    if (isPlan) {
      const planEntry = rec.plan.days[doy - 1] || { color: null, noteId: null };
      const colorId = planEntry.color;
      cell.className = 'month-cell ' + (colorId ? cellShadeClass(colorId) : 'is-empty');
      if (colorId) cell.style.background = COLOR_MAP[colorId].hex;
      if (isCurrentMonth && d === today.getDate()) cell.classList.add('is-today');
      if (state.planSelection.includes(doy)) cell.classList.add('is-selected');
      cell.addEventListener('click', () => togglePlanSelection(doy));
    } else {
      const colorId = computeDayColor(day);
      cell.className = 'month-cell ' + (colorId ? cellShadeClass(colorId) : 'is-empty');
      if (colorId) cell.style.background = COLOR_MAP[colorId].hex;
      if (isCurrentMonth && d === today.getDate()) cell.classList.add('is-today');
      cell.addEventListener('click', () => openDayFromMonth(year, doy));

      const texts = findLongRunsForMonth(day);
      if (texts.length) {
        monthNoteBlocks.push({ label: String(d), texts });
      }
    }

    monthGrid.appendChild(cell);
  }

  // Trailing days from next month to fill final row
  const totalCells = mondayFirstOffset + totalDays;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    const cell = document.createElement('div');
    cell.className = 'month-cell is-empty';
    cell.textContent = i;
    cell.style.opacity = '0.35';
    monthGrid.appendChild(cell);
  }

  const finalBlocks = isPlan ? computePlanNoteBlocks(rec, year, month, totalDays) : monthNoteBlocks;
  renderMonthNotes(finalBlocks, isPlan);
  updatePlanSelectionBar();
}

function formatDayRangeLabel(sortedDaysOfMonth) {
  // Group consecutive days for display, e.g. "13" or "18-21"
  const groups = [];
  let start = sortedDaysOfMonth[0];
  let prev = sortedDaysOfMonth[0];
  for (let i = 1; i <= sortedDaysOfMonth.length; i++) {
    const d = sortedDaysOfMonth[i];
    if (d === prev + 1) {
      prev = d;
      continue;
    }
    groups.push([start, prev]);
    start = d;
    prev = d;
  }
  return groups.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
}

function computePlanNoteBlocks(rec, year, month, totalDays) {
  // Determine the doy range covered by this displayed month
  const firstDOY = dayOfYear(new Date(year, month, 1));
  const lastDOY = dayOfYear(new Date(year, month, totalDays));

  const blocks = [];
  Object.entries(rec.plan.notes).forEach(([noteId, note]) => {
    if (!note || !note.text || !note.text.trim()) return;
    const daysInThisMonth = (note.days || [])
      .filter((doy) => doy >= firstDOY && doy <= lastDOY)
      .map((doy) => dateFromDOY(year, doy).getDate())
      .sort((a, b) => a - b);
    if (!daysInThisMonth.length) return;
    blocks.push({
      label: formatDayRangeLabel(daysInThisMonth),
      texts: [note.text.trim()],
      firstDay: daysInThisMonth[0],
    });
  });

  blocks.sort((a, b) => a.firstDay - b.firstDay);
  return blocks;
}

function renderMonthNotes(blocks, isPlan) {
  if (!blocks.length) {
    monthNotesEl.classList.add('empty');
    monthNotesEl.textContent = isPlan
      ? 'В этом месяце нет запланированных дней.'
      : 'Нет продолжительных занятий (>3ч подряд) в этом месяце.';
    return;
  }
  monthNotesEl.classList.remove('empty');
  monthNotesEl.innerHTML = blocks
    .map(
      (b) =>
        `<div class="day-block"><span class="day-num">${b.label}</span>${b.texts.map(escapeHTML).join(' · ')}</div>`
    )
    .join('');
}

function openDayFromMonth(year, doy) {
  state.currentDayYear = year;
  state.currentDOY = doy;
  showScreen('day');
}

/* ---------- Plan mode: day selection ---------- */

function togglePlanSelection(doy) {
  const idx = state.planSelection.indexOf(doy);
  if (idx >= 0) {
    state.planSelection.splice(idx, 1);
  } else {
    state.planSelection.push(doy);
  }
  renderMonthView();
}

function updatePlanSelectionBar() {
  if (state.monthMode === 'plan' && state.planSelection.length > 0) {
    planSelectionBar.hidden = false;
    planSelectionCount.textContent = `Выбрано дней: ${state.planSelection.length}`;
  } else {
    planSelectionBar.hidden = true;
  }
}

function exitPlanSelection() {
  state.planSelection = [];
  updatePlanSelectionBar();
  renderMonthView();
}

$('#plan-selection-cancel').addEventListener('click', exitPlanSelection);
$('#plan-selection-confirm').addEventListener('click', () => {
  if (state.planSelection.length === 0) return;
  openPlanSheet();
});

async function openPlanSheet() {
  sheetTarget = 'plan';
  const rec = await ensureYearLoaded(state.monthCursorYear);
  const doys = [...state.planSelection].sort((a, b) => a - b);

  sheetTitleText.textContent = 'План';
  sheetSubtitle.textContent =
    doys.length === 1
      ? formatPlanDayLabel(doys[0])
      : `${doys.length} дней`;

  const colorsInSel = new Set(doys.map((doy) => rec.plan.days[doy - 1].color));
  pendingColorId = colorsInSel.size === 1 ? [...colorsInSel][0] : null;
  updatePaletteActiveState();

  const noteIds = new Set(doys.map((doy) => rec.plan.days[doy - 1].noteId));
  if (noteIds.size === 1 && [...noteIds][0] != null) {
    const note = rec.plan.notes[[...noteIds][0]];
    noteField.value = note ? note.text : '';
  } else {
    noteField.value = '';
  }

  sheetOverlay.classList.add('is-open');
}

function formatPlanDayLabel(doy) {
  const year = state.monthCursorYear;
  const dateObj = dateFromDOY(year, doy);
  return `${dateObj.getDate()} ${MONTH_NAMES[dateObj.getMonth()]}`;
}

async function savePlanSheet() {
  const rec = await ensureYearLoaded(state.monthCursorYear);
  const doys = [...state.planSelection].sort((a, b) => a - b);
  const text = noteField.value.trim();

  // Remove these days from any note groups they previously belonged to
  doys.forEach((doy) => {
    const entry = rec.plan.days[doy - 1];
    const oldNoteId = entry.noteId;
    if (oldNoteId != null && rec.plan.notes[oldNoteId]) {
      rec.plan.notes[oldNoteId].days = rec.plan.notes[oldNoteId].days.filter((x) => x !== doy);
      if (rec.plan.notes[oldNoteId].days.length === 0) delete rec.plan.notes[oldNoteId];
    }
  });

  if (pendingColorId === null) {
    doys.forEach((doy) => {
      rec.plan.days[doy - 1].color = null;
      rec.plan.days[doy - 1].noteId = null;
    });
  } else {
    let noteId = null;
    if (text) {
      noteId = rec.plan.nextNoteId++;
      rec.plan.notes[noteId] = { text, days: [...doys] };
    }
    doys.forEach((doy) => {
      rec.plan.days[doy - 1].color = pendingColorId;
      rec.plan.days[doy - 1].noteId = noteId;
    });
  }

  await saveCurrentYear();
  closeSheet();
  showToast('Сохранено');
}

modePlanBtn.addEventListener('click', () => {
  if (state.monthMode === 'plan') return;
  state.monthMode = 'plan';
  state.planSelection = [];
  modePlanBtn.classList.add('is-active');
  modeFactBtn.classList.remove('is-active');
  renderMonthView();
});

modeFactBtn.addEventListener('click', () => {
  if (state.monthMode === 'fact') return;
  state.monthMode = 'fact';
  state.planSelection = [];
  modeFactBtn.classList.add('is-active');
  modePlanBtn.classList.remove('is-active');
  renderMonthView();
});

$('#month-prev').addEventListener('click', () => {
  state.monthCursor--;
  if (state.monthCursor < 0) {
    state.monthCursor = 11;
    state.monthCursorYear--;
  }
  renderMonthView();
});

$('#month-next').addEventListener('click', () => {
  state.monthCursor++;
  if (state.monthCursor > 11) {
    state.monthCursor = 0;
    state.monthCursorYear++;
  }
  renderMonthView();
});

/* =========================================================================
   НАВИГАЦИЯ МЕЖДУ ЭКРАНАМИ (день / месяц)
   ========================================================================= */

function showScreen(name) {
  if (name === 'day') {
    screenMonth.hidden = true;
    screenDay.hidden = false;
    state.selection = [];
    updateSelectionBar();
    renderDayHeader();
    renderDayGrid();
  } else {
    screenDay.hidden = true;
    screenMonth.hidden = false;
    // Sync month cursor to whichever day we came from
    const date = dateFromDOY(state.currentDayYear, state.currentDOY);
    state.monthCursor = date.getMonth();
    state.monthCursorYear = date.getFullYear();
    renderMonthView();
  }
}

$('#day-prev').addEventListener('click', () => shiftDay(-1));
$('#day-next').addEventListener('click', () => shiftDay(1));
$('#day-title-btn').addEventListener('click', () => showScreen('month'));

async function shiftDay(delta) {
  let doy = state.currentDOY + delta;
  let year = state.currentDayYear;
  const max = daysInYear(year);
  if (doy < 1) {
    year -= 1;
    await ensureYearLoaded(year);
    doy = daysInYear(year);
  } else if (doy > max) {
    year += 1;
    doy = 1;
  }
  state.currentDayYear = year;
  state.currentDOY = doy;
  await ensureYearLoaded(year);
  renderDayHeader();
  renderDayGrid();
}

/* Swipe gesture: swipe right on day screen -> go to month view */
(function setupSwipe() {
  let touchStartX = null;
  let touchStartY = null;

  screenDay.addEventListener(
    'touchstart',
    (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    },
    { passive: true }
  );

  screenDay.addEventListener(
    'touchend',
    (e) => {
      if (touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      const sheetOpen = sheetOverlay.classList.contains('is-open');
      if (dx > 80 && Math.abs(dy) < 60 && state.selection.length === 0 && !sheetOpen) {
        showScreen('month');
      }
      touchStartX = null;
      touchStartY = null;
    },
    { passive: true }
  );
})();

/* =========================================================================
   ЭКСПОРТ / ИМПОРТ JSON
   ========================================================================= */

async function exportAllData() {
  const years = await dbGetAllYears();
  const exportObj = {
    appName: 'Трекер времени',
    exportedAt: new Date().toISOString(),
    version: 1,
    years,
  };
  const json = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `time-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Файл сохранён');
}

async function importAllData(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.years)) {
      throw new Error('Файл повреждён или имеет неверный формат');
    }
    await dbClearAll();
    for (const yearRec of parsed.years) {
      if (yearRec && typeof yearRec.year === 'number' && Array.isArray(yearRec.days)) {
        await dbPutYear(yearRec);
      }
    }
    state.yearData = null; // force reload
    await ensureYearLoaded(state.monthCursorYear);
    renderMonthView();
    showToast('Данные восстановлены');
  } catch (err) {
    console.error(err);
    showToast('Ошибка импорта: ' + err.message);
  }
}

$('#btn-export').addEventListener('click', exportAllData);
$('#btn-import').addEventListener('click', () => $('#import-input').click());
$('#import-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) importAllData(file);
  e.target.value = '';
});

/* =========================================================================
   TOAST
   ========================================================================= */

let toastTimer = null;
function showToast(msg) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.add('is-open');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-open'), 2200);
}

/* =========================================================================
   ИНИЦИАЛИЗАЦИЯ
   ========================================================================= */

async function init() {
  buildPaletteGrid();
  try {
    await ensureYearLoaded(state.monthCursorYear);
  } catch (err) {
    console.error('Не удалось открыть базу данных:', err);
    showToast('Хранилище недоступно: ' + err.message);
  }
  renderMonthView();
}

init();
