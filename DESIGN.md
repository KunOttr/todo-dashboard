# DESIGN.md — GitHub Todo 待办管理面板

> 本设计规范文档（Design System Spec）专为 `github-todo` 静态站点生成，供 Cursor / Claude Code / Google Stitch 等 AI 编程代理直接消费。
> 设计语言继承自 **GitHub Primer**（项目实际 `css/style.css` 的全部 token 已在此固化），并吸收 Linear / Vercel / Stripe 等开发者工具品牌中"克制、信息密度高、无多余装饰"的共同偏好。
> 本文件是项目**唯一权威**的视觉规范来源；任何界面改动应先对照此处，再修改代码。

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

- **品牌设计哲学**：以 GitHub 原生界面为基准的"工程化极简"。视觉服务于信息效率，不靠装饰取胜；状态清晰、操作可逆、反馈即时。
- **视觉基调**：中性冷静的浅色系统（Light-first），单一品牌蓝作为唯一强调色，语义色仅在必要时出现（成功/危险/归档）。
- **核心视觉特征关键词**：`Primer`、`信息高密度`、`细边框`、`微阴影`、`克制留白`
- **光影与质感倾向**：纯扁平 + 极轻阴影（shadow 仅用于卡片浮起与弹层遮罩）；不使用毛玻璃、渐变、投影重色。边框（`#d0d7de`）承担主要分区责任。

---

## 2. Color Palette & Roles（调色板与角色）

所有颜色必须以 HEX/rgba 提供，并绑定 CSS 变量名。

### Primary Colors（主色 / 品牌蓝）
| 角色 | HEX | CSS 变量 | 使用场景 |
|---|---|---|---|
| Primary | `#0969da` | `--primary` | 主按钮、链接、聚焦边框、进度环、激活态 |
| Primary Hover | `#0860ca` | `--primary-hover` | 主按钮 hover |
| Focus Ring BG | `#ddf4ff` | `--blue-bg` | input 聚焦时的外发光 outline |

### Neutral / Gray Scale（中性灰阶）
| 角色 | HEX | CSS 变量 | 使用场景 |
|---|---|---|---|
| Canvas | `#f6f8fa` | `--bg` | 页面背景 |
| Surface | `#ffffff` | `--card-bg` | 卡片、模态、顶部栏背景 |
| Border | `#d0d7de` | `--border` | 所有边框、分隔线 |
| Text | `#1f2328` | `--text` | 主文字 |
| Text Muted | `#656d76` | `--text-muted` | 次要文字、meta、占位 |
| Gray Subtle | `#8c959f` | （派生） | 编号、禁用文字、标签默认点 |

### Semantic Colors（语义色）
| 角色 | HEX | CSS 变量 | 使用场景 |
|---|---|---|---|
| Success / Done | `#1a7f37` | `--green` | 已完成勾选、进度条/环、成功提示 |
| Success Deep | `#0f5a24` | （派生） | 进度环 100% 满环描边 |
| Danger | `#d1242f` | `--red` | 删除、错误文字、错误 toast |
| Danger BG | `#fff2f2` | （派生） | 错误横幅背景 |
| Danger Border | `#ffcece` | （派生） | 错误横幅边框 |
| Purple / Archive | `#6f42c1` | `--purple` | 归档开关、归档标签边框、选中勾 |
| Purple Soft BG | `#f4efff` | （派生） | 归档标签/选中态背景 |
| Purple Text | `#5b32a3` | （派生） | 归档标签文字 |

### Accent / Warning（强调 / 警告）
| 角色 | HEX | CSS 变量 | 使用场景 |
|---|---|---|---|
| Warning Border | `#e3b341` | （派生） | 仓库未连接 warn 按钮边框 |
| Warning BG | `#fff7d6` | （派生） | warn 按钮背景 |
| Warning Text | `#8a6d1a` | （派生） | warn 按钮文字 |

### Editor State（编辑态，临时高亮）
| 角色 | HEX | 使用场景 |
|---|---|---|
| Editor BG | `#fffbe8` | 内联编辑卡片背景 |
| Editor Border | `#f0d98a` | 内联编辑卡片边框 |

### Surface & Shadows
| 角色 | 值 | CSS 变量 |
|---|---|---|
| Card shadow | `0 1px 3px rgba(0,0,0,0.08)` | `--shadow` |
| Modal shadow | `0 8px 24px rgba(0,0,0,0.2)` | （派生） |
| Popover/Dropdown shadow | `0 6px 18px rgba(0,0,0,0.12)` | （派生） |
| Overlay scrim | `rgba(31,35,40,0.45)` | （派生） |

> 标签（tag）颜色由用户数据驱动（`--tag-color` 内联），默认回退 `#8c959f`。

---

## 3. Typography Rules（排版规则）

### Font Family
```
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
             "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
```
- 主字体族为系统 UI 栈（保证中英文混排与跨平台一致性），无 web font 依赖、无 FOUC。
- 等宽场景（代码/编号）使用系统 mono 栈，CSl 中 `code` 标签背景 `#f6f8fa`。

### Type Scale
| Token | Size | Weight | Line Height | Letter Spacing | 使用场景 |
|---|---|---|---|---|---|
| Display / Brand | 18px | 700 | 1.3 | 0 | 顶部品牌名 |
| H3 (Modal) | 18px | 600 | 1.4 | 0 | 模态标题 |
| Block Title | 17px | 600 | 1.4 | 0 | 区块标题（未完成/已完成） |
| Card Title | 15px | 600 | 1.45 | 0 | 任务卡片标题 |
| Body | 14px | 400 | 1.5 | 0 | 全局正文、输入文字 |
| Button | 13px | 500 | 1.4 | 0 | 按钮、下拉按钮 |
| Meta / Caption | 13px | 400 | 1.6 | 0 | 卡片描述、帮助段落 |
| Tag / Count | 12px | 500 | 1.4 | 0 | 标签、计数徽标、meta |
| Micro | 11px | 400 | 1.3 | 0 | 系统徽标、provider 标记 |

### 设计哲学
- 字重克制：仅 Brand(700) 与标题/卡片(600) 用粗，其余 400–500；不滥用 700。
- 行高统一 1.4–1.6，保证中文可读；英文不收紧字距（letter-spacing: 0）。
- 字号跨度小（11→18px），体现信息密度优先，避免大标题浪费纵向空间。

---

## 4. Component Stylings（组件样式）

### Buttons
```css
.btn {
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #f6f8fa;
  font-size: 13px; font-weight: 500;
  color: var(--text);
  cursor: pointer;
  transition: background .15s;
}
.btn:hover { background: #eef1f4; }
.btn:disabled { opacity: .6; cursor: not-allowed; }

.btn-primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.btn-primary:hover { background: var(--primary-hover); }

.btn-link { background: none; border: none; color: var(--primary); padding: 2px; }
.btn-link:hover { text-decoration: underline; }

.danger { color: var(--red); }
```
- 变体：`.btn`（默认灰）/ `.btn-primary`（蓝）/ `.btn-link`（文字链接）/ `.danger`（红字）。
- 圆角统一 6px；padding 7×14。

### Cards（任务卡片）
```css
.task-card {
  display: flex; gap: 12px; align-items: flex-start;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  box-shadow: var(--shadow);
}
.task-card-closed { background: #fafbfc; }
.task-card-closed .card-title { text-decoration: line-through; color: var(--text-muted); }
```
- 编辑态：`background:#fffbe8; border-color:#f0d98a;`
- 卡片标题 15px/600；描述 13px muted；meta 12px。

### Inputs
```css
input[type="search"], input[type="text"], input[type="password"],
input[type="date"], textarea, select {
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  background: #fff; color: var(--text);
}
:focus {
  outline: 2px solid var(--blue-bg);
  border-color: var(--primary);
}
```
- placeholder 用 `--text-muted`；聚焦用 2px `--blue-bg` 外发光 + 蓝边。

### Navigation（顶部栏）
```css
.topbar {
  display: flex; align-items: center; gap: 16px;
  padding: 12px 24px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 20;
}
```
- 仓库切换下拉 `.repo-switch-menu`：白底、1px 边框、圆角 8px、阴影 `0 6px 18px rgba(0,0,0,.12)`。

### Badges / Tags
```css
.tag {
  display: inline-block; padding: 1px 8px;
  border-radius: 999px; font-size: 12px; color: var(--text);
  background: color-mix(in srgb, var(--tag-color, #8c959f) 15%, white);
}
.tag-archived { background: #f4efff; color: #5b32a3; font-weight: 600; }
```
- 标签筛选 chip：圆角 999px、1px 边框、选中态用 `color-mix(tag 12%, white)` 背景。

### Modals / Dialogs
```css
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(31,35,40,0.45);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 8vh 16px; z-index: 50;
}
.modal {
  background: #fff; border-radius: 10px; padding: 24px;
  width: 100%; max-width: 540px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.2);
}
.modal-lg { max-width: 640px; }
```
- 遮罩 0.45 黑；内容区圆角 10px；无进场动画（直接显示），关闭用 `.hidden` 切换。

---

## 5. Layout Principles（布局原则）

- **间距基数**：4px。实际间距均为 4 的倍数：4 / 6 / 8 / 10 / 12 / 14 / 16 / 24 / 28。
- **Grid / Container**：单栏居中，内容最大宽度 `980px`（`main` 与 `filters` 同宽）；`main` 左右 padding 16px。
- **Section Spacing**：区块间距 28px；区块内卡片间距 10px；筛选栏与主体间距 24px。
- **留白哲学**：以 4px 栅格维持紧凑信息密度；垂直留白优先于水平，避免宽边距浪费；长列表靠卡片间距（10px）而非大留白分区。
- **Sticky 行为**：顶部栏 `sticky top:0`；筛选栏 `sticky top:56px`（顶部栏之下）。

---

## 6. Depth & Elevation（深度与层级）

### Shadow System
| Token | box-shadow |
|---|---|
| `--shadow` (xs) | `0 1px 3px rgba(0,0,0,0.08)` |
| shadow-sm | `0 6px 18px rgba(0,0,0,0.12)` |
| shadow-md | `0 6px 18px rgba(0,0,0,0.14)` |
| shadow-lg (modal) | `0 8px 24px rgba(0,0,0,0.2)` |

### Surface Layers
| 层级 | 背景 | 示例 |
|---|---|---|
| Base | `#f6f8fa` | 页面 |
| Surface | `#ffffff` | 卡片/顶部栏/模态 |
| Elevated | `#fff` + shadow | 弹层/下拉/进度选择 |
| Overlay | `rgba(31,35,40,0.45)` | 模态遮罩 |

### Z-index Scale
| 值 | 元素 |
|---|---|
| 20 | 顶部栏 `.topbar` |
| 15 | 筛选栏 `.filters` |
| 30 | 下拉菜单 `.repo-switch-menu` / `.filter-dropdown-menu` |
| 45 | 进度选择弹层 `.progress-popover` |
| 50 | 模态遮罩 `.modal-overlay` |
| 60 | 加载遮罩 `.loading` |
| 100 | Toast |

> 不使用毛玻璃（backdrop-filter）；层级靠实色 + 阴影表达。

---

## 7. Do's and Don'ts（设计规范与禁忌）

**Do's**
1. 用 `#d0d7de` 细边框做视觉分区，而非粗阴影或大色块。
2. 强调色只用 `--primary` 蓝；语义色（绿/红/紫）仅在状态/危险/归档时出现。
3. 圆角遵循体系：卡片/模态 8–10px，输入/按钮 6px，标签/徽标 999px。
4. 中文用系统字体栈，不引入 web font；保持零加载依赖。
5. 焦点态一律 `outline:2px solid --blue-bg` + 蓝边，保证键盘可达。
6. 危险操作（删除）先置灰待确认，再变红字二次确认。
7. 间距走 4px 栅格；卡片间距固定 10px 维持密度。

**Don'ts**
1. 不要引入渐变、毛玻璃、发光投影等装饰性效果。
2. 不要新增品牌色；所有新色必须先在 §2 登记变量。
3. 不要用圆角超过 10px 的卡片或大于 6px 的输入控件。
4. 不要放大字号跨度（正文以外避免 >18px 的标题）。
5. 不要用 emoji 或彩色 icon 做主视觉；状态靠颜色 + 文字。
6. 不要在浅色系统下做暗色分支（当前仅 Light-first，无 dark token）。
7. 不要使用 `box-shadow` 重色（alpha>0.2 仅限 modal 遮罩层）。

---

## 8. Responsive Behavior（响应式行为）

### Breakpoints
| 名称 | 宽度 | 策略 |
|---|---|---|
| Mobile | ≤ 720px | 单列、卡片操作行横排换行、模态内边距收紧 |
| Tablet/Desktop | > 720px | 完整布局，筛选栏 sticky |

- 内容容器固定 `max-width: 980px`，移动端通过 `padding` 收缩（16→14px）。

### Touch Targets
- 按钮/可点元素最小高度 ≥ 32px（`.btn` padding 7×14 ≈ 34px）。
- 勾选圆 `.check-btn` 22px；进度环 `.ring-btn` 44px（移动端友好）。

### 折叠策略
- ≤720px：`.card-actions` 由纵向改为 `row + wrap`；进度条 `range` 占满整行；模态 `padding: 4vh 10px`。
- 顶部栏 `flex-wrap` 允许品牌/仓库/操作在窄屏换行。

### Font Scaling
- 不依赖 `vw` 缩放；字号固定（11–18px），仅在移动端通过 padding 与换行适配，不做整体字号缩放。

---

## 9. Agent Prompt Guide（AI 代理提示指南）

### Quick Reference
- 风格：GitHub Primer 浅色、信息高密度、细边框微阴影、单一蓝强调。
- 主色 `--primary:#0969da`；文字 `--text:#1f2328`；边框 `--border:#d0d7de`；背景 `--bg:#f6f8fa`。
- 圆角：卡片/模态 8–10px，输入/按钮 6px，标签 999px。间距基数 4px。
- 字体：系统 UI 栈（含中文 PingFang SC / Microsoft YaHei），无 web font。
- 仅 Light 主题；语义色绿 `#1a7f37` / 红 `#d1242f` / 紫 `#6f42c1`。

### Component Prompts（可直接复制）
1. `生成一个任务卡片组件，背景 #fff、1px #d0d7de 边框、圆角 8px、阴影 0 1px 3px rgba(0,0,0,.08)，左侧 22px 圆形勾选、右侧标题 15px/600 + 描述 13px muted。`
2. `写一个顶部 sticky 导航栏，白底、下边框 #d0d7de、padding 12px 24px，含品牌名(18px/700)、仓库切换下拉、设置/帮助按钮。`
3. `实现一个模态框，遮罩 rgba(31,35,40,.45)，内容白底圆角 10px max-width 540px 阴影 0 8px 24px rgba(0,0,0,.2)，标题 18px/600。`
4. `写一个搜索输入框，padding 7px 10px、边框 #d0d7de 圆角 6px，focus 时 outline 2px #ddf4ff + 边框变 #0969da。`
5. `生成标签 chip，圆角 999px、1px #d0d7de 边框、选中态背景用 color-mix(var(--tag-color) 12%, white)、文字 13px。`
6. `实现一个 toast 通知，固定在底部居中、背景 #1f2328 白字、圆角 8px、错误态背景 #d1242f。`

### Iteration Guide（迭代建议）
1. 改色前先确认新值已写入 §2 并绑定 CSS 变量，禁止硬编码散落。
2. 新增组件沿用既有 token（间距/圆角/阴影），不要为单组件发明新尺度。
3. 任何视觉改动同步更新 `css/style.css` 与本文档，保持单一事实源。
4. 保持 Light-first；如需暗色，先在 §2 增补 dark token 再实现，勿内联覆盖。
5. 优先用边框与留白分区，谨慎加阴影（alpha≤0.14 常规、≤0.2 仅 modal）。
6. 中文文案用系统字体栈，勿引入影响加载的 web font。
7. 焦点态不可省略（键盘可达性），统一 `outline:2px solid --blue-bg`。
8. 危险操作遵循"先置灰→红字确认"两步，避免误删。
9. 响应式仅断点 720px；移动端靠 flex-wrap 与 padding 收缩，不做字号缩放。
10. 交付前用 §7 Do's/Don'ts 自检，确保无装饰性渐变/毛玻璃/发光。
