/* GitHub GraphQL / Gitea REST 双 API 封装（按 config.provider 分支）
 *
 * 平台扩展点（未实现，勿在 UI 暴露）：
 *  - Gitee（码云）REST v5：baseUrl = https://gitee.com/api/v5，认证 access_token，标签「名称」驱动（逗号分隔名称），
 *    无 GraphQL。创建/编辑 issue 时 labels 直接作为 issue 参数（名称列表），一次请求即可建 + 打标。
 *  - GitLab REST v4 + GraphQL（13+）：REST 用 /api/v4（projects/{namespace}%2F{project}，多级命名空间需 URL-encode），
 *    认证 PRIVATE-TOKEN，标签「名称」驱动（PATCH issue 的 add_labels/remove_labels 一次改标签），issue 用 IID；
 *    GraphQL 的 updateIssue 支持 addLabelIds/removeLabelIds（GlobalID），alias 合并方案同样适用。
 * 新增平台时：增加下方 isXxx(config) 判断，并在各 api* 函数内按 provider 分支。
 */
'use strict';

/* ---------------- 基础 HTTP ---------------- */

/* 计算 GitHub GraphQL 端点：自建 Enterprise 用 baseUrl + /api/graphql，否则用默认（公开版 / Enterprise Cloud 共用 api.github.com） */
function githubGraphqlEndpoint(config) {
  const base = (config.baseUrl || '').replace(/\/+$/, '');
  if (!base) return APP_CONFIG.GRAPHQL_ENDPOINT;
  // 填的其实是公开版 github.com（含 Enterprise Cloud），回退默认端点
  if (/^(https?:)?\/\/github\.com$/i.test(base)) return APP_CONFIG.GRAPHQL_ENDPOINT;
  return base + '/api/graphql';
}

async function gql(config, query, variables) {
  const endpoint = githubGraphqlEndpoint(config);
  // HTTPS 页面请求 HTTP 接口会被浏览器拦截（混合内容）
  if (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:' && endpoint.indexOf('http://') === 0) {
    throw new Error('连接失败：当前页面为 HTTPS，但 GitHub Enterprise 地址是 HTTP，浏览器会拦截混合内容。请为 GHE 配置 HTTPS，并使用 https:// 的服务器地址。');
  }
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.token,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new Error('网络错误，请检查网络连接');
  }
  // token 过期 / 无效时 GitHub 返回 HTTP 401（body 无 errors/data），必须显式检查
  if (!res.ok) {
    if (res.status === 401) {
      const err = new Error('GitHub Token 已过期或无效（HTTP 401 Bad credentials），请在设置中重新填写 Token');
      err.code = 'unauthorized';
      throw err;
    }
    if (res.status === 403) {
      throw new Error('GitHub API 请求被拒绝（HTTP 403）：可能是速率限制或权限不足，请在设置中检查 Token');
    }
    let msg = 'GitHub API 请求失败（HTTP ' + res.status + '）';
    try {
      const j = await res.json();
      if (j && j.message) msg = j.message;
    } catch (e) { /* 忽略非 JSON 错误体 */ }
    throw new Error(msg);
  }
  const json = await res.json();
  if (json.errors && json.errors.length) {
    const msg = json.errors.map((err) => err.message).join('; ');
    throw new Error(msg);
  }
  if (json.data === undefined) {
    throw new Error('GitHub API 返回异常（缺少 data 字段），请检查 Token 是否有效');
  }
  return json.data;
}

function isGitea(config) {
  return config && config.provider === 'gitea';
}

/* 预留：Gitee / GitLab 尚未实现，接入点见文件头注释 */
function isGitee(config) { return config && config.provider === 'gitee'; }
function isGitlab(config) { return config && config.provider === 'gitlab'; }

function giteaApiBase(config) {
  const base = (config.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('缺少 Gitea 服务器地址');
  return base + '/api/v1';
}

async function giteaRequest(config, method, path, body) {
  const apiBase = giteaApiBase(config);
  // HTTPS 页面请求 HTTP 接口会被浏览器拦截（混合内容）
  if (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:' && apiBase.indexOf('http://') === 0) {
    throw new Error('连接失败：当前页面为 HTTPS，但 Gitea 地址是 HTTP，浏览器会拦截混合内容。请为 Gitea 配置 HTTPS，并使用 https:// 的服务器地址。');
  }
  const url = apiBase + path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'token ' + config.token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // 跨域(CORS)失败时浏览器 fetch 抛 TypeError；自建 Gitea 默认未开启 CORS
    throw new Error('连接失败：请检查网络连接。若为自建 Gitea，需在其 app.ini 的 [cors] 段设置 ENABLED = true 并重启服务。');
  }
  if (!res.ok) {
    if (res.status === 401) {
      const err = new Error('Gitea Token 已过期或无效（HTTP 401），请在设置中重新填写 Token');
      err.code = 'unauthorized';
      throw err;
    }
    let msg = 'HTTP ' + res.status;
    try {
      const j = await res.json();
      if (j && (j.message || j.error)) msg = j.message || j.error;
    } catch (e) { /* 忽略非 JSON 错误体 */ }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function normalizeColor(c) {
  return String(c || '').replace(/^#/, '');
}

const ISSUE_FIELDS = `
  id
  number
  title
  body
  state
  createdAt
  closedAt
  url
  labels(first: 100) { nodes { id name color } }
`;

/* Gitea issue → 内部结构（内部 id 使用 issue 序号 index，REST 操作都基于它） */
function giteaIssueToInternal(issue) {
  const labels = (issue.labels || []).map((l) => ({
    id: String(l.id), name: l.name, color: normalizeColor(l.color),
  }));
  return {
    id: String(issue.number),
    number: issue.number,
    title: issue.title,
    body: issue.body || '',
    state: issue.state === 'closed' ? 'CLOSED' : 'OPEN',
    createdAt: issue.created_at,
    closedAt: issue.closed_at || null,
    url: issue.html_url || '',
    labels: { nodes: labels },
  };
}

/* ---------------- 仓库 / 标签 / 待办查询 ---------------- */

async function apiGetRepo(config) {
  if (isGitea(config)) {
    const repo = await giteaRequest(config, 'GET', `/repos/${config.owner}/${config.repo}`);
    return { id: String(repo.id), fullName: repo.full_name || '' };
  }
  const data = await gql(
    config,
    'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id}}',
    { owner: config.owner, name: config.repo }
  );
  if (!data.repository) {
    throw new Error('仓库不存在或没有访问权限，请检查 owner / 仓库名 / Token');
  }
  return data.repository;
}

async function apiGetLabels(config) {
  if (isGitea(config)) {
    const arr = await giteaRequest(config, 'GET', `/repos/${config.owner}/${config.repo}/labels`);
    return arr.map((l) => ({ id: String(l.id), name: l.name, color: normalizeColor(l.color) }));
  }
  const data = await gql(
    config,
    `query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        labels(first:100, orderBy:{field:NAME, direction:ASC}){ nodes{ id name color } }
      }
    }`,
    { owner: config.owner, name: config.repo }
  );
  if (!data.repository) {
    throw new Error('仓库不存在或没有访问权限，请检查 owner / 仓库名 / Token');
  }
  return data.repository.labels.nodes;
}

async function apiGetIssues(config) {
  if (isGitea(config)) {
    const issues = [];
    let page = 1;
    let guard = 0;
    while (true) {
      const arr = await giteaRequest(
        config, 'GET',
        `/repos/${config.owner}/${config.repo}/issues?state=all&limit=100&page=${page}&sort=created&order=desc`
      );
      if (!Array.isArray(arr)) break;
      issues.push(...arr.filter((i) => !i.pull_request).map(giteaIssueToInternal));
      if (arr.length < 100) break;
      page++;
      if (++guard > 50) break;
    }
    return issues;
  }
  const issues = [];
  let cursor = null;
  let guard = 0;
  while (true) {
    const data = await gql(
      config,
      `query($owner:String!,$name:String!,$cursor:String){
        repository(owner:$owner,name:$name){
          issues(first:100, after:$cursor, orderBy:{field:CREATED_AT, direction:DESC}){
            pageInfo{ hasNextPage endCursor }
            nodes{ ${ISSUE_FIELDS} }
          }
        }
      }`,
      { owner: config.owner, name: config.repo, cursor }
    );
    if (!data.repository) {
      throw new Error('仓库不存在或没有访问权限，请检查 owner / 仓库名 / Token');
    }
    issues.push(...data.repository.issues.nodes);
    if (!data.repository.issues.pageInfo.hasNextPage) break;
    cursor = data.repository.issues.pageInfo.endCursor;
    if (++guard > 50) break;
  }
  return issues;
}

/* 首次加载合并查询：repo id + labels + issues 一次拿全（GraphQL 单次 query；Gitea 并行），减少连接时的请求数 */
async function apiGetInitial(config) {
  if (isGitea(config)) {
    const [repo, labels, issues] = await Promise.all([apiGetRepo(config), apiGetLabels(config), apiGetIssues(config)]);
    return { repoId: repo.id, labels, issues };
  }
  const issues = [];
  let cursor = null;
  let guard = 0;
  let repoId = null;
  let labels = [];
  while (true) {
    const data = await gql(
      config,
      `query($owner:String!,$name:String!,$cursor:String){
        repository(owner:$owner,name:$name){
          id
          labels(first:100, orderBy:{field:NAME, direction:ASC}){ nodes{ id name color } }
          issues(first:100, after:$cursor, orderBy:{field:CREATED_AT, direction:DESC}){
            pageInfo{ hasNextPage endCursor }
            nodes{ ${ISSUE_FIELDS} }
          }
        }
      }`,
      { owner: config.owner, name: config.repo, cursor }
    );
    if (!data.repository) {
      throw new Error('仓库不存在或没有访问权限，请检查 owner / 仓库名 / Token');
    }
    if (repoId === null) { repoId = data.repository.id; labels = data.repository.labels.nodes; }
    issues.push(...data.repository.issues.nodes);
    if (!data.repository.issues.pageInfo.hasNextPage) break;
    cursor = data.repository.issues.pageInfo.endCursor;
    if (++guard > 50) break;
  }
  return { repoId, labels, issues };
}

async function apiGetIssueBasics(config, issueId) {
  if (isGitea(config)) {
    const issue = await giteaRequest(config, 'GET', `/repos/${config.owner}/${config.repo}/issues/${issueId}`);
    const internal = giteaIssueToInternal(issue);
    return { state: internal.state, closedAt: internal.closedAt, labels: internal.labels.nodes };
  }
  const data = await gql(
    config,
    `query($id:ID!){
      node(id:$id){ ... on Issue{ state closedAt labels(first:100){ nodes{ id name color } } } }
    }`,
    { id: issueId }
  );
  const node = data && data.node;
  return node
    ? { state: node.state || 'OPEN', closedAt: node.closedAt || null, labels: node.labels ? node.labels.nodes : [] }
    : { state: 'OPEN', closedAt: null, labels: [] };
}

/* ---------------- 待办写操作 ---------------- */

async function apiCreateIssue(config, repoId, { title, body, labelIds }) {
  if (isGitea(config)) {
    const issue = await giteaRequest(config, 'POST', `/repos/${config.owner}/${config.repo}/issues`, {
      title, body: body || '', labels: (labelIds || []).map((id) => parseInt(String(id), 10)),
    });
    return giteaIssueToInternal(issue);
  }
  const data = await gql(
    config,
    `mutation($repoId:ID!,$title:String!,$body:String,$labelIds:[ID!]){
      createIssue(input:{repositoryId:$repoId,title:$title,body:$body,labelIds:$labelIds}){
        issue{ ${ISSUE_FIELDS} }
      }
    }`,
    { repoId, title, body, labelIds: labelIds || [] }
  );
  return data.createIssue.issue;
}

async function apiUpdateIssue(config, id, { title, body }) {
  if (isGitea(config)) {
    const issue = await giteaRequest(config, 'PATCH', `/repos/${config.owner}/${config.repo}/issues/${id}`, { title, body: body || '' });
    return giteaIssueToInternal(issue);
  }
  const data = await gql(
    config,
    `mutation($id:ID!,$title:String!,$body:String){
      updateIssue(input:{id:$id,title:$title,body:$body}){
        issue{ ${ISSUE_FIELDS} }
      }
    }`,
    { id, title, body }
  );
  return data.updateIssue.issue;
}

async function apiSetIssueState(config, id, state) {
  if (isGitea(config)) {
    const issue = await giteaRequest(config, 'PATCH', `/repos/${config.owner}/${config.repo}/issues/${id}`, { state });
    return giteaIssueToInternal(issue);
  }
  const isClosed = state === 'closed';
  const data = await gql(
    config,
    `mutation($id:ID!){
      ${isClosed ? 'closeIssue' : 'reopenIssue'}(input:{issueId:$id}){ issue{ ${ISSUE_FIELDS} } }
    }`,
    { id }
  );
  return isClosed ? data.closeIssue.issue : data.reopenIssue.issue;
}

async function apiCloseIssue(config, id) {
  return apiSetIssueState(config, id, 'closed');
}

async function apiReopenIssue(config, id) {
  return apiSetIssueState(config, id, 'open');
}

async function apiDeleteIssue(config, id) {
  if (isGitea(config)) {
    await giteaRequest(config, 'DELETE', `/repos/${config.owner}/${config.repo}/issues/${id}`);
    return;
  }
  await gql(
    config,
    `mutation($id:ID!){ deleteIssue(input:{issueId:$id}){ repository{ id } } }`,
    { id }
  );
}

/* ---------------- 标签写操作 ---------------- */

async function apiAddLabels(config, labelableId, labelIds) {
  if (isGitea(config)) {
    // Gitea REST 要求 labels 为 int64 标签 ID 数组，不能传字符串
    const arr = await giteaRequest(config, 'POST', `/repos/${config.owner}/${config.repo}/issues/${labelableId}/labels`, {
      labels: (labelIds || []).map((id) => parseInt(String(id), 10)),
    });
    return (Array.isArray(arr) ? arr : []).map((l) => ({ id: String(l.id), name: l.name, color: normalizeColor(l.color) }));
  }
  const data = await gql(
    config,
    `mutation($id:ID!,$labelIds:[ID!]!){
      addLabelsToLabelable(input:{labelableId:$id,labelIds:$labelIds}){
        labelable{ ... on Issue{ id labels(first:100){ nodes{ id name color } } } }
      }
    }`,
    { id: labelableId, labelIds }
  );
  return data.addLabelsToLabelable.labelable.labels.nodes;
}

async function apiRemoveLabels(config, labelableId, labelIds) {
  if (isGitea(config)) {
    for (const lid of labelIds || []) {
      await giteaRequest(config, 'DELETE', `/repos/${config.owner}/${config.repo}/issues/${labelableId}/labels/${lid}`);
    }
    return;
  }
  const data = await gql(
    config,
    `mutation($id:ID!,$labelIds:[ID!]!){
      removeLabelsFromLabelable(input:{labelableId:$id,labelIds:$labelIds}){
        labelable{ ... on Issue{ id labels(first:100){ nodes{ id name color } } } }
      }
    }`,
    { id: labelableId, labelIds }
  );
  return data.removeLabelsFromLabelable.labelable.labels.nodes;
}

async function apiCreateLabel(config, repoId, name, color) {
  if (isGitea(config)) {
    const l = await giteaRequest(config, 'POST', `/repos/${config.owner}/${config.repo}/labels`, {
      name, color: normalizeColor(color),
    });
    return { id: String(l.id), name: l.name, color: normalizeColor(l.color) };
  }
  const data = await gql(
    config,
    `mutation($repoId:ID!,$name:String!,$color:String!){
      createLabel(input:{repositoryId:$repoId,name:$name,color:$color}){ label{ id name color } }
    }`,
    { repoId, name, color }
  );
  return data.createLabel.label;
}

async function apiDeleteLabel(config, labelId) {
  if (isGitea(config)) {
    await giteaRequest(config, 'DELETE', `/repos/${config.owner}/${config.repo}/labels/${labelId}`);
    return;
  }
  await gql(
    config,
    `mutation($id:ID!){ deleteLabel(input:{id:$id}){ repository{ id } } }`,
    { id: labelId }
  );
}

/* ---------------- 复合操作（减少请求数） ---------------- */

/* 设置进度百分比 + 状态整合（100% 关闭 / <100% 重开），一次请求完成。
 * oldProgressLabels：调用方记录的旧进度标签（id 列表），用于幂等移除。
 * targetLabelId：目标进度标签 id，为空时先创建（返回 createdLabel）。
 * 返回 { labels, state, closedAt, createdLabel }（labels 为应用后 issue 标签）。 */
async function apiApplyProgress(config, apiId, value, oldProgressLabels, targetLabelId) {
  const targetName = APP_CONFIG.PROGRESS_PREFIX + value + '%';
  const isClosed = value >= 100;
  const old = oldProgressLabels || [];
  if (isGitea(config)) {
    const tasks = [];
    for (const l of old) {
      tasks.push(
        giteaRequest(config, 'DELETE', `/repos/${config.owner}/${config.repo}/issues/${apiId}/labels/${l.id}`)
          .catch(() => null) /* 标签可能已不存在，忽略 404 */
      );
    }
    let target = null;
    if (targetLabelId) {
      target = { id: targetLabelId };
    } else {
      const labels = await giteaRequest(config, 'GET', `/repos/${config.owner}/${config.repo}/labels`);
      target = (labels || []).find((l) => l.name === targetName);
      if (!target) {
        const created = await giteaRequest(config, 'POST', `/repos/${config.owner}/${config.repo}/labels`, {
          name: targetName, color: APP_CONFIG.LABEL_COLORS.progress,
        });
        target = { id: created.id };
      }
    }
    tasks.push(
      giteaRequest(config, 'POST', `/repos/${config.owner}/${config.repo}/issues/${apiId}/labels`, {
        labels: [parseInt(String(target.id), 10)],
      }).catch(() => null),
      giteaRequest(config, 'PATCH', `/repos/${config.owner}/${config.repo}/issues/${apiId}`, {
        state: isClosed ? 'closed' : 'open',
      }).catch(() => null)
    );
    await Promise.all(tasks);
    const issue = await giteaRequest(config, 'GET', `/repos/${config.owner}/${config.repo}/issues/${apiId}`);
    const internal = giteaIssueToInternal(issue);
    return { labels: internal.labels.nodes, state: internal.state, closedAt: internal.closedAt, createdLabel: null };
  }

  let createdLabel = null;
  if (!targetLabelId) {
    const data = await gql(
      config,
      `mutation($repoId:ID!,$name:String!,$color:String!){
        createLabel(input:{repositoryId:$repoId,name:$name,color:$color}){ label{ id name color } }
      }`,
      { repoId: config.repoId, name: targetName, color: APP_CONFIG.LABEL_COLORS.progress }
    );
    createdLabel = data.createLabel.label;
    targetLabelId = createdLabel.id;
  }
  // 复合 mutation：remove(旧进度标签) + add(目标) + close/reopen，一次 POST
  const varDefs = [];
  const vars = {};
  const fields = [];
  if (old.length) {
    varDefs.push('$rid:ID!', '$oldIds:[ID!]!');
    vars.rid = apiId; vars.oldIds = old.map((l) => l.id);
    fields.push(`r: removeLabelsFromLabelable(input:{labelableId:$rid,labelIds:$oldIds}){
      labelable{ ... on Issue{ id labels(first:100){ nodes{ id name color } } } }
    }`);
  }
  varDefs.push('$aid:ID!', '$aLabelIds:[ID!]!');
  vars.aid = apiId; vars.aLabelIds = [targetLabelId];
  fields.push(`a: addLabelsToLabelable(input:{labelableId:$aid,labelIds:$aLabelIds}){
    labelable{ ... on Issue{ id labels(first:100){ nodes{ id name color } } } }
  }`);
  if (isClosed) {
    varDefs.push('$cid:ID!');
    vars.cid = apiId;
    fields.push(`c: closeIssue(input:{issueId:$cid}){ issue{ id state closedAt labels(first:100){ nodes{ id name color } } } }`);
  } else {
    varDefs.push('$oid:ID!');
    vars.oid = apiId;
    fields.push(`o: reopenIssue(input:{issueId:$oid}){ issue{ id state closedAt labels(first:100){ nodes{ id name color } } } }`);
  }
  const data = await gql(config, `mutation(${varDefs.join(',')}){ ${fields.join('\n')} }`, vars);
  const labelable = (data.r && data.r.labelable) || (data.a && data.a.labelable) || null;
  const issue = (data.c && data.c.issue) || (data.o && data.o.issue) || null;
  return {
    labels: labelable ? labelable.labels.nodes : (issue ? issue.labels.nodes : null),
    state: issue ? issue.state : null,
    closedAt: issue ? issue.closedAt : null,
    createdLabel,
  };
}

/* 批量设置 issue 标签（增 + 删），一次请求完成；返回应用后的标签列表 */
async function apiApplyTags(config, apiId, addIds, removeIds) {
  addIds = addIds || [];
  removeIds = removeIds || [];
  if (isGitea(config)) {
    const tasks = [];
    if (addIds.length) {
      tasks.push(
        giteaRequest(config, 'POST', `/repos/${config.owner}/${config.repo}/issues/${apiId}/labels`, {
          labels: addIds.map((id) => parseInt(String(id), 10)),
        }).catch(() => null)
      );
    }
    for (const lid of removeIds) {
      tasks.push(
        giteaRequest(config, 'DELETE', `/repos/${config.owner}/${config.repo}/issues/${apiId}/labels/${lid}`)
          .catch(() => null)
      );
    }
    await Promise.all(tasks);
    const issue = await giteaRequest(config, 'GET', `/repos/${config.owner}/${config.repo}/issues/${apiId}`);
    return giteaIssueToInternal(issue).labels.nodes;
  }
  if (!addIds.length && !removeIds.length) return [];
  const varDefs = [];
  const vars = {};
  const fields = [];
  if (addIds.length) {
    varDefs.push('$aid:ID!', '$aIds:[ID!]!');
    vars.aid = apiId; vars.aIds = addIds;
    fields.push(`a: addLabelsToLabelable(input:{labelableId:$aid,labelIds:$aIds}){
      labelable{ ... on Issue{ id labels(first:100){ nodes{ id name color } } } }
    }`);
  }
  if (removeIds.length) {
    varDefs.push('$rid:ID!', '$rIds:[ID!]!');
    vars.rid = apiId; vars.rIds = removeIds;
    fields.push(`r: removeLabelsFromLabelable(input:{labelableId:$rid,labelIds:$rIds}){
      labelable{ ... on Issue{ id labels(first:100){ nodes{ id name color } } } }
    }`);
  }
  const data = await gql(config, `mutation(${varDefs.join(',')}){ ${fields.join('\n')} }`, vars);
  const labelable = (data.a && data.a.labelable) || (data.r && data.r.labelable);
  return labelable ? labelable.labels.nodes : [];
}

/* 批量删除标签，一次请求完成（GraphQL 多 alias；Gitea 并行） */
async function apiBatchDeleteLabels(config, labelIds) {
  labelIds = labelIds || [];
  if (!labelIds.length) return;
  if (isGitea(config)) {
    await Promise.all(
      labelIds.map((id) => giteaRequest(config, 'DELETE', `/repos/${config.owner}/${config.repo}/labels/${id}`).catch(() => null))
    );
    return;
  }
  const varDefs = [];
  const vars = {};
  const fields = labelIds.map((id, i) => {
    varDefs.push('$id' + i + ':ID!');
    vars['id' + i] = id;
    return `d${i}: deleteLabel(input:{id:$id${i}}){ repository{ id } }`;
  });
  await gql(config, `mutation(${varDefs.join(',')}){ ${fields.join('\n')} }`, vars);
}
