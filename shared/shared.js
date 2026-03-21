(() => {
  const FORMULA_COPY_FORMATS = {
    LATEX_INLINE: "latex",
    UNICODE_MATH: "unicode-math",
    LATEX_SOURCE: "latex-source"
  };

  const FORMULA_COPY_FORMAT_LABELS = {
    [FORMULA_COPY_FORMATS.LATEX_INLINE]: "LaTeX",
    [FORMULA_COPY_FORMATS.UNICODE_MATH]: "UnicodeMath (Word)",
    [FORMULA_COPY_FORMATS.LATEX_SOURCE]: "LaTeX (纯文本，无 $ 符号)"
  };

  const STORAGE_KEYS = {
    FORMULA_HISTORY: "formulaCopyHistory",
    SAVED_PROMPTS: "savedPrompts"
  };

  const MAX_FORMULA_HISTORY_ITEMS = 30;
  const DEFAULT_SETTINGS = {
    formulaCopierEnabled: true,
    formulaCopyFormat: FORMULA_COPY_FORMATS.LATEX_SOURCE,
    enterEnhancerEnabled: true,
    notionCloseGuardEnabled: true
  };

  const DEFAULT_LOCAL_DATA = {
    ...DEFAULT_SETTINGS,
    [STORAGE_KEYS.FORMULA_HISTORY]: [],
    [STORAGE_KEYS.SAVED_PROMPTS]: []
  };

  function normalizeFormulaCopyFormat(value) {
    const normalizedValue =
      value === "mathml" ? FORMULA_COPY_FORMATS.UNICODE_MATH : value;

    return Object.values(FORMULA_COPY_FORMATS).includes(normalizedValue)
      ? normalizedValue
      : DEFAULT_SETTINGS.formulaCopyFormat;
  }

  function createItemId(prefix = "item") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function truncateText(value, maxLength = 90) {
    const normalizedValue = normalizeWhitespace(value);

    if (normalizedValue.length <= maxLength) {
      return normalizedValue;
    }

    return `${normalizedValue.slice(0, maxLength - 1)}…`;
  }

  function clampFormulaHistoryItems(history) {
    return Array.isArray(history)
      ? history.slice(0, MAX_FORMULA_HISTORY_ITEMS)
      : [];
  }

  function getFormulaHistoryLatex(entry) {
    if (!entry || typeof entry !== "object") {
      return "";
    }

    const latexSource = String(entry.latexSource || "").trim();

    if (latexSource) {
      return latexSource;
    }

    const text = String(entry.text || "").trim();

    if (!text) {
      return "";
    }

    if (text.startsWith("$") && text.endsWith("$") && text.length > 2) {
      return text.slice(1, -1).trim();
    }

    return text;
  }

  function convertLatexToUnicodeMath(latex) {
    if (
      !globalThis.texToUnicodeMath ||
      typeof globalThis.texToUnicodeMath.convertLatexToUnicodeMath !== "function"
    ) {
      return "";
    }

    try {
      const unicodeMath = globalThis.texToUnicodeMath.convertLatexToUnicodeMath(latex);
      return typeof unicodeMath === "string" ? unicodeMath.trim() : "";
    } catch (error) {
      console.warn("[ChatGPT-Voyager] LaTeX 预览转换失败。", { latex, error });
      return "";
    }
  }

  function getFormulaPreviewText(entry) {
    const latex = getFormulaHistoryLatex(entry);

    if (!latex) {
      return "";
    }

    return normalizeWhitespace(convertLatexToUnicodeMath(latex) || latex);
  }

  function renderFormulaPreview(element, entry, options = {}) {
    if (!(element instanceof Element)) {
      return false;
    }

    const latex = getFormulaHistoryLatex(entry);
    const fallbackText =
      typeof options.fallbackText === "string" && options.fallbackText
        ? options.fallbackText
        : "未识别公式";

    element.textContent = "";
    element.dataset.formulaPreview = "text";

    if (!latex) {
      element.textContent = fallbackText;
      return false;
    }

    element.setAttribute("title", latex);

    if (globalThis.katex && typeof globalThis.katex.render === "function") {
      try {
        globalThis.katex.render(latex, element, {
          throwOnError: true,
          displayMode: Boolean(options.displayMode),
          output: "htmlAndMathml",
          strict: "ignore"
        });
        element.dataset.formulaPreview = "katex";
        return true;
      } catch (error) {
        console.warn("[ChatGPT-Voyager] KaTeX 渲染失败，回退到文本预览。", {
          latex,
          error
        });
      }
    }

    element.textContent = getFormulaPreviewText(entry) || fallbackText;
    return false;
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) {
      return "";
    }

    try {
      return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(timestamp));
    } catch (error) {
      return "";
    }
  }

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

  async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        console.warn("[ChatGPT-Voyager] Clipboard API 复制失败，回退到 execCommand。", error);
      }
    }

    copyTextWithFallback(text);
  }

  async function saveFormulaHistoryEntry(entry) {
    const storage = await chrome.storage.local.get({
      [STORAGE_KEYS.FORMULA_HISTORY]: []
    });
    const existingHistory = Array.isArray(storage[STORAGE_KEYS.FORMULA_HISTORY])
      ? storage[STORAGE_KEYS.FORMULA_HISTORY]
      : [];

    const nextEntry = {
      id: entry.id || createItemId("formula"),
      text: String(entry.text || ""),
      latexSource: String(entry.latexSource || entry.text || ""),
      format: normalizeFormulaCopyFormat(entry.format),
      copiedAt: entry.copiedAt || Date.now(),
      sourceTitle: String(entry.sourceTitle || ""),
      sourceUrl: String(entry.sourceUrl || "")
    };

    const nextHistory = [
      nextEntry,
      ...existingHistory.filter((item) => {
        return !(
          item.text === nextEntry.text &&
          item.latexSource === nextEntry.latexSource &&
          normalizeFormulaCopyFormat(item.format) === nextEntry.format
        );
      })
    ].slice(0, MAX_FORMULA_HISTORY_ITEMS);

    await chrome.storage.local.set({
      [STORAGE_KEYS.FORMULA_HISTORY]: nextHistory
    });

    return nextHistory;
  }

  globalThis.ChatGPTVoyagerShared = {
    FORMULA_COPY_FORMATS,
    FORMULA_COPY_FORMAT_LABELS,
    STORAGE_KEYS,
    MAX_FORMULA_HISTORY_ITEMS,
    DEFAULT_SETTINGS,
    DEFAULT_LOCAL_DATA,
    normalizeFormulaCopyFormat,
    createItemId,
    normalizeWhitespace,
    truncateText,
    clampFormulaHistoryItems,
    getFormulaPreviewText,
    renderFormulaPreview,
    formatTimestamp,
    copyTextToClipboard,
    saveFormulaHistoryEntry
  };
})();
