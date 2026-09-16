# 鲸鱼娘生成经验文档（EXPERIENCE）

记录这只鲸鱼娘从 0 到开源的完整生成过程：任务演进、使用的技术与素材（含出处）、踩过的坑。写给想复刻/二创的人，也写给未来的维护者。

## 一、项目演进

### v1 · 余额挂件（2026-09-16）
**任务**：参考 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT）给 ZCode 做一个 DeepSeek 余额挂件。
- 参考仓库以 codeload tarball 拉到 `sources/` 存档，记账内核（定点金额+余额观测/校正）、峰谷定价表、34 厂商模板逐文件移植，口径与原版一致
- 难点：原版每轮消耗依赖 DSH 宿主 session 事件；ZCode 没有这个机制 → 改用 **Stop 钩子读会话日志**
- 峰谷计价单测 4 例 + 计价 2 例全过；mock 余额接口验证观测记账幂等

### v2 · 安装 + 形象化（2026-09-16）
**任务**：安装调试 + 建立形象模型库 + 换装 + GLM 额度主显示 + ZCode 内桌宠化。
- 密钥从本机 DSH 凭据库迁移到 `~/.zcode-whale/keys.json`
- 形象体系学自 whalechan 仓库（见下）：5 形态（4.0/3.3/2.8/2.5/2.1 头身）+ 字段解耦 manifest（identity/form/outfit/state 独立）
- 桌宠：tkinter `overrideredirect + transparentcolor + topmost`，ctypes `EnumWindows` 按进程名找 ZCode 窗口跟随
- GLM 额度接口实测：`GET /api/monitor/usage/quota/limit`，**Authorization 用裸 key 无 Bearer**，返回 `data.limits[]` 数组（unit 3=小时窗 / 6=月窗）

### v3 · 活起来（2026-09-17）
**任务**：透明气泡+输入栏、AI 生成表情包、身体模型+饰品、主动行为、性能优化。
- CogView-4 生图接入（两把智谱 key 实测均可用）；whalechan 技能的「身份块 prompt 编译」保证生成角色一致性
- 身体模型：`body-model.json` 5 形态 × 15 锚点（归一化坐标），制作时给参考图叠加 10% 网格人工标定，再用交叉线标注图复核
- 饰品：PIL 矢量绘制按锚点合成；**脖挂件需要锚点+垂坠偏移**，否则糊脸上
- 性能：根因是手势态 166ms 一次 LANCZOS 重采样 → 改「图像 LRU 缓存 + 变化才重绘 + 跳动只挪画布坐标」

### v4 · 灵魂（2026-09-17，本次）
**任务**：额度常显、金币商店、性格系统、召唤按钮、素材导入、开源打包。
- 性格：4 种（活泼/安静/傲娇/吃货），`webcrypto` 随机首启抽取写盘固定，下发行为权重（walkChance/walkDur/idleDur/bubbleGap）与三类台词池（greet/comfort/ambient）
- 金币：累计记录消费 ÷ 1 元 = 金币（新手 3 币），购买走拥有权校验（PUT state 时拦截未拥有装扮）
- 常显药丸/召唤按钮：同进程 Toplevel 透明窗，随 ZCode 窗口矩形同步位置

## 二、生成命令（复刻用）

```bash
# 参考仓库存档
curl -sL https://codeload.github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/tar.gz/refs/heads/main -o ref.tar.gz
curl -sL https://codeload.github.com/Neko3000/deepseek-whalechan/tar.gz/refs/heads/main -o whalechan.tar.gz

# 素材抠图（白底/米白底 → 透明 PNG，边缘泛洪保护服装内部白色）
python scripts/preprocess.py

# 换装预览（调锚点用）
python lib/dressup.py semi-chibi "crown_whale,glasses_round" preview.png

# 语法/运行
node --check server.mjs && python -m py_compile pet.py
node server.mjs &  python pet.py
```

AI 生图 prompt 模板（CogView-4，身份块 + 动作块）：

```text
DeepSeek 鲸鱼娘(Whale-chan)：固定角色——圆润大脸、蓝色大眼睛、深洋蓝渐变青色卷发、
一对鲸鱼鳍耳、一根前弯呆毛、自然连接的鲸鱼尾巴、藏青白女仆装（白围裙上有小蓝鲸徽章）。
2.5头身Q版，粗近黑藏青描边，柔和赛璐璐上色，奶白色纯背景，干净的贴纸构图，无文字。
动作与表情：<此处填想要的动作，如「抱着一大碗白米饭狼吞虎咽」>。
```

## 三、素材与出处（重要）

| 素材 | 来源 | 说明/许可 |
|---|---|---|
| 人设规范、5 形态参考图、prompt 编译法 | [Neko3000/deepseek-whalechan](https://github.com/Neko3000/deepseek-whalechan) | 角色设定卡/形态比例规范/参考图；仓库未附许可证，素材版权归原作者，受原创作者主张时请替换 |
| 立绘设定图（DeepSeek 娘 adult/child、四格倾斜梗图等 8 张） | 知乎回答附件（用户提供的图片缓存，出处 [知乎问题 12544471627](https://www.zhihu.com/question/12544471627)，署名水印「光影伴我飞」） | 同人创作，版权归原作者 |
| 表情包 128 张（meme-001~128） | [ChineseBQB#167](https://github.com/zhaoolee/ChineseBQB/issues/167) 提供的 supabase 图床（与 [996.ninja/deepseek-meme](https://996.ninja/deepseek-meme) 同源） | 网友同人表情包合集，版权归原作者 |
| 扩充贴纸 60 张（memes/extra/） | [EDMOK/blue-fish-archive](https://github.com/EDMOK/blue-fish-archive)（蓝色大肥鱼档案馆） | 同人收集项目，版权归原作者 |
| 看板娘状态参考图（reference/whale-musume/） | [Small-tailqwq/dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)（maid-atelier 素材） | 仅作参考素材收录，版权归原作者 |
| 原版鲸鱼 cut-out、音效（DSniang1.png/Ya\*/D\*/wav） | [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) | MIT |
| AI 生成图（memes/generated/，运行时产出） | CogView-4 自产 | 归使用者所有 |

> 行为与交互设计参考了 [Sutera-Diffusus/dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume)（待机/工作/摸头互动）等桌宠的公开描述。

## 四、踩坑记录（后来者重点看）

1. **ZCode rollout 的 token 口径**：`inputTokens` **已包含** cacheRead/cacheWrite（实测 `totalTokens = input + output`）；按未命中计费前必须减掉缓存部分，否则估值虚高 18 倍。
2. **Stop 钩子会多次触发**（续写循环）：服务端按 `turnId` 去重。
3. **Stop 钩子任何输出都会触发续写**：钩子全程静默。
4. **tkinter 透明窗**：canvas 里画气泡在窗口被 `wm_geometry` 反复移动后可能不重绘（bbox 存在但不上屏）→ 气泡用独立 Toplevel。
5. **素材底色不一定是纯白**：whalechan 参考图底色是米白 `#F5EADD`，抠图取四角中位色做泛洪基准。
6. **换装路径**：跨目录引用（如 `../DSniang1.png`）在客户端拼路径会静默失败——服务端统一 `normpath + relative` 归一化，客户端渲染异常必须留日志。
7. **Windows 文件占用**：JSON 写盘用「临时文件 + rename」+ EBUSY/EPERM 重试。
8. **安全红线**：服务只绑 127.0.0.1 + Host 校验；密钥只从环境变量/keys.json 读；生图请求做协议白名单；钩子/桌宠对本机 URL 做 scheme+host+port 断言。
