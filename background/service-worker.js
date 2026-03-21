importScripts("../shared/shared.js");

const { DEFAULT_LOCAL_DATA } = globalThis.ChatGPTVoyagerShared;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(DEFAULT_LOCAL_DATA);
  const nextSettings = {
    ...DEFAULT_LOCAL_DATA,
    ...stored
  };

  await chrome.storage.local.set(nextSettings);
  console.log("ChatGPT-Voyager installed", nextSettings);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPEN_OPTIONS_PAGE") {
    chrome.runtime
      .openOptionsPage()
      .then(() => {
        sendResponse({
          ok: true
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "打开设置页失败。"
        });
      });

    return true;
  }

  return false;
});
