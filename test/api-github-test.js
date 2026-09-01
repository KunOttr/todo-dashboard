/* GitHub GraphQL 分支测试：加载真实 api.js，用 fetch 桩模拟 GraphQL 服务 */
'use strict';
const fs = require('fs');

const requests = [];
const urls = [];
function record(body, url) { urls.push(url); requests.push(body ? JSON.parse(body) : null); }

let fail401 = false;

const issue = {
  id: 'G1', number: 1, title: '任务A', body: '描述', state: 'OPEN',
  createdAt: '2026-08-01T08:00:00Z', closedAt: null, url: 'https://github.com/o/r/issues/1',
  labels: { nodes: [{ id: 'L1', name: 'bug', color: 'd73a4a' }] },
};

async function fakeFetch(url, init) {
  const body = init && init.body;
  record(body, url);
  if (fail401) {
    return {
      ok: false, status: 401,
      async json() { return { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest', status: 401 }; },
      async text() { return JSON.stringify({ message: 'Bad credentials' }); },
    };
  }
  const { query } = body ? JSON.parse(body) : {};
  const json = (data) => ({ ok: true, status: 200, async json() { return { data }; }, async text() { return JSON.stringify({ data }); } });

  // apiGetInitial 合并查询：repository{ id labels issues }（需在单字段分支之前匹配）
  if (query.includes('issues(') && query.includes('labels(') && query.includes('cursor')) {
    return json({ repository: {
      id: 'R1',
      labels: { nodes: [{ id: 'L1', name: 'bug', color: 'd73a4a' }] },
      issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [issue] },
    } });
  }
  if (query.includes('repository(') && query.includes('issues(')) {
    return json({ repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [issue] } } });
  }
  if (query.includes('repository(') && query.includes('labels(')) {
    return json({ repository: { labels: { nodes: [{ id: 'L1', name: 'bug', color: 'd73a4a' }] } } });
  }
  if (query.includes('repository(') && !query.includes('issues(') && !query.includes('labels(')) {
    return json({ repository: { id: 'R1' } });
  }
  if (query.includes('node(id:')) {
    return json({ node: { state: 'OPEN', closedAt: null, labels: { nodes: issue.labels.nodes } } });
  }
  // 复合 mutation（apiApplyProgress / apiApplyTags）：alias 字段 r/a/c/o 一次请求（以 alias 前缀区分单次调用）
  if (query.includes('a: addLabelsToLabelable') || query.includes('r: removeLabelsFromLabelable')) {
    const data = {};
    if (query.includes('r: removeLabelsFromLabelable')) data.r = { labelable: { id: 'G1', labels: { nodes: [] } } };
    if (query.includes('a: addLabelsToLabelable')) data.a = { labelable: { id: 'G1', labels: { nodes: issue.labels.nodes } } };
    if (query.includes('c: closeIssue')) data.c = { issue: Object.assign({}, issue, { state: 'CLOSED', closedAt: '2026-08-01T09:00:00Z' }) };
    if (query.includes('o: reopenIssue')) data.o = { issue: Object.assign({}, issue, { state: 'OPEN', closedAt: null }) };
    return json(data);
  }
  if (query.includes('createIssue')) {
    return json({ createIssue: { issue: Object.assign({}, issue, { id: 'G-NEW', number: 9, title: JSON.parse(body).variables.title }) } });
  }
  if (query.includes('updateIssue')) {
    return json({ updateIssue: { issue: Object.assign({}, issue) } });
  }
  if (query.includes('closeIssue')) {
    return json({ closeIssue: { issue: Object.assign({}, issue, { state: 'CLOSED' }) } });
  }
  if (query.includes('reopenIssue')) {
    return json({ reopenIssue: { issue: Object.assign({}, issue, { state: 'OPEN' }) } });
  }
  if (query.includes('addLabelsToLabelable')) {
    return json({ addLabelsToLabelable: { labelable: { id: 'G1', labels: { nodes: issue.labels.nodes } } } });
  }
  if (query.includes('removeLabelsFromLabelable')) {
    return json({ removeLabelsFromLabelable: { labelable: { id: 'G1', labels: { nodes: [] } } } });
  }
  if (query.includes('createLabel')) {
    const vars = JSON.parse(body).variables;
    return json({ createLabel: { label: { id: 'L2', name: vars.name, color: String(vars.color).replace(/^#/, '') } } });
  }
  if (query.includes('deleteIssue')) {
    return json({ deleteIssue: { repository: { id: 'R1' } } });
  }
  if (query.includes('deleteLabel')) {
    return json({ deleteLabel: { repository: { id: 'R1' } } });
  }
  throw new Error('unhandled query: ' + query.slice(0, 80));
}

global.fetch = fakeFetch;

const src =
  fs.readFileSync('js/config.js', 'utf8') + '\n' +
  fs.readFileSync('js/api.js', 'utf8');

const testCode = `
const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else console.log('PASS: ' + msg); };
const cfg = { provider: 'github', owner: 'o', repo: 'r', token: 't' };

// 端点计算：默认 / 公开版 github.com → 官方端点；自建 GHE → baseUrl/api/graphql
assert(githubGraphqlEndpoint(cfg) === 'https://api.github.com/graphql', '无 baseUrl 使用默认端点');
assert(githubGraphqlEndpoint({ ...cfg, baseUrl: 'https://github.com' }) === 'https://api.github.com/graphql', 'github.com 视为公开版');
assert(githubGraphqlEndpoint({ ...cfg, baseUrl: 'http://github.com/' }) === 'https://api.github.com/graphql', 'github.com 尾斜杠归一');
assert(githubGraphqlEndpoint({ ...cfg, baseUrl: 'https://ghe.example.com' }) === 'https://ghe.example.com/api/graphql', '自建 GHE 拼接 /api/graphql');
assert(githubGraphqlEndpoint({ ...cfg, baseUrl: 'https://ghe.example.com/' }) === 'https://ghe.example.com/api/graphql', 'GHE baseUrl 尾斜杠归一');

const repo = await apiGetRepo(cfg);
assert(repo.id === 'R1', 'apiGetRepo');

const labels = await apiGetLabels(cfg);
assert(labels.length === 1 && labels[0].name === 'bug', 'apiGetLabels');

const issues = await apiGetIssues(cfg);
assert(issues.length === 1, 'apiGetIssues 数量');
assert(issues[0].id === 'G1' && issues[0].number === 1 && issues[0].state === 'OPEN', 'apiGetIssues 字段完整');
assert(issues[0].labels.nodes[0].name === 'bug', 'apiGetIssues labels');

const basics = await apiGetIssueBasics(cfg, 'G1');
assert(basics.state === 'OPEN' && basics.labels.length === 1, 'apiGetIssueBasics');

const created = await apiCreateIssue(cfg, 'R1', { title: '新任务', body: '', labelIds: ['L1'] });
assert(created.id === 'G-NEW' && created.number === 9, 'apiCreateIssue');

await apiUpdateIssue(cfg, 'G1', { title: '改', body: '' });
const closed = await apiCloseIssue(cfg, 'G1');
assert(closed.state === 'CLOSED', 'apiCloseIssue');
await apiReopenIssue(cfg, 'G1');
const addL = await apiAddLabels(cfg, 'G1', ['L1']);
assert(addL.length === 1, 'apiAddLabels');
await apiRemoveLabels(cfg, 'G1', ['L1']);
const nl = await apiCreateLabel(cfg, 'R1', '新标签', '#ff0000');
assert(nl.color === 'ff0000', 'apiCreateLabel 颜色规范化');
await apiDeleteIssue(cfg, 'G1');
await apiDeleteLabel(cfg, 'L2');

// ---- 新增复合 API ----
// 合并查询：repo + labels + issues 一次拿全
const initial = await apiGetInitial(cfg);
assert(initial.repoId === 'R1' && initial.labels.length === 1 && initial.issues.length === 1 && initial.issues[0].id === 'G1', 'apiGetInitial 合并查询一次拿全');

// apiApplyProgress：有旧进度标签 + 100% → remove/add/close 一次请求，不重复建标签
const pr = await apiApplyProgress(cfg, 'G1', 100, [{ id: 'L1', name: 'bug' }], 'L2');
assert(pr.state === 'CLOSED' && pr.createdLabel === null, 'apiApplyProgress 100% 关闭且不重复建标签');

// apiApplyProgress：目标标签缺失 → 惰性创建
const pr2 = await apiApplyProgress(cfg, 'G1', 30, null, null);
assert(pr2.createdLabel && pr2.createdLabel.name === '进度:30%' && pr2.state === 'OPEN', 'apiApplyProgress 惰性创建进度标签');

// apiApplyTags：添加 / 移除（alias 合并）
const tags1 = await apiApplyTags(cfg, 'G1', ['L1'], []);
assert(tags1.length === 1 && tags1[0].name === 'bug', 'apiApplyTags 添加标签');
const tags2 = await apiApplyTags(cfg, 'G1', [], ['L1']);
assert(tags2.length === 0, 'apiApplyTags 移除标签');

// apiBatchDeleteLabels：一次请求删除多个标签（alias d0/d1）
const reqBefore = requests.length;
await apiBatchDeleteLabels(cfg, ['L1', 'L2']);
assert(requests.length === reqBefore + 1, 'apiBatchDeleteLabels 一次请求删除多个');
const delReq = requests[requests.length - 1];
assert(delReq.query.includes('d0: deleteLabel') && delReq.query.includes('d1: deleteLabel'), 'apiBatchDeleteLabels 使用 alias 批量');

// 认证头
const req0 = requests[0];
assert(req0 && req0.variables && req0.variables.owner === 'o' && req0.variables.name === 'r', 'GraphQL 变量正确');

// GHE：请求发往自建端点
const gheCfg = { ...cfg, baseUrl: 'https://ghe.example.com' };
await apiGetRepo(gheCfg);
assert(urls[urls.length - 1] === 'https://ghe.example.com/api/graphql', 'GHE 请求发往 baseUrl/api/graphql');
const gheReq = requests[requests.length - 1];
assert(gheReq && gheReq.variables.owner === 'o', 'GHE 请求变量正确');

// HTTPS 页面请求 HTTP GHE → 混合内容提示
global.window = { location: { protocol: 'https:' } };
let threw = '';
try { await apiGetRepo({ ...cfg, baseUrl: 'http://ghe.example.com' }); } catch (e) { threw = e.message; }
delete global.window;
assert(threw.indexOf('混合内容') >= 0 || threw.indexOf('HTTPS') >= 0, 'HTTPS 页面访问 HTTP GHE 提示混合内容');

// token 过期：HTTP 401 应提示 Token 无效，而不是 data is undefined 之类的晦涩错误
fail401 = true;
let authErr = '';
let authErrCode = '';
try { await apiGetRepo(cfg); } catch (e) { authErr = e.message; authErrCode = e.code; }
fail401 = false;
assert(authErr.indexOf('401') >= 0 && authErr.indexOf('Token') >= 0, '401 提示 Token 过期/无效');
assert(authErrCode === 'unauthorized', '401 错误带 unauthorized code');
console.log('--- GITHUB TESTS DONE ---');
`;

const wrapped = src + '\n(async function run(){' + testCode + '})().catch((e) => { console.error("TEST ERROR:", e); console.error(e.stack); process.exitCode = 1; });';
eval(wrapped);
