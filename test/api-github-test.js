/* GitHub GraphQL 分支测试：加载真实 api.js，用 fetch 桩模拟 GraphQL 服务 */
'use strict';
const fs = require('fs');

const requests = [];
function record(body) { requests.push(body ? JSON.parse(body) : null); }

const issue = {
  id: 'G1', number: 1, title: '任务A', body: '描述', state: 'OPEN',
  createdAt: '2026-08-01T08:00:00Z', closedAt: null, url: 'https://github.com/o/r/issues/1',
  labels: { nodes: [{ id: 'L1', name: 'bug', color: 'd73a4a' }] },
};

async function fakeFetch(url, init) {
  const body = init && init.body;
  record(body);
  const { query } = body ? JSON.parse(body) : {};
  const json = (data) => ({ ok: true, status: 200, async json() { return { data }; }, async text() { return JSON.stringify({ data }); } });

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

// 认证头
const req0 = requests[0];
assert(req0 && req0.variables && req0.variables.owner === 'o' && req0.variables.name === 'r', 'GraphQL 变量正确');
console.log('--- GITHUB TESTS DONE ---');
`;

const wrapped = src + '\n(async function run(){' + testCode + '})().catch((e) => { console.error("TEST ERROR:", e); console.error(e.stack); process.exitCode = 1; });';
eval(wrapped);
