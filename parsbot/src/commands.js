// ثبت و اجرای دستورات چت/داشبورد
//
// امنیت: «صاحب بودن» هیچ‌وقت از روی اسم بازیکن جعل‌پذیر نیست.
//  - trusted=true فقط وقتی است که دستور از داشبورد (با توکن) یا کنسول می‌آید، نه از چت.
//  - از چت: یا owner (و بدون ownerPassword) یا بازیکنی که با !login وارد شده.
class CommandRegistry {
  constructor (config, authed = new Set()) {
    this.config = config
    this.authed = authed
    this.map = new Map()
  }

  register (name, def) {
    const entry = { name, aliases: [], desc: '', usage: name, ownerOnly: false, ...def }
    this.map.set(name, entry)
    for (const a of entry.aliases) this.map.set(a, entry)
  }

  get (name) {
    return this.map.get(String(name || '').toLowerCase())
  }

  isOwner (username, trusted = false) {
    if (trusted) return true
    if (this.authed.has(username)) return true
    if (this.config.ownerPassword) return false // با رمز: فقط !login (اسم به‌تنهایی کافی نیست)
    return !!this.config.owner && username === this.config.owner
  }

  // خروجی: false یعنی دستور ناشناخته
  async execute (bot, name, args, username, reply, opts = {}) {
    const def = this.get(name)
    if (!def) return false
    if (def.ownerOnly && !this.isOwner(username, opts.trusted)) {
      reply('⛔ این دستور فقط برای صاحب ربات است.')
      return true
    }
    await def.run(bot, args, username, reply, opts)
    return true
  }

  list () {
    const seen = new Set()
    const out = []
    for (const def of this.map.values()) {
      if (seen.has(def.name)) continue
      seen.add(def.name)
      out.push(def)
    }
    return out
  }
}

// کمک‌تابع‌های اعتبارسنجی ورودی
CommandRegistry.int = (v, def, min, max) => {
  const n = parseInt(v)
  if (Number.isNaN(n)) return def
  return Math.max(min, Math.min(max, n))
}

// متنی که ربات در چت می‌گوید نباید به دستور سرور تبدیل شود
CommandRegistry.safeText = (s) => String(s).replace(/^[/\\]+/, '')

module.exports = CommandRegistry
