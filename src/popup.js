const modeBadge = document.querySelector("#modeBadge");
const statusText = document.querySelector("#status");
const regroupButton = document.querySelector("#regroupNow");
const optionsButton = document.querySelector("#options");

regroupButton.addEventListener("click", regroupNow);
optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

loadPopup();

async function loadPopup() {
  const response = await sendMessage({ type: "get-settings" });
  if (!response.ok) {
    statusText.textContent = response.error || "读取状态失败。";
    return;
  }

  const settings = response.settings;
  modeBadge.textContent = settings.mode === "cloud" ? "云端 AI" : "本地规则";
  statusText.textContent = response.status?.message || "尚未运行。";
}

async function regroupNow() {
  regroupButton.disabled = true;
  statusText.textContent = "正在整理当前窗口…";
  const response = await sendMessage({ type: "regroup-now" });
  regroupButton.disabled = false;

  if (response.ok) {
    const { groupedTabs, groups, message } = response.result;
    statusText.textContent = message || `已整理 ${groupedTabs} 个标签，生成 ${groups} 个分组。`;
  } else {
    statusText.textContent = response.error || "分组失败。";
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
