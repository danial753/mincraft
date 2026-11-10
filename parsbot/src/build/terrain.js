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
  for (let x = core.x0 - ring; x <= core.x1 + ring; x++) for (let z = core.z0 - ring; z <= core.z1 + ring; z++) {
    const c = cols.get(x + ',' + z); if (!c) continue
    const dx = Math.max(core.x0 - x, 0, x - core.x1); const dz = Math.max(core.z0 - z, 0, z - core.z1)
    const k = Math.max(dx, dz) // فاصله از هسته
    if (k > ring) continue
    const T = Math.max(G - k, Math.min(G + k, c.ground)) // ارتفاع هدف این ستون
    const rel = (y) => y // مطلق
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
  const waterFrac = total ? waterCols / total : 0
  const minG = Math.min(...grounds); const maxG = Math.max(...grounds)
  return { level: G, cut, fill, tiles: [...tiles.values()], waterFrac, range: [minG, maxG], total: cutN + fillN + tiles.size * 3 }
}

module.exports = { planFlatten }
