importScripts("../shared/shared.js");

const { DEFAULT_LOCAL_DATA, STORAGE_KEYS } = globalThis.ChatGPTVoyagerShared;
const BRANCH_PROMPT_DRAFT_TTL_MS = 2 * 60 * 1000;

function clearStoredBranchPromptDraft() {
  return chrome.storage.local.set({
    [STORAGE_KEYS.BRANCH_PROMPT_DRAFT]: null
  });
}

function isFreshBranchPromptDraft(draft) {
  return Boolean(
    draft &&
      typeof draft === "object" &&
      typeof draft.text === "string" &&
      draft.text.trim() &&
      typeof draft.sourceTurnId === "string" &&
      draft.sourceTurnId &&
      typeof draft.sourceTabId === "number" &&
      Number.isFinite(draft.sourceTabId) &&
      typeof draft.createdAt === "number" &&
      Number.isFinite(draft.createdAt) &&
      Date.now() - draft.createdAt < BRANCH_PROMPT_DRAFT_TTL_MS
  );
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(DEFAULT_LOCAL_DATA);
  const nextSettings = {
    ...DEFAULT_LOCAL_DATA,
    ...stored
  };

  await chrome.storage.local.set(nextSettings);
  console.log("ChatGPT-Voyager installed", nextSettings);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  if (message?.type === "CREATE_BRANCH_PROMPT_DRAFT") {
    const text = String(message.text || "").replace(/\r\n/g, "\n");
    const sourceTurnId = String(message.sourceTurnId || "").trim();
    const sourcePath = String(message.sourcePath || "").trim();
    const sourceTabId = sender.tab?.id;
    const sourceUrl =
      typeof sender.tab?.url === "string" && sender.tab.url ? sender.tab.url : "";

    if (!text.trim() || !sourceTurnId || typeof sourceTabId !== "number") {
      sendResponse({
        ok: false,
        error: "分支草稿参数不完整。"
      });
      return false;
    }

    chrome.storage.local
      .set({
        [STORAGE_KEYS.BRANCH_PROMPT_DRAFT]: {
          text,
          sourceTurnId,
          sourcePath,
          sourceUrl,
          sourceTabId,
          createdAt: Date.now()
        }
      })
      .then(() => {
        sendResponse({
          ok: true
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "保存分支草稿失败。"
        });
      });

    return true;
  }

  if (message?.type === "CONSUME_BRANCH_PROMPT_DRAFT") {
    chrome.storage.local
      .get({
        [STORAGE_KEYS.BRANCH_PROMPT_DRAFT]: null
      })
      .then(async (stored) => {
        const draft = stored[STORAGE_KEYS.BRANCH_PROMPT_DRAFT];

        if (!draft) {
          sendResponse({
            ok: true,
            draft: null
          });
          return;
        }

        if (!isFreshBranchPromptDraft(draft)) {
          await clearStoredBranchPromptDraft();
          sendResponse({
            ok: true,
            draft: null
          });
          return;
        }

        const currentTabId = sender.tab?.id;
        const openerTabId = sender.tab?.openerTabId;
        const currentPath = String(message.pathname || "").trim();
        const currentReferrer = String(message.referrer || "").trim();
        const isDifferentTab =
          typeof currentTabId === "number" && currentTabId !== draft.sourceTabId;
        const isDifferentPath =
          !currentPath || !draft.sourcePath || currentPath !== draft.sourcePath;
        const matchesOpener =
          typeof openerTabId === "number" && openerTabId === draft.sourceTabId;
        const matchesReferrer =
          Boolean(draft.sourceUrl) &&
          Boolean(currentReferrer) &&
          currentReferrer.startsWith(draft.sourceUrl);

        if (isDifferentTab && isDifferentPath && (matchesOpener || matchesReferrer)) {
          await clearStoredBranchPromptDraft();
          sendResponse({
            ok: true,
            draft
          });
          return;
        }

        sendResponse({
          ok: true,
          draft: null
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "读取分支草稿失败。"
        });
      });

    return true;
  }

  if (message?.type === "CLEAR_BRANCH_PROMPT_DRAFT") {
    clearStoredBranchPromptDraft()
      .then(() => {
        sendResponse({
          ok: true
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "清理分支草稿失败。"
        });
      });

    return true;
  }

  return false;
});
