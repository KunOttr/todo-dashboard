# TodoDashboard

一个纯前端、可直接部署到 **GitHub Pages** 的**代码仓库 Issue 待办管理面板**。所有数据都存在你自己的代码仓库里——每条待办就是一个 **Issue**，通过 **GitHub GraphQL / Gitea REST API** 读写，无需后端服务。不止 GitHub，也支持 Gitea（含自建实例），后续可扩展 Gitee、GitLab 等平台。

<img width="1277" height="574" alt="图片" src="https://github.com/user-attachments/assets/d2ce654a-bd40-443e-a215-3468767a8aaa" />


## 功能

- **状态管理**：待办分「未完成 / 已完成」两种状态，通过 Issue 的打开/关闭实现，可一键切换。
- **百分比进度（按仓库启用）**：添加/编辑仓库时可选择该仓库是否支持百分比；支持时新建待办可勾选「支持百分比」，该待办用**圆环进度**展示，点击圆环弹出**可滑动 range 进度条**（0%–100%，10% 步进）；百分比与完成标记整合——100% 自动完成，调低自动回到进行中。
- **内联编辑**：新建待办直接出现在「未完成」区域顶部的一张编辑卡片中，输入标题、描述、勾选百分比后点「保存」生效，点「取消」即丢弃；编辑已有待办时原卡片隐藏、仅显示编辑卡片（支持修改标题 / 描述 / 进度与「归档 / 删除」）。
- **双区展示**：未完成任务在上方（按创建时间倒序，最新在上）；已完成任务在下方（按完成时间倒序，最近完成在上）。
- **操作面板**：默认一行——左侧「筛选」按钮（展开/收起筛选选项）与「同步」按钮（有未同步改动时才显示），右侧「新建待办」；筛选选项（关键词、时间、标签、「显示归档」）点击「筛选」后展开，与上方操作面板以虚线分隔。
- **标签筛选**：下拉多选框选择一个或多个标签，支持「任一 / 全部」两种匹配模式；两种状态的任务同时被筛选。
- **时间筛选**：可分别指定起始时间、结束时间（也可只填其一），并可选按「创建时间」或「完成时间」为依据。
- **关键词搜索**：按标题 / 描述 / 标签名包含关键词筛选。
- **多条件并存**：关键词、标签、时间、归档开关之间均为「与」关系，可任意组合。
- **归档机制**：带「归档」标签的任务默认隐藏，可通过「显示归档」开关查看；在标签筛选中选中「归档」时会联动打开显示开关。
- **多仓库支持**：设置中可维护多个仓库卡片（只读展示，编辑时展开为输入框），一键切换当前仓库；顶部下拉切换当前仓库（当前项以 ✓ 标记）。支持 **GitHub（GraphQL API）** 与 **Gitea（REST API）**，添加仓库时可选择 API 格式并粘贴自定义仓库 URL（含 Gitea 自建实例）。**GitHub 亦支持企业版**：Enterprise Cloud 与公开版共用端点，直接填 `https://github.com/owner/repo` 即可；自建 Enterprise Server 填 `https://<域名>/owner/repo` 即可，面板自动拼接 `/api/graphql` 作为 GraphQL 端点。
- **防限速自动同步**：所有操作先在本地生效并入队，**距最后一次操作 5 分钟**后自动调用 API 批量保存；「同步」按钮实时显示待同步数量与剩余倒计时，点击立即保存。

## 使用方式

### 1. 准备 Personal Access Token

访问 <https://github.com/settings/tokens> 创建令牌。**最小所需权限如下：**

#### 方式 ① Fine-grained PAT（推荐）

- **Repository access**：选择目标仓库（`Only select repositories`）。
- **Permissions**（仅需下表两项，其余保持默认）：

| 权限 | 级别 | 用途 |
| --- | --- | --- |
| `Metadata` | **Read**（自动附带，不可取消） | 读取仓库基本信息、仓库 ID、现有标签列表——一切查询的地基 |
| `Issues` | **Read and write** | **读**：列出/分页查询 Issues；**写**：创建、编辑、打开/关闭/重开、删除 Issue，以及给 Issue 增删标签、创建/删除标签 |

> 说明：
> - `Metadata: Read` 是 fine-grained PAT 的强制基线权限，创建令牌时自动勾选且无法去掉，无需手动配置。
> - Label（标签）的增删改属于 `Issues` 权限范畴，不需要单独的权限项。
> - 本应用只用到了 Issues 与 Metadata，**不需要** `Contents`、`Actions`、`Administration` 等任何仓库写权限——即使部署在 GitHub Pages 上，令牌也管不到你的代码。

#### 方式 ② 经典 PAT（classic）

经典令牌没有细粒度拆项，需按仓库可见性选择作用域：

| 作用域 | 何时需要 | 用途 |
| --- | --- | --- |
| `repo`（完整仓库权限） | 目标仓库为**私有**仓库 | 覆盖 Issues、Labels、Metadata 的全部读写 |
| `public_repo` | 目标仓库为**公开**仓库 | 公开仓库下访问 Issues/Labels 的最小集合 |

> `repo` 权限面较大，建议只对专用仓库使用，并妥善保管。

### 2. 打开页面并连接

1. 打开部署好的站点（或本地直接用浏览器打开 `index.html`）。
2. 点击右上角「设置」，点「+ 添加仓库」：选择 **API 格式**（GitHub GraphQL / Gitea REST），填写**仓库 URL**（如 `https://github.com/owner/repo` 或 `https://gitea.com/owner/repo`，自动识别 owner / 仓库名，Gitea 同步识别服务器地址；**自建 GitHub Enterprise Server** 填 `https://<域名>/owner/repo` 即可，面板自动拼接 `/api/graphql` 作为 GraphQL 端点）、**Token**，并勾选该仓库是否**支持百分比进度**，可先「测试」再「保存」；保存第一个仓库后会自动连接。
3. 首次连接会自动在仓库中创建系统标签：`归档`；该仓库开启「支持百分比进度」后自动创建 `进度:0%` ~ `进度:100%`。
4. 之后即可新建待办、切换完成状态、调整百分比、打标签、归档、删除。操作会先在本地生效，5 分钟（或点操作面板里的「同步」）后批量保存到对应代码仓库（GitHub / Gitea）。

### 3. Token 安全说明（请务必阅读）

本应用是**纯前端**方案，Token 不可避免要留在你的浏览器里，**无法做到**与传统后端代理（Token 只存服务器、前端永不知晓）同等的安全性。以下是当前实现的保障与边界：

> **加密存储**：Token 以 **AES-GCM 加密**后写入浏览器 `localStorage`，**不再明文落盘**；加密密钥默认只存放在 `sessionStorage`（标签页会话级，**关闭浏览器即失效**）。会话密钥丢失后旧密文无法解密，需在设置页重新输入各仓库 Token。
>
> **「记住 Token」选项**：设置页默认勾选。勾选时加密密钥会一并持久化到本设备，下次打开自动解密、无需重输；但此时密钥与密文同处浏览器存储，防护对象是「明文不被直接读取」，**防不住**能读取浏览器存储的恶意浏览器扩展 / 本地木马。
>
> **最高安全配置**：在设置页**取消勾选「记住 Token」**，关闭浏览器后密钥即销毁，重开需重新输入——适合共用电脑等高危场景。即使不勾选，也请在闲置时关闭浏览器标签页。
>
> **仍然无法防御**：能注入页面脚本的 XSS、恶意浏览器扩展、被攻陷的浏览器环境等，都可能拿到解密所需的密钥。请务必使用**权限最小化**的 Token（只授权目标仓库，见上文权限表）、尽量用**专用仓库**，并**避免在公共 / 共享设备**上使用本站点。
>
> **HTTPS 前提**：加密依赖浏览器 WebCrypto API，仅在 **HTTPS 或 localhost** 环境下可用；若以 `file://` 或裸 HTTP 打开，将退化为明文存储并在控制台打印警告。建议始终通过 HTTPS 部署访问。

设置页中 Token 输入框**不会回显已保存值**：编辑已有仓库时留空 Token 即保持不变，点击输入框会清空以便直接粘贴新值。

> Token 不会写入代码、不会上传到任何服务器，始终只存在于你自己的浏览器存储中。请使用权限最小化的令牌，并妥善保管。

### GitHub Enterprise 说明

- **Enterprise Cloud**（云企业版）：与公开版共用 GraphQL 端点（`api.github.com/graphql`），仓库 URL 直接填 `https://github.com/owner/repo` 即可，Token 使用企业账号在 GitHub 生成的 fine-grained PAT 或经典 PAT（权限要求同上文）。
- **自建 Enterprise Server**（GHES）：仓库 URL 填 `https://<你的域名>/owner/repo`，面板会自动把 GraphQL 端点识别为 `https://<你的域名>/api/graphql`；也可在仓库表单的「服务器地址」输入框手填 GHE 域名。
- Token 使用 GHES 管理员在服务器上创建的 personal access token，需具备目标仓库 Issues / Labels 的读写权限。
- **HTTPS 要求**：页面是 HTTPS 时，GHE 也必须是 HTTPS（浏览器会拦截 HTTP 接口，报 mixed block）；GHES 需配置 HTTPS 证书。
- 若 GHES 前面有反向代理（如 nginx），请确保代理正确透传 `/api/graphql` 路径且放行 CORS（GraphQL 为 POST + 自定义 `Authorization` 头，会触发预检）。

### Gitea 说明

- 支持 Gitea 官网（gitea.com）或任意自建 Gitea 实例；在仓库表单选择 **Gitea REST** 后，粘贴仓库 URL（或填写服务器地址 + owner / 仓库名）即可。
- Token 使用 Gitea 的 Access Token，需具备目标仓库的读写权限（Settings → Applications 创建）。
- 数据模型与 GitHub 一致：待办 = Issue，完成 = 关闭状态，进度 / 归档 = 标签。
- **自建 Gitea 需开启 CORS**：默认关闭跨域访问，前端浏览器请求会被预检（OPTIONS）拒绝。请编辑服务器 `app.ini`，在 `[cors]` 段设置：
  ```ini
  [cors]
  ENABLED = true
  ALLOW_DOMAIN = *
  METHODS = GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS
  MAX_AGE = 10m
  ALLOW_CREDENTIALS = true
  ```
  修改后**重启 Gitea** 生效。否则连接会报「连接失败」。
  `ALLOW_DOMAIN` 按正则匹配请求的 Origin，可精确控制来源，例如局域网加指定域名：
  ```ini
  ALLOW_DOMAIN = 192.168.1.*, *.example.com
  ```
  > 排障提示：若预检（OPTIONS）返回 200 但真实请求仍报 CORS error，通常是 Origin 不匹配——预检通过但响应缺少 `Access-Control-Allow-Origin` 头。本地用 `http://localhost:端口` 或 `http://127.0.0.1:端口` 打开面板时，需把 `localhost, 127.0.0.1` 加入列表（`file://` 打开时 Origin 为 `null`，需额外加 `null`；部署在 GitHub Pages 时把 `用户名.github.io` 加入列表）。可在 DevTools → Network 里查看 OPTIONS 请求的 `Origin` 请求头确认。
  > **HTTPS 要求**：页面是 HTTPS 时，Gitea 也必须是 HTTPS（浏览器会拦截 HTTP 接口，报 mixed block）。GitHub Pages 部署的场景请为 Gitea 配置 HTTPS 并使用 `https://` 服务器地址。
  若 Gitea 前有反向代理（如 nginx），CORS 头可能由代理决定，需在代理层同步放行或透传。

### 4. 数据模型

| 待办概念 | 实现方式 |
| --- | --- |
| 待办本身 | 仓库中的 Issue |
| 已完成 / 未完成 | Issue 状态（CLOSED / OPEN），完成时间取 `closedAt` |
| 百分比支持标记 | 标签 `进度:X%`（0% 也是支持标记），10% 步进 |
| 标签 | 普通 Issue 标签 |
| 归档 | 特殊标签 `归档`（系统保留，不可删除） |
| 多仓库 | localStorage 中维护 `{repos[], activeIndex, rememberToken}` 列表，每个仓库独立记录 `useProgress`；Token 字段以 AES-GCM 密文保存；GitHub / Gitea 仓库均可带 `baseUrl`（Gitea 与自建 GHE 必填，公开版 GitHub 为空） |

> **存储键说明**：本应用的本地数据（配置、Token 密文、同步队列）存储在 `localStorage` 中，键以 `github-todo-*` 为前缀（沿用项目旧名，与 `package.json` 的 `name` 保持一致）。**v1.0 将正式切换为 `tododashboard-*`**，届时提供一次性迁移，不影响已有数据；在此之前请勿手动改动这些键。

> 关闭某仓库的「支持百分比进度」时（编辑当前活动仓库）会弹窗提示：该仓库进行中待办将回退为未完成状态并丢失完成进度；确认后批量移除所有百分比标签。

## 构建与部署

本项目采用 **esbuild 合并压缩** 的生产级打包：源码（4 个 JS + CSS）在构建期合并为 `dist/` 下的 3 个带内容 hash 的文件，**部署单元是 `dist/`，源码不直接上线**。

### 本地构建 / 预览

```bash
npm install        # 安装 esbuild（写入 package-lock.json，需提交以支持 CI 的 npm ci）
npm run build      # 产出 dist/（index.html + style.min.<hash>.css + app.min.<hash>.js）
npm test           # 跑 3 个测试套件（集成 / GitHub API / Gitea API）
npm run serve      # 构建后用静态服务器本地预览 dist/
```

> 改完功能/交互后，记得同步更新 `index.html` 中 `#helpModal` 的帮助文档，并重新 `npm run build` 再部署。

### 部署到 GitHub Pages

#### 方式 A：从分支直接部署（推荐，零依赖）

1. 手动 `npm run build`，确认 `dist/` 已生成（`index.html` + 带内容 hash 的 `style.min.*.css` / `app.min.*.js`，共 3 个文件）。
2. 提交 `dist/` 目录（`dist/` 默认在 `.gitignore` 中，需 `git add -f dist/` 强制提交），并推送到 `main` / `master`。
3. 仓库 **Settings → Pages → Source** 选择 **Deploy from a branch**，指向含 `dist/` 的分支与 `/dist` 目录。
4. 页面地址为 `https://<用户名>.github.io/<仓库名>/`。

> 注意：必须「先构建后提交」，改动源码后要重新 `npm run build` 再提交 `dist/`，否则上线的会是旧产物。

#### 方式 B：Actions 自动构建（可选示例）

仓库提供了 `.github/workflows/pages.example.yml` 作为 **Actions 自动构建** 的示例模板：逻辑为 `npm ci` → `npm run build` → 上传 `dist/` → 发布。它默认**不启用**（`.example.yml` 后缀不会被 GitHub 识别），需要时把该文件**重命名为 `pages.yml`** 再推送，工作流即可自动触发。

1. 重命名：`.github/workflows/pages.example.yml` → `.github/workflows/pages.yml`，推送代码到 `main` / `master`。
2. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。
3. 工作流自动触发并发布；也可在 **Actions** 页手动 `Run workflow`。

> 该方式让**源码与产物解耦**，杜绝「改了源码却忘了重新构建」导致上线旧代码的风险；`dist/` 与 `node_modules/` 已在 `.gitignore` 中（无需提交），但 `package-lock.json` 必须提交以确保 `npm ci` 可复现。**两种方式任选其一，不强制使用 workflow**；如不熟悉 Actions，推荐用方式 A。

## 筛选逻辑说明

- **多条件组合**：关键词、标签、时间、归档开关同时生效（与关系）。
- **多标签**：默认「任一」命中即通过；可切换为「全部」需同时命中。
- **时间筛选**：依据可选「创建时间」或「完成时间」；只填起始或只填结束均可用；按完成时间筛选时，未完成任务（无完成时间）会被排除。
- **归档联动**：选中标签筛选中「归档」时，「显示归档」开关会自动打开；取消选中后开关保留在用户手动设置的状态。

## 已知限制

- GitHub GraphQL API 有速率限制（取决于令牌类型），任务量极大时注意配额。
- Token 以 AES-GCM 加密存于浏览器本地；未勾选「记住 Token」时关闭浏览器后需重新输入，请勿在公共/共享设备上使用该站点。
- 若令牌缺少创建标签的权限，自动创建系统标签会失败，进度和归档功能将不可用，需到仓库手动创建或调整权限。
- 操作为**本地优先 + 延迟同步**：在 5 分钟自动保存之前关闭页面可能丢失未同步的修改，建议通过右上角「同步」按钮主动保存，或留意按钮上的待同步倒计时。
