// Лента мыслей.
import { I, MOOD_ICON } from '../icons.js';
import { get } from '../api.js';
import { esc, humanDate, hoursLabel, MOOD_COLOR } from '../state.js';
import { h, header } from '../ui.js';

export async function renderThoughts() {
  const app = document.getElementById('app');
  app.appendChild(header({ title: 'мысли', icon: 'cloud' }));
  const page = h('<div class="page"></div>');
  app.appendChild(page);
  const r = await get('/api/thoughts?limit=300');
  const counts = { sad: 0, neutral: 0, happy: 0 };
  for (const e of r.events) counts[e.mood || 'neutral']++;
  page.appendChild(h(`<div class="sum-head">${['happy', 'neutral', 'sad'].map((m) => `<span><i class="mood-dot" style="background:${MOOD_COLOR[m]}"></i><b>${counts[m]}</b></span>`).join('')}</div>`));
  const list = h('<div style="margin-top:2rem"></div>');
  for (const e of r.events) {
    const el = h(`<button class="thought"><div class="when"><span class="ico" style="width:1.8rem;height:1.8rem;color:${MOOD_COLOR[e.mood || 'neutral']}">${I[MOOD_ICON[e.mood || 'neutral']]}</span>${humanDate(e.day)} · ${hoursLabel(e.hours)}</div><div class="txt">${esc(e.text)}</div></button>`);
    el.onclick = () => { location.hash = `#/add?day=${e.day}&hours=${e.hours.join(',')}&edit=${e.id}&back=${encodeURIComponent('#/thoughts')}`; };
    list.appendChild(el);
  }
  if (!r.events.length) list.appendChild(h('<p class="p">мыслей пока нет — добавьте их из экрана дня (плюс → облачко)</p>'));
  page.appendChild(list);
}
