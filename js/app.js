/* 应用主逻辑：多仓库、百分比、内联编辑、本地优先 + 5 分钟自动同步 */
'use strict';

const AUTO_SAVE_MS = 5 * 60 * 1000; // 自动保存间隔（debounce）

const state = {
  config: { repos: [], activeIndex: 0, settings: { useProgress: false } },
  labels: [],   // 当前仓库全部标签
  issues: [],   // 当前仓库全部 issue
  connState: 'none', // 'none'(无仓库) | 'error'(连接失败) | 'ok'(已连接)
  connError: '',
  filterOptionsOpen: false,
  loading: false,
  filters: {
    keyword: '',
    selectedTags: [],
    tagMatchMode: 'any',
    timeField: 'created',
    startDate: '',
    endDate: '',
    showArchived: false,
  },
  // 内联编辑卡片
  editor: null, // {mode:'new'|'edit', targetId, title, body, percent, progress, done, tags:Set}
  // 标签弹窗上下文
  tagContext: null,  // {mode:'global'|'issue'|'editor', issueId?}
  tagPendingDeletes: new Set(),
  tagSystemOpen: false,
  // 同步
  pendingOps: [],
  autoSaveTimer: null,
  autoSaveDueAt: 0,
  flushing: false,
  progressPopoverFor: null,
  // 设置弹窗：正在编辑的仓库卡片
  repoCardEdit: null, // null | {mode:'edit',index} | {mode:'add'}
};

const $ = (sel) => document.querySelector(sel);

/* ---------------- 基础工具 ---------------- */

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function genTempId() {
  return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}
function isTempId(id) { return String(id).startsWith('local-'); }

function mkProgressLabel(value) {
  return { id: 'local-progress', name: APP_CONFIG.PROGRESS_PREFIX + value + '%', color: APP_CONFIG.LABEL_COLORS.progress };
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/* ---------------- 配置（多仓库） ---------------- */

function defaultConfig() {
  return { repos: [], activeIndex: 0, rememberToken: true };
}

/* 从存储读取配置；token 若为密文则尝试解密，解密失败（会话密钥缺失）置空待用户重填 */
async function loadConfig() {
  try {
    const raw = localStorage.getItem(APP_CONFIG.STORAGE_KEY);
    if (!raw) return defaultConfig();
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.repos)) {
      // 旧版本全局 settings.useProgress 迁移到每个仓库
      const oldGlobal = !!(obj.settings && obj.settings.useProgress);
      const key = await getTokenKey();
      const repos = [];
      for (const r of obj.repos) {
        let token = r.token || '';
        if (isEncryptedToken(token)) {
          token = key ? await decryptToken(token, key) : '';
          if (!token) console.warn('Token 无法解密（会话密钥缺失或已更换），请在设置中重新填写');
        }
        repos.push({
          provider: r.provider || 'github',
          baseUrl: r.baseUrl || null,
          owner: r.owner, repo: r.repo, token,
          useProgress: r.useProgress != null ? !!r.useProgress : oldGlobal,
        });
      }
      return {
        repos,
        activeIndex: obj.activeIndex != null ? obj.activeIndex : 0,
        rememberToken: obj.rememberToken !== false, // 旧数据默认记住，兼容升级
      };
    }
    // 旧格式 {owner,repo,token} 迁移
    if (obj && obj.owner) {
      return { repos: [{ provider: 'github', baseUrl: null, owner: obj.owner, repo: obj.repo, token: obj.token || '', useProgress: false }], activeIndex: 0, rememberToken: true };
    }
    return defaultConfig();
  } catch (e) {
    return defaultConfig();
  }
}

/* 保存配置：token 以 AES-GCM 密文落盘；串行队列避免并发写竞态 */
let saveConfigChain = Promise.resolve();
function saveConfig() {
  saveConfigChain = saveConfigChain.then(() => doSaveConfig()).catch((e) => console.error('保存配置失败', e));
}

async function doSaveConfig() {
  const cfg = state.config;
  const clone = JSON.parse(JSON.stringify(cfg));
  const key = await getOrCreateTokenKey();
  if (key) {
    if (cfg.rememberToken !== false) persistTokenKey();
    else forgetPersistedTokenKey();
    for (const r of clone.repos) {
      if (r.token) r.token = await encryptToken(r.token, key);
    }
  } else {
    console.warn('当前环境不支持 WebCrypto，Token 将以明文保存在 localStorage（建议通过 HTTPS 访问）');
  }
  localStorage.setItem(APP_CONFIG.STORAGE_KEY, JSON.stringify(clone));
}

function currentRepoConfig() {
  const repos = state.config.repos;
  if (!repos || !repos.length) return null;
  return repos[state.config.activeIndex] || repos[0];
}

/* 从仓库 URL 解析 owner/repo 与 gitea 服务器地址 */
function parseRepoUrl(url) {
  const m = String(url || '').trim().match(/^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+?)\/?$/);
  if (!m) return null;
  return { baseUrl: m[1].replace(/\/+$/, ''), owner: m[2], repo: m[3] };
}

/* ---------------- 提示 / 加载 ---------------- */

function toast(msg, isError) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' toast-error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

function setLoading(loading) {
  state.loading = loading;
  $('#loading').classList.toggle('hidden', !loading);
}

function openModal(modal) { modal.classList.remove('hidden'); }
function closeModal(modal) { modal.classList.add('hidden'); }

function renderAppState() {
  const ok = state.connState === 'ok';
  // 筛选栏 / 待办区块 / 顶部按钮：仅连接成功后显示
  $('#filters').classList.toggle('hidden', !ok);
  $('#blockOpen').classList.toggle('hidden', !ok);
  $('#blockClosed').classList.toggle('hidden', !ok);
  // 归档开关 / 同步 / 新建已位于筛选面板内，随 filters 一起显隐
  $('#btnTagsManage').classList.toggle('hidden', !ok);

  renderRepoInfo();

  const box = $('#noConfigBox');
  if (ok) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  const retry = state.connState === 'error';
  box.innerHTML = `
    <p>${retry
      ? '仓库连接失败：' + escapeHTML(state.connError || '未知错误') + '。请检查网络连接后重试，或添加其他可用仓库。'
      : '尚未配置 GitHub 仓库。请添加仓库并填写访问令牌以开始使用。'}</p>
    <div class="no-config-actions">
      ${retry ? '<button type="button" class="btn" id="btnRetryConnect">重试连接</button>' : ''}
      <button type="button" class="btn btn-primary" id="btnNoConfigSetup">去设置</button>
    </div>`;
  const retryBtn = $('#btnRetryConnect');
  if (retryBtn) retryBtn.addEventListener('click', connect);
  $('#btnNoConfigSetup').addEventListener('click', openSetupModal);
}

/* ---------------- 数据加载 ---------------- */

async function ensureSpecialLabels(cfg, labels) {
  const existing = new Set(labels.map((l) => l.name));
  const need = [APP_CONFIG.ARCHIVE_TAG];
  if (cfg.useProgress) {
    for (let v = 0; v <= APP_CONFIG.PROGRESS_MAX; v += APP_CONFIG.PROGRESS_STEP) {
      need.push(APP_CONFIG.PROGRESS_PREFIX + v + '%');
    }
  }
  for (const n of need) {
    if (existing.has(n)) continue;
    try {
      const color = n === APP_CONFIG.ARCHIVE_TAG ? APP_CONFIG.LABEL_COLORS.archive : APP_CONFIG.LABEL_COLORS.progress;
      const l = await apiCreateLabel(cfg, cfg.repoId, n, color);
      labels.push(l);
    } catch (e) {
      console.warn('创建系统标签失败: ' + n, e);
    }
  }
  return labels;
}

async function connect() {
  const cfg = currentRepoConfig();
  if (!cfg) {
    state.connState = 'none';
    renderAppState();
    return;
  }
  setLoading(true);
  try {
    const repo = await apiGetRepo(cfg);
    cfg.repoId = repo.id;
    const labels = await apiGetLabels(cfg);
    state.labels = await ensureSpecialLabels(cfg, labels);
    state.issues = await apiGetIssues(cfg);
    state.connState = 'ok';
    state.connError = '';
    render();
    renderAppState();
  } catch (e) {
    state.connState = 'error';
    state.connError = e.message;
    renderAppState();
    toast('连接失败: ' + e.message, true);
  } finally {
    setLoading(false);
  }
}

async function refresh() {
  const cfg = currentRepoConfig();
  if (!cfg) return;
  const labels = await apiGetLabels(cfg);
  state.labels = await ensureSpecialLabels(cfg, labels);
  state.issues = await apiGetIssues(cfg);
  render();
}

/* ---------------- 同步：操作队列 + debounce 自动保存 ---------------- */

function queueOp(op) {
  // 同类操作按 (kind,id) 去重，只保留最新一次
  if (['update', 'setProgress', 'toggleDone', 'setTags', 'archive', 'removeProgress'].includes(op.kind)) {
    state.pendingOps = state.pendingOps.filter((o) => !(o.kind === op.kind && o.id === op.id));
  }
  // 新建后立即删除：撤销 create 操作
  if (op.kind === 'delete' && isTempId(op.id)) {
    state.pendingOps = state.pendingOps.filter((o) => !(o.kind === 'create' && o.tempId === op.id));
  }
  state.pendingOps.push(op);
  scheduleAutoSave();
}

function scheduleAutoSave() {
  clearTimeout(state.autoSaveTimer);
  state.autoSaveDueAt = Date.now() + AUTO_SAVE_MS;
  state.autoSaveTimer = setTimeout(flush, AUTO_SAVE_MS);
  renderSyncButton();
}

async function applyProgressLabel(cfg, apiId, value, basics) {
  if (!basics) basics = await apiGetIssueBasics(cfg, apiId);
  const cur = (basics.labels || []).filter((l) => isProgressLabel(l.name));
  if (cur.length) await apiRemoveLabels(cfg, apiId, cur.map((l) => l.id));
  const targetName = APP_CONFIG.PROGRESS_PREFIX + value + '%';
  let label = state.labels.find((l) => l.name === targetName);
  if (!label) {
    label = await apiCreateLabel(cfg, cfg.repoId, targetName, APP_CONFIG.LABEL_COLORS.progress);
    state.labels.push(label);
  }
  await apiAddLabels(cfg, apiId, [label.id]);
  return basics;
}

async function execOp(op, idMap) {
  const cfg = currentRepoConfig();
  if (!cfg) throw new Error('未配置仓库');
  const apiId = op.kind === 'create' ? null : (idMap[op.id] || op.id);
  switch (op.kind) {
    case 'create': {
      const labelIds = op.labels.map((n) => state.labels.find((l) => l.name === n)).filter(Boolean).map((l) => l.id);
      const issue = await apiCreateIssue(cfg, cfg.repoId, { title: op.title, body: op.body, labelIds });
      if (op.percent) await applyProgressLabel(cfg, issue.id, op.progress);
      if (op.done) await apiCloseIssue(cfg, issue.id);
      idMap[op.tempId] = issue.id;
      if (state.editor && state.editor.mode === 'new' && state.editor.targetId === op.tempId) {
        state.editor.targetId = issue.id; // 刷新后编辑卡片仍指向该待办
      }
      break;
    }
    case 'update':
      await apiUpdateIssue(cfg, apiId, { title: op.title, body: op.body });
      break;
    case 'toggleDone': {
      const basics = await apiGetIssueBasics(cfg, apiId);
      if (op.done && basics.state !== 'CLOSED') await apiCloseIssue(cfg, apiId);
      if (!op.done && basics.state !== 'OPEN') await apiReopenIssue(cfg, apiId);
      break;
    }
    case 'setProgress': {
      const basics = await applyProgressLabel(cfg, apiId, op.value);
      // 百分比与完成整合（以服务端状态为准）：100% 完成，<100% 进行中
      if (op.value >= 100 && basics.state !== 'CLOSED') await apiCloseIssue(cfg, apiId);
      else if (op.value < 100 && basics.state !== 'OPEN') await apiReopenIssue(cfg, apiId);
      break;
    }
    case 'removeProgress': {
      const basics = await apiGetIssueBasics(cfg, apiId);
      const cur = (basics.labels || []).filter((l) => isProgressLabel(l.name));
      if (cur.length) await apiRemoveLabels(cfg, apiId, cur.map((l) => l.id));
      break;
    }
    case 'setTags': {
      const target = new Set(op.target);
      const baseline = new Set(op.baseline);
      const add = state.labels.filter((l) => !isArchiveLabel(l.name) && !baseline.has(l.name) && target.has(l.name)).map((l) => l.id);
      const remove = state.labels.filter((l) => !isArchiveLabel(l.name) && baseline.has(l.name) && !target.has(l.name)).map((l) => l.id);
      if (add.length) await apiAddLabels(cfg, apiId, add);
      if (remove.length) await apiRemoveLabels(cfg, apiId, remove);
      break;
    }
    case 'archive': {
      const archLabel = state.labels.find((l) => l.name === APP_CONFIG.ARCHIVE_TAG);
      if (!archLabel) throw new Error('「归档」标签不存在');
      if (op.archived) await apiAddLabels(cfg, apiId, [archLabel.id]);
      else await apiRemoveLabels(cfg, apiId, [archLabel.id]);
      break;
    }
    case 'delete':
      await apiDeleteIssue(cfg, apiId);
      break;
  }
}

async function flush() {
  if (state.flushing || !state.pendingOps.length) { renderSyncButton(); return; }
  const cfg = currentRepoConfig();
  if (!cfg) { state.pendingOps = []; toast('未配置仓库，无法同步', true); renderSyncButton(); return; }
  state.flushing = true;
  renderSyncButton();
  const ops = state.pendingOps;
  state.pendingOps = [];
  clearTimeout(state.autoSaveTimer);
  const idMap = {};
  let failedIdx = -1;
  let failedMsg = '';
  for (let i = 0; i < ops.length; i++) {
    try {
      await execOp(ops[i], idMap);
    } catch (e) {
      failedIdx = i;
      failedMsg = e.message;
      break;
    }
  }
  try {
    if (failedIdx >= 0) {
      const remaining = ops.slice(failedIdx);
      state.pendingOps = [...remaining, ...state.pendingOps];
      if (failedIdx > 0) await refresh();
      toast('同步失败：' + failedMsg, true);
    } else {
      await refresh();
      toast('已同步');
    }
  } catch (e) {
    toast('刷新失败：' + e.message, true);
  }
  state.flushing = false;
  renderSyncButton();
}

function renderSyncButton() {
  const btn = $('#btnSync');
  const pending = state.pendingOps.length;
  if (state.flushing) {
    btn.textContent = '同步中…';
    btn.classList.add('pending');
    btn.classList.remove('hidden');
    btn.title = '正在保存';
    return;
  }
  if (pending > 0) {
    const remain = Math.max(0, state.autoSaveDueAt - Date.now());
    const mm = String(Math.floor(remain / 60000)).padStart(2, '0');
    const ss = String(Math.floor((remain % 60000) / 1000)).padStart(2, '0');
    btn.textContent = `同步 ${pending} · ${mm}:${ss}`;
    btn.classList.add('pending');
    btn.classList.remove('hidden');
    btn.title = '自动保存剩余 ' + mm + ':' + ss + '，点击立即保存';
  } else {
    // 无改动时不显示同步按钮
    btn.classList.remove('pending');
    btn.classList.add('hidden');
  }
}

/* ---------------- 乐观更新 ---------------- */

function optimisticToggleDone(issue) {
  const done = issue.state !== 'CLOSED';
  if (done) {
    issue.state = 'CLOSED';
    issue.closedAt = new Date().toISOString();
  } else {
    issue.state = 'OPEN';
    issue.closedAt = null;
  }
  queueOp({ kind: 'toggleDone', id: issue.id, done });
}

function optimisticSetProgress(issue, value) {
  const node = mkProgressLabel(value);
  const idx = issue.labels.nodes.findIndex((l) => isProgressLabel(l.name));
  if (idx >= 0) issue.labels.nodes[idx] = node;
  else issue.labels.nodes.push(node);
  if (value >= 100) {
    if (issue.state !== 'CLOSED') { issue.state = 'CLOSED'; issue.closedAt = new Date().toISOString(); }
  } else if (issue.state === 'CLOSED') {
    issue.state = 'OPEN';
    issue.closedAt = null;
  }
  queueOp({ kind: 'setProgress', id: issue.id, value });
}

function optimisticSetTags(issue, targetNames) {
  const baseline = new Set(issue.labels.nodes.filter((l) => !isProgressLabel(l.name)).map((l) => l.name));
  const system = issue.labels.nodes.filter((l) => isProgressLabel(l.name) || isArchiveLabel(l.name));
  const newLabels = state.labels.filter((l) => targetNames.has(l.name)).map((l) => ({ id: l.id, name: l.name, color: l.color }));
  issue.labels.nodes = [...newLabels, ...system];
  queueOp({ kind: 'setTags', id: issue.id, target: [...targetNames], baseline: [...baseline] });
}

function optimisticArchive(issue) {
  const archLabel = state.labels.find((l) => l.name === APP_CONFIG.ARCHIVE_TAG);
  if (!archLabel) { toast('「归档」标签不存在', true); return; }
  const meta = deriveIssueMeta(issue);
  if (meta.isArchived) {
    issue.labels.nodes = issue.labels.nodes.filter((l) => l.name !== APP_CONFIG.ARCHIVE_TAG);
    queueOp({ kind: 'archive', id: issue.id, archived: false });
    toast('已取消归档');
  } else {
    issue.labels.nodes.push({ id: archLabel.id, name: archLabel.name, color: archLabel.color });
    queueOp({ kind: 'archive', id: issue.id, archived: true });
    toast('已归档（默认隐藏）');
  }
}

function optimisticDelete(issue) {
  if (state.editor && state.editor.targetId === issue.id) state.editor = null;
  state.issues = state.issues.filter((i) => i.id !== issue.id);
  if (isTempId(issue.id)) {
    // 尚未同步到服务端的新建卡片，撤销 create 即可
    state.pendingOps = state.pendingOps.filter((o) => !(o.kind === 'create' && o.tempId === issue.id));
  } else {
    queueOp({ kind: 'delete', id: issue.id });
  }
}

/* ---------------- 渲染 ---------------- */

function render() {
  renderRepoInfo();
  renderFilterChips();
  renderTagFilterBtn();
  syncArchiveToggle();
  renderBlocks();
  renderSyncButton();
}

function renderRepoInfo() {
  const cfg = currentRepoConfig();
  const btn = $('#repoSwitchBtn');
  const none = state.connState === 'none';
  const error = state.connState === 'error';
  const label = (error ? '⚠ ' : '') + (cfg ? `${cfg.owner} / ${cfg.repo} ▾` : '未连接仓库 ▾');
  btn.textContent = label;
  btn.classList.toggle('warn', error);
  btn.classList.toggle('disabled', none);
  btn.disabled = none;
  btn.title = none
    ? '尚未添加仓库'
    : (error ? '仓库连接失败，点击重试或切换' : '切换仓库（当前：' + (cfg ? cfg.owner + '/' + cfg.repo : '') + '）');
  const repos = state.config.repos || [];
  const menu = $('#repoSwitchMenu');
  menu.innerHTML = repos.map((r, idx) => {
    const active = idx === state.config.activeIndex;
    const prov = r.provider === 'gitea'
      ? 'Gitea' + (r.baseUrl ? ' · ' + r.baseUrl.replace(/^https?:\/\//, '') : '')
      : 'GitHub';
    return `<button type="button" class="repo-switch-item${active ? ' active' : ''}" data-switch-repo="${idx}">
      <span class="repo-switch-check">${active ? '✓' : ''}</span>
      <span class="repo-switch-name">${escapeHTML(r.owner)} / ${escapeHTML(r.repo)}</span>
      <span class="repo-switch-prov">${escapeHTML(prov)}</span>
    </button>`;
  }).join('') +
    '<button type="button" class="repo-switch-item manage" data-switch-manage>管理仓库…</button>';
}

function renderFilterChips() {
  const labels = state.labels
    .filter((l) => !isProgressLabel(l.name))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  const el = $('#tagFilterMenu');
  el.innerHTML = labels.length
    ? labels.map((l) => {
        const checked = state.filters.selectedTags.includes(l.name) ? 'checked' : '';
        return `<label class="dd-option" style="--tag-color:#${l.color}">
          <input type="checkbox" data-tag="${escapeHTML(l.name)}" ${checked}>
          <span class="dot"></span>${escapeHTML(l.name)}
        </label>`;
      }).join('')
    : '<div class="card-time" style="padding:8px">无标签</div>';
}

function renderTagFilterBtn() {
  const n = state.filters.selectedTags.length;
  $('#tagFilterBtn').textContent = n ? `标签筛选 · ${n} ▾` : '标签筛选 ▾';
}

function syncArchiveToggle() {
  const forced = state.filters.selectedTags.includes(APP_CONFIG.ARCHIVE_TAG);
  const t = $('#archiveToggle');
  t.checked = state.filters.showArchived || forced;
  t.disabled = forced;
  t.title = forced
    ? '已在标签筛选中选择「归档」，归档任务随标签筛选联动显示'
    : '已归档任务默认隐藏，开启后显示';
}

function renderBlocks() {
  const filtered = applyFilters(state.issues, state.filters);
  const open = filtered.filter((i) => i.state === 'OPEN');
  const closed = filtered.filter((i) => i.state === 'CLOSED');
  open.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  closed.sort((a, b) => {
    const bt = b.closedAt ? new Date(b.closedAt).getTime() : new Date(b.createdAt).getTime();
    const at = a.closedAt ? new Date(a.closedAt).getTime() : new Date(a.createdAt).getTime();
    return bt - at;
  });
  renderList($('#listOpen'), open, 'open');
  renderList($('#listClosed'), closed, 'closed');
  $('#countOpen').textContent = open.length;
  $('#countClosed').textContent = closed.length;
}

function renderList(el, issues, kind) {
  const ed = state.editor;
  let list = issues;
  // 编辑已有待办时隐藏原卡片，仅显示编辑卡片
  if (ed && ed.mode === 'edit') {
    list = issues.filter((i) => i.id !== ed.targetId);
  }
  let html = list.map(cardHTML);
  if (ed) {
    if (ed.mode === 'new') {
      if (kind === 'open') html.unshift(editorHTML());
    } else if (edInBlock(ed.targetId, kind)) {
      // 编辑已有待办：编辑卡片插回原卡片所在位置，而非列表顶部
      const origIdx = issues.findIndex((i) => i.id === ed.targetId);
      html.splice(Math.min(origIdx, html.length), 0, editorHTML());
    }
  }
  if (html.length) {
    el.innerHTML = html.join('');
  } else {
    el.innerHTML = `<div class="empty">暂无${kind === 'open' ? '未完成' : '已完成'}任务${hasActiveFilters() ? '（受当前筛选影响）' : ''}</div>`;
  }
}

function hasActiveFilters() {
  const f = state.filters;
  return !!(f.keyword || f.selectedTags.length || f.startDate || f.endDate);
}

function edInBlock(id, kind) {
  const issue = state.issues.find((i) => i.id === id);
  if (!issue) return kind === 'open';
  return (issue.state === 'OPEN') === (kind === 'open');
}

/* ---------------- 卡片渲染 ---------------- */

function cardHTML(issue) {
  const meta = deriveIssueMeta(issue);
  const closed = issue.state === 'CLOSED';
  const cfg = currentRepoConfig();
  const usePercent = cfg && cfg.useProgress && meta.percent;
  const leftHTML = usePercent ? ringHTML(issue, meta) : checkBtnHTML(closed);
  const tagsHTML = meta.tags.map((t) => {
    const cls = t.name === APP_CONFIG.ARCHIVE_TAG ? 'tag tag-archived' : 'tag';
    return `<span class="${cls}" style="--tag-color:#${t.color}">${escapeHTML(t.name)}</span>`;
  }).join('');

  return `
  <article class="task-card${closed ? ' task-card-closed' : ''}" data-id="${issue.id}">
    <div class="card-left">${leftHTML}</div>
    <div class="card-main">
      <div class="card-title">${escapeHTML(issue.title)}</div>
      ${issue.body ? `<div class="card-body-text">${escapeHTML(issue.body)}</div>` : ''}
      <div class="card-meta">
        ${meta.tags.length ? `<span class="card-tags">${tagsHTML}</span>` : ''}
        <span class="card-time">创建 ${fmtDate(issue.createdAt)}</span>
        ${closed && issue.closedAt ? `<span class="card-time">完成 ${fmtDate(issue.closedAt)}</span>` : ''}
        ${issue.number ? `<span class="card-number"><a href="${escapeHTML(issue.url)}" target="_blank" rel="noopener" title="在 GitHub 打开">#${issue.number}</a></span>` : ''}
      </div>
    </div>
    <div class="card-actions">
      <button class="btn-link" data-act="tags" title="直接添加标签">+ 标签</button>
      <button class="btn-link" data-act="edit">编辑</button>
    </div>
  </article>`;
}

function checkBtnHTML(closed) {
  return `<button type="button" class="check-btn${closed ? ' checked' : ''}" data-act="toggle"
    title="${closed ? '标记为未完成' : '标记为已完成'}">${closed ? '✓' : ''}</button>`;
}

function ringHTML(issue, meta) {
  const p = meta.progress;
  const C = (2 * Math.PI * 15.5).toFixed(2);
  const off = (C * (1 - p / 100)).toFixed(2);
  const done = issue.state === 'CLOSED';
  return `<button type="button" class="ring-btn" data-ring="${issue.id}"
    title="百分比 ${p}%（点击调整）">
    <svg viewBox="0 0 36 36">
      <circle class="ring-bg" cx="18" cy="18" r="15.5"></circle>
      <circle class="ring-fill${done ? ' ring-full' : ''}" cx="18" cy="18" r="15.5"
        stroke-dasharray="${C}" stroke-dashoffset="${off}"></circle>
      <text x="18" y="20.5" text-anchor="middle" class="ring-text">${p}%</text>
    </svg>
  </button>`;
}

/* ---------------- 内联编辑卡片 ---------------- */

function openEditor(issue) {
  const meta = deriveIssueMeta(issue);
  const useProgress = !!(currentRepoConfig() && currentRepoConfig().useProgress);
  state.editor = {
    mode: 'edit',
    targetId: issue.id,
    title: issue.title,
    body: issue.body || '',
    percent: useProgress && meta.percent,
    progress: meta.progress,
    tags: new Set(meta.tags.filter((t) => !isArchiveLabel(t.name)).map((t) => t.name)),
  };
  render();
}

function openEditorNew() {
  if (state.editor && state.editor.mode === 'new') {
    toast('已有一个新建中的待办');
    return;
  }
  state.editor = {
    mode: 'new', targetId: null, title: '', body: '',
    percent: false, progress: 0, tags: new Set(),
  };
  render();
  // 聚焦标题输入框
  requestAnimationFrame(() => {
    const el = $('#editorTitle');
    if (el) el.focus();
  });
}

function editorHTML() {
  const ed = state.editor;
  if (!ed) return '';
  const useProgress = !!(currentRepoConfig() && currentRepoConfig().useProgress);
  const tagsChips = [...ed.tags].map((n) =>
    `<span class="tag">${escapeHTML(n)} <button type="button" class="tag-x" data-remove-tag="${escapeHTML(n)}" title="移除">×</button></span>`
  ).join('');
  const editActions = ed.mode === 'edit'
    ? (() => {
        const issue = state.issues.find((i) => i.id === ed.targetId);
        const isArch = issue ? deriveIssueMeta(issue).isArchived : false;
        // 必须先归档再删除：未归档显示「归档」，已归档显示「删除」；均为红色危险按钮
        return `<button class="btn btn-danger" data-act="editor-archive-delete">${isArch ? '删除' : '归档'}</button>`;
      })()
    : '';
  return `
  <article class="task-card editor-card">
    <div class="card-main">
      <input type="text" class="editor-title" id="editorTitle" value="${escapeHTML(ed.title)}" placeholder="待办标题">
      <textarea class="editor-body" id="editorBody" rows="2" placeholder="描述（可选）">${escapeHTML(ed.body)}</textarea>
      <div class="editor-meta">
        <span class="editor-tags">${tagsChips || '<span class="card-time">无标签</span>'}</span>
        <button type="button" class="btn-link" data-act="editor-tags">+ 标签</button>
        ${useProgress ? `<label class="editor-inline"><input type="checkbox" id="editorPercent"${ed.percent ? ' checked' : ''}> 支持百分比</label>` : ''}
      </div>
      ${ed.percent ? `<div class="editor-progress"><span>进度</span>
        <div class="progress-field">
          <input type="range" id="editorProgress" min="0" max="100" step="10" value="${ed.progress}">
          <span id="editorProgressLabel">${ed.progress}%</span>
        </div>
      </div>` : ''}
    </div>
    <div class="card-actions">
      <button class="btn btn-primary" data-act="editor-save">保存</button>
      <button class="btn" data-act="editor-cancel">取消</button>
      ${editActions}
    </div>
  </article>`;
}

function cancelEditor() {
  state.editor = null;
  render();
}

function saveEditor() {
  const ed = state.editor;
  if (!ed) return;
  const title = ed.title.trim();
  if (!title) { toast('请输入标题', true); return; }
  const useProgress = !!(currentRepoConfig() && currentRepoConfig().useProgress);

  if (ed.mode === 'new') {
    const tempId = genTempId();
    const issue = {
      id: tempId, number: 0, title,
      body: ed.body, state: 'OPEN',
      createdAt: new Date().toISOString(), closedAt: null,
      url: '#', labels: { nodes: [] },
    };
    if (ed.percent) {
      issue.labels.nodes.push(mkProgressLabel(ed.progress));
      if (ed.progress >= 100) { issue.state = 'CLOSED'; issue.closedAt = new Date().toISOString(); }
    }
    state.issues.unshift(issue);
    queueOp({
      kind: 'create', tempId,
      title, body: ed.body,
      labels: [...ed.tags],
      percent: ed.percent,
      progress: ed.percent ? ed.progress : 0,
      done: false,
    });
  } else {
    const issue = state.issues.find((i) => i.id === ed.targetId);
    if (!issue) { state.editor = null; render(); return; }
    const meta0 = deriveIssueMeta(issue);
    issue.title = title;
    issue.body = ed.body;
    queueOp({ kind: 'update', id: issue.id, title, body: ed.body });

    // 标签
    const curTags = new Set(meta0.tags.filter((t) => !isArchiveLabel(t.name)).map((t) => t.name));
    if (!setsEqual(curTags, ed.tags)) optimisticSetTags(issue, new Set(ed.tags));

    // 百分比支持（仅当仓库开启百分比时才允许调整）
    const wantPercent = useProgress && ed.percent;
    if (wantPercent && !meta0.percent) {
      optimisticSetProgress(issue, ed.progress);
    } else if (useProgress && !wantPercent && meta0.percent) {
      issue.labels.nodes = issue.labels.nodes.filter((l) => !isProgressLabel(l.name));
      queueOp({ kind: 'removeProgress', id: issue.id });
    } else if (wantPercent && meta0.percent && ed.progress !== meta0.progress) {
      optimisticSetProgress(issue, ed.progress);
    }
  }

  state.editor = null;
  render();
  toast('已保存（待自动同步）');
}

/* ---------------- 进度圆环 / 滑动选择 ---------------- */

function openProgressPopover(issueId, anchor) {
  const issue = state.issues.find((i) => i.id === issueId);
  if (!issue) return;
  const meta = deriveIssueMeta(issue);
  if (!meta.percent || !(currentRepoConfig() && currentRepoConfig().useProgress)) return;
  const grid = $('#progressPopoverGrid');
  grid.innerHTML = `
    <div class="progress-field">
      <input type="range" id="popProgress" min="0" max="100" step="10" value="${meta.progress}">
      <span id="popProgressLabel">${meta.progress}%</span>
    </div>`;
  const pop = $('#progressPopover');
  const rect = anchor.getBoundingClientRect();
  pop.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';
  pop.style.top = (rect.bottom + 6) + 'px';
  pop.classList.remove('hidden');
  state.progressPopoverFor = issueId;
}

function closeProgressPopover() {
  $('#progressPopover').classList.add('hidden');
  state.progressPopoverFor = null;
}

/* ---------------- 标签弹窗 ---------------- */

function openTagModalForIssue(issueId) {
  state.tagContext = { mode: 'issue', issueId };
  prepareTagModal('为待办选择标签。');
}

function openTagModalForEditor() {
  const ed = state.editor;
  const editMode = !!(ed && ed.mode === 'edit');
  state.tagContext = { mode: 'editor', editMode, issueId: editMode ? ed.targetId : null };
  prepareTagModal(editMode ? '编辑待办的标签（保存后立即生效）。' : '为新建待办选择标签。');
}

function openTagModalGlobal() {
  state.tagContext = { mode: 'global' };
  prepareTagModal('管理仓库中的标签。删除操作标记后点击「保存」统一生效，可点「恢复」撤销。');
}

function prepareTagModal(note) {
  state.tagPendingDeletes = new Set();
  state.tagSystemOpen = false;
  $('#tagModalNote').textContent = note;
  renderTagManager();
  $('#tagMsg').textContent = '';
  openModal($('#tagModal'));
}

function renderTagManager() {
  const el = $('#tagList');
  const ctx = state.tagContext;
  const labels = state.labels.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  const isSystem = (l) => isProgressLabel(l.name) || isArchiveLabel(l.name);

  if (!ctx || ctx.mode === 'global') {
    // 全局管理：非系统标签（多选框隐藏），系统标签默认折叠
    const sys = labels.filter(isSystem);
    const normal = labels.filter((l) => !isSystem(l));
    const pending = state.tagPendingDeletes;
    const normalRows = normal.map((l) => {
      const dim = pending.has(l.name);
      const row = `<div class="tag-manage-row${dim ? ' tag-row-dim' : ''}">
        <span class="dot" style="background:#${l.color}"></span>
        <span class="tag-name">${escapeHTML(l.name)}</span>
        <button type="button" class="btn-link danger" data-del-label="${escapeHTML(l.name)}">${dim ? '恢复' : '删除'}</button>
      </div>`;
      return { name: l.name, dim, row };
    });
    // 待删除置顶（保持标记顺序），其余按名称排序
    const top = normalRows.filter((r) => r.dim);
    const rest = normalRows.filter((r) => !r.dim).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    let html = '';
    if (sys.length) {
      html += `<button type="button" class="fold-bar" id="sysFoldBar">${state.tagSystemOpen ? '▾' : '▸'} 系统标签（${sys.length}）</button>`;
      if (state.tagSystemOpen) {
        html += sys.map((l) => `<div class="tag-manage-row">
          <span class="dot" style="background:#${l.color}"></span>
          <span class="tag-name">${escapeHTML(l.name)}</span>
          <span class="sys-badge">系统</span>
        </div>`).join('');
      }
    }
    html += top.map((r) => r.row).join('') + rest.map((r) => r.row).join('');
    el.innerHTML = html || '<div class="card-time">（无标签）</div>';
    const fold = $('#sysFoldBar');
    if (fold) fold.addEventListener('click', () => { state.tagSystemOpen = !state.tagSystemOpen; renderTagManager(); });
    return;
  }

  // 待办 / 编辑器模式：只显示非系统标签的多选，无删除按钮
  const issue = ctx.mode === 'issue' ? state.issues.find((i) => i.id === ctx.issueId) : null;
  const selected = ctx.mode === 'issue'
    ? (issue ? new Set(deriveIssueMeta(issue).tags.filter((t) => !isArchiveLabel(t.name)).map((t) => t.name)) : new Set())
    : new Set(state.editor ? state.editor.tags : []);
  const rows = labels.filter((l) => !isSystem(l)).map((l) => {
    const checked = selected.has(l.name) ? ' checked' : '';
    return `<div class="tag-manage-row">
      <input type="checkbox" data-tag-check data-tag-name="${escapeHTML(l.name)}"${checked}>
      <span class="dot" style="background:#${l.color}"></span>
      <span class="tag-name">${escapeHTML(l.name)}</span>
    </div>`;
  }).join('');
  el.innerHTML = rows || '<div class="card-time">（暂无可用标签，可在全局标签管理中创建）</div>';
}

function collectTagModalSelection() {
  const s = new Set();
  $('#tagList').querySelectorAll('input[data-tag-check]:checked').forEach((cb) => s.add(cb.dataset.tagName));
  return s;
}

async function addNewTag() {
  const name = $('#newTagName').value.trim();
  const color = $('#newTagColor').value.replace('#', '');
  const cfg = currentRepoConfig();
  if (!cfg) { $('#tagMsg').textContent = '未配置仓库'; return; }
  if (!name) { $('#tagMsg').textContent = '请输入标签名'; return; }
  if (isProgressLabel(name) || isArchiveLabel(name)) { $('#tagMsg').textContent = '该名称是系统保留标签'; return; }
  try {
    const l = await apiCreateLabel(cfg, cfg.repoId, name, color);
    state.labels.push(l);
    renderTagManager();
    renderFilterChips();
    $('#newTagName').value = '';
    $('#tagMsg').textContent = '';
    toast('标签「' + name + '」已创建');
  } catch (e) {
    $('#tagMsg').textContent = e.message;
  }
}

async function deleteTagsNow(names) {
  const cfg = currentRepoConfig();
  if (!cfg) return;
  for (const name of names) {
    const label = state.labels.find((l) => l.name === name);
    if (!label) continue;
    try {
      await apiDeleteLabel(cfg, label.id);
      state.labels = state.labels.filter((l) => l.id !== label.id);
      state.filters.selectedTags = state.filters.selectedTags.filter((n) => n !== label.name);
    } catch (e) {
      toast('删除「' + name + '」失败: ' + e.message, true);
    }
  }
  await refresh();
}

async function tagSave() {
  const ctx = state.tagContext;
  if (!ctx) { closeModal($('#tagModal')); return; }
  if (ctx.mode === 'global') {
    if (state.tagPendingDeletes.size) {
      setLoading(true);
      await deleteTagsNow([...state.tagPendingDeletes]);
      setLoading(false);
      toast('已删除 ' + state.tagPendingDeletes.size + ' 个标签');
    } else {
      toast('没有需要删除的标签');
    }
  } else if (ctx.mode === 'issue') {
    const issue = state.issues.find((i) => i.id === ctx.issueId);
    if (issue) {
      optimisticSetTags(issue, collectTagModalSelection());
      render();
      toast('标签已更新（待自动同步）');
    }
  } else if (ctx.mode === 'editor') {
    if (state.editor) {
      const sel = collectTagModalSelection();
      state.editor.tags = sel;
      // 编辑已有待办时立即应用标签
      if (ctx.editMode && ctx.issueId) {
        const issue = state.issues.find((i) => i.id === ctx.issueId);
        if (issue) optimisticSetTags(issue, sel);
      }
      render();
      toast('标签已' + (ctx.editMode ? '更新（待自动同步）' : '选择'));
    }
  }
  closeModal($('#tagModal'));
  state.tagContext = null;
}

function tagCancel() {
  closeModal($('#tagModal'));
  state.tagContext = null;
  state.tagPendingDeletes = new Set();
}

/* ---------------- 卡片操作 ---------------- */

function onCardAction(issueId, act) {
  if (state.loading) return;
  const issue = state.issues.find((i) => i.id === issueId);
  if (!issue) return;
  switch (act) {
    case 'toggle':
      optimisticToggleDone(issue);
      render();
      break;
    case 'edit':
      openEditor(issue);
      break;
    case 'tags':
      openTagModalForIssue(issue.id);
      break;
    case 'archive':
      optimisticArchive(issue);
      render();
      break;
    case 'delete':
      if (confirm(`确定删除待办「${issue.title}」？此操作不可恢复。`)) {
        optimisticDelete(issue);
        render();
        toast('已删除（待自动同步）');
      }
      break;
  }
}

/* ---------------- 设置弹窗：多仓库 / 应用设置 ---------------- */

function openSetupModal() {
  state.repoCardEdit = null;
  renderSetupModal();
  $('#setupMsg').textContent = '';
  $('#setupMsg').className = '';
  openModal($('#setupModal'));
}

function renderSetupModal() {
  const toggle = $('#rememberTokenToggle');
  if (toggle) toggle.checked = state.config.rememberToken !== false;
  renderRepoCards();
}

function renderRepoCards() {
  const el = $('#repoCards');
  const cfg = state.config;
  const edit = state.repoCardEdit;
  let html = '';
  cfg.repos.forEach((r, idx) => {
    if (edit && edit.mode === 'edit' && edit.index === idx) {
      html += repoEditCardHTML(idx, r);
      return;
    }
    const active = idx === cfg.activeIndex;
    const providerName = r.provider === 'gitea' ? 'Gitea' : 'GitHub';
    const tokenState = r.token ? '已配置' : '未配置';
    html += `<div class="repo-card">
      <div class="repo-head"><strong>${escapeHTML(r.owner)} / ${escapeHTML(r.repo)}</strong>
        <span class="sys-badge">${providerName}</span>
        ${active ? '<span class="sys-badge">当前</span>' : ''}
      </div>
      <div class="repo-meta">Token: ${tokenState} · 百分比: ${r.useProgress ? '开启' : '关闭'}${r.provider === 'gitea' ? ' · ' + escapeHTML(r.baseUrl || '') : ''}</div>
      <div class="repo-actions">
        ${active ? '' : `<button type="button" class="btn" data-repo-connect="${idx}">连接</button>`}
        <button type="button" class="btn" data-repo-edit="${idx}">编辑</button>
        <button type="button" class="btn danger" data-repo-del="${idx}">删除</button>
      </div>
    </div>`;
  });
  if (edit && edit.mode === 'add') html += repoEditCardHTML(-1, { provider: 'github', baseUrl: null, owner: '', repo: '', token: '', useProgress: false });
  if (!cfg.repos.length && !(edit && edit.mode === 'add')) {
    html = '<div class="card-time">尚未配置仓库，点击下方按钮添加。</div>';
  }
  el.innerHTML = html;
}

function repoEditCardHTML(idx, r) {
  const prov = r.provider || 'github';
  const isGitea = prov === 'gitea';
  const urlVal = r.url
    || (isGitea ? (r.baseUrl || '') + '/' + r.owner + '/' + r.repo : 'https://github.com/' + r.owner + '/' + r.repo);
  return `<div class="repo-card repo-edit-card">
    <label>API 格式
      <select data-repo-field="provider">
        <option value="github"${prov === 'github' ? ' selected' : ''}>GitHub GraphQL</option>
        <option value="gitea"${isGitea ? ' selected' : ''}>Gitea REST</option>
      </select>
    </label>
    <label>仓库 URL
      <input type="text" data-repo-field="url" value="${escapeHTML(urlVal)}" placeholder="https://github.com/owner/repo 或 https://gitea.com/owner/repo">
    </label>
    <label>Owner / 用户名
      <input type="text" data-repo-field="owner" value="${escapeHTML(r.owner)}" placeholder="octocat">
    </label>
    <label>仓库名
      <input type="text" data-repo-field="repo" value="${escapeHTML(r.repo)}" placeholder="my-todo">
    </label>
    <label class="gitea-only${isGitea ? '' : ' hidden'}">Gitea 服务器地址（从 URL 自动识别）
      <input type="text" data-repo-field="baseUrl" value="${escapeHTML(r.baseUrl || '')}" placeholder="https://gitea.com">
    </label>
    <label>Personal Access Token
      <input type="password" data-repo-field="token" autocomplete="off" value=""
        placeholder="${idx === -1 ? '必填：github_pat_… / ghp_… / gitea token' : '留空保持不变，输入则覆盖（不会回显旧值）'}">
    </label>
    <label class="checkbox-line">
      <input type="checkbox" data-repo-field="useProgress"${r.useProgress ? ' checked' : ''}> 支持百分比进度
    </label>
    <div class="repo-actions">
      <button type="button" class="btn" data-repo-test="${idx}">测试</button>
      <button type="button" class="btn btn-primary" data-repo-save="${idx}">保存</button>
      <button type="button" class="btn" data-repo-cancel>取消</button>
    </div>
  </div>`;
}

/* 从编辑卡片读取仓库配置（URL 优先，其次 owner/repo + baseUrl） */
function readRepoForm(card) {
  const provider = card.querySelector('[data-repo-field="provider"]').value;
  const url = card.querySelector('[data-repo-field="url"]').value.trim();
  const token = card.querySelector('[data-repo-field="token"]').value.trim();
  const useProgress = card.querySelector('[data-repo-field="useProgress"]').checked;
  let owner = card.querySelector('[data-repo-field="owner"]').value.trim();
  let repo = card.querySelector('[data-repo-field="repo"]').value.trim();
  let baseUrl = null;
  if (url) {
    const parsed = parseRepoUrl(url);
    if (!parsed) return { error: '仓库 URL 格式不正确，应为 https://主机/owner/仓库' };
    owner = parsed.owner;
    repo = parsed.repo;
    baseUrl = provider === 'gitea' ? parsed.baseUrl : null;
  } else if (provider === 'gitea') {
    baseUrl = card.querySelector('[data-repo-field="baseUrl"]').value.trim();
  }
  if (!owner || !repo) return { error: '请填写完整信息' };
  if (provider === 'gitea' && !baseUrl) return { error: '请填写 Gitea 服务器地址或仓库 URL' };
  return { provider, baseUrl, owner, repo, token, useProgress };
}

function saveRepoCard(idx) {
  const card = $('#repoCards').querySelector('.repo-edit-card');
  if (!card) return;
  const msg = $('#setupMsg');
  const form = readRepoForm(card);
  if (form.error) { msg.textContent = form.error; msg.className = ''; return; }
  const oldCfg = idx === -1 ? null : state.config.repos[idx];
  // 编辑模式下 Token 留空 = 保留原 Token（不回显、不覆盖）；新增或原无 Token 则必须填写
  if (!form.token) {
    if (!oldCfg || !oldCfg.token) {
      msg.textContent = '请填写 Personal Access Token'; msg.className = ''; return;
    }
    form.token = oldCfg.token;
  }
  const { owner, repo, token, useProgress } = form;

  const wasActive = idx === state.config.activeIndex;
  const oldUseProgress = oldCfg ? !!oldCfg.useProgress : false;

  // 关闭当前活动仓库的百分比：警告并批量清除进度
  if (wasActive && oldUseProgress && !useProgress) {
    const hasProgress = state.issues.some((i) => i.labels.nodes.some((l) => isProgressLabel(l.name)));
    if (hasProgress && !confirm('关闭百分比后，该仓库进行中的待办将回退为未完成状态，并丢失完成进度。确定关闭吗？')) {
      return; // 用户取消，保持原状
    }
  }

  const wasEmpty = state.config.repos.length === 0;
  const newCfg = form;
  if (idx === -1) {
    state.config.repos.push(newCfg);
  } else {
    state.config.repos[idx] = newCfg;
  }
  saveConfig();
  state.repoCardEdit = null;
  msg.textContent = '';
  renderRepoCards();

  if (wasActive && oldUseProgress && !useProgress) {
    // 确认关闭：清除当前活动仓库所有待办的百分比标签
    for (const i of state.issues) {
      if (i.labels.nodes.some((l) => isProgressLabel(l.name))) {
        i.labels.nodes = i.labels.nodes.filter((l) => !isProgressLabel(l.name));
        queueOp({ kind: 'removeProgress', id: i.id });
      }
    }
    render();
    renderSyncButton();
  }

  toast('仓库配置已保存');
  if (wasEmpty) {
    // 首个仓库保存后自动连接（修复"配置后仍显示未连接"）
    closeModal($('#setupModal'));
    connect();
  }
}

async function testRepo() {
  const card = $('#repoCards').querySelector('.repo-edit-card');
  if (!card) return;
  const msg = $('#setupMsg');
  const form = readRepoForm(card);
  if (form.error) { msg.textContent = form.error; return; }
  if (!form.token) { msg.textContent = '测试需要 Token：请先填入 Token（编辑已有仓库时留空会沿用已保存值，请先保存再测试）'; return; }
  msg.textContent = '正在测试…';
  try {
    await apiGetRepo(form);
    const labels = await apiGetLabels(form);
    msg.textContent = '连接成功：找到仓库（' + labels.length + ' 个现有标签）。';
    msg.className = 'ok';
  } catch (e) {
    msg.textContent = '连接失败: ' + e.message;
    msg.className = '';
  }
}

async function switchRepo(idx) {
  if (state.config.activeIndex === idx) { closeModal($('#setupModal')); return; }
  if (state.pendingOps.length) await flush();
  state.config.activeIndex = idx;
  saveConfig();
  closeModal($('#setupModal'));
  connect();
}

function removeRepo(idx) {
  const cfg = state.config;
  const target = cfg.repos[idx];
  if (!target) return;
  if (!confirm(`确定移除仓库 ${target.owner}/${target.repo}？`)) return;
  const wasActive = idx === cfg.activeIndex;
  cfg.repos.splice(idx, 1);
  if (!cfg.repos.length) {
    state.config = defaultConfig();
    saveConfig();
    state.connState = 'none';
    renderRepoCards();
    renderAppState();
    return;
  }
  if (idx < cfg.activeIndex) cfg.activeIndex--;
  if (wasActive) {
    cfg.activeIndex = Math.min(idx, cfg.repos.length - 1);
    saveConfig();
    renderRepoCards();
    closeModal($('#setupModal'));
    connect();
    return;
  }
  saveConfig();
  renderRepoCards();
}

/* ---------------- 筛选交互 ---------------- */

function clearFilters() {
  const f = state.filters;
  f.keyword = '';
  f.selectedTags = [];
  f.tagMatchMode = 'any';
  f.timeField = 'created';
  f.startDate = '';
  f.endDate = '';
  f.showArchived = false;
  $('#searchInput').value = '';
  $('#startDate').value = '';
  $('#endDate').value = '';
  $('#timeField').value = 'created';
  $('#tagMatchMode').value = 'any';
  syncArchiveToggle();
  renderFilterChips();
  renderTagFilterBtn();
  renderBlocks();
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  // 顶部按钮
  $('#btnNew').addEventListener('click', openEditorNew);
  $('#btnSettings').addEventListener('click', openSetupModal);
  $('#btnHelp').addEventListener('click', () => openModal($('#helpModal')));
  $('#btnTagsManage').addEventListener('click', openTagModalGlobal);
  $('#btnSync').addEventListener('click', () => { if (state.pendingOps.length) flush(); });

  // 操作面板：展开/收起筛选选项
  $('#btnFilterToggle').addEventListener('click', () => {
    state.filterOptionsOpen = !state.filterOptionsOpen;
    $('#filterOptions').classList.toggle('hidden', !state.filterOptionsOpen);
    $('#btnFilterToggle').textContent = '筛选 ' + (state.filterOptionsOpen ? '▴' : '▾');
  });

  // 顶部仓库切换下拉
  $('#repoSwitchBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#repoSwitchMenu').classList.toggle('hidden');
  });
  $('#repoSwitchMenu').addEventListener('click', (e) => {
    const item = e.target.closest('[data-switch-repo]');
    if (item) {
      $('#repoSwitchMenu').classList.add('hidden');
      switchRepo(parseInt(item.dataset.switchRepo, 10));
      return;
    }
    const manage = e.target.closest('[data-switch-manage]');
    if (manage) {
      $('#repoSwitchMenu').classList.add('hidden');
      openSetupModal();
    }
  });

  // 归档开关
  $('#archiveToggle').addEventListener('change', (e) => {
    if (e.target.disabled) return;
    state.filters.showArchived = e.target.checked;
    renderBlocks();
  });

  // 关键词搜索（防抖）
  let searchTimer = null;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filters.keyword = e.target.value;
      renderBlocks();
    }, 250);
  });

  // 时间筛选
  $('#startDate').addEventListener('change', (e) => { state.filters.startDate = e.target.value; renderBlocks(); });
  $('#endDate').addEventListener('change', (e) => { state.filters.endDate = e.target.value; renderBlocks(); });
  $('#timeField').addEventListener('change', (e) => { state.filters.timeField = e.target.value; renderBlocks(); });
  $('#tagMatchMode').addEventListener('change', (e) => { state.filters.tagMatchMode = e.target.value; renderBlocks(); });

  // 标签筛选下拉
  $('#tagFilterBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#tagFilterMenu').classList.toggle('hidden');
  });
  $('#tagFilterMenu').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-tag]');
    if (!cb) return;
    const name = cb.dataset.tag;
    const idx = state.filters.selectedTags.indexOf(name);
    if (idx >= 0) {
      state.filters.selectedTags.splice(idx, 1);
    } else {
      state.filters.selectedTags.push(name);
      if (name === APP_CONFIG.ARCHIVE_TAG) state.filters.showArchived = true; // 联动
    }
    syncArchiveToggle();
    renderTagFilterBtn();
    renderBlocks();
  });

  $('#btnClearFilters').addEventListener('click', clearFilters);

  // 主区域事件委托
  $('#main').addEventListener('input', (e) => {
    const ed = state.editor;
    if (!ed) return;
    if (e.target.id === 'editorTitle') ed.title = e.target.value;
    else if (e.target.id === 'editorBody') ed.body = e.target.value;
    else if (e.target.id === 'editorProgress') {
      ed.progress = parseInt(e.target.value, 10);
      const label = document.getElementById('editorProgressLabel');
      if (label) label.textContent = ed.progress + '%';
    }
  });

  $('#main').addEventListener('change', (e) => {
    const ed = state.editor;
    if (!ed) return;
    if (e.target.id === 'editorPercent') { ed.percent = e.target.checked; render(); }
  });

  $('#main').addEventListener('keydown', (e) => {
    if (e.target && e.target.id === 'editorTitle' && e.key === 'Enter') {
      e.preventDefault();
      saveEditor();
    }
  });

  $('#main').addEventListener('click', (e) => {
    // 编辑器按钮
    const editorBtn = e.target.closest('[data-act="editor-save"],[data-act="editor-cancel"],[data-act="editor-tags"],[data-act="editor-archive-delete"]');
    if (editorBtn) {
      e.preventDefault();
      const act = editorBtn.dataset.act;
      if (act === 'editor-save') saveEditor();
      else if (act === 'editor-cancel') cancelEditor();
      else if (act === 'editor-tags') openTagModalForEditor();
      else if (act === 'editor-archive-delete') {
        const ed = state.editor;
        const issue = ed ? state.issues.find((i) => i.id === ed.targetId) : null;
        if (!issue) return;
        if (deriveIssueMeta(issue).isArchived) {
          // 已归档 → 删除
          if (confirm(`确定删除待办「${issue.title}」？此操作不可恢复。`)) {
            optimisticDelete(issue);
            state.editor = null;
            render();
            toast('已删除（待自动同步）');
          }
        } else {
          // 未归档 → 先归档
          optimisticArchive(issue);
          render();
          toast('已归档（可在筛选「显示归档」中查看）');
        }
      }
      return;
    }
    // 编辑器内移除标签
    const tagX = e.target.closest('[data-remove-tag]');
    if (tagX) {
      if (state.editor) state.editor.tags.delete(tagX.dataset.removeTag);
      render();
      return;
    }
    // 进度圆环
    const ring = e.target.closest('[data-ring]');
    if (ring) {
      e.preventDefault();
      openProgressPopover(ring.dataset.ring, ring);
      return;
    }
    // 卡片操作
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = e.target.closest('.task-card');
    if (!card || card.classList.contains('editor-card')) return;
    e.preventDefault();
    onCardAction(card.dataset.id, btn.dataset.act);
  });

  // 进度弹层：滑动条实时更新数值
  $('#progressPopover').addEventListener('input', (e) => {
    if (e.target.id !== 'popProgress') return;
    const label = document.getElementById('popProgressLabel');
    if (label) label.textContent = e.target.value + '%';
  });
  // 进度弹层：松开滑块确认并应用
  $('#progressPopover').addEventListener('change', (e) => {
    if (e.target.id !== 'popProgress') return;
    const issue = state.issues.find((i) => i.id === state.progressPopoverFor);
    if (issue) {
      optimisticSetProgress(issue, parseInt(e.target.value, 10));
      render();
      toast('进度已更新（待自动同步）');
    }
    closeProgressPopover();
  });

  // 关闭下拉 / 弹层
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#tagFilterDropdown')) $('#tagFilterMenu').classList.add('hidden');
    if (!e.target.closest('#repoSwitch')) $('#repoSwitchMenu').classList.add('hidden');
    if (state.progressPopoverFor && !e.target.closest('#progressPopover') && !e.target.closest('[data-ring]')) {
      closeProgressPopover();
    }
  });

  // 标签弹窗
  $('#newTagAdd').addEventListener('click', addNewTag);
  $('#newTagName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addNewTag(); }
  });
  $('#tagSave').addEventListener('click', tagSave);
  $('#tagCancel').addEventListener('click', tagCancel);
  $('#tagList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-label]');
    if (!btn) return;
    const name = btn.dataset.delLabel;
    if (state.tagPendingDeletes.has(name)) state.tagPendingDeletes.delete(name);
    else state.tagPendingDeletes.add(name);
    renderTagManager();
  });

  // 设置弹窗
  $('#setupClose').addEventListener('click', () => closeModal($('#setupModal')));
  $('#helpClose').addEventListener('click', () => closeModal($('#helpModal')));
  $('#rememberTokenToggle').addEventListener('change', (e) => {
    state.config.rememberToken = e.target.checked;
    const msg = $('#setupMsg');
    if (e.target.checked) {
      persistTokenKey();
      msg.textContent = '已启用「记住 Token」：本设备下次打开时自动解密，无需重新输入。';
      msg.className = 'ok';
    } else {
      forgetPersistedTokenKey();
      msg.textContent = '已关闭「记住 Token」：关闭浏览器后需重新输入各仓库 Token（安全性更高）。';
      msg.className = '';
    }
    saveConfig();
  });
  // Token 输入框：聚焦即清空，彻底隐藏已存值，方便直接粘贴新 Token
  $('#repoCards').addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-repo-field="token"]');
    if (el) el.value = '';
  });
  $('#btnAddRepo').addEventListener('click', () => { state.repoCardEdit = { mode: 'add' }; renderRepoCards(); });
  $('#repoCards').addEventListener('click', (e) => {
    const connect = e.target.closest('[data-repo-connect]');
    const edit = e.target.closest('[data-repo-edit]');
    const del = e.target.closest('[data-repo-del]');
    const save = e.target.closest('[data-repo-save]');
    const cancel = e.target.closest('[data-repo-cancel]');
    const test = e.target.closest('[data-repo-test]');
    if (connect) switchRepo(parseInt(connect.dataset.repoConnect, 10));
    else if (edit) { state.repoCardEdit = { mode: 'edit', index: parseInt(edit.dataset.repoEdit, 10) }; renderRepoCards(); }
    else if (del) removeRepo(parseInt(del.dataset.repoDel, 10));
    else if (save) saveRepoCard(parseInt(save.dataset.repoSave, 10));
    else if (cancel) { state.repoCardEdit = null; renderRepoCards(); }
    else if (test) testRepo();
  });
  // 仓库表单：切换 API 格式时显示/隐藏 Gitea 服务器地址
  $('#repoCards').addEventListener('change', (e) => {
    const el = e.target.closest('[data-repo-field="provider"]');
    if (!el) return;
    const card = el.closest('.repo-edit-card');
    if (!card) return;
    const gitea = el.value === 'gitea';
    const urlInput = card.querySelector('[data-repo-field="url"]');
    const baseLabel = card.querySelector('.gitea-only');
    if (baseLabel) baseLabel.classList.toggle('hidden', !gitea);
    if (urlInput) urlInput.placeholder = gitea
      ? 'https://gitea.com/owner/repo'
      : 'https://github.com/owner/repo';
  });
  // 仓库表单：输入 URL 时自动填充 owner/repo/baseUrl
  $('#repoCards').addEventListener('input', (e) => {
    const el = e.target.closest('[data-repo-field="url"]');
    if (!el) return;
    const card = el.closest('.repo-edit-card');
    if (!card) return;
    const parsed = parseRepoUrl(el.value);
    if (!parsed) return;
    card.querySelector('[data-repo-field="owner"]').value = parsed.owner;
    card.querySelector('[data-repo-field="repo"]').value = parsed.repo;
    const prov = card.querySelector('[data-repo-field="provider"]').value;
    const baseInput = card.querySelector('[data-repo-field="baseUrl"]');
    if (prov === 'gitea' && baseInput) baseInput.value = parsed.baseUrl;
  });
}

/* ---------------- 启动 ---------------- */

async function init() {
  bindEvents();
  state.config = await loadConfig();
  if (!state.config.repos.length) {
    state.connState = 'none';
    renderAppState();
    openSetupModal();
    return;
  }
  await connect();
}

setInterval(renderSyncButton, 1000);

// 页面离开时尽力同步未保存操作
window.addEventListener('beforeunload', () => {
  if (state.pendingOps.length) flush();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state.pendingOps.length) flush();
});

init();
