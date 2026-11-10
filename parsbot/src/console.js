// کنسول متنی مشترک بین ترمینال و داشبورد
//   role <ربات|all> <builder|survivor|idle>   (سازنده | بقا | بیکار)
//   <ربات|all> <دستور> [آرگومان‌ها]   مثال: Builder2 get diamond 3
//   <دستور> ...   (بدون نام: ربات اصلی) مثال: build castle seed=42 style=azure
//   bots | roles | stop | help
const HELP = [
  'role <ربات|all> <builder|survivor|idle> — نقش ربات (سازنده=creative / بقا=survival+اکتشاف / بیکار)',
  '<ربات|all> <دستور> ... — اجرای دستور روی یک ربات. مثال: Bot2 get الماس 3  |  Bot3 find روستا  |  all stop',
  'build castle [size=57] [seed=7] [style=royal|gothic|azure|sun|forest] [at=x,z] [flatten=0] — ساخت گروهی (همه‌ی سازنده‌ها)',
  'build castle size=49 gather=1 — ربات‌ها مصالح را خودشان جمع می‌کنند (کبل‌استون/چوب...)؛ خیلی کندتر ولی واقعی',
  'get <چیز> [تعداد] — ربات بقا می‌رود و می‌آورد | find <چیز> — می‌گردد و مختصات می‌دهد | explore [مرحله]',
  'bots | roles | goals | buildinfo | buildstop | stop | help'
]

async function runLine (fleet, line) {
  const out = []
  const toks = String(line).trim().split(/\s+/).filter(Boolean)
  if (!toks.length) return out
  const first = toks[0].toLowerCase().replace(/^[!/]/, '')
  if (first === 'help' || first === 'راهنما') return HELP
  if (first === 'bots' || first === 'roles' || first === 'status') {
    for (const m of fleet.bots.values()) { const s = m.status(); out.push(`${m.id === (fleet.leader() && fleet.leader().id) ? '★' : ' '} ${m.id} | ${m.connection} | نقش: ${m.role} | کار: ${m.mode.name}${m.mode.detail ? ' (' + m.mode.detail + ')' : ''}${s.gameMode ? ' | ' + s.gameMode : ''}${s.position ? ' | ' + s.position.x + ',' + s.position.y + ',' + s.position.z : ''}`) }
    return out.length ? out : ['هیچ رباتی نیست.']
  }
  if (first === 'role' || first === 'نقش') {
    const [, who, roleName] = toks
    if (!who || !roleName) return ['استفاده: role <ربات|all> <builder|survivor|idle>']
    const targets = (who === 'all' || who === 'همه') ? [...fleet.bots.values()] : [fleet.get(who)].filter(Boolean)
    if (!targets.length) return ['ربات پیدا نشد: ' + who]
    for (const m of targets) { try { out.push(`${m.id} ← ${fleet.setRole(m.id, roleName)}`) } catch (e) { out.push('❌ ' + e.message) } }
    return out
  }
  if (first === 'stop' && toks.length === 1) { fleet.stopBuild(); for (const m of fleet.bots.values()) { m.cancelTask(); if (m.bot && m.bot.brain) m.bot.brain.stop() } return ['✋ همه چیز متوقف شد.'] }

  // نام ربات؟
  let targets; let rest
  if (first === 'all' || first === 'همه') { targets = fleet.online(); rest = toks.slice(1) } else if (fleet.get(toks[0])) { targets = [fleet.get(toks[0])]; rest = toks.slice(1) } else {
    // ساخت: ربات سازنده‌ی اصلی؛ بقیه: ربات اصلی
    const lead = (first === 'build' || first === 'بساز') ? (fleet.builders()[0] || fleet.leader()) : fleet.leader()
    targets = lead ? [lead] : []; rest = toks
  }
  if (!targets.length) return ['ربات آنلاینی نیست.']
  if (!rest.length) return ['دستور را بنویس. help را بزن.']
  for (const m of targets) {
    try {
      const replies = await m.runCommand(rest[0].replace(/^[!/]/, ''), rest.slice(1), 'console', { quiet: true })
      for (const r of replies) out.push((targets.length > 1 ? `[${m.id}] ` : '') + r)
    } catch (e) { out.push(`❌ ${m.id}: ${e.message}`) }
  }
  return out
}

module.exports = { runLine, HELP }
