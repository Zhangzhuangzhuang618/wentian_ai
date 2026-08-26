import type {
  AiVisibilityNominatedSourceEventRepository,
  SourceNominationParseReviewConfirmationCommit,
  SourceNominationParseReviewRejectionCommit,
  SourceNominationParseReviewRepository,
  SourceNominationParseReviewTransactionRepository,
} from "@wentian/application";
import {
  assertSourceNominationParseReviewIntegrity,
  type AiVisibilityNominatedSourceEvent,
  type SourceNominationParseReview,
  type SourceNominationParseReviewStatus,
} from "@wentian/domain";
import type { Pool, PoolClient } from "pg";

import { assertProjectedNominatedSourceEventIntegrity } from "./source-nomination-event-projection.ts";

type QueryablePool = Pick<Pool, "query" | "connect">;

export class PostgresSourceNominationRepository
  implements
    SourceNominationParseReviewRepository,
    AiVisibilityNominatedSourceEventRepository,
    SourceNominationParseReviewTransactionRepository
{
  private readonly pool: QueryablePool;

  constructor(pool: QueryablePool) {
    this.pool = pool;
  }

  async create(review: SourceNominationParseReview): Promise<void> {
    assertSourceNominationParseReviewIntegrity(review);
    await this.pool.query(...insertReviewQuery(review));
  }

  async findById(
    scopeId: string,
    reviewId: string,
  ): Promise<SourceNominationParseReview | null> {
    const result = await this.pool.query<ReviewRow>(
      `${REVIEW_SELECT} WHERE scope_id = $1 AND id = $2`,
      [scopeId, reviewId],
    );
    return result.rows[0] ? hydrateReview(result.rows[0]) : null;
  }

  async findByResponseId(
    scopeId: string,
    responseId: string,
  ): Promise<SourceNominationParseReview | null> {
    const result = await this.pool.query<ReviewRow>(
      `${REVIEW_SELECT} WHERE scope_id = $1 AND response_id = $2`,
      [scopeId, responseId],
    );
    return result.rows[0] ? hydrateReview(result.rows[0]) : null;
  }

  async listByStatus(
    scopeId: string,
    status: SourceNominationParseReviewStatus,
  ): Promise<readonly SourceNominationParseReview[]> {
    const result = await this.pool.query<ReviewRow>(
      `${REVIEW_SELECT}
       WHERE scope_id = $1 AND status = $2
       ORDER BY created_at, id`,
      [scopeId, status],
    );
    return Object.freeze(result.rows.map(hydrateReview));
  }

  async save(
    review: SourceNominationParseReview,
    expectedVersion: number,
  ): Promise<SourceNominationParseReview> {
    assertSourceNominationParseReviewIntegrity(review);
    if (review.version !== expectedVersion + 1) {
      throw new Error("NOMINATION_REVIEW_VERSION_CONFLICT");
    }
    const result = await this.pool.query(
      `UPDATE source_nomination_parse_reviews
       SET status = $1, review_json = $2::jsonb, version = $3, updated_at = $4
       WHERE scope_id = $5 AND id = $6 AND version = $7`,
      [
        review.status,
        JSON.stringify(review),
        review.version,
        review.updatedAt,
        review.scopeId,
        review.id,
        expectedVersion,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error("NOMINATION_REVIEW_VERSION_CONFLICT");
    }
    return freezeReview(review);
  }

  async createMany(
    events: readonly AiVisibilityNominatedSourceEvent[],
  ): Promise<void> {
    events.forEach(assertProjectedNominatedSourceEventIntegrity);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const event of events) {
        await client.query(...insertEventQuery(event));
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listByResponse(
    scopeId: string,
    responseId: string,
  ): Promise<readonly AiVisibilityNominatedSourceEvent[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT event_json
       FROM ai_visibility_nominated_source_events
       WHERE scope_id = $1 AND response_id = $2
       ORDER BY source_position NULLS LAST, id`,
      [scopeId, responseId],
    );
    return Object.freeze(result.rows.map(hydrateEvent));
  }

  async commitConfirmation(
    input: SourceNominationParseReviewConfirmationCommit,
  ): Promise<void> {
    assertCommitBindings(input.review, input.response, input.sourceEvents);
    if (input.review.status !== "confirmed") {
      throw new Error("NOMINATION_REVIEW_CONFIRMATION_STATUS_REQUIRED");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await updateTerminalReview(
        client,
        input.review,
        input.expectedReviewVersion,
      );
      for (const event of input.sourceEvents) {
        await client.query(...insertEventQuery(event));
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async commitRejection(
    input: SourceNominationParseReviewRejectionCommit,
  ): Promise<void> {
    assertCommitBindings(input.review, input.response, []);
    if (input.review.status !== "rejected") {
      throw new Error("NOMINATION_REVIEW_REJECTION_STATUS_REQUIRED");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await updateTerminalReview(
        client,
        input.review,
        input.expectedReviewVersion,
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

interface ReviewRow {
  readonly review_json: unknown;
  readonly version: number;
}

interface EventRow {
  readonly event_json: unknown;
}

const REVIEW_SELECT =
  "SELECT review_json, version FROM source_nomination_parse_reviews";

function hydrateReview(row: ReviewRow): SourceNominationParseReview {
  const review = structuredClone(
    row.review_json,
  ) as SourceNominationParseReview;
  if (review.version !== row.version) {
    throw new Error("NOMINATION_REVIEW_STORAGE_VERSION_MISMATCH");
  }
  assertSourceNominationParseReviewIntegrity(review);
  return freezeReview(review);
}

function hydrateEvent(row: EventRow): AiVisibilityNominatedSourceEvent {
  const event = structuredClone(
    row.event_json,
  ) as AiVisibilityNominatedSourceEvent;
  assertProjectedNominatedSourceEventIntegrity(event);
  return Object.freeze(event);
}

function freezeReview(
  review: SourceNominationParseReview,
): SourceNominationParseReview {
  return Object.freeze({
    ...structuredClone(review),
    proposedItems: Object.freeze(
      review.proposedItems.map((item) => Object.freeze({ ...item })),
    ),
  });
}

function insertReviewQuery(
  review: SourceNominationParseReview,
): [string, unknown[]] {
  return [
    `INSERT INTO source_nomination_parse_reviews
      (id, scope_id, response_id, status, review_json, version,
       created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [
      review.id,
      review.scopeId,
      review.responseId,
      review.status,
      JSON.stringify(review),
      review.version,
      review.createdAt,
      review.updatedAt,
    ],
  ];
}

function insertEventQuery(
  event: AiVisibilityNominatedSourceEvent,
): [string, unknown[]] {
  assertProjectedNominatedSourceEventIntegrity(event);
  return [
    `INSERT INTO ai_visibility_nominated_source_events
      (id, scope_id, run_id, response_id, query_snapshot_item_id,
       sample_index, source_key_hash, source_position, event_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      event.id,
      event.scopeId,
      event.runId,
      event.responseId,
      event.querySnapshotItemId,
      event.sampleIndex,
      event.sourceKeyHash,
      event.sourcePosition,
      JSON.stringify(event),
      event.createdAt,
    ],
  ];
}

async function updateTerminalReview(
  client: PoolClient,
  review: SourceNominationParseReview,
  expectedVersion: number,
): Promise<void> {
  assertSourceNominationParseReviewIntegrity(review);
  if (review.version !== expectedVersion + 1) {
    throw new Error("NOMINATION_REVIEW_VERSION_CONFLICT");
  }
  const updated = await client.query(
    `UPDATE source_nomination_parse_reviews
     SET status = $1, review_json = $2::jsonb, version = $3, updated_at = $4
     WHERE scope_id = $5 AND id = $6 AND version = $7
       AND status = 'needs_review'`,
    [
      review.status,
      JSON.stringify(review),
      review.version,
      review.updatedAt,
      review.scopeId,
      review.id,
      expectedVersion,
    ],
  );
  if (updated.rowCount !== 1) {
    throw new Error("NOMINATION_REVIEW_VERSION_CONFLICT");
  }
}

function assertCommitBindings(
  review: SourceNominationParseReview,
  response: SourceNominationParseReviewConfirmationCommit["response"],
  events: readonly AiVisibilityNominatedSourceEvent[],
): void {
  assertSourceNominationParseReviewIntegrity(review);
  if (
    review.scopeId !== response.scopeId ||
    review.responseId !== response.id
  ) {
    throw new Error("SOURCE_NOMINATION_CONFIRMATION_BINDING_MISMATCH");
  }
  for (const event of events) {
    assertProjectedNominatedSourceEventIntegrity(event);
    if (
      event.scopeId !== response.scopeId ||
      event.responseId !== response.id ||
      event.runId !== response.runId ||
      event.querySnapshotItemId !== response.querySnapshotItemId ||
      event.sampleIndex !== response.sampleIndex
    ) {
      throw new Error("SOURCE_NOMINATION_EVENT_BINDING_MISMATCH");
    }
  }
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}
