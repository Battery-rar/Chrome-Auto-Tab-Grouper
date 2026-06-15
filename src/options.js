const fields = {
  includeSingleTabGroups: document.querySelector("#includeSingleTabGroups"),
  cloudApiUrl: document.querySelector("#cloudApiUrl"),
  cloudApiKey: document.querySelector("#cloudApiKey"),
  cloudModel: document.querySelector("#cloudModel"),
  cacheTtlHours: document.querySelector("#cacheTtlHours"),
  enableThinking: document.querySelector("#enableThinking"),
  status: document.querySelector("#status"),
  logTerminal: document.querySelector("#logTerminal")
};

document.querySelector("#save").addEventListener("click", saveSettings);
document.querySelector("#testCloud").addEventListener("click", testCloud);
document.querySelector("#regroupNow").addEventListener("click", regroupNow);
document.querySelector("#refreshLogs").addEventListener("click", () => refreshLogs({ force: true }));
document.querySelector("#clearLogs").addEventListener("click", clearLogs);

loadSettings();
refreshLogs({ force: true });
setInterval(() => refreshLogs(), 3000);

async function loadSettings() {
  const response = await sendMessage({ type: "get-settings" });
  if (!response.ok) {
    setStatus(response.error || "读取设置失败。", false);
    return;
  }

  const settings = response.settings;
  fields.includeSingleTabGroups.checked = Boolean(settings.includeSingleTabGroups);
  fields.cloudApiUrl.value = settings.cloudApiUrl || "";
  fields.cloudApiKey.value = settings.cloudApiKey || "";
  fields.cloudModel.value = settings.cloudModel || "";
  fields.cacheTtlHours.value = settings.cacheTtlHours || 24;
  fields.enableThinking.checked = settings.disableThinking === false;

  const mode = settings.mode === "cloud" ? "cloud" : "local";
  document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;

  if (response.status?.message) {
    setStatus(response.status.message, response.status.ok);
  }
}

async function saveSettings() {
  const mode = document.querySelector('input[name="mode"]:checked')?.value || "local";
  const settings = {
    mode,
    includeSingleTabGroups: fields.includeSingleTabGroups.checked,
    cloudApiUrl: fields.cloudApiUrl.value.trim(),
    cloudApiKey: fields.cloudApiKey.value.trim(),
    cloudModel: fields.cloudModel.value.trim(),
    cacheTtlHours: Number(fields.cacheTtlHours.value || 24),
    disableThinking: !fields.enableThinking.checked
  };

  const response = await sendMessage({ type: "save-settings", settings });
  if (response.ok) {
    setStatus("设置已保存。", true);
  } else {
    setStatus(response.error || "保存失败。", false);
  }
}

async function testCloud() {
  await saveSettings();
  setStatus("正在测试云端分类…", true);
  const response = await sendMessage({ type: "test-cloud" });
  if (response.ok) {
    const groups = response.result.map((item) => `${item.candidateId}: ${item.group}`).join("；");
    setStatus(`云端分类可用：${groups || "已返回结果"}`, true);
  } else {
    setStatus(response.error || "云端分类测试失败。", false);
  }
  await refreshLogs({ force: true });
}

async function regroupNow() {
  await saveSettings();
  setStatus("正在整理当前窗口…", true);
  const response = await sendMessage({ type: "regroup-now" });
  if (response.ok) {
    const { groupedTabs, groups, message, warning } = response.result;
    setStatus(message || `已整理 ${groupedTabs} 个标签，生成 ${groups} 个分组。`, !warning);
  } else {
    setStatus(response.error || "立即分组失败。", false);
  }
  await refreshLogs({ force: true });
}

async function refreshLogs({ force = false } = {}) {
  if (!force && isLogTerminalSelectionActive()) {
    return;
  }
  const shouldStickToBottom = isLogTerminalAtBottom();
  const response = await sendMessage({ type: "get-logs" });
  if (!response.ok) {
    setLogTerminalText(response.error || "读取日志失败。");
    return;
  }

  const logs = response.logs || [];
  setLogTerminalText(logs.length ? logs.map(formatLogEntry).join("\n\n") : "暂无日志。");
  if (shouldStickToBottom) {
    fields.logTerminal.scrollTop = fields.logTerminal.scrollHeight;
  }
}

async function clearLogs() {
  const response = await sendMessage({ type: "clear-logs" });
  if (response.ok) {
    await refreshLogs({ force: true });
  } else {
    setStatus(response.error || "清空日志失败。", false);
  }
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error: error.message });
      } else {
        resolve(response || { ok: false, error: "没有收到后台响应。" });
      }
    });
  });
}

function setStatus(message, ok) {
  fields.status.textContent = message;
  fields.status.classList.toggle("ok", Boolean(ok));
  fields.status.classList.toggle("error", ok === false);
}

function isLogTerminalAtBottom() {
  const terminal = fields.logTerminal;
  return terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 24;
}

function isLogTerminalSelectionActive() {
  const terminal = fields.logTerminal;
  return document.activeElement === terminal && terminal.selectionStart !== terminal.selectionEnd;
}

function setLogTerminalText(text) {
  fields.logTerminal.value = text;
}

function formatLogEntry(entry) {
  const time = entry.at ? new Date(entry.at).toLocaleTimeString() : "--:--:--";
  const level = String(entry.level || "info").toUpperCase().padEnd(5, " ");
  const detail = entry.detail ? `\n${entry.detail}` : "";
  return `[${time}] ${level} ${entry.message || ""}${detail}`;
}
