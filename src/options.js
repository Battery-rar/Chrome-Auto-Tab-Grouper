const fields = {
  includeSingleTabGroups: document.querySelector("#includeSingleTabGroups"),
  cloudApiUrl: document.querySelector("#cloudApiUrl"),
  cloudApiKey: document.querySelector("#cloudApiKey"),
  cloudModel: document.querySelector("#cloudModel"),
  cacheTtlHours: document.querySelector("#cacheTtlHours"),
  status: document.querySelector("#status")
};

document.querySelector("#save").addEventListener("click", saveSettings);
document.querySelector("#testCloud").addEventListener("click", testCloud);
document.querySelector("#regroupNow").addEventListener("click", regroupNow);

loadSettings();

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
    cacheTtlHours: Number(fields.cacheTtlHours.value || 24)
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
    const groups = response.result.map((item) => `${item.id}: ${item.group}`).join("；");
    setStatus(`云端分类可用：${groups || "已返回结果"}`, true);
  } else {
    setStatus(response.error || "云端分类测试失败。", false);
  }
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
