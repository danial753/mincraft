// پلاگین حرکت: دنبال کردن، آمدن نزد صاحب، رفتن به مختصات (pathfinder)
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')

module.exports = function movement (bot, ctx) {
  bot.loadPlugin(pathfinder)

  bot.once('spawn', () => {
    const mcData = require('minecraft-data')(bot.version)
    const moves = new Movements(bot, mcData)
    moves.canDig = false
    moves.allow1by1towers = false
    moves.allowParkour = true
    bot.pathfinder.setMovements(moves)
  })

  const findPlayer = (name) => { const p = bot.players[name]; return p && p.entity ? p.entity : null }
  const stopPath = () => { try { bot.pathfinder.setGoal(null); bot.pathfinder.stop() } catch {} }

  ctx.commands.register('follow', {
    aliases: ['دنبال'], desc: 'دنبال کردن یک بازیکن', usage: 'follow <نام بازیکن>', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      const name = args[0] || username
      const entity = findPlayer(name)
      if (!entity) return reply(`بازیکن ${name} را نزدیک خودم نمی‌بینم.`)
      const t = ctx.task.begin('follow', name, stopPath)
      t.target = name
      bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true)
      reply(`🚶 دارم ${name} را دنبال می‌کنم.`)
    }
  })
  // اگر کسی که دنبالش هستیم رفت، کار را تمام کن
  bot.on('playerLeft', (p) => { const t = ctx.manager.task; if (t && t.name === 'follow' && t.target === p.username) ctx.task.cancel() })

  ctx.commands.register('come', {
    aliases: ['بیا'], desc: 'آمدن نزد تو', usage: 'come', ownerOnly: true,
    run: async (bot, args, username, reply, opts = {}) => {
      const entity = findPlayer(opts.trusted ? (args[0] || ctx.config.owner) : username)
      if (!entity) return reply('موقعیتت را نمی‌بینم؛ نزدیک‌تر شو.')
      const p = entity.position
      const t = ctx.task.begin('come', null, stopPath)
      reply('🏃 دارم می‌آم!')
      try {
        await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 1))
        if (!t.cancelled) reply('رسیدم!')
      } catch (e) { if (!t.cancelled) reply('نتوانستم مسیر پیدا کنم: ' + e.message) } finally { ctx.task.end(t) }
    }
  })

  ctx.commands.register('goto', {
    aliases: ['برو'], desc: 'رفتن به مختصات', usage: 'goto <x> <y> <z>', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      if (args.length < 3) return reply('استفاده: goto <x> <y> <z>')
      const [x, y, z] = args.slice(0, 3).map(Number)
      if ([x, y, z].some(n => !Number.isFinite(n))) return reply('مختصات باید عدد باشد.')
      const t = ctx.task.begin('goto', `${x},${y},${z}`, stopPath)
      reply(`🧭 می‌روم به ${x}, ${y}, ${z}`)
      try {
        await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1))
        if (!t.cancelled) reply('رسیدم!')
      } catch (e) { if (!t.cancelled) reply('مسیر پیدا نشد: ' + e.message) } finally { ctx.task.end(t) }
    }
  })

  ctx.commands.register('stop', {
    aliases: ['وایسا', 'ایست'], desc: 'توقف همه کارها', usage: 'stop', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      ctx.task.cancel() // کار فعلی (کندن/ماهی/کشاورزی/ساخت...) را لغو می‌کند
      stopPath()
      try { if (bot.pvp) bot.pvp.stop() } catch {}
      if (bot.hunt) bot.hunt.active = false
      reply('✋ همه کارها متوقف شد.')
    }
  })
}
