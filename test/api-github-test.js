/* GitHub GraphQL 分支测试：加载真实 api.js，用 fetch 桩模拟 GraphQL 服务 */
'use strict';
const fs = require('fs');

const requests = [];
const urls = [];
function record(body, url) { urls.push(url); requests.push(body ? JSON.parse(body) : null); }

const issue = {
  id: 'G1', number: 1, title: '任务A', body: '描述', state: 'OPEN',
  createdAt: '2026-08-01T08:00:00Z', closedAt: null, url: 'https://github.com/o/r/issues/1',
  labels: { nodes: [{ id: 'L1', name: 'bug', color: 'd73a4a' }] },
  closedByPullRequestsReferences: {
    totalCount: 1,
    nodes: [{
      number: 7, title: '修复 A', state: 'MERGED', isDraft: false, merged: true,
      mergedAt: '2026-08-02T00:00:00Z', url: 'https://github.com/o/r/pull/7',
      headRefName: 'fix/a', mergeCommit: { abbreviatedOid: 'abc1234' },
    }],
  },
};

async function fakeFetch(url, init) {
  const body = init && init.body;
  record(body, url);
  const { query } = body ? JSON.parse(body) : {};
  const json = (data) => ({ ok: true, status: 200, async json() { return { data }; }, async text() { return JSON.stringify({ data }); } });
  const jsonErr = (errors) => ({ ok: true, status: 200, async json() { return { errors }; }, async text() { return JSON.stringify({ errors }); } });

  // 模拟旧版 GitHub Enterprise：schema 上没有 PR 关联字段
  if (url.indexOf('old-ghe.example.com') >= 0 && query.includes('closedByPullRequestsReferences')) {
    return jsonErr([{ message: "Field 'closedByPullRequestsReferences' doesn't exist on type 'Issue'" }]);
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
    return json({ createLabel: { label: { id: 'L2', name: '新标签', color: 'ff0000' } } });
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

// 关联 PR 字段：内联进原有列表查询（不增加请求数），且 includeClosedPrs 必须显式传 true
const issuesReq = requests.find((r) => r && r.query && r.query.includes('issues('));
assert(!!issuesReq && issuesReq.query.includes('closedByPullRequestsReferences(first: 3, includeClosedPrs: true)'), '列表查询内联 PR 关联字段且 includeClosedPrs=true');
assert(requests.filter((r) => r && r.query && r.query.includes('issues(')).length === 1, '关联 PR 数据未拆成额外请求（仍为 1 次列表请求）');
assert(issues[0].closedByPullRequestsReferences.nodes[0].number === 7, '关联 PR 数据随列表一起返回');
assert(issues[0].closedByPullRequestsReferences.nodes[0].mergeCommit.abbreviatedOid === 'abc1234', '关联 PR 带合并提交短 hash');

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

// 认证头
const req0 = requests[0];
assert(req0 && req0.variables && req0.variables.owner === 'o' && req0.variables.name === 'r', 'GraphQL 变量正确');

// GHE：请求发往自建端点
const gheCfg = { ...cfg, baseUrl: 'https://ghe.example.com' };
await apiGetRepo(gheCfg);
assert(urls[urls.length - 1] === 'https://ghe.example.com/api/graphql', 'GHE 请求发往 baseUrl/api/graphql');
const gheReq = requests[requests.length - 1];
assert(gheReq && gheReq.variables.owner === 'o', 'GHE 请求变量正确');

// 旧版 GHE 缺少 PR 关联字段 → 自动降级重试一次，看板仍可用（该区块静默不展示）
const oldCfg = { ...cfg, baseUrl: 'https://old-ghe.example.com' };
requests.length = 0;
const oldIssues = await apiGetIssues(oldCfg);
assert(oldIssues.length === 1 && oldIssues[0].id === 'G1', '旧版 GHE 缺失 PR 字段时仍能取回 issue 列表');
assert(requests.length === 2, '降级只重试一次（共 2 次请求）');
assert(requests[0].query.includes('closedByPullRequestsReferences'), '降级前先尝试请求 PR 关联字段');
assert(requests[1].query.indexOf('closedByPullRequestsReferences') < 0, '降级后不再请求 PR 关联字段');
// 端点级缓存：同一端点后续调用直接走降级，不重复失败
requests.length = 0;
await apiGetIssues(oldCfg);
assert(requests.length === 1 && requests[0].query.indexOf('closedByPullRequestsReferences') < 0, '同一端点复用降级结论，不重复失败');
// 其它端点不受影响
requests.length = 0;
const pubIssues = await apiGetIssues(cfg);
assert(pubIssues[0].closedByPullRequestsReferences.nodes.length === 1, '降级不影响其它端点的 PR 关联数据');

// HTTPS 页面请求 HTTP GHE → 混合内容提示
global.window = { location: { protocol: 'https:' } };
let threw = '';
try { await apiGetRepo({ ...cfg, baseUrl: 'http://ghe.example.com' }); } catch (e) { threw = e.message; }
delete global.window;
assert(threw.indexOf('混合内容') >= 0 || threw.indexOf('HTTPS') >= 0, 'HTTPS 页面访问 HTTP GHE 提示混合内容');
console.log('--- GITHUB TESTS DONE ---');
`;

const wrapped = src + '\n(async function run(){' + testCode + '})().catch((e) => { console.error("TEST ERROR:", e); console.error(e.stack); process.exitCode = 1; });';
eval(wrapped);
