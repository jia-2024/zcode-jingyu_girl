// 金币商店：记录的消费按比例铸金币，金币购买服饰/饰品。
// 铸币规则：每累计 ¥1 已记录消费 = 1 金币（COST_PER_COIN 可调）。
// 商店资产 = body-model.json 的 accessories + manifest 的 outfits；owned 持久化。
import fs from 'node:fs'
import path from 'node:path'
import { ASSETS_DIR } from './assets-paths.mjs'
import { FILES, readJson, writeJson } from './store.mjs'

export const COST_PER_COIN = 1      // 每花费 ¥1 铸 1 金币
export const STARTER_COINS = 3      // 新手礼包

// 价格表（金币）：不在表内的默认 0（免费，如经典女仆）
const PRICES = {
  // 饰品
  crown_whale: 5, ribbon_royal: 3, flower_ocean: 2, glasses_round: 2,
  scarf_navy: 3, bell_collar: 2, sailor_collar: 3, headphones: 4, cape_mini: 4,
  // 装扮
  'outfit:rice': 2, 'outfit:sticker': 1, 'outfit:classic': 4,
}

function shopFile() { return path.join(path.dirname(FILES.usage), 'shop.json') }

function loadShop() {
  const s = readJson(shopFile(), null)
  if (s && typeof s === 'object') return s
  return { spentAtInit: null, coinsSpent: 0, owned: ['outfit:maid', 'outfit:sticker'] }
}

function totalRecordedCost(ledger) {
  let total = 0
  for (const e of ledger.events || []) total += Number(e.cost) || 0
  return total
}

export function shopStatus(ledger) {
  const shop = loadShop()
  const lifetime = totalRecordedCost(ledger)
  if (shop.spentAtInit == null) {
    shop.spentAtInit = lifetime - STARTER_COINS * COST_PER_COIN // 新手礼包：视作已花对应金额
    writeJson(shopFile(), shop)
  }
  const earned = Math.max(0, Math.floor(lifetime - shop.spentAtInit) / COST_PER_COIN | 0)
  const coins = Math.max(0, earned - (shop.coinsSpent || 0))
  return { coins, coinsEarnedTotal: earned, coinsSpent: shop.coinsSpent || 0, owned: shop.owned || [], lifetimeCost: Math.round(lifetime * 100) / 100 }
}

export function catalog() {
  let accs = [], outfits = []
  try {
    const bm = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'characters', 'deepseek', 'body-model.json'), 'utf8'))
    accs = bm.accessories.map((a) => ({ id: a.id, name: a.name, kind: 'accessory', price: PRICES[a.id] ?? 0, desc: a.desc }))
  } catch {}
  try {
    const mf = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'characters', 'deepseek', 'manifest.json'), 'utf8'))
    outfits = (mf.outfits || []).map((o) => ({ id: 'outfit:' + o.id, name: o.name, kind: 'outfit', price: PRICES['outfit:' + o.id] ?? 0, desc: o.desc || '' }))
  } catch {}
  return [...outfits, ...accs]
}

export function buy(ledger, itemId) {
  const item = catalog().find((i) => i.id === itemId)
  if (!item) return { ok: false, error: '没有这个商品: ' + itemId }
  const shop = loadShop()
  const st = shopStatus(ledger)
  if ((shop.owned || []).includes(itemId)) return { ok: false, error: '已经拥有啦' }
  if (st.coins < item.price) return { ok: false, error: `金币不够（需要 ${item.price}，现有 ${st.coins}）。多聊几轮就攒出来了～` }
  shop.coinsSpent = (shop.coinsSpent || 0) + item.price
  shop.owned = [...(shop.owned || []), itemId]
  writeJson(shopFile(), shop)
  return { ok: true, item, coinsLeft: shopStatus(ledger).coins }
}

export function isOwned(itemId) {
  return loadShop().owned?.includes(itemId) || false
}
