#!/usr/bin/env node
// A tiny two-person chat to try cast with. No dependencies: `node examples/chat/server.mjs`.
// Users: sam / demo and elon / demo. Sessions last 30 days and survive restarts (signed cookie).
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT) || 3000;
const USERS = { sam: 'Sam', elon: 'Elon' };
const PASSWORD = 'demo';
const SECRET = 'cast-demo-chat'; // a demo, not a real secret
const messages = [];        // { from, text, at }
const streams = new Set();  // open SSE responses

const page = (title, body) => `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.4 system-ui,sans-serif;background:#eef1f5;color:#1c2430;height:100vh;display:flex;flex-direction:column}
header{background:#2f6fed;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
header b{font-size:17px}header a{color:#dfe8ff;font-size:13px}
form.login{margin:auto;background:#fff;padding:28px;border-radius:12px;box-shadow:0 4px 20px #0001;width:300px;display:grid;gap:10px}
input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #cdd5df}button{background:#2f6fed;color:#fff;border:0;cursor:pointer}
.hint{color:#6a7686;font-size:13px}.err{color:#c62828;font-size:13px}
#log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px}
.msg{max-width:75%;padding:8px 12px;border-radius:14px;background:#fff;box-shadow:0 1px 2px #0001;align-self:flex-start}
.msg.me{align-self:flex-end;background:#2f6fed;color:#fff}.msg small{display:block;font-size:11px;opacity:.7}
form.send{display:flex;gap:8px;padding:12px;background:#fff;border-top:1px solid #dde3ea}form.send input{flex:1}
</style>${body}</html>`;

function loginPage(error = '') {
  return page('Sign in — Demo chat', `<header><b>Demo chat</b></header>
<form class="login" method="post" action="/login">
<b>Sign in</b>
<input name="user" placeholder="Username (sam or elon)" autocomplete="username" required>
<input name="password" type="password" placeholder="Password (demo)" autocomplete="current-password" required>
<button>Sign in</button>
${error ? `<div class="err">${error}</div>` : '<div class="hint">Users: sam, elon. Password: demo.</div>'}
</form>`);
}

function chatPage(user) {
  return page(`Chat — ${USERS[user]}`, `<header><b>Demo chat</b><span>${USERS[user]} · <a href="/logout">Sign out</a></span></header>
<div id="log"></div>
<form class="send" id="send"><input id="text" placeholder="Message" autocomplete="off"><button>Send</button></form>
<script>
const me = ${JSON.stringify(user)}, names = ${JSON.stringify(USERS)};
const log = document.getElementById('log');
function add(m) {
  const d = document.createElement('div');
  d.className = 'msg' + (m.from === me ? ' me' : '');
  d.innerHTML = '<small></small><span></span>';
  d.querySelector('small').textContent = names[m.from];
  d.querySelector('span').textContent = m.text;
  log.append(d); log.scrollTop = log.scrollHeight;
}
new EventSource('/events').onmessage = e => add(JSON.parse(e.data));
document.getElementById('send').onsubmit = async e => {
  e.preventDefault();
  const input = document.getElementById('text');
  if (!input.value.trim()) return;
  await fetch('/send', { method: 'POST', body: input.value });
  input.value = '';
};
</script>`);
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => resolve(data));
  });
}

const sign = user => `${user}.${createHmac('sha256', SECRET).update(user).digest('hex').slice(0, 32)}`;

function currentUser(req) {
  const token = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
  const user = token.split('.')[0];
  return USERS[user] && token === sign(user) ? user : undefined;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const user = currentUser(req);
  const html = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers }); res.end(body); };
  const redirect = (to, headers = {}) => { res.writeHead(303, { Location: to, ...headers }); res.end(); };

  if (url.pathname === '/login' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req));
    const id = (form.get('user') ?? '').trim().toLowerCase();
    if (!USERS[id] || form.get('password') !== PASSWORD) return html(401, loginPage('Wrong username or password.'));
    return redirect('/', { 'Set-Cookie': `session=${sign(id)}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax` });
  }
  if (url.pathname === '/logout') return redirect('/login', { 'Set-Cookie': 'session=; Max-Age=0; Path=/' });
  if (url.pathname === '/login') return user ? redirect('/') : html(200, loginPage());
  if (!user) return url.pathname === '/' ? redirect('/login') : html(401, 'Sign in first');

  if (url.pathname === '/send' && req.method === 'POST') {
    const text = (await readBody(req)).trim().slice(0, 500);
    if (text) {
      const m = { from: user, text, at: Date.now() };
      messages.push(m);
      for (const s of streams) s.write(`data: ${JSON.stringify(m)}\n\n`);
    }
    res.writeHead(204); return res.end();
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    for (const m of messages) res.write(`data: ${JSON.stringify(m)}\n\n`);
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }
  if (url.pathname === '/') return html(200, chatPage(user));
  html(404, 'Not found');
});

server.listen(PORT, () => console.log(`Demo chat: http://localhost:${PORT}  (users: sam, elon; password: demo)`));
