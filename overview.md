# 概览：响应式改造 + 生产级构建流水线

## 完成内容

1. **响应式页面改造**（`css/style.css`）
   - 将原本仅 6 行的 `@media (max-width:720px)` 扩展为完整响应式方案：顶栏移动端取消吸顶并纵向堆叠、筛选/搜索/新建按钮全宽、输入框全宽、卡片操作按钮换行居右、模态框在窄屏占满。
   - 新增 `@media (max-width:480px)` 超小屏微调与 `@media print` 打印样式。
   - 桌面布局完全不动（仅改断点内规则）。

2. **生产级打包流水线**
   - 新增 `package.json`（`build` / `test` / `serve` 脚本，不启用 `type:module` 以兼容 CommonJS 测试）。
   - 新增 `build.mjs`：esbuild 按加载顺序合并 4 个 JS（**保留全局作用域、不包裹 IIFE**）→ minify；CSS minify；文件名带 **内容 hash** 实现缓存可控；生成 `dist/index.html` 并自动改写引用。
   - 实测产物：请求数 6→3，JS 72.5 KB→48.7 KB（-32.9%），gzip 传输约 -22%；顶层全局符号（`connect`/`state`/`APP_CONFIG`/`flush`/`renderAppState`）全部保留，3 个测试套件全绿。

3. **部署升级**（`pages.yml`）
   - 重写为「构建 + 部署」两段式 Actions：`npm ci` → `npm run build` → 上传 `dist/` → 发布。源码与产物解耦，根治双源维护风险。
   - 新增 `.gitignore`（忽略 `node_modules/`、`dist/`，保留 `package-lock.json`）。

4. **文档同步**（项目约定）
   - 更新 `index.html` 的 `#helpModal` 部署说明与 `README.md` 的部署章节，反映「先构建、部署 `dist/`」流程。
   - 新增 `DEPLOY-GUIDE.md` 生产部署清单（构建自查 / 上线 / 验证 / 回滚 / 排查）。

## 验证证据
- `node build.mjs` 成功产出 `dist/`（3 文件，带 hash）。
- `node --check dist/app.min.*.js` 语法通过；grep 确认全局符号保留。
- `npm test` 三个套件全部 PASS，退出码 0。

## 后续建议
- 如需线上可排错，可在 `build.mjs` 加 `sourcemap: true`（零运行时成本）。
- 若追求极致首屏，可考虑关键 CSS 内联（当前选择不外联内联，因帮助文档占 HTML 大头）。
- 每次功能改动后务必同步 `#helpModal` 并重新 `npm run build`。
