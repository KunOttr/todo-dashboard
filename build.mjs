/**
 * 生产级构建脚本（零配置、零第三方依赖注入）
 *
 * 策略（详见 BUILD-ANALYSIS.md）：
 *   1) JS：按 index.html 的加载顺序合并 4 个文件，minify 但【保留全局作用域】（不包裹 IIFE），
 *          以保证顶层函数/变量（connect / state / APP_CONFIG 等）语义不变、现有测试零适配。
 *   2) CSS：minify。
 *   3) 产物文件名带内容 hash，实现缓存可控（内容不变 → URL 不变 → 命中缓存）。
 *   4) 生成 dist/index.html，自动改写 css/style.css 与 4 个 <script> 的引用。
 *
 * 产物目录 dist/（3 个文件）即部署单元；源码永不直部署。
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

// ---------- 1) JS：合并 + minify（保留全局语义） ----------
const JS_ORDER = ['js/config.js', 'js/crypto.js', 'js/api.js', 'js/filters.js', 'js/app.js'];
const jsSrc = JS_ORDER
  .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n;\n');

const jsTmp = path.join(dist, 'app.min.js');
await esbuild.build({
  stdin: { contents: jsSrc, resolveDir: root, loader: 'js' },
  bundle: false,        // 关键：不包裹 IIFE，保留顶层全局声明
  minify: true,
  charset: 'utf8',
  legalComments: 'none',
  outfile: jsTmp,
});

// ---------- 2) CSS：minify ----------
const cssTmp = path.join(dist, 'style.min.css');
await esbuild.build({
  entryPoints: [path.join(root, 'css/style.css')],
  bundle: false,
  minify: true,
  charset: 'utf8',
  legalComments: 'none',
  outfile: cssTmp,
});

// ---------- 3) 内容 hash 文件名（缓存可控） ----------
function sha8(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 8);
}
const jsName = `app.min.${sha8(jsTmp)}.js`;
const cssName = `style.min.${sha8(cssTmp)}.css`;
fs.renameSync(jsTmp, path.join(dist, jsName));
fs.renameSync(cssTmp, path.join(dist, cssName));

// ---------- 4) 生成 dist/index.html 并改写引用 ----------
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(
  /<link rel="stylesheet" href="css\/style\.css">/,
  `<link rel="stylesheet" href="${cssName}">`
);
html = html.replace(
  /<script src="js\/config\.js"><\/script>\s*<script src="js\/crypto\.js"><\/script>\s*<script src="js\/api\.js"><\/script>\s*<script src="js\/filters\.js"><\/script>\s*<script src="js\/app\.js"><\/script>/,
  `<script src="${jsName}"></script>`
);
fs.writeFileSync(path.join(dist, 'index.html'), html);

console.log(`✅ build done → dist/index.html + ${cssName} + ${jsName}`);
