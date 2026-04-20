const {
  FORMULA_COPY_FORMAT_LABELS,
  MARKDOWN_FORMULA_WRAP_LABELS,
  STORAGE_KEYS,
  DEFAULT_LOCAL_DATA,
  normalizeFormulaCopyFormat,
  normalizeMarkdownFormulaWrapMode,
  clampFormulaHistoryItems,
  renderFormulaPreview,
  truncateText,
  formatTimestamp,
  copyTextToClipboard,
  saveFormulaHistoryEntry
} = globalThis.ChatGPTVoyagerShared;

const pageTitle = document.getElementById("page-title");
const pageUrl = document.getElementById("page-url");
const supportNote = document.getElementById("support-note");
const status = document.getElementById("status");
const formulaCopierToggle = document.getElementById("formula-copier-enabled");
const formulaCopyFormatInputs = document.querySelectorAll(
  'input[name="formula-copy-format"]'
);
const markdownFormulaWrapModeInputs = document.querySelectorAll(
  'input[name="markdown-formula-wrap-mode"]'
);
const enterEnhancerToggle = document.getElementById("enter-enhancer-enabled");
const chatgptTimelineToggle = document.getElementById("chatgpt-timeline-enabled");
const notionCloseGuardToggle = document.getElementById(
  "notion-close-guard-enabled"
);
const formulaHistoryList = document.getElementById("formula-history-list");
const formulaHistoryEmpty = document.getElementById("formula-history-empty");
const clearFormulaHistoryButton = document.getElementById("clear-formula-history");
const savedPromptsList = document.getElementById("saved-prompts-list");
const savedPromptsEmpty = document.getElementById("saved-prompts-empty");
const openOptionsButton = document.getElementById("open-options");

function getFormulaCopyFormatLabel(value) {
  return FORMULA_COPY_FORMAT_LABELS[normalizeFormulaCopyFormat(value)];
}

function getMarkdownFormulaWrapModeLabel(value) {
  return MARKDOWN_FORMULA_WRAP_LABELS[normalizeMarkdownFormulaWrapMode(value)];
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

function getSiteInfo(urlString) {
  if (!urlString) {
    return null;
  }

  try {
    const { hostname } = new URL(urlString);

    if (
      hostname.includes("chatgpt.com") ||
      hostname.includes("chat.openai.com")
    ) {
      return {
        name: "ChatGPT",
        supportsFormulaCopier: true,
        supportsEnterEnhancer: true,
        supportsConversationTimeline: true,
        supportsNotionCloseGuard: false
      };
    }

    if (
      hostname === "notion.so" ||
      hostname === "www.notion.so" ||
      hostname.endsWith(".notion.so") ||
      hostname.endsWith(".notion.site")
    ) {
      return {
        name: "Notion",
        supportsFormulaCopier: false,
        supportsEnterEnhancer: false,
        supportsConversationTimeline: false,
        supportsNotionCloseGuard: true
      };
    }

    return null;
  } catch (error) {
    return null;
  }
}

function renderSupportNote(site) {
  if (!site) {
    supportNote.textContent =
      "当前页面不在支持站点内。\nChatGPT：支持公式复制、会话时间线与 Enter 增强\nNotion：支持离开确认";
    return;
  }

  const formulaText = site.supportsFormulaCopier ? "支持" : "暂不支持";
  const enterText = site.supportsEnterEnhancer ? "支持" : "暂不支持";
  const timelineText = site.supportsConversationTimeline ? "支持" : "暂不支持";
  const notionText = site.supportsNotionCloseGuard ? "支持" : "暂不支持";
  supportNote.textContent =
    `当前站点：${site.name}\n` +
    `公式复制：${formulaText}\n` +
    `Enter / Ctrl+Enter 增强：${enterText}\n` +
    `GPT 会话时间线：${timelineText}\n` +
    `Notion 离开确认：${notionText}`;
}

function getHistorySummary(entry) {
  const formatLabel = getFormulaCopyFormatLabel(entry.format);
  const timeLabel = formatTimestamp(entry.copiedAt) || "刚刚复制";
  return `${formatLabel} · ${timeLabel}`;
}

function sortPrompts(prompts) {
  return [...(Array.isArray(prompts) ? prompts : [])].sort((a, b) => {
    const pinnedDiff = Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned));
    return pinnedDiff;
  });
}

function renderFormulaHistory(history) {
  const items = clampFormulaHistoryItems(history);
  formulaHistoryList.textContent = "";
  formulaHistoryEmpty.hidden = items.length > 0;
  clearFormulaHistoryButton.hidden = items.length === 0;

  items.forEach((entry) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "history-item";

    const preview = document.createElement("div");
    preview.className = "item-expression";
    renderFormulaPreview(preview, entry, {
      fallbackText: "未识别公式"
    });

    const summary = document.createElement("p");
    summary.className = "item-summary";
    summary.textContent = getHistorySummary(entry);

    item.appendChild(preview);
    item.appendChild(summary);
    item.addEventListener("click", () => {
      copyFormulaHistoryEntry(entry).catch((error) => {
        status.textContent =
          error instanceof Error ? error.message : "复制历史公式失败。";
      });
    });

    formulaHistoryList.appendChild(item);
  });
}

function renderSavedPrompts(prompts) {
  const items = sortPrompts(prompts);
  savedPromptsList.textContent = "";
  savedPromptsEmpty.hidden = items.length > 0;

  items.forEach((prompt) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "prompt-item";

    const head = document.createElement("div");
    head.className = "item-head";

    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = `${prompt.pinned ? "📌 " : ""}${prompt.name || "未命名提示词"}`;
    head.appendChild(title);

    const preview = document.createElement("p");
    preview.className = "item-preview";
    preview.textContent = truncateText(prompt.content, 96) || "提示词内容为空";

    item.appendChild(head);
    item.appendChild(preview);
    item.addEventListener("click", () => {
      copySavedPrompt(prompt).catch((error) => {
        status.textContent =
          error instanceof Error ? error.message : "复制提示词失败。";
      });
    });

    savedPromptsList.appendChild(item);
  });
}

async function loadPageInfo() {
  const tab = await getCurrentTab();
  pageTitle.textContent = tab?.title || "未读取到标题";
  pageUrl.textContent = tab?.url || "当前页面 URL 不可用";
  renderSupportNote(getSiteInfo(tab?.url));
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_LOCAL_DATA);
  const history = clampFormulaHistoryItems(settings[STORAGE_KEYS.FORMULA_HISTORY]);
  formulaCopierToggle.checked = Boolean(settings.formulaCopierEnabled);
  const currentFormat = normalizeFormulaCopyFormat(settings.formulaCopyFormat);
  formulaCopyFormatInputs.forEach((input) => {
    input.checked = input.value === currentFormat;
  });
  const currentMarkdownWrapMode = normalizeMarkdownFormulaWrapMode(
    settings.markdownFormulaWrapMode
  );
  markdownFormulaWrapModeInputs.forEach((input) => {
    input.checked = input.value === currentMarkdownWrapMode;
  });
  enterEnhancerToggle.checked = Boolean(settings.enterEnhancerEnabled);
  chatgptTimelineToggle.checked = Boolean(settings.chatgptTimelineEnabled);
  notionCloseGuardToggle.checked = Boolean(settings.notionCloseGuardEnabled);
  renderFormulaHistory(history);
  renderSavedPrompts(settings[STORAGE_KEYS.SAVED_PROMPTS]);

  if (
    Array.isArray(settings[STORAGE_KEYS.FORMULA_HISTORY]) &&
    history.length !== settings[STORAGE_KEYS.FORMULA_HISTORY].length
  ) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.FORMULA_HISTORY]: history
    });
  }
}

async function saveSettings(nextSettings, message) {
  await chrome.storage.local.set(nextSettings);
  status.textContent = message;
}

async function copyFormulaHistoryEntry(entry) {
  const text = String(entry.latexSource || entry.text || "").trim();

  if (!text) {
    status.textContent = "该历史记录没有可复制的内容。";
    return;
  }

  await copyTextToClipboard(text);
  status.textContent = "公式源码已复制。";

  try {
    await saveFormulaHistoryEntry({
      ...entry,
      copiedAt: Date.now()
    });
  } catch (error) {
    console.warn("[ChatGPT-Voyager] 更新公式历史失败。", error);
  }
}

async function copySavedPrompt(prompt) {
  const content = String(prompt.content || "").trim();

  if (!content) {
    status.textContent = "该提示词内容为空，无法复制。";
    return;
  }

  await copyTextToClipboard(content);
  status.textContent = `提示词「${prompt.name || "未命名"}」已复制。`;
}

formulaCopierToggle.addEventListener("change", () => {
  saveSettings(
    {
      formulaCopierEnabled: formulaCopierToggle.checked
    },
    `公式点击复制${formulaCopierToggle.checked ? "已开启" : "已关闭"}，已自动保存。`
  ).catch((error) => {
    status.textContent =
      error instanceof Error ? error.message : "保存公式复制设置失败。";
  });
});

formulaCopyFormatInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) {
      return;
    }

    const format = normalizeFormulaCopyFormat(input.value);

    saveSettings(
      {
        formulaCopyFormat: format
      },
      `公式复制格式已切换为 ${getFormulaCopyFormatLabel(format)}，已自动保存。`
    ).catch((error) => {
      status.textContent =
        error instanceof Error ? error.message : "保存公式复制格式失败。";
    });
  });
});

markdownFormulaWrapModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    const mode = normalizeMarkdownFormulaWrapMode(input.value);

    saveSettings(
      {
        markdownFormulaWrapMode: mode
      },
      `成段复制公式格式已切换为：${getMarkdownFormulaWrapModeLabel(mode)}。`
    ).catch((error) => {
      status.textContent =
        error instanceof Error ? error.message : "保存成段复制公式格式失败。";
    });
  });
});

enterEnhancerToggle.addEventListener("change", () => {
  saveSettings(
    {
      enterEnhancerEnabled: enterEnhancerToggle.checked
    },
    `Enter 增强${enterEnhancerToggle.checked ? "已开启" : "已关闭"}，已自动保存。`
  ).catch((error) => {
    status.textContent =
      error instanceof Error ? error.message : "保存 Enter 增强设置失败。";
  });
});

chatgptTimelineToggle.addEventListener("change", () => {
  saveSettings(
    {
      chatgptTimelineEnabled: chatgptTimelineToggle.checked
    },
    `GPT 会话时间线${chatgptTimelineToggle.checked ? "已开启" : "已关闭"}，已自动保存。`
  ).catch((error) => {
    status.textContent =
      error instanceof Error ? error.message : "保存 GPT 会话时间线设置失败。";
  });
});

notionCloseGuardToggle.addEventListener("change", () => {
  saveSettings(
    {
      notionCloseGuardEnabled: notionCloseGuardToggle.checked
    },
    `Notion 离开确认${notionCloseGuardToggle.checked ? "已开启" : "已关闭"}，已自动保存。`
  ).catch((error) => {
    status.textContent =
      error instanceof Error ? error.message : "保存 Notion 离开确认设置失败。";
  });
});

clearFormulaHistoryButton.addEventListener("click", () => {
  chrome.storage.local
    .set({
      [STORAGE_KEYS.FORMULA_HISTORY]: []
    })
    .then(() => {
      status.textContent = "公式复制历史已清空。";
    })
    .catch((error) => {
      status.textContent =
        error instanceof Error ? error.message : "清空公式历史失败。";
    });
});

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (
    "formulaCopierEnabled" in changes ||
    "formulaCopyFormat" in changes ||
    "markdownFormulaWrapMode" in changes ||
    "enterEnhancerEnabled" in changes ||
    "chatgptTimelineEnabled" in changes ||
    "notionCloseGuardEnabled" in changes ||
    STORAGE_KEYS.FORMULA_HISTORY in changes ||
    STORAGE_KEYS.SAVED_PROMPTS in changes
  ) {
    loadSettings().catch((error) => {
      status.textContent =
        error instanceof Error ? error.message : "同步 popup 数据失败。";
    });
  }
});

Promise.all([loadPageInfo(), loadSettings()]).catch((error) => {
  status.textContent = error instanceof Error ? error.message : "初始化 popup 失败。";
});
