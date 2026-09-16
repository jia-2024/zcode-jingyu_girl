// ZCode Stop 钩子：每轮对话结束时把本轮真实 usage 上报给余额挂件计价。
// ZCode 的模型 IO 日志在 ~/.zcode/cli/rollout/model-io-sess_<sessionId>.jsonl：
// 每行 type=model_io 的一次完整请求，带 turnId 与 response.usage（inputTokens/outputTokens/
// cacheReadTokens/cacheWriteTokens，真实计数）。按最后一个 turnId 聚合 = 本轮消耗。
// config.json 钩子写法（type: "process"）：
//   "Stop": [{ "hooks": [ {既有钩子...}, {
//     "type": "process", "command": "H:\\node\\node.exe",
//     "args": ["<本文件绝对路径>"], "timeoutMs": 10000 } ] }]
// 铁律：Stop 钩子有任何输出都会触发续写（见 workflow-memory/journal.mjs 注释），全程静默。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PORT = process.env.WHALE_PORT || 8787
const DEBUG = process.env.WHALE_HOOK_DEBUG === '1'

function readStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8')
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function debugLog(line) {
  if (!DEBUG) return
  try { fs.appendFileSync(path.join(os.homedir(), '.zcode-whale', 'hook-debug.log'), new Date().toISOString() + ' ' + line + '\n') } catch {}
}

// 兼容两种输入：ZCode 原生 model-io 格式，或 Claude Code 转写格式（transcript_path）
function parseModelIo(file) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n').filter((l) => l.trim())
  if (!lines.length) return null
  let lastTurnId = null
  const turns = new Map() // turnId → {usage, model, reqs}
  for (const line of lines) {
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.type !== 'model_io') return null // 不是 model-io 格式就交给另一套解析
    const u = e.response?.usage
    if (!u) continue
    const tid = String(e.turnId || e.requestId)
    lastTurnId = tid
    const t = turns.get(tid) || { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0, model: '' }
    // ZCode 口径（实测 totalTokens=in+out）：inputTokens **已包含** cacheRead/cacheWrite，
    // 未命中输入要减掉，否则缓存命中部分按未命中价重复计费
    const totalIn = Number(u.inputTokens) || 0
    const cached = (Number(u.cacheReadTokens) || 0) + (Number(u.cacheWriteTokens) || 0)
    t.inputTokens += Math.max(0, totalIn - cached)
    t.cacheReadTokens += Number(u.cacheReadTokens) || 0
    t.outputTokens += Number(u.outputTokens) || 0
    t.model = e.model?.modelId || e.request?.body?.model || t.model
    turns.set(tid, t)
  }
  return turns.get(lastTurnId) ? { ...turns.get(lastTurnId), turnId: lastTurnId } : null
}

function parseClaudeTranscript(file) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n').filter((l) => l.trim())
  let model = ''
  let acc = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0 }
  let pending = null
  let any = false
  for (const line of lines) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    const isUser = entry?.type === 'user'
    const content = entry?.message?.content
    const realUser = isUser && (typeof content === 'string' || (Array.isArray(content) && content.some((c) => c?.type === 'text')))
    if (realUser) {
      if (any) pending = { ...acc }
      acc = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0 }
      any = false
      continue
    }
    if (entry?.type === 'assistant') {
      const u = entry.message?.usage
      if (u) {
        acc.inputTokens += (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0)
        acc.cacheReadTokens += Number(u.cache_read_input_tokens) || 0
        acc.outputTokens += Number(u.output_tokens) || 0
        acc.reasoningTokens += Number(u.reasoning_tokens) || 0
        if (entry.message?.model) model = String(entry.message.model)
        any = true
      }
    }
  }
  const turn = any ? acc : (pending || acc)
  return turn && (turn.inputTokens || turn.outputTokens || turn.cacheReadTokens) ? { ...turn, model } : null
}

async function main() {
  try {
    const input = readStdin()
    debugLog('input keys: ' + JSON.stringify(Object.keys(input || {})) + ' transcript_path=' + (input.transcript_path || '(none)') + ' session_id=' + (input.session_id || '(none)'))
    if (input.stop_hook_active) return

    let file = input.transcript_path
    let turn = null
    if (file && fs.existsSync(file)) {
      turn = parseModelIo(file) || parseClaudeTranscript(file)
    }
    if (!turn && input.session_id) {
      // ZCode 原生路径：rollout/model-io-sess_<sessionId>.jsonl
      const guess = path.join(os.homedir(), '.zcode', 'cli', 'rollout', `model-io-sess_${input.session_id}.jsonl`)
      if (fs.existsSync(guess)) turn = parseModelIo(guess)
    }
    if (!turn) return
    if (!turn.inputTokens && !turn.outputTokens && !turn.cacheReadTokens) return

    await fetch(`http://127.0.0.1:${PORT}/api/turn-cost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turn),
      signal: AbortSignal.timeout(5000),
    })
  } catch (err) {
    debugLog('error: ' + (err && err.stack || err))
  }
}

await main()
process.exit(0)
