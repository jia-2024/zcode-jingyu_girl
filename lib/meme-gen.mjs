// 表情包/形象 AI 生成（CogView-4）+ whalechan 风格 prompt 编译
// 一键预设：语境→预设动作模板；按要求生成：用户输入自由描述，服务端拼身份块保证人设一致。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveKey } from './store.mjs'

const GEN_DIR = path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), 'assets', 'memes', 'generated')

// whalechan skill 的「风格块」「比例块」内置化：生成时按用户选择的画风/比例拼装
const STYLE_BLOCKS = {
  canonical: '官方设定卡画风：粗近黑藏青描边、柔和赛璐璐上色、冷暖对比克制、奶白纯色背景、官方设定卡构图。',
  aihand: 'AI 手绘风：更厚重的手绘笔触、高饱和蓝青渐变发色、圆润高光、干净浅色背景。',
  sticker: '表情包贴纸风：粗白描边+彩色内线、极度夸张的表情与肢体、方正贴纸构图、背景纯白。',
}
const PROPORTION_BLOCKS = {
  'standard': '4.0头身修长比例，四肢自然修长。', 'tall': '4.2头身高挑比例，身材修长优雅。',
  'compact': '3.3头身紧凑比例，四肢适度缩短。', 'semi-chibi': '2.8头身半Q比例，头略大躯干圆润。',
  'chibi': '2.5头身Q版比例，头大身小手足圆润。', 'super-deformed': '2.1头身超Q比例，头极大四肢极短。',
}

// whalechan-image-character 的身份块（永久锁定特征）
const IDENTITY_BLOCK =
  'DeepSeek 鲸鱼娘(Whale-chan)：固定角色——圆润大脸、蓝色大眼睛、深洋蓝渐变青色卷发、' +
  '一对鲸鱼鳍耳、一根前弯呆毛、自然连接的鲸鱼尾巴、藏青白女仆装（白围裙上有小蓝鲸徽章）。' +
  '2.5头身Q版，粗近黑藏青描边，柔和赛璐璐上色，奶白色纯背景，干净的贴纸构图，无文字。'

// 一键预设（语境快捷生成）
export const MEME_PRESETS = [
  { id: 'eating', name: '🍜 干饭', prompt: '抱着一大碗白米饭狼吞虎咽，眼睛发光，米粒飞溅，元气满满' },
  { id: 'full', name: '😋 吃饱拍肚', prompt: '吃撑了躺在地上开心拍肚皮，腮红微醺，满足表情' },
  { id: 'angry', name: '😤 生气', prompt: '气鼓鼓叉腰瞪眼，头顶冒蒸汽，嘴巴撅成波浪线' },
  { id: 'cry', name: '😭 委屈', prompt: '眼泪汪汪委屈巴巴，鲸鱼尾巴耷拉，头顶乌云小雨' },
  { id: 'rich', name: '🤑 讨债', prompt: '两眼放光数钱，抱着印有鲸鱼的钞票堆，财迷表情' },
  { id: 'sleep', name: '💤 睡觉', prompt: '抱着鲸鱼抱枕熟睡，头顶冒出Zzz气泡，尾巴卷成圈' },
  { id: 'work', name: '💻 工作', prompt: '坐在电脑前飞快敲键盘，屏幕蓝光映脸，认真专注' },
  { id: 'party', name: '🎉 庆祝', prompt: '撒花跳跃欢呼，彩带环绕，星星眼大笑' },
  { id: 'glm', name: '🆚 GLM对决', prompt: '摆出对战姿势，手心发光的能量球，旁边一只傲娇的黑色猫娘对手剪影' },
]

async function genPollinations(prompt, size) {
  // Pollinations：免费无 key。主机白名单校验。
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${size.split('x')[0]}&height=${size.split('x')[1]}&nologo=true&model=flux&safe=true`
  const u = new URL(url)
  if (u.protocol !== 'https:' || u.hostname !== 'image.pollinations.ai') throw new Error('拒绝非白名单主机')
  const imgRes = await fetch(u, { signal: AbortSignal.timeout(120000) })
  if (!imgRes.ok) throw new Error('Pollinations HTTP ' + imgRes.status)
  return Buffer.from(await imgRes.arrayBuffer())
}

async function genBigmodel(prompt, size, key) {
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.WHALE_IMAGE_MODEL || 'cogview-3-flash', prompt, size }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) throw new Error('CogView HTTP ' + res.status + ': ' + String(await res.text()).slice(0, 120))
  const data = await res.json()
  const url = data?.data?.[0]?.url
  if (!url) throw new Error('CogView 未返回图片')
  const imgRes = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!imgRes.ok) throw new Error('图片下载失败 HTTP ' + imgRes.status)
  return Buffer.from(await imgRes.arrayBuffer())
}

export async function generateMeme(request, assetsDir) {
  const provider = request.provider || 'pollinations'   // 默认免费路线
  let userPart = String(request.prompt || '').trim()
  const preset = MEME_PRESETS.find((p) => p.id === request.preset)
  if (!userPart && preset) userPart = preset.prompt
  if (!userPart) return { ok: false, error: '缺少 prompt 或 preset' }
  userPart = userPart.slice(0, 200)
  // whalechan 式拼装：身份块 + 画风块 + 比例块 + 动作块
  const styleBlock = STYLE_BLOCKS[request.style] || STYLE_BLOCKS.canonical
  const propBlock = PROPORTION_BLOCKS[request.proportion] || PROPORTION_BLOCKS['semi-chibi']
  const prompt = `${IDENTITY_BLOCK}${styleBlock}${propBlock}动作与表情：${userPart}。`

  try {
    let buf
    if (provider === 'bigmodel') {
      const key = resolveKey('GLM_IMAGE_KEY') || resolveKey('ZHIPU_API_KEY')
      if (!key) return { ok: false, error: 'bigmodel 路线需要 keys.json 里配置 ZHIPU_API_KEY' }
      buf = await genBigmodel(prompt, '1024x1024', key)
    } else {
      buf = await genPollinations(prompt, '768x768')
    }
    const dir = path.join(assetsDir, 'memes', 'generated')
    fs.mkdirSync(dir, { recursive: true })
    const file = `gen-${Date.now()}.jpg`
    fs.writeFileSync(path.join(dir, file), buf)
    return { ok: true, file, url: '/api/assets/memes/generated/' + file, prompt, provider }
  } catch (err) {
    return { ok: false, error: '生成失败: ' + String(err?.message || err).slice(0, 160) }
  }
}

export function listGeneratedMemes(assetsDir) {
  try {
    const dir = path.join(assetsDir, 'memes', 'generated')
    return fs.readdirSync(dir).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort().reverse()
      .map((f) => ({ file: f, url: '/api/assets/memes/generated/' + f }))
  } catch { return [] }
}
