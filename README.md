# 自动标签分组

一个 Chrome Manifest V3 扩展，用来在点击按钮后整理当前窗口的标签页分组。

## 功能

- 本地模式：先按标题里的主题或产品名分类，例如不同网站上的 Rime、小狼毫、鼠须管教程会优先归到 `Rime 输入法`。
- 本地模式：标题规则覆盖更多 Tag，包括 Rime、Chrome 扩展、OpenAI API、DeepSeek、Claude、Kimi、通义千问、豆包、Gemini、Ollama、Open WebUI、LM Studio、LangChain、Dify、n8n、Hugging Face、腾讯系、Apple 系、B 站、抖音、快手、React、Vue、Next.js、Python、Swift、HarmonyOS、Docker、Kubernetes、Markdown、Obsidian、MacDown、MarkEdit 等。
- 本地模式：标题不明确时按网站属性分类，例如 AI、文档、代码、视频、邮箱、聊天、搜索、购物、社交、新闻、金融、设计、办公、学习、应用商店、部署等。
- 本地模式会把“视频、教程、文档、论文、API”这类标题词当作弱信号；如果页面来自 GitHub、文档站、代码托管等更明确的网站属性，会优先用网站属性，避免明显不符的页面被塞进泛分类。
- GitHub、GitLab、Gitee、Bitbucket 这类代码托管站点会优先按站点名或仓库主题分组，不再和 Stack Overflow、npm、PyPI 这类代码问答/包资源站点混成泛 `代码`。
- 搜索引擎会提取搜索词参与分类。Google、Bing、百度、DuckDuckGo、Kagi、Brave Search、搜狗、360 搜索等页面如果搜索内容和其他标签相关，会优先归到相关主题，例如 `Ollama 下载` 搜索页会跟 Ollama 官网/教程归到一起；只有无法判断主题时才归为 `搜索`。
- Reddit、Quora、知乎、V2EX、贴吧、豆瓣等论坛/问答站点会先按具体主题归类；没有明确主题时按站点名兜底，不会全部混成一个粗糙论坛组。
- 国内外 AI 产品规则继续扩展，覆盖 OpenAI/ChatGPT、Claude、DeepSeek、Kimi、通义千问、豆包、Gemini、Grok、Perplexity、Microsoft Copilot、腾讯元宝、腾讯混元、Mistral、Groq、Hugging Face、硅基流动、魔搭社区等。
- 本地模式会结合当前窗口上下文提取功能主题；多个标签如果围绕同一对象的教程、下载、安装、配置、部署、文档或 GitHub 项目页，会优先按该对象分组。例如知乎里的 Ollama 教程、Ollama 下载页、相关 GitHub/Open WebUI 文档会更倾向于进入 Ollama 相关分组。邮箱、网页聊天这类强功能属性会优先跨站合并，例如 QQ 邮箱和 Outlook 归到 `邮箱`，WhatsApp、Telegram、Discord 等归到 `聊天`。只有功能联系不够强时，才回落到域名或站点名分组。
- 本地模式会优先识别产品/工具官网、文档和下载页，例如 `ollama.com`、`docs.ollama.com`、`docs.openwebui.com`、`developer.apple.com`、`v.qq.com`、`bilibili.com` 会按对应产品或平台分组，而不是泛化成 AI、文档或视频。
- 本地模式：前两者都不能判断时，按主域名分组，例如 `github.com`、`google.com`。
- 云端模式：填写 API 链接、API Key 和模型名后，先把当前窗口标签压缩成候选组摘要，再由 AI 合并候选组并生成智能组名。
- 云端模式会把本地识别出的标题主题、网站属性、站点显示名作为提示传给 AI，让它尽量把不同网站上的同一主题归到同一组。
- 云端模式会同步本地的功能上下文判断：高置信的同功能主题会先合并成候选组；只有域名、网站属性或弱标题信号的中低置信候选会尽量保持细粒度，让 AI 再分析标题和 URL 后决定是否按功能进一步合并。
- 云端模式对 GitHub、GitLab、Gitee、YouTube、哔哩哔哩、知乎、CSDN 等来源平台会保留更细粒度候选，并额外发送仓库名、路径主题、标题主题候选等线索，避免先把来源平台粗暴合并后让 AI 无法拆分。
- 云端模式会把产品域名强信号作为 `preferredDomainGroups` 发送给 AI，避免官网/文档/下载页被误压成泛化网站属性。
- 云端模式不会跳过 AI 命名；明确主题会先压缩成候选组，例如多个 Rime 页面压成一个候选组，再由 AI 命名为更具体的 `Rime 输入法`。
- 云端请求会截短标题和 URL 线索，并设置 1 分钟超时，避免无限等待。
- 云端请求遇到浏览器网络层偶发的 `Failed to fetch` 会短暂重试，并在同一轮云端分类里尝试切换 JSON mode / thinking 参数组合，减少 DeepSeek 等接口偶发断连导致的直接失败。
- 云端模式会要求模型返回纯 JSON，同时对代码块、解释文字包裹、数组或简单映射等非标准 JSON 返回做容错解析。
- 如果服务商不支持 `response_format` 或 Responses API 的 `text.format` JSON mode，会自动重试普通提示模式。
- 只有模型名或 API 地址看起来是 DeepSeek 时，默认才会发送 `thinking: { type: "disabled" }` 来减少推理耗时。设置页可手动“开启思考模式”，但可能更慢，并增加超时、空 `content` 或 JSON 不稳定的风险。
- 云端返回内容会兼容 `output_text`、`output[].content[].text`、`choices[].message.content`、`choices[].text`、顶层 `text/content` 等常见位置。
- 设置页内置日志终端，会显示云端请求过程、HTTP 响应摘要、AI 原始返回内容和解析结果；日志不会记录 API Key。
- 日志终端使用原生只读文本框，支持按需选择复制；只有在滚动条本来就在底部时才自动跟随新日志，手动向上查看或正在选中文本时不会被刷新拉回底部。
- 对 DeepSeek 等会输出 `reasoning_content` 的模型，扩展会给更高的输出 token 预算；如果预算仍被推理耗尽且最终 `content` 为空，日志会明确提示这是推理 token 耗尽，不再误判为返回位置问题。
- 不监听标签页变化，不定时刷新；只有点击弹窗或设置页里的“立即分组”才会执行。
- 域名兜底会显示站点名或品牌名，例如 `GitHub`、`Google`、`Example`，尽量不直接显示完整域名。
- 分组颜色会按当前窗口生成的分组顺序轮换 Chrome 提供的 9 种标签组颜色。
- 工具栏使用原生风格的“整理/分组”图标，正常状态不显示 badge，错误时才显示红色 `!`。
- 扩展内不再提供“启用”开关；启用或停用请使用 Chrome 扩展管理页。
- 默认不会给单个标签页创建分组；设置页可手动开启。
- 关闭单标签分组时，点击整理只会创建 2 个及以上标签的新分组；旧分组里这次不再属于任何合格新分组的标签会被移出，避免不符合的标签继续混在组里。
- 每次整理后，会把所有新生成或更新的分组标签移动到单独标签页之前。
- 每次整理会优先复用当前窗口里已有的同名分组，避免反复创建新分组；重复旧组里的标签会被移出，让 Chrome 在分组变空后自动移除旧组。
- 分组和移动后会重新校验标签是否真的进入目标组；如果 Chrome 状态落地延迟导致个别标签漏进组，会自动补拉一次并写入日志。
- 云端模式会缓存分类结果，减少重复请求。
- 云端缓存会按缓存版本、API 链接、模型名和思考模式设置隔离，避免切换模型或提示规则后误用旧分类结果。

## 安装

1. 打开 Chrome 的 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录：`auto-tab-grouper`。

## 云端模式配置

设置页里填入：

- API 链接：例如 `https://api.openai.com/v1/chat/completions`
- API Key：你的服务商密钥
- 模型名称：例如 `gpt-4.1-mini`

API 需要支持 OpenAI-compatible Chat Completions 返回格式。扩展也会识别路径以 `/responses` 结尾的端点，并按 Responses API 的常见 JSON 结构发送请求。

云端模式会发送这些信息给你配置的 API：

- 标签页标题
- 标签页 URL
- 标签页域名

## 权限说明

- `tabs`：读取当前窗口标签页的标题和 URL。
- `tabGroups`：创建和更新 Chrome 标签页分组。
- `storage`：保存设置和云端分类缓存。
- `<all_urls>`：允许扩展后台请求你配置的任意 AI API 地址。

## 开发备注

核心逻辑在 `src/background.js`：

- `classifyTabs`：根据当前模式选择本地或云端分类。
- `getLocalGroup`：本地模式入口，按标题、网站属性、域名依次分类。
- `getDomainGroup`：本地模式的主域名兜底。
- `classifyCandidateGroupsWithCloud`：云端候选组智能命名、合并和 JSON 解析。
- `regroupWindow`：按分类结果创建或更新 Chrome 标签页分组。

分类知识库在 `src/rules.js`：

- `TITLE_TOPIC_RULES`：标题主题和产品/技术栈识别。
- `SITE_PROPERTY_RULES`：常见网站属性分类。
- `DOMAIN_DISPLAY_NAMES`：域名兜底时显示的站点名。
- `PRODUCT_DOMAIN_GROUPS`：产品/工具官网、文档和下载页优先使用的产品分组。
- `FUNCTIONAL_TOPIC_STOP_WORDS` 和 `SOURCE_NAME_PATTERN`：功能主题提取时过滤通用词和站点尾巴。
