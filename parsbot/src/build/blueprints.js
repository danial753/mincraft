// نقشه‌ی ساختمان‌ها: هر نقشه فهرستی از بلاک‌ها در مختصات نسبی (۰،۰،۰ = گوشه‌ی پایین/مینیمم) است.
// بلاک می‌تواند رشته (نام بلاک) باشد. نردبان‌ها فقط به دیوار کناری می‌چسبند.
// فقط از بلاک‌های کامل (و نردبان) استفاده شده تا جهت‌گیری و چسبیدن مشکلی نداشته باشد.

const PALETTES = {
  stone: { wall: 'stone_bricks', mossy: 'mossy_stone_bricks', cracked: 'cracked_stone_bricks', floor: 'polished_andesite', roof: 'dark_oak_planks', trim: 'cobblestone', light: 'glowstone', wood: 'oak_planks' },
  sand: { wall: 'sandstone', mossy: 'cut_sandstone', cracked: 'smooth_sandstone', floor: 'smooth_sandstone', roof: 'terracotta', trim: 'cut_sandstone', light: 'glowstone', wood: 'birch_planks' },
  dark: { wall: 'polished_blackstone_bricks', mossy: 'blackstone', cracked: 'cracked_polished_blackstone_bricks', floor: 'blackstone', roof: 'nether_bricks', trim: 'polished_blackstone', light: 'glowstone', wood: 'crimson_planks' }
}

class Grid {
  constructor () { this.m = new Map(); this.pre = new Map() }
  key (x, y, z) { return x + ',' + y + ',' + z }
  set (x, y, z, b) { this.m.set(this.key(x, y, z), b) }
  del (x, y, z) { this.m.delete(this.key(x, y, z)) }
  has (x, y, z) { return this.m.has(this.key(x, y, z)) }
  fill (x0, y0, z0, x1, y1, z1, b) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, typeof b === 'function' ? b(x, y, z) : b)
      }
    }
  }
  clear (x0, y0, z0, x1, y1, z1) { this.fill(x0, y0, z0, x1, y1, z1, null); for (const [k, v] of this.m) if (v === null) this.m.delete(k) }
  // دیوارهای توخالی (بدون کف و سقف)
  shell (x0, y0, z0, x1, y1, z1, b, t = 1) {
    this.clear(x0, y0, z0, x1, y1, z1)
    this.fill(x0, y0, z0, x1, y1, z1, (x, y, z) => b(x, y, z))
    this.clear(x0 + t, y0, z0 + t, x1 - t, y1, z1 - t)
  }
  // کنگره‌ها (دندانه‌های بالای دیوار) روی لبه‌ی بیرونی
  crenels (x0, z0, x1, z1, y, b) {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1
      if (edge && (x + z) % 2 === 0) this.set(x, y, z, b)
    }
  }
  // سقف هرمی پله‌ای
  roof (x0, z0, x1, z1, y, b) {
    while (x0 <= x1 && z0 <= z1) { this.fill(x0, y, z0, x1, y, z1, b); x0++; z0++; x1--; z1--; y++ }
  }
}

// تنوع ظاهری ثابت (بدون random تا هر بار نقشه یکسان باشد)
function hash (x, y, z) { let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) % 100 }
const wallMix = (p) => (x, y, z) => { const h = hash(x, y, z); return h < 10 ? p.cracked : h < 22 ? p.mossy : p.wall }

function finish (g, name, extra = {}) {
  let minX = Infinity; let minY = Infinity; let minZ = Infinity
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity
  const scan = (k) => {
    const [x, y, z] = k.split(',').map(Number)
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z)
  }
  for (const k of g.m.keys()) scan(k)
  for (const k of g.pre.keys()) scan(k)
  const blocks = []
  const counts = {}
  for (const [k, b] of g.m) {
    const [x, y, z] = k.split(',').map(Number)
    blocks.push({ x: x - minX, y, z: z - minZ, block: b })
    const nm = b.replace(/\[.*$/, '')
    counts[nm] = (counts[nm] || 0) + 1
  }
  const pre = []
  for (const k of g.pre.keys()) { const [x, y, z] = k.split(',').map(Number); pre.push({ x: x - minX, y, z: z - minZ, block: 'air' }) }
  return { name, blocks, pre, counts, size: { x: maxX - minX + 1, y: maxY - Math.min(minY, 0) + 1, z: maxZ - minZ + 1 }, ...extra }
}

// برج مربعی توخالی با کف‌های میانی، نردبان، دریچه‌ی تیر و سقف
function squareTower (g, p, x0, z0, size, h, { roof = true, floors = [], ladder = true } = {}) {
  const x1 = x0 + size - 1; const z1 = z0 + size - 1
  g.clear(x0, 1, z0, x1, h + 6, z1)
  g.shell(x0, 1, z0, x1, h, z1, wallMix(p), 1)
  const cx = x0 + (size >> 1); const cz = z0 + (size >> 1)
  for (const fy of [...floors, h]) {
    g.fill(x0 + 1, fy, z0 + 1, x1 - 1, fy, z1 - 1, (x, y, z) => ((x + z) % 5 === 0 && fy !== h ? p.light : p.wood))
  }
  // دریچه‌های تیر
  for (let y = 3; y < h - 1; y += 5) { for (const [x, z] of [[cx, z0], [cx, z1], [x0, cz], [x1, cz]]) { g.del(x, y, z); g.del(x, y + 1, z) } }
  if (ladder) {
    for (let y = 1; y <= h; y++) g.set(x0 + 1, y, z0 + 1, 'ladder') // به دیوار غربی می‌چسبد
  }
  if (roof) g.roof(x0 - 1, z0 - 1, x1 + 1, z1 + 1, h + 1, p.roof)
  else g.crenels(x0, z0, x1, z1, h + 1, p.trim)
}

function fort (o = {}) {
  const p = PALETTES[o.palette] || PALETTES.stone
  const S = Math.max(25, Math.min(61, (o.size | 0) || 35)) | 1 // فرد
  const wallH = Math.max(6, Math.min(14, (o.wallh | 0) || 9))
  const g = new Grid()
  const c = (S - 1) >> 1
  const mix = wallMix(p)

  // کف حیاط
  g.fill(0, 0, 0, S - 1, 0, S - 1, p.floor)
  // دیوار اصلی (ضخامت ۳) + راهرو بالای دیوار + کنگره
  for (let x = 0; x < S; x++) for (let z = 0; z < S; z++) {
    if (x < 3 || x > S - 4 || z < 3 || z > S - 4) g.fill(x, 1, z, x, wallH, z, mix)
  }
  g.crenels(0, 0, S - 1, S - 1, wallH + 1, p.trim)
  // برج‌های گوشه (۹×۹)
  const T = wallH + 8
  for (const [x, z] of [[-3, -3], [S - 6, -3], [-3, S - 6], [S - 6, S - 6]]) {
    g.fill(x, 0, z, x + 8, 0, z + 8, p.floor)
    squareTower(g, p, x, z, 9, T, { roof: true, floors: [wallH] })
    // در به راهروی دیوار
  }
  // برج‌های میانی دیوار (شرق، غرب، جنوب)
  const M = wallH + 4
  squareTower(g, p, S - 4, c - 3, 7, M, { roof: false, floors: [wallH] })
  squareTower(g, p, -3, c - 3, 7, M, { roof: false, floors: [wallH] })
  squareTower(g, p, c - 3, S - 4, 7, M, { roof: false, floors: [wallH] })
  // دروازه‌خانه در دیوار شمالی (z کوچک)
  g.fill(c - 5, 1, -2, c + 5, wallH + 5, 4, mix)
  g.crenels(c - 5, -2, c + 5, 4, wallH + 6, p.trim)
  g.clear(c - 2, 1, -2, c + 2, 5, 4) // راه ورودی
  g.clear(c - 1, 6, -2, c + 1, 6, 4) // قوس
  g.fill(c - 2, 0, -2, c + 2, 0, 4, p.trim) // کف راه
  // قلعه‌ی مرکزی (keep)
  const K = 15; const kx = c - 7; const kz = c - 7
  const keepH = wallH + 10
  g.clear(kx, 1, kz, kx + K - 1, keepH + 1, kz + K - 1)
  g.shell(kx, 1, kz, kx + K - 1, keepH, kz + K - 1, mix, 2)
  const floorsY = [6, 12]
  for (const fy of [...floorsY, keepH]) {
    g.fill(kx + 2, fy, kz + 2, kx + K - 3, fy, kz + K - 3, (x, y, z) => ((x + z) % 4 === 0 ? p.light : p.wood))
  }
  // نردبان وسط‌دیوار داخلی و حفره‌ی کف‌ها
  const lx = kx + 2; const lz = kz + 2
  for (let y = 1; y <= keepH; y++) { g.del(lx, y, lz); g.set(lx, y, lz, 'ladder') }
  // ورودی (رو به دروازه)
  g.clear(c - 1, 1, kz, c + 1, 4, kz + 1)
  // پنجره‌ها
  for (const wy of [3, 9, 15]) for (let i = 3; i < K - 3; i += 4) {
    for (const [x, z] of [[kx + i, kz], [kx + i, kz + K - 1], [kx, kz + i], [kx + K - 1, kz + i]]) {
      if (x >= c - 1 && x <= c + 1 && z === kz && wy < 5) continue
      if (wy < keepH - 1) { g.del(x, wy, z); g.del(x + (z === kz || z === kz + K - 1 ? 0 : 0), wy + 1, z); if (z === kz || z === kz + K - 1) { g.del(x, wy, z + (z === kz ? 1 : -1)); g.del(x, wy + 1, z + (z === kz ? 1 : -1)) } else { g.del(x + (x === kx ? 1 : -1), wy, z); g.del(x + (x === kx ? 1 : -1), wy + 1, z) } }
    }
  }
  g.crenels(kx, kz, kx + K - 1, kz + K - 1, keepH + 1, p.trim)
  // برجک‌های سقف قلعه
  for (const [x, z] of [[kx, kz], [kx + K - 3, kz], [kx, kz + K - 3], [kx + K - 3, kz + K - 3]]) {
    g.fill(x, keepH + 1, z, x + 2, keepH + 4, z + 2, mix)
    g.clear(x + 1, keepH + 1, z + 1, x + 1, keepH + 4, z + 1)
    g.roof(x - 1, z - 1, x + 3, z + 3, keepH + 5, p.roof)
  }
  // پاک کردن نردبان‌هایی که داخل بلاک جامد افتاده‌اند (حفره‌ی نردبان)
  return finish(g, 'fort', { notes: ['نردبان در گوشه‌ی داخلی هر برج و قلعه', 'دروازه رو به سمت z منفی (شمال)'] })
}

function tower (o = {}) {
  const p = PALETTES[o.palette] || PALETTES.stone
  const size = Math.max(5, Math.min(15, (o.size | 0) || 7)) | 1
  const h = Math.max(6, Math.min(60, (o.height | 0) || 14))
  const g = new Grid()
  g.fill(0, 0, 0, size - 1, 0, size - 1, p.floor)
  const floors = []
  for (let y = 7; y < h - 2; y += 7) floors.push(y)
  squareTower(g, p, 0, 0, size, h, { roof: o.roof !== '0' && o.roof !== 0, floors })
  // در ورودی
  const c = size >> 1
  g.del(c, 1, 0); g.del(c, 2, 0); g.del(c, 3, 0)
  return finish(g, 'tower')
}

function wall (o = {}) {
  const p = PALETTES[o.palette] || PALETTES.stone
  const len = Math.max(5, Math.min(120, (o.length | 0) || 30))
  const h = Math.max(3, Math.min(20, (o.height | 0) || 8))
  const g = new Grid()
  g.fill(0, 0, 0, len - 1, h, 2, wallMix(p))
  g.crenels(0, 0, len - 1, 2, h + 1, p.trim)
  return finish(g, 'wall')
}

function pyramid (o = {}) {
  const p = PALETTES[o.palette] || PALETTES.sand
  const size = Math.max(7, Math.min(61, (o.size | 0) || 21)) | 1
  const g = new Grid()
  g.roof(0, 0, size - 1, size - 1, 0, (x, y, z) => (y % 4 === 3 ? p.trim : p.wall))
  return finish(g, 'pyramid')
}

const { grandCastle } = require('./castle')
const TYPES = {
  castle: { fn: grandCastle, desc: 'قلعه‌ی باشکوه: خندق، پل متحرک، برج‌های گرد با سقف مخروطی، دیوار با کنگره، باغ، فواره، سالن بزرگ و برج مرکزی — هر seed یک قلعه‌ی یکتا', params: 'size=61 seed=123 style=royal|gothic|azure|sun|forest wallh=11' },
  fort: { fn: fort, desc: 'دژ ساده و کوچک (سبک و سریع)', params: 'size=35 wallh=9 palette=stone|sand|dark' },
  tower: { fn: tower, desc: 'برج توخالی با طبقه، نردبان و سقف', params: 'size=7 height=14 roof=1|0 palette=' },
  wall: { fn: wall, desc: 'دیوار دفاعی با کنگره', params: 'length=30 height=8 palette=' },
  pyramid: { fn: pyramid, desc: 'هرم پله‌ای', params: 'size=21 palette=sand' }
}

function generate (type, opts = {}) {
  const t = TYPES[type]
  if (!t) throw new Error(`نقشه‌ی ناشناخته: ${type}. موجود: ${Object.keys(TYPES).join(', ')}`)
  return t.fn(opts)
}

module.exports = { generate, TYPES, PALETTES }
