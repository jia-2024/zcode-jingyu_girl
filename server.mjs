// ZCode 余额小鲸鱼挂件 —— 本地服务
// 功能口径对齐 dsh-whale-widget（MIT）：余额 60s 自动刷新 + 手动刷新、瞬时失败沿用最近余额、
// 小鲸鱼记账（余额观测差值）/ 实时·令牌 双模式、峰谷定价、每轮消耗（真实 usage 计价）、
// 余额预警 / 今日预算、多厂商余额模板、逐轮明细 90 天/2 万条 + 逐日 365 天归档。
// 安全：只绑 127.0.0.1；Host 校验防 DNS 重绑定；密钥只从环境变量或 keys.json 读，绝不落 api.json。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  beijingDay, observeBalance, reconcileBalance, balanceSummary, daySummary,
  eventEstimate, sumMoney, preciseMoney,
} from './lib/accounting.mjs'
import { isPeakNow, nextPeakChange, turnCost, bucketCost, priceFor, setCustomPrices, PRICING, PEAK_HOURS, BASE_PRICE, PRO_PRICE } from './lib/pricing.mjs'
import { API_TEMPLATES, pickPath } from './lib/templates.mjs'
import { generateMeme, listGeneratedMemes, MEME_PRESETS } from './lib/meme-gen.mjs'
import { personalitySummary, personalityLine, PERSONALITIES } from './lib/personality.mjs'
import { chat as whaleChat } from './lib/chat.mjs'
import { getWeather } from './lib/weather.mjs'
import { shopStatus, catalog as shopCatalog, buy as shopBuy, isOwned } from './lib/shop.mjs'
import { DATA_DIR, FILES, ensureDataDir, readJson, writeJson, resolveKey } from './lib/store.mjs'

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url))
const ASSETS_DIR = path.join(PACKAGE_ROOT, 'assets')
const PUBLIC_DIR = path.join(PACKAGE_ROOT, 'public')
const PORT = Number(process.env.WHALE_PORT || 8787)
const BALANCE_TTL_MS = 25000
const AUTO_REFRESH_MS = 60000
const TOKEN_TTL_MS = 5 * 60000

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
}

// ---------- 运行时状态 ----------
const balanceCache = new Map() // modelId → { ok, totalBalance, currency, updatedAt, stale?, error? }
const inFlight = new Map() // modelId → promise
const tokenCache = { at: 0, value: null }
let lastTurn = null // { turn, amount, tokens, model, ts }
let turnSeq = 0

// ---------- 账本 ----------
function defaultLedger() {
  return { date: beijingDay(), lastBalance: null, lastCurrency: 'CNY', todayUsage: 0, history: {}, events: [], models: {} }
}
let ledger = defaultLedger()
{
  const saved = readJson(FILES.usage, null)
  if (saved && typeof saved === 'object' && typeof saved.date === 'string') ledger = saved
}
let saveTimer = null
function saveLedger() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { try { writeJson(FILES.usage, ledger) } catch (err) { console.error('saveLedger:', err.message) } }, 300)
}
function saveLedgerNow() { clearTimeout(saveTimer); try { writeJson(FILES.usage, ledger) } catch (err) { console.error('saveLedger:', err.message) } }

// ---------- 挂件外观/开关 ----------
const DEFAULT_STATE = {
  scale: 1.5, sound: true, vol: 0.6, soundSet: 'duck',
  usageMode: 'ledger', peakMode: 'full', bubbleOn: true,
  turnCostOn: true, turnCostCloseMs: 8000,
  snap: { enabled: true, edges: { left: 0, right: 0, top: 0, bottom: 0 } },
  position: { left: null, top: null, h: 'right', v: 'bottom' },
  hiddenMenuBtn: false,
  // 鲸鱼娘形象体系：形态（whalechan 5 形态）/ 装扮 / 饰品 / 语境模式
  form: 'semi-chibi', outfit: 'maid', accessories: [], manual: false, manualState: null,
  memeBubbles: true, petScale: 1.0, petOn: true, weatherCity: '北京',
}
let state = { ...DEFAULT_STATE, ...(readJson(FILES.state, {}) || {}) }

// ---------- 记账设置（余额预警 / 预算 / 音效 / 提醒内容） ----------
// 存在 usage.settings，避免和外观混写
ledger.settings ||= { balanceWarn: 10, dailyBudget: 0, turnEndSound: 'exp_orb', alertAutoCloseMs: 0 }

// ---------- 自定义 API 模型注册表（不含密钥） ----------
function defaultModels() {
  return [
    {
      id: 'deepseek', provider: 'deepseek', templateId: 'deepseek', builtin: true,
      name: 'DeepSeek（内置）', currency: 'CNY', keyRef: 'DEEPSEEK_API_KEY',
      balance: { ...API_TEMPLATES.deepseek.balance },
    },
    {
      id: 'glm', provider: 'zhipu', templateId: 'zhipu_glm_coding', builtin: true, kind: 'quota',
      name: 'GLM Coding Plan', currency: 'CNY', keyRef: 'ZHIPU_API_KEY',
    },
  ]
}
let apiModels = (readJson(FILES.api, null)?.models) || defaultModels()

function applyCustomPrices() {
  const prices = {}, meta = {}
  for (const m of apiModels) {
    if (!m.prices) continue
    const p = m.prices
    if (!Array.isArray(p.hit) && !Array.isArray(p.miss) && !Array.isArray(p.out)) continue
    prices[m.id] = {
      hit: Array.isArray(p.hit) ? p.hit : BASE_PRICE.hit,
      miss: Array.isArray(p.miss) ? p.miss : BASE_PRICE.miss,
      out: Array.isArray(p.out) ? p.out : BASE_PRICE.out,
    }
    if (p.priceCurrency === 'USD') meta[m.id] = { currency: 'USD', fx: Number(p.fx) || 7 }
  }
  setCustomPrices(prices, meta)
}
applyCustomPrices()

// ---------- 每轮 seq ----------
{
  const t = readJson(FILES.turn, null)
  if (t && Number.isFinite(Number(t.seq))) { turnSeq = Number(t.seq); lastTurn = t.last || null }
}
function saveTurn() { writeJson(FILES.turn, { seq: turnSeq, last: lastTurn }) }

// ---------- 余额拉取 ----------
function pickBalanceInfo(infos) {
  if (!Array.isArray(infos) || infos.length === 0) return null
  const num = (x) => (x && x.total_balance !== undefined ? Number(x.total_balance) : NaN)
  return (
    infos.find((x) => x && x.currency === 'CNY' && num(x) > 0) ||
    infos.find((x) => num(x) > 0) ||
    infos.find((x) => x && x.currency === 'CNY') ||
    infos[0]
  )
}

async function fetchJsonUrl(url, authHeader, timeoutMs = 20000) {
  const u = new URL(String(url))
  // 协议白名单：拒绝 file:/data:/ftp: 等非 HTTP(S) 方案（SSRF 栅栏之一）
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw Object.assign(new Error('仅允许 http/https 协议: ' + u.protocol), { status: 400 })
  }
  const res = await fetch(u, { headers: authHeader ? { Authorization: authHeader } : {}, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
  if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status })
  return res.json()
}

// 模板驱动的通用余额拉取：网络错误/超时/5xx 重试 1 次；4xx 不重试。
async function fetchModelBalance(model) {
  const key = resolveKey(model.keyRef)
  if (!key) return { ok: false, code: 'NO_KEY', error: '未配置 ' + (model.keyRef || '密钥') }
  const tpl = model.balance || {}
  if (!tpl.url) return { ok: false, code: 'NO_BALANCE_API', noBalanceApi: true, error: '该厂商没有余额查询接口' }
  const url = String(tpl.url).replace('{base}', String(model.baseUrl || '').replace(/\/+$/, ''))
  const auth = String(tpl.auth || '').replace('{key}', key) || null
  let lastErr = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await fetchJsonUrl(url, auth)
      const j = tpl.json || {}
      if (model.provider === 'deepseek') {
        const info = pickBalanceInfo(data && data.balance_infos)
        if (!info || !Number.isFinite(Number(info.total_balance))) return { ok: false, code: 'SHAPE', error: '余额接口返回结构异常' }
        return { ok: true, totalBalance: Number(info.total_balance), currency: String(info.currency || model.currency || 'CNY'), accountTag: shaTag(key), updatedAt: new Date().toISOString() }
      }
      const total = j.total ? pickPath(data, j.total) : undefined
      const used = j.used ? pickPath(data, j.used) : undefined
      let remaining = j.remaining ? pickPath(data, j.remaining) : undefined
      if (remaining === undefined && total !== undefined && used !== undefined) remaining = Number(total) - Number(used)
      if (remaining === undefined || !Number.isFinite(Number(remaining))) return { ok: false, code: 'SHAPE', error: '字段路径未命中或结构异常' }
      const scale = Number(tpl.json?.scale ?? j.scale ?? 1) || 1
      return { ok: true, totalBalance: Number(remaining) * scale, currency: String(model.currency || 'CNY'), accountTag: shaTag(key), updatedAt: new Date().toISOString(), used: used !== undefined ? Number(used) * scale : undefined }
    } catch (err) {
      lastErr = err
      if (attempt === 0 && !(err instanceof Error && /^HTTP 4/.test(err.message))) {
        await new Promise((r) => setTimeout(r, 500))
        continue
      }
      break
    }
  }
  const transient = !(lastErr && /^HTTP 4\d\d/.test(String(lastErr.message)))
  return { ok: false, code: 'HTTP', transient, error: '余额接口请求失败: ' + String(lastErr?.message || lastErr).slice(0, 200) }
}

function shaTag(key) { return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 24) }

// 带 25s 缓存 + in-flight 去重；瞬时失败且已有缓存 → 返回旧值 stale:true。
async function getBalance(model, force = false) {
  const cached = balanceCache.get(model.id)
  if (!force && cached && cached.ok && Date.now() - Date.parse(cached.updatedAt) < BALANCE_TTL_MS) return cached
  if (inFlight.has(model.id)) return inFlight.get(model.id)
  const p = (async () => {
    const result = await fetchModelBalance(model)
    if (result.ok) {
      balanceCache.set(model.id, result)
      observeBalance(ledger, { balance: result.totalBalance, currency: result.currency, scope: model.id, at: Date.now() })
      saveLedger()
    } else if (cached && cached.ok && result.transient) {
      return { ...cached, stale: true }
    } else {
      balanceCache.set(model.id, result)
    }
    return result
  })().finally(() => inFlight.delete(model.id))
  inFlight.set(model.id, p)
  return p
}

// 实时·令牌（builtin DeepSeek 平台 usage 接口，token 分桶按峰谷计价；无令牌/失效回落记账模式）
async function fetchTokenUsage() {
  const token = resolveKey('DEEPSEEK_PLATFORM_TOKEN')
  if (!token) return { ok: false, code: 'NO_TOKEN', error: '未配置 DEEPSEEK_PLATFORM_TOKEN' }
  const day = beijingDay()
  const start = Math.floor(Date.parse(day + 'T00:00:00+08:00') / 1000)
  const url = `https://platform.deepseek.com/api/v0/usage/by_api_key/amount?start=${start}&end=${start + 86400}&tz=28800`
  try {
    const data = await fetchJsonUrl(url, 'Bearer ' + token, 15000)
    const series = data?.data?.biz_data?.series || []
    let amount = 0
    for (const s of series) amount += bucketCost(String(s.model || ''), s.buckets)
    return { ok: true, amount, day, updatedAt: new Date().toISOString() }
  } catch (err) {
    return { ok: false, code: 'HTTP', error: '平台用量接口请求失败: ' + String(err?.message || err).slice(0, 200) }
  }
}

// ---------- 今日已用汇总 ----------
async function todaySummary() {
  const mode = state.usageMode
  if (mode === 'token') {
    if (Date.now() - tokenCache.at > TOKEN_TTL_MS) tokenCache.value = await fetchTokenUsage()
    const t = tokenCache.value
    if (t && t.ok) {
      return { amount: t.amount, currency: 'CNY', source: 'token', label: '实时·令牌', day: t.day, partialDay: true }
    }
    // 回落记账模式
  }
  const s = daySummary(ledger, beijingDay())
  return s || { amount: 0, currency: 'CNY', source: 'none', label: '暂无记录', day: beijingDay(), partialDay: true }
}

// ---------- 记录修剪与归档 ----------
const EVENT_KEEP_MS = 90 * 86400000
const EVENT_KEEP_MAX = 20000
const DAY_KEEP = 365
function pruneLedger() {
  const now = Date.now()
  const archive = readJson(FILES.archive, { events: [], days: {} })
  let dirty = false
  const events = Array.isArray(ledger.events) ? ledger.events : []
  const overflow = events.filter((e) => Number(e.ts) < now - EVENT_KEEP_MS)
  if (overflow.length || events.length > EVENT_KEEP_MAX) {
    const drop = new Set(overflow)
    while (events.length - drop.size > EVENT_KEEP_MAX) {
      const oldest = events.reduce((a, b) => (Number(a.ts) < Number(b.ts) ? a : b))
      drop.add(oldest)
    }
    for (const e of drop) archive.events.push(e)
    ledger.events = events.filter((e) => !drop.has(e))
    dirty = true
  }
  const history = ledger.history || {}
  for (const day of Object.keys(history)) {
    if (day < beijingDay(now - DAY_KEEP * 86400000)) {
      archive.days[day] = history[day]
      delete history[day]
      dirty = true
    }
  }
  if (dirty) { writeJson(FILES.archive, archive); saveLedgerNow() }
}

// ---------- GLM Coding Plan 额度（主显示） ----------
// 实测接口形态（2026-09-17，open.bigmodel.cn）：
// GET /api/monitor/usage/quota/limit，头 Authorization: <key>（裸 key，无 Bearer）
// → data.limits[]: {type:'CREDIT_LIMIT', unit(3=小时,6=月), number(窗口长度), usage(总量),
//    currentValue(已用), remaining(剩余), percentage(已用%), nextResetTime(epoch ms)} + level
const QUOTA_TTL_MS = 60000
let quotaCache = { at: 0, value: null }
function windowLabel(unit, number) {
  if (unit === 3) return `${number}h`
  if (unit === 6) return `${number}个月`
  if (unit === 2) return `${number}天`
  return `${number}·u${unit}`
}
async function fetchGlmQuota(force = false) {
  if (!force && quotaCache.value && Date.now() - quotaCache.at < QUOTA_TTL_MS) return quotaCache.value
  const key = resolveKey('ZHIPU_API_KEY')
  if (!key) {
    quotaCache = { at: Date.now(), value: { ok: false, code: 'NO_KEY', error: '未配置 ZHIPU_API_KEY' } }
    return quotaCache.value
  }
  try {
    const data = await fetchJsonUrl('https://open.bigmodel.cn/api/monitor/usage/quota/limit', key, 15000)
    const limits = Array.isArray(data?.data?.limits) ? data.data.limits : []
    const windows = limits.map((l) => ({
      label: windowLabel(Number(l.unit), Number(l.number)),
      usedPct: Math.round(Number(l.percentage) || 0),
      remaining: Number(l.remaining) || 0,
      total: Number(l.usage) || 0,
      used: Number(l.currentValue) || 0,
      resetsAt: Number(l.nextResetTime) || null,
    }))
    quotaCache = { at: Date.now(), value: { ok: windows.length > 0, level: String(data?.data?.level || ''), windows, updatedAt: new Date().toISOString() } }
  } catch (err) {
    quotaCache = { at: Date.now(), value: { ok: false, code: 'HTTP', error: 'GLM 额度接口请求失败: ' + String(err?.message || err).slice(0, 160) } }
  }
  return quotaCache.value
}

// ---------- 语境状态机（桌宠与控制台共用的单一事实源） ----------
function beijingHourNow() { return new Date(Date.now() + 8 * 3600000).getUTCHours() }
const STATE_LINES_EXTRA = {
  error: ['接口开小差了，稍后再试？', '呜……网络又欺负我'],
}
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)] }
async function contextState() {
  const builtin = apiModels.find((m) => m.id === 'deepseek')
  const bal = builtin ? await getBalance(builtin) : { ok: false }
  const quota = await fetchGlmQuota()
  const today = await todaySummary()
  const lastTurnAge = lastTurn ? Date.now() - Number(lastTurn.ts) : Infinity
  const quotaMaxPct = quota.ok ? Math.max(0, ...quota.windows.map((w) => w.usedPct)) : 0
  const s = ledger.settings || {}
  const balanceLow = bal.ok && Number(bal.totalBalance) < Number(s.balanceWarn || 0)
  const state = stateSettings()

  // 自动语境判定（优先级从高到低）；手动指定 state 时直接用
  let st
  const overBudget = Number(s.dailyBudget) > 0 && Number(today.amount) >= Number(s.dailyBudget)
  if (state.manual && state.manualState) st = state.manualState
  else if (bal.ok === false && bal.error && bal.code !== 'NO_KEY') st = 'error'
  else if (quotaMaxPct >= 90 || balanceLow) st = 'beg'
  else if (lastTurnAge < 8000) st = 'happy'
  else if (beijingHourNow() < 7) st = 'sleeping'
  else if (overBudget) st = 'guilty'
  else if (isPeakNow()) st = 'working'
  else if (quotaMaxPct >= 60) st = 'thinking'
  else st = Math.floor(Date.now() / 180000) % 2 ? 'eating' : 'idle'

  // 台词与表情包
  const charDir = path.join(ASSETS_DIR, 'characters')
  let lines = []
  try { lines = JSON.parse(fs.readFileSync(path.join(charDir, '..', 'memes', 'context-map.json'), 'utf8')).states[st]?.lines || [] } catch {}
  lines = [...lines, ...(STATE_LINES_EXTRA[st] || [])]
  let memes = []
  try { memes = JSON.parse(fs.readFileSync(path.join(charDir, '..', 'memes', 'context-map.json'), 'utf8')).states[st]?.memes || [] } catch {}
  if (!lines.length) lines = ['鲸鱼娘待机中～']

  // 形象解析：装扮 → 形态 → 状态图（找不到就沿 fallback 链退到 idle）
  const manifest = readCharacterManifest('deepseek')
  const outfit = manifest?.outfits?.find((o) => o.id === state.outfit) || manifest?.outfits?.[0]
  const form = manifest?.forms?.[state.form] ? state.form : (manifest?.defaultForm || 'semi-chibi')
  // 归一化为相对 assets/ 的安全子路径（装帄件可能写 ../DSniang1.png 这类相对路径）
  const assetUrl = (rel) => {
    if (!rel) return null
    const abs = path.normalize(path.join(ASSETS_DIR, 'characters', 'deepseek', rel))
    const r = path.relative(ASSETS_DIR, abs).replace(/\\/g, '/')
    return r.startsWith('..') ? null : '/api/assets/' + r
  }
  let imageUrl = null
  // 跨形态回退：本形态没有的状态图，按形态优先级去其他形态找（生气/愧疚等表情在各形态不全）
  const findStateImg = (stName) => {
    for (const f of [form, 'semi-chibi', 'chibi', 'super-deformed', 'compact', 'standard']) {
      const u = (manifest?.stateImages?.[f] || {})[stName]
      if (u) return u
    }
    return null
  }
  const stateImg = findStateImg(st)
  const fallbackState = manifest?.stateFallback?.[st] || 'idle'
  const fallbackImg = findStateImg(fallbackState)
  const outfitImg = outfit?.images ? (outfit.images[st] || outfit.images[fallbackState] || outfit.images.idle) : null
  if (outfit && outfit.useMemes) imageUrl = null // 表情包模式：主形象仍用形态图，气泡出表情包
  else if (outfitImg) imageUrl = assetUrl(outfitImg)
  else if (stateImg) imageUrl = assetUrl(stateImg)
  else if (fallbackImg) imageUrl = assetUrl(fallbackImg)

  let stateMemes = {}
  try {
    const cm = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'memes', 'context-map.json'), 'utf8'))
    stateMemes = cm.states || {}
  } catch {}
  const showMeme = (outfit?.useMemes || state.memeBubbles !== false) && memes.length > 0 && Math.random() < (outfit?.useMemes ? 1 : 0.35)
  let memeId = showMeme ? pickRandom(memes) : null
  // 扩充贴纸池（memes/extra/）：非 alert/error 语境时 15% 概率随机出一张收藏贴纸
  let memeExtra = null
  if (!['alert', 'error'].includes(st) && Math.random() < 0.15) {
    try {
      const extras = fs.readdirSync(path.join(ASSETS_DIR, 'memes', 'extra')).filter((f) => f.endsWith('.webp'))
      if (extras.length) memeExtra = 'extra/' + pickRandom(extras)
    } catch {}
  }

  // 性格系统：台词按语境混入（警示态用安慰，日常用 ambient，切换轮换 greet）
  let personality = null
  try { personality = personalitySummary() } catch {}
  let lineFinal = pickRandom(lines)
  if (personality) {
    if (st === 'alert' || st === 'sad' || st === 'error') lineFinal = personalityLine('comfort')
    else if (Math.random() < 0.4) lineFinal = personalityLine('ambient')
  }
  let shop = null
  try { shop = shopStatus(ledger) } catch {}
  let weather = null
  try { weather = await getWeather(state.weatherCity || '北京') } catch {}

  return {
    state: st,
    personality: personality ? { id: personality.id, name: personality.name, emoji: personality.emoji, temper: personality.temper, behavior: personality.behavior } : null,
    coins: shop ? { balance: shop.coins, owned: shop.owned } : null,
    weather,
    character: { id: 'deepseek', name: manifest?.name || '鲸鱼娘', form, formName: manifest?.forms?.[form]?.name, outfit: outfit?.id, outfitName: outfit?.name },
    imageUrl,
    line: lineFinal,
    memeUrl: memeExtra ? `/api/assets/memes/${memeExtra}` : (memeId ? `/api/assets/memes/meme-${memeId}.webp` : null),
    _stateMemes: stateMemes,
    quota, balance: bal.ok ? { totalBalance: bal.totalBalance, currency: bal.currency, stale: !!bal.stale } : null,
    todayUsage: today.amount,
    isPeak: isPeakNow(),
    quotaPrimary: true,
    ts: Date.now(),
  }
}

const IMG_EXT = ['.png', '.webp', '.jpg', '.jpeg']
async function importAssets(body) {
  const kind = String(body.kind || 'outfit')
  const src = String(body.path || '').trim()
  const name = String(body.name || '').trim().replace(/[\/:*?"<>|]/g, '') || '导入'
  if (!src || !fs.existsSync(src)) return { ok: false, error: '目录不存在: ' + src }
  const files = fs.readdirSync(src).filter((f) => IMG_EXT.includes(path.extname(f).toLowerCase())).sort()
  if (!files.length) return { ok: false, error: '目录里没有图片（png/webp/jpg）' }
  const stamp = Date.now().toString(36)

  if (kind === 'outfit') {
    // 按文件名关键词映射状态，找不到的归 idle（第一张）
    const hint = (f) => (/work|工作|code/i.test(f) ? 'working' : /eat|rice|饭|吃/i.test(f) ? 'eating' : /rest|sleep|睡|躺/i.test(f) ? 'rest' : /happy|笑|开心/i.test(f) ? 'happy' : null)
    const dirName = 'imported-' + stamp
    const dstDir = path.join(ASSETS_DIR, 'characters', 'deepseek', dirName)
    fs.mkdirSync(dstDir, { recursive: true })
    const images = {}
    files.forEach((f, i) => {
      const stKey = hint(f) || (Object.values(images).length ? '' : 'idle')
      if (stKey && !images[stKey]) {
        fs.copyFileSync(path.join(src, f), path.join(dstDir, stKey + path.extname(f).toLowerCase()))
        images[stKey] = `${dirName}/${stKey}${path.extname(f).toLowerCase()}`
      }
    })
    if (!images.idle) {
      const first = files[0]
      fs.copyFileSync(path.join(src, first), path.join(dstDir, 'idle' + path.extname(first).toLowerCase()))
      images.idle = `${dirName}/idle${path.extname(first).toLowerCase()}`
    }
    const mfPath = path.join(ASSETS_DIR, 'characters', 'deepseek', 'manifest.json')
    const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'))
    const id = 'imp' + stamp
    mf.outfits.push({ id, name: `自定义·${name}`, desc: '导入的形象', images })
    fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2))
    return { ok: true, kind, id, imported: Object.keys(images).length, images }
  }

  if (kind === 'accessory') {
    const slot = ['head_top', 'ear_fin_l', 'ear_fin_r', 'eyes', 'neck'].includes(body.slot) ? body.slot : 'head_top'
    const id = 'acc' + stamp
    const accDir = path.join(ASSETS_DIR, 'accessories')
    fs.mkdirSync(accDir, { recursive: true })
    fs.copyFileSync(path.join(src, files[0]), path.join(accDir, id + path.extname(files[0]).toLowerCase()))
    const bmPath = path.join(ASSETS_DIR, 'characters', 'deepseek', 'body-model.json')
    const bm = JSON.parse(fs.readFileSync(bmPath, 'utf8'))
    bm.accessories.push({ id, name, slot, scale: Number(body.scale) || 0.15, palette: ['#3a5aa8', '#c9a86a'], desc: '导入饰品', image: true })
    fs.writeFileSync(bmPath, JSON.stringify(bm, null, 2))
    return { ok: true, kind, id, slot }
  }
  return { ok: false, error: 'kind 必须是 outfit 或 accessory' }
}

function readCharacterManifest(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'characters', id, 'manifest.json'), 'utf8'))
  } catch { return null }
}

function stateSettings() { return state }


// ---------- 主余额聚合响应（对应原 /dsh-whale/balance.json） ----------
async function balancePayload() {
  const builtin = apiModels.find((m) => m.id === 'deepseek')
  const bal = builtin ? await getBalance(builtin) : { ok: false, code: 'NO_MODEL', error: '未配置任何模型' }
  const quota = await fetchGlmQuota()
  const today = await todaySummary()
  const s = ledger.settings || {}
  const payload = {
    ok: bal.ok !== false,
    totalBalance: bal.ok ? bal.totalBalance : (balanceCache.get(builtin?.id)?.totalBalance ?? null),
    currency: bal.currency || builtin?.currency || 'CNY',
    updatedAt: bal.updatedAt || balanceCache.get(builtin?.id)?.updatedAt || null,
    stale: !!bal.stale,
    todayUsage: today.amount,
    todayLabel: today.label,
    todaySource: today.source,
    isPeak: isPeakNow(),
    nextPeakChangeAt: nextPeakChange(),
    usageMode: state.usageMode === 'token' && today.source === 'token' ? 'token' : 'ledger',
    needsReview: !!balanceSummary(ledger)?.needsReview,
    quota,
    quotaPrimary: true,
    alerts: computeAlerts(bal, today, s),
    error: bal.ok ? null : bal.error,
    code: bal.ok ? null : bal.code,
  }
  return payload
}

function computeAlerts(bal, today, s) {
  const alerts = []
  const warn = Number(s.balanceWarn)
  if (warn > 0 && bal.ok && Number(bal.totalBalance) < warn) {
    alerts.push({ type: 'balance', message: `余额低于 ¥${warn.toFixed(2)}`, balance: bal.totalBalance, threshold: warn })
  }
  const budget = Number(s.dailyBudget)
  if (budget > 0 && Number(today.amount) >= budget) {
    alerts.push({ type: 'budget', message: `今日已用达到预算 ¥${budget.toFixed(2)}`, today: today.amount, threshold: budget })
  }
  return alerts
}

// ---------- 每轮消耗记录 ----------
function recordTurnCost(input) {
  // 同一 turnId 只记一次（Stop 钩子在续写循环里会对同一轮多次触发）
  if (input.turnId && lastTurn && lastTurn.turnId === input.turnId) return lastTurn
  const model = String(input.model || '').slice(0, 120) || 'unknown'
  const usage = {
    inputTokens: Number(input.inputTokens) || 0,
    cacheReadTokens: Number(input.cacheReadTokens) || 0,
    outputTokens: Number(input.outputTokens) || 0,
    reasoningTokens: Number(input.reasoningTokens) || 0,
  }
  const cost = turnCost(model, usage)
  const now = Date.now()
  const day = beijingDay(now)
  ledger.events ||= []
  ledger.events.push({ id: crypto.randomUUID(), day, ts: now, model, cost, tokens: usage })
  // 按模型聚合（今日 / 累计 / 逐日）
  const m = (ledger.models ||= {})[model] ||= { today: 0, total: 0, day: '', days: {} }
  if (m.day !== day) { m.day = day; m.today = 0 }
  m.today = preciseMoney(Number(m.today) + cost)
  m.total = preciseMoney(Number(m.total) + cost)
  m.days[day] = preciseMoney(Number(m.days[day] || 0) + cost)
  // 订阅额度自动累计（口径 input + cacheRead + output，跨天保留）
  for (const am of apiModels) {
    if (am.quota && am.quota.trackFromEvents && matchesModel(am, model)) {
      am.quota.used = preciseMoney(0) + (Number(am.quota.used) || 0) + usage.inputTokens + usage.cacheReadTokens + usage.outputTokens
      am.quota.usedDay = day
    }
  }
  turnSeq += 1
  lastTurn = { turn: turnSeq, turnId: String(input.turnId || '').slice(0, 80) || undefined, amount: cost, tokens: usage, model, ts: now }
  saveTurn()
  saveLedger()
  return lastTurn
}

function matchesModel(m, modelName) {
  const tpl = API_TEMPLATES[m.templateId]
  const ids = (m.matchIds || tpl?.matchIds || []).map((x) => String(x).toLowerCase())
  if (!ids.length) return false
  const name = String(modelName || '').toLowerCase()
  return ids.some((k) => name.includes(k.toLowerCase()))
}

// ---------- 记录窗口数据 ----------
function recordsPayload(days = 7) {
  const day = beijingDay()
  const list = []
  for (let i = 0; i < days; i++) {
    const d = beijingDay(Date.now() - i * 86400000)
    const s = daySummary(ledger, d)
    if (s) list.push(s)
  }
  const byModel = {}
  for (const e of ledger.events || []) {
    const k = e.model || 'unknown'
    byModel[k] ||= { model: k, today: 0, total: 0 }
    byModel[k].total = preciseMoney(Number(byModel[k].total) + Number(e.cost) || 0)
    if (e.day === day) byModel[k].today = preciseMoney(Number(byModel[k].today) + Number(e.cost) || 0)
  }
  const todayDetail = (ledger.events || []).filter((e) => e.day === day).map((e) => ({
    ts: e.ts, time: new Date(Number(e.ts) + 8 * 3600000).toISOString().slice(11, 19), model: e.model, cost: e.cost,
    in: (Number(e.tokens?.inputTokens) || 0) + (Number(e.tokens?.cacheReadTokens) || 0),
    out: Number(e.tokens?.outputTokens) || 0,
  })).sort((a, b) => b.ts - a.ts)
  return {
    today: daySummary(ledger, day),
    recent: list,
    models: Object.values(byModel).sort((a, b) => b.total - a.total),
    todayDetail,
    todayEventEstimate: eventEstimate(ledger, day),
  }
}

// ---------- HTTP 基础 ----------
function send(res, status, body, headers = JSON_HEADERS) {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, headers)
  res.end(data)
}
function sendErr(res, err, status = 400) {
  send(res, err.status || status, { ok: false, error: String((err && err.message) || err).slice(0, 300) })
}

function readBody(req, limit = 1048576) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('请求体不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

// Host 校验（DNS 重绑定栅栏）：只接受 127.0.0.1 / localhost / [::1]
function hostAllowed(req) {
  const h = String(req.headers.host || '')
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h)
}
function originAllowed(req) {
  const o = req.headers.origin
  if (!o) return true // 本机钩子脚本直连没有 Origin
  try { return hostAllowed({ headers: { host: new URL(o).host } }) } catch { return false }
}

function serveFile(res, file, type) {
  try {
    const bytes = fs.readFileSync(file)
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
    res.end(bytes)
  } catch {
    send(res, 404, { ok: false, error: 'not found' })
  }
}

const MIME = {
  '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
}

// ---------- 路由 ----------
async function route(req, res, url) {
  const p = url.pathname
  const method = req.method

  if (method === 'GET' && p === '/') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8')
  if (method === 'GET' && p === '/widget.js') return serveFile(res, path.join(PUBLIC_DIR, 'widget.js'), 'application/javascript; charset=utf-8')

  if (p.startsWith('/api/assets/')) {
    // 支持子路径（characters/deepseek/forms/... 、memes/...），拼接后必须仍在 assets 目录内
    const rel = decodeURIComponent(p.slice('/api/assets/'.length))
    const file = path.normalize(path.join(ASSETS_DIR, rel))
    if (!file.startsWith(ASSETS_DIR)) return send(res, 403, { ok: false, error: 'forbidden' })
    return serveFile(res, file, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
  }
  if (p.startsWith('/api/sound/')) {
    const q = new URLSearchParams(url.search)
    const set = q.get('set') === 'fx1' ? 'fx1' : 'duck'
    const kind = p.endsWith('release.mp3') ? '2' : '1'
    return serveFile(res, path.join(ASSETS_DIR, `${set === 'fx1' ? 'D' : 'Ya'}${kind}.mp3`), 'audio/mpeg')
  }
  if (p.startsWith('/api/bubble-imgs/')) {
    // 用户泡泡图库：存 DATA_DIR/bubble-imgs/
    const name = path.basename(decodeURIComponent(p.slice('/api/bubble-imgs/'.length)))
    const file = path.join(DATA_DIR, 'bubble-imgs', name)
    if (!file.startsWith(path.join(DATA_DIR, 'bubble-imgs'))) return send(res, 403, { ok: false, error: 'forbidden' })
    return serveFile(res, file, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
  }

  if (method === 'GET' && p === '/api/balance.json') return send(res, 200, await balancePayload())

  // GLM 额度（主显示）
  if (method === 'GET' && p === '/api/quota.json') {
    return send(res, 200, { ok: true, ...(await fetchGlmQuota(url.searchParams.get('force') === '1')) })
  }

  // 语境状态：形象/状态/台词/表情包 + 额度余额聚合（桌宠与控制台共用）
  if (method === 'GET' && p === '/api/context-state.json') return send(res, 200, { ok: true, ...(await contextState()) })

  // 聊天：3 轮上下文 + 性格/语境 system；AI 回文字或映射表情包库图片
  if (method === 'POST' && p === '/api/chat') {
    const body = await readBody(req)
    const cs = await contextState()
    const quota = cs.quota && cs.quota.ok ? cs.quota.windows.map((w) => `${w.label}窗口剩${100 - w.usedPct}%`).join('，') : ''
    const r = await whaleChat({ state: cs.state, quotaText: quota, _stateMemes: cs._stateMemes }, String(body.text || ''))
    const out = { ok: r.ok !== false, reply: r.reply ?? r.fallback ?? '……', memeUrl: r.memeUrl || null }
    // 兜底：用户明确要表情包但 AI 没配 → 按关键词直接从库里挑
    if (!out.memeUrl && r.ok && /表情包|来张|发张|发个图|图片/.test(String(body.text || ''))) {
      const map = { 吃: 'eating', 饭: 'eating', 生气: 'angry', 哭: 'sad', 难过: 'sad', 睡: 'sleeping', 钱: 'alert', 余额: 'alert', 错: 'error', bug: 'error', 夸: 'proud', 开心: 'happy', 高兴: 'happy' }
      for (const [kw, stName] of Object.entries(map)) {
        const kwIds = (cs._stateMemes && cs._stateMemes[stName]?.memes) || []
        if (String(body.text).includes(kw) && kwIds.length) {
          out.memeUrl = `/api/assets/memes/meme-${kwIds[Math.floor(Math.random() * kwIds.length)]}.webp`
          break
        }
      }
      const stIds = (cs._stateMemes && cs._stateMemes[cs.state]?.memes) || []
      if (!out.memeUrl && stIds.length) {
        out.memeUrl = `/api/assets/memes/meme-${stIds[Math.floor(Math.random() * stIds.length)]}.webp`
      }
    }
    if (r.error) out.error = r.error
    return send(res, 200, out)
  }

  // 角色模型库
  if (method === 'GET' && p === '/api/characters.json') {
    const dir = path.join(ASSETS_DIR, 'characters')
    const ids = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'manifest.json')))
    const characters = ids.map((id) => ({ id, ...readCharacterManifest(id) }))
    let memeMap = null
    try { memeMap = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'memes', 'context-map.json'), 'utf8')) } catch {}
    return send(res, 200, { ok: true, characters, memeMap, memeCount: fs.readdirSync(path.join(ASSETS_DIR, 'memes')).filter((f) => f.startsWith('meme-')).length })
  }

  // 金币商店：状态 + 购买
  if (method === 'GET' && p === '/api/shop.json') {
    return send(res, 200, { ok: true, ...shopStatus(ledger), items: shopCatalog() })
  }
  if (method === 'POST' && p === '/api/shop/buy') {
    const body = await readBody(req)
    const r = shopBuy(ledger, String(body.itemId || ''))
    return send(res, r.ok ? 200 : 400, r)
  }

  // 性格目录（展示用；抽取固定由 personality 模块管理）
  if (method === 'GET' && p === '/api/personality.json') {
    const cur = personalitySummary()
    return send(res, 200, { ok: true, current: cur, all: Object.entries(PERSONALITIES).map(([id, v]) => ({ id, name: v.name, emoji: v.emoji, temper: v.temper })) })
  }

  // 素材导入（本机路径）：kind=outfit|accessory，扫描目录里的 png/webp
  if (method === 'POST' && p === '/api/import') {
    const body = await readBody(req)
    return send(res, 200, await importAssets(body))
  }

  // 身体模型参数 + 饰品目录
  if (method === 'GET' && p === '/api/body-model.json') {
    try {
      return send(res, 200, { ok: true, bodyModel: JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'characters', 'deepseek', 'body-model.json'), 'utf8')) })
    } catch (err) { return sendErr(res, err) }
  }

  // 表情包生成（CogView-4）：{preset} 一键 / {prompt} 按要求；生成耗时 10-30s
  if (method === 'POST' && p === '/api/meme/generate') {
    const body = await readBody(req)
    const r = await generateMeme(body, ASSETS_DIR)
    return send(res, r.ok ? 200 : 400, r)
  }
  if (method === 'GET' && p === '/api/meme/presets.json') {
    return send(res, 200, { ok: true, presets: MEME_PRESETS, generated: listGeneratedMemes(ASSETS_DIR) })
  }

  if (method === 'POST' && p === '/api/refresh.json') {
    const body = await readBody(req)
    const model = body.id ? apiModels.find((m) => m.id === body.id) : (apiModels.find((m) => m.builtin) || apiModels[0])
    if (!model) return send(res, 404, { ok: false, error: '模型不存在' })
    return send(res, 200, await getBalance(model, true))
  }

  if (method === 'GET' && p === '/api/last-turn.json') {
    return send(res, 200, { ok: true, seq: turnSeq, ...(lastTurn || { turn: null }) })
  }
  if (method === 'POST' && p === '/api/turn-cost') {
    const body = await readBody(req)
    if (!body || !(Number(body.inputTokens) || Number(body.outputTokens) || Number(body.cacheReadTokens))) {
      return send(res, 400, { ok: false, error: '缺少 usage 字段' })
    }
    return send(res, 200, { ok: true, ...recordTurnCost(body) })
  }

  if (method === 'GET' && p === '/api/state.json') return send(res, 200, { ok: true, state })
  if (method === 'PUT' && p === '/api/state.json') {
    const body = await readBody(req)
    if (body.usageMode && body.usageMode !== state.usageMode) balanceCache.clear()
    // 商店拥有权校验：付费装扮/饰品必须已拥有（免费件放行）
    try {
      if (body.outfit && !isOwned('outfit:' + body.outfit)) return send(res, 403, { ok: false, error: '还没拥有这件装扮，去商店用金币买～' })
      if (Array.isArray(body.accessories)) {
        const notOwned = body.accessories.filter((a) => !isOwned(a))
        if (notOwned.length) return send(res, 403, { ok: false, error: '饰品未解锁: ' + notOwned.join(', ') })
      }
    } catch {}
    state = { ...state, ...(typeof body === 'object' && body ? body : {}) }
    writeJson(FILES.state, state)
    return send(res, 200, { ok: true, state })
  }

  // 记账设置（余额预警 / 预算 / 音效等），与原版用法一致存 ledger.settings
  if (method === 'GET' && p === '/api/settings.json') return send(res, 200, { ok: true, settings: ledger.settings })
  if (method === 'PUT' && p === '/api/settings.json') {
    const body = await readBody(req)
    ledger.settings = { ...ledger.settings, ...(typeof body === 'object' && body ? body : {}) }
    saveLedger()
    return send(res, 200, { ok: true, settings: ledger.settings })
  }

  if (method === 'GET' && p === '/api/records.json') {
    const days = Math.min(Math.max(Number(new URL(url, 'http://x').searchParams.get('days')) || 7, 1), 90)
    return send(res, 200, { ok: true, ...recordsPayload(days) })
  }

  if (method === 'GET' && p === '/api/pricing.json') {
    return send(res, 200, {
      ok: true, isPeak: isPeakNow(), nextPeakChangeAt: nextPeakChange(), peakHours: PEAK_HOURS,
      prices: PRICING, custom: Object.fromEntries(apiModels.filter((m) => m.prices).map((m) => [m.id, m.prices])),
    })
  }

  // 余额校正（只对有余额观测记录的日期；revision 乐观锁）
  if (method === 'POST' && p === '/api/reconcile') {
    const body = await readBody(req)
    try { return send(res, 200, { ok: true, summary: reconcileBalance(ledger, body) }) } catch (err) { return sendErr(res, err) }
  }

  // 多厂商模型注册表
  if (method === 'GET' && p === '/api/models.json') {
    return send(res, 200, { ok: true, models: apiModels, templates: Object.fromEntries(Object.entries(API_TEMPLATES).map(([k, v]) => [k, { ...v }])) })
  }
  if (method === 'PUT' && p === '/api/models.json') {
    const body = await readBody(req)
    if (!Array.isArray(body.models)) return send(res, 400, { ok: false, error: 'models 必须是数组' })
    // 白名单字段，密钥类字段一律不收
    const allow = ['id', 'name', 'provider', 'templateId', 'builtin', 'currency', 'keyRef', 'baseUrl', 'balance', 'quota', 'prices', 'matchIds', 'noBalanceApi', 'settings']
    apiModels = body.models.map((m) => {
      const out = {}
      for (const k of allow) if (m[k] !== undefined) out[k] = m[k]
      out.id = String(out.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || crypto.randomUUID().slice(0, 8)
      return out
    })
    if (!apiModels.some((m) => m.builtin)) apiModels = [...defaultModels(), ...apiModels]
    writeJson(FILES.api, { models: apiModels })
    applyCustomPrices()
    return send(res, 200, { ok: true, models: apiModels })
  }
  if (method === 'POST' && p === '/api/models/test') {
    const body = await readBody(req)
    const model = apiModels.find((m) => m.id === body.id)
    if (!model) return send(res, 404, { ok: false, error: '模型不存在' })
    const key = resolveKey(model.keyRef)
    if (model.balance?.url) {
      const r = await fetchModelBalance(model)
      return send(res, 200, { ok: r.ok, hasKey: !!key, ...r, ...(r.ok ? {} : {}), error: r.error })
    }
    if (model.probeUrl || API_TEMPLATES[model.templateId]?.probeUrl) {
      let probeUrl = model.probeUrl || API_TEMPLATES[model.templateId].probeUrl
      probeUrl = probeUrl.replace('{base}', String(model.baseUrl || '').replace(/\/+$/, '')).replace('{key}', encodeURIComponent(key))
      try {
        await fetchJsonUrl(probeUrl, key && `Bearer ${key}`, 15000)
        return send(res, 200, { ok: true, hasKey: !!key, probe: true, note: '探活通过（该厂商无余额接口）' })
      } catch (err) {
        return send(res, 200, { ok: false, hasKey: !!key, probe: true, error: '探活失败: ' + String(err?.message || err).slice(0, 200) })
      }
    }
    return send(res, 200, { ok: false, hasKey: !!key, error: '没有可用的余额接口或探活地址' })
  }

  if (method === 'GET' && p === '/api/bubble.json') return send(res, 200, { ok: true, bubble: readJson(FILES.bubble, { sequences: [], library: [], advanceOnClick: false }) })
  if (method === 'PUT' && p === '/api/bubble.json') {
    const body = await readBody(req)
    writeJson(FILES.bubble, body && typeof body === 'object' ? body : {})
    return send(res, 200, { ok: true })
  }

  // 纯文本状态行（给 ZCode SessionStart 钩子用）
  if (method === 'GET' && p === '/api/status-line') {
    const cs = await contextState()
    let head = '🐋 '
    if (cs.quota && cs.quota.ok && cs.quota.windows.length) {
      const w5 = cs.quota.windows.find((w) => w.label.includes('h')) || cs.quota.windows[0]
      head += `GLM 剩余 ${100 - w5.usedPct}%（${w5.label}窗口）`
      if (cs.quota.windows.length > 1) {
        const wm = cs.quota.windows[cs.quota.windows.length - 1]
        head += ` · 月剩余 ${100 - wm.usedPct}%`
      }
    }
    if (cs.balance) head += ` · DS ¥${Number(cs.balance.totalBalance).toFixed(2)}`
    return send(res, 200, `${head} · 今日已用 ¥${Number(cs.todayUsage).toFixed(2)} · ${cs.isPeak ? '高峰' : '空闲'}`, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  }

  return send(res, 404, { ok: false, error: 'not found' })
}

// ---------- 定时任务 ----------
setInterval(async () => {
  try {
    const builtin = apiModels.find((m) => m.id === 'deepseek')
    if (builtin && resolveKey(builtin.keyRef)) await getBalance(builtin)
    if (resolveKey('ZHIPU_API_KEY')) await fetchGlmQuota(true)
    pruneLedger()
  } catch (err) { console.error('autoRefresh:', err.message) }
}, AUTO_REFRESH_MS).unref()

// ---------- 启动 ----------
ensureDataDir()
pruneLedger()
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || '127.0.0.1'))
  if (!hostAllowed(req)) return send(res, 403, { ok: false, error: 'host not allowed' })
  if (!originAllowed(req)) return send(res, 403, { ok: false, error: 'origin not allowed' })
  Promise.resolve(route(req, res, url)).catch((err) => {
    console.error('route error:', err)
    try { sendErr(res, err, 500) } catch {}
  })
})
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[zcode-balance-whale] http://127.0.0.1:${PORT}/  数据目录: ${DATA_DIR}`)
  // 启动即拉一次余额（有 key 时）
  const builtin = apiModels.find((m) => m.builtin)
  if (builtin && resolveKey(builtin.keyRef)) getBalance(builtin).catch(() => {})
})
