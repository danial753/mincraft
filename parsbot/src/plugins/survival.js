// پلاگین بقا: خوردن خودکار (غذای مناسب)، پوشیدن زره، توتِم در دست دوم
const armorManager = require('mineflayer-armor-manager')

// غذاهای بد یا لازم برای کشت و کار هرگز خورده نمی‌شوند
const NEVER_EAT = new Set(['rotten_flesh', 'pufferfish', 'spider_eye', 'poisonous_potato', 'chicken', 'chorus_fruit', 'suspicious_stew', 'enchanted_golden_apple'])
const SEED_FOODS = new Set(['carrot', 'potato', 'beetroot']) // فقط اگر زیاد باشند

module.exports = function survival (bot, ctx) {
  bot.loadPlugin(armorManager)
  bot.survival = { autoEat: true, autoTotem: true }
  let mcData = null
  let eating = false

  bot.once('spawn', () => {
    mcData = require('minecraft-data')(bot.version)
    setTimeout(() => { try { bot.armorManager.equipAll() } catch {} }, 2000)
  })

  function bestFood () {
    if (!mcData) return null
    const items = bot.inventory.items().filter(i => mcData.foodsByName[i.name] && !NEVER_EAT.has(i.name))
    const total = {}
    for (const i of items) total[i.name] = (total[i.name] || 0) + i.count
    const ok = items.filter(i => !SEED_FOODS.has(i.name) || total[i.name] > 32)
    ok.sort((a, b) => mcData.foodsByName[b.name].foodPoints - mcData.foodsByName[a.name].foodPoints)
    return ok[0] || null
  }

  async function eatNow () {
    const food = bestFood()
    if (!food) return null
    await bot.equip(food, 'hand')
    await Promise.race([bot.consume(), new Promise((resolve, reject) => setTimeout(() => reject(new Error('خوردن طول کشید')), 8000))])
    return food
  }

  async function tryEat () {
    if (eating || !bot.survival.autoEat) return
    // وقتی سیر هستیم ماینکرفت اجازه‌ی خوردن نمی‌دهد
    if (bot.food >= 20) return
    if (bot.food > 14 && bot.health >= 14) return
    eating = true
    try {
      const f = await eatNow()
      if (f) ctx.log('survival', `🍗 ${f.name} خوردم (غذا: ${bot.food})`)
    } catch (e) { /* ممکن است وسط حمله قطع شود */ } finally { eating = false }
  }

  function tryTotem () {
    if (!bot.survival.autoTotem) return
    const offhand = bot.inventory.slots[45]
    if (offhand && offhand.name === 'totem_of_undying') return
    const totem = bot.inventory.items().find(i => i.name === 'totem_of_undying')
    if (totem) bot.equip(totem, 'off-hand').catch(() => {})
  }

  bot.on('health', () => { tryEat(); tryTotem() })

  ctx.commands.register('eat', {
    aliases: ['بخور'], desc: 'خوردن غذا', usage: 'eat',
    run: async (bot, args, username, reply) => {
      if (bot.food >= 20) return reply('سیر هستم 😋')
      try {
        const f = await eatNow()
        reply(f ? `😋 ${f.name} خوردم. غذا: ${bot.food}` : 'غذای مناسبی در کوله‌ام نیست!')
      } catch (e) { reply('نتوانستم بخورم: ' + e.message) }
    }
  })

  ctx.commands.register('armor', {
    aliases: ['زره'], desc: 'پوشیدن بهترین زره موجود', usage: 'armor',
    run: async (bot, args, username, reply) => {
      try { await bot.armorManager.equipAll(); reply('🛡 بهترین زره را پوشیدم.') } catch (e) { reply('مشکل در پوشیدن زره: ' + e.message) }
    }
  })

  ctx.commands.register('autoeat', {
    aliases: [], desc: 'روشن/خاموش کردن خوردن خودکار', usage: 'autoeat <on|off>', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      bot.survival.autoEat = args[0] !== 'off'
      reply('خوردن خودکار: ' + (bot.survival.autoEat ? 'روشن ✅' : 'خاموش ⛔'))
    }
  })
}
