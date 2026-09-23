import {
  generateIndustryQuestions,
  QUESTION_GENERATOR_VERSION,
} from "./question-generator.js";
import { requestJsonWithCsrfRecovery } from "./csrf-api-client.js";
import {
  describeSearchableLabel,
  filterSearchableOptions,
} from "./searchable-select-core.js";

const state = {
  csrf: null,
  user: null,
  scopes: [],
  scopeId: null,
  settings: null,
  catalog: { snapshots: [], runs: [] },
  tasks: [],
  activeRunId: null,
  deletionJob: null,
  geoConnectors: [],
  geoBindings: [],
  generatedQuestions: [],
  workspaceView: "experiment",
  activePanelId: "questions-panel",
  keywordInsights: null,
};

const $ = (selector) => document.querySelector(selector);
const reportCore = globalThis.WentianReportCore;
const initialRoute = parseInitialRoute();
const terminalStatuses = new Set([
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);
const taskAutoRefreshIntervalMs = 3_000;
let toastTimer;
let taskAutoRefreshInFlight = false;
let lastTaskAutoRefreshAt = 0;
let bulkConfirmInFlight = false;
const searchableSelectControllers = new WeakMap();
let searchableSelectSequence = 0;
let openSearchableSelectController = null;
let searchableSelectGlobalEventsBound = false;

initializeSearchableSelects();
bindEvents();
window.setInterval(() => void autoRefreshTasks(), taskAutoRefreshIntervalMs);
void restoreSession();

function bindEvents() {
  $("#login-form").addEventListener("submit", login);
  $("#logout-button").addEventListener("click", logout);
  $("#show-create-scope").addEventListener("click", () =>
    toggleScopeForm(true),
  );
  $("[data-create-project-trigger]").addEventListener("click", () => {
    toggleScopeForm(true);
    $("#scope-form").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#cancel-create-scope").addEventListener("click", () =>
    toggleScopeForm(false),
  );
  $("#scope-form").addEventListener("submit", createScope);
  $("#show-scope-metadata").addEventListener("click", () =>
    toggleScopeMetadataForm(true),
  );
  $("#cancel-scope-metadata").addEventListener("click", () =>
    toggleScopeMetadataForm(false),
  );
  $("#scope-metadata-form").addEventListener("submit", updateScopeMetadata);
  for (const id of ["#scope-industry-filter", "#scope-region-filter"]) {
    $(id).addEventListener("input", refreshScopeSelector);
  }
  $("#clear-scope-filters").addEventListener("click", clearScopeFilters);
  $("#open-geo-connector").addEventListener("click", openGeoConnector);
  $("#close-geo-connector").addEventListener("click", () =>
    $("#geo-connector-dialog").close(),
  );
  $("#refresh-geo-connector").addEventListener("click", loadGeoAdmin);
  $("#geo-connector-form").addEventListener("submit", createGeoConnector);
  $("#copy-geo-secret").addEventListener("click", copyGeoSecret);
  $("#scope-select").addEventListener("change", (event) =>
    selectScope(event.target.value),
  );
  $("#automation-toggle").addEventListener("change", updateAutomation);
  $("#show-scope-deletion").addEventListener("click", () =>
    toggleScopeDeletionForm(true),
  );
  $("#cancel-scope-deletion").addEventListener("click", () =>
    toggleScopeDeletionForm(false),
  );
  $("#scope-deletion-form").addEventListener("submit", deleteScope);
  $("#refresh-button").addEventListener("click", refreshProject);
  $("#show-experiment-workspace").addEventListener("click", () =>
    showPanel(state.activePanelId),
  );
  $("#show-keyword-insights").addEventListener("click", () =>
    showKeywordInsights(),
  );
  $("#refresh-keyword-insights").addEventListener("click", () =>
    loadKeywordInsights(),
  );
  $("#apply-keyword-filters").addEventListener("click", () =>
    loadKeywordInsights(),
  );
  $("#clear-keyword-filters").addEventListener(
    "click",
    clearKeywordInsightFilters,
  );
  $("#export-keyword-insights").addEventListener(
    "click",
    exportKeywordInsights,
  );
  $("#keyword-query-filter").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void loadKeywordInsights();
    }
  });
  $("#snapshot-form").addEventListener("submit", createSnapshot);
  $("#generate-industry-questions").addEventListener(
    "click",
    generateQuestions,
  );
  for (const id of ["#snapshot-industry-filter", "#snapshot-region-filter"]) {
    $(id).addEventListener("input", renderSnapshots);
  }
  $("#clear-snapshot-filters").addEventListener("click", () => {
    $("#snapshot-industry-filter").value = "";
    $("#snapshot-region-filter").value = "";
    renderSnapshots();
  });
  for (const id of ["#run-industry-filter", "#run-business-region-filter"]) {
    $(id).addEventListener("input", renderRuns);
  }
  $("#clear-run-filters").addEventListener("click", () => {
    $("#run-industry-filter").value = "";
    $("#run-business-region-filter").value = "";
    renderRuns();
  });
  $("#run-form").addEventListener("submit", createRun);
  $("#experiment-kind").addEventListener("change", updateRunForm);
  $("#run-surface").addEventListener("change", updateRunCreateSummary);
  $("#run-snapshot").addEventListener("change", updateRunCreateSummary);
  $("#sample-count").addEventListener("change", updateRunCreateSummary);
  $("#paired-run").addEventListener("change", syncPairedRunConfiguration);
  $("#task-run-select").addEventListener("change", (event) =>
    loadTasks(event.target.value),
  );
  $("#claim-next-task").addEventListener("click", claimNextTask);
  $("#confirm-all-tasks").addEventListener("click", confirmAllTasks);
  $("#create-batch-handoff").addEventListener("click", createAutomationBatch);
  $("#close-batch-handoff").addEventListener("click", () =>
    $("#batch-handoff-card").classList.add("hidden"),
  );
  $("#copy-batch-handoff").addEventListener("click", () =>
    copyTextarea("#batch-handoff-code", "整批接入码已复制"),
  );
  $("#close-handoff").addEventListener("click", () =>
    $("#handoff-card").classList.add("hidden"),
  );
  $("#copy-query").addEventListener("click", () =>
    copyTextarea("#handoff-query", "问题已复制"),
  );
  $("#copy-handoff").addEventListener("click", () =>
    copyTextarea("#handoff-code", "接入码已复制"),
  );
  $("#comparison-natural").addEventListener(
    "change",
    renderComparisonSelectors,
  );
  $("#load-ranking").addEventListener("click", loadNaturalRanking);
  $("#load-comparison").addEventListener("click", loadComparison);
  $("#report-refresh").addEventListener("click", () =>
    renderRunReport(initialRoute),
  );
  document.querySelectorAll(".step").forEach((button) => {
    button.addEventListener("click", () => showPanel(button.dataset.panel));
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void autoRefreshTasks(true);
  });
  window.addEventListener("focus", () => void autoRefreshTasks(true));
}

async function restoreSession() {
  try {
    const session = await api("/api/v1/auth/session");
    startApp(session);
    await loadScopes(initialRoute.scopeId);
    await openInitialRoute();
  } catch {
    showLogin();
  }
}

async function login(event) {
  event.preventDefault();
  $("#login-error").textContent = "";
  try {
    const session = await api("/api/v1/auth/login", {
      method: "POST",
      body: {
        email: $("#login-email").value,
        password: $("#login-password").value,
      },
      csrf: false,
    });
    $("#login-password").value = "";
    startApp(session);
    await loadScopes(initialRoute.scopeId);
    await openInitialRoute();
  } catch (error) {
    $("#login-error").textContent = friendlyError(error);
  }
}

function startApp(session) {
  state.csrf = session.csrf_token;
  state.user = session.user;
  $("#current-user").textContent =
    `${session.user.display_name} · ${session.user.email}`;
  $("#show-create-scope").classList.toggle(
    "hidden",
    session.user.instance_role === null,
  );
  $("#empty-create-scope").classList.toggle(
    "hidden",
    session.user.instance_role === null,
  );
  $("#geo-connector-card").classList.toggle(
    "hidden",
    session.user.instance_role === null,
  );
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
}

function showLogin() {
  state.csrf = null;
  state.user = null;
  $("#app-view").classList.add("hidden");
  $("#report-view").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
}

async function openGeoConnector() {
  $("#geo-secret-card").classList.add("hidden");
  $("#geo-connector-dialog").showModal();
  await loadGeoAdmin();
}

async function loadGeoAdmin() {
  try {
    const [connectorResult, bindingResult] = await Promise.all([
      api("/api/v1/integrations/geo/connectors"),
      api(
        "/api/v1/integrations/geo/project-binding-requests?status=pending_wentian",
      ),
    ]);
    state.geoConnectors = connectorResult.connectors;
    state.geoBindings = bindingResult.bindings;
    renderGeoConnectors();
    renderGeoBindings();
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

function renderGeoConnectors() {
  const host = $("#geo-connector-list");
  host.replaceChildren();
  const active = state.geoConnectors.find(
    (connector) => connector.status === "active",
  );
  for (const connector of state.geoConnectors) {
    const item = createListItem(
      connector.display_name,
      `${connector.geo_tenant_ref} · ${geoConnectorStatusText(connector.status)} · 协议 ${connector.contract_version}`,
    );
    if (
      connector.status !== "revoked" &&
      state.user?.instance_role === "owner"
    ) {
      item.lastChild.append(
        buttonElement("轮换密钥", "secondary", () =>
          rotateGeoConnector(connector),
        ),
      );
    }
    host.append(item);
  }
  if (!state.geoConnectors.length) {
    host.append(emptyInline("尚未建立 GEO 连接器。"));
  }
  $("#geo-connector-form").classList.toggle(
    "hidden",
    Boolean(active) || state.user?.instance_role !== "owner",
  );
  $("#geo-connector-summary").textContent = active
    ? `已连接：${active.display_name}；待确认 ${state.geoBindings.length} 项。`
    : `尚未连接；待确认 ${state.geoBindings.length} 项。`;
}

async function createGeoConnector(event) {
  event.preventDefault();
  try {
    const created = await api("/api/v1/integrations/geo/connectors", {
      method: "POST",
      body: {
        geo_instance_ref: $("#geo-instance-ref").value.trim(),
        geo_tenant_ref: $("#geo-tenant-ref").value.trim(),
        display_name: $("#geo-display-name").value.trim(),
        allowed_geo_origins: [$("#geo-allowed-origin").value.trim()],
        callback_base_url: $("#geo-callback-url").value.trim() || null,
      },
    });
    showGeoSecret(created.connector.id, created.client_secret);
    event.target.reset();
    toast("GEO 连接器已建立");
    await loadGeoAdmin();
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

async function rotateGeoConnector(connector) {
  if (
    !window.confirm(
      "轮换后旧密钥只保留24小时过渡期。请确认你能立即把新密钥安全交给 GEO 管理员。",
    )
  ) {
    return;
  }
  try {
    const result = await api(
      `/api/v1/integrations/geo/connectors/${connector.id}/rotate-secret`,
      { method: "POST", body: { version: connector.version } },
    );
    showGeoSecret(connector.id, result.client_secret);
    toast("客户端密钥已轮换");
    await loadGeoAdmin();
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

function showGeoSecret(connectorId, clientSecret) {
  $("#geo-connector-id-output").value = connectorId;
  $("#geo-client-secret-output").value = clientSecret;
  $("#geo-secret-card").classList.remove("hidden");
  $("#geo-secret-card").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function copyGeoSecret() {
  const text = [
    `连接器 ID：${$("#geo-connector-id-output").value}`,
    `客户端密钥：${$("#geo-client-secret-output").value}`,
    "协议版本：wentian-geo-connector@1",
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("连接信息已复制");
  } catch {
    $("#geo-client-secret-output").focus();
    $("#geo-client-secret-output").select();
    toast("已选中客户端密钥，请按 Command+C 复制");
  }
}

function renderGeoBindings() {
  const host = $("#geo-binding-list");
  host.replaceChildren();
  $("#geo-pending-count").textContent = `${state.geoBindings.length} 项`;
  const manageableScopes = state.scopes.filter(
    (scope) =>
      scope.status === "active" && ["owner", "admin"].includes(scope.role),
  );
  for (const binding of state.geoBindings) {
    const item = createListItem(
      binding.geo_project_display_name,
      `GEO 项目标识：${binding.geo_project_ref} · 申请时间 ${formatTime(binding.requested_at)}`,
    );
    const select = document.createElement("select");
    select.setAttribute(
      "aria-label",
      `为${binding.geo_project_display_name}选择问天项目`,
    );
    replaceOptions(
      select,
      manageableScopes.map((scope) => [scope.id, scopeLabel(scope)]),
      "没有可管理的项目",
    );
    select.className = "binding-scope-select";
    select.dataset.searchable = "";
    select.dataset.searchPlaceholder = "搜索问天项目";
    item.lastChild.append(
      select,
      buttonElement("批准", "primary", () =>
        approveGeoBinding(binding, select),
      ),
      buttonElement("拒绝", "secondary", () => rejectGeoBinding(binding)),
    );
    enhanceSearchableSelect(select);
    host.append(item);
  }
  if (!state.geoBindings.length) {
    host.append(emptyInline("当前没有待确认的项目申请。"));
  }
}

async function approveGeoBinding(binding, select) {
  if (!select.value) {
    toast("请先选择要关联的问天项目", true);
    return;
  }
  const scope = state.scopes.find((item) => item.id === select.value);
  if (
    !window.confirm(
      `确认把 GEO 项目“${binding.geo_project_display_name}”关联到问天项目“${scope?.display_name ?? ""}”？`,
    )
  ) {
    return;
  }
  try {
    await api(
      `/api/v1/integrations/geo/project-binding-requests/${binding.id}/approve`,
      {
        method: "POST",
        body: { scope_id: select.value, version: binding.version },
      },
    );
    toast("项目接入申请已批准");
    await loadGeoAdmin();
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

async function rejectGeoBinding(binding) {
  const reason = window.prompt("请输入拒绝原因。", "项目对应关系无法确认");
  if (!reason) return;
  try {
    await api(
      `/api/v1/integrations/geo/project-binding-requests/${binding.id}/reject`,
      {
        method: "POST",
        body: { reason: reason.trim(), version: binding.version },
      },
    );
    toast("项目接入申请已拒绝");
    await loadGeoAdmin();
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

function geoConnectorStatusText(status) {
  return (
    { active: "已连接", suspended: "已暂停", revoked: "已吊销" }[status] ??
    status
  );
}

async function logout() {
  try {
    await api("/api/v1/auth/logout", { method: "POST", body: {} });
  } finally {
    showLogin();
  }
}

async function loadScopes(preferredScopeId = null) {
  const result = await api("/api/v1/scopes");
  state.scopes = result.scopes;
  const select = $("#scope-select");
  replaceOptions(
    select,
    state.scopes.map((scope) => [scope.id, scopeLabel(scope)]),
    "暂无项目",
  );
  refreshScopeSelector();
  const nextScopeId =
    preferredScopeId &&
    state.scopes.some((scope) => scope.id === preferredScopeId)
      ? preferredScopeId
      : state.scopeId &&
          state.scopes.some((scope) => scope.id === state.scopeId)
        ? state.scopeId
        : (state.scopes[0]?.id ?? null);
  if (nextScopeId) {
    select.value = nextScopeId;
    syncSearchableSelect(select);
    await selectScope(nextScopeId);
  } else {
    state.scopeId = null;
    $("#empty-project").classList.remove("hidden");
    $("#project-workspace").classList.add("hidden");
    $("#automation-card").classList.add("hidden");
    $("#scope-danger-card").classList.add("hidden");
    $("#deleting-project").classList.add("hidden");
  }
}

function toggleScopeForm(show) {
  if (show) toggleScopeMetadataForm(false);
  $("#scope-form").classList.toggle("hidden", !show);
  $("#show-create-scope").classList.toggle("hidden", show);
  if (show) $("#scope-name").focus();
}

async function createScope(event) {
  event.preventDefault();
  try {
    const created = await api("/api/v1/scopes", {
      method: "POST",
      body: {
        project_key: $("#scope-key").value.trim(),
        display_name: $("#scope-name").value.trim(),
        industry: $("#scope-industry").value.trim(),
        region: $("#scope-region").value.trim(),
      },
    });
    event.target.reset();
    toggleScopeForm(false);
    toast("项目已创建");
    await loadScopes(created.id);
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

function toggleScopeMetadataForm(show) {
  const scope = state.scopes.find((item) => item.id === state.scopeId);
  const canEdit =
    Boolean(scope) &&
    (state.user?.instance_role === "owner" ||
      state.user?.instance_role === "admin");
  $("#scope-metadata-form").classList.toggle("hidden", !show);
  $("#show-scope-metadata").classList.toggle("hidden", show || !canEdit);
  if (!show || !scope || !canEdit) return;
  $("#scope-metadata-industry").value = scope.industry ?? "";
  $("#scope-metadata-region").value = scope.region ?? "";
  $("#scope-metadata-industry").focus();
}

async function updateScopeMetadata(event) {
  event.preventDefault();
  const scope = state.scopes.find((item) => item.id === state.scopeId);
  if (!scope) return;
  try {
    const updated = await api(`/api/v1/scopes/${scope.id}/metadata`, {
      method: "PATCH",
      body: {
        industry: $("#scope-metadata-industry").value.trim(),
        region: $("#scope-metadata-region").value.trim(),
        version: scope.version,
      },
    });
    state.scopes = state.scopes.map((item) =>
      item.id === updated.id ? updated : item,
    );
    toggleScopeMetadataForm(false);
    $("#snapshot-industry").value ||= updated.industry ?? "";
    $("#snapshot-region").value ||= updated.region ?? "";
    const select = $("#scope-select");
    replaceOptions(
      select,
      state.scopes.map((item) => [item.id, scopeLabel(item)]),
      "暂无项目",
    );
    select.value = updated.id;
    refreshScopeSelector();
    syncSearchableSelect(select);
    toast("项目地区和行业已更新");
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

function clearScopeFilters() {
  $("#scope-industry-filter").value = "";
  $("#scope-region-filter").value = "";
  refreshScopeSelector();
}

function refreshScopeSelector() {
  const industry = $("#scope-industry-filter")?.value.trim() ?? "";
  const region = $("#scope-region-filter")?.value.trim() ?? "";
  const matchingIds = new Set(
    state.scopes
      .filter(
        (scope) =>
          matchesFilter(scope.industry, industry) &&
          matchesFilter(scope.region, region),
      )
      .map((scope) => scope.id),
  );
  refreshSearchableSelect($("#scope-select"), (option) =>
    matchingIds.has(option.value),
  );
  if ($("#scope-filter-note")) {
    $("#scope-filter-note").textContent =
      industry || region
        ? `${matchingIds.size}/${state.scopes.length} 个项目`
        : `${state.scopes.length} 个项目`;
  }
}

async function selectScope(scopeId) {
  state.scopeId = scopeId;
  state.activeRunId = null;
  state.keywordInsights = null;
  state.deletionJob = null;
  $("#empty-project").classList.add("hidden");
  const scope = state.scopes.find((item) => item.id === scopeId);
  $("#project-title").textContent = scope?.display_name ?? "项目";
  $("#snapshot-industry").value = scope?.industry ?? "";
  $("#snapshot-region").value = scope?.region ?? "";
  toggleScopeMetadataForm(false);
  const canDelete =
    state.user?.instance_role === "owner" && scope?.role === "owner";
  $("#scope-danger-card").classList.toggle("hidden", !canDelete);
  if (scope?.status === "deleting") {
    $("#project-workspace").classList.add("hidden");
    $("#automation-card").classList.add("hidden");
    $("#deleting-project").classList.remove("hidden");
    await loadScopeDeletion();
    return;
  }
  $("#deleting-project").classList.add("hidden");
  $("#project-workspace").classList.remove("hidden");
  $("#automation-card").classList.remove("hidden");
  renderScopeDeletionControl(scope);
  await refreshProject();
}

function toggleScopeDeletionForm(show) {
  $("#scope-deletion-form").classList.toggle("hidden", !show);
  $("#show-scope-deletion").classList.toggle("hidden", show);
  if (show) $("#scope-deletion-key").focus();
  if (!show) {
    $("#scope-deletion-form").reset();
  }
}

function renderScopeDeletionControl(scope) {
  const failed = state.deletionJob?.status === "failed";
  $("#scope-deletion-note").textContent = failed
    ? `上次清理失败（${state.deletionJob.last_error_code}），可以重新验证密码后重试。`
    : "删除会清理问题、运行、证据和排名，操作不可撤销。";
  $("#show-scope-deletion").textContent = failed ? "重试删除" : "删除当前项目";
  $("#submit-scope-deletion").textContent = failed ? "确认重试" : "确认删除";
  $("#scope-deletion-key").disabled = failed;
  $("#scope-deletion-key").value = failed ? (scope?.project_key ?? "") : "";
}

async function loadScopeDeletion() {
  const scope = state.scopes.find((item) => item.id === state.scopeId);
  try {
    state.deletionJob = await api(`/api/v1/scopes/${state.scopeId}/deletion`);
    renderScopeDeletionControl(scope);
    $("#deleting-project-note").textContent =
      state.deletionJob.status === "failed"
        ? "跨存储清理未完成。请使用左侧“重试删除”并重新验证当前账号密码。"
        : "系统正在清理数据库和对象存储，请稍后刷新。";
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

async function deleteScope(event) {
  event.preventDefault();
  const scope = state.scopes.find((item) => item.id === state.scopeId);
  if (!scope) return;
  const retry = state.deletionJob?.status === "failed";
  const confirmed = window.confirm(
    retry
      ? "确认重新执行项目清理？"
      : `确认永久删除“${scope.display_name}”？该操作没有回收站。`,
  );
  if (!confirmed) return;
  const password = $("#scope-deletion-password").value;
  try {
    const job = retry
      ? await api(`/api/v1/scope-deletions/${state.deletionJob.id}/retry`, {
          method: "POST",
          body: { password },
        })
      : await api(`/api/v1/scopes/${scope.id}/deletion`, {
          method: "POST",
          body: {
            project_key: $("#scope-deletion-key").value.trim(),
            password,
            version: scope.version,
          },
        });
    $("#scope-deletion-password").value = "";
    state.deletionJob = job;
    toggleScopeDeletionForm(false);
    if (job.status === "succeeded") {
      state.scopeId = null;
      toast("项目及其业务数据已删除");
      await loadScopes();
      return;
    }
    renderScopeDeletionControl(scope);
    $("#project-workspace").classList.add("hidden");
    $("#automation-card").classList.add("hidden");
    $("#deleting-project").classList.remove("hidden");
    $("#deleting-project-note").textContent =
      "跨存储清理未完成。请使用左侧“重试删除”继续处理。";
    toast("项目已停止写入，但清理尚未完成", true);
  } catch (error) {
    $("#scope-deletion-password").value = "";
    toast(friendlyError(error), true);
  }
}

async function refreshProject() {
  if (!state.scopeId) return;
  try {
    const [settings, catalog] = await Promise.all([
      api(`/api/v1/scopes/${state.scopeId}/consumer-settings`),
      api(`/api/v1/scopes/${state.scopeId}/consumer-catalog`),
    ]);
    state.settings = settings;
    state.catalog = catalog;
    renderSettings();
    renderCatalog();
    if (state.workspaceView === "keywords") {
      await loadKeywordInsights();
    }
    if (
      state.activeRunId &&
      catalog.runs.some((run) => run.id === state.activeRunId)
    ) {
      await loadTasks(state.activeRunId);
    }
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

function renderSettings() {
  $("#automation-toggle").checked = state.settings.automation_enabled;
  $("#automation-note").textContent = state.settings.automation_enabled
    ? "已允许自动化；各 AI 平台的生产自动执行器仍分别受外部授权门禁限制。"
    : "关闭时仅支持用户在场采集和手工导入。";
  if (state.activeRunId) updateClaimNextTask();
}

async function updateAutomation(event) {
  const enabled = event.target.checked;
  if (
    enabled &&
    !window.confirm(
      "打开只表示问天允许已授权的自动化任务，不代表豆包、千问或 DeepSeek 已经授权，也不会绕过各平台的生产执行门禁。是否保存？",
    )
  ) {
    event.target.checked = false;
    return;
  }
  event.target.disabled = true;
  try {
    state.settings = await api(
      `/api/v1/scopes/${state.scopeId}/consumer-settings`,
      {
        method: "PATCH",
        body: {
          automation_enabled: enabled,
          version: state.settings.version,
        },
      },
    );
    renderSettings();
    toast(enabled ? "自动化开关已打开" : "自动化开关已关闭");
  } catch (error) {
    event.target.checked = !enabled;
    toast(friendlyError(error), true);
  } finally {
    event.target.disabled = false;
  }
}

function renderCatalog() {
  updateBusinessSuggestions();
  renderSnapshots();
  renderRuns();
  renderRunSelectors();
  updateRunForm();
}

function renderSnapshots() {
  const host = $("#snapshot-list");
  host.replaceChildren();
  const industry = $("#snapshot-industry-filter").value.trim();
  const region = $("#snapshot-region-filter").value.trim();
  const snapshots = state.catalog.snapshots.filter(
    (snapshot) =>
      matchesFilter(snapshot.industry, industry) &&
      matchesFilter(snapshot.region, region),
  );
  $("#snapshot-count").textContent =
    industry || region
      ? `${snapshots.length}/${state.catalog.snapshots.length} 个问题集`
      : `${state.catalog.snapshots.length} 个问题集`;
  for (const snapshot of snapshots) {
    const item = createListItem(
      snapshot.title,
      `${businessLabel(snapshot)} · ${snapshot.query_count} 个问题 · ${snapshot.generator_version ? "模板生成" : "手工创建"} · ${formatTime(snapshot.created_at)} · ${snapshot.snapshot_hash.slice(0, 10)}`,
    );
    const button = buttonElement("用于新实验", "secondary", () => {
      setSearchableSelectValue($("#run-snapshot"), snapshot.id);
      updateRunCreateSummary();
      showPanel("runs-panel");
    });
    item.lastChild.append(button);
    host.append(item);
  }
  if (!snapshots.length)
    host.append(
      emptyInline(
        state.catalog.snapshots.length
          ? "没有符合当前地区和行业筛选的问题集。"
          : "尚未建立问题集。",
      ),
    );
}

function generateQuestions() {
  try {
    const generated = generateIndustryQuestions({
      industry: $("#snapshot-industry").value,
      region: $("#snapshot-region").value,
      count: $("#question-generate-count").value,
    });
    state.generatedQuestions = generated;
    $("#query-lines").value = generated.map((item) => item.text).join("\n");
    $("#question-generator-note").textContent =
      `已生成 ${generated.length} 个问题，可直接修改；未改写的条目会保留模板意图。`;
    toast(`已生成 ${generated.length} 个行业问题，请检查后保存`);
  } catch (error) {
    toast(error.message, true);
  }
}

async function createSnapshot(event) {
  event.preventDefault();
  const queries = $("#query-lines")
    .value.split(/\n+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (!queries.length || queries.length > 100) {
    toast("问题数量必须为1到100个", true);
    return;
  }
  try {
    const generatedIntents = new Map(
      state.generatedQuestions.map((item) => [item.text, item.intentCode]),
    );
    const created = await api("/api/v1/query-set-snapshots", {
      method: "POST",
      body: {
        scope_id: state.scopeId,
        title: $("#snapshot-title").value.trim(),
        locale: "zh-CN",
        market: $("#snapshot-region").value.trim(),
        industry: $("#snapshot-industry").value.trim(),
        region: $("#snapshot-region").value.trim(),
        ...(state.generatedQuestions.length
          ? { generator_version: QUESTION_GENERATOR_VERSION }
          : {}),
        queries: queries.map((query, index) => ({
          external_key: `q${String(index + 1).padStart(3, "0")}`,
          query_text: query,
          intent_code: generatedIntents.get(query) ?? $("#query-intent").value,
          commercial_value: $("#commercial-value").value,
        })),
      },
    });
    $("#query-lines").value = "";
    state.generatedQuestions = [];
    $("#question-generator-note").textContent =
      "填写行业和地区后生成；内容会先进入下方文本框，可修改后再保存。";
    await refreshProject();
    setSearchableSelectValue($("#run-snapshot"), created.id);
    updateRunCreateSummary();
    toast(`问题集“${created.title}”已保存并用于下一次实验`);
    showPanel("runs-panel");
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

function renderRuns() {
  const host = $("#run-list");
  host.replaceChildren();
  const industry = $("#run-industry-filter").value.trim();
  const region = $("#run-business-region-filter").value.trim();
  const runs = state.catalog.runs.filter(
    (run) =>
      matchesFilter(run.industry, industry) &&
      matchesFilter(run.region, region),
  );
  $("#run-count").textContent =
    industry || region
      ? `${runs.length}/${state.catalog.runs.length} 次运行`
      : `${state.catalog.runs.length} 次运行`;
  for (const run of runs) {
    const type =
      run.experiment_kind === "natural_answer" ? "自然回答" : "信源自述";
    const item = createListItem(
      `${type} · ${surfaceName(run.surface_code)} · ${snapshotName(run.query_set_snapshot_id)}`,
      `${businessLabel(run)} · ${run.planned_sample_count}次采样 · 每题${run.requested_sample_count}次 · ${formatTime(run.created_at)} · ${shortId(run.id)}`,
    );
    item.firstChild.append(statusElement(run.status));
    item.lastChild.append(
      buttonElement("打开运行", "secondary", () => {
        state.activeRunId = run.id;
        setSearchableSelectValue($("#task-run-select"), run.id);
        showPanel("tasks-panel");
        void loadTasks(run.id);
      }),
    );
    if (
      run.experiment_kind === "natural_answer" &&
      terminalStatuses.has(run.status)
    ) {
      item.lastChild.append(
        buttonElement("查看结果 ↗", "primary", () =>
          openReportTab({ mode: "ranking", runId: run.id }),
        ),
      );
    }
    if (canDeleteRun(run)) {
      const deleteButton = buttonElement("删除", "danger-quiet", () =>
        deleteUnstartedRun(run, deleteButton),
      );
      item.lastChild.append(deleteButton);
    }
    host.append(item);
  }
  if (!runs.length)
    host.append(
      emptyInline(
        state.catalog.runs.length
          ? "没有符合当前地区和行业筛选的实验运行。"
          : "尚未创建实验运行。",
      ),
    );
}

function canDeleteRun(run) {
  const scope = state.scopes.find((item) => item.id === state.scopeId);
  return (
    run.status === "queued" &&
    state.user?.instance_role === "owner" &&
    scope?.role === "owner"
  );
}

async function deleteUnstartedRun(run, button) {
  const runName = snapshotName(run.query_set_snapshot_id);
  if (
    !window.confirm(
      `确认删除“${runName}”的这次待开始运行？\n\n将删除 ${run.planned_sample_count} 次未领取采样，且无法恢复。问题集和其他运行不受影响。`,
    )
  ) {
    return;
  }
  button.disabled = true;
  try {
    await api(`/api/v1/scopes/${state.scopeId}/runs/${run.id}`, {
      method: "DELETE",
    });
    if (state.activeRunId === run.id) {
      state.activeRunId = null;
      state.tasks = [];
      $("#handoff-card").classList.add("hidden");
      $("#batch-handoff-card").classList.add("hidden");
    }
    await refreshProject();
    toast(`已删除“${runName}”的待开始运行`);
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function renderRunSelectors() {
  replaceOptions(
    $("#run-snapshot"),
    state.catalog.snapshots.map((snapshot) => [
      snapshot.id,
      `${snapshot.title} · ${businessLabel(snapshot)} · ${snapshot.query_count}题 · ${shortId(snapshot.id)}`,
    ]),
    "请先建立问题集",
  );
  replaceOptions(
    $("#task-run-select"),
    state.catalog.runs.map((run) => [run.id, runLabel(run)]),
    "暂无运行",
  );
  const completedNatural = state.catalog.runs.filter(
    (run) =>
      run.experiment_kind === "natural_answer" &&
      terminalStatuses.has(run.status),
  );
  replaceOptions(
    $("#paired-run"),
    completedNatural.map((run) => [run.id, runLabel(run)]),
    "请先完成自然回答运行",
  );
  replaceOptions(
    $("#comparison-natural"),
    completedNatural.map((run) => [run.id, runLabel(run)]),
    "暂无已完成运行",
  );
  replaceOptions(
    $("#keyword-run-filter"),
    [
      ["__all__", "全部自然回答运行"],
      ...state.catalog.runs
        .filter((run) => run.experiment_kind === "natural_answer")
        .map((run) => [run.id, runLabel(run)]),
    ],
    "暂无自然回答运行",
  );
  renderComparisonSelectors();
  if (!state.activeRunId) renderTaskRunContext();
}

function updateRunForm() {
  const nomination = $("#experiment-kind").value === "source_nomination";
  $("#paired-run-field").classList.toggle("hidden", !nomination);
  $("#run-guidance").textContent = nomination
    ? "系统会把原问题转换为“请列出优先参考的前10个域名”提示。为保证可比，问题集、采样次数、搜索状态、登录状态、地区及新对话设置会与配对运行保持一致。"
    : "自然回答实验使用原问题，排名只累计回答中可见、经确认的正式链接信源。";
  if (nomination) syncPairedRunConfiguration();
  for (const id of [
    "#run-surface",
    "#run-snapshot",
    "#sample-count",
    "#search-mode",
    "#run-region",
    "#run-logged-in",
    "#run-new-chat",
  ]) {
    $(id).disabled = nomination;
    syncSearchableSelect($(id));
  }
  updateRunCreateSummary();
}

function syncPairedRunConfiguration() {
  const run = state.catalog.runs.find(
    (item) => item.id === $("#paired-run").value,
  );
  if (!run) return;
  setSearchableSelectValue($("#run-snapshot"), run.query_set_snapshot_id);
  $("#run-surface").value = run.surface_code;
  $("#sample-count").value = String(run.requested_sample_count);
  $("#search-mode").value = run.session_conditions.search_mode;
  $("#run-region").value = run.session_conditions.region ?? "";
  $("#run-logged-in").checked = run.session_conditions.is_logged_in;
  $("#run-new-chat").checked = run.session_conditions.is_new_conversation;
  updateRunCreateSummary();
}

function updateRunCreateSummary() {
  const host = $("#run-create-summary");
  const button = $("#create-run-button");
  const snapshot = state.catalog.snapshots.find(
    (item) => item.id === $("#run-snapshot").value,
  );
  const sampleCount = Number($("#sample-count").value);
  if (!snapshot || !Number.isInteger(sampleCount)) {
    host.replaceChildren(element("p", null, "请先选择问题集和采样次数。"));
    button.textContent = "创建实验运行";
    return;
  }
  const taskCount = snapshot.query_count * sampleCount;
  const type =
    $("#experiment-kind").value === "source_nomination"
      ? "信源自述"
      : "自然回答";
  const surface = surfaceName($("#run-surface").value);
  host.replaceChildren(
    element("span", "run-create-label", "本次将创建"),
    element(
      "strong",
      null,
      `${type} · ${surface} · ${snapshot.title} · ${snapshot.query_count}题 × 每题${sampleCount}次 = 共${taskCount}次采样`,
    ),
    element(
      "small",
      null,
      "新运行初始状态为“待开始”，不会继承任何历史运行的完成状态。",
    ),
  );
  button.textContent = `创建实验运行（${taskCount}次采样）`;
}

async function createRun(event) {
  event.preventDefault();
  const nomination = $("#experiment-kind").value === "source_nomination";
  const pairedRunId = nomination ? $("#paired-run").value : null;
  if (nomination && !pairedRunId) {
    toast("信源自述实验必须选择一个已完成的自然回答运行", true);
    return;
  }
  const snapshot = state.catalog.snapshots.find(
    (item) => item.id === $("#run-snapshot").value,
  );
  const sampleCount = Number($("#sample-count").value);
  if (!snapshot || !Number.isInteger(sampleCount)) {
    toast("请选择有效的问题集和采样次数", true);
    return;
  }
  try {
    const created = await api("/api/v1/ai-visibility/consumer-observations", {
      method: "POST",
      body: {
        scope_id: state.scopeId,
        query_set_snapshot_id: snapshot.id,
        surface_code: $("#run-surface").value,
        collection_method: "browser_assisted",
        experiment_kind: $("#experiment-kind").value,
        sample_count: sampleCount,
        session_conditions: {
          search_mode: $("#search-mode").value,
          is_new_conversation: $("#run-new-chat").checked,
          is_logged_in: $("#run-logged-in").checked,
          memory_enabled: null,
          personalization_enabled: null,
          locale: "zh-CN",
          region: $("#run-region").value.trim() || null,
        },
        paired_run_id: pairedRunId,
      },
    });
    toast(
      `已创建“${snapshot.title}”实验运行，共${created.planned_sample_count}次采样，状态：待开始`,
    );
    state.activeRunId = created.id;
    await refreshProject();
    setSearchableSelectValue($("#task-run-select"), created.id);
    showPanel("tasks-panel");
    await loadTasks(created.id);
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

async function loadTasks(runId) {
  if (!runId || !state.scopeId) return;
  if (state.activeRunId && state.activeRunId !== runId) {
    $("#handoff-card").classList.add("hidden");
    $("#batch-handoff-card").classList.add("hidden");
  }
  state.activeRunId = runId;
  setSearchableSelectValue($("#task-run-select"), runId);
  try {
    const result = await api(
      `/api/v1/scopes/${state.scopeId}/runs/${runId}/tasks`,
    );
    state.tasks = result.tasks;
    renderTasks();
    renderTaskAutoRefreshStatus("已同步");
    const run = currentRun();
    if (run?.experiment_kind === "source_nomination") {
      await loadNominationReviews(runId);
    } else {
      $("#nomination-reviews").replaceChildren();
    }
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

async function autoRefreshTasks(force = false) {
  const tasksPanel = $("#tasks-panel");
  if (
    !state.user ||
    !state.scopeId ||
    !state.activeRunId ||
    document.hidden ||
    tasksPanel.classList.contains("hidden") ||
    taskAutoRefreshInFlight ||
    bulkConfirmInFlight ||
    (!force && Date.now() - lastTaskAutoRefreshAt < taskAutoRefreshIntervalMs)
  ) {
    return;
  }

  const scopeId = state.scopeId;
  const runId = state.activeRunId;
  taskAutoRefreshInFlight = true;
  renderTaskAutoRefreshStatus("同步中…", false);
  try {
    const result = await api(`/api/v1/scopes/${scopeId}/runs/${runId}/tasks`);
    if (state.scopeId !== scopeId || state.activeRunId !== runId) return;
    const changed =
      taskFingerprint(state.tasks) !== taskFingerprint(result.tasks);
    state.tasks = result.tasks;
    if (changed) {
      renderTasks();
      if (currentRun()?.experiment_kind === "source_nomination") {
        await loadNominationReviews(runId);
      }
    }
    if (!changed) renderTaskRunContext();
    renderTaskAutoRefreshStatus(changed ? "已更新" : "已同步");
  } catch {
    if (state.scopeId === scopeId && state.activeRunId === runId) {
      renderTaskAutoRefreshStatus("暂时失败，稍后重试", false);
    }
  } finally {
    lastTaskAutoRefreshAt = Date.now();
    taskAutoRefreshInFlight = false;
  }
}

function taskFingerprint(tasks) {
  return tasks
    .map((task) => `${task.id}:${task.status}:${task.task_version}`)
    .join("|");
}

function renderTaskAutoRefreshStatus(label, includeTime = true) {
  const host = $("#task-auto-refresh-status");
  if (!host) return;
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
  host.textContent = includeTime
    ? `自动同步：${label} · ${time}`
    : `自动同步：${label}`;
}

function renderTasks() {
  const host = $("#task-list");
  host.replaceChildren();
  for (const group of groupTasksByQuestion(state.tasks)) {
    host.append(renderQuestionTaskGroup(group));
  }
  if (!state.tasks.length) host.append(emptyInline("该运行没有采样。"));
  updateClaimNextTask();
  renderTaskRunContext();
}

function groupTasksByQuestion(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    const key = task.query_snapshot_item_id;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        queryText: task.query_text,
        tasks: [],
      });
    }
    groups.get(key).tasks.push(task);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    tasks: group.tasks.sort(
      (left, right) => left.sample_index - right.sample_index,
    ),
  }));
}

function renderQuestionTaskGroup(group) {
  const counts = taskStatusCounts(group.tasks);
  const actionable = group.tasks.some((task) =>
    ["waiting_user", "capturing", "needs_review"].includes(task.status),
  );
  const card = element("details", "question-task-card");
  card.open = actionable;

  const summary = element("summary", "question-task-summary");
  const copy = element("div", "question-task-copy");
  const title = `${group.queryText.slice(0, 100)}${group.queryText.length > 100 ? "…" : ""}`;
  copy.append(
    element("h3", null, title),
    element("p", null, taskGroupSummary(group.tasks, counts)),
  );
  const summaryStatus = element("div", "question-task-summary-status");
  summaryStatus.append(
    aggregateTaskStatusElement(group.tasks, counts),
    element(
      "span",
      "question-task-toggle",
      card.open ? "收起采样" : "展开采样",
    ),
  );
  summary.append(copy, summaryStatus);

  const samples = element("div", "sample-task-list");
  for (const task of group.tasks) samples.append(renderSampleTask(task));
  card.addEventListener("toggle", () => {
    const label = card.querySelector(".question-task-toggle");
    if (label) label.textContent = card.open ? "收起采样" : "展开采样";
  });
  card.append(summary, samples);
  return card;
}

function taskStatusCounts(tasks) {
  const counts = Object.create(null);
  for (const task of tasks) {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
  }
  return counts;
}

function taskGroupSummary(tasks, counts) {
  const parts = [
    `${tasks.length}次采样`,
    `${counts.confirmed ?? 0}/${tasks.length}次已确认`,
  ];
  if (counts.needs_review) parts.push(`${counts.needs_review}次待复核`);
  if (counts.capturing) parts.push(`${counts.capturing}次采集中`);
  if (counts.waiting_user) parts.push(`${counts.waiting_user}次待采集`);
  if (counts.rejected) parts.push(`${counts.rejected}次已拒绝`);
  return parts.join(" · ");
}

function aggregateTaskStatusElement(tasks, counts) {
  if ((counts.confirmed ?? 0) === tasks.length) {
    const status = statusElement("confirmed");
    status.textContent = "采样完成";
    return status;
  }
  if (counts.needs_review) return statusElement("needs_review");
  if (counts.capturing) return statusElement("capturing");
  if (counts.waiting_user) return statusElement("waiting_user");
  if (counts.rejected) return statusElement("rejected");
  return statusElement(tasks[0]?.status ?? "cancelled");
}

function renderSampleTask(task) {
  const item = element("article", "sample-task-row");
  const copy = element("div", "sample-task-copy");
  copy.append(
    element("strong", null, `第 ${task.sample_index} 次采样`),
    element("small", null, `采样ID ${shortId(task.id)}`),
  );
  item.append(copy, statusElement(task.status));
  const actions = element("div", "list-actions");
  if (task.status === "waiting_user" || task.status === "capturing") {
    actions.append(
      buttonElement(
        task.status === "waiting_user" ? "领取本次采样" : "重新生成接入码",
        "primary",
        () => claimTask(task.id),
      ),
    );
  } else if (task.status === "needs_review") {
    actions.append(
      buttonElement("预览内容", "secondary", (event) =>
        toggleTaskPreview(task, item, event.currentTarget),
      ),
      buttonElement("确认采集", "primary", () => confirmTask(task)),
      buttonElement("驳回", "secondary", () => rejectTask(task)),
    );
  } else if (task.status === "confirmed") {
    actions.append(
      buttonElement("预览内容", "secondary", (event) =>
        toggleTaskPreview(task, item, event.currentTarget),
      ),
    );
  }
  item.append(actions);
  return item;
}

function renderTaskRunContext() {
  const host = $("#task-run-context");
  const run = currentRun();
  if (!run) {
    host.replaceChildren(
      element(
        "p",
        "task-run-context-empty",
        "选择一个运行后，下方会按问题汇总该运行的采样。",
      ),
    );
    return;
  }
  const type =
    run.experiment_kind === "natural_answer" ? "自然回答" : "信源自述";
  const counts = taskStatusCounts(state.tasks);
  const questionCount = groupTasksByQuestion(state.tasks).length;
  const heading = element("div", "task-run-context-heading");
  const copy = element("div");
  copy.append(
    element("span", "task-run-context-label", "当前运行"),
    element("strong", null, snapshotName(run.query_set_snapshot_id)),
  );
  const facts = element("div", "task-run-context-facts");
  for (const value of [
    type,
    statusText(run.status),
    `${questionCount}个问题`,
    `每题${run.requested_sample_count}次`,
    `共${run.planned_sample_count}次采样`,
    `${counts.confirmed ?? 0}次已确认`,
    `${counts.waiting_user ?? 0}次待采集`,
    `${counts.needs_review ?? 0}次待复核`,
    `创建于 ${formatTime(run.created_at)}`,
    `运行 ${shortId(run.id)}`,
  ]) {
    facts.append(element("span", null, value));
  }
  heading.append(copy, facts);
  host.replaceChildren(
    heading,
    element(
      "p",
      null,
      "下方按问题汇总当前运行，每次采样仍保留独立状态和证据。中断续接只会继续剩余采样，不会创建新运行；历史运行可通过右上角“查看运行”切换。",
    ),
  );
}

function updateClaimNextTask() {
  const waitingCount = state.tasks.filter(
    (task) => task.status === "waiting_user",
  ).length;
  const activeCount = state.tasks.filter(
    (task) => task.status === "waiting_user" || task.status === "capturing",
  ).length;
  const button = $("#claim-next-task");
  button.disabled = waitingCount === 0;
  button.textContent =
    waitingCount > 0 ? `领取下一次采样（${waitingCount}）` : "暂无待采集";
  const batchButton = $("#create-batch-handoff");
  const automationEnabled = Boolean(state.settings?.automation_enabled);
  batchButton.disabled = !automationEnabled || activeCount === 0;
  batchButton.textContent =
    activeCount > 0 ? `整批接入（${activeCount}）` : "整批已完成";
  $("#claim-next-note").textContent = !automationEnabled
    ? "打开左侧自动化开关后可创建整批接入码"
    : activeCount > 0
      ? "整批码 2 小时有效；扩展会逐个采样单元领取，结果统一进入人工复核"
      : "当前运行没有待采集内容";
  const reviewCount = state.tasks.filter(
    (task) => task.status === "needs_review",
  ).length;
  const confirmAllButton = $("#confirm-all-tasks");
  confirmAllButton.disabled = bulkConfirmInFlight || reviewCount === 0;
  confirmAllButton.textContent = bulkConfirmInFlight
    ? "正在确认"
    : reviewCount > 0
      ? `一键确认（${reviewCount}次）`
      : "暂无待复核";
}

async function toggleTaskPreview(task, item, button) {
  const existing = item.querySelector(".task-preview");
  if (existing) {
    existing.remove();
    button.textContent = "预览内容";
    return;
  }
  button.disabled = true;
  button.textContent = "正在加载";
  try {
    const preview = await api(
      `/api/v1/scopes/${state.scopeId}/runs/${task.run_id}/tasks/${task.id}/preview`,
    );
    const panel = element("section", "task-preview");
    panel.append(
      element(
        "p",
        "tiny",
        `${preview.visible_metadata.product_label} · ${formatTime(preview.visible_metadata.observed_at)} · 截图证据已保存`,
      ),
      element("pre", null, preview.answer_text),
    );
    panel.append(renderTaskVisibleSearchTrace(preview.visible_search_trace));
    if (preview.visible_citations.length) {
      const links = element("ol", "task-preview-links");
      for (const citation of preview.visible_citations) {
        const itemNode = element("li");
        const link = element("a", null, citation.label || citation.url);
        link.href = citation.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        itemNode.append(link);
        links.append(itemNode);
      }
      panel.append(links);
    } else {
      panel.append(element("p", "tiny", "回答中没有可见的正式链接信源。"));
    }
    item.append(panel);
    button.textContent = "收起预览";
  } catch (error) {
    button.textContent = "预览内容";
    toast(friendlyError(error), true);
  } finally {
    button.disabled = false;
  }
}

function renderTaskVisibleSearchTrace(trace) {
  const section = element("section", "task-search-trace");
  const heading = element("div", "task-search-trace-heading");
  heading.append(
    element("strong", null, "页面可见检索轨迹"),
    element(
      "span",
      `trace-status ${trace?.status ?? "not_collected"}`,
      visibleSearchTraceStatusText(trace?.status ?? "not_collected"),
    ),
  );
  section.append(heading);
  if (!trace) {
    section.append(
      element(
        "p",
        "tiny",
        "该历史采样发生时尚未采集这一字段；系统不会从回答或引用反推。",
      ),
    );
    return section;
  }
  if (trace.summary_text) {
    section.append(element("p", "trace-summary", trace.summary_text));
  }
  if (trace.keywords.length) {
    const chips = element("div", "keyword-chip-list");
    for (const keyword of trace.keywords) {
      chips.append(element("span", null, keyword.text));
    }
    section.append(chips);
  } else {
    section.append(
      element("p", "tiny", "本次页面没有可用于统计的可见检索词。"),
    );
  }
  section.append(
    element(
      "p",
      "tiny",
      `页面声明 ${trace.declared_keyword_count} 个检索词、${trace.declared_reference_count ?? "未声明"} 篇参考资料；不代表平台内部真实搜索行为。`,
    ),
  );
  return section;
}

async function confirmAllTasks() {
  const pending = state.tasks.filter((task) => task.status === "needs_review");
  if (!pending.length || bulkConfirmInFlight) return;
  const runId = state.activeRunId;
  if (
    !window.confirm(
      `确认当前运行的 ${pending.length} 次采样内容？确认后会作为正式信源数据进入排名，且不可撤销。`,
    )
  ) {
    return;
  }
  bulkConfirmInFlight = true;
  const button = $("#confirm-all-tasks");
  let confirmedCount = 0;
  try {
    for (const task of pending) {
      button.textContent = `确认中 ${confirmedCount + 1}/${pending.length}`;
      await api(
        `/api/v1/ai-visibility/consumer-observations/tasks/${task.id}/confirm`,
        {
          method: "POST",
          body: { task_version: task.task_version },
        },
      );
      confirmedCount += 1;
    }
    toast(`已确认当前运行的 ${confirmedCount} 次采样内容`);
  } catch (error) {
    toast(
      `已确认 ${confirmedCount} 次采样，其余内容未处理：${friendlyError(error)}`,
      true,
    );
  } finally {
    bulkConfirmInFlight = false;
    if (state.activeRunId === runId) await refreshProject();
    updateClaimNextTask();
  }
}

async function createAutomationBatch() {
  if (!state.scopeId || !state.activeRunId) {
    toast("请先选择实验运行", true);
    return;
  }
  const button = $("#create-batch-handoff");
  button.disabled = true;
  button.textContent = "正在生成";
  try {
    const batch = await api(
      `/api/v1/scopes/${state.scopeId}/runs/${state.activeRunId}/automation-batch`,
      { method: "POST", body: {} },
    );
    $("#batch-handoff-code").value = batch.batch_handoff_code;
    $("#batch-handoff-expiry").textContent =
      `共 ${batch.remaining_task_count} 次待采集，有效至 ${formatTime(batch.token_expires_at)}。停止后可重新生成整批码继续；已提交结果仍需在问天复核。`;
    $("#handoff-card").classList.add("hidden");
    $("#batch-handoff-card").classList.remove("hidden");
    $("#batch-handoff-card").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  } catch (error) {
    toast(friendlyError(error), true);
  } finally {
    updateClaimNextTask();
  }
}

async function claimNextTask() {
  const nextTask = state.tasks.find((task) => task.status === "waiting_user");
  if (!nextTask) {
    updateClaimNextTask();
    toast("当前没有等待领取的采样", true);
    return;
  }
  $("#claim-next-task").disabled = true;
  await claimTask(nextTask.id);
  updateClaimNextTask();
}

async function claimTask(taskId) {
  try {
    const claimed = await api(
      `/api/v1/ai-visibility/consumer-observations/tasks/${taskId}/claim`,
      { method: "POST", body: {} },
    );
    $("#handoff-query").value = claimed.task.query_text;
    $("#handoff-code").value = claimed.extension_handoff_code;
    $("#handoff-expiry").textContent =
      `有效至 ${formatTime(claimed.token_expires_at)}。接入码只允许提交这一次采样，成功使用后即失效。`;
    $("#handoff-card").classList.remove("hidden");
    $("#handoff-card").scrollIntoView({ behavior: "smooth", block: "start" });
    await loadTasks(claimed.task.run_id);
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

async function confirmTask(task) {
  if (
    !window.confirm(
      `确认采集内容与${surfaceName(currentRun()?.surface_code)}页面一致，并把它计入本次实验？`,
    )
  )
    return;
  try {
    await api(
      `/api/v1/ai-visibility/consumer-observations/tasks/${task.id}/confirm`,
      {
        method: "POST",
        body: { task_version: task.task_version },
      },
    );
    toast(
      currentRun()?.experiment_kind === "source_nomination"
        ? "采集已确认，请继续复核提取出的域名"
        : "采集已确认并计入排名",
    );
    await refreshProject();
    await loadTasks(task.run_id);
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

async function rejectTask(task) {
  const reason = window.prompt(
    "请输入驳回原因。截图证据会立即清理。",
    "选取范围不正确",
  );
  if (!reason) return;
  try {
    await api(
      `/api/v1/ai-visibility/consumer-observations/tasks/${task.id}/reject`,
      {
        method: "POST",
        body: { task_version: task.task_version, rejection_reason: reason },
      },
    );
    toast("采集已驳回，暂存证据已清理");
    await refreshProject();
    await loadTasks(task.run_id);
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

async function loadNominationReviews(runId) {
  const result = await api(
    `/api/v1/scopes/${state.scopeId}/runs/${runId}/nomination-reviews`,
  );
  const host = $("#nomination-reviews");
  host.replaceChildren();
  for (const review of result.reviews) host.append(renderReview(review));
}

function renderReview(review) {
  const card = element("section", "review-card");
  const title = element(
    "h3",
    null,
    `信源域名复核 · ${shortId(review.response_id)}`,
  );
  const note = element(
    "p",
    "tiny",
    review.status === "needs_review"
      ? "只提取回答中明确出现的域名，不会把媒体或机构名称猜成域名。请修正后确认。"
      : `复核状态：${statusText(review.status)}`,
  );
  card.append(title, note);
  if (review.status !== "needs_review") {
    card.append(
      rankingTable(
        review.proposed_items.map((item, index) => ({
          rank: index + 1,
          registrable_domain: item.registrable_domain,
          entry_count: 1,
        })),
      ),
    );
    return card;
  }
  const grid = element("div", "review-grid");
  review.proposed_items.forEach((item, index) => {
    grid.append(element("span", "position", String(index + 1)));
    const domain = document.createElement("input");
    domain.value = item.registrable_domain;
    domain.dataset.reviewDomain = "true";
    domain.maxLength = 253;
    domain.setAttribute("aria-label", `第${index + 1}个域名`);
    const reason = document.createElement("input");
    reason.value = item.reason ?? "";
    reason.dataset.reviewReason = "true";
    reason.maxLength = 2000;
    reason.placeholder = "理由（可选）";
    reason.setAttribute("aria-label", `第${index + 1}个理由`);
    grid.append(domain, reason);
  });
  if (!review.proposed_items.length) {
    grid.append(
      element(
        "p",
        "tiny",
        "回答中没有发现明确域名。可以确认空结果，系统会保留“本次无有效提名”的样本。",
      ),
    );
  }
  const actions = element("div", "button-row");
  actions.append(
    buttonElement("确认域名", "primary", () => confirmReview(review, card)),
    buttonElement("拒绝本次自述", "secondary", () => rejectReview(review)),
  );
  card.append(grid, actions);
  return card;
}

async function confirmReview(review, card) {
  const domains = [...card.querySelectorAll("[data-review-domain]")];
  const reasons = [...card.querySelectorAll("[data-review-reason]")];
  const reviewedItems = domains
    .map((input, index) => ({
      domain: input.value.trim().toLowerCase().replace(/\.$/, ""),
      reason: reasons[index].value.trim(),
    }))
    .filter((item) => item.domain)
    .map((item, index) => ({
      registrable_domain: item.domain,
      position: index + 1,
      information_type: null,
      reason: item.reason || null,
    }));
  try {
    await api(
      `/api/v1/scopes/${state.scopeId}/nomination-reviews/${review.id}/confirm`,
      {
        method: "POST",
        body: { review_version: review.version, reviewed_items: reviewedItems },
      },
    );
    toast("信源自述域名已确认并计入提名排名");
    await loadNominationReviews(state.activeRunId);
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

async function rejectReview(review) {
  const reason = window.prompt(
    "请输入拒绝原因。拒绝后不会生成正式提名信源事件。",
    "回答未明确给出域名",
  );
  if (!reason) return;
  try {
    await api(
      `/api/v1/scopes/${state.scopeId}/nomination-reviews/${review.id}/reject`,
      {
        method: "POST",
        body: { review_version: review.version, rejection_reason: reason },
      },
    );
    toast("本次信源自述已拒绝");
    await loadNominationReviews(state.activeRunId);
  } catch (error) {
    toast(friendlyError(error), true);
  }
}

function renderComparisonSelectors() {
  const naturalId = $("#comparison-natural").value;
  const nominations = state.catalog.runs.filter(
    (run) =>
      run.experiment_kind === "source_nomination" &&
      run.paired_run_id === naturalId &&
      terminalStatuses.has(run.status),
  );
  replaceOptions(
    $("#comparison-nomination"),
    nominations.map((run) => [run.id, runLabel(run)]),
    naturalId ? "暂无已完成的配对运行" : "请先选择自然回答运行",
  );
}

function loadNaturalRanking() {
  const runId = $("#comparison-natural").value;
  if (!runId) {
    toast("请选择已完成的自然回答运行", true);
    return;
  }
  openReportTab({ mode: "ranking", runId });
}

function loadComparison() {
  const naturalId = $("#comparison-natural").value;
  const nominationId = $("#comparison-nomination").value;
  if (!naturalId || !nominationId) {
    toast("请选择一组已完成的自然回答和配对信源自述运行", true);
    return;
  }
  openReportTab({
    mode: "comparison",
    runId: naturalId,
    nominationRunId: nominationId,
  });
}

function parseInitialRoute() {
  const parameters = new URLSearchParams(window.location.search);
  const mode = parameters.get("mode");
  return Object.freeze({
    view: parameters.get("view"),
    mode: mode === "comparison" ? "comparison" : "ranking",
    scopeId: parameters.get("scope_id"),
    runId: parameters.get("run_id"),
    nominationRunId: parameters.get("nomination_run_id"),
  });
}

async function openInitialRoute() {
  if (initialRoute.view === "run-report") {
    await renderRunReport(initialRoute);
  }
}

function openReportTab({ mode, runId, nominationRunId = null }) {
  if (!state.scopeId || !runId) return;
  const url = new URL("/", window.location.origin);
  url.searchParams.set("view", "run-report");
  url.searchParams.set("mode", mode);
  url.searchParams.set("scope_id", state.scopeId);
  url.searchParams.set("run_id", runId);
  if (nominationRunId) {
    url.searchParams.set("nomination_run_id", nominationRunId);
  }
  const link = document.createElement("a");
  link.href = url.toString();
  link.target = "_blank";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

async function renderRunReport(route) {
  if (route.view !== "run-report") return;
  $("#app-view").classList.add("hidden");
  $("#report-view").classList.remove("hidden");
  $("#report-refresh").disabled = true;
  $("#report-body").replaceChildren(
    element("div", "report-loading", "正在汇总采样、问题与正式信源…"),
  );
  const backUrl = new URL("/", window.location.origin);
  if (state.scopeId) backUrl.searchParams.set("scope_id", state.scopeId);
  $("#report-back").href = backUrl.toString();
  try {
    if (!reportCore) throw new Error("REPORT_CORE_UNAVAILABLE");
    const naturalRun = state.catalog.runs.find(
      (run) =>
        run.id === route.runId && run.experiment_kind === "natural_answer",
    );
    if (!naturalRun) throw new Error("RESOURCE_NOT_FOUND");
    if (route.mode === "comparison") {
      await renderComparisonReportPage(naturalRun, route.nominationRunId);
    } else {
      await renderNaturalReportPage(naturalRun);
    }
  } catch (error) {
    $("#report-title").textContent = "运行详情暂时无法打开";
    $("#report-subtitle").textContent = friendlyError(error);
    $("#report-body").replaceChildren(
      element(
        "div",
        "report-error",
        "请确认当前账号仍可访问该项目，并从实验工作台重新打开详情。",
      ),
    );
  } finally {
    $("#report-refresh").disabled = false;
  }
}

async function renderNaturalReportPage(run) {
  const [taskResult, keywordReport] = await Promise.all([
    api(`/api/v1/scopes/${state.scopeId}/runs/${run.id}/tasks`),
    api(
      `/api/v1/scopes/${state.scopeId}/visible-search-keywords?run_id=${encodeURIComponent(run.id)}`,
    ),
  ]);
  const questions = uniqueQuestions(taskResult.tasks);
  const rankings = await Promise.all(
    questions.map((question) =>
      api(
        `/api/v1/scopes/${state.scopeId}/runs/${run.id}/source-ranking?query_snapshot_item_id=${encodeURIComponent(question.id)}`,
      ),
    ),
  );
  const model = reportCore.buildNaturalReport({
    questions,
    tasks: taskResult.tasks,
    rankings,
  });
  setReportHeading(run, "自然回答信源详情", "RUN SOURCE REPORT");
  document.title = `${snapshotName(run.query_set_snapshot_id)} · 信源详情 · 问天`;
  const body = $("#report-body");
  body.replaceChildren(
    reportBoundaryNotice(
      "本页统计已确认回答中的正式可见信源条目；同一域名每出现一条计一条，不代表 AI 平台内部抓取频率或隐藏权重。",
    ),
    reportMetricGrid([
      [
        "问题数量",
        String(model.questionCount),
        `${model.questionsWithSources}题出现正式信源`,
      ],
      [
        "采样确认",
        `${model.taskSummary.confirmed}/${model.taskSummary.total}`,
        `${model.taskSummary.needsReview}次待复核`,
      ],
      ["正式信源条目", String(model.totalEntries), "按已确认回答累计"],
      [
        "独立域名",
        String(model.uniqueDomainCount),
        `${formatPercent(model.sourceQuestionRate)}问题覆盖`,
      ],
    ]),
  );
  const charts = element("div", "report-chart-grid");
  charts.append(
    horizontalBarChart({
      title: "信源引用次数 Top 10",
      description: "合并当前运行全部问题后的正式条目数",
      items: model.domains.slice(0, 10).map((item) => ({
        label: item.displayOrigin,
        value: item.entryCount,
        detail: `${formatPercent(item.share)}占比 · 聚合 ${item.registrableDomain}`,
        href: item.displayOrigin,
      })),
      tone: "cited",
      emptyText: "当前运行尚无正式信源条目。",
    }),
    horizontalBarChart({
      title: "单问题信源密度",
      description: "每个问题累计的正式信源条目数",
      items: model.questions.map((question) => ({
        label: question.text,
        value: question.totalEntries,
        detail: `${question.uniqueDomainCount}个域名`,
      })),
      tone: "accent",
      emptyText: "当前运行没有问题数据。",
    }),
  );
  body.append(
    charts,
    renderReportKeywordInsights(run, keywordReport),
    renderNaturalQuestionSummary(model.questions),
  );
}

function renderReportKeywordInsights(run, report) {
  const section = element("section", "report-keyword-section");
  const heading = element("div", "report-section-heading");
  const headingCopy = element("div");
  headingCopy.append(
    element("h2", null, "页面可见检索词"),
    element(
      "p",
      null,
      "仅统计已确认且轨迹完整的采样；同一采样内相同词只计一次。",
    ),
  );
  const exportButton = buttonElement("导出本运行 Excel", "secondary", () => {
    const link = document.createElement("a");
    link.href = `/api/v1/scopes/${state.scopeId}/visible-search-keywords.xlsx?run_id=${encodeURIComponent(run.id)}`;
    link.download = "";
    document.body.append(link);
    link.click();
    link.remove();
  });
  heading.append(headingCopy, exportButton);
  section.append(heading);

  const summary = report.summary;
  section.append(
    reportMetricGrid([
      [
        "完整检索轨迹",
        `${summary.complete_trace_count}/${summary.confirmed_sample_count}`,
        "完整/已确认采样",
      ],
      [
        "检索词出现",
        String(summary.keyword_occurrence_count),
        "按采样内去重后累计",
      ],
      ["独立检索词", String(summary.unique_keyword_count), "不合并同义词"],
      [
        "未进入统计",
        String(
          summary.partial_trace_count +
            summary.not_present_trace_count +
            summary.not_collected_trace_count,
        ),
        "不完整、未显示或当时未采集",
      ],
    ]),
  );

  const grid = element("div", "report-chart-grid");
  grid.append(
    horizontalBarChart({
      title: "检索词出现次数 Top 10",
      description: "同一检索词跨采样出现时逐次累计",
      items: report.keywords.slice(0, 10).map((item) => ({
        label: item.keyword,
        value: item.sample_occurrence_count,
        detail: `${item.question_count}个问题 · ${item.run_count}次运行`,
      })),
      tone: "accent",
      emptyText: "当前运行没有完整的页面可见检索轨迹。",
    }),
    renderReportKeywordSampleSummary(report.samples),
  );
  section.append(grid);
  return section;
}

function renderReportKeywordSampleSummary(samples) {
  const section = element(
    "section",
    "report-chart-card keyword-sample-summary-card",
  );
  const heading = element("div", "report-section-heading");
  heading.append(
    element("h2", null, "单问题检索轨迹"),
    element("p", null, "展开查看原问题、页面可见检索词和参考资料数量。"),
  );
  section.append(heading);
  if (!samples.length) {
    section.append(emptyInline("当前运行没有已确认采样。"));
    return section;
  }
  const list = element("div", "report-keyword-sample-list");
  for (const sample of samples) {
    const item = document.createElement("details");
    item.className = "report-keyword-sample";
    const summary = document.createElement("summary");
    summary.append(
      element("span", null, sample.query_text),
      element(
        "small",
        null,
        `${visibleSearchTraceStatusText(sample.trace_status)} · ${sample.keywords.length}个词`,
      ),
    );
    const body = element("div", "report-keyword-sample-body");
    if (sample.keywords.length) {
      const chips = element("div", "keyword-chip-list");
      for (const keyword of sample.keywords) {
        chips.append(element("span", null, keyword.text));
      }
      body.append(chips);
    } else {
      body.append(
        element(
          "p",
          "tiny",
          sample.trace_status === "not_collected"
            ? "该历史采样当时未采集检索轨迹。"
            : "页面没有可统计的可见检索词。",
        ),
      );
    }
    body.append(
      element(
        "p",
        "tiny",
        `第${sample.sample_index}次采样 · ${sample.captured_reference_count}条已采集参考资料 · ${formatTime(sample.observed_at)}`,
      ),
    );
    item.append(summary, body);
    list.append(item);
  }
  section.append(list);
  return section;
}

async function renderComparisonReportPage(naturalRun, nominationRunId) {
  const nominationRun = state.catalog.runs.find(
    (run) =>
      run.id === nominationRunId && run.experiment_kind === "source_nomination",
  );
  if (!nominationRun) throw new Error("RESOURCE_NOT_FOUND");
  const [report, naturalTasks, nominationTasks] = await Promise.all([
    api(
      `/api/v1/scopes/${state.scopeId}/comparisons/nomination-citation?natural_answer_run_id=${encodeURIComponent(naturalRun.id)}&source_nomination_run_id=${encodeURIComponent(nominationRun.id)}&k=10`,
    ),
    api(`/api/v1/scopes/${state.scopeId}/runs/${naturalRun.id}/tasks`),
    api(`/api/v1/scopes/${state.scopeId}/runs/${nominationRun.id}/tasks`),
  ]);
  const questionNames = Object.fromEntries(
    uniqueQuestions(naturalTasks.tasks).map((item) => [item.id, item.text]),
  );
  const model = reportCore.buildComparisonReport({
    report,
    questionNames,
    naturalTasks: naturalTasks.tasks,
    nominationTasks: nominationTasks.tasks,
  });
  setReportHeading(
    naturalRun,
    "实际引用与信源自述对照",
    "SOURCE COMPARISON REPORT",
  );
  document.title = `${snapshotName(naturalRun.query_set_snapshot_id)} · 信源对照 · 问天`;
  const comparable = report.comparability.status === "comparable";
  const boundary = comparable
    ? `两次实验可比较，实际开始时间相差 ${formatDuration(report.comparability.start_gap_seconds)}。重合只表示两个可观察集合的交集。`
    : `两次实验不能直接比较：${report.comparability.reasons.map(comparabilityReason).join("；")}`;
  const body = $("#report-body");
  body.replaceChildren(
    reportBoundaryNotice(boundary, comparable ? "good" : "warn"),
    reportMetricGrid([
      [
        "自然回答采样",
        `${model.naturalTaskSummary.confirmed}/${model.naturalTaskSummary.total}`,
        "已确认/全部",
      ],
      [
        "信源自述采样",
        `${model.nominationTaskSummary.confirmed}/${model.nominationTaskSummary.total}`,
        "已确认/全部",
      ],
      [
        "可计算问题",
        `${model.availableQuestionCount}/${model.questionCount}`,
        "具备完整对照数据",
      ],
      [
        "平均Top 10重合",
        model.averageOverlap === null
          ? "不可用"
          : formatPercent(model.averageOverlap),
        "固定分母为10",
      ],
    ]),
  );
  const charts = element("div", "report-chart-grid");
  charts.append(
    horizontalBarChart({
      title: "实际引用域名 Top 10",
      description: "自然回答中的正式可见信源",
      items: model.citedDomains.slice(0, 10).map((item) => ({
        label: item.registrableDomain,
        value: item.entryCount,
        detail: `${formatPercent(item.share)}占比`,
      })),
      tone: "cited",
      emptyText: "自然回答中暂无正式信源。",
    }),
    horizontalBarChart({
      title: "AI 自述域名 Top 10",
      description: "经独立复核确认的信源推荐",
      items: model.nominatedDomains.slice(0, 10).map((item) => ({
        label: item.registrableDomain,
        value: item.entryCount,
        detail: `${formatPercent(item.share)}占比`,
      })),
      tone: "nominated",
      emptyText: "信源自述中暂无已确认域名。",
    }),
  );
  body.append(charts, renderComparisonQuestionSummary(model.questions));
}

function setReportHeading(run, heading, kicker) {
  $("#report-kicker").textContent = kicker;
  $("#report-title").textContent = heading;
  $("#report-subtitle").textContent =
    `${snapshotName(run.query_set_snapshot_id)} · ${statusText(run.status)} · 创建于 ${formatTime(run.created_at)}`;
  const conditions = run.session_conditions;
  const meta = $("#report-meta");
  meta.replaceChildren();
  for (const value of [
    `运行 ${shortId(run.id)}`,
    `每题 ${run.requested_sample_count} 次`,
    `搜索：${searchModeText(conditions.search_mode)}`,
    `地区：${regionText(conditions.region)}`,
    conditions.is_logged_in ? "登录状态" : "未登录状态",
    conditions.is_new_conversation ? "每次新对话" : "沿用对话",
  ]) {
    meta.append(element("span", null, value));
  }
}

function reportBoundaryNotice(message, tone = "neutral") {
  const notice = element("div", `report-notice ${tone}`);
  notice.append(
    element("span", "report-notice-icon", tone === "warn" ? "!" : "i"),
    element("p", null, message),
  );
  return notice;
}

function reportMetricGrid(metrics) {
  const grid = element("section", "report-metrics");
  for (const [label, value, detail] of metrics) {
    const card = element("article", "report-metric-card");
    card.append(
      element("span", null, label),
      element("strong", null, value),
      element("small", null, detail),
    );
    grid.append(card);
  }
  return grid;
}

function horizontalBarChart({ title, description, items, tone, emptyText }) {
  const section = element("section", `report-chart-card ${tone}`);
  const heading = element("div", "report-section-heading");
  heading.append(element("h2", null, title), element("p", null, description));
  section.append(heading);
  if (!items.length || items.every((item) => item.value === 0)) {
    section.append(emptyInline(emptyText));
    return section;
  }
  const maximum = Math.max(...items.map((item) => item.value), 1);
  const chart = element("div", "report-bar-chart");
  for (const item of items) {
    const row = element("div", "report-bar-row");
    const copy = element("div", "report-bar-copy");
    const label = item.href
      ? element("a", null, item.label)
      : element("span", null, item.label);
    label.title = item.label;
    if (item.href) {
      label.href = item.href;
      label.target = "_blank";
      label.rel = "noopener noreferrer";
    }
    copy.append(label, element("small", null, item.detail));
    const meter = document.createElement("progress");
    meter.className = "report-bar-meter";
    meter.max = maximum;
    meter.value = item.value;
    meter.setAttribute("aria-label", `${item.label}：${item.value}`);
    row.append(copy, meter, element("strong", null, String(item.value)));
    chart.append(row);
  }
  section.append(chart);
  return section;
}

function renderNaturalQuestionSummary(questions) {
  const section = element("section", "report-question-section");
  const heading = element("div", "report-section-heading");
  heading.append(
    element("h2", null, "单问题统计"),
    element("p", null, "先看横向汇总，需要时再展开域名排名。"),
  );
  section.append(heading);
  const table = reportTable([
    "问题",
    "确认采样",
    "信源条目",
    "独立域名",
    "每回答平均",
    "首位域名",
  ]);
  for (const question of questions) {
    appendReportRow(table, [
      question.text,
      `${question.taskSummary.confirmed}/${question.taskSummary.total}`,
      String(question.totalEntries),
      String(question.uniqueDomainCount),
      question.averageEntriesPerConfirmedSample === null
        ? "—"
        : question.averageEntriesPerConfirmedSample.toFixed(1),
      question.topDomain ?? "—",
    ]);
  }
  section.append(reportTableWrap(table));
  const details = element("div", "report-question-details");
  for (const question of questions) {
    const item = document.createElement("details");
    item.className = "report-question-detail";
    const summary = document.createElement("summary");
    summary.append(
      element("span", null, question.text),
      element(
        "small",
        null,
        `${question.totalEntries}条信源 · ${question.uniqueDomainCount}个域名`,
      ),
    );
    item.append(
      summary,
      rankingTable(
        question.ranking.map((entry) => ({
          rank: entry.rank,
          registrable_domain: entry.registrable_domain,
          display_origin: entry.display_origin,
          entry_count: entry.formal_source_entry_count,
        })),
      ),
    );
    details.append(item);
  }
  section.append(details);
  return section;
}

function renderComparisonQuestionSummary(questions) {
  const section = element("section", "report-question-section");
  const heading = element("div", "report-section-heading");
  heading.append(
    element("h2", null, "单问题对照"),
    element("p", null, "分别展示实际引用、自述推荐和固定Top 10重合。"),
  );
  section.append(heading);
  const table = reportTable([
    "问题",
    "可用性",
    "引用条目",
    "自述条目",
    "Top 10重合",
  ]);
  for (const question of questions) {
    appendReportRow(table, [
      question.text,
      question.availability === "available" ? "可计算" : "不可用",
      String(question.citation_ranking.total_entry_count),
      String(question.nomination_ranking.total_entry_count),
      question.availability === "available"
        ? formatPercent(question.overlap.value)
        : "—",
    ]);
  }
  section.append(reportTableWrap(table));
  const details = element("div", "report-question-details");
  for (const question of questions) {
    const item = document.createElement("details");
    item.className = "report-question-detail";
    const summary = document.createElement("summary");
    const detail =
      question.availability === "available"
        ? `重合 ${question.overlap.numerator}/10 · 共同域名 ${question.overlap.overlap_domains.length}个`
        : question.unavailable_reasons.map(unavailableReason).join("；");
    summary.append(
      element("span", null, question.text),
      element("small", null, detail),
    );
    const grid = element("div", "compare-grid report-compare-grid");
    const cited = element("div");
    cited.append(
      element("h3", null, "回答实际引用排名"),
      rankingTable(question.citation_ranking.domains),
    );
    const nominated = element("div");
    nominated.append(
      element("h3", null, "AI 自述推荐排名"),
      rankingTable(question.nomination_ranking.domains),
    );
    grid.append(cited, nominated);
    item.append(summary, grid);
    details.append(item);
  }
  section.append(details);
  return section;
}

function reportTable(headings) {
  const table = element("table", "report-table");
  const head = element("thead");
  const row = element("tr");
  for (const heading of headings) row.append(element("th", null, heading));
  head.append(row);
  table.append(head, element("tbody"));
  return table;
}

function appendReportRow(table, values) {
  const row = element("tr");
  for (const value of values) row.append(element("td", null, value));
  table.tBodies[0].append(row);
}

function reportTableWrap(table) {
  const wrapper = element("div", "report-table-wrap");
  wrapper.append(table);
  return wrapper;
}

function formatPercent(value) {
  return `${(Number(value) * 100).toFixed(0)}%`;
}

function searchModeText(value) {
  return (
    {
      unknown: "无法确认",
      disabled: "关闭",
      enabled: "开启",
    }[value] ?? value
  );
}

function regionText(value) {
  return (
    {
      CN_MAINLAND: "中国大陆",
    }[value] ??
    value ??
    "未记录"
  );
}

async function showKeywordInsights() {
  state.workspaceView = "keywords";
  updateWorkspaceNavigation("keywords");
  $(".hero-row").classList.add("hidden");
  $(".step-nav").classList.add("hidden");
  for (const id of [
    "questions-panel",
    "runs-panel",
    "tasks-panel",
    "comparison-panel",
  ]) {
    $(`#${id}`).classList.add("hidden");
  }
  $("#keyword-insights-panel").classList.remove("hidden");
  $(".topbar-context strong").textContent = "检索词洞察";
  if (state.scopeId) await loadKeywordInsights();
}

function updateWorkspaceNavigation(view) {
  for (const [id, active] of [
    ["show-experiment-workspace", view === "experiment"],
    ["show-keyword-insights", view === "keywords"],
  ]) {
    const button = $(`#${id}`);
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

async function loadKeywordInsights() {
  if (!state.scopeId) return;
  const status = $("#keyword-insights-status");
  const refreshButton = $("#refresh-keyword-insights");
  const exportButton = $("#export-keyword-insights");
  refreshButton.disabled = true;
  exportButton.disabled = true;
  status.classList.remove("error");
  status.textContent = "正在汇总已确认采样中的页面可见检索轨迹…";
  try {
    const report = await api(keywordInsightsPath());
    state.keywordInsights = report;
    renderKeywordInsights(report);
  } catch (error) {
    status.classList.add("error");
    status.textContent = friendlyError(error);
    $("#keyword-ranking-table").replaceChildren(
      emptyInline("检索词数据暂时无法读取。"),
    );
    $("#keyword-sample-list").replaceChildren(
      emptyInline("采样证据暂时无法读取。"),
    );
  } finally {
    refreshButton.disabled = false;
    exportButton.disabled = false;
  }
}

function keywordInsightsPath(extension = "") {
  const url = new URL(
    `/api/v1/scopes/${state.scopeId}/visible-search-keywords${extension}`,
    window.location.origin,
  );
  const runId = $("#keyword-run-filter").value;
  const filters = [
    ["run_id", runId && runId !== "__all__" ? runId : ""],
    ["surface_code", $("#keyword-surface-filter").value],
    ["industry", $("#keyword-industry-filter").value.trim()],
    ["region", $("#keyword-region-filter").value.trim()],
    ["query", $("#keyword-query-filter").value.trim()],
  ];
  for (const [name, value] of filters) {
    if (value) url.searchParams.set(name, value);
  }
  return `${url.pathname}${url.search}`;
}

function clearKeywordInsightFilters() {
  setSearchableSelectValue($("#keyword-run-filter"), "__all__");
  $("#keyword-surface-filter").value = "";
  $("#keyword-industry-filter").value = "";
  $("#keyword-region-filter").value = "";
  $("#keyword-query-filter").value = "";
  void loadKeywordInsights();
}

function exportKeywordInsights() {
  if (!state.scopeId) return;
  const link = document.createElement("a");
  link.href = keywordInsightsPath(".xlsx");
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}

function renderKeywordInsights(report) {
  const summary = report.summary;
  $("#keyword-sample-count").textContent = String(
    summary.confirmed_sample_count,
  );
  $("#keyword-complete-count").textContent =
    `${summary.complete_trace_count}次轨迹完整`;
  $("#keyword-occurrence-count").textContent = String(
    summary.keyword_occurrence_count,
  );
  $("#keyword-unique-count").textContent = String(summary.unique_keyword_count);
  const excludedCount =
    summary.partial_trace_count +
    summary.not_present_trace_count +
    summary.not_collected_trace_count;
  $("#keyword-excluded-count").textContent = String(excludedCount);
  $("#keyword-insights-status").textContent =
    `${summary.complete_trace_count}次完整 · ${summary.partial_trace_count}次不完整 · ${summary.not_present_trace_count}次页面未显示 · ${summary.not_collected_trace_count}次历史未采集`;
  $("#keyword-ranking-note").textContent = report.keywords.length
    ? `共 ${report.keywords.length} 个独立检索词`
    : "当前筛选下暂无可统计检索词";
  $("#keyword-sample-note").textContent = report.samples.length
    ? `共 ${report.samples.length} 次已确认采样`
    : "当前筛选下暂无采样";
  renderKeywordRankingTable(report.keywords);
  renderKeywordSampleList(report.samples);
}

function renderKeywordRankingTable(keywords) {
  const host = $("#keyword-ranking-table");
  host.replaceChildren();
  if (!keywords.length) {
    host.append(
      emptyInline(
        "暂无完整的页面可见检索轨迹。历史采样不会从回答或引用中反推检索词。",
      ),
    );
    return;
  }
  const table = element("table", "insights-table keyword-table");
  const head = element("thead");
  const headRow = element("tr");
  for (const label of [
    "页面可见检索词",
    "出现次数",
    "问题数",
    "运行数",
    "平台",
    "最近观察",
  ]) {
    headRow.append(element("th", null, label));
  }
  head.append(headRow);
  const body = element("tbody");
  const maximum = Math.max(
    ...keywords.map((keyword) => keyword.sample_occurrence_count),
    1,
  );
  for (const keyword of keywords.slice(0, 200)) {
    const row = element("tr");
    const keywordCell = element("td", "keyword-value-cell");
    const label = element("strong", null, keyword.keyword);
    label.title = keyword.keyword;
    const meter = document.createElement("progress");
    meter.max = maximum;
    meter.value = keyword.sample_occurrence_count;
    meter.setAttribute(
      "aria-label",
      `${keyword.keyword}出现${keyword.sample_occurrence_count}次`,
    );
    keywordCell.append(label, meter);
    row.append(
      keywordCell,
      element("td", "numeric", String(keyword.sample_occurrence_count)),
      element("td", "numeric", String(keyword.question_count)),
      element("td", "numeric", String(keyword.run_count)),
      element(
        "td",
        null,
        keyword.platforms.map((value) => surfaceName(value)).join("、"),
      ),
      element("td", null, formatTime(keyword.last_seen_at)),
    );
    body.append(row);
  }
  table.append(head, body);
  host.append(table);
  if (keywords.length > 200) {
    host.append(
      element(
        "p",
        "tiny insights-limit-note",
        `页面展示前 200 项；Excel 包含当前筛选下全部 ${keywords.length} 项。`,
      ),
    );
  }
}

function renderKeywordSampleList(samples) {
  const host = $("#keyword-sample-list");
  host.replaceChildren();
  if (!samples.length) {
    host.append(emptyInline("当前筛选下没有已确认采样。"));
    return;
  }
  for (const sample of samples.slice(0, 80)) {
    const item = document.createElement("details");
    item.className = "keyword-sample-item";
    const summary = element("summary", "keyword-sample-summary");
    const copy = element("div");
    copy.append(
      element("strong", null, sample.query_text),
      element(
        "small",
        null,
        `${sample.product_label} · 第${sample.sample_index}次采样 · ${formatTime(sample.observed_at)}`,
      ),
    );
    summary.append(
      copy,
      element(
        "span",
        `trace-status ${sample.trace_status}`,
        visibleSearchTraceStatusText(sample.trace_status),
      ),
    );
    const body = element("div", "keyword-sample-body");
    if (sample.summary_text) {
      body.append(element("p", "trace-summary", sample.summary_text));
    }
    if (sample.keywords.length) {
      const chips = element("div", "keyword-chip-list");
      for (const keyword of sample.keywords) {
        chips.append(element("span", null, keyword.text));
      }
      body.append(chips);
    } else {
      body.append(
        element(
          "p",
          "tiny",
          sample.trace_status === "not_collected"
            ? "该历史采样发生时尚未采集页面可见检索词。"
            : "本次采样没有可用于统计的页面可见检索词。",
        ),
      );
    }
    const evidenceMeta = element("div", "keyword-evidence-meta");
    evidenceMeta.append(
      element("span", null, `运行 ${shortId(sample.run_id)}`),
      element("span", null, sample.industry ?? "行业未设置"),
      element("span", null, sample.region ?? "地区未设置"),
      element(
        "span",
        null,
        `参考资料 ${sample.captured_reference_count}/${sample.declared_reference_count ?? "未声明"}`,
      ),
    );
    body.append(evidenceMeta);
    if (sample.references.length) {
      const references = element("ol", "keyword-reference-list");
      for (const reference of sample.references) {
        const row = element("li");
        const link = element("a", null, reference.title || reference.url);
        link.href = reference.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const url = element("small", null, reference.url);
        row.append(link, url);
        references.append(row);
      }
      body.append(references);
    }
    item.append(summary, body);
    host.append(item);
  }
  if (samples.length > 80) {
    host.append(
      element(
        "p",
        "tiny insights-limit-note",
        `页面展示最近 80 次采样；Excel 包含当前筛选下全部符合默认导出规则的明细。`,
      ),
    );
  }
}

function visibleSearchTraceStatusText(status) {
  return (
    {
      complete: "轨迹完整",
      partial: "读取不完整",
      not_present: "页面未显示",
      not_collected: "当时未采集",
    }[status] ?? status
  );
}

function showPanel(panelId) {
  state.workspaceView = "experiment";
  state.activePanelId = panelId;
  updateWorkspaceNavigation("experiment");
  $(".hero-row").classList.remove("hidden");
  $(".step-nav").classList.remove("hidden");
  $("#keyword-insights-panel").classList.add("hidden");
  $(".topbar-context strong").textContent = "实验工作台";
  document.querySelectorAll(".step").forEach((button) => {
    const active = button.dataset.panel === panelId;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  for (const id of [
    "questions-panel",
    "runs-panel",
    "tasks-panel",
    "comparison-panel",
  ]) {
    $(`#${id}`).classList.toggle("hidden", id !== panelId);
  }
  if (panelId === "tasks-panel") {
    ensureSelectedRunTasks();
    void autoRefreshTasks(true);
  }
}

function ensureSelectedRunTasks() {
  const runId = $("#task-run-select").value;
  if (!runId || (state.activeRunId === runId && state.tasks.length > 0)) {
    return;
  }
  $("#claim-next-task").disabled = true;
  $("#claim-next-task").textContent = "正在加载";
  $("#create-batch-handoff").disabled = true;
  $("#create-batch-handoff").textContent = "正在加载";
  $("#claim-next-note").textContent = "正在读取当前运行的采样";
  $("#task-list").replaceChildren(emptyInline("正在加载当前运行的采样…"));
  void loadTasks(runId);
}

async function api(path, options = {}) {
  return requestJsonWithCsrfRecovery({
    path,
    options,
    csrfToken: state.csrf,
    fetchImpl: fetch,
    refreshCsrfToken,
  });
}

async function refreshCsrfToken() {
  const response = await fetch("/api/v1/auth/session", {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });
  const body = await response
    .json()
    .catch(() => ({ error: "INVALID_SERVER_RESPONSE" }));
  if (!response.ok) {
    const error = new Error(body.error ?? `HTTP_${response.status}`);
    error.code = body.error;
    throw error;
  }
  state.csrf = body.csrf_token;
  state.user = body.user;
  return body.csrf_token;
}

function initializeSearchableSelects(root = document) {
  bindSearchableSelectGlobalEvents();
  root
    .querySelectorAll("select[data-searchable]")
    .forEach((select) => enhanceSearchableSelect(select));
}

function bindSearchableSelectGlobalEvents() {
  if (searchableSelectGlobalEventsBound) return;
  searchableSelectGlobalEventsBound = true;
  document.addEventListener("pointerdown", (event) => {
    const controller = openSearchableSelectController;
    if (
      controller &&
      event.target instanceof Node &&
      !controller.wrapper.contains(event.target)
    ) {
      closeSearchableSelect(controller);
    }
  });
  document.addEventListener(
    "scroll",
    (event) => {
      const controller = openSearchableSelectController;
      if (
        controller &&
        event.target instanceof Node &&
        !controller.panel.contains(event.target)
      ) {
        closeSearchableSelect(controller);
      }
    },
    true,
  );
  window.addEventListener("resize", () => {
    if (openSearchableSelectController) {
      closeSearchableSelect(openSearchableSelectController);
    }
  });
}

function enhanceSearchableSelect(select) {
  if (searchableSelectControllers.has(select)) return;
  searchableSelectSequence += 1;
  const wrapper = element("div", "searchable-select");
  const trigger = element("button", "searchable-select-trigger");
  const current = element("span", "searchable-select-current");
  const currentPrimary = element("strong");
  const currentMeta = element("small");
  const chevron = element("span", "searchable-select-chevron", "⌄");
  const panel = element("div", "searchable-select-popover hidden");
  const searchRow = element("div", "searchable-select-search-row");
  const input = document.createElement("input");
  const count = element("span", "searchable-select-count");
  const list = element("div", "searchable-select-results");
  const panelId = `searchable-select-panel-${searchableSelectSequence}`;
  const listId = `searchable-select-list-${searchableSelectSequence}`;
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", panelId);
  current.append(currentPrimary, currentMeta);
  trigger.append(current, chevron);
  panel.id = panelId;
  input.type = "search";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", listId);
  input.setAttribute(
    "aria-label",
    select.getAttribute("aria-label") ?? "搜索可选项",
  );
  input.placeholder = select.dataset.searchPlaceholder ?? "输入关键词搜索";
  list.id = listId;
  list.setAttribute("role", "listbox");
  searchRow.append(input, count);
  panel.append(searchRow, list);
  select.before(wrapper);
  wrapper.append(trigger, panel);
  select.classList.add("searchable-select-source");

  const controller = {
    select,
    wrapper,
    trigger,
    currentPrimary,
    currentMeta,
    panel,
    input,
    count,
    list,
    options: [],
    visibleOptions: [],
    resultButtons: [],
    activeIndex: -1,
    predicate: null,
    refresh(predicate = controller.predicate) {
      controller.predicate = predicate;
      const primaryParts = Number(select.dataset.searchPrimaryParts ?? "1");
      controller.options = [...select.options]
        .filter((option) => option.value && (!predicate || predicate(option)))
        .map((option) => {
          const label = (option.textContent ?? "").trim();
          return {
            value: option.value,
            label,
            ...describeSearchableLabel(label, primaryParts),
          };
        });
      trigger.disabled = select.disabled || controller.options.length === 0;
      syncSearchableSelect(select);
      if (openSearchableSelectController === controller) {
        renderSearchableSelectResults(controller);
        positionSearchableSelect(controller);
      }
    },
  };
  searchableSelectControllers.set(select, controller);

  trigger.addEventListener("click", () => {
    if (openSearchableSelectController === controller) {
      closeSearchableSelect(controller);
    } else {
      openSearchableSelect(controller);
    }
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openSearchableSelect(controller);
      moveSearchableSelectActive(controller, 1);
    }
  });
  input.addEventListener("input", () =>
    renderSearchableSelectResults(controller),
  );
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSearchableSelectActive(
        controller,
        event.key === "ArrowDown" ? 1 : -1,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = controller.visibleOptions[controller.activeIndex];
      if (option) commitSearchableSelect(controller, option);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchableSelect(controller, true);
    }
  });
  select.addEventListener("change", () => syncSearchableSelect(select));
  controller.refresh();
}

function openSearchableSelect(controller) {
  if (controller.trigger.disabled) return;
  if (
    openSearchableSelectController &&
    openSearchableSelectController !== controller
  ) {
    closeSearchableSelect(openSearchableSelectController);
  }
  openSearchableSelectController = controller;
  controller.panel.classList.remove("hidden");
  controller.trigger.setAttribute("aria-expanded", "true");
  controller.input.setAttribute("aria-expanded", "true");
  controller.input.value = "";
  renderSearchableSelectResults(controller);
  positionSearchableSelect(controller);
  requestAnimationFrame(() => controller.input.focus());
}

function closeSearchableSelect(controller, restoreFocus = false) {
  controller.panel.classList.add("hidden");
  controller.trigger.setAttribute("aria-expanded", "false");
  controller.input.setAttribute("aria-expanded", "false");
  controller.input.removeAttribute("aria-activedescendant");
  controller.activeIndex = -1;
  if (openSearchableSelectController === controller) {
    openSearchableSelectController = null;
  }
  if (restoreFocus) controller.trigger.focus();
}

function positionSearchableSelect(controller) {
  const rect = controller.trigger.getBoundingClientRect();
  const viewportGap = 12;
  const width = Math.min(
    Math.max(rect.width, 360),
    window.innerWidth - viewportGap * 2,
  );
  const left = Math.min(
    Math.max(viewportGap, rect.left),
    window.innerWidth - width - viewportGap,
  );
  const spaceBelow = window.innerHeight - rect.bottom - viewportGap;
  const spaceAbove = rect.top - viewportGap;
  const openBelow = spaceBelow >= 260 || spaceBelow >= spaceAbove;
  controller.panel.style.width = `${width}px`;
  controller.panel.style.left = `${left}px`;
  controller.panel.style.maxHeight = `${Math.max(
    200,
    Math.min(430, openBelow ? spaceBelow : spaceAbove),
  )}px`;
  if (openBelow) {
    controller.panel.style.top = `${rect.bottom + 6}px`;
    controller.panel.style.bottom = "auto";
  } else {
    controller.panel.style.top = "auto";
    controller.panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  }
}

function renderSearchableSelectResults(controller) {
  const result = filterSearchableOptions(
    controller.options,
    controller.input.value,
  );
  controller.visibleOptions = result.items;
  controller.activeIndex = -1;
  controller.input.removeAttribute("aria-activedescendant");
  controller.count.textContent = result.truncated
    ? `显示前 ${result.items.length} 条，共 ${result.matchedCount} 条`
    : `${result.matchedCount} 条结果`;
  controller.list.replaceChildren();
  controller.resultButtons = [];
  if (!result.items.length) {
    controller.list.append(
      element("div", "searchable-select-empty", "没有匹配结果，请更换关键词。"),
    );
    return;
  }
  result.items.forEach((option, index) => {
    const button = element("button", "searchable-select-option");
    button.type = "button";
    button.id = `${controller.list.id}-option-${index}`;
    button.setAttribute("role", "option");
    button.setAttribute(
      "aria-selected",
      String(controller.select.value === option.value),
    );
    button.title = option.label;
    button.append(element("strong", null, option.primary));
    if (option.meta) button.append(element("small", null, option.meta));
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () =>
      commitSearchableSelect(controller, option),
    );
    controller.resultButtons.push(button);
    controller.list.append(button);
  });
}

function moveSearchableSelectActive(controller, direction) {
  if (!controller.visibleOptions.length) return;
  const last = controller.visibleOptions.length - 1;
  const next =
    controller.activeIndex < 0
      ? direction > 0
        ? 0
        : last
      : Math.min(last, Math.max(0, controller.activeIndex + direction));
  controller.resultButtons[controller.activeIndex]?.classList.remove(
    "is-active",
  );
  controller.activeIndex = next;
  const button = controller.resultButtons[next];
  button.classList.add("is-active");
  controller.input.setAttribute("aria-activedescendant", button.id);
  button.scrollIntoView({ block: "nearest" });
}

function commitSearchableSelect(controller, option) {
  if (controller.select.value !== option.value) {
    controller.select.value = option.value;
    controller.select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  closeSearchableSelect(controller, true);
}

function refreshSearchableSelect(select, predicate = null) {
  if (!select) return;
  if (
    !searchableSelectControllers.has(select) &&
    (!select.hasAttribute("data-searchable") || !select.parentNode)
  ) {
    return;
  }
  enhanceSearchableSelect(select);
  searchableSelectControllers.get(select)?.refresh(predicate);
}

function syncSearchableSelect(select) {
  const controller = searchableSelectControllers.get(select);
  if (!controller) return;
  const option = [...select.options].find(
    (item) => item.value === select.value && item.value,
  );
  const label = (option?.textContent ?? "").trim();
  const description = describeSearchableLabel(
    label,
    Number(select.dataset.searchPrimaryParts ?? "1"),
  );
  controller.currentPrimary.textContent =
    description.primary || select.options[0]?.textContent || "暂无可选项";
  controller.currentMeta.textContent = description.meta;
  controller.currentMeta.classList.toggle("hidden", !description.meta);
  controller.trigger.title = label;
  controller.trigger.disabled =
    select.disabled || ![...select.options].some((item) => item.value);
}

function setSearchableSelectValue(select, value) {
  select.value = value;
  syncSearchableSelect(select);
}

function replaceOptions(select, entries, emptyLabel) {
  const previous = select.value;
  select.replaceChildren();
  if (!entries.length) {
    const option = element("option", null, emptyLabel);
    option.value = "";
    select.append(option);
    refreshSearchableSelect(select);
    return;
  }
  for (const [value, label] of entries) {
    const option = element("option", null, label);
    option.value = value;
    select.append(option);
  }
  if (entries.some(([value]) => value === previous)) select.value = previous;
  refreshSearchableSelect(select);
}

function scopeLabel(scope) {
  return `${scope.display_name} · ${businessLabel(scope)} · ${shortId(scope.id)}`;
}

function businessLabel(record) {
  return `${record.region ?? "地区未设置"} · ${record.industry ?? "行业未设置"}`;
}

function matchesFilter(value, filter) {
  if (!filter) return true;
  return (value ?? "未设置")
    .toLocaleLowerCase("zh-CN")
    .includes(filter.toLocaleLowerCase("zh-CN"));
}

function updateBusinessSuggestions() {
  appendDatalistValues($("#industry-suggestions"), [
    ...state.scopes.map((item) => item.industry),
    ...state.catalog.snapshots.map((item) => item.industry),
  ]);
  appendDatalistValues($("#region-suggestions"), [
    ...state.scopes.map((item) => item.region),
    ...state.catalog.snapshots.map((item) => item.region),
  ]);
}

function appendDatalistValues(datalist, values) {
  const existing = new Set(
    [...datalist.options].map((option) => option.value.trim()),
  );
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || existing.has(normalized)) continue;
    const option = document.createElement("option");
    option.value = normalized;
    datalist.append(option);
    existing.add(normalized);
  }
}

function createListItem(title, detail) {
  const item = element("article", "list-item");
  const copy = element("div");
  copy.append(element("h3", null, title), element("p", null, detail));
  item.append(copy, element("div", "list-actions"));
  return item;
}

function rankingTable(items) {
  if (!items.length) return emptyInline("暂无正式信源条目。 ");
  const table = element("table", "ranking-table");
  const head = element("thead");
  const headRow = element("tr");
  for (const label of ["排名", "来源", "条目数"])
    headRow.append(element("th", null, label));
  head.append(headRow);
  const body = element("tbody");
  for (const item of items) {
    const row = element("tr");
    const sourceCell = element("td");
    if (item.display_origin) {
      const sourceLink = element("a", null, item.display_origin);
      sourceLink.href = item.display_origin;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceCell.append(sourceLink);
    } else {
      sourceCell.textContent = item.registrable_domain;
    }
    row.append(
      element("td", null, String(item.rank)),
      sourceCell,
      element("td", null, String(item.entry_count)),
    );
    body.append(row);
  }
  table.append(head, body);
  return table;
}

function uniqueQuestions(tasks) {
  const map = new Map();
  for (const task of tasks) {
    if (!map.has(task.query_snapshot_item_id))
      map.set(task.query_snapshot_item_id, task.query_text);
  }
  return [...map].map(([id, text]) => ({ id, text }));
}

function currentRun() {
  return state.catalog.runs.find((run) => run.id === state.activeRunId);
}

function snapshotName(id) {
  return (
    state.catalog.snapshots.find((snapshot) => snapshot.id === id)?.title ??
    shortId(id)
  );
}

function runLabel(run) {
  const type =
    run.experiment_kind === "natural_answer" ? "自然回答" : "信源自述";
  return `${type} · ${surfaceName(run.surface_code)} · ${snapshotName(run.query_set_snapshot_id)} · ${businessLabel(run)} · ${run.planned_sample_count}次采样 · ${statusText(run.status)} · ${formatTime(run.created_at)} · ${shortId(run.id)}`;
}

function surfaceName(surfaceCode) {
  if (surfaceCode === "qianwen_web") return "千问 Web";
  if (surfaceCode === "deepseek_web") return "DeepSeek Web";
  return "豆包 Web";
}

function statusElement(status) {
  const good = ["confirmed", "succeeded"].includes(status);
  const warn = [
    "waiting_user",
    "capturing",
    "needs_review",
    "queued",
    "running",
    "partial",
  ].includes(status);
  return element(
    "span",
    `status ${good ? "good" : warn ? "warn" : "bad"}`,
    statusText(status),
  );
}

function statusText(status) {
  return (
    {
      waiting_user: "等待领取",
      capturing: "采集中",
      needs_review: "待复核",
      confirmed: "已确认",
      rejected: "已拒绝",
      expired: "已过期",
      cancelled: "已取消",
      queued: "待开始",
      running: "进行中",
      succeeded: "已完成",
      partial: "部分完成",
      failed: "失败",
    }[status] ?? status
  );
}

function comparabilityReason(reason) {
  return (
    {
      RUN_EXPERIMENT_KIND_MISMATCH: "实验类型不匹配",
      RUN_PAIR_LINK_MISMATCH: "不是成对创建的运行",
      RUN_SCOPE_MISMATCH: "项目不一致",
      RUN_CONFIGURATION_MISMATCH: "问题集、采样数或会话条件不一致",
      RUN_EFFECTIVE_NOMINATION_CONTEXT_MISMATCH: "搜索上下文不一致",
      RUN_NOT_TERMINAL: "至少一次运行尚未结束",
      RUN_TIMESTAMPS_INCOMPLETE: "缺少实际开始或结束时间",
      RUN_START_GAP_EXCEEDED: "实际开始时间相差超过24小时",
    }[reason] ?? reason
  );
}

function unavailableReason(reason) {
  return (
    {
      NO_CONFIRMED_CITATION_SAMPLES: "没有已确认的自然回答引用样本",
      NO_VALIDATED_NOMINATION_SAMPLES: "没有已确认的信源自述域名样本",
    }[reason] ?? reason
  );
}

function friendlyError(error) {
  const code = error?.code ?? error?.message;
  return (
    {
      LOCAL_LOGIN_FAILED: "邮箱或密码不正确。",
      LOCAL_SESSION_INVALID: "登录已失效，请重新登录。",
      LOCAL_REAUTH_INVALID: "当前账号密码不正确。",
      INVALID_PROJECT_KEY:
        "项目标识仅支持中文、小写英文、数字和连字符，且不能以连字符开头或结尾。",
      SCOPE_DELETE_CONFIRMATION_MISMATCH: "输入的项目标识不一致。",
      SCOPE_VERSION_CONFLICT: "项目状态已经变化，请刷新后重试。",
      SCOPE_DELETION_IN_PROGRESS: "项目删除已经开始，请刷新状态。",
      RESOURCE_CONFLICT: "相同标识或记录已经存在。",
      OBSERVATION_TASK_NOT_CLAIMABLE: "当前采样状态不能领取，请刷新后重试。",
      OBSERVATION_TASK_VERSION_CONFLICT: "采样状态已经变化，请刷新后重试。",
      AUTOMATION_SWITCH_DISABLED: "请先打开当前项目的自动化开关。",
      AUTOMATION_BATCH_NO_TASKS: "当前运行没有可连续采集的内容。",
      AUTOMATION_BATCH_TASK_BUSY: "有采样正由其他账号采集，请稍后重试。",
      CONSUMER_OBSERVATION_RUN_NOT_DELETABLE:
        "该运行已经开始或包含采集结果，不能删除。",
      SCOPE_NOT_ACTIVE: "当前项目不是可写状态，请刷新后重试。",
      NOMINATION_REVIEW_VERSION_CONFLICT: "复核记录已经变化，请刷新后重试。",
      SOURCE_RANKING_NATURAL_ANSWER_REQUIRED: "引用排名只适用于自然回答运行。",
      INVALID_REQUEST: "提交内容不完整或格式不正确。",
      INTERNAL_ERROR: "系统内部处理失败，请刷新后重试。",
    }[code] ?? `操作失败：${code ?? "未知错误"}`
  );
}

async function copyTextarea(selector, successMessage) {
  const textarea = $(selector);
  try {
    await navigator.clipboard.writeText(textarea.value);
    toast(successMessage);
  } catch {
    textarea.focus();
    textarea.select();
    toast("已选中文本，请按 Command+C 复制");
  }
}

function buttonElement(label, style, handler) {
  const button = element("button", style, label);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}

function emptyInline(text) {
  return element("div", "empty-inline", text);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortId(value) {
  return value ? value.slice(0, 8) : "—";
}

function formatTime(value) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value))
    : "—";
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "未知";
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`;
  return `${(seconds / 3600).toFixed(1)}小时`;
}

function toast(message, error = false) {
  const host = $("#toast");
  clearTimeout(toastTimer);
  host.textContent = message;
  host.classList.toggle("error", error);
  host.classList.add("show");
  toastTimer = setTimeout(() => host.classList.remove("show"), 3200);
}
