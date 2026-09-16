// 峰谷定价与每轮消耗换算（口径移植自 dsh-whale-widget，MIT）
// 高峰时段：工作日 9:00–12:00 和 14:00–18:00（北京时间）；2026-08-23 起周末全天谷价。
// 价格：DeepSeek 官方 https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// 2026-09-10 起 Flash 系列降价：缓存命中 0.02、未命中 1、输出 4（高峰=空闲×2）；Pro 为 Flash 3 倍价。
// 单位：元 / 百万 token。每档 [空闲价, 高峰价]。

export const PEAK_HOURS = [
  [9, 12],
  [14, 18],
]

export const BASE_PRICE = { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] }
export const PRO_PRICE = { hit: [0.15, 0.3], miss: [4.5, 9.0], out: [13.5, 27.0] }

// 子串匹配（小写包含），命中即用；_default 兜底。自定义单价动态注入 CUSTOM_PRICES。
export const PRICING = {
  'deepseek-flash': BASE_PRICE,
  'deepseek-v4-flash-vision-exp': BASE_PRICE,
  'deepseek-v4-flash': BASE_PRICE,
  'deepseek-v4-pro': PRO_PRICE,
  _default: BASE_PRICE,
}

export const CUSTOM_PRICES = {} // key → {hit:[a,b], miss:[a,b], out:[a,b]}，键长降序匹配
export const CUSTOM_PRICE_META = {} // key → {currency:'USD'|'CNY', fx: 汇率(元/USD)}

export function setCustomPrices(map, meta) {
  for (const k of Object.keys(CUSTOM_PRICES)) delete CUSTOM_PRICES[k]
  Object.assign(CUSTOM_PRICES, map || {})
  for (const k of Object.keys(CUSTOM_PRICE_META)) delete CUSTOM_PRICE_META[k]
  Object.assign(CUSTOM_PRICE_META, meta || {})
}

function matchKey(table, model) {
  const m = String(model || '').toLowerCase()
  for (const key of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (key === '_default') continue
    if (key && m.indexOf(key.toLowerCase()) !== -1) return table[key]
  }
  return null
}

export function priceFor(model) {
  return matchKey(CUSTOM_PRICES, model) || matchKey(PRICING, model) || PRICING._default
}

export function customPriceMetaFor(model) {
  return matchKey(CUSTOM_PRICE_META, model)
}

// 2026-08-23（北京时间 00:00）起周末全天谷价；之前的周末仍按工作日规则（历史分桶重放一致性）。
export const WEEKEND_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000)

export function isPeakTime(timeSec) {
  const n = Number(timeSec)
  if (!Number.isFinite(n)) return false
  const bj = new Date(n * 1000 + 8 * 3600 * 1000)
  if (n >= WEEKEND_VALLEY_FROM_SEC) {
    const dow = bj.getUTCDay() // 0=周日 6=周六（bj 按 UTC 读即为北京日历日）
    if (dow === 0 || dow === 6) return false
  }
  const hour = bj.getUTCHours()
  for (const [start, end] of PEAK_HOURS) {
    if (hour >= start && hour < end) return true
  }
  return false
}

export function isPeakNow(now = Date.now()) {
  return isPeakTime(Math.floor(Number(now) / 1000))
}

// 下一个峰/谷切换时刻（北京时间整点），供倒计时显示。
export function nextPeakChange(now = Date.now()) {
  const n = Math.floor(Number(now) / 1000)
  const bj = new Date(n * 1000 + 8 * 3600 * 1000)
  const boundaries = [...PEAK_HOURS.flat(), 24]
  const hour = bj.getUTCHours()
  const dayStartSec = n - (n % 86400) - (bj.getUTCHours() * 3600 + bj.getUTCMinutes() * 60 + bj.getUTCSeconds())
  for (const b of boundaries) {
    if (hour < b) {
      const target = dayStartSec + b * 3600
      const dow = new Date((target - 1) * 1000 + 8 * 3600 * 1000).getUTCDay()
      if (b !== 24 || (dow !== 0 && dow !== 6)) return target * 1000
    }
  }
  // 明天 9:00（若明天不是周末；周末全天谷，跳到周一 9:00）
  for (let d = 1; d <= 7; d++) {
    const t = dayStartSec + d * 86400 + 9 * 3600
    const dow = new Date((t - 1) * 1000 + 8 * 3600 * 1000).getUTCDay()
    if (dow !== 0 && dow !== 6) return t * 1000
  }
  return dayStartSec + 8 * 86400 * 1000
}

// usage: {inputTokens, cacheReadTokens, outputTokens, reasoningTokens}
// 返回人民币金额（元，8 位小数内）。reasoning 已含在 output 计费里时不重复计 —— DeepSeek
// 口径 reasoning 单独计价，故 output+reasoning 都按 out 价。单价若为美元按 fx 折算。
export function turnCost(model, usage, peak = isPeakNow()) {
  const p = priceFor(model)
  const off = peak ? 1 : 0
  const meta = customPriceMetaFor(model)
  let yuan = (usage, price) => (usage / 1e6) * price
  const usd = meta && meta.currency === 'USD' && meta.fx > 0
  const conv = (v) => (usd ? v * meta.fx : v)
  const hit = conv(yuan(Number(usage.cacheReadTokens) || 0, p.hit[off]))
  const miss = conv(yuan(Number(usage.inputTokens) || 0, p.miss[off]))
  const out = conv(yuan((Number(usage.outputTokens) || 0) + (Number(usage.reasoningTokens) || 0), p.out[off]))
  return hit + miss + out
}

// 平台 usage 分桶（token-mode）求和：buckets = [{time(sec), usage:{RESPONSE_TOKEN, PROMPT_CACHE_HIT_TOKEN, PROMPT_CACHE_MISS_TOKEN}}]
export function bucketCost(model, buckets) {
  let total = 0
  for (const b of Array.isArray(buckets) ? buckets : []) {
    const u = b && b.usage ? b.usage : {}
    total += turnCost(
      model,
      {
        cacheReadTokens: Number(u.PROMPT_CACHE_HIT_TOKEN) || 0,
        inputTokens: Number(u.PROMPT_CACHE_MISS_TOKEN) || 0,
        outputTokens: Number(u.RESPONSE_TOKEN) || 0,
        reasoningTokens: 0,
      },
      isPeakTime(b && b.time),
    )
  }
  return total
}
