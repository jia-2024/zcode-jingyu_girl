// 四轴妆造目录：styles.json 读取 + 画风/比例/状态解析（同比例内兜底，绝不出比例）
import fs from 'node:fs'
import path from 'node:path'
import { ASSETS_DIR } from './assets-paths.mjs'

let _cache = null

export function readStylesCatalog() {
  if (_cache) return _cache
  const p = path.join(ASSETS_DIR, 'styles.json')
  _cache = JSON.parse(fs.readFileSync(p, 'utf8'))
  return _cache
}

export function invalidateStylesCache() { _cache = null }

// 旧字段迁移：outfit/form → style/proportion（一次性写回 state）
export function styleCompat(state) {
  if (state.style) return
  const o = state.outfit || 'maid'
  state.style = o === 'classic' ? 'classicwhale' : o === 'sticker' ? 'sticker' : 'maid'
  state.proportion = state.form || 'semi-chibi'
}

export function resolveArt(styleId, proportionId, stateName, fallbackMap) {
  const catalog = readStylesCatalog()
  const style = catalog.styles.find((x) => x.id === styleId) || catalog.styles[0]
  const props = style.proportions
  let prop = props.find((x) => x.id === proportionId) || props.find((x) => x.states && Object.keys(x.states).length) || props[0]

  const states = prop.states || {}
  const isSticker = style.id === 'sticker' || states[stateName] === '__sticker__'
  let key = stateName
  // 同比例内兜底：state → fallback 链 → idle → 首个可用
  for (let hop = 0; hop < 4 && !(states[key] && states[key] !== '__sticker__'); hop++) {
    key = (fallbackMap && fallbackMap[key]) || 'idle'
  }
  if (!(states[key] && states[key] !== '__sticker__')) {
    const first = Object.keys(states).find((k) => states[k] && states[k] !== '__sticker__')
    key = first || stateName
  }
  const rel = states[key]
  const imageUrl = (rel && rel !== '__sticker__') ? '/api/assets/characters/deepseek/' + rel : null
  return { style, proportion: prop, stateKey: key, imageUrl, isSticker }
}
