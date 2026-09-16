// ZCode SessionStart 钩子：在会话开头打一行余额状态。
// 用法：hooks 里加
//   "SessionStart": [{ "hooks": [{ "type": "command", "command": "node <本文件绝对路径>" }] }]
// 挂件服务没启动时静默，不输出任何东西。
const PORT = process.env.WHALE_PORT || 8787
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/status-line`, { signal: AbortSignal.timeout(3000) })
  const text = await res.text()
  if (text) console.log(text)
} catch {}
process.exit(0)
