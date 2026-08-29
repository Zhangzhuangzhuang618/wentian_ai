import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const implementation = await Promise.all(
  ["background.js", "capture-core.js", "automation-core.js", "content.js"].map(
    (fileName) => readFile(new URL(`../${fileName}`, import.meta.url), "utf8"),
  ),
);

test("扩展只申请当前页、脚本注入和千问临时来源标签权限", () => {
  assert.equal(manifest.version, "0.0.22");
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "tabs"]);
  assert.deepEqual(manifest.host_permissions, [
    "http://127.0.0.1/*",
    "http://localhost/*",
  ]);
  assert.equal("content_scripts" in manifest, false);
});

test("扩展不包含账号、网络监听或持久存储能力", () => {
  const source = implementation.join("\n");
  for (const forbiddenPattern of [
    /chrome\.cookies/,
    /chrome\.webRequest/,
    /localStorage/,
    /sessionStorage/,
    /XMLHttpRequest/,
    /["']Authorization["']/i,
  ]) {
    assert.equal(forbiddenPattern.test(source), false);
  }
  assert.equal(/\bfetch\s*\(/.test(implementation[3]), false);
  assert.match(implementation[0], /WT_SUBMIT_CAPTURE/);
  assert.match(implementation[0], /WT_AUTOMATION_PREFLIGHT/);
  assert.match(implementation[0], /WT_BATCH_NEXT/);
  assert.match(implementation[0], /WT_SOURCE_TAB_WATCH_BEGIN/);
  assert.match(implementation[0], /openerTabId !== senderTab\.id/);
  assert.match(implementation[0], /chrome\.tabs\.remove/);
  assert.match(implementation[0], /hostname === "127\.0\.0\.1"/);
  assert.match(implementation[0], /hostname === "localhost"/);
});

test("扩展保留用户选择、本地预览和最终确认步骤", () => {
  const contentSource = implementation[3];
  assert.match(contentSource, /handleSelectionClick/);
  assert.match(contentSource, /renderPreview/);
  assert.match(contentSource, /确认并提交到问天/);
  assert.match(contentSource, /改为导出本地 JSON/);
  assert.match(contentSource, /问天一次性接入码/);
  assert.match(contentSource, /文本提示不会计入引用/);
  assert.match(contentSource, /自动采集单题/);
  assert.match(contentSource, /连续采集整批/);
  assert.match(contentSource, /整批采集完成/);
  assert.match(contentSource, /改用手动选择/);
  assert.match(contentSource, /findReferencePanelTrigger/);
  assert.match(contentSource, /collectReferencePanelLinks/);
  assert.match(contentSource, /resolveQianwenReferenceCards/);
  assert.match(
    contentSource,
    /candidate\.scrollIntoView\(\{ block: "center", inline: "nearest" \}\)/,
  );
  assert.match(contentSource, /typeof element\.onclick === "function"/);
  assert.match(contentSource, /interactionRank > current\.interactionRank/);
  assert.match(contentSource, /readQianwenReferenceCardUrl/);
  assert.match(contentSource, /readQianwenReferenceCardMetadata/);
  assert.match(contentSource, /refer_num/);
  assert.match(contentSource, /metadata\.ref_url/);
  assert.match(contentSource, /findQianwenReferenceCards/);
  assert.match(contentSource, /data-source-url/);
  assert.match(contentSource, /isBlankComposerText/);
  assert.match(contentSource, /未能读取完整的可见链接/);
  assert.match(contentSource, /chat_input_send_button/);
  assert.match(contentSource, /ClipboardEvent\("paste"/);
  assert.equal(/new KeyboardEvent/.test(contentSource), false);
});

test("整批模式兼容折叠侧栏中的非标准新对话菜单项", () => {
  const contentSource = implementation[3];
  assert.match(contentSource, /findNewConversationControl/);
  assert.match(contentSource, /findSidebarToggleControl/);
  assert.match(contentSource, /isNewConversationLabel/);
  assert.match(contentSource, /li, div, span/);
  assert.match(contentSource, /sidebar\|side-bar\|drawer\|navigation\|menu/);
});
