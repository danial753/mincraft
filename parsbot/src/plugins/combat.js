// پلاگین مبارزه: حمله به بازیکن/ماب و شکار خودکار ماب‌های امن‌تر
const { plugin: pvp } = require('mineflayer-pvp')

// فقط دشمنان معمولی. enderman/warden/creeper/ghast/blaze عمداً حذف شده‌اند (خطرناک برای ربات یا غیرقابل‌دسترس).
const HOSTILES = new Set([
  'zombie', 'zombie_villager', 'skeleton', 'spider', 'cave_spider', 'witch', 'drowned', 'husk', 'stray',
  'pillager', 'vindicator', 'slime', 'magma_cube', 'bogged'
])

module.exports = function combat (bot, ctx) {
  bot.loadPlugin(pvp)
  bot.hunt = { active: false }
  let huntTimer = null

  const nearestHostile = (range = 16) => bot.nearestEntity(e =>
    HOSTILES.has(e.name) && e.position.distanceTo(bot.entity.position) < range)

  bot.once('spawn', () => {
    huntTimer = setInterval(() => {
      if (!bot.hunt.active || !bot.entity || bot.pvp.target) return
      const target = nearestHostile()
      if (target) {
        ctx.log('combat', `⚔ هدف شکار: ${target.name}`)
        bot.pvp.attack(target).catch(() => {})
      }
    }, 1000)
  })
  bot.once('end', () => clearInterval(huntTimer))

  const stopFight = () => { bot.hunt.active = false; try { bot.pvp.stop() } catch {} }

  ctx.commands.register('attack', {
    aliases: ['حمله'], desc: 'حمله به بازیکن یا ماب', usage: 'attack <نام>', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      const name = args[0]
      if (!name) return reply('استفاده: attack <نام>')
      if (name === ctx.config.owner || (ctx.fleet && ctx.fleet.authed.has(name))) return reply('به صاحبم حمله نمی‌کنم 😅')
      if (ctx.fleet && ctx.fleet.bots.has(name)) return reply('به هم‌تیمی‌هایم حمله نمی‌کنم.')
      const player = bot.players[name]
      const target = (player && player.entity) || bot.nearestEntity(e => e.name === name || e.username === name)
      if (!target) return reply(`هدف ${name} پیدا نشد.`)
      const t = ctx.task.begin('attack', name, stopFight)
      reply(`⚔ حمله به ${name}!`)
      bot.pvp.attack(target).catch(() => {}).finally(() => ctx.task.end(t))
    }
  })

  ctx.commands.register('hunt', {
    aliases: ['شکار'], desc: 'شکار خودکار ماب‌های دشمن اطراف', usage: 'hunt <on|off>', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      if (args[0] === 'off') { ctx.task.cancel(); stopFight(); return reply('شکار خودکار خاموش شد.') }
      ctx.task.begin('hunt', null, stopFight)
      bot.hunt.active = true
      reply('🏹 شکار خودکار روشن شد.')
    }
  })
}
