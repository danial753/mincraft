// مدیر یک ربات: اتصال، قطع، اتصال مجدد (با backoff)، کار فعلی (task) و پلاگین‌ها
const EventEmitter = require('events')
const mineflayer = require('mineflayer')
const CommandRegistry = require('./commands')

function safeReason (reason) {
  try { return typeof reason === 'string' ? reason : JSON.stringify(reason) } catch { return String(reason) }
}

const FEATURES = {
  movement: './plugins/movement',
  combat: './plugins/combat',
  farming: './plugins/farming',
  survival: './plugins/survival',
  builder: './plugins/builder',
  survivor: './plugins/survivor',
  chat: './plugins/chat'
}
// پلاگین‌هایی که به pathfinder (movement) نیاز دارند
const NEEDS_MOVEMENT = new Set(['combat', 'farming', 'builder', 'survivor'])

class BotManager extends EventEmitter {
  constructor (config, fleet = null, id = 'main') {
    super()
    this.config = config
    this.fleet = fleet
    this.id = id
    this.bot = null
    this.commands = new CommandRegistry(config, fleet ? fleet.authed : new Set())
    this.logs = []
    this.connection = 'disconnected' // disconnected | connecting | online
    this.mode = { name: 'idle', detail: null }
    this.task = null
    this._taskSeq = 0
    this.currentProfile = null
    this.currentOptions = null
    this.manualStop = false
    this.reconnectTimer = null
    this.retries = 0
    this.greeted = false
    this.msaCode = null
    this.role = config.defaultRole || 'builder'
  }

  log (level, message) {
    const entry = { t: Date.now(), level, message: String(message), botId: this.id }
    this.logs.push(entry)
    if (this.logs.length > 400) this.logs.shift()
    this.emit('log', entry)
  }

  setMode (name, detail = null) {
    this.mode = { name, detail }
    this.emit('mode', this.mode)
  }

  // ---- مدیریت کار فعلی: هر کار جدید، کار قبلی را لغو می‌کند ----
  beginTask (name, detail, cancel) {
    this.cancelTask()
    const t = { id: ++this._taskSeq, name, cancel, cancelled: false }
    this.task = t
    this.setMode(name, detail)
    return t
  }

  endTask (t) {
    if (this.task === t) { this.task = null; this.setMode('idle') }
  }

  cancelTask () {
    const t = this.task
    if (!t) return false
    this.task = null
    t.cancelled = true
    try { if (t.cancel) t.cancel() } catch {}
    this.setMode('idle')
    return true
  }

  status () {
    const b = this.bot
    const base = {
      id: this.id,
      role: this.role,
      goals: this.bot && this.bot.brain ? { current: this.bot.brain.current ? this.bot.brain.current.type + ' ' + (this.bot.brain.current.name || '') : null, queued: this.bot.brain.goals.length } : null,
      brand: this.config.brand,
      connection: this.connection,
      profile: this.currentProfile,
      mode: this.mode,
      msaCode: this.msaCode,
      server: this.currentOptions ? `${this.currentOptions.host}:${this.currentOptions.port || 25565}` : null,
      username: b ? b.username : (this.currentOptions ? this.currentOptions.username : null),
      players: b ? Object.keys(b.players || {}) : []
    }
    if (!b || !b.entity) return base
    return {
      ...base,
      version: b.version,
      health: b.health,
      food: b.food,
      gameMode: b.game ? b.game.gameMode : null,
      ping: b.player ? b.player.ping : null,
      position: {
        x: +b.entity.position.x.toFixed(1),
        y: +b.entity.position.y.toFixed(1),
        z: +b.entity.position.z.toFixed(1)
      },
      dimension: b.game ? b.game.dimension : null
    }
  }

  connect (profileName, overrides = {}) {
    this.disconnect(true)
    const profile = (this.config.profiles || {})[profileName] || {}
    const clean = {}
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined && v !== null && v !== '') clean[k] = v
    }
    const opts = { logErrors: false, hideErrors: true, ...profile, ...clean }
    if (!opts.host) throw new Error('آدرس سرور مشخص نیست (host)')
    opts.username = opts.username || this.config.brand
    opts.auth = opts.auth || 'offline'
    opts.port = parseInt(opts.port || 25565)
    if (opts.version === 'false' || opts.version === '') opts.version = false

    this.currentProfile = profileName || 'custom'
    this.currentOptions = opts
    this.manualStop = false
    this.connection = 'connecting'
    this.msaCode = null
    this.log('info', `🔌 اتصال به ${opts.host}:${opts.port} با نام ${opts.username} (احراز هویت: ${opts.auth})`)

    const bot = mineflayer.createBot({
      ...opts,
      onMsaCode: (code) => {
        this.msaCode = code
        this.log('msa', `🔑 ورود مایکروسافت: به ${code.verification_uri} برو و کد ${code.user_code} را وارد کن`)
        this.emit('msa', code)
      }
    })
    this.bot = bot
    this.commands = new CommandRegistry(this.config, this.fleet ? this.fleet.authed : new Set())

    const ctx = {
      manager: this,
      fleet: this.fleet,
      config: this.config,
      commands: this.commands,
      log: (l, m) => this.log(l, m),
      setMode: (n, d) => this.setMode(n, d),
      task: {
        begin: (n, d, cancel) => this.beginTask(n, d, cancel),
        end: (t) => this.endTask(t),
        cancel: () => this.cancelTask()
      }
    }

    // ترتیب مهم است: pathfinder قبل از pvp و collectblock
    const on = this.config.features || {}
    for (const [key, path] of Object.entries(FEATURES)) {
      if (on[key] === false) continue
      if (NEEDS_MOVEMENT.has(key) && on.movement === false) {
        this.log('warn', `پلاگین ${key} به movement نیاز دارد و غیرفعال شد.`)
        continue
      }
      try {
        require(path)(bot, ctx)
      } catch (e) {
        this.log('error', `پلاگین ${key} بارگذاری نشد: ${e.message}`)
      }
    }

    bot.on('login', () => {
      if (this.bot !== bot) return
      this.connection = 'online'
      this.msaCode = null
      this.log('info', `✅ وارد سرور شدم: ${bot.username} (نسخه ${bot.version})`)
    })
    bot.on('spawn', () => {
      if (this.bot !== bot) return
      this.connection = 'online'
      this.retries = 0
      if (!this.greeted) {
        this.greeted = true
        setTimeout(() => { if (this.bot === bot && this.fleet) this.fleet.applyRole(this) }, 2500)
        this.log('info', '🌍 اسپاون شدم و آماده‌ام!')
        // فقط ربات اول (leader) سلام می‌کند تا چت شلوغ نشود
        const isLeader = !this.fleet || this.fleet.leader() === this
        if (this.config.greet && isLeader) setTimeout(() => { try { if (this.bot === bot) bot.chat(this.config.greet) } catch {} }, 1500)
      }
    })
    bot.on('kicked', (reason) => {
      if (this.bot !== bot) return
      const r = safeReason(reason)
      this.log('warn', '⛔ کیک شدم: ' + r)
      if (/ban/i.test(r)) { this.manualStop = true; this.log('warn', 'به‌نظر می‌رسد بن شده‌ام؛ اتصال مجدد خودکار متوقف شد.') }
    })
    bot.on('error', (err) => { if (this.bot === bot) this.log('error', '❌ ' + (err.message || err)) })
    bot.on('end', (reason) => {
      if (this.bot !== bot) return // اتصال قدیمی است
      this.connection = 'disconnected'
      this.bot = null
      this.greeted = false
      this.cancelTask()
      this.setMode('idle')
      this.log('info', '🔌 اتصال قطع شد' + (reason ? ': ' + safeReason(reason) : ''))
      const rc = this.config.reconnect
      if (!this.manualStop && rc && rc.enabled) {
        const maxRetries = rc.maxRetries || 12
        if (this.retries >= maxRetries) return this.log('warn', `بعد از ${maxRetries} تلاش، اتصال مجدد متوقف شد.`)
        // backoff نمایی: 10s, 20s, 40s ... حداکثر ۵ دقیقه
        const delay = Math.min((rc.delayMs || 10000) * 2 ** this.retries, 300000)
        this.retries++
        this.log('info', `🔄 تلاش مجدد (${this.retries}/${maxRetries}) تا ${Math.round(delay / 1000)} ثانیه دیگر...`)
        this.reconnectTimer = setTimeout(() => {
          try { this.connect(this.currentProfile, this.currentOptions) } catch (e) { this.log('error', e.message) }
        }, delay)
      }
    })
    return bot
  }

  disconnect (silent = false) {
    clearTimeout(this.reconnectTimer)
    this.manualStop = true
    this.cancelTask()
    if (this.bot) {
      const b = this.bot
      this.bot = null
      try { b.quit('خروج به دستور کاربر') } catch {}
    }
    this.connection = 'disconnected'
    if (!silent) this.log('info', 'ربات خاموش شد.')
  }

  sendChat (message) {
    if (!this.bot) throw new Error('ربات متصل نیست')
    this.bot.chat(String(message).slice(0, 250))
    this.log('chat', `[من] ${message}`)
  }

  // از داشبورد/کنسول (احراز هویت‌شده) → trusted. quiet: جواب‌ها در چت بازی گفته نشود
  async runCommand (name, args, username = 'console', opts = {}) {
    if (!this.bot) throw new Error('ربات متصل نیست')
    const replies = []
    const ok = await this.commands.execute(this.bot, name, args, username, (m) => {
      replies.push(String(m))
      if (opts.quiet) this.log('info', '↩ ' + m)
      else { try { this.bot.chat(String(m).slice(0, 250)) } catch {} }
    }, { trusted: true })
    if (!ok) throw new Error(`دستور ناشناخته: ${name}`)
    return replies
  }
}

module.exports = BotManager
