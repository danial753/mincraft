// قلعه‌ی باشکوه (Grand Castle) — طراحی رویه‌ای با seed
//
// الهام از قلعه‌های محبوب جامعه‌ی ماینکرفت: دیوار حصار با برج‌های گرد گوشه، دروازه‌خانه با پل متحرک روی خندق،
// قلعه‌ی مرکزی با سالن بزرگ و برج اصلی، باغ و فواره‌ی حیاط، و تنوع مصالح (سنگ، چوب، شیشه، فانوس).
// هر seed یک ترکیب یکتا از سبک، ارتفاع‌ها، تعداد برج‌ها، باغ و درخت‌ها می‌سازد (تکرارپذیر).
//
// مختصات: y=0 اولین لایه‌ی بالای زمین، y=-1 سطح زمین (چمن)، y<-1 زیر زمین (خندق).
const G = require('./grid')
const { Grid, rng, hash, st, axis, inDisc, disc, ring, ringCells, coneRoof, pyramidRoof, gableRoof } = G

const STYLES = {
  royal: { wall: 'stone_bricks', alt: 'mossy_stone_bricks', crack: 'cracked_stone_bricks', pillar: 'chiseled_stone_bricks', trim: 'polished_andesite', stairs: 'stone_brick_stairs', slab: 'stone_brick_slab', wallBlk: 'stone_brick_wall', roof: 'dark_oak_planks', roofStairs: 'dark_oak_stairs', wood: 'spruce_planks', log: 'spruce_log', fence: 'dark_oak_fence', flag1: 'red_wool', flag2: 'white_wool', carpet: 'red_carpet', flowers: ['poppy', 'dandelion', 'red_tulip', 'oxeye_daisy', 'azure_bluet'] },
  gothic: { wall: 'polished_blackstone_bricks', alt: 'blackstone', crack: 'cracked_polished_blackstone_bricks', pillar: 'chiseled_polished_blackstone', trim: 'polished_blackstone', stairs: 'polished_blackstone_brick_stairs', slab: 'polished_blackstone_brick_slab', wallBlk: 'polished_blackstone_brick_wall', roof: 'nether_bricks', roofStairs: 'nether_brick_stairs', wood: 'crimson_planks', log: 'crimson_stem', fence: 'crimson_fence', flag1: 'purple_wool', flag2: 'black_wool', carpet: 'purple_carpet', flowers: ['wither_rose', 'allium', 'blue_orchid', 'cornflower'] },
  azure: { wall: 'quartz_bricks', alt: 'smooth_quartz', crack: 'quartz_bricks', pillar: 'quartz_pillar', trim: 'chiseled_quartz_block', stairs: 'quartz_stairs', slab: 'quartz_slab', wallBlk: 'diorite_wall', roof: 'prismarine_bricks', roofStairs: 'prismarine_brick_stairs', wood: 'birch_planks', log: 'birch_log', fence: 'birch_fence', flag1: 'blue_wool', flag2: 'white_wool', carpet: 'blue_carpet', flowers: ['cornflower', 'blue_orchid', 'azure_bluet', 'lily_of_the_valley', 'white_tulip'] },
  sun: { wall: 'sandstone', alt: 'cut_sandstone', crack: 'smooth_sandstone', pillar: 'chiseled_sandstone', trim: 'cut_sandstone', stairs: 'sandstone_stairs', slab: 'sandstone_slab', wallBlk: 'sandstone_wall', roof: 'red_sandstone', roofStairs: 'red_sandstone_stairs', wood: 'acacia_planks', log: 'acacia_log', fence: 'acacia_fence', flag1: 'orange_wool', flag2: 'yellow_wool', carpet: 'orange_carpet', flowers: ['orange_tulip', 'dandelion', 'poppy'] },
  forest: { wall: 'cobblestone', alt: 'mossy_cobblestone', crack: 'andesite', pillar: 'stripped_spruce_log', trim: 'stone_bricks', stairs: 'cobblestone_stairs', slab: 'cobblestone_slab', wallBlk: 'cobblestone_wall', roof: 'spruce_planks', roofStairs: 'spruce_stairs', wood: 'oak_planks', log: 'dark_oak_log', fence: 'spruce_fence', flag1: 'green_wool', flag2: 'white_wool', carpet: 'green_carpet', flowers: ['dandelion', 'lily_of_the_valley', 'oxeye_daisy', 'pink_tulip'] }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const odd = (v) => (v % 2 === 0 ? v + 1 : v)

function grandCastle (o = {}) {
  const seed = parseInt(o.seed) || (Math.floor(Math.random() * 900000) + 100000)
  const R = rng(seed)
  const styleName = STYLES[o.style] ? o.style : R.pick(Object.keys(STYLES))
  const p = STYLES[styleName]
  const S = clamp(odd(parseInt(o.size) || 57), 49, 91)
  const wallH = clamp(parseInt(o.wallh) || R.int(10, 12), 8, 16)
  const c = (S - 1) >> 1
  const g = new Grid()
  const res = new Set() // خانه‌های رزرو شده‌ی حیاط (برای باغ و درخت)
  const reserve = (x0, z0, x1, z1, m = 0) => { for (let x = x0 - m; x <= x1 + m; x++) for (let z = z0 - m; z <= z1 + m; z++) res.add(x + ',' + z) }
  const mix = (x, y, z) => { const h = hash(x, y, z); return h < 9 ? p.crack : h < 22 ? p.alt : p.wall }
  const onWall = (x, z) => x < 3 || x > S - 4 || z < 3 || z > S - 4
  const towers = []

  // ---------- خندق + پل ----------
  const dOut = (x, z) => Math.max(-x, x - (S - 1), -z, z - (S - 1))
  for (let x = -7; x <= S + 6; x++) for (let z = -7; z <= S + 6; z++) {
    const d = dOut(x, z)
    if (d < 3 || d > 6) continue
    const ex = Math.max(-x, x - (S - 1), 0); const ez = Math.max(-z, z - (S - 1), 0)
    if (ex > 0 && ez > 0 && (ex * ex + ez * ez) > 6.6 * 6.6) continue // گوشه‌ی گرد بیرونی
    const bridge = z < 0 && x >= c - 2 && x <= c + 2
    for (let y = -3; y <= -1; y++) g.dig(x, y, z)
    if (!bridge) g.set(x, -3, z, 'water')
  }
  // پل متحرک
  for (let z = -6; z <= -3; z++) for (let x = c - 2; x <= c + 2; x++) g.set(x, -1, z, (x === c - 2 || x === c + 2) ? p.log && axis(p.log, 'z') : p.wood)
  for (let z = -6; z <= -3; z++) for (const x of [c - 2, c + 2]) g.set(x, 0, z, p.fence)
  for (const z of [-6, -3]) for (const x of [c - 2, c + 2]) g.set(x, 1, z, 'lantern')
  for (let z = -2; z <= 3; z++) for (let x = c - 2; x <= c + 2; x++) g.set(x, -1, z, (x + z) % 2 ? p.trim : p.wall)

  // ---------- دیوار حصار ----------
  for (let x = 0; x < S; x++) for (let z = 0; z < S; z++) if (onWall(x, z)) g.fill(x, 0, z, x, wallH, z, mix)
  // کنگره‌ی بیرونی + جان‌پناه داخلی + چراغ
  for (let x = 0; x < S; x++) for (let z = 0; z < S; z++) {
    if (!onWall(x, z)) continue
    const outer = x === 0 || x === S - 1 || z === 0 || z === S - 1
    const inner = x === 2 || x === S - 3 || z === 2 || z === S - 3
    if (outer && (x + z) % 2 === 0) g.set(x, wallH + 1, z, p.wall)
    else if (inner && !outer) {
      if ((x + z) % 8 === 0) { g.set(x, wallH + 1, z, p.fence); g.set(x, wallH + 2, z, 'lantern') } else g.set(x, wallH + 1, z, p.wallBlk)
    }
  }
  // پشت‌بند (buttress) و دریچه‌ی تیر
  const sides = [['z', 0, 'south'], ['z', S - 1, 'north'], ['x', 0, 'east'], ['x', S - 1, 'west']]
  for (const [ax, at, face] of sides) {
    for (let i = 8; i < S - 8; i += 6) {
      const bx = ax === 'x' ? (at === 0 ? -1 : S) : i; const bz = ax === 'z' ? (at === 0 ? -1 : S) : i
      if (ax === 'z' && at === 0 && Math.abs(i - c) < 9) continue
      g.fill(bx, 0, bz, bx, wallH - 2, bz, mix)
      g.set(bx, wallH - 1, bz, st(p.stairs, face))
      const sx = ax === 'x' ? at : i + 3; const sz = ax === 'z' ? at : i + 3
      if (!(ax === 'z' && at === 0 && Math.abs(i + 3 - c) < 9)) for (let t = 0; t < 3; t++) { const qx = ax === 'x' ? (at === 0 ? t : S - 1 - t) : sx; const qz = ax === 'z' ? (at === 0 ? t : S - 1 - t) : sz; for (const y of [wallH - 4, wallH - 3]) g.del(qx, y, qz) }
    }
  }

  // ---------- برج گرد ----------
  function roundTower (cx, cz, r, h, { cone = true, steep = 2, ladder = true, windows = true, flag = true } = {}) {
    for (let x = cx - r - 1; x <= cx + r + 1; x++) for (let z = cz - r - 1; z <= cz + r + 1; z++) if (inDisc(x - cx, z - cz, r)) for (let y = 0; y <= h + 24; y++) g.del(x, y, z)
    ring(g, cx, cz, r, 0, h, mix)
    // کف طبقات
    const floors = []; for (let y = 6; y < h - 2; y += 6) floors.push(y)
    floors.push(Math.min(wallH, h - 1))
    const lx = cx - r + 1; const lz = cz
    for (const fy of floors.concat([h])) disc(g, cx, cz, r - 1, fy, fy, (x, y, z) => ((x + z) % 5 === 0 && fy === h ? p.trim : p.wood))
    if (ladder) for (let y = 0; y <= h; y++) { g.set(lx, y, lz, 'ladder[facing=east]') }
    if (windows) {
      for (let y = 3; y < h - 2; y += 6) for (const [x, z] of [[cx + r, cz], [cx - r, cz], [cx, cz + r], [cx, cz - r]]) { g.set(x, y, z, 'glass_pane'); g.set(x, y + 1, z, 'glass_pane') }
      for (const [x, z] of [[cx + r, cz], [cx - r, cz], [cx, cz + r], [cx, cz - r]]) { g.set(x, h - 2, z, 'glass_pane'); g.set(x, h - 1, z, 'glass_pane') }
    }
    let top = h + 1
    if (cone) { top = coneRoof(g, cx, cz, r, h + 1, p, steep); for (let k = 0; k < 3; k++) g.set(cx, top + k, cz, p.fence); g.set(cx, top + 3, cz, 'lantern'); if (flag) { g.fill(cx + 1, top + 1, cz, cx + 2, top + 2, cz, (x, y) => (y === top + 1 ? p.flag1 : p.flag2)) } } else {
      for (const [x, z] of ringCells(cx, cz, r)) if ((x + z) % 2 === 0) g.set(x, h + 1, z, p.wall)
    }
    towers.push({ cx, cz, r, h })
    reserve(cx - r, cz - r, cx + r, cz + r, 1)
    return top
  }

  // ---------- برج‌ها ----------
  const T = wallH + 9
  for (const [x, z] of [[4, 4], [S - 5, 4], [4, S - 5], [S - 5, S - 5]]) roundTower(x, z, 5, T + R.int(-1, 2), { steep: R.pick([2, 2, 3]) })
  const per = clamp(Math.floor(S / 26), 1, 3)
  const sidePos = []
  for (let i = 1; i <= per; i++) sidePos.push(Math.round(9 + (S - 18) * i / (per + 1)))
  for (const t of sidePos) {
    if (Math.abs(t - c) > 10) roundTower(t, 1, 3, wallH + 4, { cone: R.chance(0.5), ladder: true })
    roundTower(t, S - 2, 3, wallH + 4, { cone: R.chance(0.5) })
    roundTower(1, t, 3, wallH + 4, { cone: R.chance(0.5) })
    roundTower(S - 2, t, 3, wallH + 4, { cone: R.chance(0.5) })
  }

  // ---------- دروازه‌خانه ----------
  const gh = wallH + 8
  roundTower(c - 8, 2, 4, gh, { steep: 2 })
  roundTower(c + 8, 2, 4, gh, { steep: 2 })
  g.fill(c - 4, 0, 0, c + 4, wallH + 5, 2, mix)
  for (let x = c - 4; x <= c + 4; x++) { g.set(x, wallH + 6, 0, (x + 0) % 2 === 0 ? p.wall : undefined); if ((x) % 2 !== 0) g.del(x, wallH + 6, 0) }
  g.carve(c - 2, 0, 0, c + 2, 5, 2); g.carve(c - 1, 6, 0, c + 1, 6, 2)
  for (let x = c - 2; x <= c + 2; x++) for (const y of [4, 5]) g.set(x, y, 1, 'iron_bars')
  for (const x of [c - 1, c, c + 1]) g.set(x, 6, 1, 'iron_bars')
  // نشان سلطنتی روی دروازه
  for (let dx = -2; dx <= 2; dx++) for (let y = wallH - 1; y <= wallH + 3; y++) { const border = Math.abs(dx) === 2 || y === wallH - 1 || y === wallH + 3; g.set(c + dx, y, 0, border ? p.flag2 : p.flag1) }
  reserve(c - 9, 0, c + 9, 6)

  // ---------- حیاط: میدان، خیابان و فواره ----------
  const cz = S - 8; const dR = 7 // برج اصلی (donjon)
  const hz1 = cz - dR - 1; const KD = 17; const hz0 = hz1 - KD + 1; const KW = 25
  const hx0 = c - (KW >> 1); const hx1 = c + (KW >> 1)
  const plazaZ = Math.round((6 + hz0 - 4) / 2); const plazaR = clamp(Math.floor((hz0 - 8) / 2) , 3, 6)
  for (let z = 3; z < hz0; z++) for (let x = c - 2; x <= c + 2; x++) g.set(x, -1, z, (x === c - 2 || x === c + 2) ? p.trim : ((x + z) % 3 === 0 ? p.alt : p.wall))
  reserve(c - 3, 3, c + 3, hz0)
  for (let x = c - plazaR - 2; x <= c + plazaR + 2; x++) for (let z = plazaZ - plazaR - 2; z <= plazaZ + plazaR + 2; z++) {
    if (!inDisc(x - c, z - plazaZ, plazaR + 2) || inDisc(x - c, z - plazaZ, 2)) continue
    g.set(x, -1, z, ((x - c) * (x - c) + (z - plazaZ) * (z - plazaZ)) % 7 < 2 ? p.trim : p.wall); res.add(x + ',' + z)
  }
  // فواره
  for (const [x, z] of ringCells(c, plazaZ, 2)) g.set(x, 0, z, p.wall)
  for (const [x, z] of ringCells(c, plazaZ, 1, 1)) { if (x === c && z === plazaZ) continue; g.set(x, 0, z, 'water') }
  g.set(c, 0, plazaZ, p.wall); g.set(c, 1, plazaZ, p.wallBlk); g.set(c, 2, plazaZ, p.wallBlk); g.set(c, 3, plazaZ, 'lantern')
  // چراغ‌های خیابان
  for (let z = 6; z < hz0 - 2; z += 6) for (const x of [c - 3, c + 3]) { if (Math.abs(z - plazaZ) < plazaR + 2) continue; g.set(x, 0, z, p.fence); g.set(x, 1, z, p.fence); g.set(x, 2, z, 'lantern') }

  // ---------- قلعه‌ی مرکزی (سالن بزرگ) ----------
  const Hh = wallH + 4
  reserve(hx0, hz0, hx1, hz1, 2)
  g.fill(hx0, -1, hz0, hx1, -1, hz1, p.wood)
  g.shell(hx0, 0, hz0, hx1, Hh, hz1, mix, 2)
  // ستون‌ها و کتیبه‌ها
  for (let x = hx0; x <= hx1; x++) for (const z of [hz0, hz1]) if ((x - hx0) % 6 === 0 || x === hx1) g.fill(x, 0, z, x, Hh, z, p.pillar.includes('log') || p.pillar.includes('pillar') || p.pillar.includes('stem') ? axis(p.pillar, 'y') : p.pillar)
  for (let z = hz0; z <= hz1; z++) for (const x of [hx0, hx1]) if ((z - hz0) % 6 === 0 || z === hz1) g.fill(x, 0, z, x, Hh, z, p.pillar.includes('log') || p.pillar.includes('pillar') || p.pillar.includes('stem') ? axis(p.pillar, 'y') : p.pillar)
  // پنجره‌های بلند
  for (let x = hx0 + 3; x < hx1 - 1; x += 6) for (const z of [hz0, hz0 + 1, hz1, hz1 - 1]) for (let y = 2; y <= 6; y++) g.set(x, y, z, 'glass_pane')
  for (let z = hz0 + 3; z < hz1 - 1; z += 6) for (const x of [hx0, hx0 + 1, hx1, hx1 - 1]) for (let y = 2; y <= 6; y++) g.set(x, y, z, 'glass_pane')
  // ورودی بزرگ (رو به شمال)
  g.carve(c - 1, 0, hz0, c + 1, 4, hz0 + 1)
  g.set(c - 2, 5, hz0, p.trim); g.set(c + 2, 5, hz0, p.trim)
  for (let x = c - 1; x <= c + 1; x++) { g.set(x, 5, hz0, st(p.stairs, 'south', 'top')); g.set(x, 5, hz0 + 1, p.wall) }
  // ایوان
  for (const x of [c - 3, c + 3]) { g.fill(x, 0, hz0 - 2, x, 5, hz0 - 2, p.pillar.includes('log') || p.pillar.includes('pillar') || p.pillar.includes('stem') ? axis(p.pillar, 'y') : p.pillar); g.set(x, 1, hz0 - 3, p.fence); g.set(x, 2, hz0 - 3, 'lantern') }
  for (let x = c - 3; x <= c + 3; x++) { g.set(x, 6, hz0 - 2, p.trim); g.set(x, 6, hz0 - 1, p.trim) }
  for (let x = c - 3; x <= c + 3; x++) g.set(x, -1, hz0 - 1, p.trim)
  // نردبان گالری
  const lad = [hx0 + 2, hz0 + 2]
  // کف گالری (حلقه‌ی ۳ بلوکی داخل دیوار) در y=7 + نرده
  for (let x = hx0 + 2; x <= hx1 - 2; x++) for (let z = hz0 + 2; z <= hz1 - 2; z++) {
    const edge = Math.min(x - (hx0 + 2), hx1 - 2 - x, z - (hz0 + 2), hz1 - 2 - z)
    if (edge <= 2) { g.set(x, 7, z, p.wood); if (edge === 2) g.set(x, 8, z, p.fence) }
  }
  g.del(lad[0] + 0, 7, lad[1]); for (let y = 0; y <= 8; y++) g.set(lad[0], y, lad[1], 'ladder[facing=east]')
  // سقف تخت زیر شیروانی + لوستر
  for (let x = hx0 + 2; x <= hx1 - 2; x++) for (let z = hz0 + 2; z <= hz1 - 2; z++) g.set(x, Hh, z, p.wood)
  for (const x of [c - 8, c, c + 8]) for (const z of [hz0 + 5, hz0 + 11]) { g.set(x, Hh - 1, z, 'chain'); g.set(x, Hh - 2, z, 'chain'); g.set(x, Hh - 3, z, 'lantern[hanging=true]') }
  // فرش، تخت پادشاه، کتابخانه
  for (let z = hz0 + 2; z <= hz1 - 2; z++) g.set(c, 0, z, p.carpet)
  for (let x = c - 3; x <= c + 3; x++) for (let z = hz1 - 4; z <= hz1 - 2; z++) g.set(x, 0, z, p.trim)
  g.set(c, 1, hz1 - 3, st(p.stairs, 'north')); g.set(c - 1, 1, hz1 - 3, p.trim); g.set(c + 1, 1, hz1 - 3, p.trim)
  for (let x = c - 2; x <= c + 2; x++) for (let y = 1; y <= 7; y++) g.set(x, y, hz1 - 2, (Math.abs(x - c) === 2 || y === 7) ? p.flag2 : p.flag1)
  for (let z = hz0 + 4; z <= hz0 + 12; z += 1) for (const x of [hx0 + 2, hx1 - 2]) if (z % 4 !== 0) { g.set(x, 0, z, 'bookshelf'); g.set(x, 1, z, 'bookshelf') }
  // پرچم‌های جلوی سالن
  for (const dx of [-8, 8]) for (let y = 2; y <= 7; y++) for (const k of [0, 1]) g.set(c + dx + k, y, hz0 - 0, y === 7 ? p.flag2 : p.flag1)
  // سقف شیب‌دار
  gableRoof(g, hx0, hz0, hx1, hz1, Hh + 1, p, 'x', (x, y, z) => mix(x, y, z))
  // برجک‌های چهارگوشه‌ی سالن
  for (const [x, z] of [[hx0, hz0], [hx1, hz0], [hx0, hz1], [hx1, hz1]]) roundTower(x, z, 3, Hh + 7, { steep: 2, ladder: false })
  // دالان به برج اصلی
  // ---------- برج اصلی (donjon) ----------
  const dh = wallH + 20 + R.int(0, 6)
  roundTower(c, cz, dR, dh, { steep: 3, flag: true })
  g.carve(c - 1, 0, hz1 - 1, c + 1, 3, hz1 + 2)
  g.fill(c - 1, -1, hz1 - 1, c + 1, -1, hz1 + 2, p.wood)
  // یک طبقه‌ی اضافه در برج اصلی با نردبان مرکزی بالا
  reserve(c - dR, cz - dR, c + dR, cz + dR, 1)

  // ---------- ساختمان‌های حیاط ----------
  function longHouse (x0, z0, w, l, doorSide) {
    const x1 = x0 + w - 1; const z1 = z0 + l - 1; const h = 5
    reserve(x0, z0, x1, z1, 2)
    g.fill(x0, -1, z0, x1, -1, z1, p.wood)
    g.shell(x0, 0, z0, x1, h, z1, mix, 1)
    for (const x of [x0, x1]) for (const z of [z0, z1]) g.fill(x, 0, z, x, h, z, axis(p.log, 'y'))
    for (let z = z0 + 3; z < z1 - 1; z += 4) for (const x of [x0, x1]) for (const y of [2, 3]) g.set(x, y, z, 'glass_pane')
    const dx = doorSide === 'east' ? x1 : x0
    const dz = (z0 + z1) >> 1
    g.carve(dx, 0, dz - 0, dx, 2, dz + 0)
    g.set(dx + (doorSide === 'east' ? 1 : -1), 2, dz, 'lantern[hanging=false]')
    gableRoof(g, x0, z0, x1, z1, h + 1, p, 'z', (x, y, z) => mix(x, y, z))
    // نیمکت/بشکه‌ی ساده داخل: کتاب‌خانه
    for (let z = z0 + 2; z < z1 - 1; z += 3) { g.set(doorSide === 'east' ? x0 + 1 : x1 - 1, 0, z, 'bookshelf') }
  }
  const bz0 = 7; const bl = Math.max(9, Math.min(15, hz0 - bz0 - 4))
  longHouse(6, bz0, 7, bl, 'east')
  longHouse(S - 13, bz0, 7, bl, 'west')

  // ---------- باغ: درخت و گل ----------
  const tree = (x, z) => {
    const th = R.int(4, 6)
    for (let y = 0; y < th; y++) g.set(x, y, z, axis('oak_log', 'y'))
    for (let dy = -1; dy <= 1; dy++) {
      const rr = dy === 1 ? 1 : 2
      for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
        if (dx === 0 && dz === 0 && dy < 1) continue
        if (Math.abs(dx) === rr && Math.abs(dz) === rr && (dy > 0 || R.chance(0.5))) continue
        g.set(x + dx, th + dy, z + dz, 'oak_leaves[persistent=true]')
      }
    }
    g.set(x, th + 2, z, 'oak_leaves[persistent=true]')
  }
  let trees = 0; const wantTrees = Math.floor(S / 6) + R.int(0, 3)
  for (let tries = 0; tries < 600 && trees < wantTrees; tries++) {
    const x = R.int(6, S - 7); const z = R.int(6, S - 7)
    let ok = true
    for (let dx = -3; dx <= 3 && ok; dx++) for (let dz = -3; dz <= 3; dz++) if (res.has((x + dx) + ',' + (z + dz))) { ok = false; break }
    if (!ok) continue
    tree(x, z); reserve(x, z, x, z, 3); trees++
  }
  for (let x = 4; x < S - 4; x++) for (let z = 4; z < S - 4; z++) {
    if (res.has(x + ',' + z) || onWall(x, z)) continue
    if (hash(x, 7, z) < 11) g.set(x, 0, z, R.pick(p.flowers))
  }

  const bp = finalize(g, 'castle')
  bp.seed = seed; bp.style = styleName
  bp.title = `قلعه (${styleName}، seed ${seed})`
  return bp
}

// نزدیک به blueprints.finish ولی بدون وابستگی چرخه‌ای
function finalize (g, name) {
  let minX = Infinity; let minZ = Infinity; let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity; let minY = 0
  const scan = (k) => { const [x, y, z] = k.split(',').map(Number); minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z); minY = Math.min(minY, y) }
  for (const k of g.m.keys()) scan(k)
  for (const k of g.pre.keys()) scan(k)
  const blocks = []; const counts = {}
  for (const [k, b] of g.m) {
    if (b === undefined || b === null) continue
    const [x, y, z] = k.split(',').map(Number)
    blocks.push({ x: x - minX, y, z: z - minZ, block: b })
    const nm = b.replace(/\[.*$/, ''); counts[nm] = (counts[nm] || 0) + 1
  }
  const pre = []
  for (const k of g.pre.keys()) { const [x, y, z] = k.split(',').map(Number); pre.push({ x: x - minX, y, z: z - minZ, block: 'air' }) }
  return { name, blocks, pre, counts, size: { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 } }
}

module.exports = { grandCastle, STYLES }
