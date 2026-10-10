// data.js — 运行时数据表（免构建：不 fetch JSON，Cordova file:// 下会被 CORS 拦）
// 数值改动只改这里；JSON 副本由 tools/export-data.js 导出，供 Tiled 与工具链使用。

/** tile registry: id -> {name, solid, hardness H, tier, tool, drop, light, colors:[light,base,dark]} */
export const TILES = [
  { id: 0,  name: 'air',     solid: false, H: 0,   tier: 0, drop: null,     light: 0,   colors: null },
  { id: 1,  name: 'grass',   solid: true,  H: 0.5, tier: 1, drop: 'fiber',  light: 0,   colors: ['#7CC24A', '#4E9A34', '#2F6B22'] },
  { id: 2,  name: 'dirt',    solid: true,  H: 0.5, tier: 1, drop: 'dirt',   light: 0,   colors: ['#C08A5A', '#8A5A34', '#5C3A22'] },
  { id: 3,  name: 'stone',   solid: true,  H: 2.0, tier: 2, drop: 'stone',  light: 0,   colors: ['#B9BEC4', '#7E848C', '#4E545C'] },
  { id: 4,  name: 'wood',    solid: true,  H: 2.0, tier: 2, drop: 'wood',   light: 0,   colors: ['#D2A46A', '#96643A', '#5E3C22'] },
  { id: 5,  name: 'sand',    solid: true,  H: 0.5, tier: 1, drop: 'sand',   light: 0,   colors: ['#E8D8A8', '#C9B478', '#9A8456'] },
  { id: 6,  name: 'coal',    solid: true,  H: 8.0, tier: 4, drop: 'coal',   light: 0,   colors: ['#4A4A52', '#2E2E34', '#1A1A20'] },
  { id: 7,  name: 'iron',    solid: true,  H: 8.0, tier: 4, drop: 'iron_ore', light: 0, colors: ['#E0A878', '#C98A5E', '#8A5A3A'] },
  { id: 8,  name: 'gold',    solid: true,  H: 8.0, tier: 4, drop: 'gold_ore', light: 0, colors: ['#F5DC7A', '#E8C34A', '#9A8020'] },
  { id: 9,  name: 'gem',     solid: true,  H: 8.0, tier: 4, drop: 'gem',    light: 0.3, colors: ['#9AE8F2', '#5AD2E0', '#2A8A96'] },
  { id: 10, name: 'bedrock', solid: true,  H: Infinity, tier: 99, drop: null, light: 0, colors: ['#5A5A62', '#3A3A42', '#22222A'] },
  { id: 11, name: 'torch',   solid: false, H: 0.1, tier: 1, drop: 'torch',  light: 1.0, colors: ['#FFD98A', '#E8A23A', '#8A5A1A'] },
  { id: 12, name: 'leaves',  solid: true,  H: 0.5, tier: 1, drop: 'fiber',  light: 0,   colors: ['#8AD46A', '#4E9A34', '#2F6B22'] },
];

export const WALLS = [
  { id: 0, name: 'none', colors: null },
  { id: 1, name: 'dirtWall', colors: ['#6A4630', '#4A3020', '#2E1C12'] },
  { id: 2, name: 'stoneWall', colors: ['#6A7076', '#4A5058', '#2E343A'] },
];

/** items: id -> display name + stack */
export const ITEMS = {
  dirt: { name: '泥土', stack: 999, place: 2 }, stone: { name: '石头', stack: 999, place: 3 },
  wood: { name: '木材', stack: 999, place: 4 }, sand: { name: '沙子', stack: 999, place: 5 },
  coal: { name: '煤矿', stack: 999 }, iron_ore: { name: '铁矿', stack: 999 },
  gold_ore: { name: '金矿', stack: 999 }, gem: { name: '宝石', stack: 999 },
  fiber: { name: '纤维', stack: 999 }, torch: { name: '火把', stack: 99, place: 11, light: 1.0 },
  wood_pick: { name: '木镐', stack: 1, tool: { power: 1.5, speed: 1.2, tier: 1 } },
  stone_pick: { name: '石镐', stack: 1, tool: { power: 2.5, speed: 1.5, tier: 2 } },
  iron_pick: { name: '铁镐', stack: 1, tool: { power: 4.5, speed: 1.8, tier: 3 } },
  workbench: { name: '工作台', stack: 99, place: 4 },
  wood_sword: { name: '木剑', stack: 1, weapon: 10 },
  iron_sword: { name: '铁剑', stack: 1, weapon: 25 },
  rope: { name: '绳子', stack: 99 }, chest: { name: '箱子', stack: 99, place: 4 },
  furnace: { name: '熔炉', stack: 99, place: 3 }, stove: { name: '灶台', stack: 99, place: 3 },
  mill: { name: '磨坊', stack: 99, place: 4 },
  wheat: { name: '小麦', stack: 999 }, flour: { name: '面粉', stack: 999 },
  bread: { name: '面包', stack: 99, food: 40 }, berry: { name: '浆果', stack: 999, food: 10 },
  raw_meat: { name: '生肉', stack: 999, food: 5 }, cooked_meat: { name: '熟肉', stack: 999, food: 30 },
};

/** tools: id -> {power, speed, tier} */
export const TOOLS = {
  hand: { power: 0.5, speed: 1.0, tier: 0 },
  wood_pick: { power: 1.5, speed: 1.2, tier: 1 },
  stone_pick: { power: 2.5, speed: 1.5, tier: 2 },
  iron_pick: { power: 4.5, speed: 1.8, tier: 3 },
};

/**
 * dig_time = H / (tool.speed * clamp(tool.power / H, 0.25, 2.5));  tier gate before that
 */
export function digTime(tile, tool) {
  // tier gate: a tool handles its own tier and one above it (hand=0 digs tier-1 dirt/sand)
  if (!tool || tool.tier + 1 < tile.tier) return Infinity;
  if (tile.H === Infinity) return Infinity;
  const pf = Math.min(2.5, Math.max(0.25, tool.power / tile.H));
  return tile.H / (tool.speed * pf);
}

/**
 * recipes — the crafting database.
 * station: T0 hand | T1 workbench | T2 furnace/stove | T3 mill
 * tools/craft-calc.mjs reads this file to do material planning.
 */
export const RECIPES = [
  { id: 'wood_pick',   station: 'T0', inputs: [{ item: 'wood', count: 10 }], outputs: [{ item: 'wood_pick', count: 1 }], time: 0.5 },
  { id: 'torch',       station: 'T0', inputs: [{ item: 'wood', count: 2 }, { item: 'fiber', count: 1 }], outputs: [{ item: 'torch', count: 4 }], time: 0.25 },
  { id: 'workbench',   station: 'T0', inputs: [{ item: 'wood', count: 20 }], outputs: [{ item: 'workbench', count: 1 }], time: 1.0 },
  { id: 'rope',        station: 'T0', inputs: [{ item: 'fiber', count: 5 }], outputs: [{ item: 'rope', count: 1 }], time: 0.5 },
  { id: 'wood_sword',  station: 'T0', inputs: [{ item: 'wood', count: 8 }], outputs: [{ item: 'wood_sword', count: 1 }], time: 0.5 },
  { id: 'stone_pick',  station: 'T1', inputs: [{ item: 'stone', count: 15 }, { item: 'wood', count: 5 }], outputs: [{ item: 'stone_pick', count: 1 }], time: 1.0 },
  { id: 'chest',       station: 'T1', inputs: [{ item: 'wood', count: 25 }, { item: 'rope', count: 2 }], outputs: [{ item: 'chest', count: 1 }], time: 1.5 },
  { id: 'furnace',     station: 'T1', inputs: [{ item: 'stone', count: 30 }], outputs: [{ item: 'furnace', count: 1 }], time: 2.0 },
  { id: 'iron_pick',   station: 'T2', inputs: [{ item: 'iron_ore', count: 10 }, { item: 'wood', count: 5 }], outputs: [{ item: 'iron_pick', count: 1 }], time: 2.0 },
  { id: 'iron_sword',  station: 'T2', inputs: [{ item: 'iron_ore', count: 8 }], outputs: [{ item: 'iron_sword', count: 1 }], time: 2.0 },
  { id: 'cooked_meat', station: 'T2', inputs: [{ item: 'raw_meat', count: 1 }, { item: 'coal', count: 1 }], outputs: [{ item: 'cooked_meat', count: 1 }], time: 2.0 },
  { id: 'flour',       station: 'T3', inputs: [{ item: 'wheat', count: 3 }], outputs: [{ item: 'flour', count: 1 }], time: 1.0 },
  { id: 'bread',       station: 'T2', inputs: [{ item: 'flour', count: 2 }], outputs: [{ item: 'bread', count: 1 }], time: 1.5 },
];

/** raw materials: craft-calc stops expanding here (they come from digging, not crafting) */
export const RAW_MATERIALS = new Set([
  'dirt', 'stone', 'wood', 'sand', 'coal', 'iron_ore', 'gold_ore', 'gem', 'fiber', 'wheat', 'raw_meat', 'berry',
]);

/** station proximity requirement: TI+ needs the station within N tiles */
export const STATION_RANGE = 3;

/** ore depth bands (tile y) and cluster density per 32x32 cell (per-mille) */
export const ORES = [
  { id: 6, yMin: 160, yMax: 400, density: 20 },
  { id: 7, yMin: 250, yMax: 550, density: 12 },
  { id: 8, yMin: 400, yMax: 650, density: 6 },
  { id: 9, yMin: 550, yMax: 720, density: 3 },
];

export const DAY_SECONDS = 20 * 60;      // one game day = 20 real minutes
export const HOUR_SECONDS = DAY_SECONDS / 24; // 50s per game hour

/* ================= M2: survival ================= */

export const HUNGER = {
  max: 100,
  drainPerHour: { idle: 2.0, walk: 3.0, work: 5.0 },   // work = digging or fighting
  regenAbove: 80,        // hunger > 80 -> +1 HP / 5s
  regenInterval: 5.0,
  starveDps: 1.0,        // hunger == 0 -> -1 HP/s
  starveSpeedMul: 0.7,
  starveDigMul: 0.5,
  respawnValue: 50,
};

export const MOBS = {
  slime:  { name: '史莱姆', hp: 20, dmg: 6,  def: 0, speed: 40,  w: 14, h: 14, color: '#5AD2A0', biome: 'surface' },
  bat:    { name: '洞穴蝙蝠', hp: 30, dmg: 10, def: 0, speed: 90,  w: 14, h: 10, color: '#7A5AC0', biome: 'cave' },
  zombie: { name: '游荡者', hp: 60, dmg: 14, def: 2, speed: 55,  w: 14, h: 28, color: '#6E8A4A', biome: 'surface' },
};

export const SPAWN = {
  lightMax: 0.25,        // spawn only where light < 0.25 (0..1; world.light is 0..255)
  minDist: 24,           // tiles from the player — closer than this never spawns
  maxDist: 64,           // tiles from the player — beyond this never spawns
  interval: 2.0, jitter: 0.5,
  caps: { surface: 8, cave: 12, active: 64 },
  nightOnly: true,
  suppressLight: 0.25,   // player light within 3 tiles suppresses spawning
  suppressRadius: 3,
};

export const COMBAT = {
  playerHp: 100,
  weaponDmg: { hand: 2, wood_sword: 10, iron_sword: 25 },
  attackCooldown: 0.6,
  attackRange: 28,       // px
  knockbackPerDmg: 0.8,
  mobAttackCooldown: 1.0,
};

export const DEATH = {
  respawnDelay: 10,      // seconds
  hpRatio: 0.5,
  hungerRatio: 0.5,
  currencyLoss: 0.5,     // reserved for M3 economy
};

/** damage formula: never below 1 */
export const damageOf = (atk, def) => Math.max(1, atk - def);
