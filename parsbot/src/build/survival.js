// تبدیل نقشه به «نسخه‌ی قابل‌جمع‌آوری»: فقط بلاک‌هایی که ربات در بقا می‌تواند خودش تهیه کند
// (کبل‌استون، چوب، شیشه از ماسه ...). تزئین‌های غیرممکن/کند حذف یا جایگزین می‌شوند.
const { parse } = require('./spec')

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak']
const STONEISH = /^(stone_brick|mossy_stone_brick|cracked_stone_brick|chiseled_stone_brick|polished_andesite|andesite|polished_blackstone|blackstone|chiseled_polished_blackstone|cracked_polished_blackstone|quartz|smooth_quartz|chiseled_quartz|sandstone|cut_sandstone|smooth_sandstone|chiseled_sandstone|red_sandstone|prismarine|nether_brick|cobblestone|mossy_cobblestone|stone|diorite|granite)/
const WOODISH = /^(dark_oak|spruce|oak|birch|acacia|jungle|crimson|warped)_(planks|log|stem|fence|door|stairs|slab|trapdoor|wood|hyphae)$|^stripped_/

function props (p) { const k = Object.keys(p); return k.length ? '[' + k.map(x => `${x}=${p[x]}`).join(',') + ']' : '' }

// برمی‌گرداند رشته‌ی جدید، یا null یعنی «این بلاک را نساز»
function mapBlock (raw, wood) {
  const s = parse(raw)
  const n = s.name
  if (n === 'air') return raw
  // تزئین‌های غیرممکن یا خیلی کند → حذف
  if (n === 'water' || n === 'chain' || /_carpet$/.test(n) || /_leaves$/.test(n) || /^(poppy|dandelion|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose)$/.test(n)) return null
  if (n === 'lantern' || n === 'soul_lantern') return s.props.hanging === 'true' ? null : 'torch'
  if (n === 'glass_pane' || n === 'iron_bars') return `${wood}_fence`
  if (/_wool$/.test(n)) return `${wood}_planks`
  if (n === 'bookshelf' || n === 'glowstone' || n === 'sea_lantern' || n === 'shroomlight') return `${wood}_planks`
  if (n === 'grass_block') return 'dirt'
  if (n === 'ladder' || n === 'dirt' || n === 'torch') return raw
  if (WOODISH.test(n)) {
    const m = /(planks|log|stem|fence|door|stairs|slab|trapdoor|wood|hyphae)$/.exec(n)
    let part = m[1]; if (part === 'stem' || part === 'wood' || part === 'hyphae') part = 'log'
    if (/^stripped_/.test(n)) part = 'log'
    return `${wood}_${part}${props(s.props)}`
  }
  if (STONEISH.test(n)) {
    const pr = { ...s.props }
    delete pr.axis
    if (s.kind === 'stairs') return `cobblestone_stairs${props(pr)}`
    if (s.kind === 'slab') return `cobblestone_slab${props(pr)}`
    if (/_wall$/.test(n)) return `cobblestone_wall${props(pr)}`
    return 'cobblestone'
  }
  if (/^(sandstone|terracotta|red_sandstone)/.test(n)) return 'cobblestone'
  return raw // ناشناخته: همان را بگذار (ممکن است فقط در creative قابل‌تهیه باشد)
}

function survivalize (bp, wood = 'oak') {
  const blocks = []; const counts = {}
  for (const b of bp.blocks) {
    const nb = mapBlock(b.block, wood)
    if (!nb) continue
    blocks.push({ ...b, block: nb })
    const nm = nb.replace(/\[.*$/, ''); counts[nm] = (counts[nm] || 0) + 1
  }
  return { ...bp, blocks, counts, survival: true, wood }
}

module.exports = { survivalize, WOODS }
