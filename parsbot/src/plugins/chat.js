// پلاگین چت: پردازش دستورات، ورود صاحب با رمز، مدیریت ربات‌ها
//
// آدرس‌دهی در چند ربات:
//   !دستور            → فقط ربات اصلی (leader) جواب می‌دهد
//   !اسم_ربات دستور   → همان ربات
//   !all دستور        → همه‌ی ربات‌ها
const CommandRegistry = require('../commands')

module.exports = function chat (bot, ctx) {
  const prefix = ctx.config.prefix || '!'
  const fleet = ctx.fleet
  const isLeader = () => !fleet || fleet.leader() === ctx.manager

  // صف پیام: فاصله‌ی ۷۰۰ms تا سرور به‌خاطر اسپم کیک نکند
  const queue = []
  const timer = setInterval(() => {
    const m = queue.shift()
    if (m !== undefined) { try { bot.chat(m) } catch {} }
  }, 700)
  bot.once('end', () => clearInterval(timer))
  const say = (m) => { if (queue.length < 20) queue.push(String(m).slice(0, 250)) }

  ctx.commands.register('help', {
    aliases: ['راهنما', 'کمک'],
    desc: 'نمایش دستورات',
    usage: 'help',
    run: async (bot, args, username, reply) => {
      const names = ctx.commands.list().map(c => c.name).join(' ')
      reply(`📖 پیشوند ${prefix} — برای ربات خاص: ${prefix}<نام> دستور | همه: ${prefix}all دستور`)
      for (let i = 0; i < names.length; i += 220) reply(names.slice(i, i + 220))
    }
  })

  ctx.commands.register('pos', {
    aliases: ['موقعیت'], desc: 'موقعیت فعلی ربات', usage: 'pos', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      const p = bot.entity.position
      reply(`📍 ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`)
    }
  })

  ctx.commands.register('players', {
    aliases: ['بازیکنان'], desc: 'لیست بازیکنان آنلاین', usage: 'players',
    run: async (bot, args, username, reply) => { reply('👥 ' + Object.keys(bot.players).join(', ')) }
  })

  ctx.commands.register('health', {
    aliases: ['جان'], desc: 'جان و غذا', usage: 'health',
    run: async (bot, args, username, reply) => { reply(`❤ جان: ${bot.health} | 🍗 غذا: ${bot.food}`) }
  })

  ctx.commands.register('jump', {
    aliases: ['بپر'], desc: 'یک پرش!', usage: 'jump',
    run: async (bot, args, username, reply) => {
      bot.setControlState('jump', true)
      setTimeout(() => bot.setControlState('jump', false), 500)
      reply('🦘 پریدم!')
    }
  })

  // امن: فقط صاحب، و هرگز تبدیل به دستور سرور نمی‌شود (/ حذف می‌شود)
  ctx.commands.register('say', {
    aliases: ['بگو'], desc: 'تکرار متن در چت', usage: 'say <متن>', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      const t = CommandRegistry.safeText(args.join(' ')).trim()
      reply(t || `${username} چیزی نگفت!`)
    }
  })

  ctx.commands.register('inv', {
    aliases: ['کوله'], desc: 'محتویات کوله‌پشتی', usage: 'inv', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      const items = bot.inventory.items()
      if (!items.length) return reply('کوله‌ام خالی است.')
      reply('🎒 ' + items.map(i => `${i.name}×${i.count}`).join(', ').slice(0, 240))
    }
  })

  ctx.commands.register('drop', {
    aliases: ['بنداز'], desc: 'انداختن آیتم روی زمین', usage: 'drop <نام آیتم> [تعداد]', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      const item = bot.inventory.items().find(i => i.name === args[0])
      if (!item) return reply(`آیتم ${args[0] || '?'} را ندارم.`)
      const count = CommandRegistry.int(args[1], item.count, 1, item.count)
      await bot.toss(item.type, null, count)
      reply(`انداختم: ${item.name} ×${count}`)
    }
  })

  // ---- مدیریت ناوگان ----
  ctx.commands.register('bots', {
    aliases: ['رباتها'], desc: 'لیست ربات‌ها', usage: 'bots',
    run: async (bot, args, username, reply) => {
      reply('🤖 ' + [...fleet.bots.values()].map(m => `${m.id}${m === fleet.leader() ? '★' : ''}(${m.connection === 'online' ? m.mode.name : m.connection})`).join(' | '))
    }
  })

  ctx.commands.register('role', {
    aliases: ['نقش'], desc: 'نقش ربات: role [نام] <builder|survivor|idle>', usage: 'role [نام] <نقش>', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      const who = args.length > 1 ? args[0] : ctx.manager.id
      const r = args[args.length - 1]
      try { reply(`🎭 ${who} ← ${fleet.setRole(who, r)}`) } catch (e) { reply(e.message) }
    }
  })

  ctx.commands.register('addbot', {
    aliases: ['ربات_جدید'], desc: 'افزودن ربات جدید به همین سرور', usage: 'addbot <نام>', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      const name = (args[0] || '').replace(/[^\w]/g, '').slice(0, 16)
      if (!name) return reply('استفاده: addbot <نام انگلیسی>')
      const o = ctx.manager.currentOptions
      try {
        fleet.add(ctx.manager.currentProfile, { host: o.host, port: o.port, auth: o.auth, version: o.version, username: name })
        reply(`➕ ربات ${name} در حال اتصال است.`)
      } catch (e) { reply(e.message) }
    }
  })

  ctx.commands.register('removebot', {
    aliases: ['حذف_ربات'], desc: 'حذف یک ربات', usage: 'removebot <نام>', ownerOnly: true,
    run: async (bot, args, username, reply) => {
      try { fleet.remove(args[0]); reply('➖ حذف شد: ' + args[0]) } catch (e) { reply(e.message) }
    }
  })

  // ---- پردازش چت ----
  bot.on('chat', async (username, message) => {
    if (username === bot.username) return
    if (isLeader()) ctx.log('chat', `${username}: ${message}`)
    if (!message.startsWith(prefix)) return
    const parts = message.slice(prefix.length).trim().split(/\s+/)
    let cmd; let args
    const first = (parts[0] || '').toLowerCase()
    if (first === bot.username.toLowerCase()) { cmd = parts[1]; args = parts.slice(2) } else if (first === 'all' || first === 'همه') { cmd = parts[1]; args = parts.slice(2) } else if (isLeader()) { cmd = parts[0]; args = parts.slice(1) } else return
    if (!cmd) return
    if (cmd.toLowerCase() === 'login') return say('⚠ رمز را در چت عمومی ننویس! به ربات whisper بزن: /msg ' + bot.username + ' login <رمز>')
    try {
      const ok = await ctx.commands.execute(bot, cmd, args, username, say)
      if (!ok && (first !== 'all' && first !== 'همه')) say(`دستور ناشناخته: ${cmd} — ${prefix}help را بزن.`)
    } catch (e) {
      ctx.log('error', `دستور ${cmd}: ${e.message}`)
      say('خطا: ' + e.message.slice(0, 200))
    }
  })

  // ورود صاحب با رمز از طریق پیام خصوصی (امن‌تر از مقایسه‌ی اسم روی سرور آفلاین)
  bot.on('whisper', (username, message) => {
    ctx.log('chat', `[پیام خصوصی] ${username}: ${message.startsWith('login') ? 'login ***' : message}`)
    const m = /^login\s+(.+)$/i.exec(message.trim())
    if (!m || !ctx.config.ownerPassword) return
    if (isLeader()) {
      if (m[1] === ctx.config.ownerPassword) { fleet.authed.add(username); try { bot.whisper(username, '✅ وارد شدی') } catch {} } else { try { bot.whisper(username, '⛔ رمز اشتباه') } catch {} }
    }
  })
  bot.on('playerLeft', (p) => { if (fleet) fleet.authed.delete(p.username) })
}
