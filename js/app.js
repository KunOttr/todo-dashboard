/* 应用主逻辑：状态、渲染、事件绑定、模态框交互 */
'use strict';

const state = {
  config: null, // { owner, repo, token, repoId }
  labels: [],   // 仓库内全部标签
  issues: [],   // 仓库内全部 issue
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
  editModalMode: 'new',   // 'new' | 'edit'
  editingIssueId: null,
  tagModalIssueId: null,  // null 表示仅标签管理
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

function loadConfig() {
  try {
    const raw = localStorage.getItem(APP_CONFIG.STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveConfig(cfg) {
  localStorage.setItem(APP_CONFIG.STORAGE_KEY, JSON.stringify(cfg));
}

function clearConfig() {
  localStorage.removeItem(APP_CONFIG.STORAGE_KEY);
}

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

/* ---------------- 数据加载 ---------------- */

async function ensureSpecialLabels(cfg, labels) {
  const existing = new Set(labels.map((l) => l.name));
  const need = [APP_CONFIG.ARCHIVE_TAG];
  for (let v = APP_CONFIG.PROGRESS_STEP; v <= APP_CONFIG.PROGRESS_MAX; v += APP_CONFIG.PROGRESS_STEP) {
    need.push(APP_CONFIG.PROGRESS_PREFIX + v + '%');
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
  const cfg = state.config;
  setLoading(true);
  try {
    const repo = await apiGetRepo(cfg);
    cfg.repoId = repo.id;
    const labels = await apiGetLabels(cfg);
    state.labels = await ensureSpecialLabels(cfg, labels);
    state.issues = await apiGetIssues(cfg);
    render();
  } catch (e) {
    toast('连接失败: ' + e.message, true);
    showNoConfig();
  } finally {
    setLoading(false);
  }
}

async function refreshIssues() {
  state.issues = await apiGetIssues(state.config);
  render();
}

async function refresh() {
  const labels = await apiGetLabels(state.config);
  state.labels = await ensureSpecialLabels(state.config, labels);
  state.issues = await apiGetIssues(state.config);
  render();
}

/* ---------------- 渲染 ---------------- */

function render() {
  $('#noConfigBox').classList.add('hidden');
  $('#blockOpen').classList.remove('hidden');
  $('#blockClosed').classList.remove('hidden');
  renderRepoInfo();
  renderFilterChips();
  syncArchiveToggle();
  renderBlocks();
}

function renderRepoInfo() {
  const cfg = state.config;
  $('#repoInfo').innerHTML = cfg
    ? `<a href="https://github.com/${escapeHTML(cfg.owner)}/${escapeHTML(cfg.repo)}/issues" target="_blank" rel="noopener">${escapeHTML(cfg.owner)} / ${escapeHTML(cfg.repo)}</a>`
    : '';
}

function renderFilterChips() {
  const chips = state.labels
    .filter((l) => !isProgressLabel(l.name))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  const el = $('#tagFilterChips');
  el.innerHTML = chips.map((l) => {
    const selected = state.filters.selectedTags.includes(l.name);
    const cls = l.name === APP_CONFIG.ARCHIVE_TAG ? 'chip chip-archived' : 'chip';
    return `<button type="button" class="${cls}${selected ? ' selected' : ''}" data-tag="${escapeHTML(l.name)}" style="--tag-color:#${l.color}">
      <span class="dot"></span>${escapeHTML(l.name)}
    </button>`;
  }).join('');
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
  renderList($('#listOpen'), open, '未完成');
  renderList($('#listClosed'), closed, '已完成');
  $('#countOpen').textContent = open.length;
  $('#countClosed').textContent = closed.length;
}

function renderList(el, issues, kind) {
  if (!issues.length) {
    el.innerHTML = `<div class="empty">暂无${kind}任务${state.filters.keyword || state.filters.selectedTags.length || state.filters.startDate || state.filters.endDate ? '（受当前筛选影响）' : ''}</div>`;
    return;
  }
  el.innerHTML = issues.map(cardHTML).join('');
}

function cardHTML(issue) {
  const meta = deriveIssueMeta(issue);
  const closed = issue.state === 'CLOSED';
  const tagsHTML = meta.tags.map((t) => {
    const cls = t.name === APP_CONFIG.ARCHIVE_TAG ? 'tag tag-archived' : 'tag';
    return `<span class="${cls}" style="--tag-color:#${t.color}">${escapeHTML(t.name)}</span>`;
  }).join('');

  return `
  <article class="task-card${closed ? ' task-card-closed' : ''}" data-id="${issue.id}">
    <div class="card-left">
      <button class="check-btn${closed ? ' checked' : ''}" data-act="toggle"
        title="${closed ? '标记为未完成' : '标记为已完成'}">${closed ? '✓' : ''}</button>
    </div>
    <div class="card-main">
      <div class="card-title">${escapeHTML(issue.title)}</div>
      ${issue.body ? `<div class="card-body-text">${escapeHTML(issue.body)}</div>` : ''}
      <div class="card-meta">
        ${meta.tags.length ? `<span class="card-tags">${tagsHTML}</span>` : ''}
        <span class="card-time">创建 ${fmtDate(issue.createdAt)}</span>
        ${closed && issue.closedAt ? `<span class="card-time">完成 ${fmtDate(issue.closedAt)}</span>` : ''}
        <span class="card-number"><a href="${escapeHTML(issue.url)}" target="_blank" rel="noopener" title="在 GitHub 打开">#${issue.number}</a></span>
      </div>
      <div class="progress-row">
        <div class="progress-track"><div class="progress-fill" style="width:${meta.progress}%"></div></div>
        <input type="range" min="0" max="100" step="${APP_CONFIG.PROGRESS_STEP}" value="${meta.progress}"
          data-act="progress" title="调整进度">
        <span class="progress-label">${meta.progress}%</span>
      </div>
    </div>
    <div class="card-actions">
      <button class="btn-link" data-act="edit">编辑</button>
      <button class="btn-link" data-act="tags">标签</button>
      <button class="btn-link" data-act="archive">${meta.isArchived ? '取消归档' : '归档'}</button>
      <button class="btn-link danger" data-act="delete">删除</button>
    </div>
  </article>`;
}

/* ---------------- 卡片操作 ---------------- */

async function onCardAction(issueId, act) {
  if (state.loading) return;
  const issue = state.issues.find((i) => i.id === issueId);
  if (!issue) return;
  try {
    switch (act) {
      case 'toggle':
        await toggleComplete(issue);
        break;
      case 'edit':
        openEditModal(issue);
        break;
      case 'tags':
        openTagModal(issue);
        break;
      case 'archive':
        await toggleArchive(issue);
        break;
      case 'delete': {
        if (confirm(`确定删除待办「${issue.title}」？此操作不可恢复。`)) {
          await apiDeleteIssue(state.config, issue.id);
          await refreshIssues();
          toast('已删除');
        }
        break;
      }
    }
  } catch (e) {
    toast('操作失败: ' + e.message, true);
  }
}

async function toggleComplete(issue) {
  const cfg = state.config;
  if (issue.state === 'OPEN') {
    await apiCloseIssue(cfg, issue.id);
    toast('已标记为完成');
  } else {
    await apiReopenIssue(cfg, issue.id);
    toast('已重新打开');
  }
  await refreshIssues();
}

async function toggleArchive(issue) {
  const cfg = state.config;
  const archLabel = state.labels.find((l) => l.name === APP_CONFIG.ARCHIVE_TAG);
  if (!archLabel) {
    toast('「归档」标签不存在，无法归档', true);
    return;
  }
  const meta = deriveIssueMeta(issue);
  if (meta.isArchived) {
    await apiRemoveLabels(cfg, issue.id, [archLabel.id]);
    toast('已取消归档');
  } else {
    await apiAddLabels(cfg, issue.id, [archLabel.id]);
    toast('已归档（默认隐藏，可开启「显示归档」查看）');
  }
  await refreshIssues();
}

async function setProgress(issue, value) {
  const cfg = state.config;
  if (!issue) return;
  const cur = issue.labels.nodes.filter((l) => isProgressLabel(l.name));
  if (cur.length) {
    await apiRemoveLabels(cfg, issue.id, cur.map((l) => l.id));
  }
  if (value > 0) {
    const targetName = APP_CONFIG.PROGRESS_PREFIX + value + '%';
    let label = state.labels.find((l) => l.name === targetName);
    if (!label) {
      label = await apiCreateLabel(cfg, cfg.repoId, targetName, APP_CONFIG.LABEL_COLORS.progress);
      state.labels.push(label);
    }
    await apiAddLabels(cfg, issue.id, [label.id]);
  }
}

async function syncLabels(issue, targetNames) {
  const cfg = state.config;
  const current = new Set(issue.labels.nodes.map((l) => l.name));
  const add = state.labels
    .filter((l) => !current.has(l.name) && targetNames.has(l.name))
    .map((l) => l.id);
  const remove = state.labels
    .filter((l) => (
      !isProgressLabel(l.name) &&
      !isArchiveLabel(l.name) &&
      current.has(l.name) &&
      !targetNames.has(l.name)
    ))
    .map((l) => l.id);
  if (add.length) await apiAddLabels(cfg, issue.id, add);
  if (remove.length) await apiRemoveLabels(cfg, issue.id, remove);
}

/* ---------------- 编辑待办模态框 ---------------- */

function renderEditTags(selectedSet) {
  const el = $('#editTags');
  const tags = state.labels
    .filter((l) => !isProgressLabel(l.name) && !isArchiveLabel(l.name))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  if (!tags.length) {
    el.innerHTML = '<span class="card-time">（暂无可用标签，可在标签管理中创建）</span>';
    return;
  }
  el.innerHTML = tags.map((l) => {
    const checked = selectedSet.has(l.name) ? 'checked' : '';
    return `<label class="tag-check">
      <input type="checkbox" value="${escapeHTML(l.name)}" ${checked}>
      <span class="dot" style="background:#${l.color}"></span>${escapeHTML(l.name)}
    </label>`;
  }).join('');
}

function collectEditTags() {
  const s = new Set();
  $('#editTags').querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => s.add(cb.value));
  return s;
}

function openEditModal(issue) {
  state.editingIssueId = issue ? issue.id : null;
  state.editModalMode = issue ? 'edit' : 'new';
  $('#editModalTitle').textContent = issue ? '编辑待办' : '新建待办';
  $('#editIssueTitle').value = issue ? issue.title : '';
  $('#editIssueBody').value = issue && issue.body ? issue.body : '';
  $('#editProgress').value = issue ? deriveIssueMeta(issue).progress : 0;
  $('#editProgressLabel').textContent = $('#editProgress').value + '%';
  $('#editCompleted').checked = !!(issue && issue.state === 'CLOSED');
  renderEditTags(new Set(issue ? deriveIssueMeta(issue).tags.map((t) => t.name) : []));
  $('#editMsg').textContent = '';
  openModal($('#editModal'));
  $('#editIssueTitle').focus();
}

async function saveEdit() {
  const cfg = state.config;
  const title = $('#editIssueTitle').value.trim();
  if (!title) {
    $('#editMsg').textContent = '请输入标题';
    return;
  }
  const body = $('#editIssueBody').value;
  const progress = parseInt($('#editProgress').value, 10);
  const completed = $('#editCompleted').checked;
  const targetTags = collectEditTags();
  setLoading(true);
  try {
    if (state.editModalMode === 'new') {
      const labelIds = state.labels.filter((l) => targetTags.has(l.name)).map((l) => l.id);
      const issue = await apiCreateIssue(cfg, cfg.repoId, { title, body, labelIds });
      if (progress > 0) await setProgress(issue, progress);
      if (completed) await apiCloseIssue(cfg, issue.id);
    } else {
      const issue = state.issues.find((i) => i.id === state.editingIssueId);
      await apiUpdateIssue(cfg, issue.id, { title, body });
      const meta = deriveIssueMeta(issue);
      if (progress !== meta.progress) await setProgress(issue, progress);
      if (completed && issue.state === 'OPEN') await apiCloseIssue(cfg, issue.id);
      if (!completed && issue.state === 'CLOSED') await apiReopenIssue(cfg, issue.id);
      await syncLabels(issue, targetTags);
    }
    closeModal($('#editModal'));
    await refreshIssues();
    toast('已保存');
  } catch (e) {
    $('#editMsg').textContent = e.message;
  } finally {
    setLoading(false);
  }
}

/* ---------------- 标签管理模态框 ---------------- */

function openTagModal(issue) {
  state.tagModalIssueId = issue ? issue.id : null;
  renderTagManager();
  $('#tagMsg').textContent = '';
  openModal($('#tagModal'));
}

function renderTagManager() {
  const el = $('#tagList');
  const labels = state.labels.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  const issue = state.tagModalIssueId
    ? state.issues.find((i) => i.id === state.tagModalIssueId)
    : null;
  const hasIssue = !!(issue && state.tagModalIssueId);

  $('#tagModalNote').textContent = hasIssue
    ? `为待办「${issue.title}」选择标签。`
    : '管理仓库中的标签。勾选仅用于「编辑待办标签」模式。';

  el.innerHTML = labels.map((l) => {
    const special = isProgressLabel(l.name) || isArchiveLabel(l.name);
    const checked = hasIssue && issue.labels.nodes.some((n) => n.name === l.name);
    const cb = special ? '' : `<input type="checkbox" data-tag-check data-tag-name="${escapeHTML(l.name)}"${checked ? ' checked' : ''}>`;
    const del = special
      ? '<span class="sys-badge">系统</span>'
      : `<button type="button" class="btn-link danger" data-del-label="${escapeHTML(l.name)}">删除</button>`;
    return `<div class="tag-manage-row">${cb}
      <span class="dot" style="background:#${l.color}"></span>
      <span class="tag-name">${escapeHTML(l.name)}</span>${del}
    </div>`;
  }).join('');
}

async function addNewTag() {
  const name = $('#newTagName').value.trim();
  const color = $('#newTagColor').value.replace('#', '');
  if (!name) {
    $('#tagMsg').textContent = '请输入标签名';
    return;
  }
  if (isProgressLabel(name) || isArchiveLabel(name)) {
    $('#tagMsg').textContent = '该名称是系统保留标签';
    return;
  }
  try {
    const l = await apiCreateLabel(state.config, state.config.repoId, name, color);
    state.labels.push(l);
    renderTagManager();
    $('#newTagName').value = '';
    $('#tagMsg').textContent = '';
    toast('标签「' + name + '」已创建');
  } catch (e) {
    $('#tagMsg').textContent = e.message;
  }
}

async function deleteTag(label) {
  if (!confirm(`确定删除标签「${label.name}」？该标签会从所有待办上移除。`)) return;
  try {
    await apiDeleteLabel(state.config, label.id);
    state.labels = state.labels.filter((l) => l.id !== label.id);
    state.filters.selectedTags = state.filters.selectedTags.filter((n) => n !== label.name);
    renderTagManager();
    renderFilterChips();
    await refreshIssues();
    toast('标签已删除');
  } catch (e) {
    $('#tagMsg').textContent = e.message;
  }
}

async function tagSave() {
  setLoading(true);
  try {
    if (state.tagModalIssueId) {
      const issue = state.issues.find((i) => i.id === state.tagModalIssueId);
      if (issue) {
        const target = new Set();
        $('#tagList').querySelectorAll('input[data-tag-check]:checked').forEach((cb) => target.add(cb.dataset.tagName));
        await syncLabels(issue, target);
        toast('标签已更新');
      }
    } else {
      toast('标签管理完成');
    }
    closeModal($('#tagModal'));
    await refreshIssues();
  } catch (e) {
    $('#tagMsg').textContent = e.message;
  } finally {
    setLoading(false);
  }
}

/* ---------------- 设置模态框 ---------------- */

function openSetupModal() {
  const cfg = state.config;
  $('#setupOwner').value = cfg ? cfg.owner : '';
  $('#setupRepo').value = cfg ? cfg.repo : '';
  $('#setupToken').value = cfg ? cfg.token : '';
  $('#setupShowToken').checked = false;
  $('#setupToken').type = 'password';
  $('#setupMsg').textContent = '';
  $('#setupMsg').className = '';
  openModal($('#setupModal'));
}

async function testConnection() {
  const owner = $('#setupOwner').value.trim();
  const repo = $('#setupRepo').value.trim();
  const token = $('#setupToken').value.trim();
  const msgEl = $('#setupMsg');
  if (!owner || !repo || !token) {
    msgEl.textContent = '请填写完整信息';
    return;
  }
  msgEl.textContent = '正在测试…';
  try {
    const cfg = { owner, repo, token };
    await apiGetRepo(cfg);
    const labels = await apiGetLabels(cfg);
    msgEl.textContent = '连接成功：找到仓库（' + labels.length + ' 个现有标签），可以保存。';
    msgEl.className = 'ok';
  } catch (e) {
    msgEl.textContent = '连接失败: ' + e.message;
    msgEl.className = '';
  }
}

function saveSetup() {
  const owner = $('#setupOwner').value.trim();
  const repo = $('#setupRepo').value.trim();
  const token = $('#setupToken').value.trim();
  const msgEl = $('#setupMsg');
  if (!owner || !repo || !token) {
    msgEl.textContent = '请填写完整信息';
    return;
  }
  const cfg = { owner, repo, token };
  saveConfig(cfg);
  state.config = cfg;
  closeModal($('#setupModal'));
  connect();
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
  renderBlocks();
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  // 顶部按钮
  $('#btnNew').addEventListener('click', () => openEditModal(null));
  $('#btnSettings').addEventListener('click', openSetupModal);
  $('#btnTagsManage').addEventListener('click', () => openTagModal(null));
  $('#btnNoConfigSetup').addEventListener('click', openSetupModal);

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
  $('#startDate').addEventListener('change', (e) => {
    state.filters.startDate = e.target.value;
    renderBlocks();
  });
  $('#endDate').addEventListener('change', (e) => {
    state.filters.endDate = e.target.value;
    renderBlocks();
  });
  $('#timeField').addEventListener('change', (e) => {
    state.filters.timeField = e.target.value;
    renderBlocks();
  });
  $('#tagMatchMode').addEventListener('change', (e) => {
    state.filters.tagMatchMode = e.target.value;
    renderBlocks();
  });

  // 标签筛选 chips
  $('#tagFilterChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag]');
    if (!chip) return;
    const name = chip.dataset.tag;
    const idx = state.filters.selectedTags.indexOf(name);
    if (idx >= 0) {
      state.filters.selectedTags.splice(idx, 1);
    } else {
      state.filters.selectedTags.push(name);
      if (name === APP_CONFIG.ARCHIVE_TAG) {
        // 联动：选中「归档」标签即显示归档任务
        state.filters.showArchived = true;
      }
    }
    syncArchiveToggle();
    renderFilterChips();
    renderBlocks();
  });

  $('#btnClearFilters').addEventListener('click', clearFilters);

  // 卡片操作（事件委托）
  $('#main').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.dataset.act === 'progress') return;
    const card = e.target.closest('.task-card');
    if (!card) return;
    e.preventDefault();
    onCardAction(card.dataset.id, btn.dataset.act);
  });

  // 进度滑块（change 触发，拖动过程中不请求）
  $('#main').addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset || el.dataset.act !== 'progress') return;
    const card = el.closest('.task-card');
    if (!card) return;
    const val = parseInt(el.value, 10);
    card.querySelector('.progress-fill').style.width = val + '%';
    card.querySelector('.progress-label').textContent = val + '%';
    const issue = state.issues.find((i) => i.id === card.dataset.id);
    setProgress(issue, val)
      .then(() => refreshIssues())
      .catch((err) => toast('进度更新失败: ' + err.message, true));
  });

  // 编辑模态框
  $('#editProgress').addEventListener('input', (e) => {
    $('#editProgressLabel').textContent = e.target.value + '%';
  });
  $('#editSave').addEventListener('click', saveEdit);
  $('#editCancel').addEventListener('click', () => closeModal($('#editModal')));

  // 标签管理模态框
  $('#newTagAdd').addEventListener('click', addNewTag);
  $('#newTagName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNewTag();
    }
  });
  $('#tagSave').addEventListener('click', tagSave);
  $('#tagCancel').addEventListener('click', () => closeModal($('#tagModal')));
  $('#tagList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-label]');
    if (!btn) return;
    const label = state.labels.find((l) => l.name === btn.dataset.delLabel);
    if (label) deleteTag(label);
  });

  // 设置模态框
  $('#setupTest').addEventListener('click', testConnection);
  $('#setupSave').addEventListener('click', saveSetup);
  $('#setupCancel').addEventListener('click', () => closeModal($('#setupModal')));
  $('#setupClear').addEventListener('click', () => {
    if (!confirm('确定清除本地保存的连接配置？')) return;
    clearConfig();
    location.reload();
  });
  $('#setupShowToken').addEventListener('change', (e) => {
    $('#setupToken').type = e.target.checked ? 'text' : 'password';
  });
}

/* ---------------- 启动 ---------------- */

function showNoConfig() {
  $('#noConfigBox').classList.remove('hidden');
  $('#blockOpen').classList.add('hidden');
  $('#blockClosed').classList.add('hidden');
  renderRepoInfo();
}

async function init() {
  bindEvents();
  const cfg = loadConfig();
  if (!cfg) {
    showNoConfig();
    openSetupModal();
    return;
  }
  state.config = cfg;
  await connect();
}

init();
