import { Pool } from "pg";

import {
  PostgresRetentionCleanupService,
  S3EvidenceObjectStore,
} from "../packages/infrastructure/src/index.ts";

const baseUrl = requiredEnvironment("WENTIAN_VALIDATION_BASE_URL").replace(
  /\/$/,
  "",
);
const email = requiredEnvironment("WENTIAN_VALIDATION_OWNER_EMAIL");
const password = requiredEnvironment("WENTIAN_VALIDATION_OWNER_PASSWORD");
const projectKey = `validation-${Date.now()}`;

const login = await jsonRequest("/api/v1/auth/login", {
  method: "POST",
  headers: jsonHeaders({ origin: baseUrl }),
  body: { email, password },
});
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
const loginBody = login.body as { readonly csrf_token: string };
if (!cookie || !loginBody.csrf_token) {
  throw new Error("VALIDATION_LOGIN_SESSION_MISSING");
}
const authenticatedHeaders = jsonHeaders({
  cookie,
  origin: baseUrl,
  "x-wentian-csrf-token": loginBody.csrf_token,
});

const scope = (
  await jsonRequest("/api/v1/scopes", {
    method: "POST",
    headers: authenticatedHeaders,
    body: {
      project_key: projectKey,
      display_name: "消费端持久化演练",
    },
  })
).body as { readonly id: string };

const snapshot = (
  await jsonRequest("/api/v1/query-set-snapshots", {
    method: "POST",
    headers: authenticatedHeaders,
    body: {
      scope_id: scope.id,
      title: "广州搬家公司测试问题",
      locale: "zh-CN",
      market: "CN_MAINLAND",
      queries: [
        {
          external_key: "q001",
          query_text: "广州搬家公司哪家好？",
          intent_code: "recommendation",
          commercial_value: "high",
        },
      ],
    },
  })
).body as {
  readonly id: string;
  readonly items: readonly { readonly id: string }[];
};

const run = (
  await jsonRequest("/api/v1/ai-visibility/consumer-observations", {
    method: "POST",
    headers: authenticatedHeaders,
    body: {
      scope_id: scope.id,
      query_set_snapshot_id: snapshot.id,
      surface_code: "doubao_web",
      collection_method: "browser_assisted",
      experiment_kind: "natural_answer",
      sample_count: 2,
      session_conditions: sessionConditions(),
    },
  })
).body as { readonly id: string };

const tasks = (
  await jsonRequest(`/api/v1/scopes/${scope.id}/runs/${run.id}/tasks`, {
    headers: { cookie },
  })
).body as {
  readonly tasks: readonly {
    readonly id: string;
    readonly task_version: number;
  }[];
};
if (tasks.tasks.length !== 2) {
  throw new Error("VALIDATION_TASK_COUNT_MISMATCH");
}

const citationSets = [
  [
    ["https://a.com/one", "A-1"],
    ["https://a.com/two", "A-2"],
    ["https://b.com/one", "B-1"],
  ],
  [
    ["https://a.com/three", "A-3"],
    ["https://c.com/one", "C-1"],
  ],
] as const;

for (const [index, listedTask] of tasks.tasks.entries()) {
  const claimed = (
    await jsonRequest(
      `/api/v1/ai-visibility/consumer-observations/tasks/${listedTask.id}/claim`,
      {
        method: "POST",
        headers: authenticatedHeaders,
        body: {},
      },
    )
  ).body as {
    readonly task: {
      readonly task_version: number;
      readonly updated_at: string;
    };
    readonly extension_handoff_code: string;
  };
  const handoff = decodeExtensionHandoff(claimed.extension_handoff_code);
  if (
    handoff.task_id !== listedTask.id ||
    handoff.api_origin !== baseUrl ||
    handoff.task_version !== claimed.task.task_version
  ) {
    throw new Error("VALIDATION_EXTENSION_HANDOFF_MISMATCH");
  }
  if (index === 0) {
    const preflightResponse = await fetch(
      `${baseUrl}/api/v1/ai-visibility/consumer-observations/tasks/${listedTask.id}/automation-preflight`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          capture_token: handoff.capture_token,
          task_version: handoff.task_version,
        }),
      },
    );
    const preflightBody = (await preflightResponse.json()) as {
      readonly error?: string;
    };
    if (
      preflightResponse.status !== 403 ||
      preflightBody.error !== "AUTOMATION_SWITCH_DISABLED"
    ) {
      throw new Error(
        `VALIDATION_AUTOMATION_DEFAULT_GATE_MISMATCH:${JSON.stringify(preflightBody)}`,
      );
    }
  }
  const observedAt = new Date(
    Date.parse(claimed.task.updated_at) + 1,
  ).toISOString();
  const uploaded = (
    await jsonRequest(
      `/api/v1/ai-visibility/consumer-observations/tasks/${listedTask.id}/captures`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: {
          capture_token: handoff.capture_token,
          task_version: handoff.task_version,
          draft: captureDraft(observedAt, citationSets[index]!),
          reviewed_session_metadata: handoff.reviewed_session_metadata,
        },
      },
    )
  ).body as { readonly task_version: number };

  await jsonRequest(
    `/api/v1/ai-visibility/consumer-observations/tasks/${listedTask.id}/confirm`,
    {
      method: "POST",
      headers: authenticatedHeaders,
      body: { task_version: uploaded.task_version },
    },
  );
}

const ranking = (
  await jsonRequest(
    `/api/v1/scopes/${scope.id}/runs/${run.id}/source-ranking?query_snapshot_item_id=${snapshot.items[0]!.id}`,
    { headers: { cookie } },
  )
).body as {
  readonly total_formal_source_entries: number;
  readonly ranking: readonly {
    readonly registrable_domain: string;
    readonly display_origin: string;
    readonly formal_source_entry_count: number;
  }[];
};

const expected = [
  ["a.com", "https://a.com", 3],
  ["b.com", "https://b.com", 1],
  ["c.com", "https://c.com", 1],
] as const;
if (
  ranking.total_formal_source_entries !== 5 ||
  JSON.stringify(
    ranking.ranking.map((item) => [
      item.registrable_domain,
      item.display_origin,
      item.formal_source_entry_count,
    ]),
  ) !== JSON.stringify(expected)
) {
  throw new Error(`VALIDATION_RANKING_MISMATCH:${JSON.stringify(ranking)}`);
}

const nominationRun = (
  await jsonRequest("/api/v1/ai-visibility/consumer-observations", {
    method: "POST",
    headers: authenticatedHeaders,
    body: {
      scope_id: scope.id,
      query_set_snapshot_id: snapshot.id,
      surface_code: "doubao_web",
      collection_method: "browser_assisted",
      experiment_kind: "source_nomination",
      sample_count: 2,
      session_conditions: sessionConditions(),
      paired_run_id: run.id,
    },
  })
).body as { readonly id: string };

const nominationTasks = (
  await jsonRequest(
    `/api/v1/scopes/${scope.id}/runs/${nominationRun.id}/tasks`,
    { headers: { cookie } },
  )
).body as {
  readonly tasks: readonly { readonly id: string }[];
};
const nominationAnswers = [
  "1. a.com：行业基础资料。\n2. d.com：本地企业信息。\n3. c.com：用户评价。",
  "1. a.com：基础资料。\n2. c.com：消费评价。\n3. d.com：工商信息。",
] as const;
for (const [index, listedTask] of nominationTasks.tasks.entries()) {
  const claimed = (
    await jsonRequest(
      `/api/v1/ai-visibility/consumer-observations/tasks/${listedTask.id}/claim`,
      { method: "POST", headers: authenticatedHeaders, body: {} },
    )
  ).body as {
    readonly task: {
      readonly task_version: number;
      readonly query_text: string;
      readonly updated_at: string;
    };
    readonly extension_handoff_code: string;
  };
  if (!claimed.task.query_text.includes("前10个域名")) {
    throw new Error("VALIDATION_NOMINATION_PROMPT_NOT_DERIVED");
  }
  const handoff = decodeExtensionHandoff(claimed.extension_handoff_code);
  const observedAt = new Date(
    Date.parse(claimed.task.updated_at) + 1,
  ).toISOString();
  const uploaded = (
    await jsonRequest(
      `/api/v1/ai-visibility/consumer-observations/tasks/${listedTask.id}/captures`,
      {
        method: "POST",
        headers: jsonHeaders(),
        body: {
          capture_token: handoff.capture_token,
          task_version: handoff.task_version,
          draft: captureDraft(observedAt, [], nominationAnswers[index]!),
          reviewed_session_metadata: handoff.reviewed_session_metadata,
        },
      },
    )
  ).body as { readonly task_version: number };
  await jsonRequest(
    `/api/v1/ai-visibility/consumer-observations/tasks/${listedTask.id}/confirm`,
    {
      method: "POST",
      headers: authenticatedHeaders,
      body: { task_version: uploaded.task_version },
    },
  );
}

const reviewList = (
  await jsonRequest(
    `/api/v1/scopes/${scope.id}/runs/${nominationRun.id}/nomination-reviews`,
    { headers: { cookie } },
  )
).body as {
  readonly reviews: readonly {
    readonly id: string;
    readonly version: number;
    readonly proposed_items: readonly {
      readonly registrable_domain: string;
      readonly position: number | null;
      readonly information_type: string | null;
      readonly reason: string | null;
    }[];
  }[];
};
if (reviewList.reviews.length !== 2) {
  throw new Error("VALIDATION_NOMINATION_REVIEW_COUNT_MISMATCH");
}
for (const review of reviewList.reviews) {
  await jsonRequest(
    `/api/v1/scopes/${scope.id}/nomination-reviews/${review.id}/confirm`,
    {
      method: "POST",
      headers: authenticatedHeaders,
      body: {
        review_version: review.version,
        reviewed_items: review.proposed_items,
      },
    },
  );
}

const comparison = (
  await jsonRequest(
    `/api/v1/scopes/${scope.id}/comparisons/nomination-citation?natural_answer_run_id=${run.id}&source_nomination_run_id=${nominationRun.id}&k=10`,
    { headers: { cookie } },
  )
).body as {
  readonly comparability: { readonly status: string };
  readonly questions: readonly {
    readonly nomination_ranking: {
      readonly domains: readonly {
        readonly registrable_domain: string;
        readonly entry_count: number;
      }[];
    };
    readonly overlap: {
      readonly numerator: number;
      readonly denominator: number;
    } | null;
  }[];
};
if (
  comparison.comparability.status !== "comparable" ||
  comparison.questions.length !== 1 ||
  JSON.stringify(
    comparison.questions[0]!.nomination_ranking.domains.map((domain) => [
      domain.registrable_domain,
      domain.entry_count,
    ]),
  ) !==
    JSON.stringify([
      ["a.com", 2],
      ["c.com", 2],
      ["d.com", 2],
    ]) ||
  comparison.questions[0]!.overlap?.numerator !== 2 ||
  comparison.questions[0]!.overlap?.denominator !== 10
) {
  throw new Error(
    `VALIDATION_NOMINATION_COMPARISON_MISMATCH:${JSON.stringify(comparison)}`,
  );
}

const pendingRun = (
  await jsonRequest("/api/v1/ai-visibility/consumer-observations", {
    method: "POST",
    headers: authenticatedHeaders,
    body: {
      scope_id: scope.id,
      query_set_snapshot_id: snapshot.id,
      surface_code: "doubao_web",
      collection_method: "browser_assisted",
      experiment_kind: "natural_answer",
      sample_count: 1,
      session_conditions: sessionConditions(),
    },
  })
).body as { readonly id: string };
const pendingTask = (
  await jsonRequest(`/api/v1/scopes/${scope.id}/runs/${pendingRun.id}/tasks`, {
    headers: { cookie },
  })
).body as { readonly tasks: readonly { readonly id: string }[] };
const pendingClaim = (
  await jsonRequest(
    `/api/v1/ai-visibility/consumer-observations/tasks/${pendingTask.tasks[0]!.id}/claim`,
    { method: "POST", headers: authenticatedHeaders, body: {} },
  )
).body as {
  readonly task: { readonly updated_at: string };
  readonly extension_handoff_code: string;
};
const pendingHandoff = decodeExtensionHandoff(
  pendingClaim.extension_handoff_code,
);
await jsonRequest(
  `/api/v1/ai-visibility/consumer-observations/tasks/${pendingTask.tasks[0]!.id}/captures`,
  {
    method: "POST",
    headers: jsonHeaders(),
    body: {
      capture_token: pendingHandoff.capture_token,
      task_version: pendingHandoff.task_version,
      draft: captureDraft(
        new Date(Date.parse(pendingClaim.task.updated_at) + 1).toISOString(),
        [],
      ),
      reviewed_session_metadata: pendingHandoff.reviewed_session_metadata,
    },
  },
);

const abandonedRun = (
  await jsonRequest("/api/v1/ai-visibility/consumer-observations", {
    method: "POST",
    headers: authenticatedHeaders,
    body: {
      scope_id: scope.id,
      query_set_snapshot_id: snapshot.id,
      surface_code: "doubao_web",
      collection_method: "browser_assisted",
      experiment_kind: "natural_answer",
      sample_count: 1,
      session_conditions: sessionConditions(),
    },
  })
).body as { readonly id: string };
const abandonedTask = (
  await jsonRequest(
    `/api/v1/scopes/${scope.id}/runs/${abandonedRun.id}/tasks`,
    {
      headers: { cookie },
    },
  )
).body as { readonly tasks: readonly { readonly id: string }[] };
await jsonRequest(
  `/api/v1/ai-visibility/consumer-observations/tasks/${abandonedTask.tasks[0]!.id}/claim`,
  { method: "POST", headers: authenticatedHeaders, body: {} },
);

const retentionPool = new Pool({
  connectionString: requiredEnvironment("WENTIAN_DATABASE_URL"),
  max: 4,
});
let retentionObjects: S3EvidenceObjectStore | null = null;
let retentionResult:
  Awaited<ReturnType<PostgresRetentionCleanupService["runOnce"]>> | undefined;
try {
  const cutoffAt = new Date(Date.now() + 2_000).toISOString();
  const expiredAt = new Date(Date.parse(cutoffAt) - 1_000).toISOString();
  const abandonedAt = new Date(
    Date.parse(cutoffAt) - 25 * 60 * 60 * 1_000,
  ).toISOString();
  await retentionPool.query(
    `UPDATE evidence_media_assets
     SET expires_at = $2
     WHERE scope_id = $1`,
    [scope.id, expiredAt],
  );
  await retentionPool.query(
    `UPDATE confirmed_consumer_observation_records
     SET raw_expires_at = $2
     WHERE scope_id = $1`,
    [scope.id, expiredAt],
  );
  await retentionPool.query(
    `UPDATE consumer_observation_tasks
     SET updated_at = $2::timestamptz,
         task_json = jsonb_set(task_json, '{updatedAt}', to_jsonb($3::text))
     WHERE scope_id = $1 AND id = $4 AND status = 'capturing'`,
    [scope.id, abandonedAt, abandonedAt, abandonedTask.tasks[0]!.id],
  );
  const instance = await retentionPool.query<{ readonly id: string }>(
    "SELECT id FROM wentian_instances WHERE singleton = true",
  );
  retentionObjects = new S3EvidenceObjectStore({
    endpoint: requiredEnvironment("WENTIAN_OBJECT_STORE_ENDPOINT"),
    bucket: requiredEnvironment("WENTIAN_OBJECT_STORE_BUCKET"),
    accessKeyId: requiredEnvironment("WENTIAN_S3_ACCESS_KEY"),
    secretAccessKey: requiredEnvironment("WENTIAN_S3_SECRET_KEY"),
    instanceId: instance.rows[0]!.id,
  });
  retentionResult = await new PostgresRetentionCleanupService({
    pool: retentionPool,
    objects: retentionObjects,
  }).runOnce(cutoffAt);

  const facts = await retentionPool.query<{
    readonly confirmed_media: number;
    readonly purged_media: number;
    readonly purged_media_hashes: number;
    readonly capture_artifacts: number;
    readonly raw_records: number;
    readonly purged_raw_records: number;
    readonly purged_answer_hashes: number;
    readonly cited_events: number;
    readonly cited_raw_fields: number;
    readonly nominated_events: number;
    readonly nominated_explanations: number;
    readonly review_explanations: number;
    readonly pending_task_status: string;
    readonly pending_run_status: string;
    readonly abandoned_task_status: string;
    readonly abandoned_run_status: string;
  }>(
    `SELECT
       (SELECT count(*)::int FROM evidence_media_assets
        WHERE scope_id = $1 AND retention_class = 'screenshot_30d') AS confirmed_media,
       (SELECT count(*)::int FROM evidence_media_assets
        WHERE scope_id = $1 AND retention_class = 'screenshot_30d'
          AND purged_at IS NOT NULL) AS purged_media,
       (SELECT count(*)::int FROM evidence_media_assets
        WHERE scope_id = $1 AND retention_class = 'screenshot_30d'
          AND purged_at IS NOT NULL AND sha256 IS NULL) AS purged_media_hashes,
       (SELECT count(*)::int FROM consumer_capture_artifacts
        WHERE scope_id = $1) AS capture_artifacts,
       (SELECT count(*)::int FROM confirmed_consumer_observation_records
        WHERE scope_id = $1) AS raw_records,
       (SELECT count(*)::int FROM confirmed_consumer_observation_records
        WHERE scope_id = $1 AND record_json IS NULL AND raw_purged_at IS NOT NULL)
        AS purged_raw_records,
       (SELECT count(*)::int FROM confirmed_consumer_observation_records
        WHERE scope_id = $1 AND raw_purged_at IS NOT NULL AND answer_hash IS NULL)
        AS purged_answer_hashes,
       (SELECT count(*)::int FROM ai_visibility_cited_source_events
        WHERE scope_id = $1) AS cited_events,
       (SELECT count(*)::int FROM ai_visibility_cited_source_events
        WHERE scope_id = $1 AND (
          event_json->>'title' IS NOT NULL
          OR event_json->>'originalUrl' IS DISTINCT FROM event_json->>'normalizedUrl'
        )) AS cited_raw_fields,
       (SELECT count(*)::int FROM ai_visibility_nominated_source_events
        WHERE scope_id = $1) AS nominated_events,
       (SELECT count(*)::int FROM ai_visibility_nominated_source_events
        WHERE scope_id = $1 AND (
          event_json->>'nominationInformationType' IS NOT NULL
          OR event_json->>'nominationReason' IS NOT NULL
        )) AS nominated_explanations,
       (SELECT count(*)::int FROM source_nomination_parse_reviews review
        WHERE scope_id = $1 AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(review.review_json->'proposedItems') item
          WHERE item->>'informationType' IS NOT NULL OR item->>'reason' IS NOT NULL
        )) AS review_explanations,
       (SELECT status FROM consumer_observation_tasks WHERE id = $2)
        AS pending_task_status,
       (SELECT status FROM consumer_observation_runs WHERE id = $3)
        AS pending_run_status,
       (SELECT status FROM consumer_observation_tasks WHERE id = $4)
        AS abandoned_task_status,
       (SELECT status FROM consumer_observation_runs WHERE id = $5)
        AS abandoned_run_status`,
    [
      scope.id,
      pendingTask.tasks[0]!.id,
      pendingRun.id,
      abandonedTask.tasks[0]!.id,
      abandonedRun.id,
    ],
  );
  const fact = facts.rows[0]!;
  if (
    retentionResult.counts.expiredPendingEvidence < 1 ||
    retentionResult.counts.expiredAbandonedCaptures < 1 ||
    retentionResult.counts.purgedConfirmedScreenshots < 4 ||
    retentionResult.counts.purgedConfirmedRawRecords < 4 ||
    fact.confirmed_media !== 4 ||
    fact.purged_media !== 4 ||
    fact.purged_media_hashes !== 4 ||
    fact.capture_artifacts !== 0 ||
    fact.raw_records !== 4 ||
    fact.purged_raw_records !== 4 ||
    fact.purged_answer_hashes !== 4 ||
    fact.cited_events !== 5 ||
    fact.cited_raw_fields !== 0 ||
    fact.nominated_events !== 6 ||
    fact.nominated_explanations !== 0 ||
    fact.review_explanations !== 0 ||
    fact.pending_task_status !== "expired" ||
    fact.pending_run_status !== "failed" ||
    fact.abandoned_task_status !== "expired" ||
    fact.abandoned_run_status !== "failed"
  ) {
    throw new Error(
      `VALIDATION_RETENTION_MISMATCH:${JSON.stringify({ retentionResult, fact })}`,
    );
  }
} finally {
  retentionObjects?.destroy();
  await retentionPool.end();
}

const rankingAfterRawPurge = (
  await jsonRequest(
    `/api/v1/scopes/${scope.id}/runs/${run.id}/source-ranking?query_snapshot_item_id=${snapshot.items[0]!.id}`,
    { headers: { cookie } },
  )
).body as { readonly total_formal_source_entries: number };
const comparisonAfterRawPurge = (
  await jsonRequest(
    `/api/v1/scopes/${scope.id}/comparisons/nomination-citation?natural_answer_run_id=${run.id}&source_nomination_run_id=${nominationRun.id}&k=10`,
    { headers: { cookie } },
  )
).body as {
  readonly comparability: { readonly status: string };
  readonly questions: readonly {
    readonly overlap: { readonly numerator: number } | null;
  }[];
};
if (
  rankingAfterRawPurge.total_formal_source_entries !== 5 ||
  comparisonAfterRawPurge.comparability.status !== "comparable" ||
  comparisonAfterRawPurge.questions[0]?.overlap?.numerator !== 2
) {
  throw new Error("VALIDATION_RETAINED_SOURCE_FACTS_UNAVAILABLE");
}

const deletionPool = new Pool({
  connectionString: requiredEnvironment("WENTIAN_DATABASE_URL"),
  max: 2,
});
let deletionObjects: S3EvidenceObjectStore | null = null;
let deletionJobId: string | null = null;
try {
  const instance = await deletionPool.query<{ readonly id: string }>(
    "SELECT id FROM wentian_instances WHERE singleton = true",
  );
  deletionObjects = new S3EvidenceObjectStore({
    endpoint: requiredEnvironment("WENTIAN_OBJECT_STORE_ENDPOINT"),
    bucket: requiredEnvironment("WENTIAN_OBJECT_STORE_BUCKET"),
    accessKeyId: requiredEnvironment("WENTIAN_S3_ACCESS_KEY"),
    secretAccessKey: requiredEnvironment("WENTIAN_S3_SECRET_KEY"),
    instanceId: instance.rows[0]!.id,
  });
  await deletionObjects.putScreenshot({
    scopeId: scope.id,
    assetId: "scope-deletion-validation",
    bytes: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+lcLWAAAAAElFTkSuQmCC",
      "base64",
    ),
    observedAt: new Date().toISOString(),
  });
  const deletion = (
    await jsonRequest(`/api/v1/scopes/${scope.id}/deletion`, {
      method: "POST",
      headers: authenticatedHeaders,
      body: {
        project_key: projectKey,
        password,
        version: 1,
      },
    })
  ).body as { readonly id: string; readonly status: string };
  deletionJobId = deletion.id;
  if (deletion.status !== "succeeded") {
    throw new Error(`VALIDATION_SCOPE_DELETION_FAILED:${deletion.status}`);
  }
  const residue = await deletionPool.query<{
    readonly scope_count: number;
    readonly job_count: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM scopes WHERE id = $1) AS scope_count,
       (SELECT count(*)::int FROM scope_deletion_jobs
        WHERE id = $2 AND status = 'succeeded') AS job_count`,
    [scope.id, deletion.id],
  );
  const remainingObjects = await deletionObjects.deleteScopeObjects(scope.id);
  if (
    residue.rows[0]?.scope_count !== 0 ||
    residue.rows[0]?.job_count !== 1 ||
    remainingObjects !== 0
  ) {
    throw new Error(
      `VALIDATION_SCOPE_DELETION_RESIDUE:${JSON.stringify({ residue: residue.rows[0], remainingObjects })}`,
    );
  }
} finally {
  deletionObjects?.destroy();
  await deletionPool.end();
}

process.stdout.write(
  `${JSON.stringify({
    scope_id: scope.id,
    snapshot_id: snapshot.id,
    run_id: run.id,
    nomination_run_id: nominationRun.id,
    confirmed_samples: 2,
    confirmed_nomination_samples: 2,
    ranking: expected,
    nomination_ranking: [
      ["a.com", 2],
      ["c.com", 2],
      ["d.com", 2],
    ],
    overlap_at_10: "2/10",
    retention_cleanup_run_id: retentionResult!.cleanupRunId,
    retained_ranking_after_raw_purge: true,
    scope_deletion_job_id: deletionJobId,
    scope_deleted_without_residue: true,
    automation_preflight_default_blocked: true,
  })}\n`,
);

function captureDraft(
  observedAt: string,
  citations: readonly (readonly [string, string])[],
  answerText = `豆包消费端观察演练回答 ${observedAt}`,
) {
  return {
    schema_version: "wentian-consumer-capture@0-draft",
    adapter_status: "draft",
    surface_code: "doubao_web",
    collection_method: "browser_assisted",
    confirmation_status: "confirmed_local_export",
    confirmed_at: observedAt,
    answer_text: answerText,
    visible_citations: citations.map(([url, label], index) => ({
      url,
      label,
      position: index + 1,
    })),
    source_mention_hints: [],
    visible_metadata: {
      product_label: "豆包网页版",
      page_title: "豆包",
      page_origin: "https://www.doubao.com",
      search_mode: "unknown",
      observed_at: observedAt,
    },
    screenshot: {
      scope: "selected_visible_region",
      media_type: "image/png",
      data_url:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+lcLWAAAAAElFTkSuQmCC",
    },
  };
}

function sessionConditions() {
  return {
    search_mode: "unknown",
    is_new_conversation: true,
    is_logged_in: true,
    memory_enabled: null,
    personalization_enabled: null,
    locale: "zh-CN",
    region: "CN_MAINLAND",
  };
}

function decodeExtensionHandoff(value: string) {
  const parsed = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  ) as {
    readonly version: string;
    readonly api_origin: string;
    readonly task_id: string;
    readonly task_version: number;
    readonly capture_token: string;
    readonly reviewed_session_metadata: {
      readonly surface_model_label: string | null;
      readonly is_new_conversation: boolean;
      readonly is_logged_in: boolean;
      readonly memory_enabled: boolean | null;
      readonly personalization_enabled: boolean | null;
      readonly locale: string;
      readonly region: string | null;
    };
  };
  if (parsed.version !== "wentian-extension-handoff@1") {
    throw new Error("VALIDATION_EXTENSION_HANDOFF_VERSION_INVALID");
  }
  return parsed;
}

async function jsonRequest(
  path: string,
  options: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: unknown;
  },
): Promise<{ readonly headers: Headers; readonly body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: options.headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `VALIDATION_HTTP_${response.status}:${path}:${JSON.stringify(body)}`,
    );
  }
  return { headers: response.headers, body };
}

function jsonHeaders(
  additions: Record<string, string> = {},
): Record<string, string> {
  return { "content-type": "application/json", ...additions };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`MISSING_ENVIRONMENT:${name}`);
  }
  return value;
}
