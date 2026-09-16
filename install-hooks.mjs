#!/usr/bin/env node
// ZCode 钩子安装器：把鲸鱼娘的 Stop/SessionStart 钩子合并进 ~/.zcode/cli/config.json
// 安全策略：先备份原配置；已存在同名钩子则跳过；只增不改不删。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOME = os.homedir()
const CFG = path.join(HOME, '.zcode', 'cli', 'config.json')
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

function whaleHook(script) {
  return { type: 'process', command: 'node', args: [path.join(HERE, 'hooks', script)], timeoutMs: 10000 }
}

function main() {
  if (!fs.existsSync(CFG)) {
    console.error('未找到 ' + CFG + '——请确认 ZCode 已安装并至少运行过一次。')
    process.exit(1)
  }
  const backup = CFG + '.bak-whale-' + Date.now()
  fs.copyFileSync(CFG, backup)
  const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'))
  cfg.hooks ||= {}
  cfg.hooks.enabled = cfg.hooks.enabled !== false
  cfg.hooks.events ||= {}

  let added = 0
  const ensure = (event, script) => {
    const list = cfg.hooks.events[event] ||= [{ hooks: [] }]
    const flat = list.flatMap((e) => e.hooks || [])
    if (flat.some((h) => JSON.stringify(h.args || []).includes('zcode-balance-whale'))) return
    list[0].hooks ||= []
    list[0].hooks.push(whaleHook(script))
    added++
  }
  ensure('Stop', 'stop-hook.mjs')           // 每轮对话消耗上报
  ensure('SessionStart', 'session-status.mjs') // 会话开头余额状态行

  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2))
  console.log(`完成：新增 ${added} 个钩子。原配置备份在 ${backup}`)
  console.log('重启 ZCode 会话后生效：每轮对话结束上报消费，会话开头显示余额状态行。')
}

main()
