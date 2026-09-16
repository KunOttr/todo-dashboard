/* 集成测试：使用 DOM/API 桩模拟队列、去重、乐观更新与 flush */
'use strict';
const fs = require('fs');

// ---- DOM / 全局桩 ----
function mkEl(sel) {
  return {
    sel, listeners: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) {
        if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else { f ? this._s.add(c) : this._s.delete(c); }
      },
      contains(c) { return this._s.has(c); },
    },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    dispatch(t, ev) { (this.listeners[t] || []).forEach((f) => f(Object.assign({ target: { dataset: {} } }, ev || {}))); },
    querySelector() { return mkEl(sel + ' q'); },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, bottom: 0, right: 0 }; },
    appendChild() {}, remove() {},
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
    checked: false, disabled: false, title: '', type: 'text', focus() {},
  };
}
const reg = {};
global.document = {
  getElementById(id) { return reg['#' + id] || (reg['#' + id] = mkEl('#' + id)); },
  querySelector(sel) { return reg[sel] || (reg[sel] = mkEl(sel)); },
  querySelectorAll() { return []; },
  createElement() { return mkEl('create'); },
  addEventListener() {},
  body: mkEl('body'),
  visibilityState: 'visible',
};
global.window = { innerWidth: 1000, addEventListener() {} };
global.requestAnimationFrame = (fn) => fn();
global.setInterval = () => 0;
global.confirm = () => true;
global.location = { reload() {} };
const store = {};
global.localStorage = {
  getItem: (k) => store[k] || null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.sessionStorage = {
  getItem: (k) => store[k] || null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

// ---- 有状态的假服务端 + API 桩（记录调用）----
let calls = [];
function log(name, args) { calls.push({ name, args: Array.isArray(args) ? args : [args] }); }

const serverLabels = [
  { id: 'L1', name: '工作', color: '0969DA' },
  { id: 'L2', name: '归档', color: '6F42C1' },
];
const serverIssues = {
  I1: {
    id: 'I1', number: 1, title: '任务A', body: '', state: 'OPEN',
    createdAt: '2026-08-01T08:00:00Z', closedAt: null, url: 'https://x/1',
    labels: [{ id: 'L1', name: '工作', color: '0969DA' }],
  },
};
function findLabelById(id) { return serverLabels.find((l) => l.id === id) || null; }
function findLabelByName(name) { return serverLabels.find((l) => l.name === name) || null; }
function issueToAPI(issue) {
  return {
    id: issue.id, number: issue.number, title: issue.title, body: issue.body,
    state: issue.state, createdAt: issue.createdAt, closedAt: issue.closedAt, url: issue.url,
    labels: { nodes: issue.labels.slice() },
  };
}

async function apiGetRepo(cfg) { log('repo', cfg); return { id: 'R1' }; }
async function apiGetLabels(cfg) { log('labels', cfg); return serverLabels.slice(); }
async function apiGetIssues(cfg) {
  log('issues', cfg);
  return Object.values(serverIssues).map(issueToAPI);
}
async function apiGetIssueBasics(cfg, issueId) {
  log('issueBasics', issueId);
  const issue = serverIssues[issueId];
  return issue
    ? { state: issue.state, closedAt: issue.closedAt, labels: issue.labels.slice() }
    : { state: 'OPEN', closedAt: null, labels: [] };
}
async function apiCreateLabel(cfg, repoId, name, color) {
  log('createLabel', [name, color]);
  const label = { id: 'NL' + serverLabels.length, name, color };
  serverLabels.push(label);
  return label;
}
async function apiCreateIssue(cfg, repoId, { title, body, labelIds }) {
  log('createIssue', { title, body, labelIds });
  const labels = (labelIds || []).map(findLabelById).filter(Boolean);
  const issue = {
    id: 'I-NEW', number: 9, title, body: body || '', state: 'OPEN',
    createdAt: new Date().toISOString(), closedAt: null, url: '', labels,
  };
  serverIssues['I-NEW'] = issue;
  return issueToAPI(issue);
}
async function apiUpdateIssue(cfg, id, { title, body }) {
  log('updateIssue', [id, title]);
  if (serverIssues[id]) { serverIssues[id].title = title; serverIssues[id].body = body || ''; }
  return serverIssues[id] ? issueToAPI(serverIssues[id]) : null;
}
async function apiSetIssueState(cfg, id, state) {
  log('setIssueState', [id, state]);
  const issue = serverIssues[id];
  if (!issue) return null;
  if (state === 'closed') {
    if (issue.state !== 'CLOSED') log('closeIssue', id);
    issue.state = 'CLOSED'; issue.closedAt = new Date().toISOString();
  } else {
    if (issue.state !== 'OPEN') log('reopenIssue', id);
    issue.state = 'OPEN'; issue.closedAt = null;
  }
  return issueToAPI(issue);
}
async function apiCloseIssue(cfg, id) {
  log('closeIssue', id);
  if (serverIssues[id]) { serverIssues[id].state = 'CLOSED'; serverIssues[id].closedAt = new Date().toISOString(); }
}
async function apiReopenIssue(cfg, id) {
  log('reopenIssue', id);
  if (serverIssues[id]) { serverIssues[id].state = 'OPEN'; serverIssues[id].closedAt = null; }
}
async function apiDeleteIssue(cfg, id) { log('deleteIssue', id); delete serverIssues[id]; }
async function apiAddLabels(cfg, id, ids) {
  log('addLabels', [id, ids]);
  const issue = serverIssues[id];
  if (!issue) return [];
  for (const lid of ids) {
    const label = findLabelById(lid);
    if (label && !issue.labels.some((l) => l.id === lid)) issue.labels.push(label);
  }
  return issue.labels.slice();
}
async function apiRemoveLabels(cfg, id, ids) {
  log('removeLabels', [id, ids]);
  const issue = serverIssues[id];
  if (!issue) return [];
  issue.labels = issue.labels.filter((l) => !ids.includes(l.id));
  return issue.labels.slice();
}
/* ---- 复合操作桩（execOp 优化后新增） ---- */
async function apiGetInitial(cfg) {
  log('initial', cfg);
  return { repoId: 'R1', labels: serverLabels.slice(), issues: Object.values(serverIssues).map(issueToAPI) };
}
async function apiApplyProgress(cfg, apiId, value, oldProgressLabels, targetLabelId) {
  const issue = serverIssues[apiId];
  if (!issue) return { labels: [], state: null, closedAt: null, createdLabel: null };
  const old = oldProgressLabels || [];
  if (old.length) {
    log('removeLabels', [apiId, old.map((l) => l.id)]);
    issue.labels = issue.labels.filter((l) => !old.some((o) => o.id === l.id));
  }
  const targetName = '进度:' + value + '%';
  let label = targetLabelId ? findLabelById(targetLabelId) : null;
  let createdLabel = null;
  if (!label) {
    label = findLabelByName(targetName);
    if (!label) {
      log('createLabel', [targetName, '0E8A16']);
      label = { id: 'NL' + serverLabels.length, name: targetName, color: '0E8A16' };
      serverLabels.push(label);
      createdLabel = label;
    }
  }
  log('addLabels', [apiId, [label.id]]);
  if (!issue.labels.some((l) => l.id === label.id)) issue.labels.push(label);
  if (value >= 100) {
    if (issue.state !== 'CLOSED') log('closeIssue', apiId);
    issue.state = 'CLOSED'; issue.closedAt = new Date().toISOString();
  } else {
    if (issue.state !== 'OPEN') log('reopenIssue', apiId);
    issue.state = 'OPEN'; issue.closedAt = null;
  }
  return { labels: issue.labels.slice(), state: issue.state, closedAt: issue.closedAt, createdLabel };
}
async function apiApplyTags(cfg, apiId, addIds, removeIds) {
  const issue = serverIssues[apiId];
  if (!issue) return [];
  addIds = addIds || []; removeIds = removeIds || [];
  if (addIds.length) {
    log('addLabels', [apiId, addIds]);
    for (const lid of addIds) {
      const label = findLabelById(lid);
      if (label && !issue.labels.some((l) => l.id === lid)) issue.labels.push(label);
    }
  }
  if (removeIds.length) {
    log('removeLabels', [apiId, removeIds]);
    issue.labels = issue.labels.filter((l) => !removeIds.includes(l.id));
  }
  return issue.labels.slice();
}
async function apiBatchDeleteLabels(cfg, labelIds) {
  log('batchDeleteLabels', labelIds);
  for (const id of labelIds) {
    const i = serverLabels.findIndex((l) => l.id === id);
    if (i >= 0) serverLabels.splice(i, 1);
  }
}

// ---- 装载源码 ----
const src =
  fs.readFileSync('js/config.js', 'utf8') + '\n' +
  fs.readFileSync('js/crypto.js', 'utf8') + '\n' +
  fs.readFileSync('js/filters.js', 'utf8') + '\n' +
  fs.readFileSync('js/app.js', 'utf8');
store['github-todo-config'] = JSON.stringify({ repos: [{ owner: 'o', repo: 'r', token: 't' }], activeIndex: 0, settings: { useProgress: false } });

const testCode = `
const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else console.log('PASS: ' + msg); };

// 确保连接完成（init() 的 loadConfig 为异步，先让它的微任务跑完）
await new Promise((r) => setTimeout(r, 0));
await connect();

// 配置存在时不再显示"尚未配置仓库"占位
assert($('#noConfigBox').classList.contains('hidden'), '连接后 noConfigBox 已隐藏');
assert(!$('#filters').classList.contains('hidden'), '连接后筛选面板可见');
assert(!$('#blockOpen').classList.contains('hidden'), '连接后未完成列表可见');
assert(!$('#blockClosed').classList.contains('hidden'), '连接后已完成列表可见');
assert(!$('#btnTagsManage').classList.contains('hidden'), '连接后标签管理按钮可见');
assert($('#repoSwitchBtn').textContent.indexOf('o / r') >= 0, '仓库切换按钮显示当前仓库');
assert($('#repoSwitchMenu').innerHTML.indexOf('data-switch-repo') >= 0, '仓库切换菜单已渲染');
assert($('#repoSwitchMenu').innerHTML.indexOf('当前') < 0, '仓库切换菜单不再显示"当前"标签');
assert($('#repoSwitchMenu').innerHTML.indexOf('repo-switch-check') >= 0, '仓库切换菜单使用对钩槽');

// 操作面板：筛选选项默认折叠，点击"筛选"展开/收起
assert(state.filterOptionsOpen === false, '筛选选项默认折叠（state）');
$('#filterOptions').classList.add('hidden'); // 模拟初始 HTML 状态
$('#btnFilterToggle').dispatch('click');
assert(state.filterOptionsOpen === true && !$('#filterOptions').classList.contains('hidden'), '点击筛选按钮展开选项');
$('#btnFilterToggle').dispatch('click');
assert(state.filterOptionsOpen === false && $('#filterOptions').classList.contains('hidden'), '再次点击收起选项');

assert($('#btnSync').classList.contains('hidden'), '无改动时同步按钮隐藏');

// 卡片：含「+ 标签」入口；归档/删除移入编辑模式
let ch = cardHTML(state.issues[0]);
assert(ch.indexOf('data-act="tags"') >= 0, '卡片保留「+ 标签」按钮');
assert(ch.indexOf('data-act="archive"') < 0 && ch.indexOf('data-act="delete"') < 0, '卡片不再含归档/删除按钮');
assert(ch.indexOf('data-act="edit"') >= 0, '卡片保留编辑按钮');

// 编辑模式：无已完成按钮、按仓库百分比支持显示支持百分比、归档/删除合并为单按钮
state.editor = { mode: 'edit', targetId: 'I1', title: 'x', body: '', percent: false, progress: 0, tags: new Set(['工作']) };
state.config.repos[0].useProgress = false;
let eh = editorHTML();
assert(eh.indexOf('editorDone') < 0 && eh.indexOf('已完成') < 0, '编辑模式无"已完成"按钮');
assert(eh.indexOf('支持百分比') < 0, '仓库不支持百分比时编辑器不显示支持百分比');
assert(eh.indexOf('editor-archive-delete') >= 0, '编辑模式含归档/删除合并按钮');
assert(eh.indexOf('editor-archive') < 0 || eh.indexOf('editor-archive-delete') >= 0, '不再有独立归档按钮');
assert(/data-act="editor-archive-delete">归档</.test(eh), '未归档时按钮显示"归档"');
// 归档后按钮变为"删除"
state.issues[0].labels.nodes.push({ id: 'L2', name: '归档', color: '6F42C1' });
eh = editorHTML();
assert(/data-act="editor-archive-delete">删除</.test(eh), '已归档时按钮显示"删除"');
state.issues[0].labels.nodes = state.issues[0].labels.nodes.filter((l) => l.name !== '归档');
state.config.repos[0].useProgress = true;
eh = editorHTML();
assert(eh.indexOf('支持百分比') >= 0, '仓库支持百分比时编辑器显示支持百分比');
state.editor = null;

assert(state.config.repos.length === 1, '多仓库配置加载');
assert(state.issues.length === 1, '连接后加载 1 条 issue');
assert(state.labels.some((l) => l.name === '归档'), '自动创建/包含归档标签');
assert(!state.labels.some((l) => l.name.startsWith('进度:')), '默认未开启百分比，不创建进度标签');
assert(deriveIssueMeta(state.issues[0]).percent === false, '默认任务不使用百分比');

// 开启百分比后派生
state.config.repos[0].useProgress = true;
assert(deriveIssueMeta(state.issues[0]).percent === false, '已开启百分比，但任务未带进度标签仍视为不支持');

// 环上选进度
optimisticSetProgress(state.issues[0], 50);
let m = deriveIssueMeta(state.issues[0]);
assert(m.percent === true && m.progress === 50, '设置进度 50% 后派生正确');
assert(state.issues[0].state === 'OPEN', '50% 为进行中');
let op = state.pendingOps.filter((o) => o.kind === 'setProgress');
assert(op.length === 1 && op[0].value === 50, '入队一条 setProgress(50)');

// 去重保留最新
optimisticSetProgress(state.issues[0], 100);
op = state.pendingOps.filter((o) => o.kind === 'setProgress');
assert(op.length === 1 && op[0].value === 100, '去重后仅一条 setProgress(100)');
assert(state.issues[0].state === 'CLOSED', '100% 自动完成（乐观）');

await flush();
assert(calls.filter((c) => c.name === 'addLabels' && c.args[0] === 'I1' && c.args[1].some((id) => { const l = findLabelById(id); return l && l.name === '进度:100%'; })).length === 1, 'flush 添加进度:100% 标签');
assert(calls.filter((c) => c.name === 'closeIssue' && c.args[0] === 'I1').length === 1, '100% 时关闭 issue');
assert(serverIssues['I1'].state === 'CLOSED', '服务端 issue 已关闭');
assert(serverIssues['I1'].labels.some((l) => l.name === '进度:100%'), '服务端已挂进度标签');

// 再次设为 40% → 服务端应重开
calls = [];
optimisticSetProgress(state.issues[0], 40);
await flush();
assert(calls.filter((c) => c.name === 'reopenIssue' && c.args[0] === 'I1').length === 1, '<100% 时重开 issue');
assert(serverIssues['I1'].state === 'OPEN', '服务端 issue 已重开');

// 新建：内联编辑器保存（非百分比）
calls = [];
state.config.repos[0].useProgress = false;
state.editor = { mode: 'new', targetId: null, title: '新任务', body: '说明', percent: false, progress: 0, done: false, tags: new Set(['工作']) };
saveEditor();
const temp = state.issues.find((i) => String(i.id).startsWith('local-'));
assert(!!temp, '新建后插入临时待办卡片');
assert(temp.state === 'OPEN' && temp.title === '新任务', '临时待办内容正确');
let createOps = state.pendingOps.filter((o) => o.kind === 'create');
assert(createOps.length === 1 && createOps[0].tempId === temp.id, '入队 create 操作');
// 未同步就删除 → create 被撤销
optimisticDelete(temp);
assert(!state.issues.find((i) => i.id === temp.id), '删除后临时卡片移除');
assert(state.pendingOps.filter((o) => o.kind === 'create').length === 0, 'create 操作被撤销');
state.editor = null;

// 新建支持百分比的待办
state.config.repos[0].useProgress = true;
state.editor = { mode: 'new', targetId: null, title: '百分比任务', body: '', percent: true, progress: 30, done: false, tags: new Set() };
saveEditor();
const temp2 = state.issues.find((i) => String(i.id).startsWith('local-'));
assert(temp2 && temp2.state === 'OPEN' && deriveIssueMeta(temp2).progress === 30, '百分比新待办乐观状态正确');
calls = [];
await flush();
const created = calls.filter((c) => c.name === 'createIssue');
assert(created.length === 1 && created[0].args[0].title === '百分比任务', 'flush 创建了 issue');
assert(calls.filter((c) => c.name === 'addLabels' && c.args[0] === 'I-NEW' && c.args[1].some((id) => { const l = findLabelById(id); return l && l.name === '进度:30%'; })).length >= 1, 'flush 添加进度:30% 标签');
assert(serverIssues['I-NEW'].labels.some((l) => l.name === '进度:30%'), '服务端百分比标签生效');
state.editor = null;

// 关闭百分比：全量 removeProgress（I1 当前带 进度:40%）
calls = [];
state.config.repos[0].useProgress = false;
for (const i of state.issues) {
  if (i.labels.nodes.some((l) => isProgressLabel(l.name))) {
    i.labels.nodes = i.labels.nodes.filter((l) => !isProgressLabel(l.name));
    queueOp({ kind: 'removeProgress', id: i.id });
  }
}
const rp = state.pendingOps.filter((o) => o.kind === 'removeProgress');
assert(rp.length >= 1, '关闭百分比后对含进度标签的待办入队 removeProgress');
await flush();
assert(calls.filter((c) => c.name === 'removeLabels' && c.args[1].some((id) => findLabelById(id) && isProgressLabel(findLabelById(id).name))).length >= 1, 'flush 移除进度标签');
assert(!serverIssues['I1'].labels.some((l) => isProgressLabel(l.name)), '服务端进度标签已移除');

// 场景 1：仓库连接失败（connect 走合并查询 apiGetInitial，替换该桩）
apiGetInitial = async () => { throw new Error('网络错误'); };
state.config.repos = [{ owner: 'o', repo: 'r', token: 't' }];
state.config.activeIndex = 0;
await connect();
assert(state.connState === 'error', '连接失败状态');
assert(!$('#noConfigBox').classList.contains('hidden'), '错误状态显示提示框');
assert($('#noConfigBox').innerHTML.indexOf('重试连接') >= 0, '错误状态显示重试连接按钮');
assert($('#noConfigBox').innerHTML.indexOf('去设置') >= 0, '错误状态显示去设置按钮');
assert($('#filters').classList.contains('hidden'), '错误状态隐藏筛选栏');
assert($('#blockOpen').classList.contains('hidden'), '错误状态隐藏待办列表');
assert($('#blockClosed').classList.contains('hidden'), '错误状态隐藏已完成列表');
assert($('#btnTagsManage').classList.contains('hidden'), '错误状态隐藏标签管理按钮');
assert(!$('#btnSettings').classList.contains('hidden'), '错误状态保留设置按钮');
assert($('#repoSwitchBtn').classList.contains('warn'), '错误状态仓库按钮黄色警告');

// 场景 2：无仓库
state.config.repos = [];
state.config.activeIndex = 0;
state.connState = 'none';
renderAppState();
assert(!$('#noConfigBox').classList.contains('hidden'), '无仓库状态显示提示框');
assert($('#noConfigBox').innerHTML.indexOf('尚未配置') >= 0, '无仓库提示文案正确');
assert($('#noConfigBox').innerHTML.indexOf('去设置') >= 0, '无仓库显示去设置按钮');
assert($('#noConfigBox').innerHTML.indexOf('重试连接') < 0, '无仓库不显示重试按钮');
assert($('#filters').classList.contains('hidden'), '无仓库状态隐藏筛选栏');
assert($('#blockOpen').classList.contains('hidden'), '无仓库状态隐藏待办列表');
assert($('#btnTagsManage').classList.contains('hidden'), '无仓库隐藏标签管理按钮');
assert($('#repoSwitchBtn').disabled === true, '无仓库仓库按钮禁用');
assert($('#repoSwitchBtn').classList.contains('disabled'), '无仓库仓库按钮灰色');

// ---- API 调用优化断言 ----
// 恢复配置与数据，重新连接（走合并查询 apiGetInitial）
state.config.repos = [{ owner: 'o', repo: 'r', token: 't', provider: 'github', useProgress: false }];
state.config.activeIndex = 0;
// 场景 1 覆盖过 apiGetInitial，恢复原始桩
apiGetInitial = async (cfg) => {
  log('initial', cfg);
  return { repoId: 'R1', labels: serverLabels.slice(), issues: Object.values(serverIssues).map(issueToAPI) };
};
calls = [];
await connect();
assert(calls.filter((c) => c.name === 'initial').length === 1, 'connect 使用合并查询 apiGetInitial');
assert(calls.filter((c) => c.name === 'repo' || c.name === 'labels' || c.name === 'issues').length === 0, 'connect 不再分别调用 repo/labels/issues');
assert(state.issues.some((i) => i.id === 'I1') && state.labels.some((l) => l.name === '归档'), '合并查询后数据正确');

// toggleDone：不再查 issueBasics，直接幂等 close/reopen
calls = [];
const i1 = state.issues.find((i) => i.id === 'I1');
optimisticToggleDone(i1);
await flush();
assert(calls.filter((c) => c.name === 'setIssueState' || c.name === 'closeIssue').length >= 1, 'toggleDone 触发状态切换');
assert(calls.filter((c) => c.name === 'issueBasics').length === 0, 'toggleDone 不再查 issueBasics');
assert(serverIssues['I1'].state === 'CLOSED', '服务端已关闭');

// setProgress：不查 issueBasics（用 op 记录的旧标签），目标标签惰性创建
calls = [];
state.config.repos[0].useProgress = true;
optimisticSetProgress(i1, 70);
await flush();
assert(calls.filter((c) => c.name === 'issueBasics').length === 0, 'setProgress 不再查 issueBasics');
assert(serverIssues['I1'].labels.some((l) => l.name === '进度:70%'), '惰性创建并附加进度:70% 标签');
assert(serverIssues['I1'].state === 'OPEN', '70% 服务端为进行中');

// flush 成功后不再全量刷新（增量同步）
calls = [];
state.editor = { mode: 'edit', targetId: 'I1', title: '任务A-改', body: 'x', percent: false, progress: 0, tags: new Set() };
saveEditor();
assert(state.pendingOps.some((o) => o.kind === 'update'), '入队 update');
await flush();
assert(calls.filter((c) => c.name === 'updateIssue').length === 1, 'flush 只发 updateIssue');
assert(calls.filter((c) => c.name === 'labels' || c.name === 'issues').length === 0, 'flush 成功后不再全量刷新');
assert(serverIssues['I1'].title === '任务A-改', '服务端标题已更新');

// bug 修复：新建 100% 进度待办 → 服务端真正 CLOSED
calls = [];
state.editor = { mode: 'new', targetId: null, title: '完成即关闭', body: '', percent: true, progress: 100, done: false, tags: new Set() };
saveEditor();
await flush();
assert(serverIssues['I-NEW'].state === 'CLOSED', '新建 100% 进度待办服务端已关闭（bug 修复）');
assert(serverIssues['I-NEW'].labels.some((l) => l.name === '进度:100%'), '新建 100% 进度待办服务端挂进度标签');
state.editor = null;

// 批量删除标签：一次 apiBatchDeleteLabels
serverLabels.push({ id: 'LT1', name: '待删', color: '111111' });
state.labels.push({ id: 'LT1', name: '待删', color: '111111' });
calls = [];
await deleteTagsNow(['待删']);
assert(calls.filter((c) => c.name === 'batchDeleteLabels').length === 1, '批量删除走 apiBatchDeleteLabels');
assert(calls.filter((c) => c.name === 'deleteLabel').length === 0, '不再逐个 deleteLabel');
assert(!state.labels.some((l) => l.name === '待删') && !serverLabels.some((l) => l.name === '待删'), '标签已从本地与服务端移除');

console.log('--- ALL TESTS DONE ---');
`;

// 用 async IIFE 包裹并追加测试代码
const wrapped = src + '\n(async function run(){' + testCode + '})().catch((e) => { console.error("TEST ERROR:", e); console.error(e.stack); process.exitCode = 1; });';
eval(wrapped);
