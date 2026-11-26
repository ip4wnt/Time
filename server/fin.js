'use strict';
// Финансы: бюджеты (год или отдельный), дерево статей, фактические операции.
// Раздел (section) → подраздел (divider; пустой title — просто черта) → статья (item).
// Все запросы фильтруются по user_id; таблицы закрыты RLS (см. sql/schema.sql).
const { HttpError } = require('./http');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const PARENT_TYPES = { item: [null, 'section', 'divider'], divider: [null, 'section'], section: [null] };

function fmtNode(n) { n.plan = Number(n.plan); return n; }
function fmtTx(t) { t.amount = Number(t.amount); if (t.day instanceof Date) t.day = t.day.toISOString().slice(0, 10); return t; }

function register(router, { int, str, isDate, tx }) {
  const own = async (q, user, id) => {
    const r = await q.query('SELECT id, kind, year, name FROM fin_budgets WHERE id=$1 AND user_id=$2', [id, user.id]);
    if (!r.rowCount) throw new HttpError(404, 'Бюджет не найден');
    return r.rows[0];
  };
  const ownNode = async (q, user, id) => {
    const r = await q.query('SELECT * FROM fin_nodes WHERE id=$1 AND user_id=$2', [id, user.id]);
    if (!r.rowCount) throw new HttpError(404, 'Элемент не найден');
    return r.rows[0];
  };
  async function payload(q, user, budget) {
    const [nodes, txs] = await Promise.all([
      q.query('SELECT id, side, parent_id, type, title, plan, position, collapsed FROM fin_nodes WHERE budget_id=$1 AND user_id=$2 ORDER BY position, id', [budget.id, user.id]),
      q.query('SELECT id, node_id, amount, note, day, event_id FROM fin_tx WHERE budget_id=$1 AND user_id=$2 ORDER BY day, id', [budget.id, user.id]),
    ]);
    return { budget, nodes: nodes.rows.map(fmtNode), tx: txs.rows.map(fmtTx) };
  }

  router.add('GET', '/api/fin/budgets', async ({ q, user }) => {
    const r = await q.query("SELECT id, kind, year, name FROM fin_budgets WHERE user_id=$1 ORDER BY kind, year, name, id", [user.id]);
    return { budgets: r.rows };
  });

  // бюджет года: создаётся при первом открытии
  router.add('GET', '/api/fin/budget', async ({ q, user, query }) => {
    let b;
    if (query.id) b = await own(q, user, int(query.id));
    else {
      const year = int(query.year, 'Нужен год');
      if (year < 1970 || year > 2200) throw new HttpError(400, 'Неверный год');
      const r = await q.query("SELECT id, kind, year, name FROM fin_budgets WHERE user_id=$1 AND kind='year' AND year=$2", [user.id, year]);
      b = r.rows[0];
      if (!b) b = (await q.query("INSERT INTO fin_budgets(user_id, kind, year, name) VALUES ($1,'year',$2,$3) ON CONFLICT DO NOTHING RETURNING id, kind, year, name", [user.id, year, String(year)])).rows[0]
        || (await q.query("SELECT id, kind, year, name FROM fin_budgets WHERE user_id=$1 AND kind='year' AND year=$2", [user.id, year])).rows[0];
    }
    return payload(q, user, b);
  });

  router.add('POST', '/api/fin/budgets', async ({ q, user, body }) => {
    const name = str(body.name, 100).trim();
    if (!name) throw new HttpError(400, 'Нужно название бюджета');
    const r = await q.query("INSERT INTO fin_budgets(user_id, kind, name) VALUES ($1,'custom',$2) RETURNING id, kind, year, name", [user.id, name]);
    return r.rows[0];
  });
  router.add('PUT', '/api/fin/budgets/:id', async ({ q, user, body, params }) => {
    const b = await own(q, user, int(params.id));
    if (b.kind !== 'custom') throw new HttpError(400, 'Бюджет года переименовать нельзя');
    const name = str(body.name, 100).trim();
    if (!name) throw new HttpError(400, 'Нужно название бюджета');
    const r = await q.query('UPDATE fin_budgets SET name=$1 WHERE id=$2 AND user_id=$3 RETURNING id, kind, year, name', [name, b.id, user.id]);
    return r.rows[0];
  });
  router.add('DELETE', '/api/fin/budgets/:id', async ({ q, user, params }) => {
    const b = await own(q, user, int(params.id));
    if (b.kind !== 'custom') throw new HttpError(400, 'Бюджет года удалить нельзя');
    await q.query('DELETE FROM fin_budgets WHERE id=$1 AND user_id=$2', [b.id, user.id]);
    return { ok: true };
  });

  // статьи для выбора в трекере: бюджет года события и отдельные бюджеты
  router.add('GET', '/api/fin/picker', async ({ q, user, query }) => {
    const year = Number(query.year) || new Date().getFullYear();
    const bs = await q.query("SELECT id, kind, year, name FROM fin_budgets WHERE user_id=$1 AND (kind='custom' OR year=$2) ORDER BY kind DESC, name, id", [user.id, year]);
    const ns = await q.query('SELECT id, budget_id, side, parent_id, type, title FROM fin_nodes WHERE user_id=$1 AND budget_id = ANY($2::bigint[]) ORDER BY position, id', [user.id, bs.rows.map((b) => b.id)]);
    const byId = new Map(ns.rows.map((n) => [n.id, n]));
    const out = bs.rows.map((b) => ({ ...b, items: [] }));
    for (const n of ns.rows) {
      if (n.type !== 'item') continue;
      const path = [];
      for (let p = byId.get(n.parent_id); p; p = byId.get(p.parent_id)) if (p.title) path.unshift(p.title);
      out.find((b) => b.id === n.budget_id).items.push({ id: n.id, side: n.side, title: n.title, path: path.join(' / ') });
    }
    return { budgets: out };
  });

  // ----- узлы -----
  async function renumber(q, user, ids) {
    for (let i = 0; i < ids.length; i++) await q.query('UPDATE fin_nodes SET position=$1 WHERE id=$2 AND user_id=$3', [i, ids[i], user.id]);
  }
  async function checkParent(q, user, { type, side, budget_id, parent_id }) {
    if (parent_id == null) { if (!PARENT_TYPES[type].includes(null)) throw new HttpError(400, 'Сюда это перенести нельзя'); return; }
    const p = await ownNode(q, user, parent_id);
    if (p.budget_id !== budget_id || p.side !== side) throw new HttpError(400, 'Родитель из другой части бюджета');
    if (!PARENT_TYPES[type].includes(p.type)) throw new HttpError(400, 'Сюда это перенести нельзя');
  }

  router.add('POST', '/api/fin/nodes', async ({ q, user, body }) => {
    const b = await own(q, user, int(body.budget_id));
    const type = body.type;
    if (!PARENT_TYPES[type]) throw new HttpError(400, 'Неизвестный тип');
    const side = body.side === 'income' ? 'income' : 'expense';
    const parent_id = body.parent_id != null ? int(body.parent_id) : null;
    await checkParent(q, user, { type, side, budget_id: b.id, parent_id });
    const title = str(body.title, 200).trim();
    if (type !== 'divider' && !title) throw new HttpError(400, type === 'item' ? 'Нужно название статьи' : 'Нужно название');
    const plan = type === 'item' && body.plan != null && body.plan !== '' ? num(body.plan) : 0;
    if (Number.isNaN(plan) || plan < 0) throw new HttpError(400, 'Неверная сумма');
    const pos = await q.query('SELECT coalesce(max(position),-1)+1 p FROM fin_nodes WHERE budget_id=$1 AND user_id=$2 AND side=$3 AND parent_id IS NOT DISTINCT FROM $4', [b.id, user.id, side, parent_id]);
    const r = await q.query('INSERT INTO fin_nodes(user_id, budget_id, side, parent_id, type, title, plan, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, side, parent_id, type, title, plan, position, collapsed',
      [user.id, b.id, side, parent_id, type, title, plan, pos.rows[0].p]);
    return fmtNode(r.rows[0]);
  });

  router.add('PUT', '/api/fin/nodes/:id', async ({ q, user, body, params }) => {
    const n = await ownNode(q, user, int(params.id));
    let title = n.title, plan = Number(n.plan), collapsed = n.collapsed;
    if (body.title != null) { title = str(body.title, 200).trim(); if (n.type !== 'divider' && !title) throw new HttpError(400, 'Нужно название'); }
    if (body.plan != null && n.type === 'item') { plan = num(body.plan); if (Number.isNaN(plan) || plan < 0) throw new HttpError(400, 'Неверная сумма'); }
    if (body.collapsed != null) collapsed = !!body.collapsed;
    const r = await q.query('UPDATE fin_nodes SET title=$1, plan=$2, collapsed=$3 WHERE id=$4 AND user_id=$5 RETURNING id, side, parent_id, type, title, plan, position, collapsed', [title, plan, collapsed, n.id, user.id]);
    return fmtNode(r.rows[0]);
  });

  // удаление уносит потомков и операции (ON DELETE CASCADE)
  router.add('DELETE', '/api/fin/nodes/:id', async ({ q, user, params }) => {
    const n = await ownNode(q, user, int(params.id));
    await q.query('DELETE FROM fin_nodes WHERE id=$1 AND user_id=$2', [n.id, user.id]);
    return { ok: true };
  });

  // перенос: новый родитель и место (before_id — перед каким соседом; null — в конец)
  router.add('PUT', '/api/fin/move', async ({ q, user, body }) => {
    return tx(q, async (c) => {
      const n = await ownNode(c, user, int(body.id));
      const parent_id = body.parent_id != null ? int(body.parent_id) : null;
      await checkParent(c, user, { type: n.type, side: n.side, budget_id: n.budget_id, parent_id });
      if (parent_id != null) { // нельзя в самого себя и в потомка
        for (let p = parent_id; p != null;) {
          if (p === n.id) throw new HttpError(400, 'Нельзя перенести внутрь самого себя');
          p = (await c.query('SELECT parent_id FROM fin_nodes WHERE id=$1 AND user_id=$2', [p, user.id])).rows[0]?.parent_id ?? null;
        }
      }
      const sib = await c.query('SELECT id FROM fin_nodes WHERE budget_id=$1 AND user_id=$2 AND side=$3 AND parent_id IS NOT DISTINCT FROM $4 AND id<>$5 ORDER BY position, id', [n.budget_id, user.id, n.side, parent_id, n.id]);
      const ids = sib.rows.map((r) => r.id);
      const at = body.before_id != null ? ids.indexOf(int(body.before_id)) : -1;
      if (at < 0) ids.push(n.id); else ids.splice(at, 0, n.id);
      await c.query('UPDATE fin_nodes SET parent_id=$1 WHERE id=$2 AND user_id=$3', [parent_id, n.id, user.id]);
      await renumber(c, user, ids);
      return { ok: true };
    });
  });

  // ----- операции (исполнение плана) -----
  router.add('POST', '/api/fin/tx', async ({ q, user, body }) => {
    const n = await ownNode(q, user, int(body.node_id));
    if (n.type !== 'item') throw new HttpError(400, 'Операции ведутся по статьям');
    const amount = num(body.amount);
    if (!(amount > 0)) throw new HttpError(400, 'Сумма должна быть больше нуля');
    const day = isDate(body.day) ? body.day : new Date().toISOString().slice(0, 10);
    const r = await q.query('INSERT INTO fin_tx(user_id, budget_id, node_id, amount, note, day) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, node_id, amount, note, day, event_id', [user.id, n.budget_id, n.id, amount, str(body.note, 300).trim(), day]);
    return fmtTx(r.rows[0]);
  });
  router.add('PUT', '/api/fin/tx/:id', async ({ q, user, body, params }) => {
    const cur = await q.query('SELECT * FROM fin_tx WHERE id=$1 AND user_id=$2', [int(params.id), user.id]);
    if (!cur.rowCount) throw new HttpError(404, 'Операция не найдена');
    const t = cur.rows[0];
    const amount = body.amount != null ? num(body.amount) : Number(t.amount);
    if (!(amount > 0)) throw new HttpError(400, 'Сумма должна быть больше нуля');
    const note = body.note != null ? str(body.note, 300).trim() : t.note;
    const day = isDate(body.day) ? body.day : t.day;
    const r = await q.query('UPDATE fin_tx SET amount=$1, note=$2, day=$3 WHERE id=$4 AND user_id=$5 RETURNING id, node_id, amount, note, day, event_id', [amount, note, day, t.id, user.id]);
    // операция из трекера и запись трекера — одно целое
    if (t.event_id) await q.query('UPDATE events SET money_amount=$1, updated_at=now() WHERE id=$2 AND user_id=$3', [amount, t.event_id, user.id]);
    return fmtTx(r.rows[0]);
  });
  router.add('DELETE', '/api/fin/tx/:id', async ({ q, user, params }) => {
    const r = await q.query('DELETE FROM fin_tx WHERE id=$1 AND user_id=$2 RETURNING event_id', [int(params.id), user.id]);
    if (!r.rowCount) throw new HttpError(404, 'Операция не найдена');
    if (r.rows[0].event_id) await q.query('DELETE FROM events WHERE id=$1 AND user_id=$2', [r.rows[0].event_id, user.id]);
    return { ok: true };
  });
}

// Запись трекера вида money → операция в статье бюджета (создаётся, меняется или убирается)
async function syncMoney(c, userId, ev) {
  if (ev.kind !== 'money' || ev.money_node_id == null) {
    await c.query('DELETE FROM fin_tx WHERE event_id=$1 AND user_id=$2', [ev.id, userId]);
    return;
  }
  const n = await c.query("SELECT budget_id FROM fin_nodes WHERE id=$1 AND user_id=$2 AND type='item'", [ev.money_node_id, userId]);
  if (!n.rowCount) throw new HttpError(400, 'Статья бюджета не найдена');
  const day = ev.day instanceof Date ? ev.day.toISOString().slice(0, 10) : ev.day;
  await c.query(`INSERT INTO fin_tx(user_id, budget_id, node_id, amount, note, day, event_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO UPDATE SET budget_id=EXCLUDED.budget_id, node_id=EXCLUDED.node_id, amount=EXCLUDED.amount, note=EXCLUDED.note, day=EXCLUDED.day`,
  [userId, n.rows[0].budget_id, ev.money_node_id, ev.money_amount, String(ev.text || '').slice(0, 300), day, ev.id]);
}

module.exports = { register, syncMoney };
