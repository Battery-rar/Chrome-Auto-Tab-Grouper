const statusText = document.querySelector("#status");
const regroupButton = document.querySelector("#regroupNow");
const optionsButton = document.querySelector("#options");

regroupButton.addEventListener("click", regroupNow);
optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

loadPopup();

async function loadPopup() {
  const response = await sendMessage({ type: "get-settings" });
  if (!response.ok) {
    statusText.textContent = "读取失败。";
    return;
  }

  statusText.textContent = response.status?.ok === false ? "上次失败。" : "";
}

async function regroupNow() {
  await spinButton(regroupButton, async () => {
    statusText.textContent = "";
    const response = await sendMessage({ type: "regroup-now" });

    if (response.ok) {
      statusText.textContent = response.result?.warning ? "整理失败。" : "";
    } else {
      statusText.textContent = "整理失败。";
    }
  });
}

async function spinButton(btn, fn) {
  btn.classList.add("loading");
  try {
    await fn();
  } finally {
    btn.classList.remove("loading");
    btn.classList.add("done");
    setTimeout(() => btn.classList.remove("done"), 1500);
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
