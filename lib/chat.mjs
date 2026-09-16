// 鲸鱼娘聊天：GLM-4-Flash（智谱免费档）+ 3 轮上下文 + 性格/语境 system。
// AI 可回复文字，或输出「[表情包:关键词]」→ 服务端映射到表情包库返回图片。
// key 从本机 keys.json 读（ZHIPU_API_KEY / GLM_IMAGE_KEY），代码零内置密钥。
import { resolveKey } from './store.mjs'
import { personalitySummary } from './personality.mjs'
import { secretsLikePick } from './personality-rand.mjs'

const CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const CHAT_MODEL = process.env.WHALE_CHAT_MODEL || 'GLM-4-Flash-250414' // 智谱免费档
const MEMORY_TURNS = 3
let memory = [] // [{role, content}]
let memTimer = null

const MEME_STATE_KEYWORDS = [
  ['吃', '饭', '干饭', '饿', 'food', 'eating'], ['生气', '愤怒', '气', 'angry'], ['哭', '委屈', '难过', 'sad'],
  ['睡', '困', '累', 'sleep'], ['钱', '余额', '讨债', '金币', 'alert'], ['错', 'bug', '报错', 'error'],
  ['夸', '厉害', '棒', 'proud'], ['高兴', '开心', '哈哈', 'happy'], ['看不懂', '懵', 'confused'],
]
function memeStateFor(text) {
  const t = String(text || '')
  for (const keys of MEME_STATE_KEYWORDS) {
    if (keys.some((k) => t.includes(k[0]) || t.includes(k))) return keys[keys.length - 1]
  }
  return null
}

function buildSystem(context) {
  const p = personalitySummary()
  const stateText = {
    idle: '现在待机中', happy: '现在很开心', eating: '现在在吃白米饭', working: '现在在工作',
    thinking: '现在在思考', sleeping: '现在在打瞌睡', sad: '现在有点难过', error: '刚遇到了报错',
    alert: '现在额度/余额告急，正在讨债', proud: '现在很得意', confused: '现在有点懵', angry: '现在在生气',
    beg: '现在额度见底了，跪坐捧碗乞讨额度', guilty: '今天花超预算了，正愧疚地跪着认错',
  }[context.state] || '现在待机中'
  // 日期时间感知（模型不知道今天几号，必须显式注入北京时间）
  const nowBj = new Date(Date.now() + 8 * 3600000)
  const week = ['日', '一', '二', '三', '四', '五', '六'][nowBj.getUTCDay()]
  const dateText = `${nowBj.getUTCFullYear()}-${String(nowBj.getUTCMonth() + 1).padStart(2, '0')}-${String(nowBj.getUTCDate()).padStart(2, '0')} 星期${week} ${String(nowBj.getUTCHours()).padStart(2, '0')}:${String(nowBj.getUTCMinutes()).padStart(2, '0')}`
  return [
    '你是「鲸鱼娘(Whale-chan)」——DeepSeek 的蓝色鲸鱼娘桌宠：深洋蓝渐变青卷发、鲸鳍耳、呆毛、鲸鱼尾、藏青白女仆装，超级大胃王（白米饭是算力硬通货）。',
    `当前性格：${p.name}——${p.temper}。台词风格要贴合性格。`,
    `当前日期时间：${dateText}（北京时间）。主人问日期/星期/时间时必须按这个回答，不要编造。`,
    `当前状态：${stateText}。`,
    context.quotaText ? `主人当前额度：${context.quotaText}。` : '',
    context.weatherText ? `主人所在地的天气：${context.weatherText}。` : '',
    '聊天规则：口语化、不超过 30 字、像桌宠一样陪伴主人；可以适当傲娇或卖萌但不要每句都傲娇。',
    '如果想配一张表情包，在回复末尾另起一行输出「[表情包:状态]」，状态从这些词里选一个：eating/angry/sad/sleep/alert/error/proud/happy/confused/idle。大多数回复不要带表情包。',
  ].filter(Boolean).join('\n')
}

export async function chat(context, userText) {
  const key = resolveKey('GLM_CHAT_KEY') || resolveKey('ZHIPU_API_KEY')
  if (!key) {
    return { ok: false, error: '未配置聊天密钥（keys.json 的 ZHIPU_API_KEY）', fallback: secretsLikePick(['嗯嗯？', '（歪头看你）']) }
  }
  const text = String(userText || '').slice(0, 300)
  if (!text) return { ok: false, error: '说点什么呀' }

  memory.push({ role: 'user', content: text })
  while (memory.length > MEMORY_TURNS * 2) memory.shift()

  try {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: 'system', content: buildSystem(context) },
          ...memory,
        ],
        max_tokens: 200,
        temperature: 0.9,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      memory.pop()
      return { ok: false, error: 'GLM HTTP ' + res.status, fallback: '（线路有点吵，没听清……）' }
    }
    const data = await res.json()
    let reply = String(data?.choices?.[0]?.message?.content || '').trim() || '（点头）'
    let memeUrl = null
    // AI 的标记格式不稳定：兼容 [表情包:x] / 【x】 / [x] / 【状态】x / 表情包:x
    const ALIAS = {
      sleep: 'sleeping', sleeping: 'sleeping', food: 'eating', eat: 'eating', rice: 'eating',
      money: 'alert', coin: 'alert', cry: 'sad', upset: 'sad', work: 'working', bug: 'error',
      love: 'happy', smile: 'happy', joy: 'happy', wow: 'confused', tsundere: 'proud',
    }
    const patterns = [
      /(?:\[表情包[:：]\s*|\[|【)\s*([a-zA-Z-]+)\s*(?:\]|\】)\]?/i,
      /(?:\[?表情包\]?|【状态】)\s*[:：]?\s*([a-zA-Z-]+)/i,
    ]
    let st = null
    for (const re of patterns) {
      const m = reply.match(re)
      if (m) { st = m[1]; reply = reply.replace(m[0], ' ').trim(); break }
    }
    if (st) {
      st = ALIAS[st.toLowerCase()] || st.toLowerCase()
      const ids = (context._stateMemes && context._stateMemes[st]?.memes) || []
      if (ids.length) {
        memeUrl = '/api/assets/memes/meme-' + secretsLikePick(ids) + '.webp'
      }
      if (!reply) reply = '给你！(递上表情包)'
    }
    memory.push({ role: 'assistant', content: reply })
    clearTimeout(memTimer)
    memTimer = setTimeout(() => { memory = [] }, 10 * 60000) // 10 分钟无对话清空上下文
    return { ok: true, reply, memeUrl }
  } catch (err) {
    memory.pop()
    return { ok: false, error: String(err?.message || err).slice(0, 120), fallback: '（走神了，再说一遍？）' }
  }
}
