// مشخصات بلاک‌ها: "نام[ویژگی=مقدار,...]" مثل stone_brick_stairs[facing=east,half=top]
// و استراتژی‌های چسباندن (از کدام وجه کلیک کنیم، ربات به کدام سمت نگاه کند)
const Vec3 = require('vec3')

const D = {
  north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0),
  up: new Vec3(0, 1, 0), down: new Vec3(0, -1, 0)
}
const SIDES = [D.west, D.east, D.north, D.south]
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' }

// نام‌هایی که در نسخه‌های جدید عوض شده‌اند (مثلاً 1.21.9+: chain → iron_chain، 1.20.3+: grass → short_grass)
const ALIAS = { chain: 'iron_chain', grass: 'short_grass' }
function adapt (spec, registry) {
  if (!registry || !spec || spec._adapted) return spec
  const known = (n) => !!(registry.blocksByName[n] || registry.itemsByName[n])
  if (!known(spec.name) && ALIAS[spec.name] && known(ALIAS[spec.name])) {
    const name = ALIAS[spec.name]
    return { ...spec, name, item: name, kind: kindOf(name), raw: name + (spec.raw.includes('[') ? spec.raw.slice(spec.raw.indexOf('[')) : ''), _adapted: true }
  }
  return { ...spec, _adapted: true }
}

function parse (raw) {
  if (typeof raw !== 'string') return raw
  const m = /^([a-z0-9_]+)(?:\[(.*)\])?$/.exec(raw)
  if (!m) throw new Error('مشخصات بلاک نامعتبر: ' + raw)
  const props = {}
  if (m[2]) for (const kv of m[2].split(',')) { const [k, v] = kv.split('='); props[k.trim()] = v.trim() }
  const name = m[1]
  const spec = { raw, name, props, kind: kindOf(name), item: itemOf(name) }
  return spec
}

function itemOf (name) {
  if (name === 'water') return 'water_bucket'
  if (name === 'lava') return 'lava_bucket'
  if (name === 'wall_torch') return 'torch'
  return name
}

const PLANT = /^(dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|torch|fern|grass|oak_sapling|spruce_sapling|birch_sapling|sweet_berry_bush)$/
function kindOf (name) {
  if (name === 'air') return 'air'
  if (/_stairs$/.test(name)) return 'stairs'
  if (/_slab$/.test(name)) return 'slab'
  if (/_trapdoor$/.test(name)) return 'trapdoor'
  if (/_door$/.test(name)) return 'door'
  if (name === 'ladder') return 'ladder'
  if (name === 'lantern' || name === 'soul_lantern') return 'lantern'
  if (name === 'chain' || name === 'iron_chain') return 'chain'
  if (/_log$|_wood$|_stem$|_hyphae$|hay_block|bone_block|quartz_pillar|purpur_pillar/.test(name)) return 'axis'
  if (name === 'water' || name === 'lava') return 'fluid'
  if (PLANT.test(name) || /_carpet$/.test(name) || /_pressure_plate$/.test(name)) return 'ground'
  return 'block'
}

// ربات باید به کدام سمت نگاه کند تا بلاک با facing خواسته شده گذاشته شود
// (stairs: facing همان جهت نگاه بازیکن؛ door/trapdoor با تست واقعی کالیبره شده‌اند)
function lookFacing (spec) {
  const f = spec.props.facing
  if (!f) return null
  if (spec.kind === 'stairs') return f
  if (spec.kind === 'door' || spec.kind === 'trapdoor') return FLIP_DOORS ? OPPOSITE[f] : f
  return f
}
let FLIP_DOORS = false
function calibrate (opts) { if (opts && typeof opts.flipDoors === 'boolean') FLIP_DOORS = opts.flipDoors }

function yawFor (dirName) {
  const v = D[dirName]
  return Math.atan2(-v.x, -v.z)
}

// فهرست روش‌های چسباندن به‌ترتیب اولویت: {d: جهت از هدف تا بلاک مرجع, half?, yawDir?}
function candidates (spec) {
  const out = []
  const face = lookFacing(spec)
  const add = (d, extra = {}) => out.push({ d, ...extra, look: face })
  switch (spec.kind) {
    case 'stairs': case 'slab': case 'trapdoor': {
      const top = (spec.props.half || spec.props.type) === 'top'
      if (top) { add(D.up); for (const s of SIDES) add(s, { half: 'top' }) } else { add(D.down); for (const s of SIDES) add(s, { half: 'bottom' }) }
      break
    }
    case 'door': add(D.down); break
    case 'ladder': {
      const f = spec.props.facing // ladder facing=east یعنی به بلاک غربی می‌چسبد
      if (f) add(D[OPPOSITE[f]]); else for (const s of SIDES) add(s)
      break
    }
    case 'lantern': spec.props.hanging === 'true' ? add(D.up) : add(D.down); break
    case 'chain': add(D.up); add(D.down); break
    case 'axis': {
      const ax = spec.props.axis || 'y'
      if (ax === 'y') { add(D.down); add(D.up) } else if (ax === 'x') { add(D.west); add(D.east) } else { add(D.north); add(D.south) }
      break
    }
    case 'ground': add(D.down); break
    case 'fluid': add(D.down); for (const s of SIDES) add(s); break
    default: add(D.down); for (const s of SIDES) add(s); add(D.up)
  }
  return out
}

// آیا بلاک واقعی با مشخصات می‌خواند؟
function matches (spec, block) {
  if (!block || block.name !== spec.name) return false
  const keys = Object.keys(spec.props)
  if (!keys.length) return true
  const have = block.getProperties ? block.getProperties() : {}
  for (const k of keys) { if (k in have && String(have[k]) !== spec.props[k]) return false }
  return true
}

module.exports = { parse, adapt, ALIAS, candidates, matches, yawFor, calibrate, D, SIDES, OPPOSITE }
