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

const form = document.getElementById("settings-form");
const formulaCopierInput = document.getElementById("formula-copier-enabled");
const formulaCopyFormatInputs = document.querySelectorAll(
  'input[name="formulaCopyFormat"]'
);
const enterEnhancerInput = document.getElementById("enter-enhancer-enabled");
const notionCloseGuardInput = document.getElementById(
  "notion-close-guard-enabled"
);
const saveStatus = document.getElementById("save-status");

function normalizeFormulaCopyFormat(value) {
  return Object.values(FORMULA_COPY_FORMATS).includes(value)
    ? value
    : DEFAULT_SETTINGS.formulaCopyFormat;
}

function getSelectedFormulaCopyFormat() {
  const checkedInput = document.querySelector(
    'input[name="formulaCopyFormat"]:checked'
  );

  return normalizeFormulaCopyFormat(checkedInput?.value);
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  formulaCopierInput.checked = Boolean(settings.formulaCopierEnabled);

  const currentFormat = normalizeFormulaCopyFormat(settings.formulaCopyFormat);
  formulaCopyFormatInputs.forEach((input) => {
    input.checked = input.value === currentFormat;
  });

  enterEnhancerInput.checked = Boolean(settings.enterEnhancerEnabled);
  notionCloseGuardInput.checked = Boolean(settings.notionCloseGuardEnabled);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formulaCopyFormat = getSelectedFormulaCopyFormat();

  await chrome.storage.local.set({
    formulaCopierEnabled: formulaCopierInput.checked,
    formulaCopyFormat,
    enterEnhancerEnabled: enterEnhancerInput.checked,
    notionCloseGuardEnabled: notionCloseGuardInput.checked
  });

  saveStatus.textContent = `设置已保存。当前公式复制格式：${
    FORMULA_COPY_FORMAT_LABELS[formulaCopyFormat]
  }。`;

  window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1800);
});

loadSettings().catch((error) => {
  saveStatus.textContent = error instanceof Error ? error.message : "加载设置失败。";
});
