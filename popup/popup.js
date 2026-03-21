const FORMULA_COPY_FORMATS = {
  LATEX_INLINE: "latex",
  MATHML: "mathml",
  LATEX_SOURCE: "latex-source"
};

const DEFAULT_SETTINGS = {
  formulaCopierEnabled: true,
  formulaCopyFormat: FORMULA_COPY_FORMATS.LATEX_SOURCE,
  enterEnhancerEnabled: true,
  notionCloseGuardEnabled: true
};
const FORMULA_COPY_FORMAT_LABELS = {
  [FORMULA_COPY_FORMATS.LATEX_INLINE]: "LaTeX",
  [FORMULA_COPY_FORMATS.MATHML]: "MathML (Word)",
  [FORMULA_COPY_FORMATS.LATEX_SOURCE]: "LaTeX (纯文本，无 $ 符号)"
};

const pageTitle = document.getElementById("page-title");
const pageUrl = document.getElementById("page-url");
const supportNote = document.getElementById("support-note");
const status = document.getElementById("status");
const formulaCopierToggle = document.getElementById("formula-copier-enabled");
const formulaCopyFormatInputs = document.querySelectorAll(
  'input[name="formula-copy-format"]'
);
const enterEnhancerToggle = document.getElementById("enter-enhancer-enabled");
const notionCloseGuardToggle = document.getElementById(
  "notion-close-guard-enabled"
);
const openOptionsButton = document.getElementById("open-options");

function normalizeFormulaCopyFormat(value) {
  return Object.values(FORMULA_COPY_FORMATS).includes(value)
    ? value
    : DEFAULT_SETTINGS.formulaCopyFormat;
}

function getFormulaCopyFormatLabel(value) {
  return FORMULA_COPY_FORMAT_LABELS[normalizeFormulaCopyFormat(value)];
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
      "当前页面不在支持站点内。ChatGPT 页面支持公式复制和 Enter 增强；Notion 页面支持离开确认。";
    return;
  }

  const formulaText = site.supportsFormulaCopier ? "支持" : "暂不支持";
  const enterText = site.supportsEnterEnhancer ? "支持" : "暂不支持";
  const notionText = site.supportsNotionCloseGuard ? "支持" : "暂不支持";
  supportNote.textContent = `当前站点：${site.name}。公式复制 ${formulaText}，Enter / Ctrl+Enter 增强 ${enterText}，Notion 离开确认 ${notionText}。`;
}

async function loadPageInfo() {
  const tab = await getCurrentTab();
  pageTitle.textContent = tab?.title || "未读取到标题";
  pageUrl.textContent = tab?.url || "当前页面 URL 不可用";
  renderSupportNote(getSiteInfo(tab?.url));
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  formulaCopierToggle.checked = Boolean(settings.formulaCopierEnabled);
  const currentFormat = normalizeFormulaCopyFormat(settings.formulaCopyFormat);
  formulaCopyFormatInputs.forEach((input) => {
    input.checked = input.value === currentFormat;
  });
  enterEnhancerToggle.checked = Boolean(settings.enterEnhancerEnabled);
  notionCloseGuardToggle.checked = Boolean(settings.notionCloseGuardEnabled);
}

async function saveSettings(nextSettings, message) {
  await chrome.storage.local.set(nextSettings);
  status.textContent = message;
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

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

Promise.all([loadPageInfo(), loadSettings()]).catch((error) => {
  status.textContent = error instanceof Error ? error.message : "初始化 popup 失败。";
});
