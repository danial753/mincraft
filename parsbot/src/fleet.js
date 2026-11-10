// ناوگان: چند ربات هم‌زمان + کار ساخت مشترک
const EventEmitter = require('events')
const BotManager = require('./manager')
const BuildJob = require('./build/job')
const { generate } = require('./build/blueprints')
const { planFlatten } = require('./build/terrain')
const { parse: parseSpec, adapt: adaptSpec } = require('./build/spec')
const { survivalize } = require('./build/survival')

class Fleet extends EventEmitter {
  constructor (config) {
    super()
    this.config = config
    this.bots = new Map()
    this.authed = new Set() // بازیکنان وارد شده با !login (برای همه‌ی رباتها مشترک)
    this.job = null
    this.pipeline = null
    this.lastPipeline = null
  }

  uniqueName (base) {
    let name = base; let i = 1
    const taken = new Set([...this.bots.values()].map(m => (m.currentOptions && m.currentOptions.username) || m.id))
    while (taken.has(name)) name = `${base}${++i}`
    return name
  }

  add (profileName, overrides = {}) {
    const max = this.config.maxBots || 8
    if (this.bots.size >= max) throw new Error(`حداکثر ${max} ربات مجاز است (maxBots در config.json)`)
    const profile = (this.config.profiles || {})[profileName] || {}
    const base = overrides.username || profile.username || this.config.brand || 'ParsBot'
    const username = this.uniqueName(base)
    if ((overrides.auth || profile.auth) === 'microsoft' && this.bots.size > 0) {
      throw new Error('هر حساب مایکروسافت فقط یک ربات می‌تواند باشد؛ برای چند ربات از حالت آفلاین (سرور کرک/محلی) استفاده کن.')
    }
    const id = username
    const m = new BotManager(this.config, this, id)
    if (overrides.role) m.role = overrides.role
    m.on('log', e => this.emit('log', e))
    m.on('msa', c => this.emit('msa', c))
    this.bots.set(id, m)
    const { role: _r, ...connOverrides } = overrides
    try { m.connect(profileName, { ...connOverrides, username }) } catch (e) { this.bots.delete(id); throw e }
    return m
  }

  remove (id) {
    const m = this.bots.get(id)
    if (!m) throw new Error('ربات پیدا نشد: ' + id)
    m.disconnect()
    this.bots.delete(id)
  }

  get (id) {
    if (this.bots.has(id)) return this.bots.get(id)
    const low = String(id).toLowerCase()
    for (const [k, m] of this.bots) if (k.toLowerCase() === low) return m
    return undefined
  }
  builders () { return this.online().filter(m => m.role === 'builder' && m.bot.builder) }

  // نقش ربات: builder (سازنده/creative) | survivor (بقا/اکتشاف) | idle (بیکار)
  static ROLES = { builder: 'builder', سازنده: 'builder', survivor: 'survivor', بقا: 'survivor', survival: 'survivor', idle: 'idle', بیکار: 'idle' }
  setRole (id, roleRaw) {
    const m = this.get(id); if (!m) throw new Error('ربات پیدا نشد: ' + id)
    const role = Fleet.ROLES[String(roleRaw).toLowerCase()] || Fleet.ROLES[roleRaw]
    if (!role) throw new Error('نقش نامعتبر. گزینه‌ها: builder (سازنده) | survivor (بقا) | idle (بیکار)')
    m.role = role
    m.cancelTask()
    if (m.bot && m.bot.brain) m.bot.brain.stop()
    m.log('info', `🎭 نقش ${m.id}: ${role}`)
    if (m.bot) this.applyRole(m)
    return role
  }
  // اعمال نقش روی ربات متصل: تغییر حالت بازی (نیاز به OP)
  applyRole (m) {
    const b = m.bot; if (!b) return
    const want = m.role === 'builder' ? 'creative' : m.role === 'survivor' ? 'survival' : null
    if (m.role === 'survivor' && b.brain) b.brain.active = true
    if (!want) return
    if (b.game && b.game.gameMode === want) return
    try { b.chat('/gamemode ' + want) } catch {}
    setTimeout(() => { if (m.bot === b && b.game && b.game.gameMode !== want) m.log('warn', `⚠ ${m.id} حالت ${want} نشد؛ ربات باید OP باشد (در کنسول سرور: op ${m.id}) یا حالت بازی را خودت عوض کن.`) }, 2500)
  }
  online () { return [...this.bots.values()].filter(m => m.connection === 'online' && m.bot && m.bot.entity) }
  // ربات اصلی: به دستورات بدون نام جواب می‌دهد
  leader () { return this.online()[0] || [...this.bots.values()][0] || null }

  status () {
    return {
      brand: this.config.brand,
      bots: [...this.bots.values()].map(m => m.status()),
      leader: this.leader() ? this.leader().id : null,
      build: this._buildStatus()
    }
  }

  // ---- ساخت (خط لوله: برداشتن زمین → پر کردن → ساخت) ----
  plan (type, opts) { return generate(type, opts) }

  _buildStatus () {
    const pl = this.pipeline || this.lastPipeline
    if (!pl) return null
    let total = 0; let done = 0; let failed = 0; let seconds = 0
    const fails = {}
    for (const st of pl.stages) {
      const sm = st.job.summary(); total += sm.total; done += sm.done; failed += sm.failed
      for (const [k, v] of Object.entries(st.job.failures)) fails[k] = (fails[k] || 0) + v
    }
    const cur = pl.stages[Math.min(pl.idx, pl.stages.length - 1)].job.summary()
    seconds = Math.round(((pl.finishedAt || Date.now()) - pl.startedAt) / 1000)
    return {
      name: pl.name, stage: cur.stage, stageIndex: Math.min(pl.idx, pl.stages.length - 1) + 1, stages: pl.stages.length,
      origin: pl.origin, total, done, failed, layer: cur.layer, seconds, cancelled: pl.cancelled, finished: pl.finished,
      percent: total ? Math.round((done + failed) / total * 1000) / 10 : 100, info: pl.info,
      topFailures: Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 3)
    }
  }

  async _runJob (job, team, cruiseY) {
    job.cruiseY = cruiseY
    await Promise.all(team.map(async (m) => {
      if (!m.bot || !m.bot.builder) return
      const t = m.beginTask('build', `${job.stage || job.name}`, () => {})
      try { await m.bot.builder.work(job, t) } catch (e) { m.log('error', 'ساخت: ' + e.message) } finally { job.release(m.id); m.endTask(t) }
    }))
  }

  async _runPipeline (pl, team) {
    try {
      for (let i = 0; i < pl.stages.length && !pl.cancelled; i++) {
        pl.idx = i
        const st = pl.stages[i]
        this.job = st.job
        for (const m of team) if (m.bot && m.bot.builder) m.bot.builder.gather.on = !!(pl.gatherMode && st.gather)
        for (const m of team) m.log('info', `🏗 مرحله ${i + 1}/${pl.stages.length}: ${st.job.stage} (${st.job.total} بلاک)`)
        if (st.job.total) await this._runJob(st.job, team, pl.cruiseY)
      }
    } finally {
      pl.finished = true; pl.finishedAt = Date.now()
      const s = this._buildStatus()
      if (team[0]) team[0].log('info', `🏁 ${pl.cancelled ? 'ساخت متوقف شد' : 'ساخت تمام شد'}: ${s.done} بلاک، ${s.failed} ناموفق، ${s.seconds} ثانیه`)
      this.emit('buildfinished', s)
      this.lastPipeline = pl; this.pipeline = null
    }
  }

  get building () { return !!(this.pipeline && !this.pipeline.finished) }

  // پروژه‌ی کامل: نقشه + تسطیح زمین. at={x,z[,y]} گوشه‌ی کمینه‌ی نقشه.
  async project ({ type, opts = {}, team, at = null, flatten = true, force = false, dry = false }) {
    if (this.building) throw new Error('یک ساخت در حال انجام است؛ اول buildstop بزن.')
    if (!team.length) throw new Error('ربات آماده‌ای (نقش builder) برای ساخت نیست.')
    let bp = generate(type, opts)
    const gatherMode = !!(opts.gather && opts.gather !== '0')
    const lead = team[0]
    if (gatherMode) {
      const wood = lead.bot.brain ? lead.bot.brain.detectWood() : 'oak'
      bp = survivalize(bp, wood)
      bp.title = (bp.title || bp.name) + ` — جمع‌آوری مصالح توسط ربات‌ها (چوب: ${wood})`
    }
    const lp = lead.bot.entity.position
    const o = at ? { x: Math.floor(at.x), z: Math.floor(at.z), y: at.y } : { x: Math.floor(lp.x) + 10, z: Math.floor(lp.z) + 10 }
    { // همه‌ی بلاک‌های نقشه باید در این نسخه‌ی ماینکرفت وجود داشته باشند
      const reg = lead.bot.registry; const miss = []
      for (const n of Object.keys(bp.counts)) {
        const sp = adaptSpec(parseSpec(n), reg)
        if (!reg.blocksByName[sp.name] && !reg.itemsByName[sp.name]) miss.push(n)
      }
      if (miss.length && !opts.force) throw new Error(`این بلاک‌ها در ماینکرفت ${lead.bot.version} وجود ندارند: ${miss.join(', ')} — سبک دیگری انتخاب کن (style=) یا force=1`)
    }
    const core = { x0: o.x, z0: o.z, x1: o.x + bp.size.x - 1, z1: o.z + bp.size.z - 1 }
    const info = { blocks: bp.blocks.length, size: bp.size, seed: bp.seed, style: bp.style, counts: bp.counts }
    if (dry) return { bp, info }
    const stages = []; let G; let cruiseY = null
    if (flatten) {
      const ring = Math.max(0, Math.min(12, opts.ring !== undefined ? parseInt(opts.ring) || 0 : 6))
      const rect = { x0: core.x0 - ring, z0: core.z0 - ring, x1: core.x1 + ring, z1: core.z1 + ring }
      lead.log('info', `🗺 نقشه‌برداری زمین (${rect.x1 - rect.x0 + 1}×${rect.z1 - rect.z0 + 1})...`)
      const cols = await lead.bot.builder.survey(rect, Math.floor(lp.y) + 40)
      const fast = !opts.slow && await lead.bot.builder.canCommand().catch(() => false)
      const plan = planFlatten(cols, core, ring, o.y !== undefined ? o.y - 1 : null, fast)
      if (plan.waterFrac > 0.3 && !force) throw new Error(`بیشتر این زمین آب است (${Math.round(plan.waterFrac * 100)}٪). جای دیگری انتخاب کن (at=x,z) یا force=1 بزن.`)
      if (plan.total > 80000 && !force) throw new Error(`تسطیح این زمین ${plan.total} بلاک کار دارد (خیلی ناهموار). جای دیگری انتخاب کن یا force=1 بزن.`)
      G = plan.level
      let maxTop = G; for (const c of cols.values()) maxTop = Math.max(maxTop, c.top)
      cruiseY = maxTop + 6
      info.flatten = { level: G, cut: plan.cut.length, fill: plan.fill.length, range: plan.range, fast, tiles: plan.tiles.length }
      if (fast) {
        lead.log('info', `⚡ تسطیح سریع با /fill (${plan.tiles.length} قطعه)...`)
        const B = lead.bot.builder
        for (const t of plan.tiles) {
          const top = Math.min(t.top + 1, G + 120)
          if (top > G) await B.fillBox(t.x0, G + 1, t.z0, t.x1, top, t.z1, 'air')
          if (t.minG < G) await B.fillBox(t.x0, t.minG, t.z0, t.x1, G - 1, t.z1, 'dirt')
          await B.fillBox(t.x0, G, t.z0, t.x1, G, t.z1, 'grass_block')
        }
      }
      let pre = bp.pre.map(b => ({ x: b.x + core.x0, y: b.y + G + 1, z: b.z + core.z0, block: b.block }))
      if (fast && pre.length) { // خندق: باکس‌های کندن با /fill
        const B = lead.bot.builder; const cells = new Set(pre.map(b => b.x + ',' + b.z)); const ys = pre.map(b => b.y); const y0 = Math.min(...ys); const y1 = Math.max(...ys)
        const rows = new Map()
        for (const k of cells) { const [x, z] = k.split(',').map(Number); if (!rows.has(z)) rows.set(z, []); rows.get(z).push(x) }
        const rects = []; const open = new Map()
        for (const z of [...rows.keys()].sort((a, b) => a - b)) {
          const xs = rows.get(z).sort((a, b) => a - b)
          const runs = []; let st = xs[0]; let pv = xs[0]
          for (let i = 1; i <= xs.length; i++) { if (i === xs.length || xs[i] !== pv + 1) { runs.push([st, pv]); st = xs[i]; } pv = xs[i] }
          const next = new Map()
          for (const [xa, xb] of runs) { const key = xa + ':' + xb; const r = open.get(key); if (r && r.z1 === z - 1) { r.z1 = z; next.set(key, r) } else { const nr = { xa, xb, z0: z, z1: z }; rects.push(nr); next.set(key, nr) } }
          open.clear(); for (const [k2, v] of next) open.set(k2, v)
        }
        for (const r of rects) await B.fillBox(r.xa, y0, r.z0, r.xb, y1, r.z1, 'air')
        pre = []
      }
      stages.push({ job: new BuildJob({ name: bp.name, stage: 'برداشتن زمین/درخت و حفر خندق', blocks: [...plan.cut, ...pre], origin: { x: 0, y: 0, z: 0 }, order: 'cols-desc' }) })
      stages.push({ job: new BuildJob({ name: bp.name, stage: 'پر کردن گودال‌ها', blocks: plan.fill, origin: { x: 0, y: 0, z: 0 }, order: 'cols-asc' }) })
    } else {
      G = o.y !== undefined ? o.y - 1 : Math.floor(lp.y) - 1
      if (bp.pre.length) stages.push({ job: new BuildJob({ name: bp.name, stage: 'حفر خندق', blocks: bp.pre, origin: { x: core.x0, y: G + 1, z: core.z0 }, order: 'desc' }) })
    }
    const origin = { x: core.x0, y: G + 1, z: core.z0 }
    // آویزها (فانوس آویز، زنجیر) باید بعد از سقف بالایشان و از بالا به پایین گذاشته شوند
    const late = []; const main = []
    for (const b of bp.blocks) { const sp = parseSpec(b.block); (sp.kind === 'chain' || (sp.kind === 'lantern' && sp.props.hanging === 'true')) ? late.push(b) : main.push(b) }
    stages.push({ gather: true, job: new BuildJob({ name: bp.name, stage: 'ساخت ' + bp.name, blocks: main, origin, order: 'asc' }) })
    if (late.length) stages.push({ gather: true, job: new BuildJob({ name: bp.name, stage: 'آویزها: فانوس و زنجیر', blocks: late, origin, order: 'desc' }) })
    for (const m of team) if (m.bot && m.bot.builder) { m.bot.builder.gather.on = false; m.bot.builder.gather.ledger = {} }
    info.gather = gatherMode
    const pl = { name: bp.name, stages, idx: 0, origin, info, gatherMode, cancelled: false, finished: false, startedAt: Date.now(), cruiseY }
    this.pipeline = pl
    this.job = stages[0].job
    this._runPipeline(pl, team).catch(e => lead.log('error', 'خط لوله‌ی ساخت: ' + e.message))
    return { bp, info, origin }
  }

  // ساخت ساده‌ی یک مرحله‌ای (بدون تسطیح)
  startBuild (bp, origin, bots) {
    if (this.building) throw new Error('یک ساخت در حال انجام است؛ اول buildstop بزن.')
    if (!bots.length) throw new Error('ربات آنلاینی برای ساخت نیست.')
    const job = new BuildJob({ name: bp.name, stage: 'ساخت ' + bp.name, blocks: bp.blocks, origin })
    const pl = { name: bp.name, stages: [{ job }], idx: 0, origin, info: {}, cancelled: false, finished: false, startedAt: Date.now(), cruiseY: null }
    this.pipeline = pl; this.job = job
    this._runPipeline(pl, bots).catch(() => {})
    return job
  }

  stopBuild () {
    const pl = this.pipeline
    if (!pl || pl.finished) return false
    pl.cancelled = true
    for (const st of pl.stages) st.job.cancel()
    for (const m of this.bots.values()) if (m.task && m.task.name === 'build') m.cancelTask()
    return true
  }

  shutdown () { for (const m of this.bots.values()) m.disconnect(true) }
}

module.exports = Fleet
