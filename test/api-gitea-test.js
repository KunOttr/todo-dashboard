/* Gitea REST 分支单元测试：加载真实 api.js，用 fetch 桩模拟 Gitea 服务 */
'use strict';
const fs = require('fs');

// ---- fetch 桩：按 URL 路由到假 Gitea 服务 ----
const requests = [];
function record(method, url, body) { requests.push({ method, url, body }); }

const issues = {
  1: { id: 101, number: 1, title: '任务一', body: '', state: 'open', created_at: '2026-08-01T08:00:00Z', closed_at: null, html_url: 'https://gitea.example/o/r/issues/1', labels: [{ id: 1, name: 'bug', color: '#d73a4a' }] },
  2: { id: 102, number: 2, title: '已关闭', body: 'x', state: 'closed', created_at: '2026-08-02T08:00:00Z', closed_at: '2026-08-03T09:00:00Z', html_url: 'https://gitea.example/o/r/issues/2', labels: [] },
};

async function fakeFetch(url, init) {
  const method = (init && init.method) || 'GET';
  const u = new URL(url);
  const path = u.pathname;
  const auth = (init && init.headers && init.headers.Authorization) || '';
  record(method, url, init && init.body ? JSON.parse(init.body) : null);

  const json = (code, body) => ({ ok: code >= 200 && code < 300, status: code, async json() { return body; }, async text() { return JSON.stringify(body); } });
  const noBody = (code) => ({ ok: code >= 200 && code < 300, status: code, async json() { return null; }, async text() { return ''; } });

  if (path === '/api/v1/repos/o/r') return json(200, { id: 5, full_name: 'o/r' });
  if (path === '/api/v1/repos/o/r/labels' && method === 'GET') return json(200, [{ id: 1, name: 'bug', color: '#d73a4a' }, { id: 2, name: '归档', color: '6F42C1' }]);
  if (path === '/api/v1/repos/o/r/issues' && method === 'GET') {
    // 分页：一次返回两条（含一条 PR，应被过滤）
    return json(200, [
      issues[1], issues[2],
      { id: 999, number: 3, title: '一个PR', body: '', state: 'open', created_at: '2026-08-04T08:00:00Z', closed_at: null, html_url: '', labels: [], pull_request: { merged: false } },
    ]);
  }
  if (path === '/api/v1/repos/o/r/issues' && method === 'POST') {
    const b = init.body ? JSON.parse(init.body) : {};
    return json(201, { id: 200, number: 4, title: b.title, body: b.body || '', state: 'open', created_at: '2026-08-05T08:00:00Z', closed_at: null, html_url: 'https://gitea.example/o/r/issues/4', labels: [] });
  }
  const mIssue = path.match(/^\/api\/v1\/repos\/o\/r\/issues\/(\d+)$/);
  if (mIssue && method === 'GET') {
    const issue = issues[mIssue[1]];
    if (!issue) return json(404, { message: 'Not Found' });
    return json(200, issue);
  }
  if (mIssue && method === 'PATCH') return json(200, Object.assign({}, issues[mIssue[1]], init.body ? JSON.parse(init.body) : {}));
  if (mIssue && method === 'DELETE') return noBody(204);
  if (/^\/api\/v1\/repos\/o\/r\/issues\/\d+\/labels$/.test(path) && method === 'POST') return noBody(204);
  if (/^\/api\/v1\/repos\/o\/r\/issues\/\d+\/labels\/\d+$/.test(path) && method === 'DELETE') return noBody(204);
  if (path === '/api/v1/repos/o/r/labels' && method === 'POST') {
    const b = init.body ? JSON.parse(init.body) : {};
    return json(201, { id: 9, name: b.name, color: b.color });
  }
  if (/^\/api\/v1\/repos\/o\/r\/labels\/\d+$/.test(path) && method === 'DELETE') return noBody(204);
  return json(404, { message: 'unknown ' + path });
}

global.fetch = fakeFetch;

// ---- 装载源码 ----
const src =
  fs.readFileSync('js/config.js', 'utf8') + '\n' +
  fs.readFileSync('js/api.js', 'utf8');

const testCode = `
const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else console.log('PASS: ' + msg); };
const cfg = { provider: 'gitea', baseUrl: 'https://gitea.example', owner: 'o', repo: 'r', token: 'tok', useProgress: false };

// 认证头
const repo = await apiGetRepo(cfg);
assert(repo.id === '5', 'apiGetRepo 映射 id');
assert(requests.some(r => r.url.indexOf('/api/v1/repos/o/r') >= 0 && r.method === 'GET'), 'apiGetRepo 请求 Gitea REST');

const labels = await apiGetLabels(cfg);
assert(labels.length === 2 && labels[0].color === 'd73a4a', 'apiGetLabels 规范化颜色');

const issues2 = await apiGetIssues(cfg);
assert(issues2.length === 2, 'apiGetIssues 过滤 PR');
assert(issues2[0].id === '1' && issues2[0].number === 1 && issues2[0].state === 'OPEN', 'issue 映射（以 index 为内部 id）');
assert(issues2[1].state === 'CLOSED' && !!issues2[1].closedAt, 'closed issue 映射状态与完成时间');
assert(issues2[0].labels.nodes[0].name === 'bug', 'issue labels 映射');

const basics = await apiGetIssueBasics(cfg, '1');
assert(basics.state === 'OPEN' && basics.labels.length === 1, 'apiGetIssueBasics');

const created = await apiCreateIssue(cfg, null, { title: '新任务', body: '描述', labelIds: ['1'] });
assert(created.id === '4' && created.title === '新任务', 'apiCreateIssue 返回内部结构');
const createReq = requests.filter(r => r.method === 'POST' && r.url.indexOf('/api/v1/repos/o/r/issues') >= 0 && r.url.indexOf('/labels') < 0)[0];
assert(createReq.body.labels[0] === 1 && typeof createReq.body.labels[0] === 'number', 'createIssue 提交 label ids（数字）');

requests.length = 0;
await apiAddLabels(cfg, '1', ['1', '2']);
const addLabelsReq = requests.find(r => r.method === 'POST' && r.url.indexOf('/issues/1/labels') >= 0);
assert(addLabelsReq && addLabelsReq.body.labels.length === 2 && addLabelsReq.body.labels[0] === 1 && typeof addLabelsReq.body.labels[0] === 'number', 'apiAddLabels 提交 int64 label ids（数字）');

requests.length = 0;
await apiRemoveLabels(cfg, '1', ['1', '2']);
assert(requests.filter(r => r.method === 'DELETE' && r.url.indexOf('/issues/1/labels/') >= 0).length === 2, 'apiRemoveLabels 逐个删除');

requests.length = 0;
await apiCloseIssue(cfg, '1');
assert(requests.some(r => r.method === 'PATCH' && r.url.indexOf('/issues/1') >= 0 && r.body.state === 'closed'), 'apiCloseIssue 提交 closed');
requests.length = 0;
await apiReopenIssue(cfg, '1');
assert(requests.some(r => r.method === 'PATCH' && r.url.indexOf('/issues/1') >= 0 && r.body.state === 'open'), 'apiReopenIssue 提交 open');

requests.length = 0;
const nl = await apiCreateLabel(cfg, null, '新标签', '#ff0000');
assert(nl.id === '9' && nl.color === 'ff0000', 'apiCreateLabel 规范化颜色');
assert(requests[0].body.color === 'ff0000', 'apiCreateLabel 提交去 # 颜色');

requests.length = 0;
await apiDeleteLabel(cfg, '9');
assert(requests.some(r => r.method === 'DELETE' && r.url.indexOf('/labels/9') >= 0), 'apiDeleteLabel');

// ---- 新增复合 API（Gitea 分支）----
// updateIssue / setIssueState 返回值补全
requests.length = 0;
const upd = await apiUpdateIssue(cfg, '1', { title: '改', body: 'b' });
assert(upd && upd.title === '改' && upd.id === '1', 'apiUpdateIssue 返回内部结构');
requests.length = 0;
const st = await apiSetIssueState(cfg, '1', 'closed');
assert(st && st.state === 'CLOSED', 'apiSetIssueState 返回内部结构');
requests.length = 0;
await apiReopenIssue(cfg, '1');

// apiGetInitial：Gitea 并行（repo + labels + issues）
requests.length = 0;
const ini = await apiGetInitial(cfg);
assert(ini.repoId === '5' && ini.labels.length === 2 && ini.issues.length === 2, 'apiGetInitial（Gitea 并行）');

// apiApplyProgress：目标标签缺失 → 惰性创建；旧标签移除
requests.length = 0;
const ap = await apiApplyProgress(cfg, '1', 80, [], null);
assert(ap.state === 'OPEN' && ap.labels.length >= 1, 'apiApplyProgress 返回状态与标签');
assert(requests.some(r => r.method === 'POST' && r.url.indexOf('/repos/o/r/labels') >= 0 && r.body.name === '进度:80%'), 'apiApplyProgress 惰性创建进度标签');
requests.length = 0;
const ap2 = await apiApplyProgress(cfg, '1', 20, [{ id: 2, name: '归档' }], '2');
assert(requests.some(r => r.method === 'DELETE' && r.url.indexOf('/issues/1/labels/2') >= 0), 'apiApplyProgress 移除旧进度标签');

// apiApplyTags：添加 + 移除并行，返回标签列表
requests.length = 0;
const t1 = await apiApplyTags(cfg, '1', ['1'], ['2']);
assert(requests.some(r => r.method === 'POST' && r.url.indexOf('/issues/1/labels') >= 0), 'apiApplyTags 添加');
assert(requests.some(r => r.method === 'DELETE' && r.url.indexOf('/issues/1/labels/2') >= 0), 'apiApplyTags 移除');
assert(t1.length === 1, 'apiApplyTags 返回标签列表');

// apiBatchDeleteLabels：并行删除多个标签
requests.length = 0;
await apiBatchDeleteLabels(cfg, ['1', '2']);
assert(requests.filter(r => r.method === 'DELETE' && r.url.indexOf('/labels/') >= 0 && r.url.indexOf('/issues/') < 0).length === 2, 'apiBatchDeleteLabels 并行删除多个');

// 错误处理
let threw = '';
try { await apiGetIssueBasics(cfg, '999'); } catch (e) { threw = e.message; }
assert(threw === 'Not Found', '非 2xx 抛出服务端 message');

// 缺少 baseUrl
let threw2 = '';
try { await apiGetRepo({ provider: 'gitea', baseUrl: '', owner: 'o', repo: 'r', token: 't' }); } catch (e) { threw2 = e.message; }
assert(threw2.indexOf('服务器地址') >= 0, '缺少 baseUrl 报错');

// CORS / 网络失败：给出自建 Gitea 的配置提示
global.fetch = async () => { throw new TypeError('Failed to fetch'); };
let threw3 = '';
try { await apiGetRepo(cfg); } catch (e) { threw3 = e.message; }
assert(threw3.indexOf('[cors]') >= 0 && threw3.indexOf('ENABLED') >= 0, 'CORS/网络失败给出配置提示');

// HTTPS 页面请求 HTTP Gitea → 混合内容提示
global.window = { location: { protocol: 'https:' } };
let threw4 = '';
try { await apiGetRepo({ provider: 'gitea', baseUrl: 'http://gitea.example', owner: 'o', repo: 'r', token: 't' }); } catch (e) { threw4 = e.message; }
delete global.window;
assert(threw4.indexOf('混合内容') >= 0 || threw4.indexOf('HTTPS') >= 0, 'HTTPS 页面访问 HTTP Gitea 提示混合内容');
console.log('--- GITEA TESTS DONE ---');
`;

const wrapped = src + '\n(async function run(){' + testCode + '})().catch((e) => { console.error("TEST ERROR:", e); console.error(e.stack); process.exitCode = 1; });';
eval(wrapped);
