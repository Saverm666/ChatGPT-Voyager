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

function waitForValue(resolveValue, options = {}) {
  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : 3000;
  const intervalMs =
    typeof options.intervalMs === "number" && Number.isFinite(options.intervalMs)
      ? options.intervalMs
      : 60;
  const startTime = Date.now();

  return new Promise((resolve) => {
    function check() {
      let value = null;

      try {
        value = resolveValue();
      } catch (error) {
        value = null;
      }

      if (value) {
        resolve(value);
        return;
      }

      if (Date.now() - startTime >= timeoutMs) {
        resolve(null);
        return;
      }

      window.setTimeout(check, intervalMs);
    }

    check();
  });
}

function isElementVisibleInViewport(element) {
  if (!(element instanceof Element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getClosestConversationTurnElement(node) {
  if (!node) {
    return null;
  }

  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest?.("[data-turn-id]") || null;
}

function getNormalizedElementText(element) {
  if (!(element instanceof Element)) {
    return "";
  }

  return String(
    element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.textContent ||
      ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

const formulaCopierModule = (() => {
  let enabled = false;
  let copyFormat = DEFAULT_FORMULA_COPY_FORMAT;
  let selectedElement = null;
  let hoveredElement = null;
  let pendingHoverTarget = null;
  let hoverFrame = null;
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

  function scheduleHoverUpdate(target) {
    pendingHoverTarget = target || null;

    if (hoverFrame) {
      return;
    }

    hoverFrame = window.requestAnimationFrame(() => {
      hoverFrame = null;
      updateHover(pendingHoverTarget);
    });
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
    scheduleHoverUpdate(findFormulaElement(event.composedPath()));
  }

  function onDocumentMouseOut(event) {
    if (!event.relatedTarget) {
      pendingHoverTarget = null;
      if (hoverFrame) {
        window.cancelAnimationFrame(hoverFrame);
        hoverFrame = null;
      }
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
      if (hoverFrame) {
        window.cancelAnimationFrame(hoverFrame);
        hoverFrame = null;
      }
      pendingHoverTarget = null;
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
  const EDITABLE_SELECTOR =
    'textarea, div[contenteditable="true"], [contenteditable="plaintext-only"]';

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
    return element.matches(EDITABLE_SELECTOR);
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

    if (!root.matches(EDITABLE_SELECTOR) && !root.querySelector(EDITABLE_SELECTOR)) {
      return;
    }

    if (isEditableElement(root)) {
      attachInterceptor(root);
    }

    root.querySelectorAll(EDITABLE_SELECTOR).forEach((element) => attachInterceptor(element));
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

    observer.observe(document.body || document.documentElement, {
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
      .querySelectorAll(EDITABLE_SELECTOR)
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

const branchSelectionModule = (() => {
  const BRANCH_BUTTON_IDLE_LABEL = "分支提问";
  const BRANCH_BUTTON_LOADING_LABEL = "分支中…";
  const BRANCH_BUTTON_ERROR_LABEL = "重试分支";
  const SELECTION_IDLE_DELAY_MS = 1000;
  const BRANCH_MENU_ITEM_PATTERN =
    /新聊天中的分支|在新聊天中分支|新聊天分支|Branch in new chat|Branch to new chat/i;
  const TURN_MORE_ACTIONS_SELECTOR =
    'button[aria-label="更多操作"], button[aria-label="More actions"]';
  const COMPOSER_SELECTOR = '#prompt-textarea[contenteditable="true"]';

  let enabled = false;
  let root = null;
  let button = null;
  let activeSelection = null;
  let selectionRefreshTimer = null;
  let selectionRefreshFrame = null;
  let actionInFlight = false;
  let consumeInFlight = false;
  let errorResetTimer = null;

  function getRangeDisplayRect(range) {
    if (!(range instanceof Range)) {
      return null;
    }

    const rects = Array.from(range.getClientRects()).filter((rect) => {
      return rect.width > 0 || rect.height > 0;
    });

    if (rects.length > 0) {
      return rects[rects.length - 1];
    }

    const fallbackRect = range.getBoundingClientRect();
    return fallbackRect.width > 0 || fallbackRect.height > 0 ? fallbackRect : null;
  }

  function getTextBlockRect(range, turnElement) {
    if (!(range instanceof Range) || !(turnElement instanceof Element)) {
      return null;
    }

    const blockSelector = [
      "p",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "pre",
      "blockquote",
      "td",
      "th"
    ].join(", ");

    const candidateNodes = [
      range.startContainer,
      range.endContainer,
      range.commonAncestorContainer
    ];

    for (const node of candidateNodes) {
      const element = node instanceof Element ? node : node?.parentElement;
      const blockElement = element?.closest?.(blockSelector);

      if (!(blockElement instanceof Element) || !turnElement.contains(blockElement)) {
        continue;
      }

      const rect = blockElement.getBoundingClientRect();

      if (rect.width > 0 || rect.height > 0) {
        return rect;
      }
    }

    const messageContainer = range.startContainer instanceof Element
      ? range.startContainer.closest('[data-message-author-role="assistant"], .markdown')
      : range.startContainer?.parentElement?.closest?.(
          '[data-message-author-role="assistant"], .markdown'
        );

    if (messageContainer instanceof Element && turnElement.contains(messageContainer)) {
      const rect = messageContainer.getBoundingClientRect();

      if (rect.width > 0 || rect.height > 0) {
        return rect;
      }
    }

    return getRangeDisplayRect(range);
  }

  function ensureUi() {
    if (root || !document.body) {
      return;
    }

    root = document.createElement("div");
    root.className = "voyager-branch-selection-root";
    root.hidden = true;

    button = document.createElement("button");
    button.type = "button";
    button.className = "voyager-branch-selection-button";
    button.textContent = BRANCH_BUTTON_IDLE_LABEL;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSelectionInBranch().catch((error) => {
        reportScriptError(`[${SCRIPT_NAME}] 打开分支失败。`, error);
      });
    });

    root.appendChild(button);
    (document.body || document.documentElement).appendChild(root);
  }

  function setButtonState(state, label) {
    ensureUi();

    if (!root || !button) {
      return;
    }

    root.dataset.state = state;
    button.textContent = label;
    button.disabled = state === "loading";
  }

  function resetButtonState() {
    if (!root || !button) {
      return;
    }

    delete root.dataset.state;
    button.textContent = BRANCH_BUTTON_IDLE_LABEL;
    button.disabled = false;
  }

  function clearErrorResetTimer() {
    if (!errorResetTimer) {
      return;
    }

    window.clearTimeout(errorResetTimer);
    errorResetTimer = null;
  }

  function hideUi() {
    activeSelection = null;
    clearErrorResetTimer();

    if (!root) {
      return;
    }

    resetButtonState();
    root.hidden = true;
  }

  function getSelectionSnapshot() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const selectedText = selection.toString().replace(/\u00a0/g, " ").trim();

    if (!selectedText) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const startTurn = getClosestConversationTurnElement(range.startContainer);
    const endTurn = getClosestConversationTurnElement(range.endContainer);

    if (!startTurn || startTurn !== endTurn || startTurn.dataset.turn !== "assistant") {
      return null;
    }

    const turnId = String(startTurn.dataset.turnId || "").trim();
    const rect = getRangeDisplayRect(range);
    const blockRect = getTextBlockRect(range, startTurn);

    if (!turnId || !rect || !blockRect) {
      return null;
    }

    return {
      text: selectedText,
      turnId,
      rect,
      blockRect,
      turnElement: startTurn
    };
  }

  function positionUi(snapshot) {
    ensureUi();

    if (!root || !snapshot) {
      return;
    }

    const rootWidth = Math.max(root.offsetWidth || 0, 116);
    const rootHeight = Math.max(root.offsetHeight || 0, 34);
    const anchorRect = snapshot.blockRect || snapshot.rect;
    const left = Math.max(12, anchorRect.left - rootWidth - 10);

    let top = snapshot.rect.top + snapshot.rect.height / 2 - rootHeight / 2;
    top = Math.max(12, Math.min(top, window.innerHeight - rootHeight - 12));

    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.hidden = false;
  }

  function syncSelectionUi() {
    if (!enabled || actionInFlight) {
      return;
    }

    const snapshot = getSelectionSnapshot();

    if (!snapshot) {
      hideUi();
      return;
    }

    activeSelection = snapshot;
    clearErrorResetTimer();
    resetButtonState();
    positionUi(snapshot);
  }

  function scheduleSelectionSync() {
    if (!enabled) {
      return;
    }

    if (!actionInFlight) {
      hideUi();
    }

    if (selectionRefreshTimer) {
      window.clearTimeout(selectionRefreshTimer);
      selectionRefreshTimer = null;
    }

    if (selectionRefreshFrame) {
      window.cancelAnimationFrame(selectionRefreshFrame);
      selectionRefreshFrame = null;
    }

    selectionRefreshTimer = window.setTimeout(() => {
      selectionRefreshTimer = null;
      selectionRefreshFrame = window.requestAnimationFrame(() => {
        selectionRefreshFrame = null;
        syncSelectionUi();
      });
    }, SELECTION_IDLE_DELAY_MS);
  }

  function findTurnMoreActionsButton(turnElement) {
    if (!(turnElement instanceof Element)) {
      return null;
    }

    const searchRoots = [
      turnElement,
      turnElement.querySelector(".group\\/turn-messages"),
      turnElement.parentElement,
      turnElement.closest(".group\\/turn-messages"),
      turnElement.closest("[data-testid^='conversation-turn-']")?.parentElement
    ].filter(Boolean);

    for (const rootCandidate of searchRoots) {
      if (!(rootCandidate instanceof Element)) {
        continue;
      }

      const explicitButton = rootCandidate.querySelector(TURN_MORE_ACTIONS_SELECTOR);

      if (explicitButton instanceof HTMLButtonElement) {
        return explicitButton;
      }

      const actionContainer = rootCandidate.querySelector(
        '[aria-label="回复操作"], [aria-label="Response actions"], [aria-label="Message actions"]'
      );

      if (!(actionContainer instanceof Element)) {
        continue;
      }

      const fallbackButton = Array.from(
        actionContainer.querySelectorAll('button[aria-haspopup="menu"]')
      ).find((element) => element instanceof HTMLButtonElement);

      if (fallbackButton instanceof HTMLButtonElement) {
        return fallbackButton;
      }
    }

    const allButtons = Array.from(
      document.querySelectorAll(TURN_MORE_ACTIONS_SELECTOR)
    ).filter((element) => element instanceof HTMLButtonElement);

    return (
      allButtons.find((element) => {
        const buttonTurn = element.closest("[data-turn-id]");
        return buttonTurn instanceof Element && buttonTurn === turnElement;
      }) || null
    );
  }

  function dispatchMouseSequence(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const eventTypes = [
      "pointerenter",
      "mouseenter",
      "pointerover",
      "mouseover",
      "pointermove",
      "mousemove",
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click"
    ];

    eventTypes.forEach((type) => {
      const isPointerEvent = type.startsWith("pointer");
      const EventConstructor =
        isPointerEvent && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      element.dispatchEvent(
        new EventConstructor(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 0,
          buttons: 1,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          view: window
        })
      );
    });
  }

  function revealTurnActions(turnElement, moreActionsButton) {
    if (turnElement instanceof HTMLElement) {
      ["pointerenter", "mouseenter", "pointermove", "mousemove", "mouseover"].forEach((type) => {
        const EventConstructor =
          type.startsWith("pointer") && typeof PointerEvent === "function"
            ? PointerEvent
            : MouseEvent;
        turnElement.dispatchEvent(
          new EventConstructor(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            view: window
          })
        );
      });
    }

    const actionsGroup = moreActionsButton?.closest(
      '[aria-label="回复操作"], [aria-label="Response actions"], [aria-label="Message actions"]'
    );

    if (actionsGroup instanceof HTMLElement) {
      actionsGroup.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        })
      );
    }

    if (moreActionsButton instanceof HTMLElement) {
      moreActionsButton.focus();
    }
  }

  async function openMenuFromButton(moreActionsButton, turnElement) {
    if (!(moreActionsButton instanceof HTMLButtonElement)) {
      return false;
    }

    revealTurnActions(turnElement, moreActionsButton);

    if (moreActionsButton.getAttribute("aria-expanded") === "true") {
      return true;
    }

    moreActionsButton.click();

    let expandedButton = await waitForValue(() => {
      return moreActionsButton.getAttribute("aria-expanded") === "true" ? moreActionsButton : null;
    }, {
      timeoutMs: 900,
      intervalMs: 60
    });

    if (expandedButton) {
      return true;
    }

    dispatchMouseSequence(moreActionsButton);

    expandedButton = await waitForValue(() => {
      return moreActionsButton.getAttribute("aria-expanded") === "true" ? moreActionsButton : null;
    }, {
      timeoutMs: 1200,
      intervalMs: 60
    });

    return Boolean(expandedButton);
  }

  function getMenuSearchRoots() {
    const roots = Array.from(
      document.querySelectorAll(
        '[role="menu"], [data-radix-popper-content-wrapper], [data-slot="dropdown-menu-content"]'
      )
    ).filter((element) => isElementVisibleInViewport(element));

    roots.sort((left, right) => {
      const leftIsMenu = left.getAttribute("role") === "menu" ? 0 : 1;
      const rightIsMenu = right.getAttribute("role") === "menu" ? 0 : 1;
      return leftIsMenu - rightIsMenu;
    });

    return roots.length > 0 ? roots : [document];
  }

  function getClickableAncestor(element, rootCandidate) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    const interactiveAncestor = element.closest(
      [
        '[role="menuitem"]',
        '[role="option"]',
        "button",
        "a[href]",
        "[data-radix-collection-item]",
        "[cmdk-item]"
      ].join(", ")
    );

    if (
      interactiveAncestor instanceof HTMLElement &&
      (!(rootCandidate instanceof Node) || rootCandidate.contains(interactiveAncestor))
    ) {
      return interactiveAncestor;
    }

    return element;
  }

  function getMenuInteractiveCandidates(rootCandidate) {
    if (
      !rootCandidate ||
      (typeof rootCandidate !== "object" && typeof rootCandidate !== "function") ||
      typeof rootCandidate.querySelectorAll !== "function"
    ) {
      return [];
    }

    const selector = [
      '[role="menuitem"]',
      '[role="option"]',
      "button",
      "a[href]",
      "[data-radix-collection-item]",
      "[cmdk-item]"
    ].join(", ");

    const candidates = Array.from(rootCandidate.querySelectorAll(selector))
      .map((element) => {
        return getClickableAncestor(element, rootCandidate);
      })
      .filter((element) => {
        return (
          element instanceof HTMLElement &&
          element.getClientRects().length > 0 &&
          !root?.contains(element) &&
          element.getAttribute("role") !== "menu" &&
          !element.matches('[data-radix-menu-content], [data-radix-popper-content-wrapper]') &&
          getNormalizedElementText(element)
        );
      });

    return Array.from(new Set(candidates));
  }

  function findBranchMenuItem() {
    const searchRoots = getMenuSearchRoots();

    for (const rootCandidate of searchRoots) {
      const candidates = getMenuInteractiveCandidates(rootCandidate);
      const matched = candidates.find((element) => {
        return BRANCH_MENU_ITEM_PATTERN.test(getNormalizedElementText(element));
      });

      if (matched instanceof HTMLElement) {
        return matched;
      }
    }

    return null;
  }

  function findFirstMenuAction() {
    const searchRoots = getMenuSearchRoots();

    for (const rootCandidate of searchRoots) {
      const candidates = getMenuInteractiveCandidates(rootCandidate).filter((element) => {
        return !element.className.includes("__menu-label") && Boolean(element.getAttribute("aria-label"));
      });

      if (candidates.length > 0) {
        return candidates[0];
      }
    }

    return null;
  }

  function isScrollableContainer(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const computedStyle = window.getComputedStyle(element);
    const overflowY = computedStyle.overflowY || "";
    const overflowX = computedStyle.overflowX || "";
    const canScrollY =
      /(auto|scroll|overlay)/i.test(overflowY) &&
      element.scrollHeight > element.clientHeight + 1;
    const canScrollX =
      /(auto|scroll|overlay)/i.test(overflowX) &&
      element.scrollWidth > element.clientWidth + 1;

    return canScrollY || canScrollX;
  }

  function captureScrollState(anchorElement) {
    const entries = [];
    const seen = new Set();
    let current =
      anchorElement instanceof Element ? anchorElement.parentElement : null;

    while (current) {
      if (isScrollableContainer(current) && !seen.has(current)) {
        entries.push({
          element: current,
          top: current.scrollTop,
          left: current.scrollLeft
        });
        seen.add(current);
      }

      current = current.parentElement;
    }

    entries.push({
      element: window,
      top: window.scrollY,
      left: window.scrollX
    });

    return entries;
  }

  function restoreScrollState(entries) {
    entries.forEach((entry) => {
      if (entry.element === window) {
        window.scrollTo(entry.left, entry.top);
        return;
      }

      if (entry.element instanceof HTMLElement) {
        entry.element.scrollLeft = entry.left;
        entry.element.scrollTop = entry.top;
      }
    });
  }

  function scheduleScrollRestore(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return;
    }

    restoreScrollState(entries);
    window.requestAnimationFrame(() => {
      restoreScrollState(entries);
    });
    window.setTimeout(() => {
      restoreScrollState(entries);
    }, 120);
  }

  async function activateElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    element.focus();
    element.click();

    await new Promise((resolve) => {
      window.setTimeout(resolve, 80);
    });

    return true;
  }

  function findComposerInput() {
    const composer = document.querySelector(COMPOSER_SELECTOR);
    return composer instanceof HTMLElement ? composer : null;
  }

  function getComposerPlainText(composer) {
    if (!(composer instanceof HTMLElement)) {
      return "";
    }

    return String(composer.innerText || composer.textContent || "")
      .replace(/\u200b/g, "")
      .trim();
  }

  function normalizeComparableText(text) {
    return String(text || "")
      .replace(/\u200b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function composerContainsText(text, composer = findComposerInput()) {
    if (!(composer instanceof HTMLElement)) {
      return false;
    }

    const normalizedTarget = normalizeComparableText(text);

    if (!normalizedTarget) {
      return false;
    }

    return normalizeComparableText(getComposerPlainText(composer)).includes(
      normalizedTarget
    );
  }

  function selectElementContents(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const selection = window.getSelection();

    if (!selection) {
      return false;
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function placeCaretAtEnd(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function applyTextFallback(composer, text) {
    if (!(composer instanceof HTMLElement)) {
      return;
    }

    const lines = String(text || "").split(/\r?\n/);
    composer.replaceChildren();

    if (lines.length === 0) {
      const paragraph = document.createElement("p");
      const trailingBreak = document.createElement("br");
      trailingBreak.className = "ProseMirror-trailingBreak";
      paragraph.appendChild(trailingBreak);
      composer.appendChild(paragraph);
      return;
    }

    lines.forEach((line) => {
      const paragraph = document.createElement("p");

      if (line) {
        paragraph.textContent = line;
      } else {
        const trailingBreak = document.createElement("br");
        trailingBreak.className = "ProseMirror-trailingBreak";
        paragraph.appendChild(trailingBreak);
      }

      composer.appendChild(paragraph);
    });
  }

  async function insertTextIntoComposer(composer, text) {
    if (!(composer instanceof HTMLElement)) {
      return false;
    }

    const draftText = String(text || "").trim();

    if (!draftText) {
      return false;
    }

    if (composerContainsText(draftText, composer)) {
      return true;
    }

    const nextText = draftText;

    composer.focus();
    selectElementContents(composer);

    const beforeInputEvent = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: nextText
    });
    composer.dispatchEvent(beforeInputEvent);

    let inserted = false;

    try {
      inserted = document.execCommand("insertText", false, nextText);
    } catch (error) {
      inserted = false;
    }

    if (!inserted) {
      applyTextFallback(composer, nextText);
    }

    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: nextText
      })
    );
    placeCaretAtEnd(composer);

    if (composerContainsText(draftText, composer)) {
      return true;
    }

    const confirmed = await waitForValue(() => {
      return composerContainsText(draftText) ? true : null;
    }, {
      timeoutMs: 1500,
      intervalMs: 80
    });

    return Boolean(confirmed);
  }

  async function consumePendingBranchDraft() {
    if (!enabled || !extensionContextAvailable || consumeInFlight || !isChatGPTPage) {
      return;
    }

    consumeInFlight = true;

    try {
      const result = await sendRuntimeMessage({
        type: "CONSUME_BRANCH_PROMPT_DRAFT",
        pathname: window.location.pathname,
        referrer: document.referrer
      });

      if (!result?.ok || !result.draft?.text) {
        return;
      }

      const composer = await waitForValue(() => findComposerInput(), {
        timeoutMs: 15000,
        intervalMs: 100
      });

      if (!composer) {
        throw new Error("没有找到分支聊天输入框。");
      }

      if (composerContainsText(result.draft.text, composer)) {
        return;
      }

      const inserted = await insertTextIntoComposer(composer, result.draft.text);

      if (!inserted) {
        throw new Error("未能把选中文本写入分支聊天输入框。");
      }
    } catch (error) {
      markExtensionContextInvalidated(error);
      reportScriptError(`[${SCRIPT_NAME}] 自动填充分支聊天失败。`, error);
    } finally {
      consumeInFlight = false;
    }
  }

  async function openSelectionInBranch() {
    if (actionInFlight || !activeSelection) {
      return;
    }

    const snapshot = activeSelection;
    let draftCreated = false;
    let failed = false;

    actionInFlight = true;
    setButtonState("loading", BRANCH_BUTTON_LOADING_LABEL);

    try {
      const scrollState = captureScrollState(snapshot.turnElement);
      const moreActionsButton = await waitForValue(
        () => findTurnMoreActionsButton(snapshot.turnElement),
        {
          timeoutMs: 2000,
          intervalMs: 80
        }
      );

      if (!moreActionsButton) {
        throw new Error("没有找到当前回复对应的“更多操作”按钮。");
      }

      const menuOpened = await openMenuFromButton(moreActionsButton, snapshot.turnElement);

      if (!menuOpened) {
        throw new Error("没有成功打开当前回复的操作菜单。");
      }

      const branchMenuItem = await waitForValue(() => findBranchMenuItem(), {
        timeoutMs: 5000,
        intervalMs: 80
      });

      const saveDraftPromise = sendRuntimeMessage({
        type: "CREATE_BRANCH_PROMPT_DRAFT",
        text: snapshot.text,
        sourceTurnId: snapshot.turnId,
        sourcePath: window.location.pathname
      });

      draftCreated = true;
      const targetMenuItem = branchMenuItem || findFirstMenuAction();

      if (!targetMenuItem) {
        throw new Error("没有找到“新聊天中的分支”菜单项。");
      }

      if (!branchMenuItem) {
        console.warn(
          `[${SCRIPT_NAME}] 未匹配到“新聊天中的分支”文本，已回退到菜单第一项。`,
          targetMenuItem
        );
      }

      await activateElement(targetMenuItem);
      scheduleScrollRestore(scrollState);
      const saveResult = await saveDraftPromise;

      if (!saveResult?.ok) {
        throw new Error(saveResult?.error || "保存分支草稿失败。");
      }

      hideUi();
    } catch (error) {
      failed = true;

      if (draftCreated) {
        await sendRuntimeMessage({
          type: "CLEAR_BRANCH_PROMPT_DRAFT"
        });
      }

      reportScriptError(`[${SCRIPT_NAME}] 打开分支失败。`, error);
      setButtonState("error", BRANCH_BUTTON_ERROR_LABEL);
      errorResetTimer = window.setTimeout(() => {
        errorResetTimer = null;
        actionInFlight = false;
        scheduleSelectionSync();
      }, 1400);
    } finally {
      if (!failed) {
        actionInFlight = false;
      }
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== "visible") {
      return;
    }

    scheduleSelectionSync();
    consumePendingBranchDraft().catch((error) => {
      reportScriptError(`[${SCRIPT_NAME}] 恢复分支草稿失败。`, error);
    });
  }

  function handleDocumentMouseDown(event) {
    if (root && event.target instanceof Node && root.contains(event.target)) {
      return;
    }

    if (!actionInFlight) {
      hideUi();
    }
  }

  function handleSelectionViewportChange() {
    if (!enabled) {
      return;
    }

    if (!activeSelection && (!root || root.hidden)) {
      return;
    }

    scheduleSelectionSync();
  }

  return {
    enable() {
      if (enabled || !isChatGPTPage) {
        return;
      }

      enabled = true;
      ensureUi();
      document.addEventListener("selectionchange", scheduleSelectionSync, true);
      document.addEventListener("mouseup", scheduleSelectionSync, true);
      document.addEventListener("keyup", scheduleSelectionSync, true);
      document.addEventListener("mousedown", handleDocumentMouseDown, true);
      window.addEventListener("resize", handleSelectionViewportChange);
      window.addEventListener("scroll", handleSelectionViewportChange, true);
      window.addEventListener("pageshow", handleVisibilityChange);
      document.addEventListener("visibilitychange", handleVisibilityChange);
      scheduleSelectionSync();
      consumePendingBranchDraft().catch((error) => {
        reportScriptError(`[${SCRIPT_NAME}] 初始化分支草稿失败。`, error);
      });
    },

    disable() {
      if (!enabled) {
        return;
      }

      enabled = false;
      clearErrorResetTimer();

      if (selectionRefreshFrame) {
        window.cancelAnimationFrame(selectionRefreshFrame);
        selectionRefreshFrame = null;
      }

      if (selectionRefreshTimer) {
        window.clearTimeout(selectionRefreshTimer);
        selectionRefreshTimer = null;
      }

      document.removeEventListener("selectionchange", scheduleSelectionSync, true);
      document.removeEventListener("mouseup", scheduleSelectionSync, true);
      document.removeEventListener("keyup", scheduleSelectionSync, true);
      document.removeEventListener("mousedown", handleDocumentMouseDown, true);
      window.removeEventListener("resize", handleSelectionViewportChange);
      window.removeEventListener("scroll", handleSelectionViewportChange, true);
      window.removeEventListener("pageshow", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (root) {
        root.remove();
        root = null;
        button = null;
      }

      activeSelection = null;
      actionInFlight = false;
      consumeInFlight = false;
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
  let viewportFrame = null;
  let statusTimer = null;
  let panelOpen = false;
  let editingPromptId = "";
  let lastRootTopPx = "";
  let lastRootLeftPx = "";
  let lastRootEntryHeightPx = "";
  let cachedPrompts = [];
  let cachedHistory = [];
  let normalizedPromptSeed = 0;
  let normalizedHistorySeed = 0;
  const HEADER_SHARE_BUTTON_SELECTOR =
    "button[aria-label*='分享'], button[aria-label*='Share'], button[data-testid='share-chat-button']";
  const HEADER_MOUNT_TRIGGER_SELECTOR = [
    "#conversation-header-actions",
    "[data-testid='model-switcher-dropdown-button']",
    HEADER_SHARE_BUTTON_SELECTOR,
    "[data-turn-id]"
  ].join(", ");

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
    const modelSwitcher = document.querySelector(
      "[data-testid='model-switcher-dropdown-button']"
    );

    if (
      modelSwitcher instanceof Element &&
      !isManagedElement(modelSwitcher) &&
      isElementVisible(modelSwitcher)
    ) {
      const rect = modelSwitcher.getBoundingClientRect();

      if (rect.top >= 0 && rect.top < 140) {
        return modelSwitcher;
      }
    }
    return null;
  }

  function findTopRightActionAnchor() {
    const actionContainer = findConversationHeaderActionsContainer();
    const searchRoots = [actionContainer, document];

    for (const searchRoot of searchRoots) {
      if (
        searchRoot &&
        !(searchRoot instanceof Document) &&
        (!(searchRoot instanceof Element) ||
          isManagedElement(searchRoot) ||
          !isElementVisible(searchRoot))
      ) {
        continue;
      }

      const explicitShareButton = searchRoot?.querySelector?.(
        HEADER_SHARE_BUTTON_SELECTOR
      );

      if (
        explicitShareButton instanceof Element &&
        !isManagedElement(explicitShareButton) &&
        isElementVisible(explicitShareButton)
      ) {
        const rect = explicitShareButton.getBoundingClientRect();

        if (rect.top >= 0 && rect.top < 180) {
          return explicitShareButton;
        }
      }
    }

    return null;
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

    const actionAnchor = findTopRightActionAnchor();

    if (actionAnchor) {
      const actionRect = actionAnchor.getBoundingClientRect();
      const actionHeightPx = `${Math.max(32, Math.round(actionRect.height))}px`;

      if (actionHeightPx !== lastRootEntryHeightPx) {
        root.style.setProperty("--voyager-gpt-entry-height", actionHeightPx);
        lastRootEntryHeightPx = actionHeightPx;
      }
    } else {
      if (lastRootEntryHeightPx) {
        root.style.removeProperty("--voyager-gpt-entry-height");
        lastRootEntryHeightPx = "";
      }
    }

    root.classList.remove("voyager-gpt-entry-root-inline");

    const titleAnchor = findHeaderAnchor();
    const measuredRect = button?.getBoundingClientRect() || root.getBoundingClientRect();
    const rootWidth = Math.max(
      button?.offsetWidth || root.offsetWidth || Math.ceil(measuredRect.width) || 0,
      136
    );
    const rootHeight = Math.max(
      button?.offsetHeight || root.offsetHeight || Math.ceil(measuredRect.height) || 0,
      36
    );
    let top = 14;
    let left = window.innerWidth - rootWidth - 64;

    if (actionAnchor) {
      const rect = actionAnchor.getBoundingClientRect();
      top = Math.max(
        10,
        Math.min(
          window.innerHeight - rootHeight - 10,
          rect.top + (rect.height - rootHeight) / 2
        )
      );
      left = rect.left - rootWidth - 10;
    } else if (titleAnchor) {
      const rect = titleAnchor.getBoundingClientRect();
      top = Math.max(
        10,
        Math.min(
          window.innerHeight - rootHeight - 10,
          rect.top + (rect.height - rootHeight) / 2
        )
      );
    }

    const nextTopPx = `${Math.round(Math.max(10, top))}px`;
    const nextLeftPx = `${Math.round(
      Math.max(12, Math.min(left, window.innerWidth - rootWidth - 12))
    )}px`;

    if (nextTopPx !== lastRootTopPx) {
      root.style.top = nextTopPx;
      lastRootTopPx = nextTopPx;
    }

    if (nextLeftPx !== lastRootLeftPx) {
      root.style.left = nextLeftPx;
      lastRootLeftPx = nextLeftPx;
    }
  }

  function ensureButton() {
    cleanupStaleUi();

    if (root) {
      return;
    }

    lastRootTopPx = "";
    lastRootLeftPx = "";
    lastRootEntryHeightPx = "";
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

    const parent = document.body || document.documentElement;

    if (panel) {
      if (parent && !panel.isConnected) {
        parent.appendChild(panel);
      }

      if (promptEditorOverlay && parent && !promptEditorOverlay.isConnected) {
        parent.appendChild(promptEditorOverlay);
      }

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

    parent.appendChild(panel);
    parent.appendChild(promptEditorOverlay);
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
    const panelWidth = Math.max(320, panel.offsetWidth || 360);
    const panelRightGap = 42;
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - panelWidth - panelRightGap)
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

  function nodeMatchesHeaderMountTrigger(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    if (node.matches(HEADER_MOUNT_TRIGGER_SELECTOR)) {
      return true;
    }

    return Boolean(node.querySelector(HEADER_MOUNT_TRIGGER_SELECTOR));
  }

  function shouldScheduleMountFromMutations(mutations) {
    for (const mutation of mutations) {
      if (nodeMatchesHeaderMountTrigger(mutation.target)) {
        return true;
      }

      for (const node of mutation.addedNodes) {
        if (nodeMatchesHeaderMountTrigger(node)) {
          return true;
        }
      }

      for (const node of mutation.removedNodes) {
        if (nodeMatchesHeaderMountTrigger(node)) {
          return true;
        }
      }
    }

    return false;
  }

  function scheduleViewportSync() {
    if (viewportFrame) {
      return;
    }

    viewportFrame = window.requestAnimationFrame(() => {
      viewportFrame = null;
      positionRoot();

      if (panelOpen) {
        positionPanel();
      }
    });
  }

  function handleViewportChange() {
    scheduleViewportSync();
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

    mountObserver = new MutationObserver((mutations) => {
      if (!shouldScheduleMountFromMutations(mutations)) {
        return;
      }

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

      if (viewportFrame) {
        window.cancelAnimationFrame(viewportFrame);
        viewportFrame = null;
      }

      document.removeEventListener("click", handleDocumentClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);

      if (root) {
        root.remove();
        root = null;
        button = null;
        lastRootTopPx = "";
        lastRootLeftPx = "";
        lastRootEntryHeightPx = "";
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
  branchSelectionModule.disable();
  chatgptHeaderEntryModule.disable();
};

function getFeatureSupportSummary() {
  return {
    siteName: isChatGPTPage ? "ChatGPT" : isNotionPage ? "Notion" : null,
    formulaCopierSupported: isChatGPTPage,
    conversationTimelineSupported: isChatGPTPage,
    enterEnhancerSupported: isChatGPTPage,
    notionCloseGuardSupported: isNotionPage
  };
}

function applySettings(settings) {
  if (isChatGPTPage) {
    branchSelectionModule.enable();
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
