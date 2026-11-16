// برنامه‌ی تسطیح زمین: ورودی نقشه‌ی ارتفاع (survey) → فهرست «کندن» و «پر کردن»
// با شیب ملایم (۱ بلاک ارتفاع در هر بلاک فاصله) در حاشیه تا زمین طبیعی بماند.

function median (arr) { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] }

// core: مستطیل اصلی (سازه + خندق)، ring: پهنای دامنه‌ی شیب‌دار اطراف
function planFlatten (cols, core, ring = 8, level = null, fast = false) {
  const grounds = []; let waterCols = 0; let total = 0
  for (let x = core.x0; x <= core.x1; x++) for (let z = core.z0; z <= core.z1; z++) {
    const c = cols.get(x + ',' + z); if (!c) continue
    grounds.push(c.ground); total++; if (c.water) waterCols++
  }
  if (!grounds.length) throw new Error('نقشه‌برداری زمین ناموفق بود (چانک‌ها بارگذاری نشدند).')
  const G = level !== null && level !== undefined ? level : median(grounds)
  const cut = []; const fill = []
  let cutN = 0; let fillN = 0
  const inCore = (x, z) => x >= core.x0 && x <= core.x1 && z >= core.z0 && z <= core.z1
  const tiles = new Map()
  const ringCols = new Map() // ستون‌های دامنه‌ی شیب‌دار در حالت سریع
  for (let x = core.x0 - ring; x <= core.x1 + ring; x++) for (let z = core.z0 - ring; z <= core.z1 + ring; z++) {
    const c = cols.get(x + ',' + z); if (!c) continue
    const dx = Math.max(core.x0 - x, 0, x - core.x1); const dz = Math.max(core.z0 - z, 0, z - core.z1)
    const k = Math.max(dx, dz) // فاصله از هسته
    if (k > ring) continue
    const T = Math.max(G - k, Math.min(G + k, c.ground)) // ارتفاع هدف این ستون
    const rel = (y) => y // مطلق
    if (fast && k > 0) { // دامنه‌ی شیب‌دار هم با /fill (مستطیل‌های هم‌پارامتر) انجام می‌شود
      let airFrom = null; let airTo = null; let dirtFrom = null; let dirtTo = null; let grass = false
      if (c.top > T) { airFrom = T + 1; airTo = T + Math.ceil((c.top - T) / 6) * 6 }
      if (c.ground > T) grass = true
      else if (c.ground < T) { dirtFrom = c.ground + 1; dirtTo = T - 1; grass = true }
      if (airFrom !== null || grass) ringCols.set(x + ',' + z, [airFrom, airTo, dirtFrom, dirtTo, T, grass])
      continue
    }
    if (fast && inCore(x, z)) { // هسته با دستور /fill (سریع) انجام می‌شود
      const key = Math.floor((x - core.x0) / 24) + ',' + Math.floor((z - core.z0) / 24)
      let t = tiles.get(key); if (!t) { t = { x0: x, z0: z, x1: x, z1: z, top: G, minG: G }; tiles.set(key, t) }
      t.x0 = Math.min(t.x0, x); t.x1 = Math.max(t.x1, x); t.z0 = Math.min(t.z0, z); t.z1 = Math.max(t.z1, z)
      t.top = Math.max(t.top, c.top); t.minG = Math.min(t.minG, c.ground)
      continue
    }
    if (c.top > T) { // کندن از بالا (درخت‌ها هم)
      for (let y = c.top; y > T; y--) { cut.push({ x, y: rel(y), z, block: 'air' }); cutN++ }
    }
    if (c.ground > T) { // زمین بلندتر از هدف: همان ستون کنده شده؛ سطح را چمن کن
      cut.push({ x, y: T, z, block: 'grass_block' }); cutN++
    } else if (c.ground < T) { // پر کردن (گودال/آب)
      for (let y = c.ground + 1; y < T; y++) { fill.push({ x, y, z, block: 'dirt' }); fillN++ }
      fill.push({ x, y: T, z, block: 'grass_block' }); fillN++
    }
  }
  // ادغام ستون‌های هم‌پارامتر در مستطیل (کمترین تعداد دستور /fill)
  const rows = new Map()
  for (const [key, tup] of ringCols) { const [x, z] = key.split(',').map(Number); if (!rows.has(z)) rows.set(z, []); rows.get(z).push([x, tup]) }
  const ringRects = []; let open = new Map()
  for (const z of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = rows.get(z).sort((a, b) => a[0] - b[0]); const next = new Map()
    let i = 0
    while (i < xs.length) {
      let j = i; const tk = JSON.stringify(xs[i][1])
      while (j + 1 < xs.length && xs[j + 1][0] === xs[j][0] + 1 && JSON.stringify(xs[j + 1][1]) === tk) j++
      const key = xs[i][0] + ':' + xs[j][0] + ':' + tk
      const r = open.get(key)
      if (r && r.z1 === z - 1) { r.z1 = z; next.set(key, r) } else { const nr = { xa: xs[i][0], xb: xs[j][0], z0: z, z1: z, airFrom: xs[i][1][0], airTo: xs[i][1][1], dirtFrom: xs[i][1][2], dirtTo: xs[i][1][3], T: xs[i][1][4], grass: xs[i][1][5] }; ringRects.push(nr); next.set(key, nr) }
      i = j + 1
    }
    open = next
  }
  const waterFrac = total ? waterCols / total : 0
  const minG = Math.min(...grounds); const maxG = Math.max(...grounds)
  return { level: G, cut, fill, tiles: [...tiles.values()], ringRects, waterFrac, range: [minG, maxG], total: cutN + fillN + tiles.size * 3 + ringRects.length * 3 }
}

module.exports = { planFlatten }
