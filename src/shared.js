// ponytail: shared utils — loaded by both popup and options
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
