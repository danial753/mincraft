// پلاگین ساخت‌وساز: چند ربات با هم سازه‌های بزرگ (قلعه، برج، دیوار، هرم) می‌سازند.
// حالت پیشنهادی: creative (ربات‌ها پرواز می‌کنند و بلاک نامحدود دارند). در survival فقط از کوله‌پشتی استفاده می‌شود.
const path = require('path')
const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const CommandRegistry = require('../commands')
const { TYPES } = require('../build/blueprints')
const { candidates, matches, yawFor, adapt } = require('../build/spec')

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((resolve, reject) => setTimeout(() => reject(new Error(msg)), ms))])
const SIDES = [new Vec3(-1, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1)]
const DOWN = new Vec3(0, -1, 0)
const UP = new Vec3(0, 1, 0)
const fatal = (m) => Object.assign(new Error(m), { fatal: true })

function parseArgs (args) {
  const opts = {}; const rest = []
  for (const a of args) {
    const m = /^([a-zA-Z_]+)=(.*)$/.exec(a)
    if (m) opts[m[1].toLowerCase()] = m[2]; else rest.push(a)
  }
  return { opts, rest }
}

module.exports = function builder (bot, ctx) {
  let Item = null
  let slotRR = 0
  bot.once('spawn', () => {
    try { Item = require(require.resolve('prismarine-item', { paths: [path.dirname(require.resolve('mineflayer'))] }))(bot.registry) } catch (e) { ctx.log('warn', 'prismarine-item بارگذاری نشد؛ حالت creative کار نمی‌کند: ' + e.message) }
  })

  const isCreative = () => !!(bot.game && bot.game.gameMode === 'creative')
  const solid = (b) => !!b && b.boundingBox === 'block'
  const REPLACEABLE = new Set(['air', 'cave_air', 'void_air', 'grass', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow', 'vine', 'seagrass', 'tall_seagrass', 'kelp'])
  const isFluid = (b) => !!b && (b.name === 'water' || b.name === 'lava' || b.name === 'bubble_column')

  // نخستین روش چسباندنی که مرجع جامد دارد
  const specOf = (e) => (e._s || (e._s = adapt(e.spec, bot.registry)))
  function refFor (e) {
    const target = new Vec3(e.x, e.y, e.z)
    for (const c of candidates(specOf(e))) {
      const b = bot.blockAt(target.plus(c.d))
      if (solid(b)) return { ref: b, face: c.d.scaled(-1), half: c.half, look: c.look }
    }
    return null
  }
  const hasRef = (e) => {
    if (e.spec.kind === 'air') return true
    const cur = bot.blockAt(new Vec3(e.x, e.y, e.z))
    if (cur && matches(specOf(e), cur)) return true
    return !!refFor(e)
  }

  // ===== حالت «خودشان جمع کنند» =====
  // در creative بلاک‌ها خرج نمی‌شوند، پس موجودی مجازی (ledger) نگه می‌داریم؛ تمام شد → موقتاً survival می‌شویم،
  // از صفر می‌کنیم/می‌سازیم/ذوب می‌کنیم، و دوباره به ساخت برمی‌گردیم.
  const gather = { on: false, ledger: {}, curTask: null }
  const realCount = (name) => bot.inventory.items().filter(i => i.name === name).reduce((a, i) => a + i.count, 0)
  async function setMode (mode) {
    if (bot.game.gameMode === mode) return
    bot.chat('/gamemode ' + mode)
    for (let i = 0; i < 40 && bot.game.gameMode !== mode; i++) await sleep(100)
    if (bot.game.gameMode !== mode) throw fatal('تغییر حالت بازی به ' + mode + ' نشد (ربات باید OP باشد)')
  }
  function remainingOf (name) {
    let n = 0
    if (curJob) for (const e of curJob.all) if (e.state === 'todo' && e.spec.item === name) n++
    return n
  }
  async function replenish (name) {
    const teamN = Math.max(1, ctx.fleet ? ctx.fleet.builders().length : 1)
    const want = Math.max(48, Math.min(512, Math.ceil(remainingOf(name) / teamN) + 8))
    if (!bot.brain) throw fatal('ماژول بقا (survivor) فعال نیست')
    ctx.log('info', `🎒 مصالح ${name} تمام شد؛ می‌روم ${want} تا جمع کنم...`)
    setState('gathering')
    const wasCreative = isCreative()
    if (wasCreative) { // مانده‌ی کهنه را پاک کن تا کوله پر نشود
      for (const it of bot.inventory.items().filter(i => i.name === name)) { try { await bot.creative.clearSlot(it.slot) } catch {} }
    }
    // اول روی زمین بنشین (از ارتفاع سقوط نکن!)
    if (wasCreative) {
      const p = bot.entity.position.floored()
      let gy = p.y
      for (let y = p.y; y > p.y - 40; y--) { const b = bot.blockAt(new Vec3(p.x, y, p.z)); if (b && b.boundingBox === 'block') { gy = y + 1; break } }
      try { await fly(new Vec3(bot.entity.position.x, gy + 0.1, bot.entity.position.z), 8000) } catch { await tpTo(new Vec3(bot.entity.position.x, gy + 0.1, bot.entity.position.z)) }
    }
    try { bot.creative.stopFlying() } catch {}
    await bot.waitForTicks(6)
    await setMode('survival')
    for (let i = 0; i < 50 && !bot.entity.onGround; i++) await sleep(100) // فرود بیا (از پرواز آمده‌ای)
    let got = 0
    try {
      await bot.brain.obtain(name, want, gather.curTask || { cancelled: false })
    } catch (e) { ctx.log('warn', `جمع ${name}: ${e.message}`) } finally {
      got = realCount(name)
      if (wasCreative) { try { await setMode('creative') } catch {} }
    }
    if (got <= 0) { await sleep(4000); throw new Error('مصالح جمع نشد: ' + name) }
    gather.ledger[name] = got
    ctx.log('info', `✅ ${got} تا ${name} جمع شد؛ برمی‌گردم به ساخت.`)
  }

  async function ensureItem (name) {
    let it = bot.inventory.items().find(i => i.name === name)
    if (gather.on) {
      if (gather.ledger[name] === undefined) gather.ledger[name] = realCount(name)
      if (gather.ledger[name] <= 0 || !it) await replenish(name)
      it = bot.inventory.items().find(i => i.name === name)
    } else if (!it && isCreative()) {
      const def = bot.registry.itemsByName[name]
      if (!def) throw fatal('بلاک/آیتم ناشناخته در این نسخه: ' + name)
      if (!Item) throw fatal('Item در دسترس نیست')
      const slot = 36 + (slotRR++ % 9)
      try { await bot.creative.setInventorySlot(slot, new Item(def.id, 64)) } catch (e) {
        await sleep(300) // روی بعضی نسخه‌ها تأیید نمی‌آید ولی آیتم گذاشته شده؛ کوله را بررسی کن
        if (!(bot.inventory.slots[slot] && bot.inventory.slots[slot].name === name)) { await sleep(700); if (!(bot.inventory.slots[slot] && bot.inventory.slots[slot].name === name)) throw e }
      }
      it = bot.inventory.slots[slot] || bot.inventory.items().find(i => i.name === name)
    }
    if (!it) throw fatal('مصالح کافی نیست: ' + name)
    if (!bot.heldItem || bot.heldItem.name !== name) await bot.equip(it, 'hand')
  }

  let curJob = null
  const free = (b) => !!b && b.boundingBox !== 'block'
  // نزدیک‌ترین خانه‌ی خالی بالای هدف برای شناور شدن
  function findHover (target) {
    for (const dy of [2.5, 3.5, 5, 8, 12, 20]) {
      const y = Math.floor(target.y + dy)
      if (free(bot.blockAt(new Vec3(target.x, y, target.z))) && free(bot.blockAt(new Vec3(target.x, y + 1, target.z)))) return new Vec3(target.x + 0.5, target.y + dy, target.z + 0.5)
    }
    return new Vec3(target.x + 0.5, target.y + 25, target.z + 0.5)
  }
  // تلپورت اضطراری با /tp (نیاز به OP) وقتی پرواز گیر می‌کند
  async function tpTo (pos) {
    bot.chat(`/tp ${bot.username} ${pos.x.toFixed(2)} ${pos.y.toFixed(2)} ${pos.z.toFixed(2)}`)
    for (let i = 0; i < 20; i++) { await sleep(150); if (bot.entity.position.distanceTo(pos) < 3) return true }
    return false
  }
  async function fly (to, ms = 9000) { await withTimeout(bot.creative.flyTo(to), ms, 'پرواز طول کشید') }
  let hasOp = null
  async function moveCreative (target) {
    const hover = findHover(target)
    const p = bot.entity.position
    if (hasOp === null) hasOp = await canCommand().catch(() => false)
    // پرش‌های دور: با OP تلپورت مستقیم (پرواز روی نسخه‌های جدید و فاصله‌ی زیاد گاهی گیر می‌کند)
    if (hasOp && p.distanceTo(hover) > 14) { if (await tpTo(hover)) return }
    try {
      if (p.distanceTo(hover) > 10 && curJob && curJob.cruiseY) {
        const cy = Math.max(curJob.cruiseY, p.y, hover.y)
        await fly(new Vec3(p.x, cy, p.z), 5000); await fly(new Vec3(hover.x, cy, hover.z), 7000)
      }
      await fly(hover, 5000)
    } catch (e) {
      if (!(await tpTo(hover))) throw e
    }
  }
  async function moveInRange (target, force = false) {
    const p = bot.entity.position
    const inside = Math.abs(p.x - (target.x + 0.5)) < 0.8 && Math.abs(p.z - (target.z + 0.5)) < 0.8 && p.y < target.y + 1 && p.y + 1.8 > target.y
    const eye = p.offset(0, 1.62, 0)
    if (!force && !inside && eye.distanceTo(target.offset(0.5, 0.5, 0.5)) <= 4.2) return
    if (isCreative()) await moveCreative(target)
    else await withTimeout(bot.pathfinder.goto(new goals.GoalPlaceBlock(target, bot.world, { range: 4 })), 25000, 'رسیدن به موقعیت ساخت ممکن نشد')
  }

  // نقشه‌برداری ارتفاع زمین: برای هر ستون (x,z) بالاترین بلاک و بالاترین «زمین» (بدون درخت)
  const TREE = /_log$|_leaves$|_wood$|^vine$|mushroom_block|bee_nest|^cactus$|_stem$|^snow$|^snow_block$|^ice$/
  // لیست قطعه‌های ۱۴×۱۴ برای نقشه‌برداری (تقسیم بین چند ربات)
  function tilesOf (rect) { const out = []; for (let tx = rect.x0; tx <= rect.x1; tx += 14) for (let tz = rect.z0; tz <= rect.z1; tz += 14) out.push({ tx, tz }); return out }
  async function surveyTiles (tiles, rect, cruiseY) {
    const cols = new Map()
    const H = (bot.game && bot.game.height) || 256
    const minY = (bot.game && bot.game.minY) || 0
    const op = isCreative() ? await canCommand().catch(() => false) : false
    const yield_ = () => new Promise(resolve => setImmediate(resolve)) // به حلقه‌ی رویداد نفس بده (تا keepalive بی‌جواب نماند)
    let n = 0
    for (const { tx, tz } of tiles) {
      const cx = Math.min(tx + 7, rect.x1); const cz = Math.min(tz + 7, rect.z1)
      const y = Math.min(H - 8, cruiseY || 120)
      if (isCreative()) {
        const to = new Vec3(cx + 0.5, y, cz + 0.5)
        if (op) await tpTo(to) // با OP تلپورت مستقیم (پرواز روی نسخه‌های جدید گاهی گیر می‌کند)
        else { try { await fly(to, 12000) } catch { await tpTo(to) } }
      }
      await sleep(400) // چانک‌ها برسند
      const startY = Math.min(H - 1, Math.floor(bot.entity.position.y) + 70, y + 20)
      for (let x = tx; x < Math.min(tx + 14, rect.x1 + 1); x++) for (let z = tz; z < Math.min(tz + 14, rect.z1 + 1); z++) {
        let top = null; let ground = null; let water = false
        for (let yy = startY; yy >= minY; yy--) {
          const b = bot.blockAt(new Vec3(x, yy, z))
          if (!b) { top = undefined; break } // چانک بارگذاری نشده
          if (b.name === 'air' || b.name === 'cave_air') continue
          if (b.name === 'water' || b.name === 'lava' || b.liquid) { water = true; continue }
          if (b.boundingBox !== 'block' && !TREE.test(b.name)) continue // گیاه و ...
          if (top === null) top = yy
          if (!TREE.test(b.name)) { ground = yy; break }
        }
        if (top === undefined || ground === null) continue
        cols.set(x + ',' + z, { ground, top: Math.max(top, ground), water })
        if (++n % 25 === 0) await yield_()
      }
    }
    return cols
  }
  const survey = (rect, cruiseY) => surveyTiles(tilesOf(rect), rect, cruiseY)

  async function digAt (block) {
    if (!isCreative()) { try { await bot.tool.equipForBlock(block) } catch {} }
    await bot.dig(block)
  }

  const dbg = (...a) => { if (process.env.PB_DEBUG) console.log('[dbg]', ...a) }
  async function placeOne (e) {
    const target = new Vec3(e.x, e.y, e.z)
    let cur = bot.blockAt(target)
    dbg('place', e.raw || e.block, target.toString(), 'cur=', cur && cur.name, 'botpos', bot.entity.position.toString())
    if (!cur) { // چانک این نقطه برای این ربات بارگذاری نشده؛ اول برو آنجا
      await moveInRange(target, true)
      for (let i = 0; i < 12 && !cur; i++) { await sleep(400); cur = bot.blockAt(target) }
      if (!cur) throw new Error('چانک بارگذاری نشده')
    }
    const spec = specOf(e)
    if (spec.kind === 'air') { // کندن
      if (cur.name === 'air' || isFluid(cur) || REPLACEABLE.has(cur.name)) return
      await moveInRange(target); await digAt(cur); return
    }
    if (matches(spec, cur)) return
    // مانع را بردار (بلاک جامد یا گیاه/چیز غیرقابل‌جایگزینی)
    if (cur.name !== 'air' && !isFluid(cur) && !REPLACEABLE.has(cur.name)) { await moveInRange(target); dbg('digging', cur.name); await digAt(cur); dbg('dug ->', bot.blockAt(target).name) }
    await ensureItem(spec.item)
    await moveInRange(target)
    const r = refFor(e)
    if (!r) throw new Error('تکیه‌گاه ندارد')
    if (spec.kind === 'fluid') { // سطل آب/گدازه: باید «استفاده از آیتم» (activateItem) رو به وجه بالایی بلاک زیرین باشد
      await bot.lookAt(r.ref.position.offset(0.5, r.face.y > 0 ? 1 : 0.5, 0.5), true)
      await bot.waitForTicks(2)
      bot.activateItem()
      await sleep(500)
      const nowF = bot.blockAt(target)
      if (!nowF || nowF.name !== spec.name) throw new Error('سطل آب جواب نداد')
      return
    }
    const opts = { swingArm: 'right', half: r.half, forceLook: true }
    if (r.look) { await bot.look(yawFor(r.look), 0, true); await bot.waitForTicks(2); opts.forceLook = 'ignore' }
    await withTimeout(bot._placeBlockWithOptions(r.ref, r.face, opts), 6000, 'تأیید گذاشتن بلاک نیامد')
    const now = bot.blockAt(target)
    if (!matches(spec, now) && !(spec.kind === 'fluid' && isFluid(now))) {
      if (e.tries < 2 && now && now.name === spec.name) { await digAt(now) } // جهت اشتباه → بکن و دوباره
      throw new Error('جهت/ویژگی بلاک درست نشد')
    }
    if (gather.on) gather.ledger[spec.item] = (gather.ledger[spec.item] || 0) - 1
  }

  let state = 'idle'; let stateSince = Date.now()
  function setState (v) { state = v; stateSince = Date.now(); if (bot.builder) { bot.builder.state = v; bot.builder.stateSince = stateSince } }

  let workerSeq = 0
  async function work (job, task) {
    const id = ctx.manager.id
    const myWorker = ++workerSeq
    const ss = (v) => { if (myWorker === workerSeq) setState(v) } // کارگر قدیمی (لغوشده) وضعیت کارگر جدید را خراب نکند
    curJob = job
    gather.curTask = task
    try { if (isCreative()) bot.creative.startFlying() } catch {}
    while (!task.cancelled && !job.cancelled) {
      ss('waiting')
      const e = job.claim(id, bot.entity.position, hasRef)
      if (e === null) break
      if (e === 'wait') { await sleep(400); continue }
      ss('placing')
      try {
        if (bot.builder.__hang) await new Promise(() => {}) // فقط برای تست مدیر
        const stallMs = ((ctx.fleet && ctx.fleet.settings.stallSeconds) || 45) * 1000
        // مهلت هر بلاک: اگر گیر کرد، ربات به بلاک بعدی می‌رود (در حالت جمع‌آوری مصالح مهلت ندارد)
        await (gather.on ? placeOne(e) : withTimeout(placeOne(e), stallMs, 'مهلت چیدن این بلاک تمام شد'))
        job.done(e)
        if (ctx.fleet) { ctx.fleet.recordOutcome(true); const d = ctx.fleet.delayMs(); if (d > 0) await sleep(d) }
      } catch (err) {
        if (task.cancelled || job.cancelled) { job.fail(e, 'لغو شد', true); break }
        job.fail(e, String(err.message).slice(0, 60), !!err.fatal)
        if (ctx.fleet) ctx.fleet.recordOutcome(false)
      }
      if (state === 'gathering') ss('placing')
    }
    ss('idle')
    try { if (isCreative()) bot.creative.stopFlying() } catch {}
  }
  // اجرای دستور سرور و گرفتن پاسخ (نیاز به OP)
  let lastCmdAt = 0
  async function cmd (c, wait = 1500) {
    const gap = (ctx.fleet ? ctx.fleet.cmdGapMs() : 1150) - (Date.now() - lastCmdAt) // ضد اسپم سرور: حداکثر حدود ۱ دستور در ثانیه
    if (gap > 0) await sleep(gap)
    lastCmdAt = Date.now()
    return new Promise((resolve) => {
      const msgs = []
      let done = false
      const finish = () => { if (done) return; done = true; bot.removeListener('messagestr', h); resolve(msgs.join(' | ')) }
      const h = (m) => { msgs.push(m); if (/fill|block|loaded|Unknown|permission|Changed|Could not|outside|too|Test passed|Teleported|entity data|No entity/i.test(m)) setTimeout(finish, 50) }
      bot.on('messagestr', h)
      bot.chat(c)
      setTimeout(finish, wait)
    })
  }
  async function canCommand () {
    // /execute if entity @s فقط برای OP جواب «Test passed» می‌دهد و چیزی را در دنیا عوض نمی‌کند
    const r = await cmd('/execute if entity @s', 1200).catch(() => '')
    return /Test passed|passed/i.test(r)
  }
  // fill با رعایت سقف ۳۲۷۶۸ بلاک؛ ربات اول به آن‌جا می‌رود تا چانک بارگذاری شود
  async function fillBox (x0, y0, z0, x1, y1, z1, block) {
    const c = new Vec3((x0 + x1) / 2, Math.max(y1, bot.entity.position.y) + 6, (z0 + z1) / 2)
    if (bot.entity.position.distanceTo(c) > 30) await tpTo(c)
    const r = await cmd(`/fill ${x0} ${y0} ${z0} ${x1} ${y1} ${z1} ${block}`, 2500)
    if (/not loaded|outside/i.test(r)) { await tpTo(new Vec3(c.x, c.y, c.z)); await sleep(800); return cmd(`/fill ${x0} ${y0} ${z0} ${x1} ${y1} ${z1} ${block}`, 1500) }
    return r
  }
  bot.builder = { work, survey, surveyTiles, tilesOf, tpTo, cmd, canCommand, fillBox, gather }

  const fmt = (s) => `🏗 ${s.name} [${s.stageIndex}/${s.stages}: ${s.stage || ''}]: ${s.percent}% (${s.done}/${s.total}) لایه ${s.layer ?? '—'} | ناموفق ${s.failed} | ${s.seconds}s${s.finished ? ' ✅' : ''}`

  ctx.commands.register('build', {
    aliases: ['بساز'],
    desc: 'ساخت گروهی (ابتدا زمین هموار می‌شود): build <castle|fort|tower|wall|pyramid> [size=] [seed=] [style=] [at=x,z[,y]] [dry=1] [flatten=0] [solo=1]',
    usage: 'build <نوع> [پارامترها]',
    ownerOnly: true,
    run: async (_b, args, username, reply) => {
      const fleet = ctx.fleet
      const { opts, rest } = parseArgs(args)
      const type = (rest[0] || '').toLowerCase()
      if (!type) return reply('استفاده: build <' + Object.keys(TYPES).join('|') + '> [size=57] [seed=7] [style=royal|gothic|azure|sun|forest] [at=x,z] [dry=1] [flatten=0]')
      // تیم: ربات‌هایی با نقش builder
      let team = fleet.builders()
      if (opts.solo) team = [ctx.manager]
      if (opts.bots) { const names = opts.bots.toLowerCase().split(','); team = fleet.online().filter(m => names.includes(m.id.toLowerCase())) }
      if (!team.length) return reply('رباتی با نقش builder آنلاین نیست (role <ربات> builder).')
      let at = null
      if (opts.at) {
        const n = opts.at.split(',').map(Number)
        if (n.some(Number.isNaN) || n.length < 2) return reply('at باید at=x,z یا at=x,y,z باشد.')
        at = n.length === 2 ? { x: n[0], z: n[1] } : { x: n[0], y: n[1], z: n[2] }
      }
      const dry = !!(opts.dry && opts.dry !== '0')
      const flatten = !(opts.flatten === '0' || opts.flatten === 'false')
      try {
        const r = await fleet.project({ type, opts, team, at, flatten, force: !!opts.force, dry })
        const i = r.info
        reply(`📐 ${r.bp.title || r.bp.name}: ${i.blocks} بلاک، ابعاد ${i.size.x}×${i.size.y}×${i.size.z}${i.seed ? '، seed ' + i.seed : ''}${i.style ? '، سبک ' + i.style : ''}`)
        const top = Object.entries(i.counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}×${v}`).join(' ')
        if (dry) return reply('مصالح: ' + top)
        if (i.flatten) reply(`🧱 سطح زمین → y=${i.flatten.level} | برش ${i.flatten.cut} | پر کردن ${i.flatten.fill} | محدوده‌ی ارتفاع طبیعی ${i.flatten.range[0]}..${i.flatten.range[1]}`)
        reply(`🚀 شروع با ${team.length} ربات: ${team.map(m => m.id).join(', ')} — پیشرفت: buildinfo`)
      } catch (e) { reply('❌ ' + e.message) }
    }
  })

  ctx.commands.register('buildinfo', {
    aliases: ['پیشرفت'],
    desc: 'وضعیت ساخت جاری',
    usage: 'buildinfo',
    run: async (_b, args, username, reply) => {
      const st = ctx.fleet.status().build
      if (!st) return reply('ساختی در جریان نیست.')
      reply(fmt(st))
      if (st.topFailures.length) reply('علت‌های شکست: ' + st.topFailures.map(([k, v]) => `${k}(${v})`).join('، '))
    }
  })

  ctx.commands.register('buildstop', {
    aliases: ['توقف_ساخت'],
    desc: 'توقف ساخت',
    usage: 'buildstop',
    ownerOnly: true,
    run: async (_b, args, username, reply) => reply(ctx.fleet.stopBuild() ? '🛑 ساخت متوقف شد.' : 'ساختی در جریان نیست.')
  })

  ctx.commands.register('buildlist', {
    aliases: ['نقشه‌ها'],
    desc: 'لیست نقشه‌ها',
    usage: 'buildlist',
    run: async (_b, args, username, reply) => { for (const [k, v] of Object.entries(TYPES)) reply(`${k}: ${v.desc}`) }
  })

  // همه‌ی ربات‌ها پیش صاحب تلپورت شوند (نیاز به OP)
  ctx.commands.register('tome', {
    aliases: ['بیا_پیشم', 'پیشم'],
    desc: 'تلپورت ربات به صاحب (جایی که تو هستی)',
    usage: 'tome',
    ownerOnly: true,
    run: async (_b, args, username, reply) => {
      const owner = ctx.config.owner
      if (!owner) return reply('اسم صاحب (owner) تنظیم نشده؛ در صفحه‌ی اتصال بنویس.')
      const real = Object.keys(bot.players).find(n => n.toLowerCase() === String(owner).toLowerCase()) || owner
      if (!(await canCommand())) return reply('ربات OP نیست؛ نمی‌تواند تلپورت کند (op ' + bot.username + ')')
      const r = await cmd(`/tp ${bot.username} ${real}`, 1500)
      reply(/Teleported|teleported/i.test(r) ? `✅ پیش ${real} آمدم` : '⚠ ' + (r || 'پاسخی نیامد (بازیکن آنلاین است؟)'))
    }
  })

  ctx.commands.register('creative', {
    aliases: ['کریتیو'],
    desc: 'تلاش برای تغییر به creative (ربات باید OP باشد)',
    usage: 'creative',
    ownerOnly: true,
    run: async (_b, args, username, reply) => {
      if (isCreative()) return reply('از قبل creative هستم ✅')
      bot.chat('/gamemode creative')
      await sleep(1500)
      reply(isCreative() ? '✅ creative شد.' : '⛔ نشد؛ ربات باید OP باشد (در کنسول سرور: op ' + bot.username + ')')
    }
  })

  // ===== doctor: تشخیص مشکل روی همین سرور و همین نسخه =====
  ctx.commands.register('doctor', {
    aliases: ['تشخیص', 'سلامت'],
    desc: 'بررسی سلامت ربات روی این سرور (OP، حالت بازی، چیدن بلاک، نسخه)',
    usage: 'doctor',
    ownerOnly: true,
    run: async (_b, args, username, reply) => {
      const ok = (m) => reply('✅ ' + m)
      const bad = (m) => reply('❌ ' + m)
      reply(`🩺 ${bot.username}: ماینکرفت ${bot.version} | پروتکل ${bot.protocolVersion || '?'} | نقش ${ctx.manager.role}`)
      const feet = bot.entity.position.floored()
      const here = bot.blockAt(feet)
      here ? ok('چانک اطراف بارگذاری شده') : bad('چانک زیر پای ربات بارگذاری نشده')
      const gm = bot.game && bot.game.gameMode
      gm === 'creative' ? ok('حالت بازی: creative') : bad(`حالت بازی: ${gm}. برای ساخت سریع باید creative باشد (ربات را OP کن و «creative» بزن) یا از gather=1 استفاده کن.`)
      const op = await canCommand()
      op ? ok('ربات OP است (دستورهای /fill و /tp و /gamemode کار می‌کنند)') : bad(`ربات OP نیست. در کنسول سرور بزن: op ${bot.username}`)
      for (const n of ['stone', 'stone_bricks', 'oak_planks', 'oak_stairs', 'lantern', 'ladder', 'water', 'dirt', 'grass_block']) {
        if (!bot.registry.blocksByName[n]) bad('این بلاک در این نسخه وجود ندارد: ' + n)
      }
      if (!bot.registry.blocksByName.chain && !bot.registry.blocksByName.iron_chain) bad('نه chain و نه iron_chain در این نسخه هست')
      if (!bot.pathfinder) bad('pathfinder بارگذاری نشده'); else ok('pathfinder بارگذاری شده')
      if (!Item) bad('prismarine-item بارگذاری نشد (حالت creative کار نمی‌کند)')
      if (gm === 'creative' && Item) {
        try {
          await bot.creative.setInventorySlot(36, new Item(bot.registry.itemsByName.stone.id, 64)); await sleep(500)
          const got = bot.inventory.slots[36]
          got && got.name === 'stone' ? ok('گرفتن بلاک از creative کار می‌کند') : bad('creative بلاک را در کوله نگذاشت (مشکل نسخه یا پروتکل)')
          // آزمایش چیدن: یک بلاک روی زمین جلوی ربات می‌گذارد و برمی‌دارد
          let done = false
          for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 1], [1, 3]]) {
            const ground = bot.blockAt(feet.offset(dx, -1, dz)); const air = bot.blockAt(feet.offset(dx, 0, dz))
            if (!ground || ground.boundingBox !== 'block' || !air || air.name !== 'air') continue
            await bot.equip(bot.inventory.slots[36], 'hand')
            try {
              await withTimeout(bot._placeBlockWithOptions(ground, new Vec3(0, 1, 0), { swingArm: 'right', forceLook: true }), 6000, 'تأیید چیدن نیامد')
              const placed = bot.blockAt(feet.offset(dx, 0, dz))
              placed && placed.name === 'stone' ? ok('چیدن بلاک کار می‌کند') : bad('چیدن بلاک جواب نداد (بلاک: ' + (placed && placed.name) + ')')
              if (placed && placed.name === 'stone') await bot.dig(placed).catch(() => {})
            } catch (e) { bad('چیدن بلاک ناموفق: ' + e.message) }
            done = true; break
          }
          if (!done) reply('⚠ جای مناسبی برای آزمایش چیدن نبود؛ ربات را روی زمین باز بگذار.')
        } catch (e) { bad('آزمایش creative خطا داد: ' + e.message) }
      }
      reply('این پیام‌ها را برای من بفرست اگر مشکلی ماند.')
    }
  })
}
