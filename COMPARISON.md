# 原版功能对照清单（诚实盘点）

对照 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT，v0.3.2）的功能范围，逐条标注本项目（鲸鱼娘桌宠 v4）的实现状态。

## ✅ 已实现（口径对齐原版）

| 功能 | 本项目实现 |
|---|---|
| DeepSeek 余额查询 + 60s 自动刷新 | server.mjs `/api/balance.json` |
| 余额下降记账 / 充值不冲账 / 8 位定点小数 | lib/accounting.mjs（原版公式 verbatim 移植） |
| 峰谷定价（工作日高峰/周末谷/2026-08-23 起） | lib/pricing.mjs（原版价目表 verbatim 移植） |
| 多厂商余额模板（34 厂商） | lib/templates.mjs（原版模板 verbatim 移植） |
| 余额校正（revision 乐观锁） | POST /api/reconcile |
| 账本归档（90 天/2 万条 + 365 天） | server.mjs pruneLedger |
| 每轮对话真实 usage 计价 | Stop 钩子读 ZCode rollout（替代原版 DSH session 事件） |
| 余额预警 / 今日预算 | settings + contextState alerts |
| 实时·令牌模式 | DEEPSEEK_PLATFORM_TOKEN + platform usage 接口 |
| 网络抖动沿用旧值（stale） | getBalance 25s 缓存 + 请求去重 |
| 多币种选择（CNY>0 → 任一>0 → CNY → 首） | pickBalanceInfo 原版逻辑 |
| 挂件拖拽 + 吸附 | pet.py 拖拽 + settle()（1/4 区域阈值） |
| 按压 Q 弹 | pet.py press/pop 帧序列（0.82/1.08/0.96） |
| 点击弹气泡（额度+余额+台词） | pet.py show_bubble |
| 右键菜单（形态/换装/饰品/商店/控制台/退出） | pet.py on_right |
| 左吸附翻转 | 暂未实现（design 预留 flip 变量，render 已支持 flip） |
| 自动刷新 + 手动刷新 | 60s setInterval + 点击刷新 |
| 安全：127.0.0.1 + Host 校验 + 密钥不落盘 | server.mjs + pet.py |

## ⚡ 超越原版的功能

| 功能 | 说明 |
|---|---|
| 四轴妆造体系 | 画风×比例×状态×装饰 数据驱动（styles.json），原版只有换图片 |
| 性格系统 | 4 性格随机固定，影响行为权重与台词风格（原版无此概念） |
| 金币商店 | 消费铸币 + 商品购买 + 拥有权校验（原版无） |
| AI 表情包工坊 | CogView 生成 + whalechan 风格块编译（原版无） |
| 主动行为 | 行走摇摆/示意跳跃/方向翻转（原版无） |
| GLM 额度主显示 | 双窗口(5h/月)剩余% + 重置倒计时（原版只做 DeepSeek） |
| 天气接入 + 提醒 | Open-Meteo 免费 API（原版无） |
| 聊天对话 | GLM-4-Flash 免费 + 3 轮上下文 + 表情包回复（原版无） |
| 表情包贴纸库 | 188 张（ChineseBQB + blue-fish-archive + AI 生成） |
| ZCode 集成 | Stop/SessionStart 钩子（原版面向 DSH） |

## ❌ 未实现（诚实声明）

| 原版功能 | 缺失原因 | 状态 |
|---|---|---|
| 自定义泡泡编辑器（模块化拖拽） | 工程量大（原版核心功能），预留 bubble.json 接口 | 规划中 |
| 自定义角色上传 | 素材导入 API 已预留（POST /api/import），UI 未做 | 接口就绪 |
| 自定义字体 | 需前端字体加载逻辑 | 未做 |
| 跑马灯渐变配色 | CSS 动画，未做 | 未做 |
| 按住超长按时长区分音效 | pet.py 未实现时长判断 | 未做 |
| 移动端触控优化 | 桌宠面向桌面，不适用 | N/A |
| DSH 凭据服务集成 | 改用 keys.json + 环境变量（面向 ZCode 用户） | 设计差异 |
| Codex 本地会话统计 | 面向 DSH 生态，不适用于 ZCode | 不做 |
| 峰谷文案多样式 | 只有简洁版 | 可加 |
| 每轮消耗泡泡自动关闭秒数可设 | turnCostCloseMs 已有字段但桌宠端未暴露 UI | 字段就绪 |

## 📊 量化对比

| 维度 | 原版 (DSH Widget) | 本项目 (ZCode 桌宠) |
|---|---|---|
| 代码量 | ~15,000 行 (widget.js 14,651) | ~3,000 行 (pet.py + server.mjs + lib/) |
| 运行环境 | DSH Web 界面内嵌 | Windows 桌面（tkinter 透明窗） |
| 形象 | 静态 PNG + 代码绘制气泡 | 多形态×多状态×多装饰 动态合成 |
| 状态机 | 简单（正常/加载/错误） | 13 状态 + 性格权重 + 昼夜节律 |
| AI 生图 | 无 | CogView-4 / Pollinations 双路线 |
| 商店/金币 | 无 | 有 |
| 天气 | 无 | 有 |
| 开源协议 | MIT | MIT |
