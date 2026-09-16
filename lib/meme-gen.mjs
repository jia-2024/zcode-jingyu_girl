// 表情包/形象 AI 生成（CogView-4）+ whalechan 风格 prompt 编译
// 一键预设：语境→预设动作模板；按要求生成：用户输入自由描述，服务端拼身份块保证人设一致。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveKey } from './store.mjs'

const GEN_DIR = path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), 'assets', 'memes', 'generated')

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

export async function generateMeme(request, assetsDir) {
  const key = resolveKey('GLM_IMAGE_KEY') || resolveKey('ZHIPU_API_KEY')
  if (!key) return { ok: false, error: '未配置生图密钥（keys.json 的 ZHIPU_API_KEY 即可）' }
  let userPart = String(request.prompt || '').trim()
  const preset = MEME_PRESETS.find((p) => p.id === request.preset)
  if (!userPart && preset) userPart = preset.prompt
  if (!userPart) return { ok: false, error: '缺少 prompt 或 preset' }
  userPart = userPart.slice(0, 200)
  const prompt = `${IDENTITY_BLOCK}动作与表情：${userPart}。`

  try {
    const res = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'cogview-4-250304', prompt, size: '1024x1024' }),
      signal: AbortSignal.timeout(120000),
    })
    if (!res.ok) return { ok: false, error: 'CogView HTTP ' + res.status + ': ' + String(await res.text()).slice(0, 160) }
    const data = await res.json()
    const url = data?.data?.[0]?.url
    if (!url) return { ok: false, error: 'CogView 未返回图片' }
    const imgRes = await fetch(url, { signal: AbortSignal.timeout(60000) })
    if (!imgRes.ok) return { ok: false, error: '图片下载失败 HTTP ' + imgRes.status }
    const buf = Buffer.from(await imgRes.arrayBuffer())
    const dir = path.join(assetsDir, 'memes', 'generated')
    fs.mkdirSync(dir, { recursive: true })
    const file = `gen-${Date.now()}.png`
    fs.writeFileSync(path.join(dir, file), buf)
    return { ok: true, file, url: '/api/assets/memes/generated/' + file, prompt }
  } catch (err) {
    return { ok: false, error: '生成失败: ' + String(err?.message || err).slice(0, 160) }
  }
}

export function listGeneratedMemes(assetsDir) {
  try {
    const dir = path.join(assetsDir, 'memes', 'generated')
    return fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().reverse()
      .map((f) => ({ file: f, url: '/api/assets/memes/generated/' + f }))
  } catch { return [] }
}
