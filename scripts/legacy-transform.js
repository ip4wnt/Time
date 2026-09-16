'use strict';
// Разбор выгрузки старого трекера (time-tracker-backup-*.json) в плоский список событий
// новой модели. Используется и локальным импортом (import-legacy.js), и импортом
// через API на удалённый сервер (import-remote.js).

// цвет старой версии → занятие в новой
const COLOR_TO_ACTIVITY = {
  green: { name: 'работа', color: '#73D383' },
  sleep: { name: 'сон', color: '#262626', is_sleep: true },
  blue: { name: 'учеба', color: '#476FAF' },
  purple: { name: 'семья', color: '#51006C' },
  pink: { name: 'развлечения', color: '#FF81BC' },
  red: { name: 'спорт', color: '#B71506' },
  olive: { name: 'рутина', color: '#AA952E' },
  white: { name: 'прочее', color: '#DEDEDE' },
};

function doyToDate(year, doy) {
  return new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);
}

// [1,2,3,7,8] → [[1,2,3],[7,8]]
function runs(hours) {
  const out = [];
  for (const h of [...hours].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && last[last.length - 1] === h - 1) last.push(h); else out.push([h]);
  }
  return out;
}

// → { events: [{kind, day, hours?, days?, position, colorKey, text}], colors: Set, stats }
function parseLegacy(data) {
  const events = [];
  const colors = new Set();
  const stats = { activityEvents: 0, withText: 0, tasks: 0, hours: 0 };

  const push = (ev) => { events.push(ev); colors.add(ev.colorKey); };

  for (const y of data.years || []) {
    const year = Number(y.year);
    for (const day of y.days || []) {
      const hours = day.hours || [];
      if (!hours.some((h) => h && h.color)) continue;
      const date = doyToDate(year, day.doy);
      const used = new Set();
      // 1) часы с заметками → одно событие на заметку
      for (const [, note] of Object.entries(day.notes || {})) {
        const hs = (note.hours || []).filter((h) => hours[h] && hours[h].color);
        if (!hs.length) continue;
        const cnt = {};
        for (const h of hs) cnt[hours[h].color] = (cnt[hours[h].color] || 0) + 1;
        const color = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
        push({ kind: 'activity', day: date, hours: hs.sort((a, b) => a - b), colorKey: color, text: note.text || '', position: 0 });
        hs.forEach((h) => used.add(h));
        stats.activityEvents++; stats.withText++; stats.hours += hs.length;
      }
      // 2) остальные закрашенные часы → отрезки одного цвета
      const byColor = {};
      hours.forEach((h, i) => { if (h && h.color && !used.has(i)) (byColor[h.color] = byColor[h.color] || []).push(i); });
      for (const [color, hs] of Object.entries(byColor)) {
        for (const run of runs(hs)) {
          push({ kind: 'activity', day: date, hours: run, colorKey: color, text: '', position: 0 });
          stats.activityEvents++; stats.hours += run.length;
        }
      }
    }
    // план → задачи
    const plan = y.plan || {};
    for (const [nid, note] of Object.entries(plan.notes || {})) {
      const days = (note.days || []).map((d) => doyToDate(year, d));
      if (!days.length) continue;
      const cell = (plan.days || [])[note.days[0] - 1];
      push({ kind: 'task', day: days[0], days: [...new Set(days)].sort(), colorKey: cell && cell.color ? cell.color : null, text: note.text || '', position: Number(nid) || 0 });
      stats.tasks++;
    }
  }
  colors.delete(null);
  for (const c of colors) if (!COLOR_TO_ACTIVITY[c]) throw new Error(`Неизвестный цвет в выгрузке: ${c}`);
  return { events, colors: [...colors], stats };
}

module.exports = { COLOR_TO_ACTIVITY, parseLegacy, doyToDate, runs };
