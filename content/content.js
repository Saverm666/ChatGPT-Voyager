const SCRIPT_NAME = "ChatGPTVoyagerExtension";
const {
  FORMULA_COPY_FORMATS,
  FORMULA_COPY_FORMAT_LABELS,
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  createItemId,
  normalizeFormulaCopyFormat,
  clampFormulaHistoryItems,
  renderFormulaPreview,
  truncateText,
  formatTimestamp,
  copyTextToClipboard,
  saveFormulaHistoryEntry
} = globalThis.ChatGPTVoyagerShared;
const DEFAULT_FORMULA_COPY_FORMAT = DEFAULT_SETTINGS.formulaCopyFormat;
let extensionContextAvailable = true;
let handleExtensionContextInvalidated = null;

const currentHostname = window.location.hostname;
const isChatGPTPage =
  currentHostname.includes("chatgpt.com") ||
  currentHostname.includes("chat.openai.com");
const isNotionPage =
  currentHostname === "notion.so" ||
  currentHostname === "www.notion.so" ||
  currentHostname.endsWith(".notion.so") ||
  currentHostname.endsWith(".notion.site");

function isExtensionContextInvalidatedError(error) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";

  return message.includes("Extension context invalidated");
}

function markExtensionContextInvalidated(error) {
  if (!isExtensionContextInvalidatedError(error) || !extensionContextAvailable) {
    return;
  }

  extensionContextAvailable = false;

  if (typeof handleExtensionContextInvalidated === "function") {
    handleExtensionContextInvalidated();
  }
}

async function readLocalStorage(defaultValues) {
  if (!extensionContextAvailable) {
    return defaultValues;
  }

  try {
    return await chrome.storage.local.get(defaultValues);
  } catch (error) {
    markExtensionContextInvalidated(error);
    return defaultValues;
  }
}

async function writeLocalStorage(nextValues) {
  if (!extensionContextAvailable) {
    throw new Error("扩展上下文已失效，请刷新页面。");
  }

  try {
    await chrome.storage.local.set(nextValues);
  } catch (error) {
    markExtensionContextInvalidated(error);
    throw error;
  }
}

async function sendRuntimeMessage(message) {
  if (!extensionContextAvailable) {
    return {
      ok: false,
      error: "扩展上下文已失效，请刷新页面。"
    };
  }

  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    markExtensionContextInvalidated(error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "扩展通信失败。"
    };
  }
}

function reportScriptError(message, error) {
  if (isExtensionContextInvalidatedError(error)) {
    return;
  }

  console.error(message, error);
}

const formulaCopierModule = (() => {
  let enabled = false;
  let copyFormat = DEFAULT_FORMULA_COPY_FORMAT;
  let selectedElement = null;
  let hoveredElement = null;
  let selectionFlashTimer = null;

  function clearSelection() {
    if (selectionFlashTimer) {
      window.clearTimeout(selectionFlashTimer);
      selectionFlashTimer = null;
    }

    if (selectedElement) {
      selectedElement.classList.remove("formula-copier-selected");
      selectedElement = null;
    }
  }

  function clearHover() {
    if (hoveredElement) {
      hoveredElement.classList.remove("formula-copier-hover");
      hoveredElement = null;
    }
  }

  function updateHover(target) {
    if (hoveredElement === target) {
      return;
    }

    clearHover();

    if (!target || target === selectedElement) {
      return;
    }

    hoveredElement = target;
    hoveredElement.classList.add("formula-copier-hover");
  }

  function flashSelection(target) {
    clearSelection();
    updateHover(null);

    selectedElement = target;
    selectedElement.classList.add("formula-copier-selected");

    selectionFlashTimer = window.setTimeout(() => {
      if (selectedElement === target) {
        selectedElement.classList.remove("formula-copier-selected");
        selectedElement = null;
      }

      if (target.isConnected && target.matches(":hover")) {
        updateHover(target);
      }

      selectionFlashTimer = null;
    }, 220);
  }

  function clearFeedback() {
    document
      .querySelectorAll(".formula-copier-feedback")
      .forEach((element) => element.remove());
  }

  function showCopyFeedback(element, message) {
    const rect = element.getBoundingClientRect();
    const feedback = document.createElement("div");
    feedback.textContent = message;
    feedback.className = "formula-copier-feedback";

    const parent = document.body || document.documentElement;
    parent.appendChild(feedback);

    feedback.style.left = `${rect.left + rect.width / 2 - feedback.offsetWidth / 2}px`;
    feedback.style.top = `${Math.max(rect.top - feedback.offsetHeight - 8, 12)}px`;

    window.requestAnimationFrame(() => {
      feedback.classList.add("visible");
    });

    window.setTimeout(() => {
      feedback.classList.remove("visible");
      window.setTimeout(() => feedback.remove(), 300);
    }, 1500);
  }

  function getLatexSource(containerElement) {
    const annotation = containerElement.querySelector(
      'annotation[encoding="application/x-tex"], annotation[encoding="text/x-latex"]'
    );

    if (annotation) {
      return annotation.textContent.trim().replace(/\s*\\tag\{.*\}/, "").trim();
    }

    let currentElement = containerElement;

    while (currentElement) {
      const root = currentElement.getRootNode();

      if (root instanceof ShadowRoot) {
        const host = root.host;

        if (
          host &&
          host.tagName === "CIB-MATH" &&
          host.hasAttribute("raw")
        ) {
          return host.getAttribute("raw").trim();
        }

        currentElement = host;
      } else {
        currentElement = null;
      }
    }

    const mathElement = containerElement.querySelector("math, [role='math']");

    if (mathElement) {
      for (const child of mathElement.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE) {
          continue;
        }

        const latex = child.textContent.trim();

        if (
          latex.length > 1 &&
          (latex.includes("\\") ||
            latex.includes("^") ||
            latex.includes("_") ||
            latex.includes("{"))
        ) {
          return latex;
        }
      }
    }

    return null;
  }

  function canConvertLatexToUnicodeMath() {
    return (
      typeof texToUnicodeMath !== "undefined" &&
      typeof texToUnicodeMath.convertLatexToUnicodeMath === "function"
    );
  }

  function convertLatexToUnicodeMath(latex) {
    if (!canConvertLatexToUnicodeMath()) {
      console.warn(
        `[${SCRIPT_NAME}] UnicodeMath 转换器未成功加载，无法将 LaTeX 转为 UnicodeMath。`
      );
      return null;
    }

    try {
      const unicodeMath = texToUnicodeMath.convertLatexToUnicodeMath(latex);
      return typeof unicodeMath === "string" ? unicodeMath.trim() || null : null;
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] LaTeX 转 UnicodeMath 失败。`, {
        latex,
        error
      });
      return null;
    }
  }

  function getCopyPayload(target) {
    if (copyFormat === FORMULA_COPY_FORMATS.UNICODE_MATH) {
      const latex = getLatexSource(target);

      if (!latex) {
        return {
          errorMessage: "未识别到 LaTeX"
        };
      }

      const unicodeMath = convertLatexToUnicodeMath(latex);

      if (!unicodeMath) {
        return {
          errorMessage: "LaTeX 转 UnicodeMath 失败"
        };
      }

      return {
        text: unicodeMath,
        latexSource: latex,
        successMessage: "UnicodeMath 已复制"
      };
    }

    const latex = getLatexSource(target);

    if (!latex) {
      return {
        errorMessage: "未识别到 LaTeX"
      };
    }

    if (copyFormat === FORMULA_COPY_FORMATS.LATEX_INLINE) {
      return {
        text: `$${latex}$`,
        latexSource: latex,
        successMessage: "LaTeX（含 $）已复制"
      };
    }

    return {
      text: latex,
      latexSource: latex,
      successMessage: "LaTeX 已复制"
    };
  }

  async function processFormulaClick(target) {
    flashSelection(target);

    const copyPayload = getCopyPayload(target);

    if (copyPayload.text) {
      await copyTextToClipboard(copyPayload.text);

      try {
        await saveFormulaHistoryEntry({
          text: copyPayload.text,
          latexSource: copyPayload.latexSource,
          format: copyFormat,
          copiedAt: Date.now(),
          sourceTitle: document.title,
          sourceUrl: window.location.href
        });
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] 公式历史保存失败。`, error);
      }

      showCopyFeedback(target, copyPayload.successMessage);
    } else {
      showCopyFeedback(target, copyPayload.errorMessage);
      console.warn(
        `[${SCRIPT_NAME}] 未能从元素中提取公式内容。`,
        {
          copyFormat,
          target
        }
      );
    }
  }

  function findFormulaElement(path) {
    for (const item of path) {
      if (!(item instanceof Element)) {
        continue;
      }

      if (
        item.classList.contains("katex") ||
        item.classList.contains("katex-display") ||
        item.classList.contains("mjx-container")
      ) {
        return item;
      }
    }

    return null;
  }

  function onDocumentClick(event) {
    const formulaElement = findFormulaElement(event.composedPath());

    if (!formulaElement) {
      clearSelection();
      clearHover();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    processFormulaClick(formulaElement).catch((error) => {
      console.error(`[${SCRIPT_NAME}] 公式复制失败。`, error);
      clearSelection();
    });
  }

  function onDocumentMouseMove(event) {
    updateHover(findFormulaElement(event.composedPath()));
  }

  function onDocumentMouseOut(event) {
    if (!event.relatedTarget) {
      clearHover();
    }
  }

  return {
    setCopyFormat(nextCopyFormat) {
      copyFormat = normalizeFormulaCopyFormat(nextCopyFormat);
    },

    enable() {
      if (enabled || !isChatGPTPage) {
        return;
      }

      document.addEventListener("click", onDocumentClick, true);
      document.addEventListener("mousemove", onDocumentMouseMove, true);
      document.addEventListener("mouseout", onDocumentMouseOut, true);
      enabled = true;
      console.log(`[${SCRIPT_NAME}] 公式复制功能已开启。`);
    },

    disable() {
      if (!enabled) {
        return;
      }

      document.removeEventListener("click", onDocumentClick, true);
      document.removeEventListener("mousemove", onDocumentMouseMove, true);
      document.removeEventListener("mouseout", onDocumentMouseOut, true);
      clearSelection();
      clearHover();
      clearFeedback();
      enabled = false;
      console.log(`[${SCRIPT_NAME}] 公式复制功能已关闭。`);
    }
  };
})();

const enterEnhancerModule = (() => {
  let enabled = false;
  let observer = null;
  const attachedElements = new Set();

  function createKeyEvent(type, options) {
    const event = new KeyboardEvent(type, {
      key: options.key || "Enter",
      code: options.code || "Enter",
      keyCode: options.keyCode || 13,
      which: options.which || 13,
      shiftKey: Boolean(options.shiftKey),
      ctrlKey: Boolean(options.ctrlKey),
      altKey: Boolean(options.altKey),
      metaKey: Boolean(options.metaKey),
      bubbles: true,
      cancelable: true
    });

    Object.defineProperty(event, "isTriggeredByScript", {
      value: true,
      writable: false
    });

    return event;
  }

  function simulateAdvancedEnter(target) {
    if (!(target instanceof HTMLElement)) {
      return;
    }

    target.focus();

    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertLineBreak",
      data: null
    });

    target.dispatchEvent(beforeInput);

    if (!beforeInput.defaultPrevented) {
      target.dispatchEvent(createKeyEvent("keydown", {}));
      const inputEvent = new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertLineBreak"
      });
      target.dispatchEvent(inputEvent);
      target.dispatchEvent(createKeyEvent("keyup", {}));
    }
  }

  function findSendButton() {
    if (isChatGPTPage) {
      return document.querySelector('button[data-testid="send-button"]');
    }

    return null;
  }

  function handleKeyDown(event) {
    if (event.isTriggeredByScript) {
      return;
    }

    if (
      event.key !== "Enter" ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    if (event.ctrlKey) {
      event.preventDefault();
      event.stopImmediatePropagation();

      const sendButton = findSendButton();

      if (sendButton && !sendButton.disabled) {
        sendButton.click();
        return;
      }

      if (event.target instanceof HTMLElement) {
        simulateAdvancedEnter(event.target);
      }

      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.target instanceof EventTarget) {
      event.target.dispatchEvent(
        createKeyEvent("keydown", { key: "Enter", shiftKey: true })
      );
    }
  }

  function blockEnterPropagation(event) {
    if (event.isTriggeredByScript) {
      return;
    }

    if (
      event.key === "Enter" &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function isEditableElement(element) {
    return element.matches(
      'textarea, div[contenteditable="true"], [contenteditable="plaintext-only"]'
    );
  }

  function isElementVisible(element) {
    return element.getClientRects().length > 0;
  }

  function attachInterceptor(element) {
    if (!isEditableElement(element) || attachedElements.has(element)) {
      return;
    }

    if (!isElementVisible(element)) {
      return;
    }

    element.addEventListener("keydown", handleKeyDown, true);
    element.addEventListener("keypress", blockEnterPropagation, true);
    element.addEventListener("keyup", blockEnterPropagation, true);
    attachedElements.add(element);
  }

  function detachInterceptor(element) {
    if (!attachedElements.has(element)) {
      return;
    }

    element.removeEventListener("keydown", handleKeyDown, true);
    element.removeEventListener("keypress", blockEnterPropagation, true);
    element.removeEventListener("keyup", blockEnterPropagation, true);
    attachedElements.delete(element);
  }

  function scanForInputs(root) {
    if (!(root instanceof Element)) {
      return;
    }

    if (isEditableElement(root)) {
      attachInterceptor(root);
    }

    root
      .querySelectorAll(
        'textarea, div[contenteditable="true"], [contenteditable="plaintext-only"]'
      )
      .forEach((element) => attachInterceptor(element));
  }

  function ensureObserver() {
    if (observer) {
      return;
    }

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => scanForInputs(node));
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function initWhenReady() {
    if (!enabled) {
      return;
    }

    if (!document.body) {
      window.setTimeout(initWhenReady, 100);
      return;
    }

    document
      .querySelectorAll(
        'textarea, div[contenteditable="true"], [contenteditable="plaintext-only"]'
      )
      .forEach((element) => attachInterceptor(element));

    ensureObserver();
  }

  return {
    enable() {
      if (enabled || !isChatGPTPage) {
        return;
      }

      enabled = true;
      initWhenReady();
      console.log(`[${SCRIPT_NAME}] Enter 增强功能已开启。`);
    },

    disable() {
      if (!enabled) {
        return;
      }

      enabled = false;

      if (observer) {
        observer.disconnect();
        observer = null;
      }

      Array.from(attachedElements).forEach((element) => detachInterceptor(element));
      console.log(`[${SCRIPT_NAME}] Enter 增强功能已关闭。`);
    }
  };
})();

const notionCloseGuardModule = (() => {
  let enabled = false;

  function onBeforeUnload(event) {
    if (!enabled) {
      return;
    }

    event.preventDefault();
    event.returnValue = true;
  }

  return {
    enable() {
      if (enabled || !isNotionPage) {
        return;
      }

      enabled = true;
      window.addEventListener("beforeunload", onBeforeUnload);
      console.log(`[${SCRIPT_NAME}] Notion 离开确认已开启。`);
    },

    disable() {
      if (!enabled) {
        return;
      }

      enabled = false;
      window.removeEventListener("beforeunload", onBeforeUnload);
      console.log(`[${SCRIPT_NAME}] Notion 离开确认已关闭。`);
    }
  };
})();

const chatgptHeaderEntryModule = (() => {
  let enabled = false;
  let root = null;
  let button = null;
  let panel = null;
  let promptsContainer = null;
  let historyContainer = null;
  let promptEditorOverlay = null;
  let promptEditorDialog = null;
  let promptEditorForm = null;
  let promptEditorNameInput = null;
  let promptEditorContentInput = null;
  let promptEditorHeading = null;
  let promptEditorSaveButton = null;
  let promptEditorDeleteButton = null;
  let statusElement = null;
  let mountObserver = null;
  let mountFrame = null;
  let statusTimer = null;
  let panelOpen = false;
  let editingPromptId = "";
  let cachedPrompts = [];
  let cachedHistory = [];
  let normalizedPromptSeed = 0;
  let normalizedHistorySeed = 0;

  function setStatus(message) {
    if (!statusElement) {
      return;
    }

    statusElement.textContent = message;

    if (statusTimer) {
      window.clearTimeout(statusTimer);
    }

    if (!message) {
      statusTimer = null;
      return;
    }

    statusTimer = window.setTimeout(() => {
      if (statusElement) {
        statusElement.textContent = "";
      }

      statusTimer = null;
    }, 2200);
  }

  function getFormatLabel(format) {
    return FORMULA_COPY_FORMAT_LABELS[normalizeFormulaCopyFormat(format)];
  }

  function getHistorySummary(entry) {
    const formatLabel = getFormatLabel(entry.format);
    const timeLabel = formatTimestamp(entry.copiedAt) || "刚刚复制";
    return `${formatLabel} · ${timeLabel}`;
  }

  function normalizePromptEntry(entry) {
    if (typeof entry === "string") {
      normalizedPromptSeed += 1;

      return {
        id: `legacy-prompt-${normalizedPromptSeed}`,
        name: `提示词 ${normalizedPromptSeed}`,
        content: entry,
        updatedAt: 0
      };
    }

    if (!entry || typeof entry !== "object") {
      return null;
    }

    normalizedPromptSeed += 1;

    return {
      id:
        typeof entry.id === "string" && entry.id
          ? entry.id
          : `prompt-${normalizedPromptSeed}`,
      name:
        typeof entry.name === "string" && entry.name.trim()
          ? entry.name.trim()
          : "未命名提示词",
      content:
        typeof entry.content === "string"
          ? entry.content
          : String(entry.content || ""),
      updatedAt:
        typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
          ? entry.updatedAt
          : 0
    };
  }

  function normalizeHistoryEntry(entry) {
    if (typeof entry === "string") {
      normalizedHistorySeed += 1;

      return {
        id: `legacy-formula-${normalizedHistorySeed}`,
        text: entry,
        latexSource: entry,
        format: DEFAULT_FORMULA_COPY_FORMAT,
        copiedAt: 0
      };
    }

    if (!entry || typeof entry !== "object") {
      return null;
    }

    normalizedHistorySeed += 1;
    const text =
      typeof entry.text === "string"
        ? entry.text
        : typeof entry.latexSource === "string"
          ? entry.latexSource
          : String(entry.text || entry.latexSource || "");
    const latexSource =
      typeof entry.latexSource === "string" && entry.latexSource
        ? entry.latexSource
        : text;

    return {
      id:
        typeof entry.id === "string" && entry.id
          ? entry.id
          : `formula-${normalizedHistorySeed}`,
      text,
      latexSource,
      format: normalizeFormulaCopyFormat(entry.format),
      copiedAt:
        typeof entry.copiedAt === "number" && Number.isFinite(entry.copiedAt)
          ? entry.copiedAt
          : 0
    };
  }

  function resetPromptEditor() {
    editingPromptId = "";

    if (promptEditorForm) {
      promptEditorForm.reset();
    }

    if (promptEditorOverlay) {
      promptEditorOverlay.hidden = true;
    }

    if (promptEditorHeading) {
      promptEditorHeading.textContent = "编辑提示词";
    }

    if (promptEditorSaveButton) {
      promptEditorSaveButton.textContent = "保存";
    }

    if (promptEditorDeleteButton) {
      promptEditorDeleteButton.hidden = true;
    }
  }

  function startPromptEdit(prompt) {
    if (
      !promptEditorForm ||
      !promptEditorNameInput ||
      !promptEditorContentInput ||
      !promptEditorSaveButton ||
      !prompt
    ) {
      return;
    }

    editingPromptId = prompt.id || "";
    promptEditorHeading.textContent = `正在编辑「${prompt.name || "未命名提示词"}」`;
    promptEditorSaveButton.textContent = "保存";
    if (promptEditorDeleteButton) {
      promptEditorDeleteButton.hidden = false;
    }
    promptEditorNameInput.value = prompt.name || "";
    promptEditorContentInput.value = prompt.content || "";
    promptEditorOverlay.hidden = false;
    promptEditorNameInput.focus();
    promptEditorNameInput.select();
    setStatus(`已进入「${prompt.name || "未命名提示词"}」编辑模式。`);
  }

  function startPromptCreate() {
    if (
      !promptEditorForm ||
      !promptEditorNameInput ||
      !promptEditorContentInput ||
      !promptEditorHeading ||
      !promptEditorSaveButton ||
      !promptEditorOverlay
    ) {
      return;
    }

    editingPromptId = "";
    promptEditorForm.reset();
    promptEditorHeading.textContent = "新建提示词";
    promptEditorSaveButton.textContent = "新建";
    if (promptEditorDeleteButton) {
      promptEditorDeleteButton.hidden = true;
    }
    promptEditorOverlay.hidden = false;
    promptEditorNameInput.focus();
    setStatus("已打开新建提示词面板。");
  }

  async function getStoredPrompts() {
    const stored = await readLocalStorage({
      [STORAGE_KEYS.SAVED_PROMPTS]: []
    });

    return Array.isArray(stored[STORAGE_KEYS.SAVED_PROMPTS])
      ? stored[STORAGE_KEYS.SAVED_PROMPTS]
          .map((entry) => normalizePromptEntry(entry))
          .filter(Boolean)
      : [];
  }

  async function persistPromptList(prompts, message) {
    await writeLocalStorage({
      [STORAGE_KEYS.SAVED_PROMPTS]: prompts
    });

    normalizedPromptSeed = 0;
    cachedPrompts = Array.isArray(prompts)
      ? prompts.map((entry) => normalizePromptEntry(entry)).filter(Boolean)
      : [];
    renderPromptList();
    setStatus(message);
  }

  function isManagedElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    return Boolean(
      (root && root.contains(element)) ||
      (panel && panel.contains(element)) ||
      (promptEditorOverlay && promptEditorOverlay.contains(element))
    );
  }

  function isInteractiveElement(element) {
    return (
      element instanceof Element &&
      element.matches(
        "button, a[href], summary, [role='button'], [role='link'], [data-testid]"
      )
    );
  }

  function isElementVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cleanupStaleUi() {
    document
      .querySelectorAll(".voyager-gpt-entry-root, .voyager-gpt-panel")
      .forEach((element) => {
        if (element !== root && element !== panel) {
          element.remove();
        }
      });
  }

  function findConversationHeaderActionsContainer() {
    const actionContainer = document.querySelector("#conversation-header-actions");

    if (
      actionContainer instanceof Element &&
      !isManagedElement(actionContainer) &&
      isElementVisible(actionContainer)
    ) {
      return actionContainer;
    }

    return null;
  }

  function findHeaderAnchor() {
    const headings = Array.from(
      document.querySelectorAll("main h1, header h1")
    )
      .filter((element) => {
        if (isManagedElement(element)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < 180;
      })
      .sort((left, right) => {
        return left.getBoundingClientRect().top - right.getBoundingClientRect().top;
      });

    if (headings.length > 0) {
      return headings[0];
    }

    const topButtons = Array.from(
      document.querySelectorAll("main button, header button")
    )
      .filter((element) => {
        if (isManagedElement(element)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const text = element.textContent.trim();
        return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < 180 && text;
      })
      .sort((left, right) => {
        return left.getBoundingClientRect().top - right.getBoundingClientRect().top;
      });

    return topButtons.find((element) => /chatgpt|gpt/i.test(element.textContent)) || null;
  }

  function findTopRightActionAnchor() {
    const actionContainer = findConversationHeaderActionsContainer();

    if (
      actionContainer instanceof Element &&
      !isManagedElement(actionContainer) &&
      isElementVisible(actionContainer)
    ) {
      const explicitShareButton = actionContainer.querySelector(
        "button[aria-label*='分享'], button[aria-label*='Share'], button[data-testid='share-chat-button']"
      );

      if (
        explicitShareButton instanceof Element &&
        !isManagedElement(explicitShareButton) &&
        isElementVisible(explicitShareButton)
      ) {
        return explicitShareButton;
      }
    }

    const candidates = Array.from(
      document.querySelectorAll(
        "button, a[href], summary, [role='button'], [role='link']"
      )
    )
      .filter((element) => {
        if (isManagedElement(element) || !isElementVisible(element)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const text = element.textContent.trim();
        const label =
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          "";

        return (
          rect.top >= 0 &&
          rect.top < 180 &&
          (text || label)
        );
      })
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();

        if (leftRect.top !== rightRect.top) {
          return leftRect.top - rightRect.top;
        }

        return leftRect.left - rightRect.left;
      });

    const explicitShareButton = candidates.find((element) => {
      const text = element.textContent.trim();
      const label =
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        "";
      return /分享|share/i.test(`${text} ${label}`);
    });

    if (explicitShareButton) {
      return explicitShareButton;
    }

    const topRightCandidates = candidates
      .map((element) => {
        return {
          element,
          rect: element.getBoundingClientRect()
        };
      })
      .filter(({ rect }) => {
        return (
          rect.left > window.innerWidth * 0.58 &&
          rect.right > window.innerWidth * 0.72 &&
          rect.width >= 24 &&
          rect.height >= 24
        );
      });

    if (topRightCandidates.length === 0) {
      return null;
    }

    const topRow = Math.min(...topRightCandidates.map(({ rect }) => rect.top));
    const sameRowCandidates = topRightCandidates
      .filter(({ rect }) => Math.abs(rect.top - topRow) < 24)
      .sort((left, right) => left.rect.left - right.rect.left);

    if (sameRowCandidates.length > 0) {
      return sameRowCandidates[0].element;
    }

    return candidates.find((element) => {
        const text = element.textContent.trim();
        const label =
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
        "";
        return /分享|share/i.test(`${text} ${label}`);
      }) || null;
  }

  function findConversationHeaderRow() {
    const actionContainer = findConversationHeaderActionsContainer();
    const modelSwitcher = document.querySelector(
      "[data-testid='model-switcher-dropdown-button']"
    );

    if (
      !(actionContainer instanceof Element) ||
      isManagedElement(actionContainer) ||
      !isElementVisible(actionContainer)
    ) {
      return null;
    }

    if (
      modelSwitcher instanceof Element &&
      !isManagedElement(modelSwitcher) &&
      isElementVisible(modelSwitcher)
    ) {
      let current = actionContainer;

      while (current && current !== document.body) {
        const rect = current.getBoundingClientRect();

        if (
          current.contains(modelSwitcher) &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.top >= 0 &&
          rect.top < 180 &&
          rect.height <= 120
        ) {
          return current;
        }

        current = current.parentElement;
      }
    }

    const fallback = actionContainer.parentElement;
    return fallback instanceof Element && isElementVisible(fallback)
      ? fallback
      : actionContainer;
  }

  function positionRoot() {
    if (!root) {
      return;
    }

    const parent = document.body || document.documentElement;

    if (root.parentElement !== parent) {
      parent.appendChild(root);
    }

    const actionContainer = findConversationHeaderActionsContainer();
    const actionAnchor = findTopRightActionAnchor();
    const headerRow = findConversationHeaderRow();

    if (actionAnchor) {
      const actionRect = actionAnchor.getBoundingClientRect();
      const actionHeight = Math.max(32, Math.round(actionRect.height));
      root.style.setProperty("--voyager-gpt-entry-height", `${actionHeight}px`);
    } else {
      root.style.removeProperty("--voyager-gpt-entry-height");
    }

    root.classList.remove("voyager-gpt-entry-root-inline");

    const titleAnchor = findHeaderAnchor();
    const actionTarget = actionContainer || actionAnchor;
    const target = actionTarget || titleAnchor;
    const measuredRect = button?.getBoundingClientRect() || root.getBoundingClientRect();
    const rootWidth = Math.max(measuredRect.width || 0, 136);
    const rootHeight = Math.max(measuredRect.height || 0, 36);
    let top = 16;
    let left = Math.max(12, window.innerWidth - rootWidth - 160);

    if (target) {
      const rect = target.getBoundingClientRect();

      if (actionTarget) {
        const alignmentRect =
          actionAnchor?.getBoundingClientRect() ||
          actionContainer?.getBoundingClientRect() ||
          headerRow?.getBoundingClientRect() ||
          rect;
        top = Math.max(
          10,
          Math.min(
            window.innerHeight - rootHeight - 10,
            alignmentRect.top + (alignmentRect.height - rootHeight) / 2
          )
        );
        left = rect.left - rootWidth - 8;

        if (left < 12) {
          left = Math.max(12, window.innerWidth - rootWidth - 12);
        }
      } else {
        top = Math.max(
          10,
          Math.min(
            window.innerHeight - rootHeight - 10,
            rect.top + (rect.height - rootHeight) / 2
          )
        );
        left = rect.right + 12;

        if (left + rootWidth > window.innerWidth - 12) {
          left = Math.max(12, rect.left - rootWidth - 12);
        }
      }
    }

    root.style.top = `${Math.max(10, top)}px`;
    root.style.left = `${Math.max(12, Math.min(left, window.innerWidth - rootWidth - 12))}px`;
  }

  function ensureButton() {
    cleanupStaleUi();

    if (root) {
      return;
    }

    root = document.createElement("div");
    root.className = "voyager-gpt-entry-root";

    button = document.createElement("button");
    button.type = "button";
    button.className = "voyager-gpt-entry-button";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.classList.add("voyager-gpt-entry-icon");

    const iconPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    iconPath.setAttribute(
      "d",
      "M12 3.75l2.06 4.19 4.62.67-3.34 3.25.79 4.59L12 14.28l-4.13 2.17.79-4.59-3.34-3.25 4.62-.67L12 3.75z"
    );
    iconPath.setAttribute("fill", "none");
    iconPath.setAttribute("stroke", "currentColor");
    iconPath.setAttribute("stroke-linecap", "round");
    iconPath.setAttribute("stroke-linejoin", "round");
    iconPath.setAttribute("stroke-width", "1.9");
    icon.appendChild(iconPath);

    const label = document.createElement("span");
    label.className = "voyager-gpt-entry-label";
    label.textContent = "ChatGPT-Voyager";

    const content = document.createElement("span");
    content.className = "voyager-gpt-entry-content";
    content.appendChild(icon);
    content.appendChild(label);

    button.appendChild(content);
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (panelOpen) {
        closePanel();
        return;
      }

      openPanel();
    });

    root.appendChild(button);
  }

  function createSection(sectionKey, title, description) {
    const section = document.createElement("section");
    section.className = `voyager-gpt-panel-section voyager-gpt-panel-section-${sectionKey}`;

    const heading = document.createElement("div");
    heading.className = "voyager-gpt-panel-section-head";

    const titleRow = document.createElement("div");
    titleRow.className = "voyager-gpt-panel-title-row";

    const titleElement = document.createElement("p");
    titleElement.className = "voyager-gpt-panel-title";
    titleElement.textContent = title;

    const descElement = document.createElement("p");
    descElement.className = "voyager-gpt-panel-desc";
    descElement.textContent = description;

    titleRow.appendChild(titleElement);
    heading.appendChild(titleRow);
    heading.appendChild(descElement);
    section.appendChild(heading);

    const list = document.createElement("div");
    list.className = "voyager-gpt-panel-list";
    section.appendChild(list);

    return {
      section,
      list,
      heading,
      titleRow,
      titleElement,
      descElement
    };
  }

  function ensurePanel() {
    cleanupStaleUi();

    if (panel) {
      return;
    }

    panel = document.createElement("div");
    panel.className = "voyager-gpt-panel";
    panel.hidden = true;
    panel.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    const header = document.createElement("div");
    header.className = "voyager-gpt-panel-header";

    const titleWrap = document.createElement("div");
    const heading = document.createElement("p");
    heading.className = "voyager-gpt-panel-heading";
    heading.textContent = "ChatGPT-Voyager";

    const subHeading = document.createElement("p");
    subHeading.className = "voyager-gpt-panel-subheading";
    subHeading.textContent = "快捷访问提示词收藏和公式复制历史";

    titleWrap.appendChild(heading);
    titleWrap.appendChild(subHeading);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "voyager-gpt-panel-close";
    closeButton.setAttribute("aria-label", "关闭 ChatGPT-Voyager 面板");
    closeButton.textContent = "关闭";
    closeButton.addEventListener("click", () => {
      closePanel();
    });

    header.appendChild(titleWrap);
    header.appendChild(closeButton);

    const promptSection = createSection(
      "prompts",
      "提示词收藏",
      "点击复制，右键编辑提示词"
    );
    promptsContainer = promptSection.list;

    const promptCreateButton = document.createElement("button");
    promptCreateButton.type = "button";
    promptCreateButton.className = "voyager-gpt-panel-add-button";
    promptCreateButton.setAttribute("aria-label", "新建提示词收藏");
    promptCreateButton.title = "新建提示词收藏";
    promptCreateButton.textContent = "+";
    promptCreateButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startPromptCreate();
    });
    promptSection.titleRow.appendChild(promptCreateButton);

    promptEditorOverlay = document.createElement("div");
    promptEditorOverlay.className = "voyager-gpt-modal-overlay";
    promptEditorOverlay.hidden = true;
    promptEditorOverlay.addEventListener("click", (event) => {
      if (event.target === promptEditorOverlay) {
        resetPromptEditor();
      }
    });

    promptEditorDialog = document.createElement("div");
    promptEditorDialog.className = "voyager-gpt-modal";
    promptEditorDialog.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    promptEditorForm = document.createElement("form");
    promptEditorForm.className = "voyager-gpt-panel-editor";
    promptEditorForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!promptEditorNameInput || !promptEditorContentInput) {
        return;
      }

      const name = promptEditorNameInput.value.trim();
      const content = promptEditorContentInput.value.trim();

      if (!name) {
        setStatus("请先填写提示词名称。");
        promptEditorNameInput.focus();
        return;
      }

      if (!content) {
        setStatus("请先填写提示词内容。");
        promptEditorContentInput.focus();
        return;
      }

      const prompts = await getStoredPrompts();

      try {
        if (!editingPromptId) {
          const nextPrompt = {
            id: createItemId("prompt"),
            name,
            content,
            updatedAt: Date.now()
          };
          await persistPromptList(
            [nextPrompt, ...prompts],
            `提示词「${name}」已创建。`
          );
        } else {
          const currentPrompt = prompts.find((prompt) => prompt.id === editingPromptId);

          if (!currentPrompt) {
            setStatus("没有找到要编辑的提示词。");
            resetPromptEditor();
            return;
          }

          const nextPrompt = {
            ...currentPrompt,
            name,
            content,
            updatedAt: Date.now()
          };
          const nextPrompts = [
            nextPrompt,
            ...prompts.filter((prompt) => prompt.id !== editingPromptId)
          ];

          await persistPromptList(nextPrompts, `提示词「${name}」已更新。`);
        }

        resetPromptEditor();
      } catch (error) {
        reportScriptError(`[${SCRIPT_NAME}] 保存页内提示词失败。`, error);
        setStatus("保存提示词失败。");
      }
    });

    promptEditorHeading = document.createElement("p");
    promptEditorHeading.className = "voyager-gpt-panel-editor-heading";
    promptEditorHeading.textContent = "编辑提示词";

    promptEditorNameInput = document.createElement("input");
    promptEditorNameInput.type = "text";
    promptEditorNameInput.className = "voyager-gpt-panel-input";
    promptEditorNameInput.placeholder = "提示词名称";

    promptEditorContentInput = document.createElement("textarea");
    promptEditorContentInput.className = "voyager-gpt-panel-textarea";
    promptEditorContentInput.placeholder = "提示词内容";
    promptEditorContentInput.rows = 5;

    const promptEditorActions = document.createElement("div");
    promptEditorActions.className = "voyager-gpt-panel-editor-actions";

    promptEditorDeleteButton = document.createElement("button");
    promptEditorDeleteButton.type = "button";
    promptEditorDeleteButton.className =
      "voyager-gpt-panel-editor-button voyager-gpt-panel-editor-button-danger";
    promptEditorDeleteButton.textContent = "删除";
    promptEditorDeleteButton.hidden = true;
    promptEditorDeleteButton.addEventListener("click", async () => {
      if (!editingPromptId) {
        return;
      }

      const prompts = await getStoredPrompts();
      const currentPrompt = prompts.find((prompt) => prompt.id === editingPromptId);

      if (!currentPrompt) {
        setStatus("没有找到要删除的提示词。");
        resetPromptEditor();
        return;
      }

      const confirmed = window.confirm(
        `确认删除提示词「${currentPrompt.name || "未命名提示词"}」吗？`
      );

      if (!confirmed) {
        return;
      }

      try {
        const nextPrompts = prompts.filter((prompt) => prompt.id !== editingPromptId);
        await persistPromptList(
          nextPrompts,
          `提示词「${currentPrompt.name || "未命名提示词"}」已删除。`
        );
        resetPromptEditor();
      } catch (error) {
        reportScriptError(`[${SCRIPT_NAME}] 删除页内提示词失败。`, error);
        setStatus("删除提示词失败。");
      }
    });

    promptEditorSaveButton = document.createElement("button");
    promptEditorSaveButton.type = "submit";
    promptEditorSaveButton.className = "voyager-gpt-panel-editor-button";
    promptEditorSaveButton.textContent = "保存";

    const promptEditorCancelButton = document.createElement("button");
    promptEditorCancelButton.type = "button";
    promptEditorCancelButton.className =
      "voyager-gpt-panel-editor-button voyager-gpt-panel-editor-button-secondary";
    promptEditorCancelButton.textContent = "取消";
    promptEditorCancelButton.addEventListener("click", () => {
      resetPromptEditor();
      setStatus("已取消页内编辑。");
    });

    promptEditorActions.appendChild(promptEditorDeleteButton);
    promptEditorActions.appendChild(promptEditorCancelButton);
    promptEditorActions.appendChild(promptEditorSaveButton);
    promptEditorForm.appendChild(promptEditorHeading);
    promptEditorForm.appendChild(promptEditorNameInput);
    promptEditorForm.appendChild(promptEditorContentInput);
    promptEditorForm.appendChild(promptEditorActions);
    promptEditorDialog.appendChild(promptEditorForm);
    promptEditorOverlay.appendChild(promptEditorDialog);

    const historySection = createSection(
      "history",
      "公式复制历史",
      "保留最近复制的公式，方便再次使用"
    );
    historyContainer = historySection.list;

    const footer = document.createElement("div");
    footer.className = "voyager-gpt-panel-footer";

    const footerLink = document.createElement("button");
    footerLink.type = "button";
    footerLink.className = "voyager-gpt-panel-link";
    footerLink.textContent = "打开设置页";
    footerLink.addEventListener("click", async () => {
      const result = await sendRuntimeMessage({
        type: "OPEN_OPTIONS_PAGE"
      });

      if (result?.ok) {
        return;
      }

      setStatus(result?.error || "打开设置页失败。");
    });

    statusElement = document.createElement("p");
    statusElement.className = "voyager-gpt-panel-status";

    footer.appendChild(footerLink);
    footer.appendChild(statusElement);

    panel.appendChild(header);
    panel.appendChild(promptSection.section);
    panel.appendChild(historySection.section);
    panel.appendChild(footer);

    (document.body || document.documentElement).appendChild(panel);
    (document.body || document.documentElement).appendChild(promptEditorOverlay);
  }

  function renderPromptList() {
    if (!promptsContainer) {
      return;
    }

    if (editingPromptId && !cachedPrompts.some((prompt) => prompt.id === editingPromptId)) {
      resetPromptEditor();
    }

    promptsContainer.textContent = "";

    if (cachedPrompts.length === 0) {
      const empty = document.createElement("p");
      empty.className = "voyager-gpt-panel-empty";
      empty.textContent = "还没有保存提示词。";
      promptsContainer.appendChild(empty);
      return;
    }

    cachedPrompts.slice(0, 8).forEach((prompt) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "voyager-gpt-panel-item";

      const title = document.createElement("span");
      title.className = "voyager-gpt-panel-item-title";
      title.textContent = prompt.name || "未命名提示词";

      const preview = document.createElement("span");
      preview.className = "voyager-gpt-panel-item-meta";
      preview.textContent = truncateText(prompt.content, 80) || "提示词内容为空";

      item.appendChild(title);
      item.appendChild(preview);
      item.title = "左键复制，右键编辑";
      item.addEventListener("click", async () => {
        const content = String(prompt.content || "").trim();

        if (!content) {
          setStatus("该提示词内容为空。");
          return;
        }

        await copyTextToClipboard(content);
        setStatus(`提示词「${prompt.name || "未命名"}」已复制。`);
      });
      item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startPromptEdit(prompt);
      });

      promptsContainer.appendChild(item);
    });
  }

  function renderHistoryList() {
    if (!historyContainer) {
      return;
    }

    historyContainer.textContent = "";

    if (cachedHistory.length === 0) {
      const empty = document.createElement("p");
      empty.className = "voyager-gpt-panel-empty";
      empty.textContent = "还没有公式复制记录。";
      historyContainer.appendChild(empty);
      return;
    }

    cachedHistory.slice(0, 10).forEach((entry) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "voyager-gpt-panel-item";

      const preview = document.createElement("div");
      preview.className = "voyager-gpt-panel-expression";
      renderFormulaPreview(preview, entry, {
        fallbackText: "未识别公式"
      });

      const summary = document.createElement("span");
      summary.className = "voyager-gpt-panel-item-summary";
      summary.textContent = getHistorySummary(entry);

      item.appendChild(preview);
      item.appendChild(summary);
      item.addEventListener("click", async () => {
        const content = String(entry.latexSource || entry.text || "").trim();

        if (!content) {
          setStatus("该历史记录没有可复制内容。");
          return;
        }

        await copyTextToClipboard(content);
        setStatus(`${getFormatLabel(entry.format)} 已复制。`);

        try {
          await saveFormulaHistoryEntry({
            ...entry,
            copiedAt: Date.now()
          });
        } catch (error) {
          console.warn(`[${SCRIPT_NAME}] 更新页内公式历史失败。`, error);
        }
      });

      historyContainer.appendChild(item);
    });
  }

  function renderPanel() {
    try {
      renderPromptList();
      renderHistoryList();
    } catch (error) {
      promptsContainer?.replaceChildren();
      historyContainer?.replaceChildren();

      if (promptsContainer) {
        const promptEmpty = document.createElement("p");
        promptEmpty.className = "voyager-gpt-panel-empty";
        promptEmpty.textContent = "提示词加载失败，请打开设置页检查数据。";
        promptsContainer.appendChild(promptEmpty);
      }

      if (historyContainer) {
        const historyEmpty = document.createElement("p");
        historyEmpty.className = "voyager-gpt-panel-empty";
        historyEmpty.textContent = "历史记录加载失败，请稍后重试。";
        historyContainer.appendChild(historyEmpty);
      }

      throw error;
    }
  }

  async function refreshData() {
    const stored = await readLocalStorage({
      [STORAGE_KEYS.SAVED_PROMPTS]: [],
      [STORAGE_KEYS.FORMULA_HISTORY]: []
    });

    normalizedPromptSeed = 0;
    normalizedHistorySeed = 0;
    cachedPrompts = Array.isArray(stored[STORAGE_KEYS.SAVED_PROMPTS])
      ? stored[STORAGE_KEYS.SAVED_PROMPTS]
          .map((entry) => normalizePromptEntry(entry))
          .filter(Boolean)
      : [];
    cachedHistory = Array.isArray(stored[STORAGE_KEYS.FORMULA_HISTORY])
      ? clampFormulaHistoryItems(
          stored[STORAGE_KEYS.FORMULA_HISTORY]
        )
          .map((entry) => normalizeHistoryEntry(entry))
          .filter(Boolean)
      : [];
    renderPanel();
  }

  function positionPanel() {
    if (!panelOpen || !panel || !button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const panelWidth = 360;
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - panelWidth - 12)
    );

    panel.style.top = `${Math.min(window.innerHeight - 24, rect.bottom + 10)}px`;
    panel.style.left = `${left}px`;
  }

  function openPanel() {
    ensurePanel();
    panelOpen = true;
    button.setAttribute("aria-expanded", "true");
    panel.hidden = false;
    root.classList.add("open");
    positionPanel();
    refreshData().catch((error) => {
      markExtensionContextInvalidated(error);
      reportScriptError(`[${SCRIPT_NAME}] 加载页内面板数据失败。`, error);
      setStatus("加载面板数据失败。");
    });
  }

  function closePanel() {
    if (!panel || !button || !root) {
      return;
    }

    resetPromptEditor();
    panelOpen = false;
    button.setAttribute("aria-expanded", "false");
    panel.hidden = true;
    root.classList.remove("open");
    setStatus("");
  }

  function mount() {
    if (!enabled) {
      return;
    }

    ensureButton();
    ensurePanel();
    cleanupStaleUi();
    positionRoot();

    if (panelOpen) {
      positionPanel();
    }
  }

  function scheduleMount() {
    if (mountFrame) {
      return;
    }

    mountFrame = window.requestAnimationFrame(() => {
      mountFrame = null;
      mount();
    });
  }

  function handleViewportChange() {
    positionRoot();

    if (panelOpen) {
      positionPanel();
    }
  }

  function handleDocumentClick(event) {
    if (!panelOpen) {
      return;
    }

    const path = event.composedPath();

    if (
      path.includes(root) ||
      path.includes(panel) ||
      (promptEditorOverlay && path.includes(promptEditorOverlay))
    ) {
      return;
    }

    closePanel();
  }

  function handleKeyDown(event) {
    if (event.key === "Escape" && promptEditorOverlay && !promptEditorOverlay.hidden) {
      resetPromptEditor();
      return;
    }

    if (event.key === "Escape" && panelOpen) {
      closePanel();
    }
  }

  function ensureObserver() {
    if (mountObserver) {
      return;
    }

    mountObserver = new MutationObserver(() => {
      scheduleMount();
    });

    mountObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  return {
    enable() {
      if (enabled || !isChatGPTPage) {
        return;
      }

      enabled = true;
      ensureObserver();
      document.addEventListener("click", handleDocumentClick, true);
      document.addEventListener("keydown", handleKeyDown, true);
      window.addEventListener("resize", handleViewportChange);
      window.addEventListener("scroll", handleViewportChange, true);
      refreshData().catch((error) => {
        markExtensionContextInvalidated(error);
        reportScriptError(`[${SCRIPT_NAME}] 初始化页内入口失败。`, error);
      });
      scheduleMount();
    },

    disable() {
      if (!enabled) {
        return;
      }

      enabled = false;
      closePanel();

      if (mountObserver) {
        mountObserver.disconnect();
        mountObserver = null;
      }

      if (mountFrame) {
        window.cancelAnimationFrame(mountFrame);
        mountFrame = null;
      }

      document.removeEventListener("click", handleDocumentClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);

      if (root) {
        root.remove();
        root = null;
        button = null;
      }

      if (panel) {
        panel.remove();
        panel = null;
        promptsContainer = null;
        historyContainer = null;
        promptEditorOverlay?.remove();
        promptEditorOverlay = null;
        promptEditorDialog = null;
        promptEditorForm = null;
        promptEditorNameInput = null;
        promptEditorContentInput = null;
        promptEditorHeading = null;
        promptEditorSaveButton = null;
        promptEditorDeleteButton = null;
        editingPromptId = "";
        statusElement = null;
      }
    },

    refreshData() {
      if (!enabled || !extensionContextAvailable) {
        return Promise.resolve();
      }

      return refreshData();
    }
  };
})();

handleExtensionContextInvalidated = () => {
  chatgptHeaderEntryModule.disable();
};

function getFeatureSupportSummary() {
  return {
    siteName: isChatGPTPage ? "ChatGPT" : isNotionPage ? "Notion" : null,
    formulaCopierSupported: isChatGPTPage,
    enterEnhancerSupported: isChatGPTPage,
    notionCloseGuardSupported: isNotionPage
  };
}

function applySettings(settings) {
  if (isChatGPTPage) {
    chatgptHeaderEntryModule.enable();
  }

  formulaCopierModule.setCopyFormat(settings.formulaCopyFormat);

  if (settings.formulaCopierEnabled) {
    formulaCopierModule.enable();
  } else {
    formulaCopierModule.disable();
  }

  if (settings.enterEnhancerEnabled) {
    enterEnhancerModule.enable();
  } else {
    enterEnhancerModule.disable();
  }

  if (settings.notionCloseGuardEnabled) {
    notionCloseGuardModule.enable();
  } else {
    notionCloseGuardModule.disable();
  }
}

async function syncSettings() {
  const settings = await readLocalStorage(DEFAULT_SETTINGS);
  applySettings(settings);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PAGE_INFO") {
    sendResponse({
      ok: true,
      title: document.title,
      url: window.location.href,
      hostname: currentHostname,
      ...getFeatureSupportSummary()
    });
    return false;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (
    "formulaCopierEnabled" in changes ||
    "formulaCopyFormat" in changes ||
    "enterEnhancerEnabled" in changes ||
    "notionCloseGuardEnabled" in changes
  ) {
    syncSettings().catch((error) => {
      markExtensionContextInvalidated(error);
      reportScriptError(`[${SCRIPT_NAME}] 同步设置失败。`, error);
    });
  }

  if (
    STORAGE_KEYS.FORMULA_HISTORY in changes ||
    STORAGE_KEYS.SAVED_PROMPTS in changes
  ) {
    chatgptHeaderEntryModule.refreshData().catch((error) => {
      markExtensionContextInvalidated(error);
      reportScriptError(`[${SCRIPT_NAME}] 同步页内入口数据失败。`, error);
    });
  }
});

syncSettings().catch((error) => {
  markExtensionContextInvalidated(error);
  reportScriptError(`[${SCRIPT_NAME}] 初始化失败。`, error);
});
