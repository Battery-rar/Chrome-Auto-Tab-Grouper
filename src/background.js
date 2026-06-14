const SETTINGS_KEY = "autoTabGrouperSettings";
const CACHE_KEY = "autoTabGrouperCloudCache";
const LAST_STATUS_KEY = "autoTabGrouperLastStatus";

const DEFAULT_SETTINGS = {
  mode: "local",
  includeSingleTabGroups: false,
  cloudApiUrl: "",
  cloudApiKey: "",
  cloudModel: "",
  cacheTtlHours: 24
};

const GROUP_COLORS = [
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
  "grey"
];

const DOMAIN_DISPLAY_NAMES = new Map([
  ["github.com", "GitHub"],
  ["gitlab.com", "GitLab"],
  ["gitee.com", "Gitee"],
  ["stackoverflow.com", "Stack Overflow"],
  ["stackexchange.com", "Stack Exchange"],
  ["google.com", "Google"],
  ["youtube.com", "YouTube"],
  ["youtu.be", "YouTube"],
  ["bilibili.com", "哔哩哔哩"],
  ["b23.tv", "哔哩哔哩"],
  ["bilibili.tv", "哔哩哔哩"],
  ["biliblii.com", "哔哩哔哩"],
  ["openai.com", "OpenAI"],
  ["chatgpt.com", "ChatGPT"],
  ["anthropic.com", "Anthropic"],
  ["claude.ai", "Claude"],
  ["notion.so", "Notion"],
  ["figma.com", "Figma"],
  ["x.com", "X"],
  ["twitter.com", "Twitter"],
  ["reddit.com", "Reddit"],
  ["zhihu.com", "知乎"],
  ["weibo.com", "微博"],
  ["xiaohongshu.com", "小红书"],
  ["taobao.com", "淘宝"],
  ["tmall.com", "天猫"],
  ["jd.com", "京东"],
  ["amazon.com", "Amazon"],
  ["amazon.cn", "Amazon"],
  ["baidu.com", "百度"],
  ["bing.com", "Bing"],
  ["duckduckgo.com", "DuckDuckGo"],
  ["perplexity.ai", "Perplexity"],
  ["medium.com", "Medium"],
  ["sspai.com", "少数派"],
  ["36kr.com", "36氪"],
  ["thepaper.cn", "澎湃新闻"],
  ["nytimes.com", "NYTimes"],
  ["reuters.com", "Reuters"],
  ["bbc.com", "BBC"],
  ["tradingview.com", "TradingView"]
]);

const MULTI_PART_TLDS = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "co.kr",
  "com.br",
  "com.mx",
  "com.sg",
  "com.hk",
  "com.tw"
]);

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
      const result = await classifyWithCloud(
        [
          {
            id: 1,
            title: "React Documentation",
            url: "https://react.dev/learn",
            domain: "react.dev"
          },
          {
            id: 2,
            title: "OpenAI API Reference",
            url: "https://platform.openai.com/docs/api-reference",
            domain: "openai.com"
          }
        ],
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
  const classified = classification.items;
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

  let groupCount = 0;
  let groupedTabs = 0;
  const eligibleGroups = [...groups.entries()].filter(([, tabIds]) => {
    return settings.includeSingleTabGroups || tabIds.length >= 2;
  });
  eligibleGroups.sort(([left], [right]) => left.localeCompare(right, "zh-Hans-CN"));

  await ungroupTabIds(tabs.map((tab) => tab.id));

  for (const [groupName, tabIds] of eligibleGroups) {
    const groupId = await groupTabIds(tabIds);
    await updateGroup(groupId, {
      title: groupName,
      color: colorForIndex(groupCount),
      collapsed: false
    });
    groupCount += 1;
    groupedTabs += tabIds.length;
  }

  const skippedTabs = tabs.length - groupedTabs;
  let resultMessage = `已整理 ${groupedTabs} 个标签，生成 ${groupCount} 个分组。`;
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

async function classifyTabs(tabs, settings) {
  if (settings.mode === "cloud") {
    try {
      return { items: await classifyTabsWithCache(tabs, settings), warning: "" };
    } catch (error) {
      const warning = `云端分类失败，已回退到本地域名模式：${normalizeError(error)}`;
      await setBadge("error");
      return {
        items: tabs.map((tab) => ({
          tab,
          group: getLocalGroup(tab)
        })),
        warning
      };
    }
  }

  return {
    items: tabs.map((tab) => ({
      tab,
      group: getLocalGroup(tab)
    })),
    warning: ""
  };
}

async function classifyTabsWithCache(tabs, settings) {
  assertCloudSettings(settings);

  const now = Date.now();
  const cacheTtl = Math.max(1, Number(settings.cacheTtlHours || DEFAULT_SETTINGS.cacheTtlHours)) * 60 * 60 * 1000;
  const cache = (await getStorage(CACHE_KEY)) || {};
  const items = tabs.map(toClassifiableTab);
  const batchKey = getCloudBatchCacheKey(items);
  const cached = cache[batchKey];

  if (cached && now - cached.at < cacheTtl && cached.groups) {
    return tabs.map((tab) => ({
      tab,
      group: cached.groups[getTabSignature(tab)] || getLocalGroup(tab)
    }));
  }

  const cloudResults = await classifyWithCloud(items, settings);
  const groupsById = new Map(cloudResults.map((result) => [result.id, result.group]));
  const classified = tabs.map((tab) => ({
    tab,
    group: groupsById.get(tab.id) || getLocalGroup(tab)
  }));

  cache[batchKey] = {
    at: now,
    groups: Object.fromEntries(classified.map((item) => [getTabSignature(item.tab), item.group]))
  };
  await setStorage(CACHE_KEY, trimCache(cache, now, cacheTtl));

  return classified;
}

async function classifyWithCloud(items, settings, isTest = false) {
  assertCloudSettings(settings);

  const apiUrl = settings.cloudApiUrl.trim();
  const isResponsesEndpoint = /\/responses\/?$/.test(new URL(apiUrl).pathname);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.cloudApiKey.trim()}`
  };

  const systemPrompt = [
    "你是浏览器标签页分类器。",
    "你必须对整批标签页一起分组，不能把每个标签页孤立分类。",
    "为每个标签页分配一个简短中文分组名，并按以下多层机制判断：",
    "1. 名字/标题层：优先看标题里的主题、产品、技术栈、教程对象。不同网站、不同域名但标题主题相同的标签必须归到同一组。例如 YouTube、知乎、博客里的 Rime、小狼毫、鼠须管、雾凇拼音教程都归为 Rime，而不是视频、社交或各自域名。",
    "2. 网站属性层：如果标题没有明确共同主题，再看网站属性，例如视频、代码、文档、邮箱、搜索、购物、社交、新闻、金融、设计、办公。",
    "3. 站点名层：如果仍不能判断，才使用站点名或产品名，例如 GitHub、Notion、Google Docs、哔哩哔哩。",
    "智能命名要求：组名要尽量具体、稳定、可复用；有具体主题时用主题名，不要用笼统的“教程”“文章”；有具体产品时用产品名，不要用网站类型。",
    "不要把完整域名或域名后缀作为分组名，例如不要返回 bilibili.com、example.xyz、docs.example.co.uk。",
    "分组名最长 12 个中文字符。必须为每个输入 id 返回且只返回一次。",
    "只返回 JSON，不要解释。格式：{\"items\":[{\"id\":123,\"group\":\"开发\"}]}。"
  ].join("\n");

  const userPrompt = JSON.stringify({
    rules: {
      priority: ["titleTopic", "siteProperty", "domainDisplayName"],
      useProvidedSignalsAsHints: true,
      avoidDomainSuffixInGroupNames: true
    },
    tabs: items.map((item) => ({
      id: item.id,
      title: item.title || "",
      url: item.url || "",
      domain: item.domain || getDomainGroup(item.url),
      signals: {
        titleTopic: item.titleTopic || "",
        siteProperty: item.siteProperty || "",
        domainDisplayName: item.domainDisplayName || "",
        localFallback: item.localFallback || ""
      }
    }))
  });

  const body = isResponsesEndpoint
    ? {
        model: settings.cloudModel.trim(),
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        text: { format: { type: "json_object" } }
      }
    : {
        model: settings.cloudModel.trim(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = extractModelContent(data);
  const parsed = parseJsonObject(content);
  const resultItems = Array.isArray(parsed.items) ? parsed.items : [];

  if (isTest && resultItems.length === 0) {
    throw new Error("API 返回成功，但没有 items 分类结果。");
  }

  return resultItems
    .map((item) => ({
      id: Number(item.id),
      group: normalizeReturnedGroupName(item.group)
    }))
    .filter((item) => Number.isInteger(item.id) && item.group);
}

function extractModelContent(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  const responseText = data?.output?.flatMap((outputItem) => outputItem.content || [])
    .map((contentItem) => contentItem.text)
    .filter(Boolean)
    .join("\n");
  if (responseText) {
    return responseText;
  }

  const chatContent = data?.choices?.[0]?.message?.content;
  if (typeof chatContent === "string") {
    return chatContent;
  }

  throw new Error("无法读取模型返回内容。");
}

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  const unwrapped = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = unwrapped.indexOf("{");
  const end = unwrapped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型没有返回 JSON 对象。");
  }
  return JSON.parse(unwrapped.slice(start, end + 1));
}

function toClassifiableTab(tab) {
  const titleTopic = getTitleGroup(tab.title || "", tab.url || "");
  const siteProperty = getSitePropertyGroup(tab.url || "");
  const domainDisplayName = getDomainName(tab.url);
  return {
    id: tab.id,
    title: tab.title || "",
    url: tab.url || "",
    domain: getDomainGroup(tab.url),
    titleTopic,
    siteProperty,
    domainDisplayName,
    localFallback: titleTopic || siteProperty || domainDisplayName
  };
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
  if (titleGroup) {
    return titleGroup;
  }

  const siteGroup = getSitePropertyGroup(tab.url || "");
  if (siteGroup) {
    return siteGroup;
  }

  return getDomainName(tab.url);
}

function getTitleGroup(title, url) {
  const text = normalizeText(title);
  const rules = [
    { group: "Rime", pattern: /\b(rime|librime|weasel|squirrel|trime|ibus-rime)\b|小狼毫|鼠须管|中州韵|雾凇拼音|薄荷拼音|朙月拼音|地球拼音|仓颉输入法|输入法方案/ },
    { group: "OpenAI", pattern: /\b(openai|chatgpt|gpt-4|gpt-5|responses api|assistants api)\b/ },
    { group: "Claude", pattern: /\b(claude|anthropic)\b/ },
    { group: "Cursor", pattern: /\bcursor\b/ },
    { group: "VS Code", pattern: /\b(vs ?code|visual studio code)\b/ },
    { group: "React", pattern: /\breact(?:\.js)?\b/ },
    { group: "Vue", pattern: /\bvue(?:\.js)?\b/ },
    { group: "Next.js", pattern: /\bnext(?:\.js)?\b/ },
    { group: "TypeScript", pattern: /\btypescript|tsconfig\b/ },
    { group: "JavaScript", pattern: /\bjavascript|node\.js|npm|pnpm|yarn\b/ },
    { group: "Python", pattern: /\bpython|pyenv|pip|conda|jupyter\b/ },
    { group: "Rust", pattern: /\brust|cargo|tokio\b/ },
    { group: "Go", pattern: /\bgolang\b|\bgo语言\b/ },
    { group: "Swift", pattern: /\bswift|swiftui|xcode\b/ },
    { group: "Docker", pattern: /\bdocker|dockerfile|compose\b/ },
    { group: "Kubernetes", pattern: /\bkubernetes|k8s|kubectl\b/ },
    { group: "Git", pattern: /\bgit\b|版本控制/ },
    { group: "macOS", pattern: /\bmacos|launchd|homebrew|brew\b/ },
    { group: "Linux", pattern: /\blinux|ubuntu|debian|archlinux|systemd\b/ },
    { group: "教程", pattern: /教程|入门|指南|手册|文档|documentation|docs|guide|tutorial|learn/ },
    { group: "视频", pattern: /视频|直播|回放|\bvideo\b|\blive\b/ },
    { group: "论文", pattern: /论文|paper|arxiv|doi\.org|research/ }
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      return rule.group;
    }
  }

  return "";
}

function getSitePropertyGroup(url) {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }

  const rules = [
    { group: "视频", domains: ["youtube.com", "youtu.be", "bilibili.com", "vimeo.com", "netflix.com", "iqiyi.com", "youku.com", "tencentvideo.com", "douyin.com", "tiktok.com", "kuaishou.com"] },
    { group: "代码", domains: ["github.com", "gitlab.com", "bitbucket.org", "gitee.com", "stackoverflow.com", "stackexchange.com"] },
    { group: "文档", domains: ["developer.mozilla.org", "docs.github.com", "learn.microsoft.com", "devdocs.io", "readthedocs.io"] },
    { group: "邮箱", domains: ["mail.google.com", "outlook.live.com", "outlook.office.com", "mail.qq.com", "mail.163.com", "mail.126.com"] },
    { group: "搜索", domains: ["google.com", "bing.com", "baidu.com", "duckduckgo.com", "perplexity.ai"] },
    { group: "购物", domains: ["amazon.com", "amazon.cn", "taobao.com", "tmall.com", "jd.com", "pinduoduo.com", "1688.com", "ebay.com"] },
    { group: "社交", domains: ["x.com", "twitter.com", "facebook.com", "instagram.com", "reddit.com", "weibo.com", "zhihu.com", "xiaohongshu.com"] },
    { group: "新闻", domains: ["news.ycombinator.com", "nytimes.com", "bbc.com", "reuters.com", "thepaper.cn", "36kr.com", "sspai.com"] },
    { group: "金融", domains: ["finance.yahoo.com", "tradingview.com", "bloomberg.com", "eastmoney.com", "xueqiu.com"] },
    { group: "设计", domains: ["figma.com", "dribbble.com", "behance.net", "canva.com"] },
    { group: "办公", domains: ["notion.so", "docs.google.com", "drive.google.com", "office.com", "feishu.cn", "larksuite.com", "yuque.com"] },
    { group: "AI", domains: ["chat.openai.com", "chatgpt.com", "claude.ai", "gemini.google.com", "poe.com"] }
  ];

  for (const rule of rules) {
    if (rule.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return rule.group;
    }
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

function getCloudBatchCacheKey(items) {
  const signature = items
    .map((item) => getTabSignature(item))
    .sort()
    .join("\n---\n");
  return `batch:${hashString(signature)}`;
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
    cacheTtlHours: Number(settings.cacheTtlHours || DEFAULT_SETTINGS.cacheTtlHours)
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
