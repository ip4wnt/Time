// Обёртка над fetch. Токен сессии — в памяти и (если доступно) в localStorage,
// потому что во встроенных предпросмотрах cookie могут блокироваться.
const API = '__PORT_3000__'.startsWith('__') ? '' : '__PORT_3000__';

let token = null;
try { token = localStorage.getItem('chronum_token'); } catch { /* приватный режим / iframe */ }

export function setToken(t) {
  token = t;
  try { if (t) localStorage.setItem('chronum_token', t); else localStorage.removeItem('chronum_token'); } catch { /* ignore */ }
}
export function hasToken() { return !!token; }

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, path, body, opts = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (body instanceof Blob || body instanceof ArrayBuffer) { payload = body; headers['Content-Type'] = opts.mime || 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером');
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) { setToken(null); window.dispatchEvent(new CustomEvent('chronum:unauth')); }
    throw new ApiError(res.status, (data && data.error) || `Ошибка ${res.status}`);
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);
export function fileUrl(id, download = false) {
  const q = new URLSearchParams();
  if (download) q.set('download', '1');
  // токен нужен для <img>/<audio>, которые не шлют заголовок Authorization
  if (token) q.set('t', token);
  return `${API}/api/files/${id}?${q}`;
}
export async function upload(file, { note_id, event_id } = {}) {
  const q = new URLSearchParams({ name: file.name || 'file', mime: file.type || 'application/octet-stream' });
  if (note_id) q.set('note_id', note_id);
  if (event_id) q.set('event_id', event_id);
  return api('POST', `/api/files?${q}`, file, { mime: file.type || 'application/octet-stream' });
}
