/* GitHub GraphQL API 封装 */
'use strict';

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

async function apiGetRepo(config) {
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

async function apiCreateIssue(config, repoId, { title, body, labelIds }) {
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

async function apiCloseIssue(config, id) {
  const data = await gql(
    config,
    `mutation($id:ID!){ closeIssue(input:{issueId:$id}){ issue{ ${ISSUE_FIELDS} } } }`,
    { id }
  );
  return data.closeIssue.issue;
}

async function apiReopenIssue(config, id) {
  const data = await gql(
    config,
    `mutation($id:ID!){ reopenIssue(input:{issueId:$id}){ issue{ ${ISSUE_FIELDS} } } }`,
    { id }
  );
  return data.reopenIssue.issue;
}

async function apiDeleteIssue(config, id) {
  await gql(
    config,
    `mutation($id:ID!){ deleteIssue(input:{issueId:$id}){ repository{ id } } }`,
    { id }
  );
}

async function apiAddLabels(config, labelableId, labelIds) {
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
  await gql(
    config,
    `mutation($id:ID!){ deleteLabel(input:{id:$id}){ repository{ id } } }`,
    { id: labelId }
  );
}
