# 发布规范（RELEASE-GUIDE）

> 适用范围：TodoDashboard 仓库（远端 `origin` = GitHub，GitHub Pages 静态部署）
> 版本：v1 · 2026-09-11 ｜ 基线：master = `e9955eb`（与 origin/master 一致，仓库当前 **0 个 tag**）
> 配套：`DEPLOY-GUIDE.md`（部署实现）、`BUILD-ANALYSIS.md`（构建策略）、`index.html #helpModal`（用户功能文档）
> 数据分级：【实测】= git / 命令输出；【建议】= 本规范约定；【可选】= 按需启用

---

## 〇、一句话模型

> **不稳定的开发永远发生在短命特性分支上；主干始终保持"可发布"；只有打过 tag 的发行版才会出现在线上。**

发布 = 对某个**已验证的主干提交**打上**不可变的版本标签**，并把该标签的构建产物送到生产。发布不是一次 `git push`，而是一个有版本号、有说明、可回滚的承诺。

---

## 一、目标与约束

**目标（用户诉求）**：从不稳定的需求开发分支中，持续发布稳定的发行版。

由此推出三条硬约束：

| # | 约束 | 含义 |
|---|---|---|
| C1 | 线上永远稳定 | 未验证的代码不得以任何路径出现在生产站点 |
| C2 | 发布可复现 | 同一个 tag，任何时候构建出同一份产物 |
| C3 | 发布可回滚 | 出问题时能在分钟级回到上一个稳定版，且不回退历史 |

---

## 二、前置：分支模型（发布的地基）

| 角色 | 分支 | 稳定性 | 生命周期与说明 |
|---|---|---|---|
| 开发 | `feat/` `fix/` `refactor/` `style/` | **不稳定** | 短命；内部可随意迭代；验证后经 PR（merge commit）合入主干，合入即删 |
| 主干 | `master` | **始终可发布** | 只接受 PR 合入；每次合入都必须通过 `npm test` + `npm run build` |
| 稳定化 | `release/x.y` | 冻结 | 【可选】需要多版本线维护或专门 QA 冻结时才建，短命；单人单线项目**不需要** |
| 应急 | `hotfix/<主题>` | 应急 | 从**出问题的 tag** 切出，最小修复后回主干 |

一句话：**不稳定隔离在特性分支，稳定由主干保证，发布由 tag 固化。**

> 关键点：主干不是"开发分支"，而是"集成 + 发布基线"。特性分支再怎么乱，都不会直接影响线上——这就是"从不稳定中产出稳定"的机制来源。

> **合入方式（2026-09-17 澄清）**：本项目采用 **merge commit**，**不用 squash**。依据（实测）：master 上历史 PR 的合并提交（#14 `e9955eb` / #16 `6eaa80f` / #17 `a3151bc` / #18 `f7252e6` / #19 `1267063`）**全部是双父的真合并提交**，分支内的分阶段提交与提交信息完整保留。本文件此前的"squash"表述与仓库实际历史不符，已统一更正。**合入即删分支**的要求不变。

---

## 三、版本号策略（SemVer）

版本形如 `MAJOR.MINOR.PATCH`。

- **唯一版本源**：`package.json` 的 `version` 字段
- **标签名**：`v` + 版本号（如 `v1.1.0`）
- **存放位置**：tag 打在 master 上那个"已验证的提交"

| 位 | 何时 +1 | 本项目典型场景 |
|---|---|---|
| **MAJOR** | 破坏性变更（不兼容） | **localStorage 数据结构 / 存储键变更**（README 已有的「存储键 v1.0 切换计划」就是典型 MAJOR）——必须附数据迁移逻辑与帮助文档说明 |
| **MINOR** | 向后兼容的新能力 | 新增视图（如路线图中的「本周视图」）、新增/增强 provider（Gitea）、新的筛选与标签能力 |
| **PATCH** | 向后兼容的修复 | 401/403 提示、移动端体验修复、样式微调、构建与部署修复 |

**预发布标签**：`vX.Y.Z-rc.N`（候选版，用于冻结验证）、`vX.Y.Z-beta.N`。

**版本红线**：

1. 版本号**只升不降**
2. tag **不可变**——发错就发一个新的 PATCH，**绝不移动、重打或删除已发布 tag**
3. 破坏性变更不得"悄悄发"——MAJOR 必须配套迁移说明

【实测】仓库当前 `0` 个 tag、`package.json` = `1.0.0`。
【建议】把 **`v1.0.0` 打在 master `e9955eb`**，作为「已知稳定起点」——从此所有发布都有可比较的基线。

---

## 四、发布模型：两条车道

### 4.1 车道 A · 常规发布（推荐"小步快跑"）

**触发条件**（满足其一即可）：

- master 上积累了若干可用主题（建议 1~5 个，视粒度而定）
- 到达既定节奏（例如每两周）
- 某个里程碑完成（例如"本周视图"上线）

**流程（9 步）**：

| 步 | 动作 | 命令 / 要点 |
|---|---|---|
| 1 | **冻结检查** | `master` 工作树干净；无未合入的"发布阻断"PR |
| 2 | **同步主干** | `git fetch -p && git checkout master && git merge --ff-only origin/master` |
| 3 | **验证** | `npm ci && npm test && npm run build`（CI 跑同一套，本地先过一遍） |
| 4 | **定版** | 按 §3 确定 `X.Y.Z`；更新 `package.json` + `CHANGELOG.md` |
| 5 | **定版提交** | 走 PR（`chore/release-x.y.z`）→ **merge 合入 master** |
| 6 | **打标签** | `git tag -a vX.Y.Z -m "..."` → `git push origin vX.Y.Z` |
| 7 | **发布 Release** | GitHub Release，正文 = CHANGELOG 对应段落（或自动生成） |
| 8 | **部署** | 由 **tag 触发**的 Actions 构建并发布到 Pages（见 §6） |
| 9 | **冒烟验收** | 桌面 / 平板 / 手机三档宽度 + 核心链路（新建/完成/进度/标签/筛选/同步） |

> **为什么"改版本号"也要走 PR**：master 是发布基线，落在它上面的每一个提交都应有评审与验证记录。版本号变更是代码的一部分，不能"顺手直接改主干"。

### 4.2 车道 B · 热修复（Hotfix）

**触发**：线上已发布版本出现必须立即修复的缺陷。

| 步 | 动作 |
|---|---|
| 1 | 从**出问题的 tag** 切分支：`git checkout -b hotfix/<主题> vX.Y.Z`（保证基线就是线上代码） |
| 2 | 最小修复 + 补测试（只修问题，**不得夹带新功能**） |
| 3 | `npm test && npm run build` 验证 |
| 4 | PR 到 `master` → merge 合入 |
| 5 | 按 **PATCH** 定版 → 打 tag → 触发部署 |
| 6 | 若同时维护多条版本线，再 `git cherry-pick` 到对应 `release/x.y` 并补 tag |

### 4.3 版本线维护（【可选】）

只有当"线上存在**多个**仍需修复的旧版本"时，才需要长期 `release/x.y` 分支。
单线产品（本项目现状）**不需要**：hotfix 直接基于 master 发 PATCH，最省心。

---

## 五、变更日志（CHANGELOG）

- **文件**：`CHANGELOG.md`（根目录，Keep a Changelog 结构：`Added` / `Changed` / `Fixed` / `Removed` / `Security`）
- **粒度**：面向使用者与集成者，讲"变化了什么能力"，不逐条抄提交
- **来源**：Conventional Commits 类型映射——`feat → Added`、`fix → Fixed`、`refactor/style → Changed`
- **时机**：在 `chore(release)` PR 中一次整理完成，**不得事后补**
- **最低要求**：即使暂不建 `CHANGELOG.md`，GitHub Release 说明也必须写，且内容与本次 tag 严格对应

---

## 六、部署与发布的关系（本规范最关键的一处改动）

### 6.1 现状与冲突【实测】

- `DEPLOY-GUIDE.md` 提供两种方式：**A** 从分支直部署（推含 `dist/` 的分支）；**B** Actions 自动构建
- `.github/workflows_example/pages.example.yml` 的触发条件是 `push: branches: [main, master]`

→ **冲突**：两种方式都是"一合入 master 就上线"。而 master 可能刚合入尚未充分验证的内容，**与"线上永远是稳定发行版"直接矛盾**，也与本规范 C1 冲突。

### 6.2 建议：部署触发从「分支」改为「标签」

```yaml
on:
  push:
    tags: ['v*.*.*']      # 只有打 tag 才上线
  workflow_dispatch:      # 回滚 / 重发：可指定任意历史 tag
```

**效果**：

| 收益 | 说明 |
|---|---|
| 合入 ≠ 上线 | master 可以保持领先（集成最新已验证工作），线上只跟最新稳定 tag |
| 可复现 | 线上产物恒定来自某个 tag 的构建，来源可追溯 |
| 可回滚 | `workflow_dispatch` 选上一个稳定 tag 重跑即可（分钟级） |

> GitHub Pages 一个仓库只有**一套**站点，无法承载"预览环境"。若确需"每次合入即可预览"，请另建预览通道（如 Cloudflare Pages / Netlify），但**正式站点只跟 tag**。

### 6.3 回滚策略

| 方式 | 场景 | 做法 |
|---|---|---|
| 重部署旧 tag（首选） | 新版有严重问题，先恢复服务 | Actions → Run workflow → tag 填上一个稳定版本 |
| `git revert` + 发新 PATCH（次选） | 需要留痕、根治问题 | revert 问题提交 → 走 PATCH 发布流程 |
| **禁止** | —— | 移动 / 重打 / 删除已发布 tag |

---

## 七、CI 工作流建议

| 工作流 | 触发 | 内容 | 状态 |
|---|---|---|---|
| `ci.yml` | PR + push master | `npm ci` → `npm test` → `npm run build` | 【建议】P1 |
| `release.yml` | push tag `v*.*.*` / 手动 | 构建 → 建 GitHub Release → 部署 Pages | 【建议】P1（**替代**现 pages 示例） |
| `pages.example.yml` | push master | 构建 → 部署 Pages | 【现状】与稳定发布冲突，建议**停用或改造为 tag 触发** |

### 附：`release.yml` 参考模板

```yaml
name: Release & Deploy

on:
  push:
    tags: ['v*.*.*']
  workflow_dispatch:
    inputs:
      tag:
        description: '要重新部署的 tag（回滚用）'
        required: true

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.inputs.tag || github.ref }}
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Test
        run: npm test
      - name: Build
        run: npm run build
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'
      - name: Create GitHub Release
        if: github.event_name == 'push'
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true

  deploy:
    needs: build
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

---

## 八、发布检查清单（每次发布逐条勾选）

- [ ] `master` 与 `origin/master` 一致，工作树干净
- [ ] `npm ci && npm test && npm run build` 全绿
- [ ] 若涉及 localStorage 结构变更 → 已附数据迁移 + 已按 MAJOR 递增 + 帮助文档已说明
- [ ] 用户可见变更已同步 `index.html #helpModal`
- [ ] `package.json` 的 `version` 已按 §3 正确递增
- [ ] `CHANGELOG.md` / Release 说明已整理
- [ ] tag 名 = `vX.Y.Z`，指向已验证的提交
- [ ] GitHub Release 已创建
- [ ] 线上验收：三档宽度 + 核心链路 + 硬刷新确认加载了新 hash 资源
- [ ] 回滚方案已确认（"上一个稳定 tag = ______"）

---

## 九、发布红线

1. **不从未验证的分支发布**——feat/hotfix 必须先 PR 合入 master
2. **不移动、重打、删除已发布 tag**
3. **不在 master 上直接改文件后打 tag**——先走 PR
4. **不在未跑 `npm test` 的情况下发布**
5. **不在无 CHANGELOG / Release 说明的情况下发布**
6. **不把"部署"当成"发布"**——部署是一个动作，发布是一个有版本号的承诺

---

## 十、常用命令速查

```bash
# 发布前同步与验证
git fetch -p && git checkout master && git merge --ff-only origin/master
npm ci && npm test && npm run build

# 打标签并推送（tag 推送即触发发布流水线）
git tag -a v1.1.0 -m "v1.1.0: 本周视图 + 移动端体验修复"
git push origin v1.1.0

# 查看版本线
git tag -l --sort=-v:refname | head
git describe --tags --abbrev=0

# 回滚（部署层：GitHub → Actions → Release & Deploy → Run workflow → 填旧 tag）
# 回滚（代码层）
git revert <sha>        # 然后按 PATCH 发新版
```

---

## 十一、决策记录（待拍板）

| # | 决策点 | 建议 | 状态 |
|---|---|---|---|
| R1 | 版本方案 | SemVer；tag = `vX.Y.Z`；唯一版本源 = `package.json` | ⏸ 待确认 |
| R2 | 发布粒度 | 小步快跑：每个可用主题合入后可独立发布 | ⏸ 待确认 |
| R3 | **部署触发** | **改为 tag 触发**（合入 master ≠ 上线） | ⏸ 待确认（需改造现 `pages.example.yml`） |
| R4 | 长期 release 分支 | 不设；hotfix 走 master 发 PATCH | ⏸ 待确认 |
| R5 | 首个 tag | `v1.0.0` 打在 master `e9955eb` | ⏸ 待确认 |
| R6 | `CHANGELOG.md` | 引入（Keep a Changelog 格式） | ⏸ 待确认 |

---

## 十二、落地路线（确认后执行）

| 阶段 | 内容 |
|---|---|
| **P0** | 确认 R1–R6 → 打首个 tag `v1.0.0` → 建 `CHANGELOG.md` 并回填 1.0.0 段 |
| **P1** | 新增 `ci.yml`；新增 `release.yml`（tag 触发）；停用/改造 `pages.example.yml`；同步 `DEPLOY-GUIDE.md` 的部署触发说明 |
| **P2** | master 分支保护（Require PR + 状态检查）；发布 runbook 固化为 checklist 模板；如需预览通道，接第二个托管目标 |
