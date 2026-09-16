// 天气：Open-Meteo（免费无 key）+ WMO 天气码中文映射；30 分钟缓存。
// 仅允许 https + api.open-meteo.com / geocoding-api.open-meteo.com 两个主机。
import { webcrypto } from 'node:crypto'

const ALLOWED = new Set(['api.open-meteo.com', 'geocoding-api.open-meteo.com'])
let cache = { at: 0, value: null }

function jpick(arr) { return arr[webcrypto.getRandomValues(new Uint32Array(1))[0] % arr.length] }

const WMO = {
  0: '晴', 1: '多云转晴', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
  51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨', 56: '冻雨', 57: '冻雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '阵雨', 82: '暴雨', 85: '阵雪', 86: '阵雪', 95: '雷阵雨',
  96: '雷阵雨伴冰雹', 99: '雷阵雨伴冰雹',
}
export function wmoText(code) { return WMO[Number(code)] || '未知天气' }

function reminderFor(code, tmax) {
  const c = Number(code)
  if ([51,53,55,61,63,65,66,67,80,81,82,95,96,99].includes(c)) return '今天有雨，记得带伞！'
  if ([71,73,75,77,85,86].includes(c)) return '今天下雪，路滑穿暖！'
  if (tmax >= 33) return '高温预警！多喝水别中暑～'
  if (tmax <= 5) return '好冷！多穿一件，别冻成咸鱼'
  if ([45, 48].includes(c)) return '有雾，出门注意安全'
  return null
}

async function fetchJson(url) {
  const u = new URL(url)
  if (u.protocol !== 'https:' || !ALLOWED.has(u.hostname)) throw new Error('非白名单主机: ' + u.hostname)
  const res = await fetch(u, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

export async function getWeather(city) {
  if (cache.value && Date.now() - cache.at < 30 * 60000 && cache.city === city) return cache.value
  try {
    const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`)
    const g = geo?.results?.[0]
    if (!g) { cache = { at: Date.now(), city, value: { ok: false, error: '找不到城市: ' + city } }; return cache.value }
    const w = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto`)
    const cur = w.current_weather || {}
    const tmax = w.daily?.temperature_2m_max?.[0]
    const code = cur.weathercode ?? w.daily?.weathercode?.[0] ?? -1
    const value = {
      ok: true, city: g.name, text: wmoText(code), temp: Math.round(cur.temperature), windspeed: Math.round(cur.windspeed || 0),
      tmax: tmax != null ? Math.round(tmax) : null, tmin: w.daily?.temperature_2m_min?.[0] != null ? Math.round(w.daily.temperature_2m_min[0]) : null,
      reminder: reminderFor(code, tmax != null ? Math.round(tmax) : 20),
    }
    cache = { at: Date.now(), city, value }
    return value
  } catch (err) {
    return { ok: false, error: '天气获取失败: ' + String(err?.message || err).slice(0, 100) }
  }
}
