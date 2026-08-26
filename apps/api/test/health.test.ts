import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { ReadinessChecks } from "@wentian/contracts";

import { createWentianApiServer } from "../src/server.ts";

test("liveness返回真实服务身份", async () => {
  await withServer(undefined, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/live`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "wentian-api",
      version: "0.0.0-test",
    });
  });
});

test("依赖未配置时readiness返回503", async () => {
  await withServer(undefined, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/ready`);
    const body = (await response.json()) as {
      status: string;
      checks: ReadinessChecks;
    };

    assert.equal(response.status, 503);
    assert.equal(body.status, "not_ready");
    assert.deepEqual(body.checks, {
      database: "not_configured",
      objectStore: "not_configured",
    });
  });
});

test("全部依赖就绪时readiness返回200", async () => {
  await withServer(
    () => ({
      database: "ready",
      objectStore: "ready",
    }),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health/ready`);

      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, "ready");
    },
  );
});

test("未知路由返回404", async () => {
  await withServer(undefined, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/unknown`);

    assert.equal(response.status, 404);
  });
});

test("独立版首页和静态资源带安全响应头", async () => {
  await withServer(undefined, async (baseUrl) => {
    const page = await fetch(`${baseUrl}/`);
    const script = await fetch(`${baseUrl}/app.js`);
    const questionGenerator = await fetch(`${baseUrl}/question-generator.js`);
    const reportCore = await fetch(`${baseUrl}/report-core.js`);
    const styles = await fetch(`${baseUrl}/styles.css`);

    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(
      page.headers.get("content-security-policy") ?? "",
      /default-src 'self'/,
    );
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    const pageText = await page.text();
    assert.match(pageText, /问天 AI 信源探测系统/);
    assert.match(pageText, /实验工作台/);
    assert.match(pageText, /data-create-project-trigger/);
    assert.match(pageText, /id="claim-next-task"/);
    assert.match(pageText, /id="create-batch-handoff"/);
    assert.match(pageText, /id="batch-handoff-code"/);
    assert.match(pageText, /id="task-auto-refresh-status"/);
    assert.match(pageText, /id="confirm-all-tasks"/);
    assert.match(pageText, /id="run-create-summary"/);
    assert.match(pageText, /id="run-surface"/);
    assert.match(pageText, /value="qianwen_web"/);
    assert.match(pageText, /id="task-run-context"/);
    assert.match(pageText, /class="task-action-buttons"/);
    assert.match(pageText, /class="task-action-status"/);
    assert.match(pageText, /id="report-view"/);
    assert.match(pageText, /id="snapshot-industry"/);
    assert.match(pageText, /id="snapshot-region-filter"/);
    assert.match(pageText, /id="run-industry-filter"/);
    assert.match(pageText, /data-searchable/);
    assert.equal(script.status, 200);
    const scriptText = await script.text();
    assert.match(scriptText, /loadNaturalRanking/);
    assert.match(scriptText, /claimNextTask/);
    assert.match(scriptText, /createAutomationBatch/);
    assert.match(scriptText, /ensureSelectedRunTasks/);
    assert.match(scriptText, /autoRefreshTasks/);
    assert.match(scriptText, /visibilitychange/);
    assert.match(scriptText, /confirmAllTasks/);
    assert.match(scriptText, /toggleTaskPreview/);
    assert.match(scriptText, /renderRunReport/);
    assert.match(scriptText, /setSearchableSelectValue/);
    assert.match(scriptText, /generateQuestions/);
    assert.match(scriptText, /refreshScopeSelector/);
    assert.match(scriptText, /updateRunCreateSummary/);
    assert.match(scriptText, /surfaceName/);
    assert.match(scriptText, /renderTaskRunContext/);
    assert.match(scriptText, /groupTasksByQuestion/);
    assert.match(scriptText, /renderQuestionTaskGroup/);
    assert.match(scriptText, /renderSampleTask/);
    assert.match(scriptText, /中断续接只会继续剩余采样/);
    assert.match(scriptText, /共\$\{run\.planned_sample_count\}次采样/);
    assert.match(scriptText, /deleteUnstartedRun/);
    assert.match(scriptText, /CONSUMER_OBSERVATION_RUN_NOT_DELETABLE/);
    assert.match(scriptText, /不会继承任何历史运行的完成状态/);
    assert.equal(reportCore.status, 200);
    assert.equal(questionGenerator.status, 200);
    assert.match(await questionGenerator.text(), /generateIndustryQuestions/);
    assert.match(
      reportCore.headers.get("content-type") ?? "",
      /text\/javascript/,
    );
    assert.match(await reportCore.text(), /buildNaturalReport/);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get("content-type") ?? "", /text\/css/);
    const stylesText = await styles.text();
    assert.match(stylesText, /--nominated:/);
    assert.match(stylesText, /\.question-task-card/);
    assert.match(stylesText, /\.sample-task-row/);
    assert.match(
      stylesText,
      /#tasks-panel > \.panel-heading[\s\S]*grid-template-columns:/,
    );
    assert.match(stylesText, /\.task-action-buttons/);
    assert.match(stylesText, /\.task-action-status/);
  });
});

async function withServer(
  getReadinessChecks:
    (() => ReadinessChecks) | (() => Promise<ReadinessChecks>) | undefined,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createWentianApiServer({
    version: "0.0.0-test",
    ...(getReadinessChecks === undefined ? {} : { getReadinessChecks }),
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
