// پارس‌بات — نقطه ورود
// اجرا: node src/index.js   ← داشبورد باز می‌شود و آدرس سرور/اسم تو را همان‌جا (در مرورگر) وارد می‌کنی.
// اجرای مستقیم (اختیاری): node src/index.js --host آدرس --port پورت --owner اسم --bots 3 --username Bot [--version 26.1] [--role survivor] [--no-open]
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const Fleet = require('./fleet')
const startDashboard = require('./dashboard/server')

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'))
const localPath = path.join(__dirname, '..', 'config.local.json') // تنظیمات شخصی (در گیت/zip نمی‌رود)
let local = {}
if (fs.existsSync(localPath)) {
  try { local = JSON.parse(fs.readFileSync(localPath, 'utf8')) } catch { console.log('⚠ config.local.json خراب است و نادیده گرفته شد.') }
  Object.assign(config, local, { dashboard: { ...config.dashboard, ...local.dashboard }, profiles: { ...config.profiles, ...local.profiles } })
}
if (!config.owner && local.lastServer && local.lastServer.owner) config.owner = local.lastServer.owner

const argv = process.argv.slice(2)
const arg = (name) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined }
const flag = (name) => argv.includes('--' + name)

function saveLocal (patch) {
  local = { ...local, ...patch }
  try { fs.writeFileSync(localPath, JSON.stringify(local, null, 2) + '\n') } catch (e) { console.log('⚠ ذخیره‌ی تنظیمات نشد:', e.message) }
}

const fleet = new Fleet(config)
fleet.on('log', (e) => console.log(`[${e.botId}] ${e.message}`))
const { token } = startDashboard(fleet, config, {
  getSaved: () => local.lastServer || null,
  save: (sel) => saveLocal({ lastServer: sel })
})

const dash = config.dashboard || {}
const url = `http://${dash.host === '0.0.0.0' ? '127.0.0.1' : (dash.host || '127.0.0.1')}:${dash.port || 3000}/#token=${token}`

function openBrowser (u) {
  const cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`
  exec(cmd, (err) => { if (err) console.log('مرورگر خودکار باز نشد؛ این آدرس را در مرورگر باز کن:\n' + u) })
}

console.log(`\n  ${config.brand} — چندرباته + سازنده\n  داشبورد: ${url}\n`)

// اتصال مستقیم با آرگومان (اختیاری)
if (arg('host')) {
  const m = /^(.*):(\d{2,5})$/.exec(arg('host'))
  const host = m ? m[1] : arg('host'); const port = arg('port') || (m && m[2]) || 25565
  if (arg('owner')) config.owner = arg('owner')
  const bots = Math.max(1, parseInt(arg('bots') || '1'))
  for (let i = 0; i < bots; i++) setTimeout(() => { try { fleet.add(null, { host, port, username: arg('username') || 'Bot', version: arg('version'), role: arg('role'), auth: arg('auth') }) } catch (e) { console.log('❌', e.message) } }, i * 4500)
} else if (arg('profile')) {
  const bots = Math.max(1, parseInt(arg('bots') || '1'))
  for (let i = 0; i < bots; i++) setTimeout(() => { try { fleet.add(arg('profile'), { username: arg('username'), version: arg('version'), role: arg('role') }) } catch (e) { console.log('❌', e.message) } }, i * 4500)
}
if (!flag('no-open')) setTimeout(() => openBrowser(url), 800)

// کنسول ترمینال (اختیاری): همان دستورات داشبورد
if (process.stdin.isTTY) {
  const rl = require('readline').createInterface({ input: process.stdin })
  const { runLine } = require('./console')
  rl.on('line', async (line) => { try { for (const l of await runLine(fleet, line)) console.log('›', l) } catch (e) { console.log('❌', e.message) } })
}

const quit = () => { fleet.shutdown(); process.exit(0) }
process.on('SIGINT', quit)
process.on('SIGTERM', quit)
