const SCRIPT_NAME = "ChatGPTVoyagerExtension";
const {
  FORMULA_COPY_FORMATS,
  FORMULA_COPY_FORMAT_LABELS,
  MARKDOWN_FORMULA_WRAP_MODES,
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  createItemId,
  normalizeFormulaCopyFormat,
  normalizeMarkdownFormulaWrapMode,
  clampFormulaHistoryItems,
  renderFormulaPreview,
  truncateText,
  formatTimestamp,
  copyTextToClipboard,
  saveFormulaHistoryEntry
} = globalThis.ChatGPTVoyagerShared;
const DEFAULT_FORMULA_COPY_FORMAT = DEFAULT_SETTINGS.formulaCopyFormat;
const DEFAULT_MARKDOWN_FORMULA_WRAP_MODE = DEFAULT_SETTINGS.markdownFormulaWrapMode;
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

function createPinIcon() {
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.classList.add("voyager-pin-icon");
  icon.textContent = "\u{1F4CC}\uFE0E";
  return icon;
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

function getElementFromNode(node) {
  if (node instanceof Element) {
    return node;
  }

  if (node instanceof Node) {
    return node.parentElement;
  }

  return null;
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

function extractLatexSourceFromContainer(containerElement) {
  if (!(containerElement instanceof Element)) {
    return null;
  }

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
    return extractLatexSourceFromContainer(containerElement);
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

const markdownCopyModule = (() => {
  let enabled = false;
  let lastCopyPayload = "";
  let formulaWrapMode = DEFAULT_MARKDOWN_FORMULA_WRAP_MODE;
  const BLOCK_TAGS = new Set([
    "address",
    "article",
    "aside",
    "blockquote",
    "div",
    "dl",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "td",
    "th",
    "tr",
    "ul"
  ]);

  function isEditableSelectionTarget(node) {
    const element =
      node instanceof Element
        ? node
        : node instanceof Node
          ? node.parentElement
          : null;

    if (!(element instanceof Element)) {
      return false;
    }

    return Boolean(
      element.closest(
        "input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']"
      )
    );
  }

  function shouldSkipInvisibleElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    if (element.closest(".formula-copier-feedback, .voyager-branch-selection-root")) {
      return true;
    }

    const ariaHidden = element.getAttribute("aria-hidden");
    if (ariaHidden === "true" && !element.closest(".katex, .katex-display, mjx-container")) {
      return true;
    }

    if (element.hasAttribute("hidden")) {
      return true;
    }

    return false;
  }

  function normalizeInlineText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ");
  }

  function escapeMarkdownLinkText(text) {
    return String(text || "").replace(/]/g, "\\]");
  }

  function formatInlineCode(text) {
    const content = String(text || "").replace(/\n+$/g, "");
    const fence = content.includes("`") ? "``" : "`";
    return `${fence}${content}${fence}`;
  }

  function cleanupMarkdownSpacing(markdown) {
    const normalized = String(markdown || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n[ \t]+\n/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/ {2,}/g, " ")
      .replace(/([^\n ])  +([^\n])/g, "$1 $2")
      .trim();

    const lines = normalized.split("\n");
    let inCodeBlock = false;
    const cleanedLines = lines.map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        return trimmed;
      }

      if (inCodeBlock) {
        return line.replace(/[ \t]+$/g, "");
      }

      if (!trimmed) {
        return "";
      }

      if (/^(?:>|\- |\* |\d+\. )/.test(trimmed)) {
        return trimmed;
      }

      return trimmed;
    });

    return cleanedLines.join("\n").trim();
  }

  function isRangeNodeSelected(node, range) {
    if (!(node instanceof Node) || !(range instanceof Range)) {
      return false;
    }

    try {
      return range.intersectsNode(node);
    } catch {
      return false;
    }
  }

  function isFormulaElement(element) {
    return Boolean(
      element instanceof Element &&
        (
          element.matches(
            ".katex, .katex-display, .katex-mathml, mjx-container, math, [role='math'], cib-math"
          ) ||
          (element.tagName === "SPAN" &&
            element.querySelector?.(
              "annotation[encoding='application/x-tex'], annotation[encoding='text/x-latex']"
            ))
        )
    );
  }

  function isDisplayFormulaElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    if (element.matches(".katex-display")) {
      return true;
    }

    const display = window.getComputedStyle(element).display;
    return display === "block" || display === "flex";
  }

  function getSelectedTextContent(textNode, range) {
    const raw = String(textNode.textContent || "");
    let start = 0;
    let end = raw.length;

    if (textNode === range.startContainer) {
      start = Math.max(0, range.startOffset);
    }

    if (textNode === range.endContainer) {
      end = Math.min(raw.length, range.endOffset);
    }

    if (textNode === range.startContainer && textNode === range.endContainer) {
      start = Math.max(0, Math.min(range.startOffset, raw.length));
      end = Math.max(start, Math.min(range.endOffset, raw.length));
    }

    return raw.slice(start, end);
  }

  function getSelectedElementText(element, range) {
    if (!(element instanceof Element) || !(range instanceof Range)) {
      return "";
    }

    const fragment = range.cloneContents();
    const wrapper = document.createElement("div");
    wrapper.appendChild(fragment);
    return wrapper.textContent || "";
  }

  function serializeInlineChildren(node, range) {
    if (!(node instanceof Node)) {
      return "";
    }

    return Array.from(node.childNodes)
      .map((child) => serializeNodeToMarkdown(child, range, { preserveWhitespace: false }))
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/ {2,}/g, " ");
  }

  function serializeList(element, ordered, range) {
    const items = Array.from(element.children).filter(
      (child) =>
        child instanceof HTMLElement &&
        child.tagName === "LI" &&
        isRangeNodeSelected(child, range)
    );

    if (items.length === 0) {
      return "";
    }

    return `${items
      .map((item, index) => {
        const prefix = ordered ? `${index + 1}. ` : "- ";
        const body = serializeInlineChildren(item, range).trim().replace(/\n/g, "\n   ");
        return `${prefix}${body}`;
      })
      .join("\n")}\n\n`;
  }

  function serializeTable(element, range) {
    const rows = Array.from(element.querySelectorAll("tr"))
      .filter((row) => isRangeNodeSelected(row, range))
      .map((row) =>
        Array.from(row.children)
          .filter((cell) => /^(TH|TD)$/.test(cell.tagName))
          .map((cell) => serializeInlineChildren(cell, range).trim().replace(/\|/g, "\\|"))
      )
      .filter((row) => row.length > 0);

    if (rows.length === 0) {
      return "";
    }

    const header = rows[0];
    const separator = header.map(() => "---");
    const body = rows.slice(1);
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...body.map((row) => `| ${row.join(" | ")} |`)
    ];

    return `${lines.join("\n")}\n\n`;
  }

  function isAssistantTurnElement(element) {
    return Boolean(element instanceof Element && element.dataset?.turn === "assistant");
  }

  function getClosestAssistantMessageElement(node) {
    const element = getElementFromNode(node);

    if (!(element instanceof Element)) {
      return null;
    }

    const messageElement = element.closest(
      [
        '[data-message-author-role="assistant"]',
        '[data-testid="assistant-message"]',
        '[data-testid^="assistant-message"]',
        ".markdown"
      ].join(", ")
    );

    if (!(messageElement instanceof Element)) {
      return null;
    }

    const roleElement = messageElement.closest("[data-message-author-role]");
    if (
      roleElement instanceof Element &&
      roleElement.getAttribute("data-message-author-role") !== "assistant"
    ) {
      return null;
    }

    const turnElement = getClosestConversationTurnElement(messageElement);
    if (turnElement && !isAssistantTurnElement(turnElement)) {
      return null;
    }

    return messageElement;
  }

  function getMarkdownSelectionRoot(range) {
    const startTurn = getClosestConversationTurnElement(range.startContainer);
    const endTurn = getClosestConversationTurnElement(range.endContainer);

    if (startTurn && startTurn === endTurn && isAssistantTurnElement(startTurn)) {
      return (
        getClosestAssistantMessageElement(range.startContainer) ||
        startTurn.querySelector('[data-message-author-role="assistant"], .markdown') ||
        startTurn
      );
    }

    const startMessage = getClosestAssistantMessageElement(range.startContainer);
    const endMessage = getClosestAssistantMessageElement(range.endContainer);

    if (startMessage && startMessage === endMessage) {
      return startMessage;
    }

    return null;
  }

  function serializeNodeToMarkdown(node, range, context = {}) {
    if (!(node instanceof Node)) {
      return "";
    }

    if (node.nodeType === Node.TEXT_NODE) {
      if (!isRangeNodeSelected(node, range)) {
        return "";
      }
      return context.preserveWhitespace
        ? getSelectedTextContent(node, range)
        : normalizeInlineText(getSelectedTextContent(node, range));
    }

    if (
      !(node instanceof Element) ||
      shouldSkipInvisibleElement(node) ||
      !isRangeNodeSelected(node, range)
    ) {
      return "";
    }

    if (isFormulaElement(node)) {
      const latex =
        extractLatexSourceFromContainer(node) ||
        normalizeInlineText(getSelectedElementText(node, range) || node.textContent || "");

      if (!latex) {
        return "";
      }

      if (formulaWrapMode === MARKDOWN_FORMULA_WRAP_MODES.BARE) {
        return isDisplayFormulaElement(node) ? `\n${latex}\n` : latex;
      }

      return isDisplayFormulaElement(node) ? `\n$$${latex}$$\n` : `$${latex}$`;
    }

    const tagName = node.tagName.toLowerCase();

    if (tagName === "br") {
      return "\n";
    }

    if (tagName === "pre") {
      const code = node.querySelector("code");
      const languageClass = Array.from(code?.classList || []).find((className) =>
        className.startsWith("language-")
      );
      const language = languageClass ? languageClass.slice("language-".length) : "";
      const text = String(getSelectedElementText(code || node, range) || "").replace(/\n+$/g, "");
      return `\`\`\`${language}\n${text}\n\`\`\`\n\n`;
    }

    if (tagName === "code") {
      return formatInlineCode(getSelectedElementText(node, range) || "");
    }

    if (/^h[1-6]$/.test(tagName)) {
      const level = Number(tagName.slice(1)) || 1;
      const text = serializeInlineChildren(node, range).trim();
      return text ? `${"#".repeat(level)} ${text}\n\n` : "";
    }

    if (tagName === "p") {
      const text = serializeInlineChildren(node, range).trim();
      return text ? `${text}\n\n` : "";
    }

    if (tagName === "blockquote") {
      const text = cleanupMarkdownSpacing(
        Array.from(node.childNodes)
          .map((child) => serializeNodeToMarkdown(child, range, { preserveWhitespace: false }))
          .join("")
      );
      return text
        ? `${text
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")}\n\n`
        : "";
    }

    if (tagName === "ul") {
      return serializeList(node, false, range);
    }

    if (tagName === "ol") {
      return serializeList(node, true, range);
    }

    if (tagName === "table") {
      return serializeTable(node, range);
    }

    if (tagName === "strong" || tagName === "b") {
      const text = serializeInlineChildren(node, range).trim();
      return text ? `**${text}**` : "";
    }

    if (tagName === "em" || tagName === "i") {
      const text = serializeInlineChildren(node, range).trim();
      return text ? `*${text}*` : "";
    }

    if (tagName === "a") {
      const text =
        serializeInlineChildren(node, range).trim() ||
        normalizeInlineText(getSelectedElementText(node, range) || "");
      const href = String(node.getAttribute("href") || "").trim();
      if (!href) {
        return text;
      }
      return `[${escapeMarkdownLinkText(text)}](${href})`;
    }

    if (tagName === "hr") {
      return "\n---\n\n";
    }

    const rendered = Array.from(node.childNodes)
      .map((child) =>
        serializeNodeToMarkdown(child, range, {
          preserveWhitespace: context.preserveWhitespace || tagName === "pre"
        })
      )
      .join("");

    if (BLOCK_TAGS.has(tagName)) {
      if (tagName === "div" && !/\n/.test(rendered)) {
        return rendered;
      }
      return rendered;
    }

    return rendered;
  }

  function getMarkdownCopyPayload() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (
      isEditableSelectionTarget(range.startContainer) ||
      isEditableSelectionTarget(range.endContainer)
    ) {
      return null;
    }

    const assistantRoot = getMarkdownSelectionRoot(range);
    if (!(assistantRoot instanceof Element)) {
      return null;
    }

    const markdown = cleanupMarkdownSpacing(
      Array.from(assistantRoot.childNodes)
        .map((child) => serializeNodeToMarkdown(child, range, { preserveWhitespace: false }))
        .join("")
    );

    if (!markdown) {
      return null;
    }

    return markdown;
  }

  function handleCopy(event) {
    if (!enabled || !(event instanceof ClipboardEvent) || !event.clipboardData) {
      return;
    }

    const markdown = getMarkdownCopyPayload() || lastCopyPayload;

    if (!markdown) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    event.clipboardData.setData("text/plain", markdown);
    lastCopyPayload = markdown;
  }

  async function writeMarkdownToClipboard(markdown) {
    if (!markdown) {
      return false;
    }

    lastCopyPayload = markdown;

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(markdown);
        return true;
      } catch {}
    }

    return false;
  }

  function shouldHandleCopyShortcut(event) {
    if (!(event instanceof KeyboardEvent)) {
      return false;
    }

    if (event.defaultPrevented || event.repeat || event.altKey || event.shiftKey) {
      return false;
    }

    const isCopyKey = event.key.toLowerCase() === "c";
    const usesSystemModifier = navigator.platform.includes("Mac")
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;

    if (!isCopyKey || !usesSystemModifier) {
      return false;
    }

    return !isEditableSelectionTarget(event.target);
  }

  function handleCopyShortcut(event) {
    if (!enabled || !shouldHandleCopyShortcut(event)) {
      return;
    }

    const markdown = getMarkdownCopyPayload();
    if (!markdown) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    writeMarkdownToClipboard(markdown).catch(() => {});
  }

  return {
    getSelectionMarkdown() {
      return getMarkdownCopyPayload();
    },

    setFormulaWrapMode(nextMode) {
      formulaWrapMode = normalizeMarkdownFormulaWrapMode(nextMode);
    },

    enable() {
      if (enabled || !isChatGPTPage) {
        return;
      }

      enabled = true;
      document.addEventListener("keydown", handleCopyShortcut, true);
      document.addEventListener("copy", handleCopy, true);
    },

    disable() {
      if (!enabled) {
        return;
      }

      enabled = false;
      document.removeEventListener("keydown", handleCopyShortcut, true);
      document.removeEventListener("copy", handleCopy, true);
      lastCopyPayload = "";
    }
  };
})();

const enterEnhancerModule = (() => {
  let enabled = false;
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
    const editableTarget = getEditableEventTarget(event.target);

    if (event.isTriggeredByScript || !editableTarget) {
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

      simulateAdvancedEnter(editableTarget);

      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    editableTarget.dispatchEvent(
      createKeyEvent("keydown", { key: "Enter", shiftKey: true })
    );
  }

  function blockEnterPropagation(event) {
    if (event.isTriggeredByScript || !getEditableEventTarget(event.target)) {
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

  function isElementVisible(element) {
    return element.getClientRects().length > 0;
  }

  function getEditableEventTarget(target) {
    const element =
      target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;

    if (!(element instanceof Element)) {
      return null;
    }

    const editable = element.closest(EDITABLE_SELECTOR);

    if (!(editable instanceof HTMLElement) || !isElementVisible(editable)) {
      return null;
    }

    return editable;
  }

  return {
    enable() {
      if (enabled || !isChatGPTPage) {
        return;
      }

      enabled = true;
      document.addEventListener("keydown", handleKeyDown, true);
      document.addEventListener("keypress", blockEnterPropagation, true);
      document.addEventListener("keyup", blockEnterPropagation, true);
      console.log(`[${SCRIPT_NAME}] Enter 增强功能已开启。`);
    },

    disable() {
      if (!enabled) {
        return;
      }

      enabled = false;
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keypress", blockEnterPropagation, true);
      document.removeEventListener("keyup", blockEnterPropagation, true);
      console.log(`[${SCRIPT_NAME}] Enter 增强功能已关闭。`);
    }
  };
})();

const branchSelectionModule = (() => {
  const BRANCH_BUTTON_IDLE_LABEL = "分支提问";
  const BRANCH_BUTTON_LOADING_LABEL = "分支中…";
  const BRANCH_BUTTON_ERROR_LABEL = "重试分支";
  const SELECTION_IDLE_DELAY_MS = 300;
  const SELECTION_NAVIGATION_KEYS = new Set([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Escape"
  ]);
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
  let mouseSelectionInProgress = false;
  let mouseSelectionChanged = false;

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

  function clearSelectionSyncSchedule() {
    if (selectionRefreshFrame) {
      window.cancelAnimationFrame(selectionRefreshFrame);
      selectionRefreshFrame = null;
    }

    if (selectionRefreshTimer) {
      window.clearTimeout(selectionRefreshTimer);
      selectionRefreshTimer = null;
    }
  }

  function hasScheduledSelectionSync() {
    return Boolean(selectionRefreshFrame || selectionRefreshTimer);
  }

  function hasVisibleUi() {
    return Boolean(root && !root.hidden);
  }

  function hideUi() {
    activeSelection = null;
    clearErrorResetTimer();

    if (!root) {
      return;
    }

    if (root.hidden && !root.dataset.state) {
      return;
    }

    resetButtonState();
    root.hidden = true;
  }

  function hasExpandedSelection() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return false;
    }

    return Boolean(selection.toString().replace(/\u00a0/g, " ").trim());
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

    const markdown = markdownCopyModule.getSelectionMarkdown();

    if (!markdown) {
      return null;
    }

    return {
      markdown,
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

    const parent = document.body || document.documentElement;

    if (root.parentElement !== parent) {
      parent.appendChild(root);
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

  function scheduleSelectionSync(delayMs = 0, options = {}) {
    if (!enabled) {
      return;
    }

    const { hideFirst = true } = options;

    if (hideFirst && !actionInFlight) {
      hideUi();
    }

    clearSelectionSyncSchedule();

    const runSync = () => {
      selectionRefreshFrame = window.requestAnimationFrame(() => {
        selectionRefreshFrame = null;
        syncSelectionUi();
      });
    };

    if (delayMs <= 0) {
      runSync();
      return;
    }

    selectionRefreshTimer = window.setTimeout(() => {
      selectionRefreshTimer = null;
      runSync();
    }, delayMs);
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

  function formatBranchQuotedMarkdown(markdown) {
    const normalized = String(markdown || "").replace(/\r\n/g, "\n").trim();

    if (!normalized) {
      return "";
    }

    const quoted = normalized
      .split("\n")
      .map((line) => `>  ${line}`)
      .join("\n");

    return `${quoted}\n\n`;
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

    const rawText = String(text || "").replace(/\r\n/g, "\n");
    const draftText = rawText.trim();

    if (!draftText) {
      return false;
    }

    if (composerContainsText(draftText, composer)) {
      return true;
    }

    const nextText = rawText;

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
        text: formatBranchQuotedMarkdown(snapshot.markdown),
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

    scheduleSelectionSync(0, { hideFirst: false });
    consumePendingBranchDraft().catch((error) => {
      reportScriptError(`[${SCRIPT_NAME}] 恢复分支草稿失败。`, error);
    });
  }

  function handleSelectionChange() {
    if (!enabled || !mouseSelectionInProgress) {
      return;
    }

    mouseSelectionChanged = true;

    if (!actionInFlight && hasVisibleUi()) {
      hideUi();
    }

    if (hasScheduledSelectionSync()) {
      clearSelectionSyncSchedule();
    }
  }

  function handleDocumentMouseDown(event) {
    if (root && event.target instanceof Node && root.contains(event.target)) {
      return;
    }

    if (event instanceof MouseEvent && event.button !== 0) {
      return;
    }

    mouseSelectionInProgress = true;
    mouseSelectionChanged = false;

    if (!actionInFlight && hasVisibleUi()) {
      hideUi();
    }

    if (hasScheduledSelectionSync()) {
      clearSelectionSyncSchedule();
    }
  }

  function handleDocumentMouseUp(event) {
    if (root && event.target instanceof Node && root.contains(event.target)) {
      return;
    }

    if (event instanceof MouseEvent && event.button !== 0) {
      return;
    }

    mouseSelectionInProgress = false;

    if (!mouseSelectionChanged && !hasExpandedSelection()) {
      return;
    }

    mouseSelectionChanged = false;
    scheduleSelectionSync(SELECTION_IDLE_DELAY_MS, { hideFirst: false });
  }

  function isKeyboardEditableTarget(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    return Boolean(
      element.closest(
        "input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']"
      )
    );
  }

  function shouldHandleKeyboardSelectionChange(event) {
    if (!(event instanceof KeyboardEvent)) {
      return false;
    }

    if (isKeyboardEditableTarget(event.target)) {
      return false;
    }

    if (SELECTION_NAVIGATION_KEYS.has(event.key)) {
      return true;
    }

    return (
      event.key.toLowerCase() === "a" &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey
    );
  }

  function handleKeyboardSelectionChange(event) {
    if (!shouldHandleKeyboardSelectionChange(event)) {
      return;
    }

    scheduleSelectionSync(0, { hideFirst: false });
  }

  function handleSelectionViewportChange() {
    if (!enabled) {
      return;
    }

    if (!activeSelection && (!root || root.hidden)) {
      return;
    }

    scheduleSelectionSync(0, { hideFirst: false });
  }

  return {
    enable() {
      if (enabled || !isChatGPTPage) {
        return;
      }

      enabled = true;
      ensureUi();
      document.addEventListener("selectionchange", handleSelectionChange, true);
      document.addEventListener("mouseup", handleDocumentMouseUp, true);
      document.addEventListener("keyup", handleKeyboardSelectionChange, true);
      document.addEventListener("mousedown", handleDocumentMouseDown, true);
      window.addEventListener("resize", handleSelectionViewportChange);
      window.addEventListener("scroll", handleSelectionViewportChange, true);
      window.addEventListener("pageshow", handleVisibilityChange);
      document.addEventListener("visibilitychange", handleVisibilityChange);
      scheduleSelectionSync(0, { hideFirst: false });
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
      clearSelectionSyncSchedule();

      document.removeEventListener("selectionchange", handleSelectionChange, true);
      document.removeEventListener("mouseup", handleDocumentMouseUp, true);
      document.removeEventListener("keyup", handleKeyboardSelectionChange, true);
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
      mouseSelectionInProgress = false;
      mouseSelectionChanged = false;
    }
  };
})();

// Adapted from noeqtion by voidCounter:
// https://github.com/voidCounter/noeqtion
const notionMathConverterModule = (() => {
  const EQUATION_REGEX = /(\$\$[\s\S]*?\$\$|\$[^\$\n]*?\$)/;
  const TIMING = {
    FOCUS: 50,
    QUICK: 20,
    DIALOG: 100,
    MATH_BLOCK: 100,
    POST_CONVERT: 300,
    PASTE_SETTLE: 900,
    CHUNK: 20
  };
  const LONG_TEXT_CHUNK_SIZE = 320;

  let enabled = false;
  let pasteTimer = null;
  let lastPasteSignature = "";

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function injectCSS(css) {
    const style = document.createElement("style");
    style.type = "text/css";
    style.id = "voyager-notion-math-converter-hide-dialog";
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  function removeInjectedCSS() {
    document.getElementById("voyager-notion-math-converter-hide-dialog")?.remove();
  }

  function getClosestEditableLeaf(node) {
    if (!node) {
      return null;
    }

    const element = node instanceof Element ? node : node.parentElement;
    return element?.closest?.('[data-content-editable-leaf="true"]') || null;
  }

  function getCurrentEditableLeaf() {
    const fromActiveElement = getClosestEditableLeaf(document.activeElement);
    if (fromActiveElement) {
      return fromActiveElement;
    }

    const selection = window.getSelection();
    if (!selection) {
      return null;
    }

    return (
      getClosestEditableLeaf(selection.anchorNode) ||
      getClosestEditableLeaf(selection.focusNode)
    );
  }

  function isInsideTransientUi(node) {
    const element = node instanceof Element ? node : node?.parentElement;
    return Boolean(
      element?.closest?.(
        'div[role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-overlay-container="true"]'
      )
    );
  }

  function isTextNodeConvertible(node) {
    if (!(node instanceof Text) || !node.nodeValue || !EQUATION_REGEX.test(node.nodeValue)) {
      return false;
    }

    const parentElement = node.parentElement;
    if (!(parentElement instanceof Element)) {
      return false;
    }

    if (!getClosestEditableLeaf(parentElement)) {
      return false;
    }

    if (isInsideTransientUi(parentElement)) {
      return false;
    }

    if (
      parentElement.closest(
        "style, script, textarea, code, pre, .katex, .katex-display, mjx-container"
      )
    ) {
      return false;
    }

    return true;
  }

  async function dismissTransientNotionUi() {
    dispatchKeyEvent("Escape", { keyCode: 27 });
    await delay(30);
    dispatchKeyEvent("Escape", { keyCode: 27 });
    await delay(60);

    const editableLeaf =
      getCurrentEditableLeaf() ||
      document.querySelector('[data-content-editable-leaf="true"]');
    if (editableLeaf instanceof HTMLElement) {
      editableLeaf.click();
      await delay(TIMING.FOCUS);
    }
  }

  function findEquations(scope = "all") {
    const textNodes = [];
    const searchRoots = [];
    const activeLeaf = getCurrentEditableLeaf();

    if (scope === "active" && activeLeaf) {
      searchRoots.push(activeLeaf);
    } else {
      if (activeLeaf) {
        searchRoots.push(activeLeaf);
      }
      searchRoots.push(document.body);
    }

    const visitedRoots = new Set();

    for (const root of searchRoots) {
      if (!(root instanceof Node) || visitedRoots.has(root)) {
        continue;
      }

      visitedRoots.add(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return isTextNodeConvertible(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
      });

      let node = null;
      while ((node = walker.nextNode())) {
        textNodes.push(node);
      }
    }

    if (scope === "active") {
      return textNodes;
    }

    return textNodes.filter((node, index) => textNodes.indexOf(node) === index);
  }

  function findEditableParent(node) {
    let parent = node?.parentElement || null;
    while (
      parent &&
      parent.getAttribute("data-content-editable-leaf") !== "true"
    ) {
      parent = parent.parentElement;
    }
    return parent;
  }

  function selectText(node, startIndex, length) {
    const range = document.createRange();
    range.setStart(node, startIndex);
    range.setEnd(node, startIndex + length);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function isEditableElement(element) {
    return Boolean(
      element &&
      (element.isContentEditable ||
        element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA")
    );
  }

  function dispatchKeyEvent(key, options = {}) {
    const activeElement = document.activeElement;
    if (!activeElement) {
      return;
    }

    activeElement.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code: options.code || `Key${String(key).toUpperCase()}`,
        keyCode: options.keyCode || 0,
        which: options.keyCode || 0,
        ctrlKey: Boolean(options.ctrlKey),
        shiftKey: Boolean(options.shiftKey),
        bubbles: true,
        cancelable: true
      })
    );
  }

  function replaceSelectionWithText(text) {
    const normalizedText = String(text || "");
    if (!normalizedText) {
      return;
    }

    if (document.queryCommandSupported?.("insertText")) {
      const inserted = document.execCommand("insertText", false, normalizedText);
      if (inserted) {
        return;
      }
    }

    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(normalizedText);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    textNode.parentElement?.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }

  function insertTextIntoActiveElement(element, text) {
    if (!element) {
      return;
    }

    if (element.value !== undefined) {
      element.value = text;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    document.execCommand("insertText", false, text);
  }

  function isMathInputCandidate(element) {
    return Boolean(
      isEditableElement(element) &&
        (element.closest?.('div[role="dialog"]') ||
          element.getAttribute?.("data-content-editable-leaf") === "true")
    );
  }

  async function waitForMathInputReady(previousEditable = null, timeoutMs = 2500) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const active = document.activeElement;
      if (isMathInputCandidate(active) && active !== previousEditable) {
        return active;
      }

      const dialogEditable = document.querySelector(
        'div[role="dialog"] [contenteditable="true"], div[role="dialog"] textarea, div[role="dialog"] input'
      );
      if (isMathInputCandidate(dialogEditable) && dialogEditable !== previousEditable) {
        dialogEditable.focus();
        return dialogEditable;
      }

      await delay(40);
    }

    return isMathInputCandidate(document.activeElement) &&
      document.activeElement !== previousEditable
      ? document.activeElement
      : null;
  }

  function getEditableTextSnapshot(element) {
    if (!element) {
      return "";
    }

    if (typeof element.value === "string") {
      return element.value;
    }

    return element.textContent || "";
  }

  function normalizeEditableText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function clearSelectedEquationText(editableParent) {
    const selection = window.getSelection();
    selection?.deleteFromDocument();
    await delay(TIMING.FOCUS);

    const activeElement = document.activeElement;
    if (activeElement && activeElement === editableParent) {
      activeElement.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "deleteContentBackward",
          data: null
        })
      );
    }

    const snapshot = normalizeEditableText(getEditableTextSnapshot(editableParent));
    return snapshot.length === 0;
  }

  async function insertLongTextInChunks(element, text) {
    const chunks = [];
    const source = String(text || "");

    for (let i = 0; i < source.length; i += LONG_TEXT_CHUNK_SIZE) {
      chunks.push(source.slice(i, i + LONG_TEXT_CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      insertTextIntoActiveElement(element, chunk);
      await delay(TIMING.CHUNK);
    }
  }

  function clickDoneButton() {
    const doneButton = Array.from(document.querySelectorAll('[role="button"]')).find(
      (button) => button.textContent?.includes("Done")
    );

    if (doneButton) {
      doneButton.click();
      return true;
    }

    return false;
  }

  async function convertDisplayEquation(latexContent, sourceEditableLeaf = null) {
    const sourceCleared = await clearSelectedEquationText(sourceEditableLeaf);
    if (!sourceCleared) {
      console.warn(`[${SCRIPT_NAME}] 源块未成功清空，已跳过块级公式转换以避免重复生成。`);
      dispatchKeyEvent("Escape", { keyCode: 27 });
      await delay(TIMING.POST_CONVERT);
      return;
    }

    document.execCommand("insertText", false, "/math");
    await delay(TIMING.DIALOG);

    dispatchKeyEvent("Enter", { keyCode: 13 });
    await delay(TIMING.MATH_BLOCK);

    const mathInput = await waitForMathInputReady(sourceEditableLeaf);
    if (isEditableElement(mathInput)) {
      await insertLongTextInChunks(mathInput, latexContent);

      const snapshot = getEditableTextSnapshot(mathInput);
      if (!snapshot || !snapshot.includes(latexContent.slice(0, Math.min(24, latexContent.length)))) {
        await delay(TIMING.DIALOG);
        await insertLongTextInChunks(mathInput, latexContent);
      }
    } else {
      console.warn(`[${SCRIPT_NAME}] 未找到新的 Notion 公式输入框，已跳过写入以避免重复生成。`);
      dispatchKeyEvent("Escape", { keyCode: 27 });
      await delay(TIMING.POST_CONVERT);
      return;
    }

    await delay(TIMING.DIALOG);

    const hasError = document.querySelector('div[role="alert"]') !== null;
    if (hasError) {
      console.warn(`[${SCRIPT_NAME}] Notion 公式转换检测到 KaTeX 错误，已关闭对话框。`);
      dispatchKeyEvent("Escape", { keyCode: 27 });
    } else if (!clickDoneButton()) {
      dispatchKeyEvent("Escape", { keyCode: 27 });
    }

    await delay(TIMING.POST_CONVERT);
  }

  async function convertInlineEquation(latexContent) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) {
      console.warn(`[${SCRIPT_NAME}] 没有选中可转换的行内公式文本。`);
      return;
    }

    document.execCommand("insertText", false, `$$${latexContent}$$`);
    await delay(TIMING.POST_CONVERT);
  }

  async function convertSingleEquation(node, equationText) {
    try {
      const startIndex = node.nodeValue.indexOf(equationText);
      if (startIndex === -1) {
        return false;
      }

      const editableParent = findEditableParent(node);
      if (!editableParent) {
        return false;
      }

      editableParent.click();
      await delay(TIMING.FOCUS);
      selectText(node, startIndex, equationText.length);
      await delay(TIMING.QUICK);

      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.toString() !== equationText) {
        return false;
      }

      const isDisplayEquation =
        equationText.startsWith("$$") && equationText.endsWith("$$");
      const latexContent = isDisplayEquation
        ? equationText.slice(2, -2).trim()
        : equationText.slice(1, -1);

      if (isDisplayEquation) {
        await convertDisplayEquation(latexContent, editableParent);
      } else {
        await convertInlineEquation(latexContent);
      }
      return true;
    } catch (error) {
      console.error(`[${SCRIPT_NAME}] Notion 公式转换失败。`, error);
      return false;
    }
  }

  async function convertMathEquations(scope = "all") {
    injectCSS(
      'div[role="dialog"] { opacity: 0 !important; transform: scale(0.001) !important; } ' +
        '[role="menu"] { opacity: 0 !important; transform: scale(0.001) !important; pointer-events: none !important; } ' +
        '[role="listbox"] { opacity: 0 !important; transform: scale(0.001) !important; pointer-events: none !important; } ' +
        ".notion-text-action-menu { opacity: 0 !important; transform: scale(0.001) !important; pointer-events: none !important; }"
    );

    let convertedCount = 0;
    let lastAttemptSignature = "";

    try {
      await dismissTransientNotionUi();

      while (true) {
        const equations = findEquations(scope);
        if (equations.length === 0) {
          break;
        }

        const node = equations[0];
        const match = node.nodeValue?.match(EQUATION_REGEX);
        if (!match?.[0]) {
          break;
        }

        const attemptSignature = `${match[0]}::${node.nodeValue}`;
        if (attemptSignature === lastAttemptSignature) {
          console.warn(`[${SCRIPT_NAME}] 同一公式连续转换未产生进展，已停止本轮转换。`, {
            equation: match[0]
          });
          break;
        }

        const converted = await convertSingleEquation(node, match[0]);
        if (!converted) {
          lastAttemptSignature = attemptSignature;
          break;
        }

        convertedCount += 1;
        lastAttemptSignature = "";
      }
    } finally {
      removeInjectedCSS();
    }

    return convertedCount;
  }

  function hasPendingEquations(scope = "active") {
    return findEquations(scope).length > 0;
  }

  async function runPasteTriggeredConversion(signature) {
    if (!enabled || lastPasteSignature !== signature) {
      return;
    }

    await convertMathEquations("all");
  }

  function schedulePasteTriggeredConversion(clipboardText) {
    const text = String(clipboardText || "").trim();
    if (!text || !EQUATION_REGEX.test(text)) {
      return;
    }

    const signature = `${Date.now()}:${text.slice(0, 200)}`;
    lastPasteSignature = signature;

    if (pasteTimer) {
      window.clearTimeout(pasteTimer);
      pasteTimer = null;
    }

    pasteTimer = window.setTimeout(() => {
      pasteTimer = null;
      if (lastPasteSignature !== signature) {
        return;
      }

      runPasteTriggeredConversion(signature).catch((error) => {
        console.error(`[${SCRIPT_NAME}] Notion 粘贴后公式自动转换失败。`, error);
      });
    }, TIMING.PASTE_SETTLE);
  }

  function handleKeyDown(event) {
    if (
      event.ctrlKey &&
      event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      (event.key === "M" || event.key === "m")
    ) {
      event.preventDefault();
      convertMathEquations("all").catch((error) => {
        console.error(`[${SCRIPT_NAME}] Notion 公式批量转换失败。`, error);
      });
    }
  }

  function handlePaste(event) {
    if (!enabled || !(event instanceof ClipboardEvent)) {
      return;
    }

    const clipboardText = event.clipboardData?.getData("text/plain") || "";
    if (!clipboardText || !clipboardText.includes("$")) {
      return;
    }

    schedulePasteTriggeredConversion(clipboardText);
  }

  return {
    enable() {
      if (enabled || !isNotionPage) {
        return;
      }

      enabled = true;
      document.addEventListener("keydown", handleKeyDown, true);
      document.addEventListener("paste", handlePaste, true);
      console.log(
        `[${SCRIPT_NAME}] Notion 公式转换已开启。快捷键：Ctrl+Alt+M，粘贴含 $ / $$ 时会自动尝试转换。来源：voidCounter/noeqtion`
      );
    },

    disable() {
      if (!enabled) {
        return;
      }

      enabled = false;
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("paste", handlePaste, true);
      if (pasteTimer) {
        window.clearTimeout(pasteTimer);
        pasteTimer = null;
      }
      lastPasteSignature = "";
      removeInjectedCSS();
      console.log(`[${SCRIPT_NAME}] Notion 公式转换已关闭。`);
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
  let lightConversationButton = null;
  let lightConversationHint = null;
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
  let collapseSettings = {
    enabled: Boolean(DEFAULT_SETTINGS.chatgptLongConversationCollapseEnabled),
    keepLatest: DEFAULT_SETTINGS.chatgptCollapseKeepLatest || 20
  };
  let draggedPromptId = "";
  let normalizedPromptSeed = 0;
  let normalizedHistorySeed = 0;
  const HEADER_SHARE_BUTTON_SELECTOR =
    "button[aria-label*='分享'], button[aria-label*='Share'], button[data-testid='share-chat-button']";
  const HEADER_MOUNT_TRIGGER_SELECTOR = [
    "#conversation-header-actions",
    "[data-testid='model-switcher-dropdown-button']",
    HEADER_SHARE_BUTTON_SELECTOR
  ].join(", ");
  const HEADER_MOUNT_IGNORE_SELECTOR =
    "#prompt-textarea, .voyager-gpt-entry-root, .voyager-gpt-panel, .voyager-gpt-modal-overlay";

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

  function normalizeCollapseKeepLatest(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      return DEFAULT_SETTINGS.chatgptCollapseKeepLatest || 20;
    }

    return Math.min(Math.max(Math.trunc(numberValue), 1), 1000);
  }

  function getLightConversationState() {
    const apiState =
      typeof globalThis.ChatGPTVoyagerCollapse?.getState === "function"
        ? globalThis.ChatGPTVoyagerCollapse.getState()
        : {};

    return {
      enabled: Boolean(collapseSettings.enabled && apiState.enabled !== false),
      keepLatest: normalizeCollapseKeepLatest(apiState.keepLatest || collapseSettings.keepLatest),
      collapsedCount: Number(apiState.collapsedCount || 0),
      isConversationRoute: apiState.isConversationRoute !== false
    };
  }

  function updateLightConversationUi(message = "") {
    if (!lightConversationButton) {
      return;
    }

    const state = getLightConversationState();
    const enabled = state.enabled && state.isConversationRoute;
    lightConversationButton.disabled = !enabled;
    lightConversationButton.dataset.action = state.collapsedCount > 0 ? "restore" : "collapse";
    lightConversationButton.textContent = state.collapsedCount > 0 ? "恢复" : "轻量对话";
    if (lightConversationHint) {
      lightConversationHint.textContent =
        message ||
        (enabled
          ? `隐藏较早消息，仅保留最近 ${state.keepLatest} 轮；可随时恢复。`
          : "请先在 popup 或设置页开启长对话折叠。");
    }

    if (message) {
      lightConversationButton.title = message;
    } else {
      lightConversationButton.title = enabled
        ? `保留最近 ${state.keepLatest} 轮对话`
        : "请先在 popup 或设置页开启长对话折叠。";
    }
  }

  function runLightConversationAction(action) {
    const api = globalThis.ChatGPTVoyagerCollapse;
    if (!api || typeof api[action] !== "function") {
      const message = "轻量对话模块还没有准备好，请稍后再试。";
      setStatus(message);
      updateLightConversationUi(message);
      return;
    }

    const result = api[action]();
    const message =
      result?.message ||
      (action === "collapse" ? "轻量对话已处理。" : "已恢复隐藏消息。");
    setStatus(message);
    updateLightConversationUi(message);
  }

  function sortPrompts(prompts) {
    return [...(Array.isArray(prompts) ? prompts : [])].sort((a, b) => {
      const pinnedDiff = Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned));
      return pinnedDiff;
    });
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

  function normalizePromptEntry(entry) {
    if (typeof entry === "string") {
      normalizedPromptSeed += 1;

      return {
        id: `legacy-prompt-${normalizedPromptSeed}`,
        name: `提示词 ${normalizedPromptSeed}`,
        content: entry,
        updatedAt: 0,
        pinned: false
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
          : 0,
      pinned: Boolean(entry.pinned)
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
          .sort((a, b) => {
            const pinnedDiff = Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned));
            if (pinnedDiff !== 0) return pinnedDiff;
            return (b?.updatedAt || 0) - (a?.updatedAt || 0);
          })
      : [];
  }

  async function persistPromptList(prompts, message) {
    const nextPrompts = sortPrompts(prompts);
    await writeLocalStorage({
      [STORAGE_KEYS.SAVED_PROMPTS]: nextPrompts
    });

    normalizedPromptSeed = 0;
    cachedPrompts = Array.isArray(nextPrompts)
      ? sortPrompts(nextPrompts.map((entry) => normalizePromptEntry(entry)).filter(Boolean))
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
    if (!root) return;
  
    const header = document.querySelector('#page-header');
    if (!header) return;
  
    // 获取第二个子 div（即包含模型选择器和 ChatGPT 文字的那个）
    if (root.parentElement !== header) {
        header.appendChild(root);
    } else if (header.lastElementChild !== root) {
        header.appendChild(root);
    }
  
    // 将 root 放入 header 并保证位于最后

  
    // 设置 header 布局
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
  
    // 移除绝对定位相关的样式和变量
    root.style.position = 'relative';
    root.style.top = 'auto';
    root.style.left = 'auto';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    root.style.removeProperty('--voyager-gpt-entry-height');
    lastRootEntryHeightPx = '';   // 假设这是外部变量
    root.classList.remove('voyager-gpt-entry-root-inline');
  
    // 可选：调整 root 自身外观
    root.style.marginLeft = '6px';
    root.style.flexShrink = '0';
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

    const lightSection = document.createElement("section");
    lightSection.className = "voyager-gpt-panel-light";

    const lightActions = document.createElement("div");
    lightActions.className = "voyager-gpt-panel-light-actions";

    lightConversationButton = document.createElement("button");
    lightConversationButton.type = "button";
    lightConversationButton.className = "voyager-gpt-panel-light-button";
    lightConversationButton.textContent = "轻量对话";
    lightConversationButton.addEventListener("click", () => {
      runLightConversationAction(
        lightConversationButton?.dataset.action === "restore" ? "restore" : "collapse"
      );
    });

    lightActions.appendChild(lightConversationButton);
    lightConversationHint = document.createElement("p");
    lightConversationHint.className = "voyager-gpt-panel-light-hint";
    lightActions.appendChild(lightConversationHint);
    lightSection.appendChild(lightActions);

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
    panel.appendChild(lightSection);
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

    sortPrompts(cachedPrompts).slice(0, 8).forEach((prompt) => {
      const item = document.createElement("article");
      item.className = "voyager-gpt-panel-item";
      item.dataset.id = prompt.id;
      item.draggable = !prompt.pinned;
      if (!prompt.pinned) {
        item.classList.add("voyager-gpt-panel-item-draggable");
      }

      const contentButton = document.createElement("button");
      contentButton.type = "button";
      contentButton.className = "voyager-gpt-panel-item-button";

      const topRow = document.createElement("span");
      topRow.className = "voyager-gpt-panel-item-row";

      const title = document.createElement("span");
      title.className = "voyager-gpt-panel-item-title";
      title.textContent = prompt.name || "未命名提示词";

      topRow.appendChild(title);

      const preview = document.createElement("span");
      preview.className = "voyager-gpt-panel-item-meta";
      preview.textContent = truncateText(prompt.content, 80) || "提示词内容为空";

      contentButton.appendChild(topRow);
      contentButton.appendChild(preview);
      contentButton.title = "左键复制，右键编辑";
      contentButton.addEventListener("click", async () => {
        const content = String(prompt.content || "").trim();

        if (!content) {
          setStatus("该提示词内容为空。");
          return;
        }

        await copyTextToClipboard(content);
        setStatus(`提示词「${prompt.name || "未命名"}」已复制。`);
      });
      contentButton.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startPromptEdit(prompt);
      });

      const pinButton = document.createElement("button");
      pinButton.type = "button";
      pinButton.className = "voyager-gpt-panel-pin-button";
      if (prompt.pinned) {
        pinButton.classList.add("is-active");
      }
      pinButton.setAttribute("aria-label", prompt.pinned ? "取消置顶" : "置顶");
      pinButton.title = prompt.pinned ? "取消置顶" : "置顶";
      pinButton.appendChild(createPinIcon());
      pinButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        try {
          const prompts = await getStoredPrompts();
          const nextPrompts = prompts.map((entry) =>
            entry.id === prompt.id
              ? {
                  ...entry,
                  pinned: !entry.pinned,
                  updatedAt: entry.updatedAt || Date.now()
                }
              : entry
          );
          await persistPromptList(
            nextPrompts,
            `提示词「${prompt.name || "未命名提示词"}」${prompt.pinned ? "已取消置顶" : "已置顶"}。`
          );
        } catch (error) {
          reportScriptError(`[${SCRIPT_NAME}] 更新提示词置顶状态失败。`, error);
          setStatus("更新提示词置顶状态失败。");
        }
      });

      item.appendChild(contentButton);
      item.appendChild(pinButton);
      item.addEventListener("dragstart", (event) => {
        if (prompt.pinned) {
          event.preventDefault();
          return;
        }
        draggedPromptId = prompt.id || "";
        item.classList.add("is-dragging");
        event.dataTransfer?.setData("text/plain", draggedPromptId);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("is-dragging");
      });
      item.addEventListener("dragover", (event) => {
        if (prompt.pinned) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
      });
      item.addEventListener("drop", async (event) => {
        if (prompt.pinned) {
          return;
        }
        event.preventDefault();
        const sourceId = draggedPromptId || event.dataTransfer?.getData("text/plain") || "";
        draggedPromptId = "";
        if (!sourceId || sourceId === prompt.id) {
          return;
        }

        try {
          const prompts = await getStoredPrompts();
          const nextPrompts = reorderNonPinnedPrompts(prompts, sourceId, prompt.id);
          await persistPromptList(nextPrompts, "提示词顺序已更新。");
        } catch (error) {
          reportScriptError(`[${SCRIPT_NAME}] 更新页内提示词顺序失败。`, error);
          setStatus("更新提示词顺序失败。");
        }
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
      updateLightConversationUi();
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
      [STORAGE_KEYS.FORMULA_HISTORY]: [],
      chatgptLongConversationCollapseEnabled:
        DEFAULT_SETTINGS.chatgptLongConversationCollapseEnabled,
      chatgptCollapseKeepLatest: DEFAULT_SETTINGS.chatgptCollapseKeepLatest
    });

    collapseSettings = {
      enabled: Boolean(stored.chatgptLongConversationCollapseEnabled),
      keepLatest: normalizeCollapseKeepLatest(stored.chatgptCollapseKeepLatest)
    };

    normalizedPromptSeed = 0;
    normalizedHistorySeed = 0;
    cachedPrompts = Array.isArray(stored[STORAGE_KEYS.SAVED_PROMPTS])
      ? stored[STORAGE_KEYS.SAVED_PROMPTS]
          .map((entry) => normalizePromptEntry(entry))
          .sort((a, b) => {
            const pinnedDiff = Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned));
            if (pinnedDiff !== 0) return pinnedDiff;
            return (b?.updatedAt || 0) - (a?.updatedAt || 0);
          })
          .filter(Boolean)
      : [];
    cachedHistory = Array.isArray(stored[STORAGE_KEYS.FORMULA_HISTORY])
      ? clampFormulaHistoryItems(
          stored[STORAGE_KEYS.FORMULA_HISTORY]
        )
          .map((entry) => normalizeHistoryEntry(entry))
          .filter(Boolean)
      : [];
    updateLightConversationUi();
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

  function shouldIgnoreMountMutationNode(node) {
    return (
      node instanceof Element &&
      Boolean(node.closest(HEADER_MOUNT_IGNORE_SELECTOR))
    );
  }

  function nodeMatchesHeaderMountTrigger(node) {
    if (!(node instanceof Element) || shouldIgnoreMountMutationNode(node)) {
      return false;
    }

    if (node.matches(HEADER_MOUNT_TRIGGER_SELECTOR)) {
      return true;
    }

    return Boolean(node.querySelector(HEADER_MOUNT_TRIGGER_SELECTOR));
  }

  function shouldScheduleMountFromMutations(mutations) {
    for (const mutation of mutations) {
      if (shouldIgnoreMountMutationNode(mutation.target)) {
        continue;
      }

      if (nodeMatchesHeaderMountTrigger(mutation.target)) {
        return true;
      }

      for (const node of mutation.addedNodes) {
        if (shouldIgnoreMountMutationNode(node)) {
          continue;
        }

        if (nodeMatchesHeaderMountTrigger(node)) {
          return true;
        }
      }

      for (const node of mutation.removedNodes) {
        if (shouldIgnoreMountMutationNode(node)) {
          continue;
        }

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

    mountObserver.observe(document.body || document.documentElement, {
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
        lightConversationButton = null;
        lightConversationHint = null;
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
  markdownCopyModule.disable();
  branchSelectionModule.disable();
  chatgptHeaderEntryModule.disable();
  notionMathConverterModule.disable();
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
    markdownCopyModule.enable();
    branchSelectionModule.enable();
    chatgptHeaderEntryModule.enable();
  }

  formulaCopierModule.setCopyFormat(settings.formulaCopyFormat);
  markdownCopyModule.setFormulaWrapMode(settings.markdownFormulaWrapMode);

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

  if (isNotionPage) {
    notionMathConverterModule.enable();
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
    "chatgptLongConversationCollapseEnabled" in changes ||
    "chatgptCollapseKeepLatest" in changes ||
    "notionCloseGuardEnabled" in changes
  ) {
    syncSettings().catch((error) => {
      markExtensionContextInvalidated(error);
      reportScriptError(`[${SCRIPT_NAME}] 同步设置失败。`, error);
    });
  }

  if (
    STORAGE_KEYS.FORMULA_HISTORY in changes ||
    STORAGE_KEYS.SAVED_PROMPTS in changes ||
    "chatgptLongConversationCollapseEnabled" in changes ||
    "chatgptCollapseKeepLatest" in changes
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
