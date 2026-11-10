// کار ساخت مشترک بین چند ربات: بلاک‌ها لایه‌به‌لایه (از پایین) بین رباتها تقسیم می‌شوند.
const EventEmitter = require('events')
const { parse } = require('./spec')

class BuildJob extends EventEmitter {
  constructor ({ name, blocks, origin, order = 'asc', stage = null }) {
    super()
    this.name = name
    this.stage = stage
    this.order = order
    this.origin = origin
    this.cancelled = false
    this.startedAt = Date.now()
    this.finishedAt = null
    this.layers = new Map() // y -> entries
    this.total = blocks.length
    for (const b of blocks) {
      const e = { x: origin.x + b.x, y: origin.y + b.y, z: origin.z + b.z, block: b.block, spec: parse(b.block), state: 'todo', tries: 0, owner: null, cool: 0, error: null }
      if (!this.layers.has(e.y)) this.layers.set(e.y, [])
      this.layers.get(e.y).push(e)
    }
    this.ys = [...this.layers.keys()].sort((a, b) => order === 'desc' ? b - a : a - b)
    // حالت ستونی: ربات‌ها ستون‌به‌ستون (بالا به پایین یا پایین به بالا) جارو می‌کنند، نه لایه‌به‌لایه؛ مسیر پرواز کوتاه‌تر
    this.colMode = order === 'cols-desc' || order === 'cols-asc'
    this.all = []
    for (const l of this.layers.values()) for (const e of l) this.all.push(e)
    if (this.colMode) {
      this.cols = new Map()
      for (const e of this.all) { const k = e.x + ',' + e.z; if (!this.cols.has(k)) this.cols.set(k, []); this.cols.get(k).push(e) }
      for (const arr of this.cols.values()) arr.sort((a, b) => order === 'cols-desc' ? b.y - a.y : a.y - b.y)
    }
    this.counts = { todo: blocks.length, claimed: 0, done: 0, failed: 0 }
    this.failures = {} // دلیل شکست‌ها
  }

  get finished () { return this.cancelled || this.counts.todo + this.counts.claimed === 0 }

  // پایین‌ترین لایه‌ای که هنوز کار دارد
  currentLayer () {
    for (const y of this.ys) {
      const l = this.layers.get(y)
      if (l.some(e => e.state === 'todo' || e.state === 'claimed')) return y
    }
    return null
  }

  _set (e, state) { this.counts[e.state]--; e.state = state; this.counts[state]++ }

  // نزدیک‌ترین بلاک آماده (todo) در لایه‌ی فعلی؛ hasRef(e) بررسی می‌کند بلاک مرجع برای چسباندن وجود دارد.
  // برمی‌گرداند: entry | 'wait' | null (تمام شد)
  claim (botId, pos, hasRef) {
    if (this.finished) return null
    if (this.colMode) {
      const now = Date.now(); let best = null; let bestD = Infinity; let pending = 0; let fb = null; let fbD = Infinity
      for (const arr of this.cols.values()) {
        let head = null
        for (const e of arr) { if (e.state === 'done' || e.state === 'failed') continue; head = e; break }
        if (!head) continue
        if (head.state === 'claimed' || head.cool > now) { pending++; continue }
        const dx = head.x + 0.5 - pos.x; const dy = head.y - pos.y; const dz = head.z + 0.5 - pos.z
        const d = dx * dx + dz * dz + dy * dy * 0.25
        if (d < fbD) { fbD = d; fb = head }
        if (d < bestD && hasRef(head)) { bestD = d; best = head }
      }
      // اگر هیچ‌کدام تکیه‌گاه ندارند و کسی مشغول نیست، نزدیک‌ترین را امتحان کن (جلوگیری از قفل شدن)
      if (!best && fb && pending === 0 && this.counts.claimed === 0) best = fb
      if (!best) return 'wait'
      best.owner = botId; this._set(best, 'claimed'); return best
    }
    const y = this.currentLayer()
    if (y === null) return null
    const now = Date.now()
    let best = null; let bestD = Infinity
    let fallback = null; let fallbackD = Infinity
    let pending = 0
    for (const e of this.layers.get(y)) {
      if (e.state === 'claimed') { pending++; continue }
      if (e.state !== 'todo') continue
      if (e.cool > now) { pending++; continue }
      const dx = e.x + 0.5 - pos.x; const dz = e.z + 0.5 - pos.z
      const d = dx * dx + dz * dz
      if (d < fallbackD) { fallbackD = d; fallback = e }
      if (d < bestD && hasRef(e)) { bestD = d; best = e }
    }
    let pick = best
    // اگر هیچ‌کدام مرجع ندارند و کسی هم در حال کار نیست، برای جلوگیری از قفل شدن، نزدیک‌ترین را امتحان کن
    if (!pick && fallback && pending === 0) pick = fallback
    if (!pick) return 'wait'
    pick.owner = botId
    this._set(pick, 'claimed')
    return pick
  }

  done (e) { this._set(e, 'done'); this._check() }

  fail (e, message, fatal = false) {
    e.tries++
    e.error = message
    e.owner = null
    this.failures[message] = (this.failures[message] || 0) + 1
    if (fatal || e.tries >= 6) this._set(e, 'failed')
    else { e.cool = Date.now() + 1200 * e.tries; this._set(e, 'todo') }
    this._check()
  }

  release (botId) {
    for (const e of this.all) if (e.state === 'claimed' && e.owner === botId) { e.owner = null; this._set(e, 'todo') }
  }

  cancel () { this.cancelled = true; this._check() }

  _check () {
    if (this.finished && !this.finishedAt) { this.finishedAt = Date.now(); this.emit('finished', this.summary()) }
  }

  summary () {
    const { todo, claimed, done, failed } = this.counts
    const end = this.finishedAt || Date.now()
    return {
      name: this.name, stage: this.stage, origin: this.origin, total: this.total, todo, claimed, done, failed,
      percent: this.total ? Math.round((done + failed) / this.total * 1000) / 10 : 100,
      layer: this.colMode ? null : this.currentLayer(), seconds: Math.round((end - this.startedAt) / 1000),
      cancelled: this.cancelled, finished: !!this.finishedAt,
      topFailures: Object.entries(this.failures).sort((a, b) => b[1] - a[1]).slice(0, 3)
    }
  }
}

module.exports = BuildJob
