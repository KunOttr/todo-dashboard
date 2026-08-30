# 生产级部署指南（TodoDashboard · 代码仓库 Issue 待办面板）

> 适用：本仓库已接入 esbuild 合并压缩流水线；GitHub Pages 部署支持「分支直部署」与「Actions 自动构建（示例）」两种方式，**任选其一，不强制使用 workflow**。
> 部署单元是 `dist/`，**源码永不直上线**。

## 一、本地构建与自查（每次改动后必做）

```bash
npm install        # 首次或依赖变更时；会生成/更新 package-lock.json（必须提交）
npm run build      # 产出 dist/：index.html + style.min.<hash>.css + app.min.<hash>.js
npm test           # 3 个测试套件：integration / api-github / api-gitea，必须全绿
npm run serve      # 构建后用静态服务器本地预览 dist/，肉眼验收响应式与功能
```

验证清单：
- [ ] `dist/` 下恰好 3 个文件，且资源名带 8 位 hash
- [ ] `dist/index.html` 仅引用 1 个 CSS + 1 个 JS（原为 1 CSS + 4 JS）
- [ ] `npm test` 退出码为 0
- [ ] 功能改完后已同步更新 `index.html` 的 `#helpModal` 帮助文档，并**重新 `npm run build`**

## 二、部署到 GitHub Pages

### 方式 A：从分支直接部署（推荐，零依赖）

1. 本地构建并提交产物：
   ```bash
   npm run build
   git add -f dist/ && git commit -m "build: 提交 dist 产物" && git push
   ```
   > `dist/` 在 `.gitignore` 中，需 `git add -f` 强制提交；每次改动源码后都要重新构建并提交，否则上线旧产物。
2. 仓库 **Settings → Pages → Source** 选择 **Deploy from a branch**，指向含 `dist/` 的分支与 `/dist` 目录。
3. 访问 `https://<用户名>.github.io/<仓库名>/`。

### 方式 B：Actions 自动构建（可选示例，不强制）

仓库提供了 `.github/workflows/pages.example.yml` 作为 Actions 自动构建的示例模板（`npm ci` → `npm run build` → 上传 `dist/` → 发布），默认**不启用**（`.example.yml` 后缀不会被 GitHub 识别）：

1. 启用：把 `.github/workflows/pages.example.yml` **重命名为 `pages.yml`** 并推送（**含 `package-lock.json`**）到 `main` / `master`。
2. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。
3. 工作流自动执行并发布；触发时机：push 到 `main`/`master`、PR 合并进主分支、`Actions` 页手动 `Run workflow`。
4. 稍候在 **Actions** 页查看运行日志，绿色对勾即发布成功。

> 两种方式任选其一。方式 B 的优点是源码与产物解耦，从机制上杜绝「改了源码却忘了重新构建 → 上线旧代码」的双源维护风险；不熟悉 Actions 的用户推荐用方式 A。`dist/`、`node_modules/` 已在 `.gitignore` 忽略；使用方式 B 时 `package-lock.json` 必须提交，否则 `npm ci` 失败。

## 三、验证上线正确

- [ ] 页面可打开，控制台无报错；用 DevTools 网络面板确认加载的是 `app.min.<hash>.js` / `style.min.<hash>.css`
- [ ] 桌面（≥980px）、平板（~720px）、手机（≤480px）三种宽度下布局正常、按钮可点
- [ ] 连接一个测试仓库，新建/完成/百分比/标签/筛选/同步全链路跑通
- [ ] 硬刷新一次：因文件名带 hash，旧缓存不会误命中

## 四、回滚

- **代码回滚**：`git revert <问题提交>` 或 `git push` 上一个好版本，Actions 自动重新构建发布。
- **紧急回退版本**：GitHub 仓库 **Settings → Pages** 可查看部署历史并重新激活某次部署（若 Actions 环境保留）。
- **本地对比**：需要核验线上产物时，本地 `npm run build` 后 `npm run serve` 对照即可。

## 五、体积与性能收益（实测）

| 指标 | 改前（源码直部署） | 改后（dist 产物） | 变化 |
| --- | --- | --- | --- |
| 请求数 | 6（html+css+4js） | 3（html+css+1js） | **-3 请求** |
| JS 体积 | 72.5 KB | 48.7 KB（minify） | **-32.9%** |
| 传输量（GitHub Pages gzip） | ~29.6 KB | ~22.9 KB | **-22%** |
| 缓存策略 | 无 | 文件名内容 hash，内容不变永久命中缓存 | 更优 |

## 六、常见失败与排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Actions 红色：`npm ci` 报错 | 缺 `package-lock.json` 或锁文件过期 | 本地 `npm install` 后提交锁文件 |
| 页面空白 / 控制台 404 | `dist/` 未生成或 index.html 引用错 | 本地 `npm run build` 看是否有报错，检查 `dist/index.html` 资源引用 |
| 上线的是旧代码 | 推了源码但 CI 构建失败、或分支直部署时忘了重新构建 | 方式 B：确认 Pages Source 已切到 **GitHub Actions**、查 Actions 日志；方式 A：重新 `npm run build` 后重提 `dist/` |
| 样式错乱 | CSS minify 异常（极罕见） | 本地 `npm run serve` 复现，临时加 `minify:false` 排查 |
| 改了功能帮助文档没更新 | 忘记同步 `#helpModal` | 改完功能后务必更新帮助文档并重新 `npm run build` |
