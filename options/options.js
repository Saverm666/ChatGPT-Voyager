const {
  FORMULA_COPY_FORMAT_LABELS,
  MARKDOWN_FORMULA_WRAP_LABELS,
  STORAGE_KEYS,
  DEFAULT_LOCAL_DATA,
  normalizeFormulaCopyFormat,
  normalizeMarkdownFormulaWrapMode,
  createItemId,
  clampFormulaHistoryItems,
  renderFormulaPreview,
  truncateText,
  formatTimestamp,
  copyTextToClipboard,
  saveFormulaHistoryEntry
} = globalThis.ChatGPTVoyagerShared;

const settingsForm = document.getElementById("settings-form");
const formulaCopierInput = document.getElementById("formula-copier-enabled");
const formulaCopyFormatInputs = document.querySelectorAll(
  'input[name="formulaCopyFormat"]'
);
const markdownFormulaWrapModeInputs = document.querySelectorAll(
  'input[name="markdownFormulaWrapMode"]'
);
const enterEnhancerInput = document.getElementById("enter-enhancer-enabled");
const chatgptTimelineInput = document.getElementById("chatgpt-timeline-enabled");
const notionCloseGuardInput = document.getElementById(
  "notion-close-guard-enabled"
);
const saveStatus = document.getElementById("save-status");
const formulaHistoryList = document.getElementById("formula-history-list");
const formulaHistoryEmpty = document.getElementById("formula-history-empty");
const clearFormulaHistoryButton = document.getElementById("clear-formula-history");
const promptForm = document.getElementById("prompt-form");
const promptEditIdInput = document.getElementById("prompt-edit-id");
const promptNameInput = document.getElementById("prompt-name");
const promptContentInput = document.getElementById("prompt-content");
const promptSubmitButton = document.getElementById("save-prompt-button");
const cancelPromptEditButton = document.getElementById("cancel-prompt-edit");
const promptStatus = document.getElementById("prompt-status");
const savedPromptsList = document.getElementById("saved-prompts-list");
const savedPromptsEmpty = document.getElementById("saved-prompts-empty");

let settingsStatusTimer = null;
let promptStatusTimer = null;
let draggedPromptId = "";

function getSelectedFormulaCopyFormat() {
  const checkedInput = document.querySelector(
    'input[name="formulaCopyFormat"]:checked'
  );

  return normalizeFormulaCopyFormat(checkedInput?.value);
}

function getSelectedMarkdownFormulaWrapMode() {
  const checkedInput = document.querySelector(
    'input[name="markdownFormulaWrapMode"]:checked'
  );

  return normalizeMarkdownFormulaWrapMode(checkedInput?.value);
}

function getFormulaCopyFormatLabel(value) {
  return FORMULA_COPY_FORMAT_LABELS[normalizeFormulaCopyFormat(value)];
}

function getMarkdownFormulaWrapModeLabel(value) {
  return MARKDOWN_FORMULA_WRAP_LABELS[normalizeMarkdownFormulaWrapMode(value)];
}

function getHistorySummary(entry) {
  const formatLabel = getFormulaCopyFormatLabel(entry.format);
  const timeLabel = formatTimestamp(entry.copiedAt) || "刚刚复制";
  return `${formatLabel} · ${timeLabel}`;
}

function setTransientStatus(element, timerKey, message) {
  element.textContent = message;

  if (timerKey === "settings") {
    if (settingsStatusTimer) {
      window.clearTimeout(settingsStatusTimer);
    }

    settingsStatusTimer = window.setTimeout(() => {
      element.textContent = "";
      settingsStatusTimer = null;
    }, 2200);

    return;
  }

  if (promptStatusTimer) {
    window.clearTimeout(promptStatusTimer);
  }

  promptStatusTimer = window.setTimeout(() => {
    element.textContent = "";
    promptStatusTimer = null;
  }, 2600);
}

function normalizePromptList(prompts) {
  return Array.isArray(prompts) ? prompts : [];
}

function sortPrompts(prompts) {
  return [...normalizePromptList(prompts)].sort((a, b) => {
    const pinnedDiff = Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned));
    return pinnedDiff;
  });
}

function createPinIcon() {
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.classList.add("prompt-pin-icon");
  icon.textContent = "\u{1F4CC}\uFE0E";
  return icon;
}

function normalizeFormulaHistory(history) {
  return Array.isArray(history) ? history : [];
}

function resetPromptForm() {
  promptForm.reset();
  promptEditIdInput.value = "";
  promptSubmitButton.textContent = "保存提示词";
  cancelPromptEditButton.hidden = true;
}

function startPromptEdit(prompt) {
  promptEditIdInput.value = prompt.id || "";
  promptNameInput.value = prompt.name || "";
  promptContentInput.value = prompt.content || "";
  promptSubmitButton.textContent = "更新提示词";
  cancelPromptEditButton.hidden = false;
  promptNameInput.focus();
}

function renderSavedPrompts(prompts) {
  const items = sortPrompts(prompts);
  savedPromptsList.textContent = "";
  savedPromptsEmpty.hidden = items.length > 0;

  items.forEach((prompt) => {
    const card = document.createElement("article");
    card.className = "prompt-card";
    card.dataset.id = prompt.id;
    card.draggable = !prompt.pinned;
    if (!prompt.pinned) {
      card.classList.add("prompt-card-draggable");
    }

    const head = document.createElement("div");
    head.className = "prompt-card-head";

    const titleWrap = document.createElement("div");

    const title = document.createElement("h3");
    title.className = "prompt-card-title";
    if (prompt.pinned) {
      const pinIcon = document.createElement("span");
      pinIcon.className = "prompt-card-pin";
      pinIcon.setAttribute("aria-hidden", "true");
      pinIcon.appendChild(createPinIcon());
      title.appendChild(pinIcon);
    }
    title.appendChild(document.createTextNode(prompt.name || "未命名提示词"));

    const time = document.createElement("p");
    time.className = "prompt-card-time";
    time.textContent = prompt.updatedAt
      ? `最近更新：${formatTimestamp(prompt.updatedAt)}`
      : "最近更新：刚刚";

    titleWrap.appendChild(title);
    titleWrap.appendChild(time);

    const actions = document.createElement("div");
    actions.className = "prompt-card-actions";

    [
      ["copy", "复制"],
      [prompt.pinned ? "unpin" : "pin", prompt.pinned ? "取消置顶" : "置顶"],
      ["edit", "编辑"],
      ["delete", "删除"]
    ].forEach(([action, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        action === "delete" ? "tiny-button danger-button" : "tiny-button";
      button.dataset.action = action;
      button.dataset.id = prompt.id;
      button.textContent = label;
      actions.appendChild(button);
    });

    head.appendChild(titleWrap);
    head.appendChild(actions);

    const preview = document.createElement("p");
    preview.className = "prompt-card-preview";
    preview.textContent = truncateText(prompt.content, 180) || "提示词内容为空";

    card.appendChild(head);
    card.appendChild(preview);
    savedPromptsList.appendChild(card);
  });
}

function renderFormulaHistory(history) {
  const items = clampFormulaHistoryItems(normalizeFormulaHistory(history));
  formulaHistoryList.textContent = "";
  formulaHistoryEmpty.hidden = items.length > 0;
  clearFormulaHistoryButton.hidden = items.length === 0;

  items.forEach((entry) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "history-card";

    const preview = document.createElement("div");
    preview.className = "history-card-expression";
    renderFormulaPreview(preview, entry, {
      fallbackText: "未识别公式"
    });

    const summary = document.createElement("p");
    summary.className = "history-card-summary";
    summary.textContent = getHistorySummary(entry);

    item.appendChild(preview);
    item.appendChild(summary);
    item.addEventListener("click", () => {
      copyFormulaHistoryEntry(entry).catch((error) => {
        saveStatus.textContent =
          error instanceof Error ? error.message : "复制历史公式失败。";
      });
    });

    formulaHistoryList.appendChild(item);
  });
}

async function getSavedPrompts() {
  const stored = await chrome.storage.local.get({
    [STORAGE_KEYS.SAVED_PROMPTS]: []
  });

  return normalizePromptList(stored[STORAGE_KEYS.SAVED_PROMPTS]);
}

async function persistPrompts(prompts, message) {
  const nextPrompts = sortPrompts(prompts);
  await chrome.storage.local.set({
    [STORAGE_KEYS.SAVED_PROMPTS]: nextPrompts
  });
  renderSavedPrompts(nextPrompts);
  setTransientStatus(promptStatus, "prompt", message);
}

function reorderNonPinnedPrompts(prompts, sourceId, targetId) {
  const sorted = sortPrompts(prompts);
  const pinned = sorted.filter((prompt) => prompt.pinned);
  const nonPinned = sorted.filter((prompt) => !prompt.pinned);
  const fromIndex = nonPinned.findIndex((prompt) => prompt.id === sourceId);
  const toIndex = nonPinned.findIndex((prompt) => prompt.id === targetId);

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return sorted;
  }

  const [moved] = nonPinned.splice(fromIndex, 1);
  nonPinned.splice(toIndex, 0, moved);
  return [...pinned, ...nonPinned];
}

async function copyFormulaHistoryEntry(entry) {
  const text = String(entry.latexSource || entry.text || "").trim();

  if (!text) {
    saveStatus.textContent = "该历史记录没有可复制内容。";
    return;
  }

  await copyTextToClipboard(text);
  setTransientStatus(
    saveStatus,
    "settings",
    "公式源码已复制。"
  );

  try {
    await saveFormulaHistoryEntry({
      ...entry,
      copiedAt: Date.now()
    });
  } catch (error) {
    console.warn("[ChatGPT-Voyager] 更新设置页历史失败。", error);
  }
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_LOCAL_DATA);
  const history = clampFormulaHistoryItems(settings[STORAGE_KEYS.FORMULA_HISTORY]);
  formulaCopierInput.checked = Boolean(settings.formulaCopierEnabled);

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

  enterEnhancerInput.checked = Boolean(settings.enterEnhancerEnabled);
  chatgptTimelineInput.checked = Boolean(settings.chatgptTimelineEnabled);
  notionCloseGuardInput.checked = Boolean(settings.notionCloseGuardEnabled);
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

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formulaCopyFormat = getSelectedFormulaCopyFormat();
  const markdownFormulaWrapMode = getSelectedMarkdownFormulaWrapMode();

  await chrome.storage.local.set({
    formulaCopierEnabled: formulaCopierInput.checked,
    formulaCopyFormat,
    markdownFormulaWrapMode,
    enterEnhancerEnabled: enterEnhancerInput.checked,
    chatgptTimelineEnabled: chatgptTimelineInput.checked,
    notionCloseGuardEnabled: notionCloseGuardInput.checked
  });

  setTransientStatus(
    saveStatus,
    "settings",
    `设置已保存。点击公式：${FORMULA_COPY_FORMAT_LABELS[formulaCopyFormat]}；成段复制：${getMarkdownFormulaWrapModeLabel(markdownFormulaWrapMode)}。`
  );
});

promptForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = promptNameInput.value.trim();
  const content = promptContentInput.value.trim();

  if (!name) {
    promptStatus.textContent = "请先填写提示词名称。";
    promptNameInput.focus();
    return;
  }

  if (!content) {
    promptStatus.textContent = "请先填写提示词内容。";
    promptContentInput.focus();
    return;
  }

  const editingId = promptEditIdInput.value;
  const prompts = await getSavedPrompts();
  const nextPrompt = {
    id: editingId || createItemId("prompt"),
    name,
    content,
    updatedAt: Date.now()
  };
  const nextPrompts = [
    nextPrompt,
    ...prompts.filter((prompt) => prompt.id !== editingId)
  ];

  await persistPrompts(nextPrompts, `提示词「${name}」已保存。`);
  resetPromptForm();
});

cancelPromptEditButton.addEventListener("click", () => {
  resetPromptForm();
  setTransientStatus(promptStatus, "prompt", "已取消编辑。");
});

clearFormulaHistoryButton.addEventListener("click", async () => {
  const confirmed = window.confirm("确认清空所有公式复制历史吗？");

  if (!confirmed) {
    return;
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.FORMULA_HISTORY]: []
  });
  setTransientStatus(saveStatus, "settings", "公式复制历史已清空。");
});

savedPromptsList.addEventListener("click", async (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const actionButton = target.closest("button[data-action]");

  if (!(actionButton instanceof HTMLButtonElement)) {
    return;
  }

  const promptId = actionButton.dataset.id;
  const action = actionButton.dataset.action;
  const prompts = await getSavedPrompts();
  const currentPrompt = prompts.find((prompt) => prompt.id === promptId);

  if (!currentPrompt) {
    promptStatus.textContent = "没有找到对应的提示词。";
    return;
  }

  if (action === "copy") {
    await copyTextToClipboard(currentPrompt.content);
    setTransientStatus(
      promptStatus,
      "prompt",
      `提示词「${currentPrompt.name}」已复制到剪切板。`
    );
    return;
  }

  if (action === "edit") {
    startPromptEdit(currentPrompt);
    promptStatus.textContent = `正在编辑「${currentPrompt.name}」。`;
    return;
  }

  if (action === "pin" || action === "unpin") {
    const nextPrompts = prompts.map((prompt) =>
      prompt.id === promptId
        ? {
            ...prompt,
            pinned: action === "pin"
          }
        : prompt
    );
    await persistPrompts(
      nextPrompts,
      `提示词「${currentPrompt.name}」${action === "pin" ? "已置顶" : "已取消置顶"}。`
    );
    return;
  }

  if (action === "delete") {
    const confirmed = window.confirm(`确认删除提示词「${currentPrompt.name}」吗？`);

    if (!confirmed) {
      return;
    }

    const nextPrompts = prompts.filter((prompt) => prompt.id !== promptId);
    await persistPrompts(nextPrompts, `提示词「${currentPrompt.name}」已删除。`);

    if (promptEditIdInput.value === promptId) {
      resetPromptForm();
    }
  }
});

savedPromptsList.addEventListener("dragstart", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const card = target.closest(".prompt-card-draggable");
  if (!(card instanceof HTMLElement)) {
    return;
  }

  draggedPromptId = card.dataset.id || "";
  card.classList.add("is-dragging");
  event.dataTransfer?.setData("text/plain", draggedPromptId);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
  }
});

savedPromptsList.addEventListener("dragend", (event) => {
  const target = event.target;
  if (target instanceof HTMLElement) {
    target.closest(".prompt-card")?.classList.remove("is-dragging");
  }
});

savedPromptsList.addEventListener("dragover", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const card = target.closest(".prompt-card-draggable");
  if (!(card instanceof HTMLElement)) {
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
});

savedPromptsList.addEventListener("drop", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const card = target.closest(".prompt-card-draggable");
  if (!(card instanceof HTMLElement)) {
    return;
  }

  event.preventDefault();
  const targetId = card.dataset.id || "";
  const sourceId = draggedPromptId || event.dataTransfer?.getData("text/plain") || "";
  draggedPromptId = "";

  if (!sourceId || !targetId || sourceId === targetId) {
    return;
  }

  const prompts = await getSavedPrompts();
  const nextPrompts = reorderNonPinnedPrompts(prompts, sourceId, targetId);
  await persistPrompts(nextPrompts, "提示词顺序已更新。");
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
      saveStatus.textContent =
        error instanceof Error ? error.message : "同步设置页数据失败。";
    });
  }
});

loadSettings().catch((error) => {
  saveStatus.textContent = error instanceof Error ? error.message : "加载设置失败。";
});
