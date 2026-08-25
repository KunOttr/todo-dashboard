# GitHub Todo 竞品分析报告

> 产品：GitHub Todo —— 把 GitHub Issues 当待办的轻量管理面板（纯前端 / GitHub Pages 部署 / 本地优先 + 延迟同步 / 多仓库 / 支持 GitHub 与 Gitea）
> 调研时间：2026-08-22 ｜ 场景：#10 产品管理
> 方法：桌面调研（官方文档、G2/Capterra/App Store 评论、Reddit/Hacker News、中文技术社区与测评文章），结论均标注来源

---

## 0. 执行摘要（TL;DR）

1. **市场真实存在且成熟**：把 GitHub Issues 当待办是开发者社区的成熟实践（Hacker News 上有大量长期使用者），但**没有一个商业产品专门服务"个人开发者 + 数据自持 + 极简"这个象限**——商业产品全部拥挤在"团队协作 + 云托管 + 订阅制"。
2. **开源里存在类似项目，但无一达到产品级**：missue（模板仓库）、gh-todo（CLI）、github-kanban（React 看板）、My_ToDo（AI 生成任务）等 8+ 个项目都在做"GitHub Issues = 待办"，但全部停留在模板/命令行/单仓库/无本地优先的形态，**没有"开箱即用的产品化 UI + 本地优先 + 多仓库 + 双 Git 生态"的完整方案**。本项目与它们是"产品 vs 脚手架"的差距。
3. **最大机会点是结构性空白**：数据主权（Token 存本地、数据 100% 在用户自己仓库）+ 本地优先（离线可用、不怕限速）+ 极简（对标 GitHub Projects/ZenHub/Linear 被集中吐槽的"复杂/UI 混乱/学习成本"）。Hacker News 用户明确表达过对"把个人工作流托付给商业云服务"的担忧。
4. **差异化方向建议按 P0/P1/P2 推进**：P0 = 个人开发者"数据主权待办"定位 + 极简体验；P1 = Gitea 双生态（中国/内网市场空白）+ 进度可视化复盘（填补 GitHub Projects analytics 空白）；P2 = AI 自然语言创建任务、移动端 PWA。
5. **主要风险**：GitHub 官方可能跟进（低概率）、开源复制门槛低（靠持续迭代速度与体验护城河）、国内直连 GitHub 网络问题（Gitea 支持是缓冲垫）、纯前端无推送通知。

---

## 1. 调研范围与竞品圈定

### 1.1 我们是什么

| 维度 | 本项目现状 |
|---|---|
| 定位 | 开发者个人待办面板，每条待办 = 一个 Issue |
| 数据模型 | 待办=Issue；完成=CLOSED；进度/归档=标签（`进度:X%`、`归档`） |
| 存储 | 用户自己的 GitHub / Gitea 仓库；Token 仅存浏览器 localStorage |
| 架构 | 纯静态、无后端、GitHub Pages 部署；GraphQL（GitHub）+ REST（Gitea）双 provider |
| 同步 | 本地优先 + `pendingOps` 队列 + 5 分钟 debounce 批量同步（规避限速） |
| 功能 | 双区展示、百分比圆环进度、标签/关键词/时间多条件筛选、多仓库切换、内联编辑、归档 |

### 1.2 竞品分层

按"是否与 GitHub 生态绑定"和"个人 vs 团队"把竞争格局分为三层：

- **A 层 · GitHub 原生生态**：GitHub Projects（v2，官方内置）、ZenHub（GitHub 原生看板）、已死选手（Waffle.io、HuBoard、GitKraken Glo Boards）
- **B 层 · 通用待办 / 项目管理 SaaS**：Linear、Todoist、TickTick（滴答清单）、Notion、禅道（国产开源）
- **C 层 · 开源 DIY 方案**：missue、gh-todo（yuler / arrow2nd 两版）、github-kanban、My_ToDo、github-todos、todo-to-issue、Tissues 等

### 1.3 关键市场事实（调研确认）

- **GitHub Projects v2 免费**，任何 GitHub 套餐可用（fromscratch.dev, 2026）。
- **ZenHub 独立运营**，非 GitKraken 子公司；2023-03 完成 $10M A 轮，2023-10 发布无需 GitHub 账号的 on-prem Enterprise 4.0，2025 年仍在发布 AI 功能（Owler/16idc/startupintros）。
- **GitHub 原生第三方看板是"坟场"**：Waffle、HuBoard 先后关停；**GitKraken Glo Boards 与 Timelines 于 2022 年底正式停运**（gitkraken.com 官方公告）——独立"GitHub 增强看板"商业模式被官方 Projects 免费化挤压。
- **开发者把 GitHub Issues 当个人待办是成熟实践**：simonwillison 长期用 Issue 线程做工作日志与 daily planner（HN 讨论 38823002 / 40951254）；中文社区同样有大量教程（用 Issue 模板 + Labels + PR `fixes #xxx` 自动关闭）。
- **个人场景的已知痛点（HN 用户 firewolf34 归纳）**：无层级组织、无依赖跟踪、话题膨胀混乱、公开仓库隐私顾虑、笔记/想法与任务混在一起。

---

## 2. 开源项目调研（核心问题：是否存在类似功能开源项目）

**结论：存在，且方向高度重合，但全部停留在"脚手架 / 单一形态"，没有产品级完整方案。** 对标的不是一个项目，而是多个项目功能之和。

| 开源项目 | 形态 | 核心能力 | 与我们的差距 |
|---|---|---|---|
| [azu/missue](https://github.com/azu/missue) | 模板仓库 | Issues 当个人 TODO；CR（跨仓库引用）同步；靠 Actions/Probot 扩展 | 无 UI、纯模板 + 配置；依赖用户自己搭 |
| [niujiao1121/My_ToDo](https://github.com/niujiao1121/My_ToDo) | 模板 + Actions | AI 一句话生成任务（/todo、/fix）；父子任务树；Milestone 截止日期 | 无独立 UI（用 GitHub 原生界面）；依赖阿里云百炼 API Key；中文场景 |
| [yuler/gh-todo](https://github.com/yuler/gh-todo) | gh CLI 扩展 | 终端里 add/done/list，Issue 即待办 | 命令行形态，无可视化、无筛选/进度 |
| [arrow2nd/gh-todo](https://github.com/arrow2nd/gh-todo) | gh CLI 扩展 | fzf 交互式操作 Issue 待办 | 同上 |
| [njordulv/github-kanban](https://github.com/njordulv/github-kanban) | React 单页应用 | 输入仓库 URL → 三列看板（ToDo/In Progress/Done），拖拽改状态，本地持久化 | 只读一个仓库、无写操作外的完整 CRUD、无标签/筛选/进度/多仓库、需自己部署 Node 环境 |
| [ykominami/ToDo](https://github.com/ykominami/ToDo) | 模板仓库 | Issue 模板 + Projects 自动化看板 | 无独立产品，纯 GitHub 原生拼装 |
| [naholyr/github-todos](https://github.com/naholyr/github-todos) | Node CLI | pre-push 钩子把代码 TODO 注释转 Issue | 不是待办面板，是"注释→Issue"转换器 |
| [sergeichestakov/todo-to-issue](https://crates.io/crates/todo-to-issue) | Rust CLI | 把代码 TODO 注释批量转 Issue | 同上，方向不同 |
| [castledking/Tissues](https://github.com/castledking/Tissues) | 浏览器扩展 | Issue 列表行内 □→⏳→✅ 状态标记 | 仅状态标记、无待办管理能力 |
| [USERSATOSHI/GitHub_Issue_Tracker](https://github.com/USERSATOSHI/GitHub_Issue_Tracker) | 浏览器扩展 | emoji 表情移动 Issue 到 Projects 列 | 依赖 GitHub Projects beta，非独立产品 |

**对本项目的直接启示：**

1. **方向被反复验证**：至少 10 个独立项目在"GitHub Issues 当待办"这个命题上重复造轮子，说明需求真实、但**没有一个做成了大家愿意长期用的产品**——这正是机会。
2. **差异点无人覆盖**：以上项目没有一个是"**开箱即用的产品化 UI + 本地优先离线 + 批量同步防限速 + 多仓库 + 双 provider（GitHub/Gitea）**"的组合。
3. **可借鉴**：My_ToDo 验证了"AI 自然语言创建任务"方向；missue 验证了"模板化零成本"方向；github-kanban 验证了"独立 SPA + 拖拽"方向——这些可作为路线图参考。
4. **定位话术**：我们不是"又一个 GitHub Issues 客户端"，而是"**唯一为个人开发者设计的、数据 100% 自持的 GitHub 原生待办产品**"。

---

## 3. 功能对比矩阵

| 维度 | **GitHub Todo（我们）** | GitHub Projects v2 | ZenHub | Linear | Todoist | TickTick | 开源 DIY 代表 |
|---|---|---|---|---|---|---|---|
| 数据存储 | 用户自己的仓库 | GitHub 云 | 云端（镜像） | 云端 | 云端 | 云端 | 用户自己的仓库 |
| 数据所有权 | **100% 用户** | 平台方 | 平台方 | 平台方 | 平台方 | 平台方 | 100% 用户 |
| 本地优先 / 离线 | **是（队列+延迟同步）** | 否（强联网） | 否 | 否 | 部分（离线缓冲） | 部分（离线缓冲） | 取决于实现 |
| 部署方式 | **纯静态 / Pages** | 内置 | SaaS + 扩展 | SaaS | SaaS | SaaS | 模板/CLI/自部署 |
| 价格 | **免费** | 免费 | $8.33/人/月起 | $8/人/月起 | $4-5/月起 | $2.8/月起 | 免费（自维护） |
| 创建待办速度 | 内联卡片秒建 | 需进 Issue 表单 | 快 | 极快（键盘流） | 极快（自然语言） | 快 | 慢（命令行/表单） |
| 百分比进度 | **有（10% 步进圆环）** | 无 | 无（Story Points） | 无 | 无 | 无 | 无 |
| 标签 / 多条件筛选 | **有（任一/全部+时间+关键词）** | 有 | 有 | 有 | 有 | 有 | 弱 |
| 多仓库切换 | **有** | 有（org 级） | 有（多仓库 board） | 有（项目内） | 有（项目） | 有（清单） | 单仓库为主 |
| 双 Git 生态（Gitea） | **有（唯一）** | 无 | 无 | 无 | 无 | 无 | 无 |
| 团队协作 | 无（个人向） | 强 | 强 | 强 | 中 | 中 | 弱 |
| 移动端 | 浏览器可用 | 差（无原生） | 差 | **无原生 app** | 强 | 强 | 无 |
| 学习成本 | **极低** | 高（UI 复杂） | 中高（UI 混乱） | 中（键盘流） | 低 | 低 | 高（配置） |
| 限速/可靠性处理 | **批量队列防限速** | 官方无此概念 | 无 | 无 | 无 | 无 | 无 |
| 归档机制 | 标签归档（灵活） | 繁琐 | 中 | 中 | 弱 | 弱 | 无 |
| 统计 / 复盘 | 无（路线图） | **无（公认空白）** | 有（燃尽/速度） | 弱（Insights 基础） | 弱 | 有（习惯/统计） | 无 |
| 中文支持 | **原生中文** | 无 | 无 | 无 | 有 | 有 | 视项目 |
| 开源 | **是** | 否 | 否 | 否 | 否 | 否 | 是 |

> 说明：价格为 2026 年公开定价（年付基准）。GitHub Projects 免费但其复杂度与移动端体验是高频抱怨点。

---

## 4. 用户评价汇总

### 4.1 GitHub Projects v2（官方内置）

- **好评**（dev.to/pickuma 深度测评）：代码↔看板自动关联，消灭"手动同步"（案例：每周 25 个 PR × 45 秒 × 52 周 ≈ **每年省 16 小时**）；5-12 人、已用 GitHub 的工程团队是甜点区。
- **差评**：
  - 无开箱报表、无跨项目仪表盘，"GitHub 的立场似乎是：数据在 GraphQL API 里，报表请自己做"（dev.to）。
  - 功能局限：无任务优先级、无父子/依赖关系；UI 对非工程人员复杂（Backlog 日文博客）。
  - "只能跟踪 Issue 形态的任务"，非代码工作放进去很别扭；非技术人员对 issue/milestone/label 术语畏难（fromscratch.dev）。
  - 归档/清理繁琐，报表与组合视图缺失（DeepWiki 整理）。

### 4.2 ZenHub（GitHub 原生看板）

- **评分**：G2 / Capterra 均 **4.3/5**（约 35 条，样本小）。
- **好评**：原生 GitHub 集成、减少上下文切换、Epics/依赖/看板直觉、多仓库 board。
- **差评**：
  - **可靠性**：Capterra 1 星差评——"设置一周后记录神秘消失、48 小时未解决、推迟了发布"；"由小团队运营，无法提供可依赖的体验"。
  - 性能：集成 Salesforce 后加载 30 秒~3 分钟（G2）。
  - UI 难导航、信息过载（"overload of info"）；点击侧栏误以为保存却丢失修改。
  - 只支持 GitHub（GitLab/Bitbucket 团队不可用）；高级集成锁 Enterprise；大团队价格偏高（G2/Capterra 汇总）。

### 4.3 Linear（新兴团队标杆）

- **口碑**：G2/Capterra 高分 + "用户忠诚度堪比消费级产品"，Jira 迁移者"几乎狂喜"。
- **好评**：速度（sub-50ms）、键盘优先设计（"不是快捷键，是一种 mindset"）、极简 UI、GitHub 双向同步（建分支→In Progress、合 PR→自动关闭）、免费版（无限用户/250 issue）。
- **差评**：
  - **无移动端原生 app**（被反复点名的最缺功能）；无 Linux 桌面版。
  - 无时间追踪（按小时计费团队劝退）；无自定义字段、无子任务依赖（论坛求了两年，"最后他们先发了没人要的 AI 功能"）。
  - guest/访客账号全价收费不合理；报表/analytics 太基础；非技术团队（市场/HR/销售）完全不适用。
  - 有用户担忧"Linear 正在变成它取代的 Jira"（企业化膨胀）。

### 4.4 Todoist

- **好评**：自然语言解析（"call dentist tomorrow 3pm #Health !high"）极强、跨平台全、UI 简洁、同步可靠、Karma 激励。
- **差评**：
  - **免费版"越来越像 demo"**：仅 5 个活跃项目、提醒/标签/筛选/上传全部付费墙（toolguide、crm.org 多来源一致）。
  - 价格 €60/年（约合 $65）对"一个清单"偏贵，且 TickTick 更便宜功能更多。
  - 无月历视图；Android/Windows 端有崩溃与同步 bug；无实时协作（"感觉像 2015 年的产品"）。
  - AI 助手仅付费且只在 Web/桌面端，无移动端。

### 4.5 TickTick（滴答清单）

- **评分**：App Store 4.8★，第三方 verified **4.5/5**（3.5 万条验证评论）。
- **好评**：性价比之王（Premium $27.99/年）、全家桶（内置番茄钟、习惯打卡、日历、艾森豪威尔矩阵）、日历视图"我用过最好的"、免费版慷慨（9 清单 × 99 任务）。
- **差评**：UI 过时（"2015 年的 app，一直没翻新"）、日历同步慢、自然语言弱于 Todoist、免费版习惯/纪念日数量上付费墙（"基础功能不该锁"）、无法自定义提醒间隔、单任务不能设起止区间。

### 4.6 "GitHub Issues 当待办"社区实践（Hacker News）

- **正方**（simonwillison 等）：Issue 线程=工作日志+待办+项目存档三位一体；中断后靠读 Issue 评论无缝恢复；用 GitHub Actions 做 daily planner。
- **反方**（firewolf34 等）：无层级/依赖、话题膨胀、公开仓库怕隐私泄露、想法与任务混在一起、个人笔记不适合放在可能公开的仓库。
- **对产品的意义**：正方证明需求与留存真实存在；反方列出的每一条（层级/隐私/归档/区分）**都是我们的机会点清单**。

---

## 5. 各产品差异化策略分析

| 产品 | 核心策略 | 护城河 | 结构性弱点 |
|---|---|---|---|
| GitHub Projects | **免费捆绑 + 生态锁定**：用"免费 + 与代码自动关联"让团队留在 GitHub 内；数据开放（GraphQL API），把报表等深度需求**故意外包给第三方生态** | 免费、零集成成本、存量用户庞大 | 不为个人设计；UI 复杂；无移动优化；analytics 空白是**官方策略选择**而非疏忽 |
| ZenHub | **原生深度 + 敏捷流程**：Epic/依赖/燃尽/规划扑克 + AI 自动化，做"GitHub 上的 Jira" | 原生嵌入、敏捷完整度 | 订阅贵、绑定单一平台、可靠性口碑受损、免费版功能缩水 |
| Linear | **速度 + 设计 + 键盘流**：极致 DX，抢 Jira 换代人群，产品设计高度 opinionated | 品牌忠诚度、速度体验、GitHub 集成 | 只服务软件团队、无移动端、定制刚性、对非工程角色不友好 |
| Todoist | **简单 + 自然语言 + 跨平台**：个人效率首选，"零学习成本快速捕获" | NLP 解析、品牌历史 | 免费版缩水、无项目管理深度、协作停留在 2015 |
| TickTick | **性价比全家桶**：功能越级、价格下探，全平台 + 番茄钟/习惯/日历一体化 | 价格、功能密度 | 设计老化、生态与社区小、部分功能"半成品感" |
| 开源 DIY | **可编程 + 零成本**：模板/Actions/CLI，能力边界由用户自己写代码扩展 | 开源、可自托管、无限定制 | 无产品体验、上手门槛高、无维护承诺、重复造轮子 |

**共同盲区（对所有竞品成立）：**

1. 全部向"团队协作 + 订阅 + 云端"方向堆功能，**个人开发者 + 免费 + 数据自持**无人做；
2. 无一款做**本地优先 + 离线可用 + 开发者友好的限速规避**（SaaS 后端无此概念，恰好是纯前端方案的差异化来源）；
3. **无一款支持 Gitea / 自建 Git**（国内开发者与内网场景完全空白）；
4. **无一款提供百分比进度**（Progress % 是待办心智里最朴素的需求，Todoist/TickTick 也没有；GitHub Projects 依赖 Story Points 且偏团队）；
5. GitHub Projects 的 analytics 缺失被反复吐槽，但官方**主动**不做（文档化立场：数据开放，报表自建）。

---

## 6. 我们的机会点：竞品没满足好的需求

按 P0（必须抓住）/ P1（强烈建议）/ P2（可选）排列：

### P0

- **O1 · 数据主权 / 本地优先（结构性空白，最大机会）**
  所有商业竞品的数据都在别人服务器上；HN 用户明确表达过对"把个人工作流托付给商业云"的担忧。我们的 Token 存本地、数据 100% 在用户自己仓库、纯静态可自部署——这是**商业产品结构上给不了的**。
- **O2 · 个人开发者轻量场景被集体忽视**
  商业产品全部在给"团队协作"加功能（Epic、依赖、燃尽、审批），个人开发者被迫用团队工具杀鸡用牛刀。simonwillison 式"GitHub Issues 即人生待办"人群没有专属工具。
- **O3 · 极简 + 零学习成本**
  GitHub Projects（UI 复杂）、ZenHub（UI 混乱、信息过载）、Linear（键盘流门槛）被集中吐槽；Todoist/TickTick 功能膨胀。一个"打开即用、无需配置"的极简面板直接命中。
- **O4 · 免费零成本**
  ZenHub/Linear/Todoist/TickTick 全部订阅；GitHub Projects 免费但难用。**免费 + 好用**组合在个人象限不存在。

### P1

- **O5 · 不怕限速、不怕断网（开发者独有的信任点）**
  用 API 的开发者都懂限速；GitHub GraphQL 个人令牌有配额。我们的本地队列 + 5 分钟批量同步是"防限速"的工程化答案，可做成卖点（"写完直接关页面也不会丢"）。
- **O6 · 百分比进度与复盘可视化（填补 GitHub Projects analytics 空白）**
  官方明确不做报表；Linear Insights 太基础；Todoist 无月历。圆环百分比、完成趋势、周报是低成本高感知的功能。
- **O7 · Gitea / 自建 Git 双生态（中国 + 内网空白）**
  国内大量自建 Gitea/Forgejo 的团队与个人；无任何竞品支持。这也是对"GitHub 直连不稳"风险的自然缓冲。

### P2

- **O8 · AI 自然语言创建**：My_ToDo、Todoist AI 已验证方向；"一句话创建 Issue + 自动打标签"。
- **O9 · 移动端 PWA**：Linear 无移动端被反复吐槽；纯静态天然适合做成 PWA。

---

## 7. 推荐差异化方向（附理由与验证建议）

### 核心定位（一句话）

> **GitHub Todo —— 给开发者自己用的、数据 100% 属于你的 GitHub 原生极简待办。**
> （Developer-first · Data-sovereign · Zero-config · Free）

一句话理由：它同时命中 P0 的四个机会点（数据主权/个人场景/极简/免费），且是**竞品结构上抄不走**的组合——商业 SaaS 不可能放弃云端，GitHub 官方不可能为个人做轻量版。

---

### D1（P0）· 个人开发者"数据主权待办" + 极简体验

- **做什么**：强化"打开即用"：首屏引导 30 秒连仓库；隐藏一切团队功能；把"数据在你自己仓库 / Token 只在你浏览器"做成产品叙事（页面底部署名式承诺）。
- **为什么是我们**：架构天然满足（纯静态 + 本地 Token + 用户仓库存储）；竞品商业模式决定它们**不能**跟进（SaaS 靠托管数据变现）。
- **为什么竞品难跟进**：GitHub Projects 官方立场是"让团队留在 GitHub"；Linear/Todoist 若做本地化等于推翻商业模式。
- **验证建议（可执行）**：
  1. 开源发布到 GitHub，观察 4 周内 star / issue 讨论的主题分布（若前 20 个 issue 中 ≥30% 与隐私/自托管/数据导出相关 → 需求成立）；
  2. 在 Hacker News / V2EX / 即刻发帖《谁在用 GitHub Issues 当待办？》做需求访谈，收集 10+ 个真实工作流；
  3. 访谈 5-10 位目标用户，验证"是否因数据归属问题放弃过 Todoist/Notion"。
- **风险**：个人待办天花板低（用户增长慢）→ 对策：先做口碑产品，靠"免费 + 开源"扩散，不做商业化假设。

### D2（P1）· 进度可视化与复盘，填补 analytics 空白

- **做什么**：百分比圆环已是差异化（全市场唯一）；增加"完成趋势（近 7/30 天）""周报邮件/页面"轻量统计。
- **为什么是机会**：GitHub Projects analytics 缺失是**官方文档化立场**（数据开放、报表自建）——这是官方主动放弃的市场；Linear/Todoist 均被吐槽报表弱。
- **验证建议**：对现有用户（或开源早期用户）A/B：有统计入口 vs 无，观察 2 周内统计页 UV/使用率；若 ≥20% 用户周访问 ≥1 次 → 投入成立。
- **风险**：纯前端拉全量 issue 计算统计有 API 配额压力 → 用本地缓存 + 分页增量拉取缓解。

### D3（P1）· Gitea / 自建 Git 双生态（中国与内网市场）

- **做什么**：把 Gitea REST 支持从"功能"升级为"卖点"：Gitea 官网文档化、CORS 一键排查、Forgejo 兼容声明。
- **为什么是机会**：国内/内网自建 Git 用户零替代品；且国内直连 GitHub 不稳时，Gitea 支持是留存缓冲。
- **验证建议**：在 V2EX / 掘金 / 即刻开发者社区发布 Gitea 场景演示，收集注册与反馈；目标：Gitea 用户占早期用户 ≥15%。
- **风险**：Gitea 用户盘子小 → 它不承担增长主力，只做差异化背书与留存。

### D4（P1）· "不怕限速、不怕丢数据"的同步信任

- **做什么**：把本地队列 + 5 分钟批量同步工程能力包装成用户可感知的信任点：同步按钮显示倒计时与待同步数（已有）；补充"断网可用、恢复后自动补齐"的显式提示与错误重试可见性。
- **为什么是机会**：SaaS 无此概念；开发者对"我写的东西不能丢"高度敏感。
- **验证建议**：在 onboarding 弹窗埋点，对比"理解同步机制的用户"与"不理解"的 7 日留存差异；收集"数据丢失/同步失败"类 issue 数量趋近于 0 作为质量基线。

### D5（P2）· AI 自然语言创建任务（跟随已验证方向）

- **做什么**：自然语言创建 Issue + 自动建议标签/百分比（参考 My_ToDo 的 `/todo` 与 Todoist NLP）。
- **为什么可做**：两个竞品已验证需求；纯前端可接 LLM API（或做成可选增强）。
- **验证建议**：作为实验功能灰度，观察"AI 创建占比"与"编辑后修改率"（修改率低 = 生成质量好）。
- **风险**：成本与隐私（Issue 内容外发到 LLM）→ 默认关闭、显式授权。

### D6（P2）· 移动端 PWA

- **做什么**：纯静态天然 PWA 化，补齐 Linear"无移动端"的吐槽点。
- **验证建议**：移动端访问占比 ≥15% 后再投入。
- **风险**：低优先级，避免过早分散精力。

---

### 行动清单（未来 2-4 周建议）

| # | 动作 | 对应方向 |
|---|---|---|
| 1 | 开源发布 + README 写清"数据主权"叙事 | D1 |
| 2 | HN / V2EX / 即刻发帖做需求验证（收集 10+ 工作流） | D1 |
| 3 | 上线完成趋势统计（近 7/30 天）最小版 | D2 |
| 4 | 补 Gitea 接入文档与 CORS 排查指引 | D3 |
| 5 | 埋点：同步机制理解度 vs 7 日留存 | D4 |
| 6 | 调研移动端访问占比，决定 PWA 排期 | D6 |

---

## 8. 风险与应对

| 风险 | 说明 | 应对 |
|---|---|---|
| GitHub 官方跟进 | 若 GitHub 给 Projects 加"个人轻量模式/百分比"，官方免费优势直接碾压 | 概率低（官方定位团队）；保持开源口碑 + 双生态 + 本地优先的差异化纵深 |
| 开源复制 | 门槛低，有人照抄 | 产品体验与迭代速度是护城河；本地优先 + 双 provider 是工程复杂度壁垒 |
| 国内直连 GitHub 不稳 | 影响国内用户核心链路 | Gitea 支持 + 静态部署可自托管在任何环境 |
| API 配额天花板 | 大仓库全量拉取有限速 | 增量分页 + 本地缓存；5 分钟批量队列已是部分解法 |
| 纯前端无推送通知 | 无法做到期提醒 | 路线图可做 Web Notification（浏览器权限）或 GitHub Actions 提醒模板（竞品也靠第三方） |
| Token 安全 | 公共设备泄露 | 文档警示 + 最小权限引导（已是 README 现有能力） |

---

## 9. 主要数据来源

- GitHub Projects 测评：dev.to/pickuma《GitHub Projects Review》；fromscratch.dev《Trello Alternatives》；Backlog 日文博客；DeepWiki（drshahizan/learn-github）
- ZenHub：G2 / Capterra 评论页；16idc 产品档案；startupintros 融资记录；Owler 公司档案
- Linear：usereviews.io / toolguide.io / geronimotools / topreviewed.ai / findstack 测评
- Todoist：toolguide.io / crm.org / TechRadar 测评
- TickTick：crm.org / toolguide.io / verifiedappreviews（3.5 万条）/ G2 / nichemetric
- 社区实践：Hacker News 讨论 38823002、40951254；simonwillison.net；dev.to/azu（missue 作者）
- 开源项目：GitHub 各仓库 README（missue、My_ToDo、gh-todo×2、github-kanban、ToDo、github-todos、todo-to-issue、Tissues、GitHub_Issue_Tracker）
- 平台状态：gitkraken.com（Glo Boards 停运公告）；mergr.com（GitKraken M&A 记录）

---

*报告完。如需针对某一方向做更深的产品需求文档（PRD）或定价/商业模式分析，可随时继续。*
