# Issues 平台对比：GitHub / Gitea / GitLab

> 目的：为 TodoDashboard（每条待办 = 一个 Issue）评估三平台的 Issues 能力与 API 差异，给后续 GitLab provider 接入提供决策依据。
>
> 数据来源：GitHub REST/GraphQL 官方文档、Gitea 1.27 OpenAPI、GitLab 17.x API 文档（截至 2026-09）。

---

## 一、总览

| 维度 | GitHub | Gitea | GitLab |
|---|---|---|---|
| 定位 | 托管 SaaS + Enterprise，生态最大 | 轻量自托管单二进制（Go） | 一体化 DevOps 平台（CE 免费，EE 付费） |
| API 风格 | REST v3 + GraphQL v4（成熟） | **仅 REST** `/api/v1`（OpenAPI/Swagger 完整，**无 GraphQL**） | REST v4 + GraphQL（13+ 成熟） |
| 命名空间 | 单层 `owner/repo` | 单层 `owner/repo` | **多级** `group/subgroup/project` |
| Issue 标识 | 全局 `id` + repo 内 `number` + GraphQL `node_id` | 全局 `id` + repo 内 `number`（也叫 `index`） | 全局 `id` + project 内 `iid` |
| 状态机 | `open` / `closed`（+`state_reason`：`not_planned` / `reopened` / `completed`） | `open` / `closed` | `opened` / `closed`（独立维度 `confidential` 机密） |
| 认证 | `Authorization: Bearer <PAT>`（classic 或 fine-grained） | `Authorization: token <tok>` / BasicAuth / `?token=` query | `PRIVATE-TOKEN: <tok>` header / OAuth |
| 分页 | `page`/`per_page`（max 100）；GraphQL 用 Relay cursor | `page`(1-based)/`limit` | `page`/`per_page`；高级接口支持 keyset |
| 搜索 | `/search/issues` 跨仓库（GraphQL 更强） | `/repos/issues/search` 跨仓库 | 全局 `/issues` + GraphQL `search` |

> **结论**：GitHub 和 GitLab 都是 GraphQL + REST 双栈；Gitea 只走 REST。这意味着 TodoDashboard 的 `api.js` 必须按 provider 分支：GitHub/GitLab 可以用 GraphQL 单 query 拿 list+label，Gitea 必须 REST 多端点拼装。

---

## 二、Issues 核心字段对比

| 能力 | GitHub | Gitea | GitLab |
|---|---|---|---|
| 标题/正文 | `title` / `body` | `title` / `body` | `title` / `description` |
| 状态 | `open` / `closed` | `open` / `closed` | `opened` / `closed` + `confidential` |
| 标签 | ✅ 仓库级 | ✅ 仓库级（`exclusive`/`is_archived`） | ✅ 项目级；**写入时标签不存在会自动创建** |
| 里程碑 | ✅ 单一 | ✅ 单一 | ✅ 单一（支持组级 milestone） |
| 负责人 | ✅ 多人 assignees | ✅ 多人 assignees | ✅ 多人（**Premium+**，CE 仅单人） |
| 截止日期 | ❌ | ✅ `deadline`（原生） | ✅ `due_date`（原生） |
| 评论 | ✅ | ✅（支持附件 attachments） | ✅ notes（可加 award emoji） |
| 反应 | ✅ reactions | ✅ reactions | ✅ award_emoji |
| 置顶 | ✅ pinned comment | ✅ `pin` 端点 | ❌ |
| 锁定 | ✅ `locked` | ✅ `lock` 端点 | ✅ `discussion_locked` |
| 父子/依赖 | ✅ sub-issues（2025-09 GA） | ✅ `blocks` / `dependencies` | ✅ linked issues |
| 工时 | ❌ | ✅ stopwatch / times | ✅ time_stats |
| 特殊类型 | ✅ issue types、issue field values（org 级） | — | ✅ `issue_type` = issue/incident/test_case/task |
| 机密 | ❌ | ❌ | ✅ confidential |
| 高阶（付费） | Projects、迭代 | — | epic、weight、health_status、iterations |

### 一句话总结
- **GitLab 字段最"重"**——敏捷/DevOps 全栈，但高级字段锁 Premium/Ultimate。
- **Gitea 字段最"实用"**——原生 deadline / 依赖 / 工时，恰好覆盖待办场景刚需。
- **GitHub 字段最"克制"**——靠 Projects + 自定义字段补齐。

---

## 三、API 端点对比

### 3.1 列表 / 读取

| 场景 | GitHub | Gitea | GitLab |
|---|---|---|---|
| 列出 issue | `GET /repos/{owner}/{repo}/issues` | `GET /repos/{owner}/{repo}/issues` | `GET /projects/:id/issues` |
| 跨仓库搜索 | `GET /search/issues` | `GET /repos/issues/search` | 全局 `GET /issues` |
| 单 issue | `GET /repos/{owner}/{repo}/issues/{number}` | `GET /repos/{owner}/{repo}/issues/{index}` | `GET /projects/:id/issues/:iid` |
| 评论列表 | `GET /repos/{o}/{r}/issues/{n}/comments` | `GET /repos/{o}/{r}/issues/{i}/comments` | `GET /projects/:id/issues/:iid/notes` |
| 标签列表 | `GET /repos/{o}/{r}/labels` | `GET /repos/{o}/{r}/labels` | `GET /projects/:id/labels` |

### 3.2 写入

| 场景 | GitHub | Gitea | GitLab |
|---|---|---|---|
| 创建 | `POST /repos/{o}/{r}/issues` | `POST /repos/{o}/{r}/issues` | `POST /projects/:id/issues` |
| 更新 | `PATCH /repos/{o}/{r}/issues/{n}` | `PATCH /repos/{o}/{r}/issues/{i}` | `PUT /projects/:id/issues/:iid` |
| 关闭 | `PATCH ... {state: "closed"}` | `PATCH ... {state: "closed"}` | `PUT ... {state_event: "close"}` |
| 加标签（增量） | `POST /repos/{o}/{r}/issues/{n}/labels` | `POST /repos/{o}/{r}/issues/{i}/labels` | `PUT ... {add_labels: "..."}` |
| 替换全部标签 | `PUT /repos/{o}/{r}/issues/{n}/labels` | `PUT /repos/{o}/{r}/issues/{i}/labels` | `PUT ... {labels: "..."}` |
| 删除 issue | ❌（仅 close） | `DELETE /repos/{o}/{r}/issues/{i}` | `DELETE /projects/:id/issues/:iid` |

### 3.3 标识符 / 路径编码

| 平台 | `:id` 取值 | 标识符语义 |
|---|---|---|
| GitHub | `owner/repo`（字符串） | `number`：repo 内递增；`node_id`：GraphQL 全局；`id`：REST 全局整数 |
| Gitea | `owner/repo`（字符串） | `number` = `index`：repo 内递增；`id`：全局整数 |
| GitLab | **整数 id 或 URL-encoded 完整路径**（如 `group%2Fsub%2Fproject%2Fsub2%2Fproj`） | `iid`：project 内递增；`id`：全局整数 |

> **GitLab 的多级路径必须 URL-encode**（`/` → `%2F`），否则 404。TodoDashboard 的 `repos[i].path` 字段如果接 GitLab，必须接受完整路径字符串并在请求时 encode。

---

## 四、关键差异与陷阱

### 4.1 GraphQL 可用性 → 决定 api.js 分支策略

| 平台 | GraphQL | 备注 |
|---|---|---|
| GitHub | ✅ | 官方推荐 GraphQL，速率上限更高，复杂查询一次完成 |
| GitLab | ✅ | 13+ 稳定，可覆盖 Issue 全字段 |
| Gitea | ❌ | 社区明确无 GraphQL 支持（[Sveltia CMS 等多家第三方确认](https://sveltiacms.app/en/docs/backends/gitea-forgejo)），只能 REST |

### 4.2 命名空间多级（GitLab 独有）

GitLab 的 `group/subgroup/project` 多级路径直接决定 ID 编码方式：
- `:id` 可以是数字（项目级）或 URL-encoded 完整路径（推荐，便于用户配置）。
- 用户在 TodoDashboard 配置 GitLab 仓库时，输入的不是 `owner/repo`，而是 `group/sub/project`，前端存储后请求时统一 `encodeURIComponent`。

### 4.3 标签写入的"自动创建"行为（GitLab 陷阱）

| 平台 | 标签不存在时 |
|---|---|
| GitHub | 静默丢弃，写入无效 |
| Gitea | 静默丢弃，写入无效 |
| GitLab | **自动创建并应用**——拼写错误会"静默成功"生成新标签 |

→ TodoDashboard 的"标签驱动进度/归档"逻辑如果迁移到 GitLab，必须做**白名单校验**或预建标签，否则一个拼错字符的标签就会变成长期残留。

### 4.4 多人 assignees 的付费墙

| 平台 | 多人 assignees |
|---|---|
| GitHub | ✅ 全版本 |
| Gitea | ✅ 全版本 |
| GitLab CE | ❌ 仅单人（assignee_id） |
| GitLab Premium+ | ✅ assignee_ids 数组 |

→ 如果 TodoDashboard 要给所有 GitLab CE 用户提供"指派多人"，需要降级为单人 + 标签模拟（如 `@alice @bob`）。

### 4.5 状态命名差异

| 平台 | open 值 | closed 值 |
|---|---|---|
| GitHub | `open` | `closed`（+ `state_reason`） |
| Gitea | `open` | `closed` |
| GitLab | `opened` ⚠️ | `closed` |

→ GitLab 的 "open" 是 **`opened`**（带 `-ed` 后缀），这是 90% 跨平台迁移踩坑点。TodoDashboard 当前的"open↔closed"映射需要在 GitLab provider 里硬编码重写。

### 4.6 列表默认过滤机密 issue

- GitLab 默认 **不返回 `confidential: true` 的 issue**。
- TodoDashboard 当前 model 是按 `state` 拉取，GitLab 上需要显式 `confidential=true`（除非用户开启"显示机密任务"开关）。

---

## 五、对 TodoDashboard 项目的直接影响

| 项目现况 | 三平台对比启示 |
|---|---|
| 已支持 GitHub GraphQL + Gitea REST | GitLab 也走 GraphQL 分支（统一抽象层），Gitea 维持 REST 分支即可 |
| `repos[i].provider` / `baseUrl` | 新增 `gitlab` provider 选项；`repos[i].path` 在 GitLab 上允许多级路径 |
| "完成 = CLOSED" 映射 | GitHub/Gitea 一致，GitLab 需要 `opened→open` 归一化 |
| "进度/归档" 标签驱动 | 全平台通用，但 GitLab 加白名单校验避免自动创建陷阱 |
| `useProgress` per-repo | 与平台无关，继续保留 |
| 本地优先 + 5min debounce | 平台无关，继续保留 |

---

## 六、参考链接

- GitHub REST: <https://docs.github.com/rest/issues/issues>
- GitHub GraphQL: <https://docs.github.com/en/graphql>
- GitHub Sub-issues 公告: <https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/>
- Gitea API 1.27: <https://docs.gitea.cn/api>
- Gitea Issue 端点索引: <https://docs.gitea.com/api/operations/tags/issue/>
- GitLab Issues REST: <https://docs.gitlab.com/api/issues/>
- GitLab GraphQL: <https://docs.gitlab.com/api/graphql/>