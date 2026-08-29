const SURFACES = Object.freeze({
  doubao_web: Object.freeze({
    origin: "https://www.doubao.com",
    pageSignatureVersion: "doubao-web-signature@6-visible-reference-panel",
  }),
  qianwen_web: Object.freeze({
    origin: "https://www.qianwen.com",
    pageSignatureVersion: "qianwen-web-signature@2-visible-reference-panel",
  }),
  deepseek_web: Object.freeze({
    origin: "https://chat.deepseek.com",
    pageSignatureVersion: "deepseek-web-signature@2-visible-page",
  }),
});

const REFERENCE_SOURCE_WATCH_TIMEOUT_MS = 10_000;
const referenceSourceWatches = new Map();
let nextReferenceSourceWatchId = 1;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !getSurfaceForPage(tab.url)) {
    await showBadge(tab.id, "ERR", "#b42318");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["capture-core.js", "automation-core.js", "content.js"],
    });
    await chrome.tabs.sendMessage(tab.id, { type: "WT_OPEN_PANEL" });
    await showBadge(tab.id, "问", "#175cd3");
  } catch {
    await showBadge(tab.id, "ERR", "#b42318");
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message?.type !== "WT_CAPTURE_VIEWPORT" &&
    message?.type !== "WT_SUBMIT_CAPTURE" &&
    message?.type !== "WT_AUTOMATION_PREFLIGHT" &&
    message?.type !== "WT_BATCH_NEXT" &&
    message?.type !== "WT_SOURCE_TAB_WATCH_BEGIN" &&
    message?.type !== "WT_SOURCE_TAB_WATCH_RESULT"
  ) {
    return false;
  }

  const senderTab = sender.tab;
  const isReferenceWatchResult = message.type === "WT_SOURCE_TAB_WATCH_RESULT";
  if (
    !senderTab.id ||
    !getSurfaceForPage(senderTab.url) ||
    (!senderTab.active &&
      !(
        isReferenceWatchResult &&
        isMatchingReferenceSourceWatch(message.watchId, senderTab.id)
      ))
  ) {
    sendResponse({ ok: false, error: "CAPTURE_PAGE_NOT_ALLOWED" });
    return false;
  }

  if (message.type === "WT_SOURCE_TAB_WATCH_BEGIN") {
    try {
      sendResponse({
        ok: true,
        result: beginReferenceSourceTabWatch(senderTab),
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "REFERENCE_SOURCE_TAB_WATCH_FAILED",
      });
    }
    return false;
  }

  if (message.type === "WT_SOURCE_TAB_WATCH_RESULT") {
    finishReferenceSourceTabWatch(message.watchId, senderTab)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "REFERENCE_SOURCE_TAB_WATCH_FAILED",
        }),
      );
    return true;
  }

  if (message.type === "WT_CAPTURE_VIEWPORT") {
    chrome.tabs
      .captureVisibleTab(senderTab.windowId, { format: "png" })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch(() =>
        sendResponse({ ok: false, error: "CAPTURE_SCREENSHOT_FAILED" }),
      );
    return true;
  }

  if (message.type === "WT_AUTOMATION_PREFLIGHT") {
    preflightAutomation(message.handoffCode, senderTab.url)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "AUTOMATION_PREFLIGHT_FAILED",
        }),
      );
    return true;
  }

  if (message.type === "WT_BATCH_NEXT") {
    claimNextBatchTask(message.batchHandoffCode, senderTab.url)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "AUTOMATION_BATCH_NEXT_FAILED",
        }),
      );
    return true;
  }

  submitCapture(message.handoffCode, message.draft, senderTab.url)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "CAPTURE_SUBMIT_FAILED",
      }),
    );
  return true;
});

function beginReferenceSourceTabWatch(senderTab) {
  const surface = getSurfaceForPage(senderTab.url);
  if (
    surface?.surfaceCode !== "qianwen_web" ||
    !senderTab.active ||
    !senderTab.id ||
    !Number.isInteger(senderTab.windowId)
  ) {
    throw new Error("REFERENCE_SOURCE_TAB_WATCH_NOT_ALLOWED");
  }
  for (const [watchId, watch] of referenceSourceWatches) {
    if (watch.sourceTabId === senderTab.id) {
      watch.settle({ ok: false, error: "REFERENCE_SOURCE_TAB_WATCH_REPLACED" });
      referenceSourceWatches.delete(watchId);
    }
  }

  const watchId = `${senderTab.id}:${Date.now()}:${nextReferenceSourceWatchId}`;
  nextReferenceSourceWatchId += 1;
  let resolveResult;
  const result = new Promise((resolve) => {
    resolveResult = resolve;
  });
  let settled = false;
  let openedTabId = null;
  let timeoutId = null;
  const cleanup = () => {
    chrome.tabs.onCreated.removeListener(handleCreated);
    chrome.tabs.onUpdated.removeListener(handleUpdated);
    if (timeoutId !== null && typeof clearTimeout === "function") {
      clearTimeout(timeoutId);
    }
  };
  const settle = (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveResult({ ...value, openedTabId });
  };
  const inspectTab = (tab) => {
    if (
      !tab?.id ||
      tab.windowId !== senderTab.windowId ||
      (openedTabId === null && tab.openerTabId !== senderTab.id)
    ) {
      return;
    }
    if (openedTabId === null) {
      openedTabId = tab.id;
    }
    if (tab.id !== openedTabId) {
      return;
    }
    const url = normalizeExternalReferenceUrl(tab.url, surface.origin);
    if (url) {
      settle({ ok: true, url });
    }
  };
  function handleCreated(tab) {
    inspectTab(tab);
  }
  function handleUpdated(tabId, changeInfo, tab) {
    if (openedTabId !== null && tabId !== openedTabId) {
      return;
    }
    inspectTab({ ...tab, url: changeInfo?.url ?? tab?.url });
  }

  chrome.tabs.onCreated.addListener(handleCreated);
  chrome.tabs.onUpdated.addListener(handleUpdated);
  timeoutId = setTimeout(
    () => settle({ ok: false, error: "REFERENCE_SOURCE_TAB_NOT_OPENED" }),
    REFERENCE_SOURCE_WATCH_TIMEOUT_MS,
  );
  referenceSourceWatches.set(watchId, {
    result,
    settle,
    sourceTabId: senderTab.id,
  });
  return Object.freeze({ watch_id: watchId });
}

async function finishReferenceSourceTabWatch(watchId, senderTab) {
  const watch = referenceSourceWatches.get(watchId);
  if (!watch || watch.sourceTabId !== senderTab.id) {
    throw new Error("REFERENCE_SOURCE_TAB_WATCH_INVALID");
  }
  const result = await watch.result;
  referenceSourceWatches.delete(watchId);
  if (result.openedTabId) {
    await chrome.tabs.remove(result.openedTabId).catch(() => undefined);
  }
  await chrome.tabs
    .update(senderTab.id, { active: true })
    .catch(() => undefined);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return Object.freeze({ url: result.url });
}

function isMatchingReferenceSourceWatch(watchId, senderTabId) {
  const watch = referenceSourceWatches.get(watchId);
  return Boolean(watch && watch.sourceTabId === senderTabId);
}

function normalizeExternalReferenceUrl(value, sourceOrigin) {
  try {
    const url = new URL(value ?? "");
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin === sourceOrigin
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

async function submitCapture(rawHandoffCode, draft, pageUrl) {
  const handoff = decodeHandoffCode(rawHandoffCode);
  const surface = getSurfaceForPage(pageUrl);
  if (
    !surface ||
    (typeof draft?.surface_code === "string" &&
      draft.surface_code !== surface.surfaceCode)
  ) {
    throw new Error("当前页面与采集任务的平台不一致");
  }
  if (Date.parse(handoff.token_expires_at) <= Date.now()) {
    throw new Error("接入码已过期，请回到问天重新生成");
  }
  const response = await fetch(
    `${handoff.api_origin}/api/v1/ai-visibility/consumer-observations/tasks/${handoff.task_id}/captures`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capture_token: handoff.capture_token,
        task_version: handoff.task_version,
        draft,
        reviewed_session_metadata: handoff.reviewed_session_metadata,
      }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toSubmitErrorMessage(body?.error));
  }
  return body;
}

async function claimNextBatchTask(rawBatchHandoffCode, pageUrl) {
  const batch = decodeBatchHandoffCode(rawBatchHandoffCode);
  if (Date.parse(batch.token_expires_at) <= Date.now()) {
    throw new Error("整批接入码已过期，请回到问天重新生成");
  }
  const response = await fetch(
    `${batch.api_origin}/api/v1/ai-visibility/consumer-observations/automation-batches/next`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batch_token: batch.batch_token }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toAutomationBatchErrorMessage(body?.error));
  }
  assertValidAutomationBatchNext(body, batch);
  if (body.status === "complete") {
    return body;
  }
  const preflight = await preflightAutomation(
    body.claim.extension_handoff_code,
    pageUrl,
  );
  return {
    status: "task_ready",
    run_id: body.run_id,
    total_task_count: body.total_task_count,
    completed_task_count: body.completed_task_count,
    remaining_task_count: body.remaining_task_count,
    handoff_code: body.claim.extension_handoff_code,
    session_conditions: body.claim.session_conditions,
    task: body.claim.task,
    preflight,
  };
}

async function preflightAutomation(rawHandoffCode, pageUrl) {
  const handoff = decodeHandoffCode(rawHandoffCode);
  if (Date.parse(handoff.token_expires_at) <= Date.now()) {
    throw new Error("接入码已过期，请回到问天重新生成");
  }
  const response = await fetch(
    `${handoff.api_origin}/api/v1/ai-visibility/consumer-observations/tasks/${handoff.task_id}/automation-preflight`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capture_token: handoff.capture_token,
        task_version: handoff.task_version,
      }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(toAutomationErrorMessage(body?.error));
  }
  assertValidAutomationPreflight(body, handoff, pageUrl);
  return body;
}

function assertValidAutomationPreflight(value, handoff, pageUrl) {
  const surface = getSurfaceForPage(pageUrl);
  const keys = [
    "expected_page_origin",
    "page_signature_version",
    "prompt",
    "review_required",
    "status",
    "surface_code",
    "task_id",
    "task_version",
    "token_expires_at",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== keys.join("\n") ||
    value.status !== "ready" ||
    value.task_id !== handoff.task_id ||
    value.task_version !== handoff.task_version ||
    !surface ||
    value.surface_code !== surface.surfaceCode ||
    typeof value.prompt !== "string" ||
    !value.prompt.trim() ||
    value.prompt.length > 2_000 ||
    value.expected_page_origin !== surface.origin ||
    typeof value.page_signature_version !== "string" ||
    !value.page_signature_version ||
    value.token_expires_at !== handoff.token_expires_at ||
    value.review_required !== true
  ) {
    throw new Error("问天返回的自动化预检结果无效");
  }
}

function decodeHandoffCode(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value || value.length > 16_384) {
    throw new Error("接入码无效");
  }
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    assertValidHandoff(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("接入码")) {
      throw error;
    }
    throw new Error("接入码无效");
  }
}

function decodeBatchHandoffCode(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value || value.length > 16_384) {
    throw new Error("整批接入码无效");
  }
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    assertValidBatchHandoff(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("整批接入码")) {
      throw error;
    }
    throw new Error("整批接入码无效");
  }
}

function assertValidBatchHandoff(value) {
  const expectedKeys = [
    "api_origin",
    "batch_token",
    "run_id",
    "token_expires_at",
    "version",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== expectedKeys.join("\n") ||
    value.version !== "wentian-extension-batch-handoff@1" ||
    !isAllowedApiOrigin(value.api_origin) ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value.run_id) ||
    typeof value.batch_token !== "string" ||
    value.batch_token.length < 1 ||
    value.batch_token.length > 4_096 ||
    !Number.isFinite(Date.parse(value.token_expires_at))
  ) {
    throw new Error("整批接入码无效");
  }
}

function assertValidAutomationBatchNext(value, batch) {
  const commonValid =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.run_id === batch.run_id &&
    Number.isInteger(value.total_task_count) &&
    value.total_task_count > 0 &&
    Number.isInteger(value.completed_task_count) &&
    value.completed_task_count >= 0 &&
    Number.isInteger(value.remaining_task_count) &&
    value.remaining_task_count >= 0;
  if (!commonValid) {
    throw new Error("问天返回的整批任务无效");
  }
  if (value.status === "complete") {
    const keys = [
      "completed_task_count",
      "remaining_task_count",
      "run_id",
      "status",
      "total_task_count",
    ];
    if (
      Object.keys(value).sort().join("\n") !== keys.join("\n") ||
      value.remaining_task_count !== 0
    ) {
      throw new Error("问天返回的整批任务无效");
    }
    return;
  }
  const keys = [
    "claim",
    "completed_task_count",
    "remaining_task_count",
    "run_id",
    "status",
    "total_task_count",
  ];
  if (
    value.status !== "task_ready" ||
    Object.keys(value).sort().join("\n") !== keys.join("\n") ||
    !value.claim ||
    typeof value.claim !== "object" ||
    typeof value.claim.extension_handoff_code !== "string" ||
    !value.claim.task ||
    typeof value.claim.task !== "object" ||
    value.claim.task.run_id !== batch.run_id ||
    !isBatchSessionConditions(value.claim.session_conditions)
  ) {
    throw new Error("问天返回的整批任务无效");
  }
  decodeHandoffCode(value.claim.extension_handoff_code);
}

function isBatchSessionConditions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = [
    "is_logged_in",
    "is_new_conversation",
    "locale",
    "memory_enabled",
    "personalization_enabled",
    "region",
    "search_mode",
  ];
  return (
    Object.keys(value).sort().join("\n") === keys.join("\n") &&
    ["unknown", "enabled", "disabled"].includes(value.search_mode) &&
    typeof value.is_new_conversation === "boolean" &&
    typeof value.is_logged_in === "boolean" &&
    (typeof value.memory_enabled === "boolean" ||
      value.memory_enabled === null) &&
    (typeof value.personalization_enabled === "boolean" ||
      value.personalization_enabled === null) &&
    typeof value.locale === "string" &&
    value.locale.length >= 2 &&
    (typeof value.region === "string" || value.region === null)
  );
}

function assertValidHandoff(value) {
  const expectedKeys = [
    "api_origin",
    "capture_token",
    "reviewed_session_metadata",
    "task_id",
    "task_version",
    "token_expires_at",
    "version",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\n") !== expectedKeys.join("\n") ||
    value.version !== "wentian-extension-handoff@1" ||
    !isAllowedApiOrigin(value.api_origin) ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value.task_id) ||
    !Number.isInteger(value.task_version) ||
    value.task_version < 1 ||
    typeof value.capture_token !== "string" ||
    value.capture_token.length < 1 ||
    value.capture_token.length > 4_096 ||
    !Number.isFinite(Date.parse(value.token_expires_at)) ||
    !isReviewedSessionMetadata(value.reviewed_session_metadata)
  ) {
    throw new Error("接入码无效");
  }
}

function isAllowedApiOrigin(value) {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function isReviewedSessionMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = [
    "is_logged_in",
    "is_new_conversation",
    "locale",
    "memory_enabled",
    "personalization_enabled",
    "region",
    "surface_model_label",
  ];
  return (
    Object.keys(value).sort().join("\n") === keys.join("\n") &&
    typeof value.is_new_conversation === "boolean" &&
    typeof value.is_logged_in === "boolean" &&
    (typeof value.memory_enabled === "boolean" ||
      value.memory_enabled === null) &&
    (typeof value.personalization_enabled === "boolean" ||
      value.personalization_enabled === null) &&
    typeof value.locale === "string" &&
    value.locale.length >= 2 &&
    (typeof value.region === "string" || value.region === null) &&
    (typeof value.surface_model_label === "string" ||
      value.surface_model_label === null)
  );
}

function toSubmitErrorMessage(code) {
  if (code === "CAPTURE_TOKEN_ALREADY_CONSUMED") {
    return "该接入码已经使用，请回到问天查看任务状态";
  }
  if (code === "CAPTURE_TOKEN_INVALID") {
    return "接入码无效或已过期，请回到问天重新生成";
  }
  if (code === "TASK_VERSION_CONFLICT") {
    return "问天任务状态已变化，请回到问天刷新任务";
  }
  return "提交失败，请确认问天正在运行后重试";
}

function toAutomationErrorMessage(code) {
  if (code === "AUTOMATION_SWITCH_DISABLED") {
    return "当前项目未开启自动化，请在问天项目设置中开启或改用手动选择。";
  }
  if (
    code === "PRODUCTION_AUTHORIZATION_REQUIRED" ||
    code === "PRODUCTION_AUTHORIZATION_EVIDENCE_REQUIRED" ||
    code === "PRODUCTION_AUTHORIZATION_SCOPE_MISMATCH" ||
    code === "PRODUCTION_AUTHORIZATION_REVIEW_REQUIRED" ||
    code === "PRODUCTION_AUTHORIZATION_REVIEW_INVALID" ||
    code === "PRODUCTION_AUTHORIZATION_REVIEW_EXPIRED"
  ) {
    return "生产自动化授权门禁尚未满足，请改用手动选择。";
  }
  if (code === "CAPTURE_TOKEN_INVALID") {
    return "接入码无效或已过期，请回到问天重新生成。";
  }
  if (code === "TASK_VERSION_CONFLICT") {
    return "问天任务状态已变化，请回到问天刷新任务。";
  }
  return "自动化预检未通过，请改用手动选择或回到问天检查任务。";
}

function toAutomationBatchErrorMessage(code) {
  if (code === "AUTOMATION_BATCH_TOKEN_INVALID") {
    return "整批接入码无效或已过期，请回到问天重新生成。";
  }
  if (code === "AUTOMATION_SWITCH_DISABLED") {
    return "当前项目已关闭自动化，请回到问天重新开启。";
  }
  if (code === "AUTOMATION_BATCH_TASK_BUSY") {
    return "当前运行有任务被其他账号领取，请稍后重试。";
  }
  if (code === "AUTOMATION_BATCH_NO_TASKS") {
    return "当前运行没有可连续采集的任务。";
  }
  return "领取下一题失败，请确认问天正在运行后重试。";
}

function getSurfaceForPage(value) {
  try {
    const url = new URL(value ?? "");
    const entry = Object.entries(SURFACES).find(([surfaceCode, candidate]) => {
      if (candidate.origin !== url.origin) return false;
      return isAllowedSurfacePath(surfaceCode, url.pathname);
    });
    return entry ? Object.freeze({ surfaceCode: entry[0], ...entry[1] }) : null;
  } catch {
    return null;
  }
}

function isAllowedSurfacePath(surfaceCode, pathname) {
  if (surfaceCode === "doubao_web") {
    return pathname === "/chat" || pathname.startsWith("/chat/");
  }
  if (surfaceCode === "qianwen_web") {
    return (
      pathname === "/" ||
      pathname.startsWith("/chat") ||
      pathname.startsWith("/conversation")
    );
  }
  return (
    surfaceCode === "deepseek_web" &&
    (pathname === "/" ||
      pathname === "/a/chat" ||
      pathname.startsWith("/a/chat/"))
  );
}

async function showBadge(tabId, text, color) {
  if (!tabId) {
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: "" });
  }, 2_000);
}
