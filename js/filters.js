/* 待办派生数据与组合筛选逻辑 */
'use strict';

function isProgressLabel(name) {
  return /^进度:\d+%$/.test(name || '');
}

function isArchiveLabel(name) {
  return name === APP_CONFIG.ARCHIVE_TAG;
}

function deriveIssueMeta(issue) {
  const labels = (issue.labels && issue.labels.nodes) || [];
  let progress = 0;
  let hasProgress = false;
  for (const l of labels) {
    if (isProgressLabel(l.name)) {
      hasProgress = true;
      const v = parseInt(l.name.slice(APP_CONFIG.PROGRESS_PREFIX.length), 10);
      if (!isNaN(v) && v > progress) progress = v;
    }
  }
  return {
    progress,
    percent: hasProgress, // 是否带百分比进度标签（0% 也视为支持百分比）
    isArchived: labels.some((l) => isArchiveLabel(l.name)),
    tags: labels.filter((l) => !isProgressLabel(l.name)),
  };
}

/**
 * 组合筛选。各筛选条件之间为「与」关系：
 *  - 关键词：标题 / 描述 / 标签名包含关键词
 *  - 标签：多选，支持「任一」或「全部」匹配
 *  - 时间：可按创建时间或完成时间，分别指定起止（可只填其一）
 *  - 归档：默认隐藏，开关或选中「归档」标签时显示
 */
function applyFilters(issues, filters) {
  const kw = (filters.keyword || '').trim().toLowerCase();
  const tagSet = new Set(filters.selectedTags || []);
  const tagMode = filters.tagMatchMode || 'any';
  const timeField = filters.timeField || 'created';
  const startTs = filters.startDate ? new Date(filters.startDate + 'T00:00:00').getTime() : null;
  const endTs = filters.endDate ? new Date(filters.endDate + 'T23:59:59.999').getTime() : null;
  const showArchived = !!filters.showArchived || tagSet.has(APP_CONFIG.ARCHIVE_TAG);

  return issues.filter((raw) => {
    const meta = deriveIssueMeta(raw);

    // 归档可见性
    if (!showArchived && meta.isArchived) return false;

    // 关键词搜索（标题 + 描述 + 标签名）
    if (kw) {
      const tagText = meta.tags.map((t) => t.name).join(' ');
      const hay = ((raw.title || '') + ' ' + (raw.body || '') + ' ' + tagText).toLowerCase();
      if (!hay.includes(kw)) return false;
    }

    // 标签筛选（任一 / 全部）
    if (tagSet.size) {
      const names = new Set(meta.tags.map((t) => t.name));
      if (tagMode === 'all') {
        for (const t of tagSet) {
          if (!names.has(t)) return false;
        }
      } else {
        let hit = false;
        for (const t of tagSet) {
          if (names.has(t)) { hit = true; break; }
        }
        if (!hit) return false;
      }
    }

    // 时间筛选（可只填起 / 止）
    const ts = timeField === 'closed' ? raw.closedAt : raw.createdAt;
    if (ts) {
      const t = new Date(ts).getTime();
      if (startTs !== null && t < startTs) return false;
      if (endTs !== null && t > endTs) return false;
    } else if (timeField === 'closed' && (startTs !== null || endTs !== null)) {
      // 按完成时间筛选时，未完成任务没有完成时间，直接排除
      return false;
    }

    return true;
  });
}
