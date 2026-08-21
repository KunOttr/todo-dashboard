/* GitHub GraphQL / Gitea REST 双 API 封装（按 config.provider 分支） */
'use strict';

/* ---------------- 基础 HTTP ---------------- */

async function gql(config, query, variables) {
  let res;
  try {
    res = await fetch(APP_CONFIG.GRAPHQL_ENDPOINT, {
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
  const json = await res.json();
  if (json.errors && json.errors.length) {
    const msg = json.errors.map((err) => err.message).join('; ');
    throw new Error(msg);
  }
  return json.data;
}

function isGitea(config) {
  return config && config.provider === 'gitea';
}

function giteaApiBase(config) {
  const base = (config.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('缺少 Gitea 服务器地址');
  return base + '/api/v1';
}

async function giteaRequest(config, method, path, body) {
  const url = giteaApiBase(config) + path;
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
      title, body: body || '', labels: (labelIds || []).map(String),
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
    await giteaRequest(config, 'PATCH', `/repos/${config.owner}/${config.repo}/issues/${id}`, { title, body: body || '' });
    return;
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
    await giteaRequest(config, 'PATCH', `/repos/${config.owner}/${config.repo}/issues/${id}`, { state });
    return;
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
    await giteaRequest(config, 'POST', `/repos/${config.owner}/${config.repo}/issues/${labelableId}/labels`, {
      labels: (labelIds || []).map(String),
    });
    return [];
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
