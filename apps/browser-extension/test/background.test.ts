import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

type ActionListener = (tab: { id?: number; url?: string }) => Promise<void>;
type MessageListener = (
  message: unknown,
  sender: {
    tab?: {
      active?: boolean;
      id?: number;
      url?: string;
      windowId?: number;
    };
  },
  sendResponse: (response: unknown) => void,
) => boolean;

type CreatedTabListener = (tab: {
  id?: number;
  openerTabId?: number;
  url?: string;
  windowId?: number;
}) => void;
type UpdatedTabListener = (
  tabId: number,
  changeInfo: { url?: string },
  tab: { id?: number; openerTabId?: number; url?: string; windowId?: number },
) => void;

function createBackgroundHarness() {
  let actionListener: ActionListener | undefined;
  let messageListener: MessageListener | undefined;
  let createdTabListener: CreatedTabListener | undefined;
  let updatedTabListener: UpdatedTabListener | undefined;
  const injected: unknown[] = [];
  const sentMessages: unknown[] = [];
  const screenshots: unknown[] = [];
  const removedTabs: number[] = [];
  const updatedTabs: unknown[] = [];
  const requests: unknown[] = [];
  let fetchResult: { readonly ok: boolean; readonly body: unknown } = {
    ok: true,
    body: { task_id: "11111111-1111-4111-8111-111111111111" },
  };
  let fetchResults: { readonly ok: boolean; readonly body: unknown }[] = [];
  const chrome = {
    action: {
      onClicked: {
        addListener(listener: ActionListener) {
          actionListener = listener;
        },
      },
      async setBadgeBackgroundColor() {},
      async setBadgeText() {},
    },
    runtime: {
      onMessage: {
        addListener(listener: MessageListener) {
          messageListener = listener;
        },
      },
    },
    scripting: {
      async executeScript(input: unknown) {
        injected.push(input);
      },
    },
    tabs: {
      onCreated: {
        addListener(listener: CreatedTabListener) {
          createdTabListener = listener;
        },
        removeListener(listener: CreatedTabListener) {
          if (createdTabListener === listener) createdTabListener = undefined;
        },
      },
      onUpdated: {
        addListener(listener: UpdatedTabListener) {
          updatedTabListener = listener;
        },
        removeListener(listener: UpdatedTabListener) {
          if (updatedTabListener === listener) updatedTabListener = undefined;
        },
      },
      async sendMessage(tabId: number, message: unknown) {
        sentMessages.push({ tabId, message });
      },
      async captureVisibleTab(windowId: number, options: unknown) {
        screenshots.push({ windowId, options });
        return "data:image/png;base64,AA==";
      },
      async remove(tabId: number) {
        removedTabs.push(tabId);
      },
      async update(tabId: number, input: unknown) {
        updatedTabs.push({ tabId, input });
      },
    },
  };
  return {
    chrome,
    injected,
    sentMessages,
    screenshots,
    removedTabs,
    updatedTabs,
    requests,
    async fetch(url: string, init: RequestInit) {
      requests.push({ url, init });
      const current = fetchResults.shift() ?? fetchResult;
      return {
        ok: current.ok,
        async json() {
          return current.body;
        },
      };
    },
    setFetchResult(value: { readonly ok: boolean; readonly body: unknown }) {
      fetchResult = value;
    },
    setFetchResults(
      values: { readonly ok: boolean; readonly body: unknown }[],
    ) {
      fetchResults = [...values];
    },
    getActionListener: () => actionListener,
    getMessageListener: () => messageListener,
    emitCreatedTab(tab: Parameters<CreatedTabListener>[0]) {
      createdTabListener?.(tab);
    },
    emitUpdatedTab(
      tabId: number,
      changeInfo: Parameters<UpdatedTabListener>[1],
      tab: Parameters<UpdatedTabListener>[2],
    ) {
      updatedTabListener?.(tabId, changeInfo, tab);
    },
  };
}

const backgroundSource = await readFile(
  new URL("../background.js", import.meta.url),
  "utf8",
);

test("只有用户点击豆包聊天页时才注入采集界面", async () => {
  const harness = createBackgroundHarness();
  runInNewContext(backgroundSource, {
    chrome: harness.chrome,
    URL,
    fetch: harness.fetch,
    atob,
    TextDecoder,
    setTimeout: () => 0,
  });
  const listener = harness.getActionListener();
  assert.ok(listener);

  await listener({ id: 1, url: "https://www.doubao.com/legal/terms" });
  assert.equal(harness.injected.length, 0);

  await listener({
    id: 1,
    url: "https://www.doubao.com/chat/38438399923815938",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.injected)), [
    {
      target: { tabId: 1 },
      files: ["capture-core.js", "automation-core.js", "content.js"],
    },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.sentMessages)), [
    { tabId: 1, message: { type: "WT_OPEN_PANEL" } },
  ]);
});

test("无尾斜杠的豆包空白聊天页也允许启动", async () => {
  const harness = createBackgroundHarness();
  runInNewContext(backgroundSource, {
    chrome: harness.chrome,
    URL,
    fetch: harness.fetch,
    atob,
    TextDecoder,
    setTimeout: () => 0,
  });
  const listener = harness.getActionListener();
  assert.ok(listener);

  await listener({ id: 2, url: "https://www.doubao.com/chat" });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.injected)), [
    {
      target: { tabId: 2 },
      files: ["capture-core.js", "automation-core.js", "content.js"],
    },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.sentMessages)), [
    { tabId: 2, message: { type: "WT_OPEN_PANEL" } },
  ]);
});

test("千问官网页面允许启动采集界面而其他千问页面失败关闭", async () => {
  const harness = createBackgroundHarness();
  runInNewContext(backgroundSource, {
    chrome: harness.chrome,
    URL,
    fetch: harness.fetch,
    atob,
    TextDecoder,
    setTimeout: () => 0,
  });
  const listener = harness.getActionListener();
  assert.ok(listener);

  await listener({ id: 3, url: "https://www.qianwen.com/legal/terms" });
  assert.equal(harness.injected.length, 0);
  await listener({ id: 3, url: "https://www.qianwen.com/" });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.injected)), [
    {
      target: { tabId: 3 },
      files: ["capture-core.js", "automation-core.js", "content.js"],
    },
  ]);
});

test("DeepSeek 对话页允许启动采集界面而登录页失败关闭", async () => {
  const harness = createBackgroundHarness();
  runInNewContext(backgroundSource, {
    chrome: harness.chrome,
    URL,
    fetch: harness.fetch,
    atob,
    TextDecoder,
    setTimeout: () => 0,
  });
  const listener = harness.getActionListener();
  assert.ok(listener);

  await listener({ id: 4, url: "https://chat.deepseek.com/sign_in" });
  assert.equal(harness.injected.length, 0);
  await listener({
    id: 4,
    url: "https://chat.deepseek.com/a/chat/s/example",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.injected)), [
    {
      target: { tabId: 4 },
      files: ["capture-core.js", "automation-core.js", "content.js"],
    },
  ]);
});

test("千问来源监听只读取当前页打开的外部标签并关闭返回", async () => {
  const harness = createBackgroundHarness();
  runInNewContext(backgroundSource, {
    chrome: harness.chrome,
    URL,
    fetch: harness.fetch,
    atob,
    TextDecoder,
    setTimeout: () => 0,
  });
  const listener = harness.getMessageListener();
  assert.ok(listener);

  let beginResponse: unknown;
  assert.equal(
    listener(
      { type: "WT_SOURCE_TAB_WATCH_BEGIN" },
      {
        tab: {
          active: true,
          id: 3,
          url: "https://www.qianwen.com/chat/example",
          windowId: 7,
        },
      },
      (value) => {
        beginResponse = value;
      },
    ),
    false,
  );
  const watchId = (
    beginResponse as { readonly result: { readonly watch_id: string } }
  ).result.watch_id;

  harness.emitCreatedTab({
    id: 8,
    openerTabId: 99,
    url: "https://ignored.example/source",
    windowId: 7,
  });
  harness.emitCreatedTab({
    id: 9,
    openerTabId: 3,
    url: "about:blank",
    windowId: 7,
  });
  harness.emitUpdatedTab(
    9,
    { url: "https://source.example/article" },
    { id: 9, openerTabId: 3, windowId: 7 },
  );

  let resultResponse: unknown;
  assert.equal(
    listener(
      { type: "WT_SOURCE_TAB_WATCH_RESULT", watchId },
      {
        tab: {
          active: false,
          id: 3,
          url: "https://www.qianwen.com/chat/example",
          windowId: 7,
        },
      },
      (value) => {
        resultResponse = value;
      },
    ),
    true,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(resultResponse)), {
    ok: true,
    result: { url: "https://source.example/article" },
  });
  assert.deepEqual(harness.removedTabs, [9]);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.updatedTabs)), [
    { tabId: 3, input: { active: true } },
  ]);
});

test("截图请求必须来自当前激活的豆包聊天页", async () => {
  const harness = createBackgroundHarness();
  runInNewContext(backgroundSource, {
    chrome: harness.chrome,
    URL,
    fetch: harness.fetch,
    atob,
    TextDecoder,
    setTimeout: () => 0,
  });
  const listener = harness.getMessageListener();
  assert.ok(listener);

  let deniedResponse: unknown;
  assert.equal(
    listener(
      { type: "WT_CAPTURE_VIEWPORT" },
      {
        tab: {
          active: false,
          id: 1,
          url: "https://www.doubao.com/chat/example",
          windowId: 7,
        },
      },
      (response) => {
        deniedResponse = response;
      },
    ),
    false,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(deniedResponse)), {
    ok: false,
    error: "CAPTURE_PAGE_NOT_ALLOWED",
  });

  let allowedResponse: unknown;
  assert.equal(
    listener(
      { type: "WT_CAPTURE_VIEWPORT" },
      {
        tab: {
          active: true,
          id: 1,
          url: "https://www.doubao.com/chat/example",
          windowId: 7,
        },
      },
      (response) => {
        allowedResponse = response;
      },
    ),
    true,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(harness.screenshots)), [
    { windowId: 7, options: { format: "png" } },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(allowedResponse)), {
    ok: true,
    dataUrl: "data:image/png;base64,AA==",
  });
});

test("用户确认后只能凭一次性接入码提交到本机问天", async () => {
  const harness = createBackgroundHarness();
  runInNewContext(backgroundSource, {
    chrome: harness.chrome,
    URL,
    fetch: harness.fetch,
    atob,
    TextDecoder,
    setTimeout: () => 0,
  });
  const listener = harness.getMessageListener();
  assert.ok(listener);
  const handoff = Buffer.from(
    JSON.stringify({
      version: "wentian-extension-handoff@1",
      api_origin: "http://127.0.0.1:64324",
      task_id: "11111111-1111-4111-8111-111111111111",
      task_version: 2,
      capture_token: "signed-token",
      token_expires_at: "2099-08-23T12:10:00.000Z",
      reviewed_session_metadata: {
        surface_model_label: null,
        is_new_conversation: true,
        is_logged_in: true,
        memory_enabled: null,
        personalization_enabled: null,
        locale: "zh-CN",
        region: "CN_MAINLAND",
      },
    }),
  ).toString("base64url");
  let response: unknown;
  assert.equal(
    listener(
      {
        type: "WT_SUBMIT_CAPTURE",
        handoffCode: handoff,
        draft: { answer: "ok" },
      },
      {
        tab: {
          active: true,
          id: 1,
          url: "https://www.doubao.com/chat/example",
          windowId: 7,
        },
      },
      (value) => {
        response = value;
      },
    ),
    true,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.requests.length, 1);
  const request = harness.requests[0] as {
    url: string;
    init: { body: string; credentials?: string };
  };
  assert.equal(
    request.url,
    "http://127.0.0.1:64324/api/v1/ai-visibility/consumer-observations/tasks/11111111-1111-4111-8111-111111111111/captures",
  );
  assert.equal(request.init.credentials, undefined);
  assert.deepEqual(JSON.parse(request.init.body), {
    capture_token: "signed-token",
    task_version: 2,
    draft: { answer: "ok" },
    reviewed_session_metadata: {
      surface_model_label: null,
      is_new_conversation: true,
      is_logged_in: true,
      memory_enabled: null,
      personalization_enabled: null,
      locale: "zh-CN",
      region: "CN_MAINLAND",
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(response)), {
    ok: true,
    result: { task_id: "11111111-1111-4111-8111-111111111111" },
  });
});

test("自动提问前必须用一次性接入码向本机问天预检", async () => {
  const harness = createBackgroundHarness();
  const tokenExpiresAt = "2099-08-23T12:10:00.000Z";
  harness.setFetchResult({
    ok: true,
    body: {
      status: "ready",
      task_id: "11111111-1111-4111-8111-111111111111",
      task_version: 2,
      surface_code: "doubao_web",
      prompt: "广州搬家公司哪家好？",
      expected_page_origin: "https://www.doubao.com",
      page_signature_version: "doubao-web-signature@6-visible-reference-panel",
      token_expires_at: tokenExpiresAt,
      review_required: true,
    },
  });
  runInNewContext(backgroundSource, {
    chrome: harness.chrome,
    URL,
    fetch: harness.fetch,
    atob,
    TextDecoder,
    setTimeout: () => 0,
  });
  const listener = harness.getMessageListener();
  assert.ok(listener);
  const handoff = Buffer.from(
    JSON.stringify({
      version: "wentian-extension-handoff@1",
      api_origin: "http://127.0.0.1:64324",
      task_id: "11111111-1111-4111-8111-111111111111",
      task_version: 2,
      capture_token: "signed-token",
      token_expires_at: tokenExpiresAt,
      reviewed_session_metadata: {
        surface_model_label: null,
        is_new_conversation: true,
        is_logged_in: true,
        memory_enabled: null,
        personalization_enabled: null,
        locale: "zh-CN",
        region: "CN_MAINLAND",
      },
    }),
  ).toString("base64url");
  let response: unknown;
  assert.equal(
    listener(
      { type: "WT_AUTOMATION_PREFLIGHT", handoffCode: handoff },
      {
        tab: {
          active: true,
          id: 1,
          url: "https://www.doubao.com/chat/example",
          windowId: 7,
        },
      },
      (value) => {
        response = value;
      },
    ),
    true,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const request = harness.requests[0] as {
    url: string;
    init: { body: string; credentials?: string };
  };
  assert.equal(
    request.url,
    "http://127.0.0.1:64324/api/v1/ai-visibility/consumer-observations/tasks/11111111-1111-4111-8111-111111111111/automation-preflight",
  );
  assert.equal(request.init.credentials, undefined);
  assert.deepEqual(JSON.parse(request.init.body), {
    capture_token: "signed-token",
    task_version: 2,
  });
  assert.equal((response as { readonly ok: boolean }).ok, true);
});

test("整批接入码可连续领取下一项并自动完成单题预检", async () => {
  const harness = createBackgroundHarness();
  const tokenExpiresAt = "2099-08-23T14:00:00.000Z";
  const taskTokenExpiresAt = "2099-08-23T12:10:00.000Z";
  const taskHandoff = Buffer.from(
    JSON.stringify({
      version: "wentian-extension-handoff@1",
      api_origin: "http://127.0.0.1:64324",
      task_id: "11111111-1111-4111-8111-111111111111",
      task_version: 2,
      capture_token: "signed-task-token",
      token_expires_at: taskTokenExpiresAt,
      reviewed_session_metadata: {
        surface_model_label: null,
        is_new_conversation: true,
        is_logged_in: true,
        memory_enabled: null,
        personalization_enabled: null,
        locale: "zh-CN",
        region: "CN_MAINLAND",
      },
    }),
  ).toString("base64url");
  harness.setFetchResults([
    {
      ok: true,
      body: {
        status: "task_ready",
        run_id: "31111111-1111-4111-8111-111111111111",
        total_task_count: 3,
        completed_task_count: 0,
        remaining_task_count: 2,
        claim: {
          task: {
            id: "11111111-1111-4111-8111-111111111111",
            scope_id: "21111111-1111-4111-8111-111111111111",
            run_id: "31111111-1111-4111-8111-111111111111",
            query_snapshot_item_id: "41111111-1111-4111-8111-111111111111",
            query_text: "广州搬家公司哪家好？",
            sample_index: 1,
            status: "capturing",
            task_version: 2,
            collection_method: "browser_assisted",
            updated_at: "2099-08-23T12:00:00.000Z",
          },
          surface_code: "doubao_web",
          session_conditions: {
            search_mode: "unknown",
            is_new_conversation: true,
            is_logged_in: true,
            memory_enabled: null,
            personalization_enabled: null,
            locale: "zh-CN",
            region: "CN_MAINLAND",
          },
          capture_token: "signed-task-token",
          token_expires_at: taskTokenExpiresAt,
          extension_handoff_code: taskHandoff,
        },
      },
    },
    {
      ok: true,
      body: {
        status: "ready",
        task_id: "11111111-1111-4111-8111-111111111111",
        task_version: 2,
        surface_code: "doubao_web",
        prompt: "广州搬家公司哪家好？",
        expected_page_origin: "https://www.doubao.com",
        page_signature_version:
          "doubao-web-signature@6-visible-reference-panel",
        token_expires_at: taskTokenExpiresAt,
        review_required: true,
      },
    },
  ]);
  runInNewContext(backgroundSource, {
    chrome: harness.chrome,
    URL,
    fetch: harness.fetch,
    atob,
    TextDecoder,
    setTimeout: () => 0,
  });
  const listener = harness.getMessageListener();
  assert.ok(listener);
  const batchHandoff = Buffer.from(
    JSON.stringify({
      version: "wentian-extension-batch-handoff@1",
      api_origin: "http://127.0.0.1:64324",
      run_id: "31111111-1111-4111-8111-111111111111",
      batch_token: "signed-batch-token",
      token_expires_at: tokenExpiresAt,
    }),
  ).toString("base64url");
  let response: unknown;
  assert.equal(
    listener(
      { type: "WT_BATCH_NEXT", batchHandoffCode: batchHandoff },
      {
        tab: {
          active: true,
          id: 1,
          url: "https://www.doubao.com/chat/example",
          windowId: 7,
        },
      },
      (value) => {
        response = value;
      },
    ),
    true,
  );
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.requests.length, 2);
  assert.match(
    (harness.requests[0] as { readonly url: string }).url,
    /automation-batches\/next$/,
  );
  const result = response as {
    readonly ok: boolean;
    readonly result: { readonly status: string; readonly handoff_code: string };
  };
  assert.equal(result.ok, true);
  assert.equal(result.result.status, "task_ready");
  assert.equal(result.result.handoff_code, taskHandoff);
});

test("接入码不能把采集结果提交到非本机地址", async () => {
  const harness = createBackgroundHarness();
  runInNewContext(backgroundSource, {
    chrome: harness.chrome,
    URL,
    fetch: harness.fetch,
    atob,
    TextDecoder,
    setTimeout: () => 0,
  });
  const listener = harness.getMessageListener();
  assert.ok(listener);
  const handoff = Buffer.from(
    JSON.stringify({
      version: "wentian-extension-handoff@1",
      api_origin: "https://example.com",
      task_id: "11111111-1111-4111-8111-111111111111",
      task_version: 2,
      capture_token: "signed-token",
      token_expires_at: "2099-08-23T12:10:00.000Z",
      reviewed_session_metadata: {
        surface_model_label: null,
        is_new_conversation: true,
        is_logged_in: true,
        memory_enabled: null,
        personalization_enabled: null,
        locale: "zh-CN",
        region: null,
      },
    }),
  ).toString("base64url");
  let response: unknown;
  listener(
    { type: "WT_SUBMIT_CAPTURE", handoffCode: handoff, draft: {} },
    {
      tab: {
        active: true,
        id: 1,
        url: "https://www.doubao.com/chat/example",
        windowId: 7,
      },
    },
    (value) => {
      response = value;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.requests.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(response)), {
    ok: false,
    error: "接入码无效",
  });
});
