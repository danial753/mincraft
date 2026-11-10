// داشبورد وب: Express + WebSocket — فقط با توکن، و به‌صورت پیش‌فرض فقط روی localhost
const express = require('express')
const http = require('http')
const path = require('path')
const crypto = require('crypto')
const { WebSocketServer } = require('ws')

module.exports = function startDashboard (fleet, config, hooks = {}) {
  const dash = config.dashboard || {}
  const host = dash.host || '127.0.0.1'
  const port = dash.port || 3000
  const token = dash.token || crypto.randomBytes(16).toString('hex')

  const sameToken = (t) => {
    const a = Buffer.from(String(t || '')); const b = Buffer.from(token)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '50kb' }))
  app.use(express.static(path.join(__dirname, 'public'))) // صفحه‌ی HTML عمومی است ولی بدون توکن هیچ داده‌ای نمی‌دهد

  // همه‌ی API ها نیاز به توکن دارند
  app.use('/api', (req, res, next) => {
    if (sameToken(req.get('x-token'))) return next()
    res.status(401).json({ error: 'توکن نامعتبر' })
  })

  const bot = (req) => { const m = fleet.get(req.params.id); if (!m) throw new Error('ربات پیدا نشد'); return m }
  const safe = (fn) => async (req, res) => { try { res.json({ ok: true, ...(await fn(req)) }) } catch (e) { res.status(400).json({ error: e.message }) } }

  // ---- صفحه‌ی اتصال به سرور (به‌جای پرسش در CMD) ----
  app.get('/api/setup', (req, res) => res.json({ last: hooks.getSaved ? hooks.getSaved() : null, owner: config.owner || '', maxBots: config.maxBots || 8 }))
  app.post('/api/setup', safe(async (req) => {
    const b = req.body || {}
    let host = String(b.host || '').trim(); let port = parseInt(b.port)
    const m = /^(.*):(\d{2,5})$/.exec(host); if (m) { host = m[1]; if (!port) port = parseInt(m[2]) }
    if (!host || /\s/.test(host)) throw new Error('آدرس سرور را بنویس (مثلاً Danial753.aternos.me:38644)')
    if (!port) port = 25565
    if (port < 1 || port > 65535) throw new Error('پورت نامعتبر است')
    const owner = String(b.owner || '').trim()
    if (owner && !/^\w{1,16}$/.test(owner)) throw new Error('اسم ماینکرفت فقط حرف انگلیسی/عدد/_ و حداکثر ۱۶ نویسه است')
    const bots = Math.max(1, Math.min(config.maxBots || 8, parseInt(b.bots) || 1))
    const username = String(b.username || 'Bot').replace(/[^\w]/g, '').slice(0, 14) || 'Bot'
    const version = String(b.version || '').trim()
    if (owner) config.owner = owner
    const sel = { host, port, owner, bots, username, version }
    if (hooks.save) hooks.save(sel)
    for (let i = 0; i < bots; i++) {
      // اتصال‌ها را با فاصله می‌زنیم تا سرور connection throttle نکند
      setTimeout(() => { try { fleet.add(null, { host, port, username, version: version || undefined, auth: 'offline' }) } catch (e) { fleet.emit('log', { t: Date.now(), level: 'error', message: e.message, botId: username }) } }, i * 4500)
    }
    return { message: `در حال اتصال ${bots} ربات به ${host}:${port}` }
  }))
  app.get('/api/status', (req, res) => res.json(fleet.status()))
  app.get('/api/profiles', (req, res) => {
    // ایمیل/نام کاربری حساب‌ها را نشان نمی‌دهیم
    const out = {}
    for (const [k, p] of Object.entries(config.profiles || {})) out[k] = { host: p.host, port: p.port, auth: p.auth, version: p.version }
    res.json(out)
  })
  app.get('/api/blueprints', (req, res) => res.json(require('../build/blueprints').TYPES && Object.fromEntries(Object.entries(require('../build/blueprints').TYPES).map(([k, v]) => [k, { desc: v.desc, params: v.params }]))))
  app.get('/api/bots/:id/logs', safe((req) => ({ logs: bot(req).logs })))
  app.get('/api/logs', (req, res) => res.json([].concat(...[...fleet.bots.values()].map(m => m.logs)).sort((a, b) => a.t - b.t).slice(-400)))
  app.get('/api/bots/:id/commands', safe((req) => ({ commands: bot(req).commands.list().map(c => ({ name: c.name, aliases: c.aliases, desc: c.desc, usage: c.usage, ownerOnly: c.ownerOnly })) })))

  app.post('/api/bots', safe((req) => {
    const { profile, ...o } = req.body || {}
    const m = fleet.add(profile, o)
    return { id: m.id }
  }))
  app.delete('/api/bots/:id', safe((req) => { fleet.remove(req.params.id); return {} }))
  app.post('/api/bots/:id/reconnect', safe((req) => { const m = bot(req); m.connect(m.currentProfile, m.currentOptions); return {} }))
  app.post('/api/bots/:id/disconnect', safe((req) => { bot(req).disconnect(); return {} }))
  app.post('/api/bots/:id/chat', safe((req) => { bot(req).sendChat(req.body.message); return {} }))
  app.post('/api/bots/:id/command', safe(async (req) => {
    const { name, args = [] } = req.body || {}
    return { replies: await bot(req).runCommand(String(name), args.map(String), 'console') }
  }))

  // ساخت از داشبورد
  app.post('/api/build', safe(async (req) => {
    const { type, params = {}, at, bots, dry, flatten = true, force = false } = req.body || {}
    let team = fleet.builders()
    if (Array.isArray(bots) && bots.length) team = fleet.online().filter(m => bots.includes(m.id))
    if (!team.length && !dry) throw new Error('ربات آنلاینی با نقش builder نیست.')
    const r = await fleet.project({ type: String(type), opts: params, team: team.length ? team : fleet.online(), at: at && Number.isFinite(at.x) && Number.isFinite(at.z) ? at : null, flatten, force, dry: !!dry })
    return { summary: { name: r.bp.name, blocks: r.info.blocks, size: r.info.size, counts: r.info.counts, seed: r.info.seed, style: r.info.style, flatten: r.info.flatten }, origin: r.origin }
  }))
  app.post('/api/build/stop', safe(() => ({ stopped: fleet.stopBuild() })))
  app.post('/api/bots/:id/role', safe((req) => ({ role: fleet.setRole(req.params.id, String((req.body || {}).role)) })))
  // کنسول متنی (همان دستورات ترمینال)
  app.post('/api/console', safe(async (req) => ({ lines: await require('../console').runLine(fleet, String((req.body || {}).line || '')) })))

  const server = http.createServer(app)
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x')
    // جلوگیری از اتصال WebSocket از سایت‌های دیگر (CSWSH) + توکن
    const origin = req.headers.origin
    const okOrigin = !origin || new URL(origin).host === req.headers.host
    if (url.pathname !== '/ws' || !okOrigin || !sameToken(url.searchParams.get('token'))) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })
  const broadcast = (type, data) => {
    if (!wss.clients.size) return
    const msg = JSON.stringify({ type, data })
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg)
  }
  fleet.on('log', (e) => broadcast('log', e))
  fleet.on('msa', (c) => broadcast('msa', c))
  const ticker = setInterval(() => broadcast('status', fleet.status()), 1000)

  server.listen(port, host, () => {
    console.log(`🖥 داشبورد: http://${host}:${port}/#token=${token}`)
    if (host !== '127.0.0.1' && host !== 'localhost') console.log('⚠ داشبورد روی شبکه باز است؛ توکن را محرمانه نگه دار و ترجیحاً از HTTPS/VPN استفاده کن.')
  })
  server.on('close', () => clearInterval(ticker))
  return { server, token }
}
