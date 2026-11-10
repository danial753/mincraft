// ابزارهای ساخت نقشه: شبکه‌ی بلاک، دایره/استوانه، سقف مخروطی/هرمی/شیب‌دار
const { OPPOSITE } = require('./spec')

class Grid {
  constructor () { this.m = new Map(); this.pre = new Map() }
  key (x, y, z) { return x + ',' + y + ',' + z }
  set (x, y, z, b) { this.m.set(this.key(x, y, z), b) }
  get (x, y, z) { return this.m.get(this.key(x, y, z)) }
  del (x, y, z) { this.m.delete(this.key(x, y, z)) }
  has (x, y, z) { return this.m.has(this.key(x, y, z)) }
  // مراحل «قبل از ساخت» (کندن خندق و ...) → در مرحله‌ی تسطیح زمین اجرا می‌شود
  dig (x, y, z) { this.pre.set(this.key(x, y, z), 'air') }
  fill (x0, y0, z0, x1, y1, z1, b) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, typeof b === 'function' ? b(x, y, z) : b)
      }
    }
  }
  carve (x0, y0, z0, x1, y1, z1) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.del(x, y, z)
  }
  shell (x0, y0, z0, x1, y1, z1, b, t = 1) {
    this.carve(x0, y0, z0, x1, y1, z1)
    this.fill(x0, y0, z0, x1, y1, z1, b)
    this.carve(x0 + t, y0, z0 + t, x1 - t, y1, z1 - t)
  }
}

// ---- اعداد تصادفی با seed (هر seed یک قلعه‌ی یکتا و تکرارپذیر) ----
function rng (seed) {
  let a = (seed >>> 0) || 1
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const r = { next, int: (a, b) => a + Math.floor(next() * (b - a + 1)), chance: (p) => next() < p, pick: (arr) => arr[Math.floor(next() * arr.length)] }
  return r
}
function hash (x, y, z) { let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) % 100 }

// ---- مشخصات ----
const st = (name, facing, half = 'bottom') => `${name}[facing=${facing},half=${half}]`
const slab = (name, type = 'bottom') => `${name}[type=${type}]`
const door = (name, facing) => `${name}[facing=${facing}]`
const axis = (name, ax = 'y') => `${name}[axis=${ax}]`
const inward = (dx, dz) => Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'west' : 'east') : (dz > 0 ? 'north' : 'south') // جهتی که به مرکز می‌رود

const inDisc = (dx, dz, r) => dx * dx + dz * dz <= r * r + r
function disc (g, cx, cz, r, y0, y1, fn) {
  for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
    if (!inDisc(x - cx, z - cz, r)) continue
    for (let y = y0; y <= y1; y++) g.set(x, y, z, typeof fn === 'function' ? fn(x, y, z) : fn)
  }
}
function ring (g, cx, cz, r, y0, y1, fn, t = 1) {
  for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
    if (!inDisc(x - cx, z - cz, r) || inDisc(x - cx, z - cz, r - t)) continue
    for (let y = y0; y <= y1; y++) g.set(x, y, z, typeof fn === 'function' ? fn(x, y, z) : fn)
  }
}
const ringCells = (cx, cz, r, t = 1) => { const out = []; for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) if (inDisc(x - cx, z - cz, r) && !inDisc(x - cx, z - cz, r - t)) out.push([x, z]); return out }

// سقف مخروطی با پله‌های ظریف روی لبه‌ها. steep: هر شعاع چند لایه بماند
function coneRoof (g, cx, cz, r, y0, p, steep = 2) {
  let R = r + 1; let y = y0; let k = 0
  while (R >= 0) {
    const nextR = (k % steep === steep - 1) ? R - 1 : R
    for (let x = cx - R; x <= cx + R; x++) for (let z = cz - R; z <= cz + R; z++) {
      if (!inDisc(x - cx, z - cz, R)) continue
      const covered = nextR >= 0 && inDisc(x - cx, z - cz, nextR)
      if (covered) g.set(x, y, z, p.roof); else g.set(x, y, z, st(p.roofStairs, inward(x - cx, z - cz)))
    }
    if (nextR < R) R = nextR; else if (k % steep === steep - 1) R--
    y++; k++
    if (k > 200) break
  }
  return y // اولین لایه‌ی بالای سقف
}

// سقف هرمی پله‌ای برای مستطیل
function pyramidRoof (g, x0, z0, x1, z1, y0, p) {
  let y = y0
  while (x0 <= x1 && z0 <= z1) {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1
      if (!edge) { g.set(x, y, z, p.roof); continue }
      let f
      if (x === x0 && z > z0 && z < z1) f = 'east'
      else if (x === x1 && z > z0 && z < z1) f = 'west'
      else if (z === z0) f = 'south'
      else f = 'north'
      g.set(x, y, z, st(p.roofStairs, f))
    }
    x0++; z0++; x1--; z1--; y++
  }
  return y
}

// سقف شیب‌دار (gable) با خط الرأس در امتداد محور. عرض فرد بهتر است.
function gableRoof (g, x0, z0, x1, z1, y0, p, ridgeAxis, wallFn) {
  const alongX = ridgeAxis === 'x'
  const a0 = alongX ? z0 : x0; const a1 = alongX ? z1 : x1 // امتداد عرضی
  const b0 = alongX ? x0 : z0; const b1 = alongX ? x1 : z1 // امتداد طولی
  let k = 0
  for (let a = a0 - 1; a <= a1 + 1; a++) {
    const d = Math.min(a - (a0 - 1), (a1 + 1) - a) // فاصله از لبه
    const y = y0 + d
    const half = (a1 + 1 - (a0 - 1)) / 2
    const dirLow = a < (a0 + a1) / 2
    for (let b = b0 - 1; b <= b1 + 1; b++) {
      const x = alongX ? b : a; const z = alongX ? a : b
      const center = (a0 - 1) + half - 0.5
      if (Math.abs(a - center) < 0.51 && (a1 - a0 + 3) % 2 === 1) g.set(x, y, z, p.roof)
      else {
        const f = alongX ? (dirLow ? 'south' : 'north') : (dirLow ? 'east' : 'west')
        g.set(x, y, z, st(p.roofStairs, f))
      }
    }
    // پر کردن مثلث دیوار دو سر
    if (wallFn) for (const b of [b0, b1]) { for (let yy = y0; yy < y; yy++) { const x = alongX ? b : a; const z = alongX ? a : b; if (a >= a0 && a <= a1) g.set(x, yy, z, wallFn(x, yy, z)) } }
    k++
  }
}

module.exports = { Grid, rng, hash, st, slab, door, axis, inward, inDisc, disc, ring, ringCells, coneRoof, pyramidRoof, gableRoof, OPPOSITE }
