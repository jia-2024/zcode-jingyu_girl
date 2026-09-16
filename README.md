# 🐋 鲸鱼娘桌宠 · Whale-chan Pet for ZCode

一只住在 ZCode 软件内部的鲸鱼娘桌宠：**GLM/DeepSeek 额度常显、对话消费记账、AI 生成表情包、换装饰品、性格系统、金币商店**。对标 [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT）的功能口径，以 [Neko3000/deepseek-whalechan](https://github.com/Neko3000/deepseek-whalechan) 的角色设定为形象基准。

> 本地运行，数据不出机器。桌宠行为零 token 消耗；仅「AI 生成表情包」调用你自己的智谱 API 余额。

## ✨ 功能

- 🐋 **ZCode 内桌宠**：透明置顶小窗贴在 ZCode 客户区内，跟随窗口移动，透明区域点击穿透
- 📊 **额度常显**：GLM Coding Plan 双窗口（5h/月）剩余% + 重置倒计时药丸常驻；DeepSeek 余额观测记账（余额下降计消费，充值不冲账）
- 💬 **每轮对话消耗**：ZCode Stop 钩子读会话日志聚合真实 usage，按峰谷价计价
- 🪙 **金币商店**：每累计 ¥1 记录消费铸 1 金币，金币购买装扮与饰品
- 🎭 **性格系统**：首启随机抽取（活泼/安静/傲娇/吃货）并永久固定，影响行走频率、话痨程度与台词风格（额度吃紧时会安慰你）
- 🎨 **表情包工坊**：CogView-4 一键预设 + 自由描述生成，身份块 prompt 编译保证角色一致性
- 👗 **换装 + 饰品**：4 装扮 × 9 饰品，身体模型锚点分层实时合成；支持导入自己的图片
- 🚶 **主动行为**：行走摇摆、示意跳跃、方向翻转，行为权重随性格变化
- 🖥️ **控制台**：额度卡/用量记录/商店/导入/设置（浏览器打开）
- 🧩 **多厂商余额**：34 个厂商模板（OpenRouter/Kimi/智谱/硅基流动/OneAPI 中转站…）

## 🚀 快速开始

依赖：[Node.js ≥ 18](https://nodejs.org)、Python ≥ 3.10（含 tkinter、`pip install pillow`）。

```powershell
# 1) 配置密钥（二选一或都要）
#    系统环境变量，或写入 %USERPROFILE%\.zcode-whale\keys.json：
{ "DEEPSEEK_API_KEY": "sk-...", "ZHIPU_API_KEY": "你的智谱 key（额度显示+生图）" }

# 2) 启动
start.cmd        # 后台服务(127.0.0.1:8787) + 桌宠
```

接入 ZCode 每轮消费统计（可选）：

```powershell
node install-hooks.mjs     # 备份并合并 ~/.zcode/cli/config.json 的 Stop/SessionStart 钩子
```

## ❓ FAQ

**生图用的什么 API？花谁的钱？**
CogView-4（智谱官方 `open.bigmodel.cn`）。key 从你本机 `keys.json` 读取，**代码不含任何内置密钥**；每张图消耗你自己的智谱余额，价格见[智谱定价页](https://open.bigmodel.cn/pricing)（CogView-3-Flash 为免费档，可在 `lib/meme-gen.mjs` 换模型名）。

**桌宠行为花 token 吗？**
不花。行走/表情/说话/额度显示全部本地计算；额度数值来自智谱/DeepSeek 的查询接口（免费）；每轮消费统计读取本机会话日志文件。

**我的 key 会上传吗？**
不会。key 只存在本机 `~/.zcode-whale/keys.json`，仅用于本机服务向官方接口发请求；服务只监听 127.0.0.1 且校验 Host。

**怎么让鲸鱼娘显示我的自定义形象？**
控制台「素材导入」选一个装满 png 的文件夹→导入为装扮/饰品；或直接改 `assets/characters/deepseek/manifest.json`。

## 📁 结构

```
server.mjs / lib/    本地服务（API/记账/性格/商店/语境状态机）
pet.py               桌宠（tkinter 透明窗 + 跟窗 + 行为 + 气泡）
public/              控制台页面
hooks/               ZCode Stop / SessionStart 钩子
install-hooks.mjs    ZCode 钩子安装器（自动备份合并 config.json）
assets/              形象库/表情包/饰品（来源见 EXPERIENCE.md「素材与出处」）
EXPERIENCE.md        生成过程、任务命令、素材出处、踩坑记录
```

## 🙏 素材与致谢

形象与素材来自社区同人创作，出处与许可说明见 [EXPERIENCE.md](EXPERIENCE.md)。感谢所有鲸鱼娘创作者。

## 📄 许可

代码 MIT（见 LICENSE）；`assets/` 内第三方美术素材版权归原作者所有，仅作集成引用。
