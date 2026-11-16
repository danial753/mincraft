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
    // تنظیمات «مدیر» و سرعت ساخت (از داشبورد قابل تغییر؛ ذخیره می‌شود)
    this.settings = { speed: 3, auto: false, stallSeconds: 45, supervisor: true }
    this._autoDelay = 80
    this._outcomes = []
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

  static SPEED = { 1: 350, 2: 150, 3: 60, 4: 20, 5: 0 } // تأخیر بین هر بلاک (میلی‌ثانیه) برای هر ربات
  delayMs () { return this.settings.auto ? Math.round(this._autoDelay) : (Fleet.SPEED[this.settings.speed] ?? 60) }
  cmdGapMs () { return this.settings.speed >= 5 && !this.settings.auto ? 1000 : 1150 }
  // حالت خودکار: اگر شکست زیاد شد (سرور لَگ دارد) آهسته‌تر، اگر روان بود سریع‌تر
  recordOutcome (ok) {
    this._outcomes.push(ok ? 1 : 0)
    if (this._outcomes.length > 40) this._outcomes.shift()
    if (this._outcomes.length >= 20 && this._outcomes.length % 10 === 0) {
      const fail = 1 - this._outcomes.reduce((a, b) => a + b, 0) / this._outcomes.length
      if (fail > 0.25) this._autoDelay = Math.min(700, this._autoDelay * 1.6 + 30)
      else if (fail < 0.06) this._autoDelay = Math.max(0, this._autoDelay * 0.8 - 8)
    }
  }
  setSettings (patch = {}) {
    const st = this.settings
    if (patch.speed !== undefined) st.speed = Math.max(1, Math.min(5, parseInt(patch.speed) || 3))
    if (patch.auto !== undefined) st.auto = !!patch.auto
    if (patch.stallSeconds !== undefined) st.stallSeconds = Math.max(10, Math.min(600, parseInt(patch.stallSeconds) || 45))
    if (patch.supervisor !== undefined) st.supervisor = !!patch.supervisor
    this.emit('settings', st)
    return { ...st, delayMs: this.delayMs() }
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
      settings: { ...this.settings, delayMs: this.delayMs() },
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

  async _runJob (job, team, cruiseY, auto = false) {
    job.cruiseY = cruiseY
    const working = new Set()
    const start = (m) => {
      if (working.has(m.id) || !m.bot || !m.bot.builder || !m.bot.entity) return
      working.add(m.id)
      const t = m.beginTask('build', `${job.stage || job.name}`, () => {})
      m.bot.builder.work(job, t).catch(e => m.log('error', 'ساخت: ' + e.message)).finally(() => { if (m.task === t) { job.release(m.id); m.endTask(t) } working.delete(m.id) })
    }
    for (const m of team) start(m)
    // ===== مدیر (ناظر) =====
    // ۱) ربات قطع‌شده/تازه‌وصل‌شده دوباره به ساخت می‌پیوندد
    // ۲) رباتی که در حال چیدن/حرکت است ولی بیش از stallSeconds پیشرفتی نداشته → کارگرش لغو و از نو شروع می‌شود
    //    (۳ بار پشت‌سرهم → ربات قطع و دوباره وصل می‌شود)
    // ۳) claim‌های کهنه‌ی ربات‌های مرده/گیرکرده آزاد می‌شود تا بقیه منتظر همیشگی نمانند
    while (!job.finished) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      const pool = auto ? this.builders() : team.map(m => this.bots.get(m.id)).filter(m => m && m.connection === 'online')
      if (this.settings.supervisor) {
        const stallMs = this.settings.stallSeconds * 1000
        for (const m of pool) {
          const w = m.bot && m.bot.builder
          if (!w || !working.has(m.id)) continue
          if ((w.state === 'placing' || w.state === 'moving') && Date.now() - w.stateSince > stallMs) {
            w.restarts = (w.restarts || 0) + 1; w.stallRun = (w.stallRun || 0) + 1
            m.log('warn', `🛠 مدیر: ${m.id} بیش از ${this.settings.stallSeconds} ثانیه گیر کرده بود؛ از نو شروع می‌کند (${w.restarts} بار)`)
            m.cancelTask(); job.release(m.id); working.delete(m.id); w.state = 'idle'; w.stateSince = Date.now()
            if (w.stallRun >= 3) { w.stallRun = 0; m.log('warn', `🛠 مدیر: ${m.id} مدام گیر می‌کند؛ قطع و دوباره وصل می‌شود`); try { m.connect(m.currentProfile, m.currentOptions) } catch (e) { m.log('error', e.message) } }
          } else if (w.state === 'placing' && Date.now() - w.stateSince < 8000) w.stallRun = 0
        }
        const alive = (id) => { const m = this.bots.get(id); return !!(m && m.connection === 'online' && m.bot && m.bot.entity && working.has(id)) }
        const gathering = (id) => { const m = this.bots.get(id); return !!(m && m.bot && m.bot.builder && m.bot.builder.state === 'gathering') }
        const freed = job.releaseStale((id) => alive(id) || gathering(id), Math.max(stallMs * 2, 90000))
        if (freed) this.emit('log', { t: Date.now(), level: 'warn', message: `🛠 مدیر: ${freed} بلاکِ رهاشده آزاد شد تا ربات‌های دیگر بسازند`, botId: 'مدیر' })
      }
      for (const m of pool) start(m)
    }
    for (let i = 0; i < 100 && working.size; i++) await new Promise(resolve => setTimeout(resolve, 200))
  }

  async _runPipeline (pl, team) {
    try {
      for (let i = 0; i < pl.stages.length && !pl.cancelled; i++) {
        pl.idx = i
        const st = pl.stages[i]
        this.job = st.job
        for (const m of team) if (m.bot && m.bot.builder) m.bot.builder.gather.on = !!(pl.gatherMode && st.gather)
        for (const m of team) m.log('info', `🏗 مرحله ${i + 1}/${pl.stages.length}: ${st.job.stage} (${st.job.total} بلاک)`)
        if (st.job.total) await this._runJob(st.job, team, pl.cruiseY, pl.auto)
      }
      if (pl.post && !pl.cancelled) { try { await pl.post() } catch (e) { if (team[0]) team[0].log('warn', 'آب فواره: ' + e.message) } }
    } finally {
      pl.finished = true; pl.finishedAt = Date.now()
      const s = this._buildStatus()
      if (team[0]) team[0].log('info', `🏁 ${pl.cancelled ? 'ساخت متوقف شد' : 'ساخت تمام شد'}: ${s.done} بلاک، ${s.failed} ناموفق، ${s.seconds} ثانیه`)
      if (team[0] && s.failed > 0) team[0].log('warn', '⚠ دلیل‌های اصلی شکست: ' + s.topFailures.map(([k, v]) => `${k} (${v})`).join(' | '))
      this.emit('buildfinished', s)
      this.lastPipeline = pl; this.pipeline = null
    }
  }

  get building () { return !!(this.pipeline && !this.pipeline.finished) }

  // پروژه‌ی کامل: نقشه + تسطیح زمین. at={x,z[,y]} گوشه‌ی کمینه‌ی نقشه.
  async project (args) {
    if (this.building || this._planning) throw new Error('یک ساخت در حال انجام یا آماده‌سازی است؛ صبر کن یا buildstop بزن.')
    if (args.dry) return this._project(args)
    this._planning = true
    try { return await this._project(args) } finally { this._planning = false }
  }

  // جای بازیکنِ صاحب: از موجودیت دیده‌شده توسط ربات‌ها، یا با دستور /data (نیاز به OP)
  async ownerPos (lead) {
    const owner = this.config.owner
    if (!owner) return null
    const low = String(owner).toLowerCase()
    let real = null
    for (const m of this.online()) for (const [n, p] of Object.entries(m.bot.players || {})) {
      if (n.toLowerCase() !== low) continue
      real = n
      if (p.entity) return { x: p.entity.position.x, y: p.entity.position.y, z: p.entity.position.z, name: n }
    }
    if (real && lead.bot.builder) {
      const r = await lead.bot.builder.cmd(`/data get entity ${real} Pos`, 1800).catch(() => '')
      const m = /\[(-?[\d.]+)d?, (-?[\d.]+)d?, (-?[\d.]+)d?\]/.exec(r)
      if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]), name: real }
    }
    return null
  }

  async _project ({ type, opts = {}, team, at = null, flatten = true, force = false, dry = false }) {
    if (!team.length) throw new Error('ربات آماده‌ای (نقش builder) برای ساخت نیست.')
    if (!dry && !(opts.gather && opts.gather !== '0')) {
      // بدون gather ساخت فقط در creative ممکن است؛ وگرنه همه‌ی بلاک‌ها بی‌صدا شکست می‌خورند
      const notCreative = team.filter(m => !(m.bot.game && m.bot.game.gameMode === 'creative'))
      if (notCreative.length) throw new Error(`ربات‌های ${notCreative.map(m => m.id).join(', ')} در حالت creative نیستند. ربات‌ها را OP کن (در کنسول سرور: op ${notCreative[0].id}) و در کنسول ما بنویس: all creative — یا با gather=1 بساز تا خودشان مصالح جمع کنند. برای بررسی دقیق: all doctor`)
    }
    let bp = generate(type, opts)
    const gatherMode = !!(opts.gather && opts.gather !== '0')
    const lead = team[0]
    if (gatherMode) {
      const wood = lead.bot.brain ? lead.bot.brain.detectWood() : 'oak'
      bp = survivalize(bp, wood)
      bp.title = (bp.title || bp.name) + ` — جمع‌آوری مصالح توسط ربات‌ها (چوب: ${wood})`
    }
    const lp = lead.bot.entity.position
    let o; let near = 'ربات'
    if (at) o = { x: Math.floor(at.x), z: Math.floor(at.z), y: at.y }
    else {
      // پیش‌فرض: جلوی بازیکن؛ قلعه جنوبِ بازیکن ساخته می‌شود و دروازه (شمال قلعه) رو به اوست
      const pp = dry ? null : await this.ownerPos(lead)
      if (pp) { o = { x: Math.floor(pp.x - bp.size.x / 2), z: Math.floor(pp.z) + 6 }; near = pp.name }
      else o = { x: Math.floor(lp.x) + 10, z: Math.floor(lp.z) + 10 }
    }
    { // همه‌ی بلاک‌های نقشه باید در این نسخه‌ی ماینکرفت وجود داشته باشند
      const reg = lead.bot.registry; const miss = []
      for (const n of Object.keys(bp.counts)) {
        const sp = adaptSpec(parseSpec(n), reg)
        if (!reg.blocksByName[sp.name] && !reg.itemsByName[sp.name]) miss.push(n)
      }
      if (miss.length && !opts.force) throw new Error(`این بلاک‌ها در ماینکرفت ${lead.bot.version} وجود ندارند: ${miss.join(', ')} — سبک دیگری انتخاب کن (style=) یا force=1`)
    }
    const core = { x0: o.x, z0: o.z, x1: o.x + bp.size.x - 1, z1: o.z + bp.size.z - 1 }
    const info = { blocks: bp.blocks.length, size: bp.size, seed: bp.seed, style: bp.style, counts: bp.counts, near, corner: o }
    if (dry) return { bp, info }
    const stages = []; let G; let cruiseY = null
    let fastOpBots = []; let fastRunParallel = async () => {}
    if (flatten) {
      const ring = Math.max(0, Math.min(12, opts.ring !== undefined ? parseInt(opts.ring) || 0 : 4))
      const rect = { x0: core.x0 - ring, z0: core.z0 - ring, x1: core.x1 + ring, z1: core.z1 + ring }
      lead.log('info', `🗺 نقشه‌برداری زمین (${rect.x1 - rect.x0 + 1}×${rect.z1 - rect.z0 + 1})...`)
      // نقشه‌برداری هم‌زمان: قطعه‌ها بین همه‌ی ربات‌ها تقسیم می‌شود
      const surveyors = team.filter(m => m.bot && m.bot.builder).slice(0, 6)
      const tiles = lead.bot.builder.tilesOf(rect)
      const parts = surveyors.map(() => [])
      tiles.forEach((t, i) => parts[i % surveyors.length].push(t))
      const results = await Promise.all(surveyors.map((m, i) => m.bot.builder.surveyTiles(parts[i], rect, Math.floor(lp.y) + 40)))
      const cols = new Map(); for (const r of results) for (const [k, v] of r) cols.set(k, v)
      const opBots = []
      if (!opts.slow) for (const m of team) { if (m.bot && m.bot.builder && await m.bot.builder.canCommand().catch(() => false)) opBots.push(m) }
      const fast = opBots.length > 0
      fastOpBots = opBots
      // صف کارهای /fill بین همه‌ی ربات‌های OP پخش می‌شود (هر ربات حدود ۱ دستور در ثانیه می‌تواند)
      const runParallel = fastRunParallel = async (jobs) => { const q = [...jobs]; await Promise.all(opBots.map(async (m) => { while (q.length) { const j = q.shift(); try { await j(m.bot.builder) } catch (e) { m.log('warn', 'fill: ' + e.message) } } })) }
      const plan = planFlatten(cols, core, ring, o.y !== undefined ? o.y - 1 : null, fast)
      if (plan.waterFrac > 0.3 && !force) throw new Error(`بیشتر این زمین آب است (${Math.round(plan.waterFrac * 100)}٪). جای دیگری انتخاب کن (at=x,z) یا force=1 بزن.`)
      if (plan.total > 80000 && !force) throw new Error(`تسطیح این زمین ${plan.total} بلاک کار دارد (خیلی ناهموار). جای دیگری انتخاب کن یا force=1 بزن.`)
      G = plan.level
      let maxTop = G; for (const c of cols.values()) maxTop = Math.max(maxTop, c.top)
      cruiseY = maxTop + 6
      info.flatten = { level: G, cut: plan.cut.length, fill: plan.fill.length, range: plan.range, fast, tiles: plan.tiles.length }
      if (fast) {
        lead.log('info', `⚡ تسطیح سریع با /fill (${plan.tiles.length} قطعه، ${opBots.length} ربات)...`)
        await runParallel(plan.tiles.map(t => async (B) => {
          const top = Math.min(t.top + 1, G + 120)
          if (top > G) await B.fillBox(t.x0, G + 1, t.z0, t.x1, top, t.z1, 'air')
          if (t.minG < G) await B.fillBox(t.x0, t.minG, t.z0, t.x1, G - 1, t.z1, 'dirt')
          await B.fillBox(t.x0, G, t.z0, t.x1, G, t.z1, 'grass_block')
        }))
        if (plan.ringRects.length) {
          lead.log('info', `⚡ دامنه‌ی شیب‌دار اطراف با /fill (${plan.ringRects.length} مستطیل)...`)
          const vol = (r, a, b) => (r.xb - r.xa + 1) * (r.z1 - r.z0 + 1) * (b - a + 1)
          await runParallel(plan.ringRects.map(r => async (B) => {
            if (r.airFrom !== null && vol(r, r.airFrom, r.airTo) <= 30000) await B.fillBox(r.xa, r.airFrom, r.z0, r.xb, r.airTo, r.z1, 'air')
            if (r.dirtFrom !== null && r.dirtFrom <= r.dirtTo) await B.fillBox(r.xa, r.dirtFrom, r.z0, r.xb, r.dirtTo, r.z1, 'dirt')
            if (r.grass) await B.fillBox(r.xa, r.T, r.z0, r.xb, r.T, r.z1, 'grass_block')
          }))
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
        await runParallel(rects.map(r => async (BB) => { await BB.fillBox(r.xa, y0, r.z0, r.xb, y1, r.z1, 'air') }))
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
    const late = []; const main = []; const water = []
    for (const b of bp.blocks) {
      const sp = parseSpec(b.block)
      if (sp.name === 'water') water.push(b)
      else (sp.kind === 'chain' || (sp.kind === 'lantern' && sp.props.hanging === 'true')) ? late.push(b) : main.push(b)
    }
    // آب خندق: با OP مستقیم با /fill (بدون سطل)؛ بدون OP در مرحله‌ی آخر (تا اگر سطل جواب نداد جلوی ساخت را نگیرد)
    let waterStage = water
    let postWater = []
    if (flatten && water.length && typeof fastOpBots !== 'undefined' && fastOpBots.length) {
      const ys = [...new Set(water.filter(b => b.y < 0).map(b => b.y))] // فقط آب خندق (زیر سطح زمین)؛ آب فواره بعد از ساخت حوضچه
      for (const wy of ys) {
        const cells = new Set(water.filter(b => b.y === wy).map(b => (b.x + core.x0) + ',' + (b.z + core.z0)))
        const rows = new Map()
        for (const k of cells) { const [x, z] = k.split(',').map(Number); if (!rows.has(z)) rows.set(z, []); rows.get(z).push(x) }
        const rects = []; let open = new Map()
        for (const z of [...rows.keys()].sort((a, b) => a - b)) {
          const xs = rows.get(z).sort((a, b) => a - b); const next = new Map(); let st = xs[0]; let pv = xs[0]; const runs = []
          for (let i = 1; i <= xs.length; i++) { if (i === xs.length || xs[i] !== pv + 1) { runs.push([st, pv]); st = xs[i] } pv = xs[i] }
          for (const [xa, xb] of runs) { const key = xa + ':' + xb; const r = open.get(key); if (r && r.z1 === z - 1) { r.z1 = z; next.set(key, r) } else { const nr = { xa, xb, z0: z, z1: z }; rects.push(nr); next.set(key, nr) } }
          open = next
        }
        lead.log('info', `💧 آب خندق با /fill (${rects.length} مستطیل)...`)
        await fastRunParallel(rects.map(r => async (B) => { await B.fillBox(r.xa, G + 1 + wy, r.z0, r.xb, G + 1 + wy, r.z1, 'water') }))
      }
      postWater = water.filter(b => b.y >= 0) // آب فواره: بعد از تمام شدن ساخت با /setblock
      waterStage = []
    }
    stages.push({ gather: true, job: new BuildJob({ name: bp.name, stage: 'ساخت ' + bp.name, blocks: main, origin, order: 'asc' }) })
    if (late.length) stages.push({ gather: true, job: new BuildJob({ name: bp.name, stage: 'آویزها: فانوس و زنجیر', blocks: late, origin, order: 'desc' }) })
    if (waterStage.length) stages.push({ job: new BuildJob({ name: bp.name, stage: 'آب خندق (با سطل)', blocks: waterStage, origin, order: 'asc', maxTries: 2 }) })
    for (const m of team) if (m.bot && m.bot.builder) { m.bot.builder.gather.on = false; m.bot.builder.gather.ledger = {} }
    info.gather = gatherMode
    const postFn = postWater.length ? async () => { const B = fastOpBots[0].bot.builder; for (const w of postWater) await B.cmd(`/setblock ${origin.x + w.x} ${origin.y + w.y} ${origin.z + w.z} water`, 1200).catch(() => {}) } : null
    const pl = { post: postFn, name: bp.name, stages, idx: 0, origin, info, gatherMode, auto: team.length === this.builders().length, cancelled: false, finished: false, startedAt: Date.now(), cruiseY }
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

  // مرحله‌ی جاری را رد کن و برو مرحله‌ی بعد (مثلاً وقتی تسطیح دامنه خیلی کند است)
  skipStage () {
    const pl = this.pipeline
    if (!pl || pl.finished) return false
    const st = pl.stages[pl.idx]
    if (!st || st.job.finished) return false
    st.job.cancel()
    for (const m of this.bots.values()) if (m.task && m.task.name === 'build') m.cancelTask()
    return true
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
