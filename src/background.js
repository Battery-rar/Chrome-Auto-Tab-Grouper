const SETTINGS_KEY = "autoTabGrouperSettings";
const CACHE_KEY = "autoTabGrouperCloudCache";
const CLOUD_CACHE_VERSION = "2026-07-12-cloud-ai-v3";
const LAST_STATUS_KEY = "autoTabGrouperLastStatus";
const LOG_KEY = "autoTabGrouperLogs";

const DEFAULT_SETTINGS = {
  mode: "local",
  includeSingleTabGroups: false,
  cloudApiUrl: "",
  cloudApiKey: "",
  cloudModel: "",
  cacheTtlHours: 24,
  disableThinking: true
};

const CLOUD_TIMEOUT_MS = 60000;
const CLOUD_MAX_OUTPUT_TOKENS = 4096;
const CLOUD_DEEPSEEK_MAX_OUTPUT_TOKENS = 8192;
const CLOUD_FETCH_RETRY_DELAYS_MS = [700, 1800];
const TAB_MOVE_SETTLE_DELAY_MS = 120;
const TAB_MOVE_MAX_VERIFY_ATTEMPTS = 3;
const MAX_LOG_ENTRIES = 120;
const MAX_LOG_DETAIL_LENGTH = 5000;
loadRuleDefinitions();

const {
  WEAK_TITLE_GROUPS,
  FUNCTIONAL_TOPIC_STOP_WORDS,
  SOURCE_NAME_PATTERN,
  GROUP_COLORS,
  FUNCTIONAL_SITE_GROUPS,
  CLOUD_FINE_GRAINED_GROUPS,
  SEARCH_ENGINE_DOMAINS,
  DOMAIN_DISPLAY_NAMES,
  PRODUCT_DOMAIN_GROUPS,
  TITLE_TOPIC_RULES,
  SITE_PROPERTY_RULES,
  MULTI_PART_TLDS
} = globalThis.AUTO_TAB_GROUPER_RULES;

function loadRuleDefinitions() {
  if (globalThis.AUTO_TAB_GROUPER_RULES) {
    return;
  }
  if (typeof importScripts === "function") {
    importScripts("rules.js");
  }
  if (!globalThis.AUTO_TAB_GROUPER_RULES) {
    throw new Error("分类规则未加载。");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await setSettings({ ...DEFAULT_SETTINGS, ...settings });
  await setBadge(settings.mode);
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await setBadge(settings.mode);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[SETTINGS_KEY]) {
    return;
  }
  getSettings().then((settings) => {
    setBadge(settings.mode);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "get-settings") {
      sendResponse({ ok: true, settings: await getSettings(), status: await getLastStatus() });
      return;
    }

    if (message?.type === "get-logs") {
      sendResponse({ ok: true, logs: await getLogs() });
      return;
    }

    if (message?.type === "clear-logs") {
      await clearLogs();
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "save-settings") {
      await setSettings({ ...(await getSettings()), ...message.settings });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "regroup-now") {
      const [activeTab] = await queryTabs({ active: true, currentWindow: true });
      if (!activeTab?.windowId) {
        sendResponse({ ok: false, error: "没有找到当前窗口。" });
        return;
      }
      const result = await regroupWindow(activeTab.windowId);
      sendResponse({ ok: true, result });
      return;
    }

    if (message?.type === "test-cloud") {
      const settings = await getSettings();
      const testItems = [
          toClassifiableTab({
            id: 1,
            title: "React Documentation",
            url: "https://react.dev/learn"
          }),
          toClassifiableTab({
            id: 2,
            title: "OpenAI API Reference",
            url: "https://platform.openai.com/docs/api-reference"
          })
      ];
      const result = await classifyTabBatchWithCloud(
        testItems,
        buildCloudCandidates(testItems),
        settings,
        true
      );
      sendResponse({ ok: true, result });
      return;
    }

    sendResponse({ ok: false, error: "未知消息。" });
  })().catch((error) => {
    sendResponse({ ok: false, error: normalizeError(error) });
  });

  return true;
});

async function regroupWindow(windowId) {
  const settings = await getSettings();
  await setBadge(settings.mode);

  const tabs = (await queryTabs({ windowId })).filter(isGroupableTab);
  if (tabs.length === 0) {
    const status = { ok: true, message: "没有可分组的网页标签。", at: Date.now() };
    await setLastStatus(status);
    return { groupedTabs: 0, groups: 0, message: status.message };
  }

  const classification = await classifyTabs(tabs, settings);
  const classified = stabilizeSingletonsByDomain(classification.items, settings);

  let groupCount = 0;
  let groupedTabs = 0;
  const { eligibleGroups, groupedTabIdsInOrder } = buildEligibleTabGroups(classified, settings);
  const groupedStartIndex = getFirstGroupableTabIndex(tabs);
  const existingGroups = await queryTabGroups({ windowId });
  const { groupIdByName, duplicateGroupIds } = selectReusableGroupsByTitle(
    existingGroups,
    eligibleGroups.map(([groupName]) => groupName),
    await queryTabs({ windowId })
  );

  const targetGroups = [];
  const currentTabsBeforeGrouping = await queryTabs({ windowId });
  const groupIdByTabId = new Map(currentTabsBeforeGrouping.map((tab) => [tab.id, tab.groupId]));
  for (const [groupName, tabIds] of eligibleGroups) {
    const reusableGroupId = groupIdByName.get(groupName);
    const groupId = reusableGroupId || await groupTabIds(tabIds);
    if (reusableGroupId) {
      const missingTabIds = tabIds.filter((tabId) => groupIdByTabId.get(tabId) !== reusableGroupId);
      await addTabIdsToGroup(reusableGroupId, missingTabIds);
    }
    await updateGroup(groupId, {
      title: groupName,
      color: colorForIndex(groupCount),
      collapsed: false
    });
    for (const tabId of tabIds) {
      groupIdByTabId.set(tabId, groupId);
    }
    targetGroups.push({ groupId, groupName, tabIds });
    groupCount += 1;
    groupedTabs += tabIds.length;
  }

  await ungroupTabIds(getStaleGroupedTabIds(await queryTabs({ windowId }), groupedTabIdsInOrder));
  await cleanupDuplicateGroups(windowId, duplicateGroupIds, new Set(targetGroups.map((group) => group.groupId)));
  await ensureGroupMembership(windowId, targetGroups);
  await ensureTabOrder(windowId, groupedTabIdsInOrder, groupedStartIndex);
  await ensureGroupMembership(windowId, targetGroups);
  await ensureTabOrder(windowId, groupedTabIdsInOrder, groupedStartIndex);

  const skippedTabs = tabs.length - groupedTabs;
  let resultMessage = `已整理 ${groupedTabs} 个标签，整理成 ${groupCount} 个分组。`;
  if (!settings.includeSingleTabGroups && groupCount === 0) {
    resultMessage = "没有形成至少 2 个标签的分类，已取消单标签分组。";
  } else if (!settings.includeSingleTabGroups && skippedTabs > 0) {
    resultMessage = `${resultMessage} 已跳过 ${skippedTabs} 个单标签分类。`;
  }

  const statusMessage = classification.warning
    ? `${classification.warning} ${resultMessage}`
    : resultMessage;
  const status = {
    ok: !classification.warning,
    message: statusMessage,
    at: Date.now()
  };
  await setLastStatus(status);
  if (!classification.warning) {
    await setBadge(settings.mode);
  }
  return { groupedTabs, groups: groupCount, message: status.message, warning: classification.warning };
}

function buildEligibleTabGroups(classified, settings) {
  const groups = new Map();

  for (const item of classified) {
    if (!item.group) {
      continue;
    }
    const groupName = truncateGroupTitle(item.group);
    if (!groups.has(groupName)) {
      groups.set(groupName, []);
    }
    groups.get(groupName).push(item.tab.id);
  }

  const eligibleGroups = [...groups.entries()]
    .filter(([, tabIds]) => settings.includeSingleTabGroups || tabIds.length >= 2)
    .sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"));

  return {
    eligibleGroups,
    groupedTabIdsInOrder: eligibleGroups.flatMap(([, tabIds]) => tabIds)
  };
}

function selectReusableGroupsByTitle(existingGroups, targetGroupNames, currentTabs = []) {
  const targetNameSet = new Set(targetGroupNames);
  const tabCountsByGroupId = countBy(
    currentTabs.filter(isTabInGroup),
    (tab) => tab.groupId
  );
  const candidates = existingGroups
    .filter((group) => targetNameSet.has(group.title || ""))
    .sort((left, right) => {
      const countDelta = Number(tabCountsByGroupId.get(right.id) || 0) - Number(tabCountsByGroupId.get(left.id) || 0);
      return countDelta || left.id - right.id;
    });

  const groupIdByName = new Map();
  const duplicateGroupIds = [];
  for (const group of candidates) {
    if (!groupIdByName.has(group.title)) {
      groupIdByName.set(group.title, group.id);
      continue;
    }
    duplicateGroupIds.push(group.id);
  }

  return { groupIdByName, duplicateGroupIds };
}

async function cleanupDuplicateGroups(windowId, duplicateGroupIds, protectedGroupIds) {
  const duplicateGroupIdSet = new Set(
    duplicateGroupIds.filter((groupId) => !protectedGroupIds.has(groupId))
  );
  if (!duplicateGroupIdSet.size) {
    return;
  }

  const duplicateTabIds = (await queryTabs({ windowId }))
    .filter((tab) => duplicateGroupIdSet.has(tab.groupId))
    .map((tab) => tab.id);
  await ungroupTabIds(duplicateTabIds);
  if (duplicateTabIds.length) {
    await appendLog("info", "已清理重复旧分组", {
      groupIds: [...duplicateGroupIdSet],
      tabIds: duplicateTabIds
    });
  }
}

function getStaleGroupedTabIds(tabs, groupedTabIds) {
  const groupedTabIdSet = new Set(groupedTabIds);
  return tabs
    .filter((tab) => isTabInGroup(tab) && !groupedTabIdSet.has(tab.id))
    .map((tab) => tab.id);
}

async function classifyTabs(tabs, settings) {
  if (settings.mode === "cloud") {
    try {
      return { items: await classifyTabsWithCache(tabs, settings), warning: "" };
    } catch (error) {
      const warning = `云端分类失败，已回退到本地规则：${normalizeError(error)}`;
      await appendLog("error", "云端分类失败，回退本地规则", normalizeError(error));
      await setBadge("error");
      return {
        items: classifyLocalTabs(tabs),
        warning
      };
    }
  }

  return {
    items: classifyLocalTabs(tabs),
    warning: ""
  };
}

function classifyLocalTabs(tabs) {
  const { items } = buildClassifiableItems(tabs);
  return items.map((item) => ({
    tab: item.tab,
    group: item.localFallback
  }));
}

function getFunctionalContextGroupByTabId(tabs) {
  const buckets = new Map();

  for (const tab of tabs) {
    const topic = getFunctionalTopic(tab);
    if (!topic) {
      continue;
    }
    const key = normalizeTopicKey(topic);
    if (!key) {
      continue;
    }
    if (!buckets.has(key)) {
      buckets.set(key, { group: topic, tabs: [] });
    }
    buckets.get(key).tabs.push(tab);
  }

  const groupByTabId = new Map();
  for (const bucket of buckets.values()) {
    if (bucket.tabs.length < 2) {
      continue;
    }
    for (const tab of bucket.tabs) {
      groupByTabId.set(tab.id, bucket.group);
    }
  }
  return groupByTabId;
}

function stabilizeSingletonsByDomain(items, settings) {
  if (settings.includeSingleTabGroups) {
    return items;
  }

  const groupCounts = countBy(items, (item) => item.group);
  const domainBuckets = new Map();

  for (const item of items) {
    const domainName = getDomainName(item.tab?.url || "");
    const domainKey = normalizeTopicKey(domainName);
    if (!domainKey || domainKey === "其他" || !domainName || domainName === "其他") {
      continue;
    }
    if (!domainBuckets.has(domainKey)) {
      domainBuckets.set(domainKey, { group: domainName, items: [] });
    }
    domainBuckets.get(domainKey).items.push(item);
  }

  const fallbackByTabId = new Map();
  for (const bucket of domainBuckets.values()) {
    if (bucket.items.length < 2) {
      continue;
    }
    for (const item of bucket.items) {
      const isSingleton = Number(groupCounts.get(item.group) || 0) === 1;
      if (isSingleton && item.group !== bucket.group) {
        fallbackByTabId.set(item.tab.id, bucket.group);
      }
    }
  }

  if (!fallbackByTabId.size) {
    return items;
  }

  return items.map((item) => {
    const fallbackGroup = fallbackByTabId.get(item.tab.id);
    return fallbackGroup ? { ...item, group: fallbackGroup } : item;
  });
}

function countBy(items, getKey) {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function classifyTabsWithCache(tabs, settings) {
  assertCloudSettings(settings);

  const now = Date.now();
  const cacheTtl = Math.max(1, Number(settings.cacheTtlHours || DEFAULT_SETTINGS.cacheTtlHours)) * 60 * 60 * 1000;
  const cache = (await getStorage(CACHE_KEY)) || {};
  const { items, localFallbackByTabId } = buildClassifiableItems(tabs);
  const batchKey = getCloudBatchCacheKey(items, settings);
  const cached = cache[batchKey];

  if (cached && now - cached.at < cacheTtl && cached.groups) {
    await appendLog("info", "命中云端分类缓存", { tabs: tabs.length, cacheKey: batchKey });
    return tabs.map((tab) => ({
      tab,
      group: cached.groups[getTabSignature(tab)] || localFallbackByTabId.get(tab.id) || getLocalGroup(tab)
    }));
  }

  const candidates = buildCloudCandidates(items);
  await appendLog("info", "准备云端分类", {
    tabs: tabs.length,
    mode: "tab-batch",
    candidates: candidates.length,
    candidateSummary: summarizeCandidates(candidates)
  });
  const cloudResults = items.length > 0
    ? await classifyTabBatchWithCloud(items, candidates, settings)
    : [];
  const groupByTabId = new Map(cloudResults.map((result) => [Number(result.tabId), result.group]));
  const classified = tabs.map((tab) => ({
    tab,
    group: groupByTabId.get(tab.id) || localFallbackByTabId.get(tab.id) || getLocalGroup(tab)
  }));

  cache[batchKey] = {
    at: now,
    groups: Object.fromEntries(classified.map((item) => [getTabSignature(item.tab), item.group]))
  };
  await setStorage(CACHE_KEY, trimCache(cache, now, cacheTtl));

  return classified;
}

async function classifyTabBatchWithCloud(items, candidates, settings, isTest = false) {
  assertCloudSettings(settings);

  const apiUrl = settings.cloudApiUrl.trim();
  const isResponsesEndpoint = /\/responses\/?$/.test(new URL(apiUrl).pathname);
  const requestMeta = {
    endpoint: safeEndpoint(apiUrl),
    endpointType: isResponsesEndpoint ? "responses" : "chat-completions",
    model: settings.cloudModel.trim(),
    tabs: items.length,
    candidates: candidates.length,
    batchMode: "tabIds"
  };

  const systemPrompt = buildCloudSystemPrompt();
  const userPrompt = buildCloudUserPrompt(items, candidates);

  const resultGroups = await requestCloudGroups({
    settings,
    requestMeta,
    systemPrompt,
    userPrompt
  });
  await appendLog("info", "AI 批量分组解析结果", resultGroups);

  if (isTest && resultGroups.length === 0) {
    throw new Error("API 返回成功，但没有 groups 分类结果。");
  }

  return normalizeCloudAssignments(resultGroups, candidates, items);
}

function buildCloudSystemPrompt() {
  return [
    "你是浏览器标签页分类器。只输出最终 JSON，不要解释，不要 Markdown。",
    "目标：按用户真实任务把标签页分组，并给稳定、可复用、具体的中文组名。",
    "输入是本地规则生成的 candidates。优先以 candidateIds 合并候选组；只有候选组内部明显混入不同任务时，才用 tabIds 拆分。",
    "判断优先级：functionalTopics > titleTopics/searchQueryTopics > preferredDomainGroups > siteProperties > domainDisplayNames。",
    "强合并：同一产品、项目、仓库、技术栈、搜索词、安装/部署/配置/文档工作流，即使来自 GitHub、文档、视频、论坛、搜索，也应归到同一具体主题。",
    "弱合并：只有来源平台相同但主题不同的内容不要硬合并；GitHub、YouTube、哔哩哔哩、知乎、Reddit、搜索结果要继续看标题、URL、searchQuery 和 hints。",
    "命名：有产品/技术/任务就用它，例如 OpenAI API、Rime 输入法、Ollama 部署；没有明确主题再用站点名或属性。不要返回完整域名，组名最长 12 个中文字符。",
    "覆盖：每个输入 tabId 最多出现一次。可省略无法判断的 tab，程序会用本地分类兜底。",
    "json 输出要求：输出纯 JSON 对象。EXAMPLE JSON OUTPUT:",
    "{\"groups\":[{\"candidateIds\":[\"c1\",\"c2\"],\"group\":\"OpenAI API\"},{\"tabIds\":[3],\"group\":\"GitHub\"}]}",
    "唯一允许顶层格式：{\"groups\":[...]}。不要输出空 content。"
  ].join("\n");
}

function buildCloudUserPrompt(items, candidates) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return JSON.stringify({
    responseFormat: {
      type: "json_object",
      schema: { groups: [{ candidateIds: ["c1"], tabIds: [1], group: "具体组名" }] }
    },
    task: {
      mode: "mergeCandidatesAndSplitOnlyWhenNeeded",
      tabs: items.length,
      candidates: candidates.length,
      preferCandidateIds: true,
      localFallbackWillFillMissingTabs: true
    },
    rules: {
      mergeBy: ["sameFunctionalTopic", "sameTitleTopic", "sameSearchQueryTopic", "sameProductOrTech", "sameWorkflow"],
      keepSeparateWhenOnlySameSource: ["GitHub", "YouTube", "哔哩哔哩", "知乎", "Reddit", "搜索"],
      avoidNames: ["教程", "文章", "视频", "文档", "API", "代码", "AI", "搜索"],
      avoidDomainSuffixInGroupNames: true,
      maxGroupNameChineseChars: 12
    },
    candidates: candidates.map((candidate) => createCloudPromptCandidate(candidate, itemById))
  });
}

function createCloudPromptCandidate(candidate, itemById) {
  return compactObject({
    candidateId: candidate.candidateId,
    tabIds: candidate.tabIds,
    suggestedName: candidate.suggestedName,
    confidence: candidate.confidence,
    domains: candidate.domains,
    signals: compactObject({
      functionalTopics: candidate.functionalTopics,
      titleTopics: candidate.titleTopics,
      searchQueryTopics: candidate.searchQueryTopics,
      preferredDomainGroups: candidate.preferredDomainGroups,
      siteProperties: candidate.siteProperties,
      domainDisplayNames: candidate.domainDisplayNames
    }),
    hints: candidate.intelligenceHints,
    tabs: candidate.tabIds
      .map((tabId) => itemById.get(tabId))
      .filter(Boolean)
      .map(createCloudPromptTab)
  });
}

function createCloudPromptTab(item) {
  return compactObject({
    tabId: item.id,
    title: truncateString(item.title || "", 100),
    url: compactUrl(item.url || ""),
    domain: item.domain,
    searchQuery: item.searchQuery || "",
    localFallback: item.localFallback,
    signals: compactObject({
      functionalTopic: item.functionalTopic,
      titleTopic: item.titleTopic,
      searchQueryTopic: item.searchQueryTopic,
      preferredDomainGroup: item.preferredDomainGroup,
      siteProperty: item.siteProperty,
      domainDisplayName: item.domainDisplayName
    })
  });
}

function normalizeCloudAssignments(resultGroups, candidates, items) {
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const validTabIds = new Set(items.map((item) => Number(item.id)));
  const assignedTabIds = new Set();
  const assignments = [];

  for (const group of resultGroups) {
    const groupName = normalizeReturnedGroupName(group.group);
    if (!groupName) {
      continue;
    }

    for (const tabId of getTabIdsFromGroup(group, candidateById)) {
      const normalizedTabId = Number(tabId);
      if (!validTabIds.has(normalizedTabId) || assignedTabIds.has(normalizedTabId)) {
        continue;
      }
      assignedTabIds.add(normalizedTabId);
      assignments.push({
        tabId: normalizedTabId,
        group: groupName
      });
    }
  }

  return assignments;
}

async function requestCloudGroups({ settings, requestMeta, systemPrompt, userPrompt }) {
  assertCloudSettings(settings);

  const apiUrl = settings.cloudApiUrl.trim();
  const isResponsesEndpoint = /\/responses\/?$/.test(new URL(apiUrl).pathname);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.cloudApiKey.trim()}`
  };
  const isDeepSeek = shouldUseDeepSeekJsonOptimizations(settings);
  const disableThinking = shouldSendThinkingDisable(settings);
  const attempts = getCloudRequestAttempts({ disableThinking, preferJsonMode: isDeepSeek });
  let lastError;
  let skipJsonMode = false;
  let skipThinking = false;

  for (const attempt of attempts) {
    if ((skipJsonMode && attempt.useJsonMode) || (skipThinking && attempt.disableThinking)) {
      continue;
    }

    try {
      await appendLog("info", "发送云端请求", {
        ...requestMeta,
        jsonMode: attempt.useJsonMode,
        thinkingDisabled: attempt.disableThinking,
        deepSeekJsonOptimized: isDeepSeek
      });
      const data = await postCloudJson(apiUrl, headers, buildCloudRequestBody({
        isResponsesEndpoint,
        model: settings.cloudModel.trim(),
        systemPrompt,
        userPrompt,
        useJsonMode: attempt.useJsonMode,
        disableThinking: attempt.disableThinking,
        maxOutputTokens: isDeepSeek ? CLOUD_DEEPSEEK_MAX_OUTPUT_TOKENS : CLOUD_MAX_OUTPUT_TOKENS,
        temperature: isDeepSeek ? 0 : 0.1
      }));
      await appendLog("debug", "云端响应 JSON", data);
      assertCloudCompletionUsable(data);
      const content = extractModelContent(data);
      await appendLog("ai", "AI 返回内容", content);
      const parsed = parseModelJson(content);
      const groups = normalizeResultGroups(parsed);
      if (!groups.length) {
        throw new Error("模型返回 JSON，但 groups 为空。");
      }
      return groups;
    } catch (error) {
      lastError = error;
      const jsonModeError = attempt.useJsonMode && isLikelyJsonModeError(error);
      const thinkingError = attempt.disableThinking && isLikelyThinkingParamError(error);
      const transientFetchError = isLikelyTransientFetchError(error);
      const retryableOutputError = isLikelyRetryableModelOutputError(error);
      if (!jsonModeError && !thinkingError && !transientFetchError && !retryableOutputError) {
        throw error;
      }
      skipJsonMode = skipJsonMode || jsonModeError;
      skipThinking = skipThinking || thinkingError;
      await appendLog("warn", getCloudRetryLogMessage({ transientFetchError, retryableOutputError }), {
        jsonMode: attempt.useJsonMode,
        thinkingDisabled: attempt.disableThinking,
        transientFetchError,
        retryableOutputError,
        nextSkipJsonMode: skipJsonMode,
        nextSkipThinking: skipThinking,
        reason: normalizeError(error)
      });
    }
  }

  throw lastError || new Error("云端请求失败。");
}

function getCloudRequestAttempts({ disableThinking, preferJsonMode = false }) {
  const attempts = preferJsonMode
    ? [
        { useJsonMode: true, disableThinking },
        { useJsonMode: true, disableThinking: false },
        { useJsonMode: false, disableThinking },
        { useJsonMode: false, disableThinking: false }
      ]
    : [
        { useJsonMode: true, disableThinking },
        { useJsonMode: false, disableThinking },
        { useJsonMode: true, disableThinking: false },
        { useJsonMode: false, disableThinking: false }
      ];
  return attempts.filter((attempt, index, list) => {
    return index === list.findIndex((item) => {
      return item.useJsonMode === attempt.useJsonMode && item.disableThinking === attempt.disableThinking;
    });
  });
}

function buildCloudRequestBody({ isResponsesEndpoint, model, systemPrompt, userPrompt, useJsonMode, disableThinking, maxOutputTokens, temperature }) {
  const thinkingConfig = disableThinking ? { thinking: { type: "disabled" } } : {};
  if (isResponsesEndpoint) {
    return {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature,
      max_output_tokens: maxOutputTokens,
      ...(useJsonMode ? { text: { format: { type: "json_object" } } } : {}),
      ...thinkingConfig
    };
  }

  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature,
    max_tokens: maxOutputTokens,
    ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
    ...thinkingConfig
  };
}

function shouldSendThinkingDisable(settings) {
  if (settings.disableThinking === false) {
    return false;
  }

  const text = `${settings.cloudModel || ""} ${settings.cloudApiUrl || ""}`.toLowerCase();
  return /\bdeepseek\b|deepseek-|deepseek_/.test(text);
}

function shouldUseDeepSeekJsonOptimizations(settings) {
  const text = `${settings.cloudModel || ""} ${settings.cloudApiUrl || ""}`.toLowerCase();
  return /\bdeepseek\b|deepseek-|deepseek_/.test(text);
}

async function postCloudJson(apiUrl, headers, body) {
  let response;
  const requestText = JSON.stringify(body);
  const maxAttempts = 1 + CLOUD_FETCH_RETRY_DELAYS_MS.length;
  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLOUD_TIMEOUT_MS);
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: requestText,
        signal: controller.signal
      });
      break;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("云端分类超过 1 分钟，已停止等待。");
      }
      const canRetry = isRawTransientFetchError(error) && attemptIndex < maxAttempts - 1;
      if (!canRetry) {
        const requestError = new Error(`请求失败: ${normalizeError(error)}`);
        requestError.causeName = error?.name || "";
        requestError.requestChars = requestText.length;
        requestError.fetchAttempts = attemptIndex + 1;
        throw requestError;
      }
      await appendLog("warn", "云端 fetch 失败，短暂等待后重试", {
        attempt: attemptIndex + 1,
        maxAttempts,
        requestChars: requestText.length,
        errorName: error?.name || "",
        errorMessage: normalizeError(error)
      });
      await delay(CLOUD_FETCH_RETRY_DELAYS_MS[attemptIndex]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const responseText = typeof response.text === "function"
    ? await response.text()
    : JSON.stringify(await response.json());
  await appendLog("debug", "云端 HTTP 响应", {
    status: response.status,
    ok: response.ok,
    textPreview: truncateString(responseText, 1200)
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${responseText.slice(0, 400)}`);
    error.status = response.status;
    error.responseText = responseText;
    throw error;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return { output_text: responseText };
  }
}

function isLikelyJsonModeError(error) {
  const message = normalizeError(error).toLowerCase();
  return /response_format|json_object|json mode|text\.format|text format|unsupported.*json|invalid.*format|schema/.test(message);
}

function isLikelyThinkingParamError(error) {
  const message = normalizeError(error).toLowerCase();
  return /thinking|reasoning|unsupported.*parameter|unknown.*parameter|unrecognized.*parameter|invalid.*parameter|invalid.*thinking/.test(message);
}

function isLikelyTransientFetchError(error) {
  const message = normalizeError(error).toLowerCase();
  return isRawTransientFetchError(error) || /请求失败:.*(?:failed to fetch|networkerror|load failed|network request failed)/i.test(message);
}

function isLikelyRetryableModelOutputError(error) {
  const message = normalizeError(error);
  return /无法读取模型返回内容|模型没有返回可解析的 JSON|输出 token 消耗在 reasoning_content|JSON 字符串被中途截断|groups 为空/i.test(message);
}

function getCloudRetryLogMessage({ transientFetchError, retryableOutputError }) {
  if (transientFetchError) {
    return "云端网络层请求失败，准备重试";
  }
  if (retryableOutputError) {
    return "云端返回内容不稳定，准备重试";
  }
  return "云端请求参数不兼容，准备重试";
}

function isRawTransientFetchError(error) {
  const message = normalizeError(error).toLowerCase();
  return error?.name === "TypeError" && /failed to fetch|networkerror|load failed|network request failed/.test(message);
}

function assertCloudCompletionUsable(data) {
  const choice = data?.choices?.[0];
  const finishReason = choice?.finish_reason;
  const content = choice?.message?.content;
  const reasoningContent = choice?.message?.reasoning_content;

  if (finishReason === "length" && !String(content || "").trim() && String(reasoningContent || "").trim()) {
    throw new Error("模型把输出 token 消耗在 reasoning_content，最终 content 为空；这通常是 DeepSeek 等推理模型的输出预算耗尽。");
  }
}

function extractModelContent(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  if (typeof data?.text === "string" && data.text.trim()) {
    return data.text;
  }

  if (typeof data?.content === "string" && data.content.trim()) {
    return data.content;
  }

  const topLevelContent = extractTextFromContentParts(data?.content);
  if (topLevelContent) {
    return topLevelContent;
  }

  const responseText = data?.output?.flatMap((outputItem) => outputItem.content || [])
    .map((contentItem) => {
      if (typeof contentItem === "string") {
        return contentItem;
      }
      return contentItem?.text || contentItem?.content || "";
    })
    .filter(Boolean)
    .join("\n");
  if (responseText) {
    return responseText;
  }

  const chatContent = data?.choices?.[0]?.message?.content;
  if (typeof chatContent === "string" && chatContent.trim()) {
    return chatContent;
  }

  const chatContentParts = extractTextFromContentParts(chatContent);
  if (chatContentParts) {
    return chatContentParts;
  }

  const choiceText = data?.choices?.[0]?.text;
  if (typeof choiceText === "string" && choiceText.trim()) {
    return choiceText;
  }

  const messageContent = data?.message?.content;
  if (typeof messageContent === "string" && messageContent.trim()) {
    return messageContent;
  }

  const messageContentParts = extractTextFromContentParts(messageContent);
  if (messageContentParts) {
    return messageContentParts;
  }

  throw new Error("无法读取模型返回内容。");
}

function extractTextFromContentParts(content) {
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((part) => {
    if (typeof part === "string") {
      return part;
    }
    return part?.text || part?.content || part?.value || "";
  }).filter(Boolean).join("\n");
}

function parseModelJson(text) {
  if (looksLikeTruncatedJson(text)) {
    throw new Error("模型返回的 JSON 字符串被中途截断。");
  }
  const candidates = getJsonCandidates(text);
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed) {
      return normalizeParsedJson(parsed);
    }
  }
  throw new Error("模型没有返回可解析的 JSON。");
}

function looksLikeTruncatedJson(text) {
  const raw = String(text || "").trim();
  if (!raw || !/^[{\[]/.test(raw)) {
    return false;
  }
  return !extractBalancedJson(raw, raw[0], raw[0] === "{" ? "}" : "]");
}

function getJsonCandidates(text) {
  const raw = String(text || "").trim();
  const candidates = [raw];
  const codeBlocks = [...raw.matchAll(/```(?:json|javascript|js)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  candidates.push(...codeBlocks);

  const objectCandidate = extractBalancedJson(raw, "{", "}");
  if (objectCandidate) {
    candidates.push(objectCandidate);
  }

  const arrayCandidate = extractBalancedJson(raw, "[", "]");
  if (arrayCandidate) {
    candidates.push(arrayCandidate);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function tryParseJson(text) {
  const normalized = normalizeJsonLikeText(text);
  const quotedKeys = normalized.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3');
  const doubleQuoted = normalized.replace(/'/g, '"');
  const quotedKeysAndStrings = quotedKeys.replace(/'/g, '"');
  const attempts = [
    normalized,
    normalized.replace(/,\s*([}\]])/g, "$1"),
    quotedKeys.replace(/,\s*([}\]])/g, "$1"),
    doubleQuoted.replace(/,\s*([}\]])/g, "$1"),
    quotedKeysAndStrings.replace(/,\s*([}\]])/g, "$1")
  ];

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // Try the next recovery strategy.
    }
  }
  return null;
}

function normalizeJsonLikeText(text) {
  return String(text || "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/：/g, ":")
    .replace(/，/g, ",")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/【/g, "[")
    .replace(/】/g, "]")
    .replace(/；/g, ";");
}

function extractBalancedJson(text, openChar, closeChar) {
  const start = text.indexOf(openChar);
  if (start === -1) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return "";
}

function normalizeParsedJson(parsed) {
  if (Array.isArray(parsed)) {
    return { groups: parsed };
  }
  if (Array.isArray(parsed?.groups)) {
    return parsed;
  }
  if (Array.isArray(parsed?.items)) {
    return { groups: parsed.items };
  }
  if (parsed?.candidateIds || parsed?.tabIds || parsed?.tabId || parsed?.group) {
    return { groups: [parsed] };
  }
  return parsed || {};
}

function normalizeResultGroups(parsed) {
  if (Array.isArray(parsed?.groups)) {
    return parsed.groups;
  }

  if (parsed && typeof parsed === "object") {
    const entries = Object.entries(parsed);
    const looksLikeCandidateMap = entries.length > 0 && entries.every(([key, value]) => {
      return /^c\d+$/i.test(key) && typeof value === "string";
    });
    if (looksLikeCandidateMap) {
      return entries.map(([candidateId, group]) => ({
        candidateIds: [candidateId],
        group
      }));
    }

    const looksLikeTabMap = entries.length > 0 && entries.every(([key, value]) => {
      return /^(?:t)?\d+$/i.test(key) && typeof value === "string";
    });
    if (looksLikeTabMap) {
      return entries.map(([tabId, group]) => ({
        tabIds: [String(tabId).replace(/^t/i, "")],
        group
      }));
    }
  }

  return [];
}

function getCandidateIdsFromGroup(group) {
  if (Array.isArray(group.candidateIds)) {
    return group.candidateIds;
  }
  if (Array.isArray(group.ids)) {
    return group.ids;
  }
  if (Array.isArray(group.candidates)) {
    return group.candidates;
  }
  if (group.candidateId) {
    return [group.candidateId];
  }
  if (group.id && /^c\d+$/i.test(String(group.id))) {
    return [group.id];
  }
  return [];
}

function getTabIdsFromGroup(group, candidateById = new Map()) {
  const directTabIds = getDirectTabIdsFromGroup(group);
  if (directTabIds.length > 0) {
    return directTabIds;
  }

  return getCandidateIdsFromGroup(group)
    .flatMap((candidateId) => candidateById.get(String(candidateId))?.tabIds || []);
}

function getDirectTabIdsFromGroup(group) {
  if (Array.isArray(group.tabIds)) {
    return group.tabIds;
  }
  if (Array.isArray(group.tabs)) {
    return group.tabs.map((item) => typeof item === "object" ? item.tabId || item.id : item);
  }
  if (Array.isArray(group.ids)) {
    return group.ids.filter((id) => /^(?:t)?\d+$/i.test(String(id)));
  }
  if (group.tabId) {
    return [group.tabId];
  }
  if (group.id && /^(?:t)?\d+$/i.test(String(group.id))) {
    return [String(group.id).replace(/^t/i, "")];
  }
  return [];
}

function compactUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    return truncateString(`${parsed.hostname}${path}`, 120);
  } catch {
    return truncateString(url, 120);
  }
}

function truncateString(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildClassifiableItems(tabs) {
  const functionalContextByTabId = getFunctionalContextGroupByTabId(tabs);
  const items = tabs.map((tab) => ({
    ...toClassifiableTab(tab, functionalContextByTabId.get(tab.id)),
    tab
  }));
  return {
    items,
    localFallbackByTabId: new Map(items.map((item) => [item.id, item.localFallback]))
  };
}

function toClassifiableTab(tab, functionalTopic = "") {
  const titleTopic = getTitleGroup(tab.title || "", tab.url || "");
  const searchQuery = extractSearchQuery(tab.url || "");
  const searchQueryTopic = getSearchQueryTopic(tab.url || "");
  const siteProperty = getSitePropertyGroup(tab.url || "");
  const domainDisplayName = getDomainName(tab.url);
  const preferredDomainGroup = getPreferredDomainGroup(tab.url || "");
  const localFallback = functionalTopic || chooseLocalGroup({
    titleTopic: titleTopic || searchQueryTopic,
    siteProperty,
    domainDisplayName,
    preferredDomainGroup
  });
  return {
    id: tab.id,
    title: tab.title || "",
    url: tab.url || "",
    domain: getDomainGroup(tab.url),
    functionalTopic,
    titleTopic,
    searchQueryTopic,
    siteProperty,
    domainDisplayName,
    preferredDomainGroup,
    searchQuery,
    localFallback,
    confidence: getLocalSignalConfidence({ functionalTopic, titleTopic: titleTopic || searchQueryTopic, siteProperty, domainDisplayName, preferredDomainGroup })
  };
}

function getLocalSignalConfidence({ functionalTopic, titleTopic, siteProperty, domainDisplayName, preferredDomainGroup }) {
  if (functionalTopic || preferredDomainGroup || isFunctionalSiteGroup(siteProperty) || (titleTopic && !WEAK_TITLE_GROUPS.has(titleTopic))) {
    return "high";
  }
  if (siteProperty || titleTopic) {
    return "medium";
  }
  if (domainDisplayName) {
    return "low";
  }
  return "unknown";
}

function buildCloudCandidates(items) {
  const candidateMap = new Map();

  for (const item of items) {
    const key = getCandidateKey(item);
    if (!candidateMap.has(key)) {
      candidateMap.set(key, createCloudCandidate(candidateMap.size + 1, item));
    }

    const candidate = candidateMap.get(key);
    addItemToCloudCandidate(candidate, item);
  }

  return [...candidateMap.values()].map(finalizeCloudCandidate);
}

function createCloudCandidate(index, item) {
  return {
    candidateId: `c${index}`,
    suggestedName: item.localFallback || item.domainDisplayName || "其他",
    tabIds: [],
    sampleTitles: [],
    intelligenceHints: new Set(),
    domains: new Set(),
    functionalTopics: new Set(),
    titleTopics: new Set(),
    searchQueryTopics: new Set(),
    preferredDomainGroups: new Set(),
    siteProperties: new Set(),
    domainDisplayNames: new Set(),
    confidences: new Set()
  };
}

function addItemToCloudCandidate(candidate, item) {
  candidate.tabIds.push(item.id);
  pushUnique(candidate.sampleTitles, truncateString(item.title || "", 80), 3);
  for (const hint of getCloudIntelligenceHints(item)) {
    addNonEmpty(candidate.intelligenceHints, hint);
  }
  addNonEmpty(candidate.domains, item.domain);
  addNonEmpty(candidate.functionalTopics, item.functionalTopic);
  addNonEmpty(candidate.titleTopics, item.titleTopic);
  addNonEmpty(candidate.searchQueryTopics, item.searchQueryTopic);
  addNonEmpty(candidate.preferredDomainGroups, item.preferredDomainGroup);
  addNonEmpty(candidate.siteProperties, item.siteProperty);
  addNonEmpty(candidate.domainDisplayNames, item.domainDisplayName);
  addNonEmpty(candidate.confidences, item.confidence);
}

function finalizeCloudCandidate(candidate) {
  return {
    ...candidate,
    intelligenceHints: setToArray(candidate.intelligenceHints, 8),
    domains: setToArray(candidate.domains, 4),
    functionalTopics: setToArray(candidate.functionalTopics, 4),
    titleTopics: setToArray(candidate.titleTopics, 4),
    searchQueryTopics: setToArray(candidate.searchQueryTopics, 4),
    preferredDomainGroups: setToArray(candidate.preferredDomainGroups, 4),
    siteProperties: setToArray(candidate.siteProperties, 4),
    domainDisplayNames: setToArray(candidate.domainDisplayNames, 4),
    confidence: summarizeCandidateConfidence(candidate.confidences)
  };
}

function setToArray(set, maxLength) {
  return [...set].slice(0, maxLength);
}

function summarizeCandidateConfidence(confidences) {
  const values = confidences instanceof Set ? [...confidences] : [];
  if (values.includes("high")) {
    return "high";
  }
  if (values.includes("medium")) {
    return "medium";
  }
  if (values.includes("low")) {
    return "low";
  }
  return "unknown";
}

function summarizeCandidates(candidates) {
  return candidates.slice(0, 20).map((candidate) => ({
    candidateId: candidate.candidateId,
    tabCount: candidate.tabIds.length,
    suggestedName: candidate.suggestedName,
    confidence: candidate.confidence,
    functionalTopics: candidate.functionalTopics,
    titleTopics: candidate.titleTopics,
    searchQueryTopics: candidate.searchQueryTopics,
    preferredDomainGroups: candidate.preferredDomainGroups,
    siteProperties: candidate.siteProperties,
    domainDisplayNames: candidate.domainDisplayNames,
    intelligenceHints: candidate.intelligenceHints,
    sampleTitles: candidate.sampleTitles
  }));
}

function safeEndpoint(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function getCandidateKey(item) {
  const strongGroup = item.functionalTopic
    || (item.titleTopic && !WEAK_TITLE_GROUPS.has(item.titleTopic) ? item.titleTopic : "")
    || (item.searchQueryTopic && !WEAK_TITLE_GROUPS.has(item.searchQueryTopic) ? item.searchQueryTopic : "")
    || (isFunctionalSiteGroup(item.siteProperty) ? item.siteProperty : "")
    || (isCloudFineGrainedGroup(item.preferredDomainGroup) ? "" : item.preferredDomainGroup);
  if (strongGroup) {
    return `strong:${normalizeTopicKey(strongGroup)}`;
  }
  if (isCloudFineGrainedGroup(item.preferredDomainGroup || item.domainDisplayName)) {
    return `tab:${item.id}`;
  }
  return `tab:${item.id}`;
}

function isFunctionalSiteGroup(group) {
  return Boolean(group && FUNCTIONAL_SITE_GROUPS.has(group));
}

function isCloudFineGrainedGroup(group) {
  return Boolean(group && CLOUD_FINE_GRAINED_GROUPS.has(group));
}

function createCloudBatchTab(item) {
  return {
    tabId: item.id,
    title: truncateString(item.title || "", 140),
    url: compactUrl(item.url || ""),
    domain: item.domain,
    searchQuery: item.searchQuery || "",
    localFallback: item.localFallback,
    confidence: item.confidence,
    intelligenceHints: getCloudIntelligenceHints(item),
    signals: compactObject({
      functionalTopic: item.functionalTopic,
      titleTopic: item.titleTopic,
      searchQueryTopic: item.searchQueryTopic,
      preferredDomainGroup: item.preferredDomainGroup,
      siteProperty: item.siteProperty,
      domainDisplayName: item.domainDisplayName
    })
  };
}

function getCloudIntelligenceHints(item) {
  const hints = [];
  if (item.searchQuery) {
    hints.push(`searchQuery:${item.searchQuery}`);
  }

  const githubRepository = extractGithubRepositoryParts(item.url || "");
  if (githubRepository) {
    hints.push(`githubRepo:${githubRepository.owner}/${githubRepository.repo}`);
    hints.push(`repoName:${githubRepository.repo}`);
  }

  const pathTopic = extractPathTopicHint(item.url || "");
  if (pathTopic) {
    hints.push(`pathTopic:${pathTopic}`);
  }

  for (const topic of extractFunctionalTopicCandidates(item.title || "")) {
    const clean = cleanFunctionalTopicCandidate(topic);
    if (isUsefulFunctionalTopic(clean)) {
      hints.push(`titleTopicCandidate:${formatFunctionalTopic(clean)}`);
    }
  }

  return hints.slice(0, 6);
}

function extractPathTopicHint(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname
      .split("/")
      .map((part) => decodeURIComponent(part || "").trim())
      .filter(Boolean)
      .filter((part) => !/^\d+$/.test(part))
      .filter((part) => !/^(watch|video|questions|package|project|docs?|documentation|releases?|issues?|pull|tree|blob)$/i.test(part));
    const useful = parts.find((part) => /[a-z0-9\u4e00-\u9fa5]/i.test(part) && part.length >= 2);
    return useful ? truncateString(useful.replace(/\.(html?|md|git)$/i, ""), 40) : "";
  } catch {
    return "";
  }
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (!value) {
        return false;
      }
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (typeof value === "object") {
        return Object.keys(value).length > 0;
      }
      return true;
    })
  );
}

function pushUnique(list, value, maxLength) {
  if (value && !list.includes(value) && list.length < maxLength) {
    list.push(value);
  }
}

function addNonEmpty(set, value) {
  if (value) {
    set.add(value);
  }
}

function isGroupableTab(tab) {
  if (!tab?.id || tab.pinned || tab.incognito) {
    return false;
  }
  try {
    const url = new URL(tab.url);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getLocalGroup(tab) {
  const titleGroup = getTitleGroup(tab.title || "", tab.url || "");
  const searchQueryTopic = getSearchQueryTopic(tab.url || "");
  const siteGroup = getSitePropertyGroup(tab.url || "");
  const domainGroup = getDomainName(tab.url);
  const preferredDomainGroup = getPreferredDomainGroup(tab.url || "");

  return chooseLocalGroup({
    titleTopic: titleGroup || searchQueryTopic,
    siteProperty: siteGroup,
    domainDisplayName: domainGroup,
    preferredDomainGroup
  });
}

function chooseLocalGroup({ titleTopic, siteProperty, domainDisplayName, preferredDomainGroup }) {
  if (titleTopic && !WEAK_TITLE_GROUPS.has(titleTopic)) {
    return titleTopic;
  }

  if (isFunctionalSiteGroup(siteProperty)) {
    return siteProperty;
  }

  if (preferredDomainGroup) {
    return preferredDomainGroup;
  }

  if (siteProperty) {
    return siteProperty;
  }

  if (titleTopic) {
    return titleTopic;
  }

  return domainDisplayName || "其他";
}

function getTitleGroup(title, url = "") {
  const rawText = normalizeText(title);
  const cleanText = normalizeText(stripTitleBoilerplate(title));
  const texts = cleanText && cleanText !== rawText ? [cleanText, rawText] : [rawText];
  const githubRepository = extractGithubRepositoryParts(url);

  for (const text of texts) {
    for (const rule of TITLE_TOPIC_RULES) {
      if (rule.pattern.test(text)) {
        if (isGithubOwnerOnlyTopic(rule.group, githubRepository)) {
          continue;
        }
        return rule.group;
      }
    }
  }

  return "";
}

function getFunctionalTopic(tab) {
  const githubRepositoryTopic = extractGithubRepositoryTopic(tab.url || "");
  if (githubRepositoryTopic) {
    const clean = cleanFunctionalTopicCandidate(githubRepositoryTopic);
    if (isUsefulFunctionalTopic(clean)) {
      return formatFunctionalTopic(clean);
    }
  }

  const searchQuery = extractSearchQuery(tab.url || "");
  if (searchQuery) {
    const searchQueryTopic = getSearchQueryTopic(tab.url || "");
    if (searchQueryTopic) {
      return searchQueryTopic;
    }
  }

  const titleGroup = getTitleGroup(tab.title || "", tab.url || "");
  if (titleGroup && !WEAK_TITLE_GROUPS.has(titleGroup)) {
    return titleGroup;
  }

  const candidates = [
    ...extractFunctionalTopicCandidates(searchQuery || ""),
    ...extractFunctionalTopicCandidates(tab.title || "")
  ].filter(Boolean);

  for (const candidate of candidates) {
    const clean = cleanFunctionalTopicCandidate(candidate);
    if (isUsefulFunctionalTopic(clean)) {
      return formatFunctionalTopic(clean);
    }
  }

  return "";
}

function getSearchQueryTopic(url) {
  const searchQuery = extractSearchQuery(url);
  if (!searchQuery) {
    return "";
  }

  const titleGroup = getTitleGroup(searchQuery, "");
  if (titleGroup && !WEAK_TITLE_GROUPS.has(titleGroup)) {
    return titleGroup;
  }

  for (const candidate of extractFunctionalTopicCandidates(searchQuery)) {
    const clean = cleanFunctionalTopicCandidate(candidate);
    if (isUsefulFunctionalTopic(clean)) {
      return formatFunctionalTopic(clean);
    }
  }

  return "";
}

function extractFunctionalTopicCandidates(title) {
  const cleanTitle = stripTitleBoilerplate(title);
  const keyword = "(?:教程|下载|安装|配置|部署|搭建|运行|接入|实战|详解|使用|文档|指南|手册|官网|插件|扩展|入门|源码|release|releases|download|downloads|docs?|documentation|guide|tutorial|install|setup|deploy|deployment|manual|wiki)";
  const token = "([A-Za-z0-9][A-Za-z0-9.+_-]{1,40}|[\\u4e00-\\u9fa5A-Za-z0-9][\\u4e00-\\u9fa5A-Za-z0-9.+_-]{1,24})";
  const beforeKeyword = new RegExp(`${token}\\s*(?:的)?\\s*${keyword}`, "gi");
  const afterKeyword = new RegExp(`${keyword}\\s*(?:[:：-])?\\s*${token}`, "gi");
  const candidates = [];
  const keywordIndex = cleanTitle.search(new RegExp(keyword, "i"));

  if (keywordIndex > 0) {
    const prefix = cleanTitle.slice(0, keywordIndex);
    candidates.push(...getPrefixTopicCandidates(prefix));
  }

  for (const match of cleanTitle.matchAll(beforeKeyword)) {
    candidates.push(match[1]);
  }
  for (const match of cleanTitle.matchAll(afterKeyword)) {
    candidates.push(match[1]);
  }

  return candidates;
}

function getPrefixTopicCandidates(prefix) {
  const clean = String(prefix || "")
    .replace(/[()[\]{}"'`]/g, " ")
    .replace(/[-_:：/|—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) {
    return [];
  }

  const parts = clean.split(/\s+/).filter((part) => {
    return !FUNCTIONAL_TOPIC_STOP_WORDS.has(part.toLowerCase());
  });
  if (!parts.length) {
    return [];
  }
  return [parts.join(" "), parts[0]];
}

function extractGithubRepositoryTopic(url) {
  const repository = extractGithubRepositoryParts(url);
  return repository?.repo?.replace(/\.git$/i, "") || "";
}

function extractGithubRepositoryParts(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname !== "github.com") {
      return null;
    }
    const [, owner, repo] = parsed.pathname.split("/");
    if (!owner || !repo) {
      return null;
    }
    return {
      owner: owner.replace(/\.git$/i, ""),
      repo: repo.replace(/\.git$/i, "")
    };
  } catch {
    return null;
  }
}

function isGithubOwnerOnlyTopic(group, repository) {
  if (!repository?.owner || !group) {
    return false;
  }
  const groupKey = normalizeTopicKey(group);
  const ownerKey = normalizeTopicKey(repository.owner);
  const repoKey = normalizeTopicKey(repository.repo);
  return Boolean(groupKey && ownerKey && groupKey === ownerKey && groupKey !== repoKey);
}

function stripTitleBoilerplate(title) {
  return String(title || "")
    .replace(/^github\s*[-:]\s*/i, "")
    .replace(/^csdn\s*[-:]\s*/i, "")
    .replace(new RegExp(`\\s*[-_|—–]\\s*${SOURCE_NAME_PATTERN}.*`, "i"), "")
    .replace(new RegExp(`^${SOURCE_NAME_PATTERN}\\s*[-_:：|—–]\\s*`, "i"), "")
    .trim();
}

function cleanFunctionalTopicCandidate(candidate) {
  let clean = String(candidate || "")
    .replace(/[()[\]{}"'`]/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = clean.split(/\s+/).filter((part) => {
    return !FUNCTIONAL_TOPIC_STOP_WORDS.has(part.toLowerCase());
  });
  clean = parts.join(" ").trim();
  return clean;
}

function isUsefulFunctionalTopic(topic) {
  const clean = String(topic || "").trim();
  if (!clean) {
    return false;
  }
  const key = normalizeTopicKey(clean);
  if (!key || FUNCTIONAL_TOPIC_STOP_WORDS.has(key)) {
    return false;
  }
  return /[a-z0-9\u4e00-\u9fa5]/i.test(clean) && key.length >= 2;
}

function normalizeTopicKey(topic) {
  return String(topic || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
}

function formatFunctionalTopic(topic) {
  const clean = String(topic || "").trim();
  if (/^[a-z0-9 .+_-]+$/i.test(clean)) {
    return formatDomainLabel(clean);
  }
  return clean;
}

function getSitePropertyGroup(url) {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }

  for (const rule of SITE_PROPERTY_RULES) {
    if (rule.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return rule.group;
    }
  }

  return "";
}

function extractSearchQuery(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const domain = getDomainGroup(url);
  if (!SEARCH_ENGINE_DOMAINS.has(hostname) && !SEARCH_ENGINE_DOMAINS.has(domain)) {
    return "";
  }

  const queryKeys = ["q", "query", "wd", "word", "text", "p", "search", "keyword", "keywords", "kw", "qword"];
  for (const key of queryKeys) {
    const value = parsed.searchParams.get(key);
    const clean = cleanSearchQuery(value);
    if (clean) {
      return clean;
    }
  }

  return "";
}

function cleanSearchQuery(value) {
  return String(value || "")
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function getPreferredDomainGroup(url) {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }

  if (PRODUCT_DOMAIN_GROUPS.has(hostname)) {
    return getDomainName(url);
  }

  const domain = getDomainGroup(url);
  if (PRODUCT_DOMAIN_GROUPS.has(domain)) {
    return getDomainName(url);
  }

  return "";
}

function getDomainGroup(url) {
  try {
    const { hostname } = new URL(url);
    const normalized = hostname.toLowerCase().replace(/^www\./, "");
    const parts = normalized.split(".").filter(Boolean);
    if (parts.length <= 2) {
      return normalized;
    }

    const suffix2 = parts.slice(-2).join(".");
    if (MULTI_PART_TLDS.has(suffix2) && parts.length >= 3) {
      return parts.slice(-3).join(".");
    }

    return parts.slice(-2).join(".");
  } catch {
    return "其他";
  }
}

function getDomainName(url) {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    hostname = "";
  }
  if (hostname && DOMAIN_DISPLAY_NAMES.has(hostname)) {
    return DOMAIN_DISPLAY_NAMES.get(hostname);
  }

  const domain = getDomainGroup(url);
  if (domain === "其他") {
    return domain;
  }
  if (DOMAIN_DISPLAY_NAMES.has(domain)) {
    return DOMAIN_DISPLAY_NAMES.get(domain);
  }

  const parts = domain.split(".").filter(Boolean);
  const suffix2 = parts.slice(-2).join(".");
  const label = MULTI_PART_TLDS.has(suffix2) && parts.length >= 3
    ? parts[parts.length - 3]
    : parts[parts.length - 2] || parts[0];

  return formatDomainLabel(label);
}

function formatDomainLabel(label) {
  const clean = String(label || "").replace(/^xn--/i, "").replace(/[-_]+/g, " ").trim();
  if (!clean) {
    return "其他";
  }
  if (/^\d+$/.test(clean)) {
    return clean;
  }
  return clean
    .split(/\s+/)
    .map((part) => {
      if (part.length <= 2) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[｜|·_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeGroupName(group) {
  return truncateGroupTitle(
    String(group || "")
      .replace(/[{}[\]"'`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function normalizeReturnedGroupName(group) {
  const clean = sanitizeGroupName(group);
  if (!clean || clean === "其他") {
    return clean;
  }

  const domainLike = clean.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (/^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,}$/i.test(domainLike)) {
    return getDomainName(`https://${domainLike}`);
  }

  return clean;
}

function truncateGroupTitle(title) {
  const clean = String(title || "其他").trim() || "其他";
  return clean.length > 24 ? `${clean.slice(0, 23)}…` : clean;
}

function colorForIndex(index) {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

function getTabSignature(tab) {
  return `${tab.url || ""}\n${tab.title || ""}`;
}

function getCloudBatchCacheKey(items, settings = {}) {
  const signature = items
    .map((item) => getTabSignature(item))
    .sort()
    .join("\n---\n");
  const endpoint = safeEndpoint(settings.cloudApiUrl || "");
  const model = String(settings.cloudModel || "").trim();
  const modeSignature = [
    CLOUD_CACHE_VERSION,
    endpoint,
    model,
    shouldSendThinkingDisable(settings) ? "thinking-disabled" : "thinking-enabled"
  ].join("\n");
  return `batch:${hashString(`${modeSignature}\n===\n${signature}`)}`;
}

function hashString(text) {
  let hash = 2166136261;
  for (const char of String(text || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function trimCache(cache, now, ttl) {
  const entries = Object.entries(cache)
    .filter(([, value]) => (value?.group || value?.groups) && now - Number(value.at || 0) < ttl)
    .slice(-500);
  return Object.fromEntries(entries);
}

async function appendLog(level, message, detail = "") {
  try {
    const logs = await getLogs();
    logs.push({
      at: Date.now(),
      level,
      message,
      detail: formatLogDetail(detail)
    });
    await setStorage(LOG_KEY, logs.slice(-MAX_LOG_ENTRIES));
  } catch {
    // Logging must never break tab grouping.
  }
}

async function getLogs() {
  return (await getStorage(LOG_KEY)) || [];
}

async function clearLogs() {
  await setStorage(LOG_KEY, []);
}

function formatLogDetail(detail) {
  if (detail === undefined || detail === null || detail === "") {
    return "";
  }
  const text = typeof detail === "string"
    ? detail
    : JSON.stringify(detail, null, 2);
  return truncateString(redactSensitiveText(text), MAX_LOG_DETAIL_LENGTH);
}

function redactSensitiveText(text) {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "sk-[redacted]");
}

function assertCloudSettings(settings) {
  if (!settings.cloudApiUrl?.trim()) {
    throw new Error("缺少云端 API 链接。");
  }
  if (!settings.cloudApiKey?.trim()) {
    throw new Error("缺少 API Key。");
  }
  if (!settings.cloudModel?.trim()) {
    throw new Error("缺少模型名称。");
  }
  new URL(settings.cloudApiUrl.trim());
}

async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await getStorage(SETTINGS_KEY)) || {}) };
}

async function setSettings(settings) {
  await setStorage(SETTINGS_KEY, {
    mode: settings.mode || DEFAULT_SETTINGS.mode,
    includeSingleTabGroups: settings.includeSingleTabGroups ?? DEFAULT_SETTINGS.includeSingleTabGroups,
    cloudApiUrl: settings.cloudApiUrl || DEFAULT_SETTINGS.cloudApiUrl,
    cloudApiKey: settings.cloudApiKey || DEFAULT_SETTINGS.cloudApiKey,
    cloudModel: settings.cloudModel || DEFAULT_SETTINGS.cloudModel,
    cacheTtlHours: Number(settings.cacheTtlHours || DEFAULT_SETTINGS.cacheTtlHours),
    disableThinking: settings.disableThinking ?? DEFAULT_SETTINGS.disableThinking
  });
}

async function getLastStatus() {
  return (await getStorage(LAST_STATUS_KEY)) || { ok: true, message: "尚未运行。", at: 0 };
}

async function setLastStatus(status) {
  await setStorage(LAST_STATUS_KEY, status);
}

async function setBadge(mode) {
  const text = mode === "error" ? "!" : "";
  const color = "#b91c1c";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

function getStorage(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(result[key]);
      }
    });
  });
}

function setStorage(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve();
      }
    });
  });
}

function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(tabs || []);
      }
    });
  });
}

function queryTabGroups(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabGroups.query(queryInfo, (groups) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(groups || []);
      }
    });
  });
}

function groupTabIds(tabIds) {
  return new Promise((resolve, reject) => {
    chrome.tabs.group({ tabIds }, (groupId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(groupId);
      }
    });
  });
}

function addTabIdsToGroup(groupId, tabIds) {
  return new Promise((resolve, reject) => {
    if (!tabIds.length) {
      resolve(groupId);
      return;
    }
    chrome.tabs.group({ groupId, tabIds }, (updatedGroupId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(updatedGroupId);
      }
    });
  });
}

async function ensureGroupMembership(windowId, groupSpecs) {
  if (!groupSpecs.length) {
    return;
  }

  const currentTabs = await queryTabs({ windowId });
  const groupIdByTabId = new Map(currentTabs.map((tab) => [tab.id, tab.groupId]));

  for (const spec of groupSpecs) {
    const missingTabIds = spec.tabIds.filter((tabId) => groupIdByTabId.get(tabId) !== spec.groupId);
    if (!missingTabIds.length) {
      continue;
    }
    await appendLog("warn", "分组状态未完全落地，已补拉标签", {
      group: spec.groupName,
      groupId: spec.groupId,
      tabIds: missingTabIds
    });
    await addTabIdsToGroup(spec.groupId, missingTabIds);
  }
}

async function ensureTabOrder(windowId, tabIds, startIndex) {
  const orderedTabIds = uniqueFiniteTabIds(tabIds);
  if (!orderedTabIds.length || !Number.isFinite(startIndex)) {
    return;
  }

  let lastState = null;
  for (let attempt = 1; attempt <= TAB_MOVE_MAX_VERIFY_ATTEMPTS; attempt += 1) {
    await moveTabIds(orderedTabIds, startIndex);
    await delay(TAB_MOVE_SETTLE_DELAY_MS);

    const state = await getTabOrderState(windowId, orderedTabIds, startIndex);
    lastState = state;
    if (state.ok) {
      if (attempt > 1) {
        await appendLog("info", "标签移动已校准", {
          attempt,
          startIndex,
          tabIds: orderedTabIds
        });
      }
      return;
    }

    await appendLog("warn", "标签移动后位置未完全落地，准备重试", {
      attempt,
      startIndex,
      expectedTabIds: orderedTabIds,
      actualTabIds: state.actualTabIds,
      actualIndexes: state.actualIndexes
    });
  }

  await moveTabIdsOneByOne(orderedTabIds, startIndex);
  await delay(TAB_MOVE_SETTLE_DELAY_MS);
  const finalState = await getTabOrderState(windowId, orderedTabIds, startIndex);
  if (!finalState.ok) {
    await appendLog("warn", "标签移动仍未完全对齐，已保留 Chrome 当前状态", {
      startIndex,
      expectedTabIds: orderedTabIds,
      actualTabIds: finalState.actualTabIds,
      actualIndexes: finalState.actualIndexes,
      previousActualTabIds: lastState?.actualTabIds || []
    });
  }
}

async function getTabOrderState(windowId, expectedTabIds, startIndex) {
  const expectedSet = new Set(expectedTabIds);
  const tabs = (await queryTabs({ windowId })).sort((left, right) => left.index - right.index);
  const actualTabs = tabs.filter((tab) => expectedSet.has(tab.id));
  const actualTabIds = actualTabs.map((tab) => tab.id);
  const actualIndexes = actualTabs.map((tab) => tab.index);
  const expectedIndexes = expectedTabIds.map((_, offset) => startIndex + offset);
  const ok = actualTabIds.length === expectedTabIds.length
    && actualTabIds.every((tabId, index) => tabId === expectedTabIds[index])
    && actualIndexes.every((tabIndex, index) => tabIndex === expectedIndexes[index]);

  return {
    ok,
    actualTabIds,
    actualIndexes
  };
}

function moveTabIds(tabIds, index) {
  return new Promise((resolve, reject) => {
    if (!tabIds.length || !Number.isFinite(index)) {
      resolve([]);
      return;
    }
    chrome.tabs.move(tabIds, { index }, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(tabs || []);
      }
    });
  });
}

async function moveTabIdsOneByOne(tabIds, startIndex) {
  for (let offset = 0; offset < tabIds.length; offset += 1) {
    await moveTabIds([tabIds[offset]], startIndex + offset);
  }
}

function uniqueFiniteTabIds(tabIds) {
  const seen = new Set();
  return tabIds
    .map((tabId) => Number(tabId))
    .filter((tabId) => {
      if (!Number.isFinite(tabId) || seen.has(tabId)) {
        return false;
      }
      seen.add(tabId);
      return true;
    });
}

function ungroupTabIds(tabIds) {
  return new Promise((resolve, reject) => {
    if (!tabIds.length) {
      resolve();
      return;
    }
    chrome.tabs.ungroup(tabIds, () => {
      const error = chrome.runtime.lastError;
      if (error && !/not grouped/i.test(error.message || "")) {
        reject(new Error(error.message));
      } else {
        resolve();
      }
    });
  });
}

function isTabInGroup(tab) {
  return Number.isInteger(tab?.groupId) && tab.groupId !== -1;
}

function getFirstGroupableTabIndex(tabs) {
  return tabs.reduce((minIndex, tab) => {
    return Number.isFinite(tab.index) ? Math.min(minIndex, tab.index) : minIndex;
  }, Number.POSITIVE_INFINITY);
}

function updateGroup(groupId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabGroups.update(groupId, updateProperties, (group) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(group);
      }
    });
  });
}

function normalizeError(error) {
  return error?.message || String(error);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
