import {
  assertConfirmedConsumerObservationRecordIntegrity,
  summarizeConsumerObservationRunTasks,
} from "@wentian/domain";
import type {
  AiVisibilityCitedSourceEventRepository,
  CaptureTokenNonceRepository,
  CaptureTokenVerifier,
  ConfirmedConsumerObservationRecordRepository,
  ConsumerCaptureArtifactBindingRepository,
  ConsumerObservationMetricSampleBatch,
  ConsumerObservationMetricSampleBatchRepository,
  ConsumerObservationConfirmationTransactionRepository,
  ConsumerObservationRunRepository,
  ConsumerObservationTaskRepository,
  ConsumerSurfaceProfileVersionRepository,
  QuerySetSnapshotRepository,
  ScopeRepository,
} from "@wentian/application";
import type {
  AiVisibilityCitedSourceEvent,
  CaptureTokenClaims,
  ConfirmedConsumerObservationRecord,
  ConsumerCaptureArtifact,
  ConsumerObservationTask,
  ConsumerObservationRun,
  ConsumerSurfaceProfileVersion,
  QuerySetSnapshot,
  Scope,
} from "@wentian/domain";

import { assertProjectedCitedSourceEventIntegrity } from "./confirmed-consumer-observation-source-event-projection.ts";
import { normalizeSourceUrl } from "./source-url-normalization.ts";

export class InMemoryAiVisibilityCitedSourceEventRepository implements AiVisibilityCitedSourceEventRepository {
  private readonly events = new Map<string, AiVisibilityCitedSourceEvent>();
  private readonly eventIdByUniqueKey = new Map<string, string>();

  async createMany(
    events: readonly AiVisibilityCitedSourceEvent[],
  ): Promise<void> {
    const newIds = new Set<string>();
    const newKeys = new Set<string>();
    for (const event of events) {
      assertProjectedCitedSourceEventIntegrity(event);
      const uniqueKey = citedSourceEventUniqueKey(event);
      if (
        newIds.has(event.id) ||
        newKeys.has(uniqueKey) ||
        this.events.has(event.id) ||
        this.eventIdByUniqueKey.has(uniqueKey)
      ) {
        throw new Error("AI_VISIBILITY_SOURCE_EVENT_CONFLICT");
      }
      newIds.add(event.id);
      newKeys.add(uniqueKey);
    }
    for (const event of events) {
      this.events.set(event.id, event);
      this.eventIdByUniqueKey.set(citedSourceEventUniqueKey(event), event.id);
    }
  }

  async listByResponse(
    scopeId: string,
    responseId: string,
  ): Promise<readonly AiVisibilityCitedSourceEvent[]> {
    return [...this.events.values()]
      .filter(
        (event) => event.scopeId === scopeId && event.responseId === responseId,
      )
      .sort(
        (left, right) =>
          left.sourcePosition - right.sourcePosition ||
          left.id.localeCompare(right.id),
      );
  }
}

export class InMemoryConfirmedConsumerObservationRecordRepository implements ConfirmedConsumerObservationRecordRepository {
  private readonly records = new Map<
    string,
    ConfirmedConsumerObservationRecord
  >();
  private readonly recordIdByTaskId = new Map<string, string>();
  private readonly recordIdByRunSlot = new Map<string, string>();

  async create(record: ConfirmedConsumerObservationRecord): Promise<void> {
    assertConfirmedConsumerObservationRecordIntegrity(record);
    const runSlot = confirmedRecordRunSlot(record);
    if (
      this.records.has(record.id) ||
      this.recordIdByTaskId.has(record.observationTaskId) ||
      this.recordIdByRunSlot.has(runSlot)
    ) {
      throw new Error("CONFIRMED_CONSUMER_OBSERVATION_RECORD_CONFLICT");
    }
    this.records.set(record.id, record);
    this.recordIdByTaskId.set(record.observationTaskId, record.id);
    this.recordIdByRunSlot.set(runSlot, record.id);
  }

  async findRecordById(
    scopeId: string,
    recordId: string,
  ): Promise<ConfirmedConsumerObservationRecord | null> {
    const record = this.records.get(recordId);
    return record?.scopeId === scopeId ? record : null;
  }

  async listByRun(
    scopeId: string,
    runId: string,
  ): Promise<readonly ConfirmedConsumerObservationRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.scopeId === scopeId && record.runId === runId)
      .sort(
        (left, right) =>
          left.querySnapshotItemId.localeCompare(right.querySnapshotItemId) ||
          left.sampleIndex - right.sampleIndex,
      );
  }

  async listSampleReferencesByRun(scopeId: string, runId: string) {
    return this.listByRun(scopeId, runId);
  }
}

export class InMemoryConsumerSurfaceProfileVersionRepository implements ConsumerSurfaceProfileVersionRepository {
  private readonly profilesById = new Map<
    string,
    ConsumerSurfaceProfileVersion
  >();
  private readonly activeProfilesByCode = new Map<
    string,
    ConsumerSurfaceProfileVersion
  >();

  constructor(profiles: readonly ConsumerSurfaceProfileVersion[] = []) {
    for (const profile of profiles) {
      if (this.profilesById.has(profile.id)) {
        throw new Error("CONSUMER_SURFACE_PROFILE_ID_CONFLICT");
      }
      this.profilesById.set(profile.id, profile);
      if (profile.status !== "active") {
        continue;
      }
      if (this.activeProfilesByCode.has(profile.surfaceCode)) {
        throw new Error("ACTIVE_CONSUMER_SURFACE_PROFILE_CONFLICT");
      }
      this.activeProfilesByCode.set(profile.surfaceCode, profile);
    }
  }

  async findById(
    surfaceProfileVersionId: string,
  ): Promise<ConsumerSurfaceProfileVersion | null> {
    return this.profilesById.get(surfaceProfileVersionId) ?? null;
  }

  async findActiveBySurfaceCode(
    surfaceCode: string,
  ): Promise<ConsumerSurfaceProfileVersion | null> {
    return this.activeProfilesByCode.get(surfaceCode) ?? null;
  }
}

export class InMemoryConsumerObservationRunRepository
  implements
    ConsumerObservationRunRepository,
    ConsumerObservationTaskRepository,
    ConfirmedConsumerObservationRecordRepository,
    AiVisibilityCitedSourceEventRepository,
    ConsumerObservationConfirmationTransactionRepository
{
  private readonly runs = new Map<string, ConsumerObservationRun>();
  private readonly tasks = new Map<string, ConsumerObservationTask>();
  private readonly confirmedRecords = new Map<
    string,
    ConfirmedConsumerObservationRecord
  >();
  private readonly confirmedRecordIdByTaskId = new Map<string, string>();
  private readonly confirmedRecordIdByRunSlot = new Map<string, string>();
  private readonly sourceEvents = new Map<
    string,
    AiVisibilityCitedSourceEvent
  >();
  private readonly sourceEventIdByUniqueKey = new Map<string, string>();

  async findRunById(
    scopeId: string,
    runId: string,
  ): Promise<ConsumerObservationRun | null> {
    const run = this.runs.get(runId);
    return run?.scopeId === scopeId ? run : null;
  }

  async createWithTasks(
    run: ConsumerObservationRun,
    snapshot: QuerySetSnapshot,
    tasks: readonly ConsumerObservationTask[],
  ): Promise<void> {
    if (this.runs.has(run.id)) {
      throw new Error("CONSUMER_OBSERVATION_RUN_ID_CONFLICT");
    }
    const taskIds = new Set<string>();
    for (const task of tasks) {
      if (taskIds.has(task.id) || this.tasks.has(task.id)) {
        throw new Error("OBSERVATION_TASK_ID_CONFLICT");
      }
      taskIds.add(task.id);
    }
    summarizeConsumerObservationRunTasks(run, snapshot, tasks);

    this.runs.set(run.id, run);
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }
  }

  async listTasksForRun(
    scopeId: string,
    runId: string,
  ): Promise<readonly ConsumerObservationTask[]> {
    return [...this.tasks.values()]
      .filter((task) => task.scopeId === scopeId && task.runId === runId)
      .sort(
        (left, right) =>
          left.querySnapshotItemId.localeCompare(right.querySnapshotItemId) ||
          left.sampleIndex - right.sampleIndex,
      );
  }

  async saveRun(
    run: ConsumerObservationRun,
    expectedVersion: number,
  ): Promise<ConsumerObservationRun> {
    const current = this.runs.get(run.id);
    if (!current || current.scopeId !== run.scopeId) {
      throw new Error("CONSUMER_OBSERVATION_RUN_NOT_FOUND");
    }
    if (
      current.version !== expectedVersion ||
      run.version !== expectedVersion + 1
    ) {
      throw new Error("CONSUMER_OBSERVATION_RUN_VERSION_CONFLICT");
    }
    this.runs.set(run.id, run);
    return run;
  }

  async findById(
    scopeId: string,
    taskId: string,
  ): Promise<ConsumerObservationTask | null> {
    const task = this.tasks.get(taskId);
    return task?.scopeId === scopeId ? task : null;
  }

  async save(
    task: ConsumerObservationTask,
    expectedVersion: number,
  ): Promise<ConsumerObservationTask> {
    const current = this.tasks.get(task.id);
    if (!current || current.scopeId !== task.scopeId) {
      throw new Error("OBSERVATION_TASK_NOT_FOUND");
    }
    if (
      current.version !== expectedVersion ||
      task.version !== expectedVersion + 1
    ) {
      throw new Error("OBSERVATION_TASK_VERSION_CONFLICT");
    }
    this.tasks.set(task.id, task);
    return task;
  }

  async create(record: ConfirmedConsumerObservationRecord): Promise<void> {
    assertNewConfirmedRecord(
      record,
      this.confirmedRecords,
      this.confirmedRecordIdByTaskId,
      this.confirmedRecordIdByRunSlot,
    );
    this.storeConfirmedRecord(record);
  }

  async findRecordById(
    scopeId: string,
    recordId: string,
  ): Promise<ConfirmedConsumerObservationRecord | null> {
    const record = this.confirmedRecords.get(recordId);
    return record?.scopeId === scopeId ? record : null;
  }

  async listByRun(
    scopeId: string,
    runId: string,
  ): Promise<readonly ConfirmedConsumerObservationRecord[]> {
    return [...this.confirmedRecords.values()]
      .filter((record) => record.scopeId === scopeId && record.runId === runId)
      .sort(
        (left, right) =>
          left.querySnapshotItemId.localeCompare(right.querySnapshotItemId) ||
          left.sampleIndex - right.sampleIndex,
      );
  }

  async createMany(
    events: readonly AiVisibilityCitedSourceEvent[],
  ): Promise<void> {
    assertNewCitedSourceEvents(
      events,
      this.sourceEvents,
      this.sourceEventIdByUniqueKey,
    );
    this.storeSourceEvents(events);
  }

  async listByResponse(
    scopeId: string,
    responseId: string,
  ): Promise<readonly AiVisibilityCitedSourceEvent[]> {
    return [...this.sourceEvents.values()]
      .filter(
        (event) => event.scopeId === scopeId && event.responseId === responseId,
      )
      .sort(
        (left, right) =>
          left.sourcePosition - right.sourcePosition ||
          left.id.localeCompare(right.id),
      );
  }

  async commitConfirmation(input: {
    readonly task: ConsumerObservationTask;
    readonly expectedTaskVersion: number;
    readonly record: ConfirmedConsumerObservationRecord;
    readonly sourceEvents: readonly AiVisibilityCitedSourceEvent[];
  }): Promise<void> {
    const current = this.tasks.get(input.task.id);
    if (!current || current.scopeId !== input.task.scopeId) {
      throw new Error("OBSERVATION_TASK_NOT_FOUND");
    }
    if (
      current.version !== input.expectedTaskVersion ||
      input.task.version !== input.expectedTaskVersion + 1
    ) {
      throw new Error("OBSERVATION_TASK_VERSION_CONFLICT");
    }
    if (current.status !== "needs_review") {
      throw new Error("OBSERVATION_TASK_NOT_READY_FOR_CONFIRMATION");
    }
    const run = this.runs.get(input.task.runId);
    if (
      !run ||
      run.scopeId !== input.task.scopeId ||
      run.surfaceProfileVersionId !== input.task.surfaceProfileVersionId ||
      run.collectionMethod !== input.task.collectionMethod
    ) {
      throw new Error("CONSUMER_OBSERVATION_CONFIRMATION_RUN_MISMATCH");
    }
    assertConfirmationCommitBindings(
      input.task,
      input.record,
      input.sourceEvents,
      run.experimentKind,
    );
    assertNewConfirmedRecord(
      input.record,
      this.confirmedRecords,
      this.confirmedRecordIdByTaskId,
      this.confirmedRecordIdByRunSlot,
    );
    assertNewCitedSourceEvents(
      input.sourceEvents,
      this.sourceEvents,
      this.sourceEventIdByUniqueKey,
    );

    this.tasks.set(input.task.id, input.task);
    this.storeConfirmedRecord(input.record);
    this.storeSourceEvents(input.sourceEvents);
  }

  private storeConfirmedRecord(
    record: ConfirmedConsumerObservationRecord,
  ): void {
    this.confirmedRecords.set(record.id, record);
    this.confirmedRecordIdByTaskId.set(record.observationTaskId, record.id);
    this.confirmedRecordIdByRunSlot.set(
      confirmedRecordRunSlot(record),
      record.id,
    );
  }

  private storeSourceEvents(
    events: readonly AiVisibilityCitedSourceEvent[],
  ): void {
    for (const event of events) {
      this.sourceEvents.set(event.id, event);
      this.sourceEventIdByUniqueKey.set(
        citedSourceEventUniqueKey(event),
        event.id,
      );
    }
  }
}

export class InMemoryConsumerObservationMetricSampleBatchRepository implements ConsumerObservationMetricSampleBatchRepository {
  private readonly batches = new Map<
    string,
    ConsumerObservationMetricSampleBatch
  >();

  constructor(batches: readonly ConsumerObservationMetricSampleBatch[] = []) {
    for (const batch of batches) {
      const key = metricBatchKey(batch.scopeId, batch.runId);
      if (this.batches.has(key)) {
        throw new Error("CONSUMER_OBSERVATION_METRIC_BATCH_CONFLICT");
      }
      this.batches.set(key, batch);
    }
  }

  async findByScopeAndRunId(
    scopeId: string,
    runId: string,
  ): Promise<ConsumerObservationMetricSampleBatch | null> {
    return this.batches.get(metricBatchKey(scopeId, runId)) ?? null;
  }
}

export class InMemoryScopeRepository implements ScopeRepository {
  private readonly scopes = new Map<string, Scope>();

  constructor(scopes: readonly Scope[] = []) {
    for (const scope of scopes) {
      this.scopes.set(scope.id, scope);
    }
  }

  async findById(scopeId: string): Promise<Scope | null> {
    return this.scopes.get(scopeId) ?? null;
  }

  async listByIds(scopeIds: readonly string[]): Promise<readonly Scope[]> {
    return scopeIds.flatMap((scopeId) => {
      const scope = this.scopes.get(scopeId);
      return scope ? [scope] : [];
    });
  }
}

export class InMemoryQuerySetSnapshotRepository implements QuerySetSnapshotRepository {
  private readonly snapshotsById = new Map<string, QuerySetSnapshot>();
  private readonly snapshotIdByScopeAndHash = new Map<string, string>();

  async findById(
    scopeId: string,
    snapshotId: string,
  ): Promise<QuerySetSnapshot | null> {
    const snapshot = this.snapshotsById.get(snapshotId);
    return snapshot?.scopeId === scopeId ? snapshot : null;
  }

  async getOrCreate(snapshot: QuerySetSnapshot): Promise<{
    readonly snapshot: QuerySetSnapshot;
    readonly created: boolean;
  }> {
    const idempotencyKey = `${snapshot.scopeId}:${snapshot.snapshotHash}`;
    const existingId = this.snapshotIdByScopeAndHash.get(idempotencyKey);
    if (existingId) {
      return {
        snapshot: this.snapshotsById.get(existingId)!,
        created: false,
      };
    }

    if (this.snapshotsById.has(snapshot.id)) {
      throw new Error("SNAPSHOT_ID_CONFLICT");
    }

    this.snapshotsById.set(snapshot.id, snapshot);
    this.snapshotIdByScopeAndHash.set(idempotencyKey, snapshot.id);
    return { snapshot, created: true };
  }
}

export class InMemoryConsumerObservationTaskRepository implements ConsumerObservationTaskRepository {
  private readonly tasks = new Map<string, ConsumerObservationTask>();

  constructor(tasks: readonly ConsumerObservationTask[] = []) {
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }
  }

  async findById(
    scopeId: string,
    taskId: string,
  ): Promise<ConsumerObservationTask | null> {
    const task = this.tasks.get(taskId);
    return task?.scopeId === scopeId ? task : null;
  }

  async save(
    task: ConsumerObservationTask,
    expectedVersion: number,
  ): Promise<ConsumerObservationTask> {
    const current = this.tasks.get(task.id);
    if (!current || current.scopeId !== task.scopeId) {
      throw new Error("OBSERVATION_TASK_NOT_FOUND");
    }
    if (
      current.version !== expectedVersion ||
      task.version !== expectedVersion + 1
    ) {
      throw new Error("OBSERVATION_TASK_VERSION_CONFLICT");
    }
    this.tasks.set(task.id, task);
    return task;
  }
}

export class InMemoryCaptureTokenNonceRepository implements CaptureTokenNonceRepository {
  private readonly consumedNonces = new Set<string>();

  async consumeOnce(nonce: string): Promise<boolean> {
    if (this.consumedNonces.has(nonce)) {
      return false;
    }
    this.consumedNonces.add(nonce);
    return true;
  }
}

export class InMemoryCaptureTokenVerifier implements CaptureTokenVerifier {
  private readonly claimsByToken = new Map<string, CaptureTokenClaims>();

  constructor(
    entries: readonly (readonly [string, CaptureTokenClaims])[] = [],
  ) {
    for (const [token, claims] of entries) {
      this.claimsByToken.set(token, claims);
    }
  }

  async verify(token: string): Promise<CaptureTokenClaims> {
    const claims = this.claimsByToken.get(token);
    if (!claims) {
      throw new Error("CAPTURE_TOKEN_INVALID");
    }
    return claims;
  }
}

export class InMemoryConsumerCaptureArtifactBindingRepository implements ConsumerCaptureArtifactBindingRepository {
  private readonly artifacts = new Map<string, ConsumerCaptureArtifact>();
  private readonly artifactIdByTaskId = new Map<string, string>();

  async create(artifact: ConsumerCaptureArtifact): Promise<void> {
    if (
      this.artifacts.has(artifact.id) ||
      this.artifactIdByTaskId.has(artifact.observationTaskId)
    ) {
      throw new Error("CAPTURE_ARTIFACT_ALREADY_EXISTS");
    }
    this.artifacts.set(artifact.id, artifact);
    this.artifactIdByTaskId.set(artifact.observationTaskId, artifact.id);
  }

  async findById(
    scopeId: string,
    artifactId: string,
  ): Promise<ConsumerCaptureArtifact | null> {
    const artifact = this.artifacts.get(artifactId);
    return artifact?.scopeId === scopeId ? artifact : null;
  }

  async purge(scopeId: string, artifactId: string): Promise<boolean> {
    const artifact = await this.findById(scopeId, artifactId);
    if (!artifact) {
      return false;
    }
    this.artifacts.delete(artifactId);
    this.artifactIdByTaskId.delete(artifact.observationTaskId);
    return true;
  }
}

function metricBatchKey(scopeId: string, runId: string): string {
  return JSON.stringify([scopeId, runId]);
}

function confirmedRecordRunSlot(
  record: ConfirmedConsumerObservationRecord,
): string {
  return JSON.stringify([
    record.scopeId,
    record.runId,
    record.querySnapshotItemId,
    record.sampleIndex,
  ]);
}

function citedSourceEventUniqueKey(
  event: AiVisibilityCitedSourceEvent,
): string {
  return JSON.stringify([
    event.scopeId,
    event.responseId,
    event.role,
    event.sourceKeyHash,
    event.sourcePosition,
  ]);
}

function assertNewConfirmedRecord(
  record: ConfirmedConsumerObservationRecord,
  records: ReadonlyMap<string, ConfirmedConsumerObservationRecord>,
  recordIdByTaskId: ReadonlyMap<string, string>,
  recordIdByRunSlot: ReadonlyMap<string, string>,
): void {
  assertConfirmedConsumerObservationRecordIntegrity(record);
  if (
    records.has(record.id) ||
    recordIdByTaskId.has(record.observationTaskId) ||
    recordIdByRunSlot.has(confirmedRecordRunSlot(record))
  ) {
    throw new Error("CONFIRMED_CONSUMER_OBSERVATION_RECORD_CONFLICT");
  }
}

function assertNewCitedSourceEvents(
  events: readonly AiVisibilityCitedSourceEvent[],
  storedEvents: ReadonlyMap<string, AiVisibilityCitedSourceEvent>,
  storedEventIdByUniqueKey: ReadonlyMap<string, string>,
): void {
  const newIds = new Set<string>();
  const newKeys = new Set<string>();
  for (const event of events) {
    assertProjectedCitedSourceEventIntegrity(event);
    const uniqueKey = citedSourceEventUniqueKey(event);
    if (
      newIds.has(event.id) ||
      newKeys.has(uniqueKey) ||
      storedEvents.has(event.id) ||
      storedEventIdByUniqueKey.has(uniqueKey)
    ) {
      throw new Error("AI_VISIBILITY_SOURCE_EVENT_CONFLICT");
    }
    newIds.add(event.id);
    newKeys.add(uniqueKey);
  }
}

function assertConfirmationCommitBindings(
  task: ConsumerObservationTask,
  record: ConfirmedConsumerObservationRecord,
  sourceEvents: readonly AiVisibilityCitedSourceEvent[],
  experimentKind: "natural_answer" | "source_nomination",
): void {
  if (
    task.status !== "confirmed" ||
    !task.captureArtifactId ||
    !task.confirmedResponseId ||
    !task.confirmedAt ||
    record.id !== task.confirmedResponseId ||
    record.scopeId !== task.scopeId ||
    record.runId !== task.runId ||
    record.querySnapshotItemId !== task.querySnapshotItemId ||
    record.sampleIndex !== task.sampleIndex ||
    record.observationTaskId !== task.id ||
    record.captureArtifactId !== task.captureArtifactId ||
    record.surfaceProfileVersionId !== task.surfaceProfileVersionId ||
    record.collectionMethod !== task.collectionMethod ||
    record.confirmedBy !== task.assignedTo ||
    record.confirmedAt !== task.confirmedAt
  ) {
    throw new Error("CONSUMER_OBSERVATION_CONFIRMATION_BINDING_MISMATCH");
  }

  if (experimentKind === "source_nomination") {
    if (sourceEvents.length !== 0) {
      throw new Error("SOURCE_NOMINATION_CITED_EVENTS_FORBIDDEN");
    }
    return;
  }

  const expectedCitations = new Map(
    record.visibleCitations.flatMap((citation) => {
      const normalized = normalizeSourceUrl(citation.url);
      return normalized.status === "normalized"
        ? [[citation.position, citation] as const]
        : [];
    }),
  );
  if (sourceEvents.length !== expectedCitations.size) {
    throw new Error("CONSUMER_OBSERVATION_SOURCE_EVENT_SET_MISMATCH");
  }
  const actualPositions = new Set<number>();
  for (const event of sourceEvents) {
    const citation = expectedCitations.get(event.sourcePosition);
    if (
      !citation ||
      actualPositions.has(event.sourcePosition) ||
      event.scopeId !== record.scopeId ||
      event.runId !== record.runId ||
      event.responseId !== record.id ||
      event.querySnapshotItemId !== record.querySnapshotItemId ||
      event.sampleIndex !== record.sampleIndex ||
      event.originalUrl !== citation.url ||
      event.title !== citation.label ||
      event.createdAt !== record.confirmedAt
    ) {
      throw new Error("CONSUMER_OBSERVATION_SOURCE_EVENT_BINDING_MISMATCH");
    }
    actualPositions.add(event.sourcePosition);
  }
}
