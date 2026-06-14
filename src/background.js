const SETTINGS_KEY = "autoTabGrouperSettings";
const CACHE_KEY = "autoTabGrouperCloudCache";
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
const MAX_LOG_ENTRIES = 120;
const MAX_LOG_DETAIL_LENGTH = 5000;
const WEAK_TITLE_GROUPS = new Set(["教程", "视频", "论文", "文档", "API"]);

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
  ["developer.chrome.com", "Chrome 开发者"],
  ["chromewebstore.google.com", "Chrome 商店"],
  ["apps.apple.com", "App Store"],
  ["developer.apple.com", "Apple 开发者"],
  ["appstoreconnect.apple.com", "App Store Connect"],
  ["github.com", "GitHub"],
  ["gitlab.com", "GitLab"],
  ["gitee.com", "Gitee"],
  ["stackoverflow.com", "Stack Overflow"],
  ["stackexchange.com", "Stack Exchange"],
  ["npmjs.com", "npm"],
  ["pypi.org", "PyPI"],
  ["crates.io", "crates.io"],
  ["csdn.net", "CSDN"],
  ["blog.csdn.net", "CSDN"],
  ["download.csdn.net", "CSDN"],
  ["google.com", "Google"],
  ["youtube.com", "YouTube"],
  ["youtu.be", "YouTube"],
  ["bilibili.com", "哔哩哔哩"],
  ["b23.tv", "哔哩哔哩"],
  ["bilibili.tv", "哔哩哔哩"],
  ["biliblii.com", "哔哩哔哩"],
  ["openai.com", "OpenAI"],
  ["platform.openai.com", "OpenAI API"],
  ["chatgpt.com", "ChatGPT"],
  ["anthropic.com", "Anthropic"],
  ["claude.ai", "Claude"],
  ["deepseek.com", "DeepSeek"],
  ["chat.deepseek.com", "DeepSeek"],
  ["platform.deepseek.com", "DeepSeek API"],
  ["moonshot.cn", "Kimi"],
  ["kimi.moonshot.cn", "Kimi"],
  ["qwen.ai", "通义千问"],
  ["tongyi.com", "通义千问"],
  ["doubao.com", "豆包"],
  ["volcengine.com", "火山引擎"],
  ["gemini.google.com", "Gemini"],
  ["grok.com", "Grok"],
  ["poe.com", "Poe"],
  ["huggingface.co", "Hugging Face"],
  ["notion.so", "Notion"],
  ["obsidian.md", "Obsidian"],
  ["figma.com", "Figma"],
  ["framer.com", "Framer"],
  ["canva.com", "Canva"],
  ["linear.app", "Linear"],
  ["slack.com", "Slack"],
  ["discord.com", "Discord"],
  ["vercel.com", "Vercel"],
  ["supabase.com", "Supabase"],
  ["netlify.com", "Netlify"],
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
  ["tradingview.com", "TradingView"],
  ["coursera.org", "Coursera"],
  ["udemy.com", "Udemy"],
  ["edx.org", "edX"],
  ["khanacademy.org", "Khan Academy"],
  ["macdown.uranusjr.com", "MacDown"],
  ["macdown.uranusjr.com.cn", "MacDown"]
]);

const TITLE_TOPIC_RULES = [
  { group: "Rime 输入法", pattern: /\b(rime|librime|weasel|squirrel|trime|ibus-rime)\b|小狼毫|鼠须管|中州韵|雾凇拼音|薄荷拼音|朙月拼音|地球拼音|仓颉输入法|输入法方案/ },
  { group: "Chrome 扩展", pattern: /chrome\s*(extension|web store)|manifest\s*v?3|mv3|浏览器扩展|扩展程序|chrome 应用商店|chrome 商店/ },
  { group: "OpenAI API", pattern: /\b(openai|chatgpt|gpt-[45]|responses api|assistants api)\b.*\b(api|sdk|model|模型)\b|\b(api|sdk)\b.*\b(openai|gpt-[45])\b/ },
  { group: "OpenAI", pattern: /\b(openai|chatgpt|gpt-[45]|responses api|assistants api)\b/ },
  { group: "Claude", pattern: /\b(claude|anthropic)\b/ },
  { group: "DeepSeek API", pattern: /\bdeepseek\b.*\b(api|sdk|model|模型)\b|\b(api|sdk)\b.*\bdeepseek\b|deepseek.*接口/ },
  { group: "DeepSeek", pattern: /\bdeepseek\b|深度求索/ },
  { group: "Kimi", pattern: /\bkimi\b|moonshot|月之暗面/ },
  { group: "通义千问", pattern: /\bqwen\b|通义千问|通义\b/ },
  { group: "豆包", pattern: /\bdoubao\b|豆包|火山方舟/ },
  { group: "Gemini", pattern: /\bgemini\b|google ai studio/ },
  { group: "Grok", pattern: /\bgrok\b/ },
  { group: "Perplexity", pattern: /\bperplexity\b/ },
  { group: "Hugging Face", pattern: /\bhugging\s*face\b|transformers|diffusers/ },
  { group: "Midjourney", pattern: /\bmidjourney\b/ },
  { group: "Stable Diffusion", pattern: /\bstable diffusion\b|\bsdxl\b|comfyui|automatic1111/ },
  { group: "大模型", pattern: /\bllm\b|大语言模型|提示词|prompt engineering|rag\b|向量数据库|embedding|推理模型/ },
  { group: "Cursor", pattern: /\bcursor\b/ },
  { group: "VS Code", pattern: /\b(vs ?code|visual studio code)\b/ },
  { group: "React", pattern: /\breact(?:\.js)?\b/ },
  { group: "Vue", pattern: /\bvue(?:\.js)?\b/ },
  { group: "Next.js", pattern: /\bnext(?:\.js)?\b/ },
  { group: "Nuxt", pattern: /\bnuxt(?:\.js)?\b/ },
  { group: "Svelte", pattern: /\bsvelte(?:kit)?\b/ },
  { group: "Angular", pattern: /\bangular\b/ },
  { group: "Astro", pattern: /\bastro\b/ },
  { group: "Tailwind CSS", pattern: /\btailwind(?:css)?\b/ },
  { group: "TypeScript", pattern: /\btypescript|tsconfig\b/ },
  { group: "JavaScript", pattern: /\bjavascript|node\.js|npm|pnpm|yarn|bun\b/ },
  { group: "Python", pattern: /\bpython|pyenv|pip|conda|jupyter|fastapi|django|flask\b/ },
  { group: "Rust", pattern: /\brust|cargo|tokio|tauri\b/ },
  { group: "Go", pattern: /\bgolang\b|\bgo语言\b/ },
  { group: "Swift", pattern: /\bswift|swiftui|xcode\b/ },
  { group: "HarmonyOS", pattern: /harmonyos|鸿蒙|arkts|arkui|deveco/ },
  { group: "Docker", pattern: /\bdocker|dockerfile|docker compose|compose\.ya?ml\b/ },
  { group: "Kubernetes", pattern: /\bkubernetes|k8s|kubectl|helm\b/ },
  { group: "Git", pattern: /\bgit\b|版本控制/ },
  { group: "PostgreSQL", pattern: /\bpostgres(?:ql)?\b/ },
  { group: "Supabase", pattern: /\bsupabase\b/ },
  { group: "Redis", pattern: /\bredis\b/ },
  { group: "MongoDB", pattern: /\bmongodb|mongo\b/ },
  { group: "API", pattern: /\b(rest api|graphql|grpc|openapi|swagger|webhook)\b|接口文档/ },
  { group: "macOS", pattern: /\bmacos|launchd|homebrew|brew\b|快捷指令|自动操作/ },
  { group: "Windows", pattern: /\bwindows|powershell|wsl\b/ },
  { group: "Linux", pattern: /\blinux|ubuntu|debian|archlinux|systemd\b/ },
  { group: "Markdown", pattern: /\bmarkdown|mdx\b/ },
  { group: "Obsidian", pattern: /\bobsidian\b/ },
  { group: "Notion", pattern: /\bnotion\b/ },
  { group: "LaTeX", pattern: /\blatex|overleaf\b/ },
  { group: "MacDown", pattern: /\bmacdown\b/ },
  { group: "MarkEdit", pattern: /\bmarkedit\b/ },
  { group: "论文", pattern: /论文|paper|arxiv|doi\.org|research/ },
  { group: "文档", pattern: /文档|documentation|docs|manual|reference|手册/ },
  { group: "教程", pattern: /教程|入门|指南|guide|tutorial|learn/ },
  { group: "视频", pattern: /视频|直播|回放|\bvideo\b|\blive\b/ }
];

const SITE_PROPERTY_RULES = [
  { group: "AI", domains: ["chat.openai.com", "chatgpt.com", "openai.com", "platform.openai.com", "claude.ai", "anthropic.com", "deepseek.com", "chat.deepseek.com", "platform.deepseek.com", "kimi.moonshot.cn", "moonshot.cn", "qwen.ai", "tongyi.com", "doubao.com", "volcengine.com", "gemini.google.com", "aistudio.google.com", "grok.com", "poe.com", "perplexity.ai", "huggingface.co"] },
  { group: "文档", domains: ["developer.mozilla.org", "docs.github.com", "learn.microsoft.com", "devdocs.io", "readthedocs.io", "developer.chrome.com", "developer.apple.com", "platform.openai.com", "docs.anthropic.com", "docs.cursor.com", "docs.deepseek.com", "react.dev", "vuejs.org", "nextjs.org", "nuxt.com", "svelte.dev", "astro.build", "tailwindcss.com", "vite.dev", "nodejs.org", "docs.python.org", "doc.rust-lang.org", "go.dev", "developer.harmonyos.com"] },
  { group: "代码", domains: ["github.com", "gitlab.com", "bitbucket.org", "gitee.com", "stackoverflow.com", "stackexchange.com", "npmjs.com", "pypi.org", "crates.io", "pkg.go.dev"] },
  { group: "视频", domains: ["youtube.com", "youtu.be", "bilibili.com", "b23.tv", "bilibili.tv", "vimeo.com", "netflix.com", "iqiyi.com", "youku.com", "tencentvideo.com", "douyin.com", "tiktok.com", "kuaishou.com"] },
  { group: "邮箱", domains: ["mail.google.com", "outlook.live.com", "outlook.office.com", "mail.qq.com", "mail.163.com", "mail.126.com"] },
  { group: "应用商店", domains: ["chromewebstore.google.com", "apps.apple.com", "appstoreconnect.apple.com"] },
  { group: "办公", domains: ["notion.so", "docs.google.com", "drive.google.com", "office.com", "feishu.cn", "larksuite.com", "yuque.com", "linear.app", "slack.com"] },
  { group: "设计", domains: ["figma.com", "dribbble.com", "behance.net", "canva.com", "framer.com"] },
  { group: "学习", domains: ["coursera.org", "udemy.com", "edx.org", "khanacademy.org", "leetcode.com", "freecodecamp.org"] },
  { group: "部署", domains: ["vercel.com", "netlify.com", "cloudflare.com", "render.com", "railway.app"] },
  { group: "购物", domains: ["amazon.com", "amazon.cn", "taobao.com", "tmall.com", "jd.com", "pinduoduo.com", "1688.com", "ebay.com"] },
  { group: "社交", domains: ["x.com", "twitter.com", "facebook.com", "instagram.com", "reddit.com", "weibo.com", "zhihu.com", "xiaohongshu.com", "discord.com"] },
  { group: "新闻", domains: ["news.ycombinator.com", "nytimes.com", "bbc.com", "reuters.com", "thepaper.cn", "36kr.com", "sspai.com"] },
  { group: "金融", domains: ["finance.yahoo.com", "tradingview.com", "bloomberg.com", "eastmoney.com", "xueqiu.com"] },
  { group: "搜索", domains: ["google.com", "bing.com", "baidu.com", "duckduckgo.com"] }
];

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
      const result = await classifyCandidateGroupsWithCloud(
        buildCloudCandidates([
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
        ]),
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
  const groupedTabIdsInOrder = eligibleGroups.flatMap(([, tabIds]) => tabIds);
  const groupedStartIndex = getFirstGroupableTabIndex(tabs);
  const groupedTabIdSet = new Set(groupedTabIdsInOrder);
  const staleGroupedTabIds = tabs
    .filter((tab) => isTabInGroup(tab) && !groupedTabIdSet.has(tab.id))
    .map((tab) => tab.id);

  await ungroupTabIds(staleGroupedTabIds);

  const createdGroups = [];
  for (const [groupName, tabIds] of eligibleGroups) {
    const groupId = await groupTabIds(tabIds);
    await updateGroup(groupId, {
      title: groupName,
      color: colorForIndex(groupCount),
      collapsed: false
    });
    createdGroups.push({ groupId, groupName, tabIds });
    groupCount += 1;
    groupedTabs += tabIds.length;
  }
  await ensureGroupMembership(windowId, createdGroups);
  await moveTabIds(groupedTabIdsInOrder, groupedStartIndex);
  await ensureGroupMembership(windowId, createdGroups);

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
      await appendLog("error", "云端分类失败，回退本地规则", normalizeError(error));
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

function stabilizeSingletonsByDomain(items, settings) {
  if (settings.includeSingleTabGroups) {
    return items;
  }

  const groupCounts = countBy(items, (item) => item.group);
  const domainBuckets = new Map();

  for (const item of items) {
    const domainKey = getDomainGroup(item.tab?.url || "");
    const domainName = getDomainName(item.tab?.url || "");
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
  const items = tabs.map(toClassifiableTab);
  const batchKey = getCloudBatchCacheKey(items);
  const cached = cache[batchKey];

  if (cached && now - cached.at < cacheTtl && cached.groups) {
    await appendLog("info", "命中云端分类缓存", { tabs: tabs.length, cacheKey: batchKey });
    return tabs.map((tab) => ({
      tab,
      group: cached.groups[getTabSignature(tab)] || getLocalGroup(tab)
    }));
  }

  const candidates = buildCloudCandidates(items);
  await appendLog("info", "准备云端分类", {
    tabs: tabs.length,
    candidates: candidates.length,
    candidateSummary: summarizeCandidates(candidates)
  });
  const cloudResults = candidates.length > 0
    ? await classifyCandidateGroupsWithCloud(candidates, settings)
    : [];
  const candidateGroups = new Map(cloudResults.map((result) => [result.candidateId, result.group]));
  const candidateByTabId = new Map(
    candidates.flatMap((candidate) => candidate.tabIds.map((id) => [id, candidate]))
  );
  const classified = tabs.map((tab) => ({
    tab,
    group: candidateGroups.get(candidateByTabId.get(tab.id)?.candidateId) || getLocalGroup(tab)
  }));

  cache[batchKey] = {
    at: now,
    groups: Object.fromEntries(classified.map((item) => [getTabSignature(item.tab), item.group]))
  };
  await setStorage(CACHE_KEY, trimCache(cache, now, cacheTtl));

  return classified;
}

async function classifyCandidateGroupsWithCloud(candidates, settings, isTest = false) {
  assertCloudSettings(settings);

  const apiUrl = settings.cloudApiUrl.trim();
  const isResponsesEndpoint = /\/responses\/?$/.test(new URL(apiUrl).pathname);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.cloudApiKey.trim()}`
  };
  const requestMeta = {
    endpoint: safeEndpoint(apiUrl),
    endpointType: isResponsesEndpoint ? "responses" : "chat-completions",
    model: settings.cloudModel.trim(),
    candidates: candidates.length
  };

  const systemPrompt = [
    "你是浏览器标签页分类器。",
    "不要输出推理过程，不要逐项解释，不要先分析；直接输出最终 JSON。",
    "你会收到本地预处理后的候选组摘要，而不是完整标签列表。你的任务是合并候选组并给最终分组智能命名。",
    "必须按以下多层机制判断：",
    "1. 名字/标题层：优先看标题里的主题、产品、技术栈、教程对象。不同网站、不同域名但标题主题相同的候选组必须合并到同一组。例如 YouTube、知乎、博客里的 Rime、小狼毫、鼠须管、雾凇拼音教程都归为 Rime 输入法，而不是视频、社交或各自域名。",
    "2. 网站属性层：如果标题没有明确共同主题，再看网站属性，例如视频、代码、文档、邮箱、搜索、购物、社交、新闻、金融、设计、办公。",
    "3. 站点名层：如果仍不能判断，才使用站点名或产品名，例如 GitHub、Notion、Google Docs、哔哩哔哩。",
    "智能命名要求：组名要尽量具体、稳定、可复用；有具体主题时用主题名或主题+类别，例如 Rime 输入法、React 文档、OpenAI API，不要用笼统的“教程”“文章”；有具体产品时用产品名，不要用网站类型。",
    "不要把完整域名或域名后缀作为分组名，例如不要返回 bilibili.com、example.xyz、docs.example.co.uk。",
    "分组名最长 12 个中文字符。必须覆盖每个输入 candidateId，且每个 candidateId 只能出现在一个返回组里。",
    "输出必须是纯 JSON 对象，不能包含 Markdown、代码块、解释文字或前后缀。",
    "唯一允许格式：{\"groups\":[{\"candidateIds\":[\"c1\",\"c2\"],\"group\":\"Rime 输入法\"}]}。"
  ].join("\n");

  const userPrompt = JSON.stringify({
    rules: {
      priority: ["titleTopic", "siteProperty", "domainDisplayName"],
      useProvidedSignalsAsHints: true,
      avoidDomainSuffixInGroupNames: true
    },
    candidates: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      tabIds: candidate.tabIds,
      suggestedName: candidate.suggestedName,
      sampleTitles: candidate.sampleTitles,
      urlHints: candidate.urlHints,
      domains: candidate.domains,
      signals: {
        titleTopics: candidate.titleTopics,
        siteProperties: candidate.siteProperties,
        domainDisplayNames: candidate.domainDisplayNames
      }
    }))
  });

  const disableThinking = shouldSendThinkingDisable(settings);
  const attempts = getCloudRequestAttempts(disableThinking);
  let data;
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
        thinkingDisabled: attempt.disableThinking
      });
      data = await postCloudJson(apiUrl, headers, buildCloudRequestBody({
        isResponsesEndpoint,
        model: settings.cloudModel.trim(),
        systemPrompt,
        userPrompt,
        useJsonMode: attempt.useJsonMode,
        disableThinking: attempt.disableThinking
      }));
      break;
    } catch (error) {
      lastError = error;
      const jsonModeError = attempt.useJsonMode && isLikelyJsonModeError(error);
      const thinkingError = attempt.disableThinking && isLikelyThinkingParamError(error);
      if (!jsonModeError && !thinkingError) {
        throw error;
      }
      skipJsonMode = skipJsonMode || jsonModeError;
      skipThinking = skipThinking || thinkingError;
      await appendLog("warn", "云端请求参数不兼容，准备重试", {
        jsonMode: attempt.useJsonMode,
        thinkingDisabled: attempt.disableThinking,
        reason: normalizeError(error)
      });
    }
  }

  if (!data) {
    throw lastError || new Error("云端请求失败。");
  }

  await appendLog("debug", "云端响应 JSON", data);
  assertCloudCompletionUsable(data);
  const content = extractModelContent(data);
  await appendLog("ai", "AI 返回内容", content);
  const parsed = parseModelJson(content);
  const resultGroups = normalizeResultGroups(parsed);
  await appendLog("info", "AI 分组解析结果", resultGroups);

  if (isTest && resultGroups.length === 0) {
    throw new Error("API 返回成功，但没有 groups 分类结果。");
  }

  return resultGroups.flatMap((group) => {
    const groupName = normalizeReturnedGroupName(group.group);
    const candidateIds = getCandidateIdsFromGroup(group);
    return candidateIds
      .map((candidateId) => ({
        candidateId: String(candidateId),
        group: groupName
      }))
      .filter((item) => item.candidateId && item.group);
  });
}

function getCloudRequestAttempts(disableThinking) {
  const attempts = [
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

function buildCloudRequestBody({ isResponsesEndpoint, model, systemPrompt, userPrompt, useJsonMode, disableThinking }) {
  const thinkingConfig = disableThinking ? { thinking: { type: "disabled" } } : {};
  if (isResponsesEndpoint) {
    return {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      max_output_tokens: CLOUD_MAX_OUTPUT_TOKENS,
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
    temperature: 0.1,
    max_tokens: CLOUD_MAX_OUTPUT_TOKENS,
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

async function postCloudJson(apiUrl, headers, body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLOUD_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("云端分类超过 1 分钟，已停止等待。");
    }
    throw new Error(`请求失败: ${normalizeError(error)}`);
  } finally {
    clearTimeout(timeoutId);
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
  const candidates = getJsonCandidates(text);
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed) {
      return normalizeParsedJson(parsed);
    }
  }
  throw new Error("模型没有返回可解析的 JSON。");
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
  if (parsed?.candidateIds || parsed?.group) {
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
    localFallback: chooseLocalGroup(titleTopic, siteProperty, domainDisplayName)
  };
}

function buildCloudCandidates(items) {
  const candidateMap = new Map();

  for (const item of items) {
    const key = getCandidateKey(item);
    if (!candidateMap.has(key)) {
      candidateMap.set(key, {
        candidateId: `c${candidateMap.size + 1}`,
        suggestedName: item.localFallback || item.domainDisplayName || "其他",
        tabIds: [],
        sampleTitles: [],
        urlHints: [],
        domains: new Set(),
        titleTopics: new Set(),
        siteProperties: new Set(),
        domainDisplayNames: new Set()
      });
    }

    const candidate = candidateMap.get(key);
    candidate.tabIds.push(item.id);
    pushUnique(candidate.sampleTitles, truncateString(item.title || "", 80), 3);
    pushUnique(candidate.urlHints, compactUrl(item.url || ""), 3);
    addNonEmpty(candidate.domains, item.domain);
    addNonEmpty(candidate.titleTopics, item.titleTopic);
    addNonEmpty(candidate.siteProperties, item.siteProperty);
    addNonEmpty(candidate.domainDisplayNames, item.domainDisplayName);
  }

  return [...candidateMap.values()].map((candidate) => ({
    ...candidate,
    domains: [...candidate.domains].slice(0, 4),
    titleTopics: [...candidate.titleTopics].slice(0, 4),
    siteProperties: [...candidate.siteProperties].slice(0, 4),
    domainDisplayNames: [...candidate.domainDisplayNames].slice(0, 4)
  }));
}

function summarizeCandidates(candidates) {
  return candidates.slice(0, 20).map((candidate) => ({
    candidateId: candidate.candidateId,
    tabCount: candidate.tabIds.length,
    suggestedName: candidate.suggestedName,
    titleTopics: candidate.titleTopics,
    siteProperties: candidate.siteProperties,
    domainDisplayNames: candidate.domainDisplayNames,
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
  if (item.titleTopic && !WEAK_TITLE_GROUPS.has(item.titleTopic)) {
    return `topic:${item.titleTopic}`;
  }
  if (item.siteProperty && (!item.titleTopic || WEAK_TITLE_GROUPS.has(item.titleTopic))) {
    return `property:${item.siteProperty}`;
  }
  return `tab:${item.id}`;
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
  const siteGroup = getSitePropertyGroup(tab.url || "");
  const domainGroup = getDomainName(tab.url);

  return chooseLocalGroup(titleGroup, siteGroup, domainGroup);
}

function chooseLocalGroup(titleGroup, siteGroup, domainGroup) {
  if (titleGroup && !WEAK_TITLE_GROUPS.has(titleGroup)) {
    return titleGroup;
  }

  if (siteGroup) {
    return siteGroup;
  }

  if (titleGroup) {
    return titleGroup;
  }

  return domainGroup || "其他";
}

function getTitleGroup(title, _url) {
  const text = normalizeText(title);

  for (const rule of TITLE_TOPIC_RULES) {
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

  for (const rule of SITE_PROPERTY_RULES) {
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
