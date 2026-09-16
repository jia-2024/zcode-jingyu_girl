// 鲸鱼娘性格系统：首次启动随机抽取并永久固定，影响行为权重与台词风格。
import { FILES, readJson, writeJson } from './store.mjs'
import { secretsLikePick } from './personality-rand.mjs'

export const PERSONALITIES = {
  lively: {
    name: '活泼', emoji: '🌟',
    temper: '闲不住，喜欢在屏幕底边到处溜达，时不时跳起来打招呼',
    behavior: { walkChance: 0.62, walkDur: [3, 7], idleDur: [2, 5], bubbleChance: 0.5, bubbleMinGapSec: 120 },
    lines: {
      greet: ['我来啦～今天也元气满满！', '嘿嘿，有没有想我呀？', '开工开工！鲸鱼娘就位！'],
      comfort: ['别急别急，一步步来嘛～', '你已经很努力啦，奖励自己一碗白米饭吧！', '休息一下下，我帮你盯着额度～'],
      ambient: ['溜达溜达～', '这里看看，那里瞧瞧', '坐不住啦，走两步！'],
    },
  },
  quiet: {
    name: '安静', emoji: '🌙',
    temper: '喜欢静静陪着你工作，很少走动，在你需要时轻声说话',
    behavior: { walkChance: 0.15, walkDur: [1, 2], idleDur: [6, 14], bubbleChance: 0.25, bubbleMinGapSec: 300 },
    lines: {
      greet: ['嗯，我在。', '今天也一起加油。', '（安静地飘过来陪你）'],
      comfort: ['辛苦了。喝口水，休息一下吧。', '没关系，慢慢来，我都在。', '代码不会辜负认真的人。'],
      ambient: ['（静静地看着你工作）', '（尾巴轻轻晃了晃）', '（小声）嗯……'],
    },
  },
  tsundere: {
    name: '傲娇', emoji: '🎀',
    temper: '嘴上嫌弃手上诚实，被夸会脸红，被催会炸毛',
    behavior: { walkChance: 0.35, walkDur: [1.5, 4], idleDur: [4, 9], bubbleChance: 0.4, bubbleMinGapSec: 180 },
    lines: {
      greet: ['哼，才不是特意来陪你的！', '既然你这么需要我，那我就勉为其难……', '别盯着看啦，很奇怪诶！'],
      comfort: ['笨、笨蛋！谁让你熬夜的！早点睡啦！', '做得还行吧……也就比昨天好一点点。', '才不是担心你，只是额度快没了替你心疼！'],
      ambient: ['（假装没在看你）', '哼，无聊。', '（尾巴不耐烦地拍了拍地面）'],
    },
  },
  foody: {
    name: '吃货', emoji: '🍚',
    temper: '白米饭是算力唯一硬通货，所有话题都能绕到吃',
    behavior: { walkChance: 0.4, walkDur: [2, 4], idleDur: [3, 8], bubbleChance: 0.45, bubbleMinGapSec: 150 },
    lines: {
      greet: ['吃饭了吗？没吃先去吃！', '我闻到白米饭的味道了！', '今天也要吃饱饱再干活！'],
      comfort: ['没有一顿白米饭解决不了的事，如果有就两顿！', '累了就吃点好的，这是命令！', '额度花完了不怕，饭要吃饱！'],
      ambient: ['（嚼嚼嚼）', '冰箱里还有吃的吗……', '（盯着你的外卖看）'],
    },
  },
}

const TRAITS_KEY = 'personality'

export function loadPersonality() {
  const st = readJson(FILES.state, {}) || {}
  let id = st?.[TRAITS_KEY]?.id
  if (!id || !PERSONALITIES[id]) {
    // 首次启动：安全随机抽取并永久固定
    const ids = Object.keys(PERSONALITIES)
    id = secretsLikePick(ids)
    st[TRAITS_KEY] = { id, fixedAt: Date.now() }
    try { writeJson(FILES.state, { ...st }) } catch {}
  }
  const p = PERSONALITIES[id]
  return { id, ...p }
}

export function personalitySummary() {
  const p = loadPersonality()
  return { id: p.id, name: p.name, emoji: p.emoji, temper: p.temper, behavior: p.behavior, lines: p.lines }
}

// 按语境挑一句性格台词：kind ∈ greet/comfort/ambient
export function personalityLine(kind, context = {}) {
  const p = loadPersonality()
  const pool = p.lines[kind] || p.lines.ambient
  return secretsLikePick(pool)
}
