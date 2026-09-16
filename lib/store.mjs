// 数据落盘：数据目录解析 + 带重试的 JSON 读写（Windows 索引器短暂占用文件时重试）
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// 数据目录：默认 ~/.zcode-whale；可用 WHALE_HOME 覆盖。
export const DATA_DIR = process.env.WHALE_HOME || path.join(os.homedir(), '.zcode-whale')

export const FILES = {
  state: path.join(DATA_DIR, 'state.json'),        // 挂件外观与开关
  usage: path.join(DATA_DIR, 'usage.json'),        // 记账账本（余额观测 + 逐轮事件）
  turn: path.join(DATA_DIR, 'turn.json'),          // 每轮消耗 seq
  bubble: path.join(DATA_DIR, 'bubble.json'),      // 自定义泡泡配置
  api: path.join(DATA_DIR, 'api.json'),            // 自定义 API 模型注册表（不含密钥）
  keys: path.join(DATA_DIR, 'keys.json'),          // 本机密钥存档（可选；优先读环境变量）
  archive: path.join(DATA_DIR, 'archive.json'),    // 超期账本归档
}

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function retryIo(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return operation() } catch (err) {
      if (attempt >= 5 || !['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1))
    }
  }
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(retryIo(() => fs.readFileSync(file, 'utf8')))
  } catch (err) {
    if (err && (err.code === 'ENOENT')) return fallback
    if (err instanceof SyntaxError) {
      // 坏文件不覆盖：改名留证，返回 fallback
      try { fs.renameSync(file, file + '.bad-' + Date.now()) } catch {}
      return fallback
    }
    return fallback
  }
}

export function writeJson(file, value) {
  ensureDataDir()
  const tmp = file + '.tmp'
  retryIo(() => fs.writeFileSync(tmp, JSON.stringify(value, null, 1), 'utf8'))
  retryIo(() => fs.renameSync(tmp, file))
}

// 密钥解析：环境变量优先，其次 keys.json（键 = keyRef 名称）。绝不把值写进 api.json。
export function resolveKey(keyRef) {
  if (!keyRef) return ''
  if (process.env[keyRef]) return String(process.env[keyRef])
  const keys = readJson(FILES.keys, {})
  const v = keys && keys[keyRef]
  return typeof v === 'string' ? v : ''
}
