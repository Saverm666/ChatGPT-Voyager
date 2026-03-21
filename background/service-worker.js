const FORMULA_COPY_FORMATS = {
  LATEX_SOURCE: "latex-source"
};

const DEFAULT_SETTINGS = {
  formulaCopierEnabled: true,
  formulaCopyFormat: FORMULA_COPY_FORMATS.LATEX_SOURCE,
  enterEnhancerEnabled: true,
  notionCloseGuardEnabled: true
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const nextSettings = {
    ...DEFAULT_SETTINGS,
    ...stored
  };

  await chrome.storage.local.set(nextSettings);
  console.log("GPTLatexCopy installed", nextSettings);
});
