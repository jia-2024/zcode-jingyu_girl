// 多厂商余额/额度模板（移植自 dsh-whale-widget，MIT）
// balance 描述「怎么取余额」：url 支持 {base} 占位；auth 支持 'Bearer {key}' 或裸 '{key}'；
// json 字段路径支持 a.b[0].c，scale 为取值后的乘数。
// noBalanceApi=true 表示官方没有「用 API key 查余额」的接口：余额显示「—」，今日已用按会话事件估算，
// probeUrl 用于「测试连通性」验证 key。
// kind='quota' 是订阅额度接口（窗口用量% + 重置时间），不是钱。
export const API_TEMPLATES = {
  deepseek: {
    name: 'DeepSeek', currency: 'CNY', keyRef: 'DEEPSEEK_API_KEY', builtin: true,
    balance: { url: 'https://api.deepseek.com/user/balance', auth: 'Bearer {key}', json: { remaining: 'balance_infos[0].total_balance' } },
  },
  openrouter: {
    name: 'OpenRouter', currency: 'USD', keyRef: 'OPENROUTER_API_KEY',
    balance: { url: 'https://openrouter.ai/api/v1/credits', auth: 'Bearer {key}', json: { total: 'data.total_credits', used: 'data.total_usage' } },
  },
  siliconflow_cn: {
    name: '硅基流动（CN）', currency: 'CNY', keyRef: 'SILICONFLOW_API_KEY', noBalanceApi: true,
    apiNote: '官方已下线 /user/info 余额接口（2026-08-14 起停止服务）→ 余额显示「—」，今日已用按会话事件估算；「测试连通性」用 /v1/models 验证 key',
    matchIds: ['siliconflow', 'Qwen', 'deepseek-ai'],
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
    probeUrl: 'https://api.siliconflow.cn/v1/models',
  },
  siliconflow_en: {
    name: '硅基流动（EN）', currency: 'USD', keyRef: 'SILICONFLOW_API_KEY', noBalanceApi: true,
    apiNote: '同国内站：/user/info 余额接口已停止服务 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['siliconflow', 'Qwen', 'deepseek-ai'],
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
    probeUrl: 'https://api.siliconflow.com/v1/models',
  },
  moonshot: {
    name: 'Kimi / Moonshot（CN）', currency: 'CNY', keyRef: 'MOONSHOT_API_KEY', matchIds: ['moonshot', 'kimi'],
    balance: { url: 'https://api.moonshot.cn/v1/users/me/balance', auth: 'Bearer {key}', json: { remaining: 'data.available_balance' } },
    probeUrl: 'https://api.moonshot.cn/v1/models',
  },
  moonshot_intl: {
    name: 'Kimi / Moonshot（国际）', currency: 'USD', keyRef: 'MOONSHOT_INTL_API_KEY',
    balance: { url: 'https://api.moonshot.ai/v1/users/me/balance', auth: 'Bearer {key}', json: { remaining: 'data.available_balance' } },
    probeUrl: 'https://api.moonshot.ai/v1/models',
  },
  stepfun: {
    name: '阶跃星辰 StepFun', currency: 'CNY', keyRef: 'STEPFUN_API_KEY', matchIds: ['stepfun', 'step-'],
    balance: { url: 'https://api.stepfun.com/v1/accounts', auth: 'Bearer {key}', json: { remaining: 'balance' } },
  },
  novita: {
    name: 'Novita AI', currency: 'USD', keyRef: 'NOVITA_API_KEY', matchIds: ['novita'],
    balance: { url: 'https://api.novita.ai/v3/user/balance', auth: 'Bearer {key}', json: { remaining: 'availableBalance', scale: 0.0001 } },
  },
  volcengine_ark: {
    name: '火山方舟 Ark', currency: 'CNY', keyRef: 'ARK_API_KEY', noBalanceApi: true,
    apiNote: '余额/用量需火山引擎 AK/SK 签名的 OpenAPI → 余额「—」，今日已用按会话事件估算；探活用 /api/v3/models',
    matchIds: ['doubao', 'ep-'],
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
    probeUrl: 'https://ark.cn-beijing.volces.com/api/v3/models',
  },
  zhipu_glm_coding: {
    name: '智谱 GLM Coding Plan（订阅）', currency: 'CNY', keyRef: 'ZHIPU_API_KEY', kind: 'quota',
    quota: {
      url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
      auth: '{key}', // 智谱此接口不带 Bearer
      json: { percent: 'data.limits[0].TOKENS_LIMIT.percentage', resetAt: 'data.limits[0].nextResetTime', level: 'data.level' },
    },
    probeUrl: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
  },
  zhipu_glm_coding_intl: {
    name: '智谱 GLM Coding Plan（国际 z.ai）', currency: 'USD', keyRef: 'ZHIPU_INTL_API_KEY', kind: 'quota',
    quota: {
      url: 'https://api.z.ai/api/monitor/usage/quota/limit',
      auth: '{key}',
      json: { percent: 'data.limits[0].TOKENS_LIMIT.percentage', resetAt: 'data.limits[0].nextResetTime', level: 'data.level' },
    },
    probeUrl: 'https://api.z.ai/api/monitor/usage/quota/limit',
  },
  kimi_coding: {
    name: 'Kimi Coding（订阅）', currency: 'CNY', keyRef: 'KIMI_CODING_KEY', kind: 'quota',
    quota: {
      url: 'https://api.kimi.com/coding/v1/usages',
      auth: 'Bearer {key}',
      json: { remain: 'usage.remaining', total: 'usage.limit', resetAt: 'usage.resetTime' },
    },
    probeUrl: 'https://api.kimi.com/coding/v1/usages',
  },
  minimax_coding: {
    name: 'MiniMax Coding（订阅）', currency: 'CNY', keyRef: 'MINIMAX_API_KEY', kind: 'quota',
    quota: {
      url: 'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains',
      auth: 'Bearer {key}',
      json: {
        remainPct: 'model_remains[0].current_interval_remaining_percent',
        weeklyRemainPct: 'model_remains[0].current_weekly_remaining_percent',
        resetAtMs: 'model_remains[0].end_time',
      },
    },
    probeUrl: 'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains',
  },
  minimax_coding_intl: {
    name: 'MiniMax Coding（国际）', currency: 'USD', keyRef: 'MINIMAX_INTL_API_KEY', kind: 'quota',
    quota: {
      url: 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains',
      auth: 'Bearer {key}',
      json: {
        remainPct: 'model_remains[0].current_interval_remaining_percent',
        weeklyRemainPct: 'model_remains[0].current_weekly_remaining_percent',
        resetAtMs: 'model_remains[0].end_time',
      },
    },
    probeUrl: 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains',
  },
  openai_compat: {
    name: 'OpenAI 兼容中转站', currency: 'USD', keyRef: 'CUSTOM_API_KEY', needsBaseUrl: true,
    balance: {
      url: '{base}/v1/dashboard/billing/subscription', auth: 'Bearer {key}', json: { total: 'hard_limit_usd' },
      usage: { url: '{base}/v1/dashboard/billing/usage', auth: 'Bearer {key}', json: { used: 'total_usage', scale: 0.01 } },
    },
  },
  custom: {
    name: '自定义 HTTP', currency: 'CNY', keyRef: 'CUSTOM_API_KEY',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  openai: {
    name: 'OpenAI', currency: 'USD', keyRef: 'OPENAI_API_KEY', noBalanceApi: true,
    apiNote: '官方已下线 billing 余额接口 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['gpt', 'o1-', 'o3-', 'o4-', 'chatgpt'],
    probeUrl: 'https://api.openai.com/v1/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  anthropic: {
    name: 'Anthropic Claude', currency: 'USD', keyRef: 'ANTHROPIC_API_KEY', noBalanceApi: true,
    apiNote: '官方无余额接口 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['claude'],
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  gemini: {
    name: 'Google Gemini', currency: 'USD', keyRef: 'GEMINI_API_KEY', noBalanceApi: true,
    apiNote: '官方无余额接口 → 余额「—」，今日已用按会话事件估算；探活用 ?key= 形式',
    matchIds: ['gemini'],
    probeUrl: 'https://generativelanguage.googleapis.com/v1beta/models?key={key}',
    balance: { url: '', auth: '', json: { remaining: '' } },
  },
  xai: {
    name: 'xAI Grok', currency: 'USD', keyRef: 'XAI_API_KEY', noBalanceApi: true,
    apiNote: '官方无公开的余额查询接口 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['grok'],
    probeUrl: 'https://api.x.ai/v1/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  groq: {
    name: 'Groq', currency: 'USD', keyRef: 'GROQ_API_KEY', noBalanceApi: true,
    apiNote: '官方无余额接口 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['llama', 'mixtral', 'qwen', 'deepseek', 'gemma', 'whisper'],
    probeUrl: 'https://api.groq.com/openai/v1/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  mistral: {
    name: 'Mistral AI', currency: 'USD', keyRef: 'MISTRAL_API_KEY', noBalanceApi: true,
    apiNote: '官方无余额接口 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['mistral', 'codestral', 'magistral', 'pixtral', 'ministral'],
    probeUrl: 'https://api.mistral.ai/v1/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  together: {
    name: 'Together AI', currency: 'USD', keyRef: 'TOGETHER_API_KEY', noBalanceApi: true,
    apiNote: '官方无余额接口 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['meta-llama', 'Qwen', 'deepseek', 'mistralai', 'nvidia'],
    probeUrl: 'https://api.together.xyz/v1/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  fireworks: {
    name: 'Fireworks AI', currency: 'USD', keyRef: 'FIREWORKS_API_KEY', noBalanceApi: true,
    apiNote: '官方无余额接口 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['accounts/fireworks', 'llama-v3', 'qwen'],
    probeUrl: 'https://api.fireworks.ai/inference/v1/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  deepinfra: {
    name: 'DeepInfra', currency: 'USD', keyRef: 'DEEPINFRA_API_KEY', noBalanceApi: true,
    apiNote: '官方无余额接口 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['meta-llama', 'Qwen', 'deepseek'],
    probeUrl: 'https://api.deepinfra.com/v1/openai/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  cerebras: {
    name: 'Cerebras', currency: 'USD', keyRef: 'CEREBRAS_API_KEY', noBalanceApi: true,
    apiNote: '官方无余额接口 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['llama', 'qwen'],
    probeUrl: 'https://api.cerebras.ai/v1/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  dashscope: {
    name: '阿里云百炼（通义千问）', currency: 'CNY', keyRef: 'DASHSCOPE_API_KEY', noBalanceApi: true,
    apiNote: '云厂商：余额要走阿里云 AK/SK 的 OpenAPI → 余额「—」，今日已用按会话事件估算',
    matchIds: ['qwen', 'qwq', 'qvq'],
    probeUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  qianfan: {
    name: '百度千帆（文心）', currency: 'CNY', keyRef: 'QIANFAN_API_KEY', noBalanceApi: true,
    apiNote: '云厂商：余额要走百度云 AK/SK → 余额「—」，今日已用按会话事件估算',
    matchIds: ['ernie'],
    probeUrl: 'https://qianfan.baidubce.com/v2/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  hunyuan: {
    name: '腾讯混元', currency: 'CNY', keyRef: 'HUNYUAN_API_KEY', noBalanceApi: true,
    apiNote: '云厂商：余额要走腾讯云 SecretId/Key → 余额「—」，今日已用按会话事件估算',
    matchIds: ['hunyuan'],
    probeUrl: 'https://api.hunyuan.cloud.tencent.com/v1/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  spark: {
    name: '讯飞星火', currency: 'CNY', keyRef: 'SPARK_API_KEY', noBalanceApi: true,
    apiNote: '官方无余额接口 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['spark', 'generalv', '4.0ultra'],
    probeUrl: 'https://spark-api-open.xf-yun.com/v1/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  modelscope: {
    name: '魔搭 ModelScope', currency: 'CNY', keyRef: 'MODELSCOPE_API_KEY', noBalanceApi: true,
    apiNote: '官方无余额接口 → 余额「—」，今日已用按会话事件估算',
    matchIds: ['Qwen', 'deepseek', 'MiniMax', 'glm'],
    probeUrl: 'https://api-inference.modelscope.cn/v1/models',
    balance: { url: '', auth: 'Bearer {key}', json: { remaining: '' } },
  },
  ollama: {
    name: '本地模型（Ollama / LM Studio）', currency: 'CNY', keyRef: '', noBalanceApi: true, needsBaseUrl: true,
    apiNote: '本地推理没有余额概念 → 余额「—」；填好 Base URL（如 http://127.0.0.1:11434/v1）后按会话事件统计 token',
    matchIds: ['llama', 'qwen', 'gemma', 'deepseek', 'mistral', 'phi'],
    probeUrl: '{base}/v1/models',
    balance: { url: '', auth: '', json: { remaining: '' } },
  },
}

// 按 JSON 点路径取值：a.b[0].c
export function pickPath(obj, path) {
  if (!path) return undefined
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let cur = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return cur
}
