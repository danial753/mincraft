// پلاگین بقا: ربات مستقل — اکتشاف، پیدا کردن هر چیز، به‌دست‌آوردن آیتم، ساخت ابزار و ذوب
//   get <چیز> [تعداد]   find <چیز> [تعداد]   explore [مرحله]   goals   cancelgoals
const Vec3 = require('vec3')
const { goals, Movements } = require('mineflayer-pathfinder')
const CommandRegistry = require('../commands')

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const withTimeout = (p, ms, msg = 'timeout') => Promise.race([p, new Promise((resolve, reject) => setTimeout(() => reject(new Error(msg)), ms))])

// واژه‌نامه‌ی فارسی → نام آیتم/بلاک/موجود
const FA = {
  چوب: 'log', الوار: 'log', درخت: 'log', تخته: 'planks', سنگ: 'cobblestone', زغال: 'coal', آهن: 'iron_ingot', سنگ_آهن: 'iron_ore',
  طلا: 'gold_ingot', الماس: 'diamond', زمرد: 'emerald', لاجورد: 'lapis_lazuli', ردستون: 'redstone', ماسه: 'sand', شن: 'gravel',
  خاک: 'dirt', ماهی: 'cod', گوشت: 'beef', غذا: 'food', نان: 'bread', سیب: 'apple', گندم: 'wheat', هویج: 'carrot', سیب_زمینی: 'potato',
  پشم: 'wool', مشعل: 'torch', کلنگ: 'iron_pickaxe', تیشه: 'iron_pickaxe', شمشیر: 'iron_sword', تبر: 'iron_axe', بیلچه: 'iron_shovel',
  کوره: 'furnace', میز: 'crafting_table', میزکار: 'crafting_table', صندوق: 'chest', شیشه: 'glass', نردبان: 'ladder', آب: 'water',
  روستا: 'village', گاو: 'cow', خوک: 'pig', گوسفند: 'sheep', مرغ: 'chicken', سیم: 'string', استخوان: 'bone', پر: 'feather', چرم: 'leather'
}
const GENERIC = {
  log: (n) => /_log$|_stem$/.test(n), planks: (n) => /_planks$/.test(n), wool: (n) => /_wool$/.test(n),
  food: null // پایین تعریف می‌شود
}
const TIER = ['wooden', 'stone', 'iron', 'diamond', 'netherite']
const FUEL = ['coal', 'charcoal', 'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'oak_log', 'spruce_log', 'birch_log']
const SMELT = { iron_ingot: ['iron_ore', 'raw_iron'], gold_ingot: ['gold_ore', 'raw_gold'], copper_ingot: ['copper_ore', 'raw_copper'], glass: ['sand'], stone: ['cobblestone'], charcoal: ['oak_log', 'spruce_log', 'birch_log'], cooked_beef: ['beef'], cooked_porkchop: ['porkchop'], cooked_chicken: ['chicken'], cooked_mutton: ['mutton'], cooked_cod: ['cod'], baked_potato: ['potato'] }
const STRUCT = { village: { blocks: ['bell', 'composter', 'hay_block'], mobs: ['villager'] } }

module.exports = function survivor (bot, ctx) {
  let mcData = null
  let digMoves = null
  const brain = bot.brain = { active: false, goals: [], current: null, explored: new Set(), log: [] }
  const say = (m) => { try { ctx.log('survival', m) } catch {} }
  bot.once('spawn', () => {
    mcData = require('minecraft-data')(bot.version)
    digMoves = new Movements(bot, mcData)
    digMoves.canDig = true; digMoves.allow1by1towers = true; digMoves.allowParkour = false
    GENERIC.food = (n) => !!mcData.foodsByName[n]
  })

  // ===== نام‌ها =====
  function resolveName (raw) {
    let n = String(raw || '').trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s‌-]+/g, '_')
    if (FA[n]) n = FA[n]
    return n
  }
  // آیتم‌هایی که تحت این نام قبول می‌کنیم
  function itemNames (n) {
    if (GENERIC[n]) return Object.keys(mcData.itemsByName).filter(GENERIC[n])
    return mcData.itemsByName[n] ? [n] : []
  }
  const have = (names) => bot.inventory.items().filter(i => names.includes(i.name)).reduce((a, i) => a + i.count, 0)
  const haveOne = (name) => have([name])

  // ===== ایمنی و دفاع =====
  const HOSTILE = new Set(['zombie', 'skeleton', 'spider', 'cave_spider', 'witch', 'drowned', 'husk', 'stray', 'pillager', 'vindicator', 'zombie_villager'])
  async function defend (t) {
    const e = bot.nearestEntity(en => HOSTILE.has(en.name) && en.position.distanceTo(bot.entity.position) < 8)
    if (!e || !bot.pvp) return
    say(`⚔ دفاع در برابر ${e.name}`)
    const sword = bot.inventory.items().find(i => /_sword$/.test(i.name))
    if (sword) { try { await bot.equip(sword, 'hand') } catch {} }
    bot.pvp.attack(e)
    const t0 = Date.now()
    while (!t.cancelled && e.isValid && Date.now() - t0 < 12000) await sleep(300)
    try { bot.pvp.stop() } catch {}
  }

  // ===== حرکت و اکتشاف =====
  const stopPath = () => { try { bot.pathfinder.setGoal(null); bot.pathfinder.stop() } catch {} }
  async function goNear (pos, range = 2, ms = 30000) {
    bot.pathfinder.setMovements(digMoves)
    await withTimeout(bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, range)), ms, 'مسیر پیدا/طی نشد')
  }
  let headingIdx = Math.floor(Math.random() * 8)
  async function exploreStep (t, dist = 40) {
    const p = bot.entity.position
    const cell = (x, z) => Math.floor(x / 32) + ',' + Math.floor(z / 32)
    brain.explored.add(cell(p.x, p.z))
    // جهتی را انتخاب کن که کمتر دیده شده
    let best = null; let bestScore = -1
    for (let k = 0; k < 8; k++) {
      const a = ((headingIdx + k) % 8) * Math.PI / 4
      let score = 0
      for (const m of [1, 2, 3]) if (!brain.explored.has(cell(p.x + Math.cos(a) * 32 * m, p.z + Math.sin(a) * 32 * m))) score += 4 - m
      score += Math.random() * 0.5
      if (score > bestScore) { bestScore = score; best = a }
    }
    headingIdx = Math.round(best / (Math.PI / 4)) % 8
    const tx = Math.floor(p.x + Math.cos(best) * dist); const tz = Math.floor(p.z + Math.sin(best) * dist)
    bot.pathfinder.setMovements(digMoves)
    bot.pathfinder.setGoal(new goals.GoalXZ(tx, tz))
    const t0 = Date.now(); let last = p.clone(); let lastT = Date.now()
    while (!t.cancelled && Date.now() - t0 < 25000) {
      await sleep(500)
      const q = bot.entity.position
      if (Math.hypot(q.x - tx, q.z - tz) < 3) break
      if (Date.now() - lastT > 6000) { if (q.distanceTo(last) < 1.5) break; last = q.clone(); lastT = Date.now() }
    }
    stopPath()
    brain.explored.add(cell(bot.entity.position.x, bot.entity.position.z))
  }

  // ===== پیدا کردن =====
  function blockIdsFor (name) {
    const out = []
    for (const b of mcData.blocksArray) {
      if (b.name === name) out.push(b.id)
      else if (GENERIC[name] && GENERIC[name](b.name) && (b.name.endsWith('_log') || b.name.endsWith('_stem'))) out.push(b.id)
    }
    return out
  }
  function blocksDropping (itemName) {
    const names = new Set(itemNames(itemName)); const out = []
    // blockLoot = جدول واقعی غنائم؛ (فیلد drops قدیمی خود بلاک را برمی‌گرداند)
    for (const e of (mcData.blockLootArray || [])) {
      if (e.drops && e.drops.some(d => names.has(d.item) && !d.silkTouch)) { const b = mcData.blocksByName[e.block]; if (b) out.push(b.id) }
    }
    if (!out.length) { // پشتیبان
      const ids = new Set([...names].map(n => mcData.itemsByName[n].id))
      for (const b of mcData.blocksArray) if (b.drops && b.drops.some(d => ids.has(d))) out.push(b.id)
    }
    return out
  }
  function mobsDropping (itemName) {
    const names = new Set(itemNames(itemName)); const out = []
    for (const e of (mcData.entityLootArray || [])) if (e.drops.some(d => names.has(d.item))) out.push(e.entity)
    return out
  }
  const lavaNear = (b) => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([x, y, z]) => { const n = bot.blockAt(b.position.offset(x, y, z)); return n && (n.name === 'lava') })
  const bad = new Set() // هدف‌های ناموفق (برای وقت تلف نکردن)
  function findBlockNear (ids, maxDistance = 96) {
    const p = bot.entity.position
    const list = bot.findBlocks({ matching: ids, maxDistance, count: 40 })
    let best = null; let bestCost = Infinity
    for (const pos of list) {
      if (bad.has(pos.toString())) continue
      const b = bot.blockAt(pos); if (!b || lavaNear(b)) continue
      const horiz = Math.hypot(pos.x - p.x, pos.z - p.z); const dy = p.y - pos.y
      const cost = horiz + (dy > 0 ? dy * 2 : -dy * 3) // زیر زمین بودن/بالا بودن گران‌تر
      if (cost < bestCost) { bestCost = cost; best = b }
    }
    return best
  }
  function findMob (names) {
    return bot.nearestEntity(e => names.includes(e.name) && e.position.distanceTo(bot.entity.position) < 80)
  }

  // ===== ساخت =====
  async function placeNearby (itemName) {
    const item = bot.inventory.items().find(i => i.name === itemName)
    if (!item) throw new Error('آیتم برای گذاشتن نیست: ' + itemName)
    await bot.equip(item, 'hand')
    const base = bot.entity.position.floored()
    let lastErr = 'no candidate'
    const body = [base, base.offset(0, 1, 0)]
    const dirs = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)]
    // هر خانه‌ی خالی نزدیک که کنارش بلاک جامد باشد (روی هر وجه) — در تونل و غار هم جواب می‌دهد
    for (let r = 1; r <= 3; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -1; dy <= 2; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r && !(r === 1)) continue
        const c = base.offset(dx, dy, dz)
        if (body.some(b => b.equals(c))) continue
        const cb = bot.blockAt(c); if (!cb || cb.name !== 'air') continue
        for (const d of dirs) {
          const ref = bot.blockAt(c.plus(d)); if (!ref || ref.boundingBox !== 'block') continue
          try { await bot.placeBlock(ref, d.scaled(-1)); return bot.blockAt(c) } catch (e) { lastErr = e.message }
        }
      }
    }
    throw new Error('جای مناسب برای گذاشتن ' + itemName + ' پیدا نشد (' + lastErr + ' @' + base.toString() + ')')
  }
  async function stationNearby (blockName, itemName, t) {
    const id = mcData.blocksByName[blockName].id
    let b = bot.findBlock({ matching: id, maxDistance: 5 })
    if (b) return b
    b = bot.findBlock({ matching: id, maxDistance: 40 })
    if (b) { await goNear(b.position, 2); return b }
    if (!haveOne(itemName)) await obtain(itemName, 1, t, 1)
    return await placeNearby(itemName)
  }

  // آیا نیاز به میز کار دارد؟ (۳×۳)
  function recipeFor (itemName, table) {
    const it = mcData.itemsByName[itemName]
    return bot.recipesFor(it.id, null, 1, table || null)[0] || null
  }
  // اجزای مورد نیاز یکی از دستورهای ساخت (برای جستجوی بازگشتی)
  function missingFor (itemName) {
    const it = mcData.itemsByName[itemName]
    const all = mcData.recipes[it.id] || []
    let best = null
    for (const r of all) {
      const need = {}
      const add = (id) => { if (id == null) return; const key = Array.isArray(id) ? id[0] : id; need[key] = (need[key] || 0) + 1 }
      if (r.inShape) r.inShape.flat().forEach(add)
      if (r.ingredients) r.ingredients.forEach(add)
      let miss = 0; const missing = []
      for (const [id, n] of Object.entries(need)) { const nm = mcData.items[id].name; const h = haveOne(nm); if (h < n) { miss += n - h; missing.push([nm, n - h]) } }
      if (!best || miss < best.miss) best = { miss, missing, result: r.result.count }
    }
    return best
  }
  async function craft (itemName, count, t, depth) {
    const it = mcData.itemsByName[itemName]
    if (!it) throw new Error('آیتم ناشناخته: ' + itemName)
    for (let guard = 0; guard < 6 && haveOne(itemName) < count && !t.cancelled; guard++) {
      let r = recipeFor(itemName, null) // ۲×۲ بدون میز
      let table = null
      if (!r) {
        table = bot.findBlock({ matching: mcData.blocksByName.crafting_table.id, maxDistance: 5 })
        if (table) r = recipeFor(itemName, table)
      }
      if (r) {
        const times = Math.ceil((count - haveOne(itemName)) / r.result.count)
        await bot.craft(r, Math.max(1, times), table || undefined)
        continue
      }
      // مواد کم است → تهیه کن
      const m = missingFor(itemName)
      if (!m || !m.missing.length) {
        // مواد هست ولی میز لازم است
        const needTable = !!(mcData.recipes[it.id] || []).some(rr => rr.inShape && (rr.inShape.length > 2 || rr.inShape[0].length > 2))
        if (needTable && depth < 4) { const tb = await stationNearby('crafting_table', 'crafting_table', t); await goNear(tb.position, 2); continue }
        throw new Error('دستور ساخت ' + itemName + ' ممکن نیست')
      }
      if (depth >= 4) throw new Error('زنجیره‌ی ساخت ' + itemName + ' خیلی عمیق شد')
      for (const [nm, n] of m.missing) { await obtain(nm, haveOne(nm) + n, t, depth + 1) }
    }
    if (haveOne(itemName) < count) throw new Error('ساخت ' + itemName + ' ناموفق بود')
  }

  async function smelt (outName, count, t, depth) {
    const inputs = SMELT[outName]
    if (!inputs) throw new Error('راه ذوب ' + outName + ' را نمی‌دانم')
    const inName = inputs.find(n => mcData.itemsByName[n])
    const furnaceB = await stationNearby('furnace', 'furnace', t)
    await goNear(furnaceB.position, 2)
    const need = count - haveOne(outName)
    if (haveOne(inName) < need) await obtain(inName, need, t, depth + 1)
    let fuel = FUEL.find(f => mcData.itemsByName[f] && haveOne(f) > 0)
    if (!fuel) { await obtain('coal', Math.ceil(need / 8) + 1, t, depth + 1).catch(async () => { await obtain('planks', 4, t, depth + 1) }); fuel = FUEL.find(f => mcData.itemsByName[f] && haveOne(f) > 0) }
    const f = await bot.openFurnace(furnaceB)
    try {
      await f.putFuel(mcData.itemsByName[fuel].id, null, Math.min(haveOne(fuel), Math.ceil(need / 1.5) + 1))
      await f.putInput(mcData.itemsByName[inName].id, null, Math.min(haveOne(inName), need))
      const t0 = Date.now()
      while (!t.cancelled && Date.now() - t0 < 12000 * need + 8000) {
        await sleep(1500)
        if (f.outputItem()) { await f.takeOutput() }
        if (haveOne(outName) >= count) break
      }
    } finally { try { f.close() } catch {} }
  }

  // ===== به‌دست‌آوردن آیتم =====
  async function ensureTool (block, t, depth) {
    const ht = block.harvestTools
    if (!ht) { try { await bot.tool.equipForBlock(block) } catch {} return }
    const names = Object.keys(ht).map(i => mcData.items[i].name)
    if (names.some(n => haveOne(n) > 0)) { try { await bot.tool.equipForBlock(block) } catch {} return }
    for (const tier of TIER) {
      const want = names.find(n => n.startsWith(tier + '_') && n.endsWith('_pickaxe')) || names.find(n => n.startsWith(tier + '_'))
      if (want) { say(`🛠 ساخت ابزار لازم: ${want}`); await obtain(want, 1, t, depth + 1); try { await bot.tool.equipForBlock(block) } catch {} return }
    }
    throw new Error('ابزار مناسب برای ' + block.name + ' پیدا نشد')
  }

  let walkMoves = null
  async function digDownOne (t) {
    const pos = bot.entity.position.floored()
    const b1 = bot.blockAt(pos.offset(0, -1, 0)); const b2 = bot.blockAt(pos.offset(0, -2, 0))
    if (!b1 || (b1.name === 'lava' || b1.name === 'water') || (b2 && (b2.name === 'lava' || b2.name === 'water'))) throw new Error('زیرم مایع است؛ ادامه نمی‌دهم')
    if (b1.boundingBox === 'block') { try { await bot.tool.equipForBlock(b1) } catch {} await bot.dig(b1) }
    for (let i = 0; i < 20 && !bot.entity.onGround && !t.cancelled; i++) await sleep(100)
  }
  // نزدیک شدن به بلاک هدف: روی سطح راه برو، قائم پایین برو، بعد افقی تونل بزن
  async function approach (block, t) {
    if (!walkMoves) { walkMoves = new Movements(bot, mcData); walkMoves.canDig = false; walkMoves.allow1by1towers = false }
    const p = bot.entity.position
    const horiz = Math.hypot(block.position.x - p.x, block.position.z - p.z)
    if (horiz > 5) {
      bot.pathfinder.setMovements(walkMoves)
      try { await withTimeout(bot.pathfinder.goto(new goals.GoalNear(block.position.x, p.y, block.position.z, 3)), 70000, 'رسیدن به بالای هدف طول کشید') } catch (e) { stopPath() }
      if (Math.hypot(block.position.x - bot.entity.position.x, block.position.z - bot.entity.position.z) > 8) throw new Error('نتوانستم روی سطح به بالای هدف برسم')
    }
    for (let i = 0; i < 90 && bot.entity.position.y - block.position.y > 3 && !t.cancelled; i++) await digDownOne(t)
  }
  async function mineOne (block, t, depth, want = 1, ids = null) {
    await ensureTool(block, t, depth)
    const key = block.position.toString()
    try {
      await approach(block, t)
      bot.collectBlock.movements = digMoves
      let list = [block]
      if (want > 1 && ids) { // چند بلاک نزدیک را یک‌جا بکن (خیلی سریع‌تر از یکی‌یکی)
        const near = bot.findBlocks({ matching: ids, maxDistance: 14, count: Math.min(want, 24) + 4 })
        list = near.map(p => bot.blockAt(p)).filter(b => b && !bad.has(b.position.toString()) && !lavaNear(b)).slice(0, Math.min(want, 24))
        if (!list.length) list = [block]
      }
      await withTimeout(bot.collectBlock.collect(list, { ignoreNoPath: true }), 25000 + list.length * 6000, 'کندن طول کشید')
    } catch (e) { bad.add(key); throw e }
  }

  // تخته از هر نوع چوبی که داریم
  async function craftPlanksAny (count, t, depth) {
    const allPlanks = itemNames('planks')
    for (let guard = 0; guard < 12 && have(allPlanks) < count && !t.cancelled; guard++) {
      const log = bot.inventory.items().find(i => /_log$|_stem$/.test(i.name))
      if (!log) { await obtain('log', 1, t, depth + 1); continue }
      const planks = log.name.replace(/_log$/, '_planks').replace(/_stem$/, '_planks')
      if (!mcData.itemsByName[planks]) { await bot.toss(log.type, null, 1); continue }
      const r = recipeFor(planks, null)
      if (!r) throw new Error('دستور ساخت ' + planks + ' پیدا نشد')
      await bot.craft(r, 1)
    }
    if (have(allPlanks) < count) throw new Error('تخته کافی نشد')
  }
  const CRAFT_FIRST = /_pickaxe$|_axe$|_sword$|_shovel$|_hoe$|_helmet$|_chestplate$|_leggings$|_boots$|^stick$|^crafting_table$|^furnace$|^chest$|^torch$|^ladder$|^bread$|^bucket$|^shield$|_boat$|^glass_pane$|^bookshelf$/

  // هدف: داشتن count تا از آیتم name
  async function obtain (rawName, count, t, depth = 0) {
    const name = resolveName(rawName)
    if (name === 'planks' || /_planks$/.test(name)) { await craftPlanksAny(count, t, depth); return have(itemNames('planks')) }
    const names = itemNames(name)
    if (!names.length) throw new Error('نمی‌شناسم: ' + rawName)
    const target = () => have(names)
    const isGeneric = !!GENERIC[name]
    const itemExact = !isGeneric ? mcData.itemsByName[name] : null
    const hasRecipe = !!(itemExact && (mcData.recipes[itemExact.id] || []).length)
    let stuck = 0
    while (target() < count && !t.cancelled) {
      await defend(t)
      const before = target()
      const ids = name === 'log' ? blockIdsFor('log') : blocksDropping(name)
      const mobs = mobsDropping(name)
      if (SMELT[name] && itemExact) { await smelt(name, count, t, depth) } else if (hasRecipe && (CRAFT_FIRST.test(name) || (!ids.length && !mobs.length))) { await craft(name, count, t, depth) } else if (ids.length && !(name === 'stick')) {
        const b = findBlockNear(ids)
        if (b) { try { await mineOne(b, t, depth, count - target(), ids) } catch (e) { say('⚠ ' + e.message); stuck++ } } else { say('🔭 ' + name + ' اطراف نیست؛ اکتشاف...'); await exploreStep(t) }
      } else if (mobs.length) {
        const e = findMob(mobs)
        if (e) { say(`🏹 شکار ${e.name}`); bot.pvp.attack(e); const t0 = Date.now(); while (!t.cancelled && e.isValid && Date.now() - t0 < 20000) await sleep(400); try { bot.pvp.stop() } catch {} await sleep(800); await pickupNear(t) } else { say('🔭 ' + name + ' اطراف نیست؛ اکتشاف...'); await exploreStep(t) }
      } else throw new Error('راه به‌دست آوردن ' + name + ' را نمی‌دانم')
      if (target() <= before) stuck++; else stuck = 0
      if (stuck > 8) throw new Error('گیر کردم: ' + name)
    }
    return target()
  }
  async function pickupNear (t) {
    const items = Object.values(bot.entities).filter(e => (e.name === 'item' || e.objectType === 'Item') && e.position.distanceTo(bot.entity.position) < 12)
    for (const it of items) { if (t.cancelled) break; try { await goNear(it.position, 1, 8000) } catch {} }
  }

  // ===== پیدا کردن چیز (بدون برداشتن) =====
  async function findThing (rawName, count, t, budget = 40) {
    const name = resolveName(rawName)
    let blocks = []; let mobs = []
    if (STRUCT[name]) { blocks = STRUCT[name].blocks.map(n => mcData.blocksByName[n] && mcData.blocksByName[n].id).filter(Boolean); mobs = STRUCT[name].mobs } else {
      blocks = blockIdsFor(name); if (!blocks.length && mcData.blocksByName[name]) blocks = [mcData.blocksByName[name].id]
      if (!blocks.length) blocks = blocksDropping(name)
      if (mcData.entitiesByName[name]) mobs = [name]
    }
    if (!blocks.length && !mobs.length) throw new Error('نمی‌دانم «' + rawName + '» را چطور پیدا کنم')
    for (let step = 0; step < budget && !t.cancelled; step++) {
      await defend(t)
      if (blocks.length) { const b = findBlockNear(blocks, 128); if (b) return { x: b.position.x, y: b.position.y, z: b.position.z, what: b.name } }
      if (mobs.length) { const e = findMob(mobs); if (e) return { x: Math.floor(e.position.x), y: Math.floor(e.position.y), z: Math.floor(e.position.z), what: e.name } }
      await exploreStep(t)
    }
    return null
  }

  // ===== حلقه‌ی اصلی مغز =====
  function describe (g) { return `${g.type} ${g.name || ''}${g.count ? ' ×' + g.count : ''}`.trim() }
  async function runGoal (g, t) {
    if (g.type === 'get') {
      const got = await obtain(g.name, g.count, t, 0)
      say(`✅ ${g.name}: ${got} در کوله دارم`)
      g.reply && g.reply(`✅ ${g.name}: ${got} تا دارم`)
    } else if (g.type === 'find') {
      const r = await findThing(g.name, g.count, t, g.budget || 40)
      const msg = r ? `📍 ${g.name} پیدا شد (${r.what}) در ${r.x}, ${r.y}, ${r.z}` : `❌ ${g.name} را پیدا نکردم`
      say(msg); g.reply && g.reply(msg)
    } else if (g.type === 'explore') {
      for (let i = 0; i < (g.count || 5) && !t.cancelled; i++) { await defend(t); await exploreStep(t) }
      const p = bot.entity.position; g.reply && g.reply(`🧭 اکتشاف تمام شد؛ الان در ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}`)
    }
  }
  async function loop () {
    if (brain.running) return
    brain.running = true
    try {
      while (brain.active && brain.goals.length) {
        const g = brain.goals.shift()
        brain.current = g
        const t = ctx.task.begin('survive', describe(g), () => { stopPath(); try { bot.collectBlock.cancelTask() } catch {} })
        brain.task = t
        say('🎯 هدف: ' + describe(g))
        try { await runGoal(g, t) } catch (e) { if (!t.cancelled) { say('❌ ' + e.message); g.reply && g.reply('❌ ' + e.message) } } finally { ctx.task.end(t); brain.current = null }
        if (t.cancelled) { if (!brain.keepGoals) brain.goals.length = 0; break }
      }
    } finally { brain.running = false }
  }
  brain.start = () => { brain.active = true; loop() }
  brain.stop = () => { brain.active = false; brain.goals.length = 0; ctx.task.cancel() }
  brain.obtain = (name, count, t) => obtain(name, count, t, 0)
  brain.detectWood = () => {
    let best = 'oak'; let bestN = -1
    for (const sp of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak']) {
      const b = mcData.blocksByName[sp + '_log']; if (!b) continue
      const n = bot.findBlocks({ matching: b.id, maxDistance: 64, count: 64 }).length
      if (n > bestN) { bestN = n; best = sp }
    }
    return best
  }
  brain.add = (g) => { brain.goals.push(g); if (brain.active) loop() }

  bot.on('death', () => { say('☠ مردم! بعد از respawn ادامه می‌دهم.'); if (brain.current) brain.goals.unshift(brain.current); brain.keepGoals = true; ctx.task.cancel(); setTimeout(() => { brain.keepGoals = false; if (brain.active) loop() }, 4000) })

  // ===== دستورات =====
  const need = (reply, args, usage) => { if (!args[0]) { reply(usage); return false } return true }
  const addGoal = (type, args, reply) => {
    if (!brain.active) brain.start() // دستور مستقیم صاحب، مغز را روشن می‌کند
    const nm = args[0]; const last = args[args.length - 1]
    const count = /^\d+$/.test(last) && args.length > 1 ? CommandRegistry.int(last, 1, 1, 2000) : 1
    const name = /^\d+$/.test(last) && args.length > 1 ? args.slice(0, -1).join('_') : args.join('_')
    brain.add({ type, name, count, reply })
    reply(`🎯 چشم! ${type === 'get' ? 'می‌روم می‌آورم' : 'می‌گردم'}: ${name}${count > 1 ? ' ×' + count : ''} (صف: ${brain.goals.length})`)
  }
  ctx.commands.register('get', { aliases: ['بیاور', 'جمع_کن'], desc: 'به‌دست آوردن آیتم با اکتشاف/کندن/ساخت/ذوب: get <چیز> [تعداد]', usage: 'get diamond 3', ownerOnly: true, run: async (b, args, u, reply) => { if (need(reply, args, 'استفاده: get <آیتم> [تعداد] — مثال: get iron_pickaxe | get الماس 3')) addGoal('get', args, reply) } })
  ctx.commands.register('find', { aliases: ['پیدا', 'بگرد'], desc: 'گشتن تا پیدا شدن یک بلاک/موجود/روستا و گزارش مختصات', usage: 'find village', ownerOnly: true, run: async (b, args, u, reply) => { if (need(reply, args, 'استفاده: find <چیز> — مثال: find diamond_ore | find روستا')) addGoal('find', args, reply) } })
  ctx.commands.register('explore', { aliases: ['اکتشاف'], desc: 'گشت‌زنی در مراحل ۴۰ بلوکی', usage: 'explore [مرحله]', ownerOnly: true, run: async (b, args, u, reply) => { if (!brain.active) brain.start(); brain.add({ type: 'explore', count: CommandRegistry.int(args[0], 5, 1, 100), reply }); reply('🧭 شروع اکتشاف...') } })
  ctx.commands.register('goals', { aliases: ['هدف‌ها'], desc: 'نمایش هدف جاری و صف', usage: 'goals', run: async (b, args, u, reply) => { reply(brain.current ? `🎯 الان: ${describe(brain.current)} | صف: ${brain.goals.map(describe).join('، ') || '—'}` : 'هدفی ندارم.') } })
  ctx.commands.register('cancelgoals', { aliases: ['لغو_هدف'], desc: 'لغو همه‌ی هدف‌ها', usage: 'cancelgoals', ownerOnly: true, run: async (b, args, u, reply) => { brain.goals.length = 0; ctx.task.cancel(); reply('هدف‌ها لغو شد.') } })
  ctx.commands.register('have', { aliases: ['دارم'], desc: 'چقدر از یک آیتم دارم', usage: 'have <آیتم>', run: async (b, args, u, reply) => { const n = resolveName(args[0]); reply(`${n}: ${have(itemNames(n)) || 0}`) } })
}
