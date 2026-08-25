# 最小化打包可行性分析报告

> 分析对象：GitHub Issues 待办管理面板（纯静态站点，GitHub Pages 部署）
> 分析日期：2026-08-22
> 方法：静态检查 + 运行时实测（语法校验、真实压缩、压缩产物跑通全部测试套件）

## 一、结论摘要（TL;DR）

**完全可行，且收益明确，无阻断性障碍。**

- 代码无第三方依赖、无 `eval` / 动态加载 / 内联事件绑定，打包无任何技术障碍；
- 实测：合并压缩后 **总量 103.6 KB → 76.3 KB（-26.4%）**，请求数 **6 → 3**；经 GitHub Pages 自动 gzip 后传输量 **28.9 KB → 22.4 KB**；
- 压缩产物已通过全部 3 个测试套件的等价性验证（集成 / GitHub API / Gitea API）；
- 推荐方案：**esbuild 合并 4 个 JS 为 1 个 + CSS 压缩**（保留全局作用域语义，不包裹 IIFE），部署方式建议从「分支直接部署」升级为「Actions 内构建后部署」，实现源码与产物解耦。

---

## 二、现状盘点

| 项 | 现状 |
| --- | --- |
| 技术栈 | 纯原生 JS（ES2015+），零 npm 依赖，无构建步骤 |
| 文件结构 | `index.html`(13 KB) + `css/style.css`(20.5 KB) + 4 个 JS 共 70.8 KB |
| JS 加载 | 4 个 `<script>` 按序加载（config → api → filters → app），全局作用域共享 |
| 外部依赖 | 仅浏览器原生 `fetch`（GitHub GraphQL / Gitea REST） |
| 部署方式 | 方式 A：分支直接部署（推荐）；方式 B：`.github/workflows/pages.example.yml`（可选示例，需重命名为 `pages.yml` 才启用） |
| 测试 | `test/` 3 个无依赖 Node 脚本（DOM/API 桩 + eval 注入源码） |

**关键事实**：`index.html` 无内联 `onclick`，所有交互均通过 `addEventListener` 绑定；JS 中无 `eval`/`new Function`/`document.write`/动态 `import`——合并压缩后不会产生任何失效引用。

---

## 三、实测数据（运行时验证，非估算）

### 3.1 语法校验

4 个 JS 文件全部通过 `node --check`（`config.js` / `api.js` / `filters.js` / `app.js`），源码本身无语法问题。

### 3.2 体积收益（esbuild minify，实测字节数）

| 资源 | 原始 | 压缩后 | 节省 | gzip 后 |
| --- | ---: | ---: | ---: | ---: |
| index.html | 12,985 B | 12,985 B（不压缩） | — | 4,776 B |
| css/style.css | 20,547 B | 16,402 B | **-20.2%** | 3,870 B |
| 4 个 JS（合并） | 72,531 B | 48,701 B | **-32.9%** | 14,293 B |
| **合计** | **106,063 B** | **78,088 B** | **-26.4%** | **22,939 B** |
| 请求数 | 6（html+css+4js） | 3（html+css+1js） | **-3 请求** | — |

> gzip 说明：GitHub Pages 默认启用 gzip。即使如此，minify 后仍比「仅靠 gzip 压缩原始文件」再省约 **22%** 传输量（原始 gzip 总 29,600 B vs 压缩后 gzip 总 22,939 B），同时减少 3 个网络请求与 3 次脚本解析开销。

### 3.3 功能等价性验证（关键证据）

把压缩产物喂入现有测试桩环境（eval 注入方式与源文件测试完全一致），**3 个测试套件全部通过**：

| 测试套件 | 验证内容 | 压缩版结果 |
| --- | --- | --- |
| `integration-test.js` | 队列/去重/乐观更新/flush/渲染逻辑 | ✅ ALL TESTS DONE |
| `api-github-test.js` | GitHub GraphQL 分支（查询/建/关/标签） | ✅ GITHUB TESTS DONE |
| `api-gitea-test.js` | Gitea REST 分支（含 CORS/混合内容提示） | ✅ GITEA TESTS DONE |

验证过程中发现并排除了一个「假故障」：集成测试的桩设计是**故意不加载 api.js**（API 层用桩替换），因此压缩版验证需保持与源文件测试**相同的源码组合**（config+filters+app 测逻辑、config+api 测 API），而非直接测全量产物——这是测试装配问题，与压缩本身无关。

---

## 四、打包方案对比

| 方案 | 做法 | 收益 | 代价 | 适用 |
| --- | --- | --- | --- | --- |
| **A. 仅压缩** | 4 个 JS 各自 minify + CSS 压缩，不合并 | 体积 -27%，请求数不变 | 改动最小，需更新引用 | 只想快速减重 |
| **B. 合并 + 压缩（推荐）** | 4 JS 合并为 1 个 `app.min.js` + CSS 压缩 | 体积 -26%，请求 6→3，解析 4→1 | 需维护构建脚本 | 一般发行部署 |
| **C. B + hash + sourcemap** | B 基础上文件名带内容 hash、生成 `.map` | 缓存可控、线上可排错 | 引用更新需自动化 | 正式发布 |
| **D. 全部内联** | CSS/JS 内联进 HTML | 请求 1 个 | 帮助文档占 HTML 大头，缓存失效 | ❌ 不推荐 |

### 关键决策：为什么合并时保留全局作用域（不包裹 IIFE）

esbuild 合并时默认会用 IIFE 包裹（更小约 7 KB），但**顶层函数/变量（`connect`、`state`、`APP_CONFIG` 等）将不再暴露到全局**。实测对比：

| 方式 | 体积 | 全局语义 | 现有测试可直接验证 | DevTools 调试 |
| --- | ---: | --- | --- | --- |
| 合并 + IIFE 包裹 | 41.6 KB | ❌ 丢失（外部不可见） | ❌ 需要额外适配 | ❌ |
| 合并 + 保留全局（默认） | 48.7 KB | ✅ 与源文件一致 | ✅ 直接通过 | ✅ |

本项目为自用工具、无第三方脚本依赖全局符号，**「保留全局」多出的 7 KB 换来了语义零变化、测试零适配、调试零障碍，明显更优**。

---

## 五、风险与注意事项（P0 / P1 / P2）

### P0 — 无阻断风险

代码干净（无 eval、无动态加载、无外部依赖），压缩不会引入功能性问题，已有运行时证据。

### P1 — 需要流程保障

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| **双源维护** | 源码与压缩产物并存时，改完源码忘记重新构建，部署的将是旧代码 | 构建纳入固定流程：`npm run build` 后必跑 `npm test`；或走 Actions 由 CI 构建，**源码永远不直接部署** |
| **测试验证** | 现有测试用 eval 读源文件路径，压缩产物需生成「同组合」变体才能验证 | 把压缩版验证脚本固化（见第六节步骤 3），纳入 `npm test` 流水线 |

### P2 — 体验与细节

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 帮助文档约定 | 项目约定「每次改动功能后同步更新 `#helpModal`」——压缩不改变该内容，但改完功能后需**重新构建再部署** | 在 README 或构建脚本注释中注明 |
| 调试困难 | 压缩后报错无行号可读 | 开发期始终用源文件；发行版可加 sourcemap（方案 C） |
| 缓存陈旧 | 合并文件不带 hash 时，升级后浏览器可能命中旧缓存 | 部署后强刷一次，或文件名带版本/hash（方案 C） |
| 分支部署与 Actions 并存 | 方式 A 直接部署目录，会把源码一起上线（无碍，但体积冗余）；两种方式只能保留一种 | 选定一种部署方式，README 已提示二选一（Actions 为可选示例，默认不启用） |

---

## 六、推荐实施路径（分阶段）

### 阶段 1：引入构建脚本（约 10 分钟）

```jsonc
// package.json（新增）
{
  "name": "github-todo",
  "private": true,
  "scripts": {
    "build": "node build.mjs",
    "test": "node test/integration-test.js && node test/api-github-test.js && node test/api-gitea-test.js"
  },
  "devDependencies": { "esbuild": "^0.2x" }
}
```

`build.mjs` 核心逻辑（已实测可行）：

```js
import esbuild from 'esbuild';
import fs from 'node:fs';

// 1) JS：按 index.html 加载顺序合并 4 文件 → dist/app.min.js（保留全局、不 IIFE）
const order = ['js/config.js', 'js/api.js', 'js/filters.js', 'js/app.js'];
const src = order.map((f) => fs.readFileSync(f, 'utf8')).join('\n;');
await esbuild.build({
  stdin: { contents: src, loader: 'js' },
  bundle: false,                 // 关键：不包裹 IIFE，保留全局语义
  outfile: 'dist/app.min.js',
  minify: true,
  charset: 'utf8',
  legalComments: 'none',
});
// 2) CSS：css/style.css → dist/style.min.css
// 3) 复制 index.html 并改写两个资源引用（或直接生成 dist/index.html）
```

### 阶段 2：产物目录与引用

- 产出 `dist/`：`index.html` + `style.min.css` + `app.min.js`（3 个文件）；
- `index.html` 中 4 个 `<script>` 收敛为 1 个 `<script src="app.min.js">`。

### 阶段 3：构建后验证（防回归）

- `npm test`：跑 3 个源文件测试（基线）；
- 压缩版验证：以「与源文件测试相同的源码组合」生成压缩产物再跑一遍（集成=config+filters+app；API=config+api），确认压缩不改语义。

### 阶段 4：部署接入（二选一）

| 部署方式 | 做法 | 评价 |
| --- | --- | --- |
| A. 分支直接部署（推荐） | 把 `dist/` 提交进仓库，Pages 指到 `dist/` 目录 | 简单、零依赖；但需严格遵循「先构建后提交」 |
| **B. Actions 内构建（可选示例）** | 扩展 `pages.example.yml`（重命名为 `pages.yml` 启用）：`npm ci` → `npm run build` → 上传 `dist/` | 源码与产物解耦，改源码推 main 即自动构建部署，无双源遗忘风险；默认不强制使用 |

---

## 七、待决策清单

| # | 决策点 | 建议 |
| --- | --- | --- |
| 1 | 是否合并为单 JS | ✅ 合并（请求数 6→3，解析次数 4→1） |
| 2 | 是否保留全局作用域 | ✅ 保留（语义零变化，测试/调试零适配，代价仅 7 KB） |
| 3 | 是否内联进 HTML | ❌ 不内联（帮助文档占 HTML 大头，缓存收益负） |
| 4 | 是否加 hash 文件名 | 选 Actions 部署时建议加；简单场景可先不加 |
| 5 | 是否生成 sourcemap | 建议生成（零运行时成本，仅 DevTools 打开时加载） |
| 6 | 部署方式升级 | 推荐 B（Actions 构建），根治双源维护风险 |

---

## 附：验证复现方法

```bash
# 1. 安装构建工具（隔离环境）
npm install --no-save esbuild

# 2. 合并压缩（保留全局，不 IIFE）
node -e "
const esbuild=require('esbuild'),fs=require('fs');
const order=['js/config.js','js/api.js','js/filters.js','js/app.js'];
const src=order.map(f=>fs.readFileSync(f,'utf8')).join('\n;');
esbuild.build({stdin:{contents:src,loader:'js'},bundle:false,outfile:'dist/app.min.js',minify:true,charset:'utf8',legalComments:'none'});
"

# 3. 压缩产物跑测试（生成同组合变体后执行）
node test/integration-test.js            # 源文件基线
node test/api-github-test.js             # 源文件基线
node test/api-gitea-test.js              # 源文件基线
```

> 数据口径：所有体积为磁盘字节数实测（非估算）；gzip 为 Node zlib 默认级别实测。
