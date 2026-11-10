// پلاگین فارم: کندن بلاک، جمع‌آوری، کشاورزی و ماهیگیری — همه با قابلیت لغو (stop)
const { plugin: collectblock } = require('mineflayer-collectblock')
const { plugin: tool } = require('mineflayer-tool')
const { goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')
const CommandRegistry = require('../commands')

const CROPS = {
  wheat: { maxAge: 7, seed: 'wheat_seeds' },
  carrots: { maxAge: 7, seed: 'carrot' },
  potatoes: { maxAge: 7, seed: 'potato' },
  beetroots: { maxAge: 3, seed: 'beetroot_seeds' }
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

module.exports = function farming (bot, ctx) {
  bot.loadPlugin(tool)
  // باگ کتابخانه‌ی mineflayer-tool: با getFromChest و بدون ابزار مناسب، equipForBlock تا بی‌نهایت خودش را صدا می‌زند
  // (حلقه‌ی بدون وقفه → پر شدن حافظه). گزینه‌ی صندوق را حذف می‌کنیم تا به‌جای حلقه، خطای تمیز بدهد.
  const patchTool = () => {
    if (!bot.tool || bot.tool._patched) return
    const origEquip = bot.tool.equipForBlock.bind(bot.tool)
    bot.tool.equipForBlock = (block, options = {}, cb) => origEquip(block, { ...options, getFromChest: false }, cb)
    bot.tool._patched = true
  }
  patchTool(); bot.once('inject_allowed', patchTool); bot.once('spawn', patchTool)
  bot.loadPlugin(collectblock)
  let mcData = null
  bot.once('spawn', () => { mcData = require('minecraft-data')(bot.version) })
  const stopPath = () => { try { bot.pathfinder.setGoal(null); bot.pathfinder.stop() } catch {} }

  ctx.commands.register('mine', {
    aliases: ['بکن'], desc: 'کندن و جمع‌آوری بلاک', usage: 'mine <نام بلاک> [تعداد]', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      if (!args[0]) return reply('استفاده: mine <نام بلاک> [تعداد] — مثال: mine oak_log 10')
      const count = CommandRegistry.int(args[1], 16, 1, 128)
      const blockType = mcData.blocksByName[args[0]]
      if (!blockType) return reply(`بلاک ${args[0]} وجود ندارد. مثال: mine oak_log 10`)
      const positions = bot.findBlocks({ matching: blockType.id, maxDistance: 64, count })
      if (!positions.length) return reply(`بلاک ${args[0]} تا شعاع ۶۴ پیدا نشد.`)
      const t = ctx.task.begin('mine', `${args[0]} ×${positions.length}`, () => { try { bot.collectBlock.cancelTask() } catch {}; stopPath() })
      reply(`⛏ شروع کندن ${positions.length} بلاک ${args[0]}`)
      try {
        await bot.collectBlock.collect(positions.map(p => bot.blockAt(p)).filter(Boolean))
        if (!t.cancelled) reply('✅ تمام شد!')
      } catch (e) { if (!t.cancelled) reply('مشکل در کندن: ' + e.message) } finally { ctx.task.end(t) }
    }
  })

  ctx.commands.register('collect', {
    aliases: ['جمع'], desc: 'جمع‌آوری آیتم‌های روی زمین', usage: 'collect', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      const items = Object.values(bot.entities).filter(e =>
        (e.name === 'item' || e.objectType === 'Item') && e.position.distanceTo(bot.entity.position) < 32)
      if (!items.length) return reply('آیتمی روی زمین نزدیکم نیست.')
      const t = ctx.task.begin('collect', `×${items.length}`, stopPath)
      reply(`🧺 جمع‌آوری ${items.length} آیتم...`)
      try {
        for (const item of items) {
          if (t.cancelled) break
          const p = item.position
          try { await withTimeout(bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 1)), 8000) } catch { stopPath() }
        }
        if (!t.cancelled) reply('✅ جمع‌آوری تمام شد.')
      } finally { ctx.task.end(t) }
    }
  })

  ctx.commands.register('farm', {
    aliases: ['کشاورزی'], desc: 'برداشت محصولات رسیده و کاشت دوباره', usage: 'farm', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      const t = ctx.task.begin('farm', null, stopPath)
      reply('🌾 شروع کشاورزی...')
      let harvested = 0
      try {
        for (const [cropName, crop] of Object.entries(CROPS)) {
          if (t.cancelled) break
          const type = mcData.blocksByName[cropName]
          if (!type) continue
          const positions = bot.findBlocks({ matching: type.id, maxDistance: 32, count: 64 })
          for (const pos of positions) {
            if (t.cancelled) break
            const block = bot.blockAt(pos)
            if (!block) continue
            const age = block.getProperties ? block.getProperties().age : block.metadata
            if ((age ?? 0) < crop.maxAge) continue
            const seed = bot.inventory.items().find(i => i.name === crop.seed)
            try {
              await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2))
              await bot.dig(block)
              harvested++
              if (seed && !t.cancelled) {
                await bot.equip(seed, 'hand')
                await bot.placeBlock(bot.blockAt(pos.offset(0, -1, 0)), new Vec3(0, 1, 0))
              }
            } catch (e) { if (!t.cancelled) ctx.log('warn', 'کشاورزی: ' + e.message) }
          }
        }
        if (!t.cancelled) reply(`✅ کشاورزی تمام شد؛ ${harvested} محصول برداشت شد.`)
      } finally { ctx.task.end(t) }
    }
  })

  ctx.commands.register('fish', {
    aliases: ['ماهی'], desc: 'ماهیگیری خودکار (نزدیک‌ترین آب)', usage: 'fish [تعداد]', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      const count = CommandRegistry.int(args[0], 5, 1, 64)
      const rod = bot.inventory.items().find(i => i.name === 'fishing_rod')
      if (!rod) return reply('🎣 چوب ماهیگیری ندارم! یکی به من بده.')
      const water = bot.findBlock({ matching: mcData.blocksByName.water.id, maxDistance: 24 })
      if (!water) return reply('آبی تا شعاع ۲۴ بلوک پیدا نشد.')
      const t = ctx.task.begin('fish', `×${count}`, stopPath)
      reply(`🎣 ماهیگیری (${count} بار) شروع شد...`)
      let caught = 0
      try {
        await bot.pathfinder.goto(new goals.GoalNear(water.position.x, water.position.y, water.position.z, 4))
        await bot.equip(rod, 'hand')
        for (let i = 0; i < count && !t.cancelled; i++) {
          await bot.lookAt(water.position.offset(0.5, 0.5, 0.5), true)
          try { await bot.fish(); caught++ } catch (e) { ctx.log('warn', 'ماهیگیری: ' + e.message); break }
        }
        if (!t.cancelled) reply(`✅ ${caught} صید انجام شد.`)
      } catch (e) { if (!t.cancelled) reply('مشکل در ماهیگیری: ' + e.message) } finally { ctx.task.end(t) }
    }
  })
}
