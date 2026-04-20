(() => {
  const { DEFAULT_SETTINGS = {} } = globalThis.ChatGPTVoyagerShared || {};
  const ENABLE_KEY = "chatgptLongConversationCollapseEnabled";
  const KEEP_KEY = "chatgptCollapseKeepLatest";
  const COLLAPSED_ATTR = "data-chatgpt-voyager-collapsed-message";
  const currentHostname = window.location.hostname;
  const isChatGPTPage =
    currentHostname.includes("chatgpt.com") ||
    currentHostname.includes("chat.openai.com");

  if (!isChatGPTPage) {
    return;
  }

  let enabled =
    typeof DEFAULT_SETTINGS[ENABLE_KEY] === "boolean"
      ? DEFAULT_SETTINGS[ENABLE_KEY]
      : false;
  let keepLatest = normalizeKeepLatest(DEFAULT_SETTINGS[KEEP_KEY]);
  let routeHooked = false;

  function normalizeKeepLatest(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      return 20;
    }

    return Math.min(Math.max(Math.trunc(numberValue), 1), 1000);
  }

  function isConversationRoute(pathname = location.pathname) {
    return /\/c\/[A-Za-z0-9_-]+/.test(String(pathname || ""));
  }

  function emitVisibilityChange() {
    try {
      window.dispatchEvent(
        new CustomEvent("chatgpt-voyager:conversation-visibility-change")
      );
    } catch {}
  }

  function getConversationMain() {
    return (
      document.querySelector("#thread") ||
      document.querySelector("main#main") ||
      document.querySelector("main") ||
      document.querySelector('[role="main"]')
    );
  }

  function getRole(node) {
    if (!(node instanceof Element)) {
      return "";
    }

    const directRole =
      node.getAttribute("data-turn") ||
      node.getAttribute("data-message-author-role") ||
      node.dataset?.turn ||
      node.dataset?.messageAuthorRole ||
      "";

    if (directRole === "user" || directRole === "assistant") {
      return directRole;
    }

    const roleNode = node.querySelector(
      '[data-turn], [data-message-author-role], [data-testid="user-message"], [data-testid="assistant-message"], [data-testid^="user-message"], [data-testid^="assistant-message"]'
    );

    const nestedRole =
      roleNode?.getAttribute("data-turn") ||
      roleNode?.getAttribute("data-message-author-role") ||
      "";

    if (nestedRole === "user" || nestedRole === "assistant") {
      return nestedRole;
    }

    const testId = (
      node.getAttribute("data-testid") ||
      roleNode?.getAttribute("data-testid") ||
      ""
    ).toLowerCase();

    if (testId.includes("user-message")) {
      return "user";
    }

    if (testId.includes("assistant-message")) {
      return "assistant";
    }

    return "";
  }

  function getNodeKey(node, index) {
    return (
      node?.getAttribute?.("data-turn-id") ||
      node?.querySelector?.("[data-turn-id]")?.getAttribute("data-turn-id") ||
      node?.getAttribute?.("data-message-id") ||
      node?.querySelector?.("[data-message-id]")?.getAttribute("data-message-id") ||
      node?.getAttribute?.("data-testid") ||
      `message-${index}`
    );
  }

  function normalizeMessageNode(node) {
    if (!(node instanceof Element)) {
      return null;
    }

    return (
      node.closest("section[data-turn][data-turn-id]") ||
      node.closest("[data-turn][data-turn-id]") ||
      node.closest('[data-testid^="conversation-turn-"]') ||
      node.closest("[data-message-id]") ||
      node
    );
  }

  function getMessageNodes() {
    const main = getConversationMain();
    if (!main) {
      return [];
    }

    const candidates = Array.from(
      main.querySelectorAll(
        [
          "section[data-turn][data-turn-id]",
          "[data-turn][data-turn-id]",
          '[data-testid^="conversation-turn-"]',
          "[data-message-id]",
          '[data-message-author-role="user"]',
          '[data-message-author-role="assistant"]',
          '[data-testid="user-message"]',
          '[data-testid="assistant-message"]',
          '[data-testid^="user-message"]',
          '[data-testid^="assistant-message"]'
        ].join(", ")
      )
    );

    const seen = new Set();
    const nodes = [];
    candidates.forEach((candidate, index) => {
      const node = normalizeMessageNode(candidate);
      if (!(node instanceof HTMLElement)) {
        return;
      }

      const key = getNodeKey(node, index);
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      if (getRole(node) || String(node.textContent || "").trim()) {
        nodes.push(node);
      }
    });

    return nodes;
  }

  function getConversationRounds(nodes) {
    const rounds = [];
    let currentRound = null;

    nodes.forEach((node) => {
      const role = getRole(node);
      if (role === "user" || !currentRound) {
        currentRound = {
          nodes: [],
          hasUser: role === "user"
        };
        rounds.push(currentRound);
      }

      currentRound.nodes.push(node);
    });

    return rounds.filter((round) => round.nodes.length > 0);
  }

  function getCollapsedNodes() {
    return Array.from(
      document.querySelectorAll(`[${COLLAPSED_ATTR}="1"]`)
    ).filter((node) => node instanceof HTMLElement);
  }

  function getState() {
    const collapsedCount = getCollapsedNodes().length;
    return {
      enabled,
      keepLatest,
      collapsedCount,
      isConversationRoute: isConversationRoute()
    };
  }

  function collapseOldMessages() {
    if (!enabled) {
      return {
        ok: false,
        reason: "disabled",
        message: "请先在 popup 或设置页开启长对话折叠。"
      };
    }

    if (!isConversationRoute()) {
      return {
        ok: false,
        reason: "not-conversation",
        message: "当前页面不是 ChatGPT 对话。"
      };
    }

    const nodes = getMessageNodes().filter(
      (node) => node.getAttribute(COLLAPSED_ATTR) !== "1"
    );

    const rounds = getConversationRounds(nodes);

    if (rounds.length <= keepLatest) {
      return {
        ok: false,
        reason: "not-enough",
        message: `当前对话不超过 ${keepLatest} 轮，无需轻量化。`,
        visibleCount: rounds.length
      };
    }

    const toCollapse = rounds
      .slice(0, rounds.length - keepLatest)
      .flatMap((round) => round.nodes);
    toCollapse.forEach((node) => {
      node.setAttribute(COLLAPSED_ATTR, "1");
      node.setAttribute("aria-hidden", "true");
    });

    emitVisibilityChange();
    return {
      ok: true,
      collapsedCount: toCollapse.length,
      visibleCount: keepLatest,
      message: `已隐藏 ${rounds.length - keepLatest} 轮较早对话，保留最近 ${keepLatest} 轮。`
    };
  }

  function restoreMessages() {
    const collapsed = getCollapsedNodes();
    collapsed.forEach((node) => {
      node.removeAttribute(COLLAPSED_ATTR);
      node.removeAttribute("aria-hidden");
    });

    if (collapsed.length) {
      emitVisibilityChange();
    }

    return {
      ok: collapsed.length > 0,
      restoredCount: collapsed.length,
      message: collapsed.length ? "已恢复隐藏消息。" : "当前没有隐藏消息。"
    };
  }

  function setKeepLatest(nextKeepLatest) {
    keepLatest = normalizeKeepLatest(nextKeepLatest);
    try {
      globalThis.chrome?.storage?.local?.set({ [KEEP_KEY]: keepLatest });
    } catch {}
    return keepLatest;
  }

  function applyEnabledState() {
    if (!enabled) {
      restoreMessages();
    }
  }

  function handleRouteChange() {
    restoreMessages();
    window.setTimeout(() => {
      if (enabled) {
        emitVisibilityChange();
      }
    }, 350);
  }

  function hookRouteChangesOnce() {
    if (routeHooked) {
      return;
    }

    routeHooked = true;
    ["pushState", "replaceState"].forEach((methodName) => {
      const original = history?.[methodName];
      if (typeof original !== "function") {
        return;
      }

      history[methodName] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        window.setTimeout(handleRouteChange, 0);
        return result;
      };
    });

    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hashchange", handleRouteChange);
  }

  function bootstrapWhenBodyReady() {
    if (!document.body) {
      window.setTimeout(bootstrapWhenBodyReady, 100);
      return;
    }

    hookRouteChangesOnce();
    applyEnabledState();
  }

  function loadSettings() {
    if (!globalThis.chrome?.storage?.local) {
      bootstrapWhenBodyReady();
      return;
    }

    globalThis.chrome.storage.local.get(
      {
        [ENABLE_KEY]: enabled,
        [KEEP_KEY]: keepLatest
      },
      (stored) => {
        enabled = Boolean(stored?.[ENABLE_KEY]);
        keepLatest = normalizeKeepLatest(stored?.[KEEP_KEY]);
        bootstrapWhenBodyReady();
      }
    );
  }

  try {
    loadSettings();
    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      if (ENABLE_KEY in (changes || {})) {
        enabled = Boolean(changes[ENABLE_KEY].newValue);
        applyEnabledState();
      }

      if (KEEP_KEY in (changes || {})) {
        keepLatest = normalizeKeepLatest(changes[KEEP_KEY].newValue);
      }
    });
  } catch {
    bootstrapWhenBodyReady();
  }

  globalThis.ChatGPTVoyagerCollapse = {
    collapse: collapseOldMessages,
    restore: restoreMessages,
    getState,
    setKeepLatest
  };
})();
