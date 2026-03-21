const SCRIPT_NAME = "AIChatEnhancerExtension";
const FORMULA_COPY_FORMATS = {
  LATEX_INLINE: "latex",
  UNICODE_MATH: "unicode-math",
  LATEX_SOURCE: "latex-source"
};
const DEFAULT_SETTINGS = {
  formulaCopierEnabled: true,
  formulaCopyFormat: FORMULA_COPY_FORMATS.LATEX_SOURCE,
  enterEnhancerEnabled: true,
  notionCloseGuardEnabled: true
};
const DEFAULT_FORMULA_COPY_FORMAT = DEFAULT_SETTINGS.formulaCopyFormat;

function normalizeFormulaCopyFormat(value) {
  const normalizedValue =
    value === "mathml" ? FORMULA_COPY_FORMATS.UNICODE_MATH : value;

  return Object.values(FORMULA_COPY_FORMATS).includes(normalizedValue)
    ? normalizedValue
    : DEFAULT_FORMULA_COPY_FORMAT;
}

const currentHostname = window.location.hostname;
const isChatGPTPage =
  currentHostname.includes("chatgpt.com") ||
  currentHostname.includes("chat.openai.com");
const isNotionPage =
  currentHostname === "notion.so" ||
  currentHostname === "www.notion.so" ||
  currentHostname.endsWith(".notion.so") ||
  currentHostname.endsWith(".notion.site");

function copyTextWithFallback(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  const parent = document.body || document.documentElement;
  parent.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] Clipboard API 复制失败，回退到 execCommand。`, error);
    }
  }

  copyTextWithFallback(text);
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
        successMessage: "LaTeX（含 $）已复制"
      };
    }

    return {
      text: latex,
      successMessage: "LaTeX 已复制"
    };
  }

  async function processFormulaClick(target) {
    flashSelection(target);

    const copyPayload = getCopyPayload(target);

    if (copyPayload.text) {
      await copyToClipboard(copyPayload.text);
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

function getFeatureSupportSummary() {
  return {
    siteName: isChatGPTPage ? "ChatGPT" : isNotionPage ? "Notion" : null,
    formulaCopierSupported: isChatGPTPage,
    enterEnhancerSupported: isChatGPTPage,
    notionCloseGuardSupported: isNotionPage
  };
}

function applySettings(settings) {
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
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
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
      console.error(`[${SCRIPT_NAME}] 同步设置失败。`, error);
    });
  }
});

syncSettings().catch((error) => {
  console.error(`[${SCRIPT_NAME}] 初始化失败。`, error);
});
