import {
  FenceLostError,
  GrantNotConsumableError,
  UniqueConstraintError,
  type OrchestrationStore,
  type OrchestrationTx,
  type ClaimedWork,
  type AssuranceRun,
  type EventInput,
  type FindingRecord,
  type Grant,
  type ObservationRecord,
  type PersistFindingInput,
  type PersistObservationInput,
  type ProfileVersion,
  type RunStep,
} from '@grounds/application';
import {
  ERROR_MESSAGES,
  MAX_STEP_ATTEMPTS,
  REDACTION_VERSION,
  assertJsonValue,
  backoffSeconds,
  boundPayload,
  contentIdentity,
  errorMessageFor,
  isErrorClass,
  isJsonObject,
  isRunState,
  isStepState,
  parseEvidenceWindow,
  parseResourceRef,
  requestDigest,
  type ErrorClass,
  type JsonObject,
  type StepType,
} from '@grounds/domain';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

const { DatabaseError } = pg;

function asIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function requiredIso(value: Date | string | null): string {
  const iso = asIso(value);
  if (!iso) {
    throw new Error('expected timestamp');
  }
  return iso;
}

function asJsonObject(value: unknown): JsonObject {
  const json = assertJsonValue(value);
  if (!isJsonObject(json)) {
    throw new Error('expected JSON object');
  }
  return json;
}

function detectorVersionsFrom(value: unknown): { readonly [id: string]: string } {
  const object = asJsonObject(value);
  const out: { [id: string]: string } = {};
  for (const [key, nested] of Object.entries(object)) {
    if (typeof nested !== 'string') {
      throw new Error('detector version must be a string');
    }
    out[key] = nested;
  }
  return out;
}

function requireSingleUpdate(rowCount: number | null): void {
  if (rowCount !== 1) {
    throw new FenceLostError();
  }
}

function mapProfile(row: QueryResultRow): ProfileVersion {
  const freshness = asJsonObject(row['freshness_policy']);
  const freshnessMaxAgeSeconds = freshness['freshnessMaxAgeSeconds'];
  if (typeof freshnessMaxAgeSeconds !== 'number') {
    throw new Error('freshnessMaxAgeSeconds missing');
  }
  return {
    id: String(row['id']),
    organisationId: String(row['organisation_id']),
    profileId: String(row['profile_id']),
    version: Number(row['version']),
    scope: parseResourceRef(row['scope']),
    detectorVersions: detectorVersionsFrom(row['detector_versions']),
    freshnessPolicy: { freshnessMaxAgeSeconds },
    detectorParameters: asJsonObject(row['detector_parameters']),
    contentDigest: String(row['content_digest']),
  };
}

function mapGrant(row: QueryResultRow): Grant {
  return {
    id: String(row['id']),
    organisationId: String(row['organisation_id']),
    actorId: String(row['actor_id']),
    profileVersionId: String(row['profile_version_id']),
    resourceScope: parseResourceRef(row['resource_scope']),
    resourceScopeDigest: String(row['resource_scope_digest']),
    evidenceWindow: parseEvidenceWindow({
      from: requiredIso(row['evidence_window_from'] as Date),
      to: requiredIso(row['evidence_window_to'] as Date),
    }),
    detectorVersions: detectorVersionsFrom(row['detector_versions']),
    grantedAt: requiredIso(row['granted_at'] as Date),
    expiresAt: requiredIso(row['expires_at'] as Date),
    consumedAt: asIso(row['consumed_at'] as Date | null),
    clientIdempotencyKey: String(row['client_idempotency_key']),
    requestDigest: String(row['request_digest']),
  };
}

function mapRun(row: QueryResultRow): AssuranceRun {
  const state = String(row['state']);
  if (!isRunState(state)) {
    throw new Error('invalid run state');
  }
  const result = row['result'] === null ? null : String(row['result']);
  if (result !== null && result !== 'PASS' && result !== 'FAIL' && result !== 'UNKNOWN') {
    throw new Error('invalid result');
  }
  return {
    id: String(row['id']),
    organisationId: String(row['organisation_id']),
    profileVersionId: String(row['profile_version_id']),
    authorisationGrantId: String(row['authorisation_grant_id']),
    resourceScope: parseResourceRef(row['resource_scope']),
    resourceScopeDigest: String(row['resource_scope_digest']),
    evidenceWindow: parseEvidenceWindow({
      from: requiredIso(row['evidence_window_from'] as Date),
      to: requiredIso(row['evidence_window_to'] as Date),
    }),
    detectorVersions: detectorVersionsFrom(row['detector_versions']),
    state,
    result,
    clientIdempotencyKey: String(row['client_idempotency_key']),
    requestDigest: String(row['request_digest']),
    runIdentityDigest: String(row['run_identity_digest']),
    cancelRequestedAt: asIso(row['cancel_requested_at'] as Date | null),
    collectorAttemptCount: Number(row['collector_attempt_count']),
    createdAt: requiredIso(row['created_at'] as Date),
    startedAt: asIso(row['started_at'] as Date | null),
    updatedAt: requiredIso(row['updated_at'] as Date),
    terminalAt: asIso(row['terminal_at'] as Date | null),
  };
}

function mapStep(row: QueryResultRow): RunStep {
  const state = String(row['state']);
  const stepType = String(row['step_type']);
  if (!isStepState(state) || (stepType !== 'collect' && stepType !== 'evaluate')) {
    throw new Error('invalid step');
  }
  const errorClassRaw = row['error_class'] === null ? null : String(row['error_class']);
  const errorClass =
    errorClassRaw === null ? null : isErrorClass(errorClassRaw) ? errorClassRaw : null;
  if (errorClassRaw !== null && errorClass === null) {
    throw new Error('invalid error class');
  }
  return {
    id: String(row['id']),
    runId: String(row['run_id']),
    stepType,
    state,
    attempt: Number(row['attempt']),
    nextAttemptAt: asIso(row['next_attempt_at'] as Date | null),
    leaseOwner: row['lease_owner'] === null ? null : String(row['lease_owner']),
    leaseExpiresAt: asIso(row['lease_expires_at'] as Date | null),
    leaseEpoch: Number(row['lease_epoch']),
    errorClass,
    errorMessage: row['error_message'] === null ? null : String(row['error_message']),
  };
}

function mapObservation(row: QueryResultRow): ObservationRecord {
  const freshness = String(row['freshness']);
  if (freshness !== 'FRESH' && freshness !== 'STALE') {
    throw new Error('invalid freshness');
  }
  return {
    id: String(row['id']),
    runId: String(row['run_id']),
    organisationId: String(row['organisation_id']),
    kind: String(row['kind']),
    resource: parseResourceRef(row['resource']),
    collectedAt: requiredIso(row['collected_at'] as Date),
    window: parseEvidenceWindow({
      from: requiredIso(row['window_from'] as Date),
      to: requiredIso(row['window_to'] as Date),
    }),
    sourceAdapter: String(row['source_adapter']),
    sourceOperation: String(row['source_operation']),
    requestDigest: String(row['request_digest']),
    freshness,
    payload: assertJsonValue(row['payload']),
    payloadDigest: String(row['payload_digest']),
    redactionVersion: String(row['redaction_version']),
    truncated: Boolean(row['truncated']),
    inaccessible: Boolean(row['inaccessible']),
    contentIdentity: String(row['content_identity']),
  };
}

export class PostgresOrchestrationStore implements OrchestrationStore {
  public constructor(private readonly pool: Pool) {}

  public async withTransaction<T>(fn: (tx: OrchestrationTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PostgresTx(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async getRun(runId: string): Promise<AssuranceRun | undefined> {
    const result = await this.pool.query(`SELECT * FROM assurance_runs WHERE id = $1`, [runId]);
    return result.rows[0] ? mapRun(result.rows[0]) : undefined;
  }

  public async getRunByClientKey(clientIdempotencyKey: string): Promise<AssuranceRun | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM assurance_runs WHERE client_idempotency_key = $1`,
      [clientIdempotencyKey],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : undefined;
  }

  public async listObservations(runId: string): Promise<readonly ObservationRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM observations WHERE run_id = $1 ORDER BY created_at`,
      [runId],
    );
    return result.rows.map(mapObservation);
  }

  public async listFindings(runId: string): Promise<readonly FindingRecord[]> {
    const findings = await this.pool.query(`SELECT * FROM findings WHERE run_id = $1`, [runId]);
    const citations = await this.pool.query(
      `SELECT finding_id, observation_id FROM finding_citations WHERE run_id = $1`,
      [runId],
    );
    return findings.rows.map((row) => {
      const observationIds = citations.rows
        .filter((citation) => String(citation['finding_id']) === String(row['id']))
        .map((citation) => String(citation['observation_id']));
      return {
        id: String(row['id']),
        runId: String(row['run_id']),
        detectorId: String(row['detector_id']),
        detectorVersion: String(row['detector_version']),
        profileVersionId: String(row['profile_version_id']),
        resource: parseResourceRef(row['resource']),
        result: String(row['result']) as FindingRecord['result'],
        severity: String(row['severity']),
        title: String(row['title']),
        explanation: String(row['explanation']),
        fingerprint: String(row['fingerprint']),
        citationCount: Number(row['citation_count']),
        observationIds,
      };
    });
  }

  public async listEvents(aggregateType: string, aggregateId: string) {
    const result = await this.pool.query<{ sequence: string; type: string; operation_id: string }>(
      `SELECT sequence, type, operation_id FROM events WHERE aggregate_type = $1 AND aggregate_id = $2 ORDER BY sequence`,
      [aggregateType, aggregateId],
    );
    return result.rows.map((row) => ({
      sequence: Number(row.sequence),
      type: row.type,
      operationId: row.operation_id,
    }));
  }

  public async getGrant(grantId: string): Promise<Grant | undefined> {
    const result = await this.pool.query(`SELECT * FROM authorisation_grants WHERE id = $1`, [
      grantId,
    ]);
    return result.rows[0] ? mapGrant(result.rows[0]) : undefined;
  }

  public async getGrantByClientKey(clientIdempotencyKey: string): Promise<Grant | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM authorisation_grants WHERE client_idempotency_key = $1`,
      [clientIdempotencyKey],
    );
    return result.rows[0] ? mapGrant(result.rows[0]) : undefined;
  }

  public async getProfile(profileVersionId: string): Promise<ProfileVersion | undefined> {
    const result = await this.pool.query(`SELECT * FROM profile_versions WHERE id = $1`, [
      profileVersionId,
    ]);
    return result.rows[0] ? mapProfile(result.rows[0]) : undefined;
  }

  public async getStep(runId: string, stepType: StepType): Promise<RunStep | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM run_steps WHERE run_id = $1 AND step_type = $2`,
      [runId, stepType],
    );
    return result.rows[0] ? mapStep(result.rows[0]) : undefined;
  }

  public async outboxLag(): Promise<number> {
    const result = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM outbox WHERE processed_at IS NULL`,
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  public async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

class PostgresTx implements OrchestrationTx {
  public constructor(private readonly client: PoolClient) {}

  public async consumeGrant(grantId: string): Promise<Grant> {
    const result = await this.client.query(
      `UPDATE authorisation_grants
       SET consumed_at = now()
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING *`,
      [grantId],
    );
    if (!result.rows[0]) {
      throw new GrantNotConsumableError();
    }
    return mapGrant(result.rows[0]);
  }

  public async insertRun(run: AssuranceRun): Promise<AssuranceRun> {
    try {
      const result = await this.client.query(
        `INSERT INTO assurance_runs (
           id, organisation_id, profile_version_id, authorisation_grant_id,
           resource_scope, resource_scope_digest, evidence_window_from, evidence_window_to,
           detector_versions, state, result, client_idempotency_key, request_digest,
           run_identity_digest, cancel_requested_at, collector_attempt_count
         ) VALUES (
           $1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,'queued',NULL,$10,$11,$12,NULL,0
         ) RETURNING *`,
        [
          run.id,
          run.organisationId,
          run.profileVersionId,
          run.authorisationGrantId,
          JSON.stringify(run.resourceScope),
          run.resourceScopeDigest,
          run.evidenceWindow.from,
          run.evidenceWindow.to,
          JSON.stringify(run.detectorVersions),
          run.clientIdempotencyKey,
          run.requestDigest,
          run.runIdentityDigest,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('run insert returned no row');
      }
      return mapRun(row);
    } catch (error) {
      if (error instanceof DatabaseError && error.code === '23505') {
        throw new UniqueConstraintError();
      }
      throw error;
    }
  }

  public async insertSteps(runId: string, collectId: string, evaluateId: string): Promise<void> {
    await this.client.query(
      `INSERT INTO run_steps (id, run_id, step_type, state, attempt, lease_epoch)
       VALUES ($1,$2,'collect','ready',0,0), ($3,$2,'evaluate','blocked',0,0)`,
      [collectId, runId, evaluateId],
    );
  }

  public async lockRun(runId: string): Promise<AssuranceRun> {
    const result = await this.client.query(
      `SELECT * FROM assurance_runs WHERE id = $1 FOR UPDATE`,
      [runId],
    );
    if (!result.rows[0]) {
      throw new Error('run not found');
    }
    return mapRun(result.rows[0]);
  }

  public async lockStep(stepId: string): Promise<RunStep> {
    const result = await this.client.query(`SELECT * FROM run_steps WHERE id = $1 FOR UPDATE`, [
      stepId,
    ]);
    if (!result.rows[0]) {
      throw new Error('step not found');
    }
    return mapStep(result.rows[0]);
  }

  public async appendEvent(
    event: EventInput,
  ): Promise<{ readonly inserted: boolean; readonly sequence: number }> {
    const existing = await this.client.query<{ sequence: string }>(
      `SELECT sequence FROM events
       WHERE aggregate_type = $1 AND aggregate_id = $2 AND type = $3 AND operation_id = $4`,
      [event.aggregateType, event.aggregateId, event.type, event.operationId],
    );
    if (existing.rows[0]) {
      return { inserted: false, sequence: Number(existing.rows[0].sequence) };
    }
    const inserted = await this.client.query<{ sequence: string }>(
      `INSERT INTO events (id, aggregate_type, aggregate_id, sequence, type, operation_id, payload, actor_id)
       VALUES (
         $7, $1, $2,
         (SELECT COALESCE(MAX(sequence), 0) + 1 FROM events WHERE aggregate_type = $1 AND aggregate_id = $2),
         $3, $4, $5::jsonb, $6
       )
       RETURNING sequence`,
      [
        event.aggregateType,
        event.aggregateId,
        event.type,
        event.operationId,
        JSON.stringify(event.payload),
        event.actorId,
        randomUUID(),
      ],
    );
    const sequence = inserted.rows[0]?.sequence;
    if (!sequence) {
      throw new Error('event insert failed');
    }
    return { inserted: true, sequence: Number(sequence) };
  }

  public async claimWork(
    workerId: string,
    leaseTtlSeconds: number,
  ): Promise<ClaimedWork | undefined> {
    const candidate = await this.client.query(
      `SELECT r.id AS run_id, s.id AS step_id
       FROM assurance_runs r
       INNER JOIN run_steps s ON s.run_id = r.id
       WHERE (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
         AND (
           (s.step_type = 'collect' AND r.state IN ('queued', 'collecting') AND r.cancel_requested_at IS NULL)
           OR (s.step_type = 'evaluate' AND r.state = 'evaluating')
         )
         AND (
           s.state = 'ready'
           OR (s.state = 'leased' AND s.lease_expires_at < now())
         )
       ORDER BY r.created_at ASC, CASE s.step_type WHEN 'collect' THEN 0 ELSE 1 END
       FOR UPDATE OF r SKIP LOCKED
       LIMIT 1`,
    );
    const picked = candidate.rows[0] as { run_id: string; step_id: string } | undefined;
    if (!picked) {
      return undefined;
    }
    const run = await this.lockRun(picked.run_id);
    const collect = await this.lockNamedStep(run.id, 'collect');
    const evaluate = await this.lockNamedStep(run.id, 'evaluate');
    const step = collect.id === picked.step_id ? collect : evaluate;
    if (step.attempt >= MAX_STEP_ATTEMPTS) {
      await this.exhaust(run, step);
      return {
        run: await this.lockRun(run.id),
        step: await this.lockStep(step.id),
        recovered: false,
        exhausted: true,
      };
    }
    const recovered = step.state === 'leased';
    if (run.state === 'queued' && step.stepType === 'collect') {
      await this.client.query(
        `UPDATE assurance_runs
         SET state = 'collecting', started_at = now(), updated_at = now()
         WHERE id = $1 AND state = 'queued'`,
        [run.id],
      );
    }
    const leased = await this.client.query(
      `UPDATE run_steps
       SET state = 'leased',
           attempt = attempt + 1,
           lease_epoch = lease_epoch + 1,
           lease_owner = $2,
           lease_expires_at = now() + make_interval(secs => $3),
           next_attempt_at = NULL,
           error_class = NULL,
           error_message = NULL,
           updated_at = now()
       WHERE id = $1 AND attempt < $4
       RETURNING *`,
      [step.id, workerId, leaseTtlSeconds, MAX_STEP_ATTEMPTS],
    );
    if (!leased.rows[0]) {
      return undefined;
    }
    const nextStep = mapStep(leased.rows[0]);
    const nextRun = await this.lockRun(run.id);
    await this.appendEvent({
      aggregateType: 'assurance_run',
      aggregateId: run.id,
      type: recovered ? 'step_recovered' : 'step_leased',
      operationId: `${nextStep.stepType}:lease:${String(nextStep.leaseEpoch)}`,
      payload: { workerId, attempt: nextStep.attempt, leaseEpoch: nextStep.leaseEpoch },
      actorId: null,
    });
    if (run.state === 'queued' && step.stepType === 'collect') {
      await this.appendEvent({
        aggregateType: 'assurance_run',
        aggregateId: run.id,
        type: 'run_state_changed',
        operationId: `${nextStep.stepType}:lease:${String(nextStep.leaseEpoch)}:collecting`,
        payload: { state: 'collecting' },
        actorId: null,
      });
    }
    return { run: nextRun, step: nextStep, recovered, exhausted: false };
  }

  public async heartbeat(
    stepId: string,
    workerId: string,
    leaseEpoch: number,
    leaseTtlSeconds: number,
  ): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE run_steps
       SET lease_expires_at = now() + make_interval(secs => $4), updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3 AND state = 'leased' AND lease_expires_at > now()`,
      [stepId, workerId, leaseEpoch, leaseTtlSeconds],
    );
    return (result.rowCount ?? 0) === 1;
  }

  public async requireFence(input: {
    readonly runId: string;
    readonly stepId: string;
    readonly workerId: string;
    readonly leaseEpoch: number;
    readonly expectedRunStates: readonly string[];
  }) {
    const run = await this.lockRun(input.runId);
    await this.lockNamedStep(input.runId, 'collect');
    await this.lockNamedStep(input.runId, 'evaluate');
    const step = await this.lockStep(input.stepId);
    if (
      step.leaseOwner !== input.workerId ||
      step.leaseEpoch !== input.leaseEpoch ||
      step.state !== 'leased' ||
      !input.expectedRunStates.includes(run.state)
    ) {
      throw new FenceLostError();
    }
    const live = await this.client.query<{ ok: boolean }>(
      `SELECT lease_expires_at > now() AS ok FROM run_steps WHERE id = $1`,
      [input.stepId],
    );
    if (live.rows[0]?.ok !== true) {
      throw new FenceLostError();
    }
    return { run, step };
  }

  public async persistObservation(
    run: AssuranceRun,
    input: PersistObservationInput,
    freshnessMaxAgeSeconds: number,
  ) {
    const bounded = boundPayload(input.payload);
    const identity = contentIdentity({
      organisationId: run.organisationId,
      kind: input.kind,
      resource: run.resourceScope,
      window: run.evidenceWindow,
      operation: input.operation,
      payloadDigest: bounded.payloadDigest,
      redactionVersion: REDACTION_VERSION,
    });
    const digest = requestDigest({ operation: input.operation, resource: run.resourceScope });
    const inserted = await this.client.query(
      `INSERT INTO observations (
         id, run_id, organisation_id, resource, kind, collected_at, window_from, window_to,
         source_adapter, source_operation, request_digest, freshness, payload, payload_digest,
         redaction_version, truncated, inaccessible, content_identity
       ) VALUES (
         $1,$2,$3,$4::jsonb,$5,now(),$6,$7,$8,$9,$10,
         CASE WHEN $11::int <= 0 THEN 'STALE' ELSE 'FRESH' END,
         $12::jsonb,$13,$14,$15,$16,$17
       )
       ON CONFLICT (run_id, content_identity) DO NOTHING
       RETURNING *`,
      [
        input.id,
        run.id,
        run.organisationId,
        JSON.stringify(run.resourceScope),
        input.kind,
        run.evidenceWindow.from,
        run.evidenceWindow.to,
        input.adapter,
        input.operation,
        digest,
        freshnessMaxAgeSeconds,
        JSON.stringify(bounded.persisted),
        bounded.payloadDigest,
        REDACTION_VERSION,
        bounded.truncated,
        input.inaccessible || bounded.truncated,
        identity,
      ],
    );
    if (inserted.rows[0]) {
      return { observation: mapObservation(inserted.rows[0]), duplicate: false };
    }
    const existing = await this.client.query(
      `SELECT * FROM observations WHERE run_id = $1 AND content_identity = $2`,
      [run.id, identity],
    );
    if (!existing.rows[0]) {
      throw new Error('observation conflict without existing row');
    }
    return { observation: mapObservation(existing.rows[0]), duplicate: true };
  }

  public async persistFinding(run: AssuranceRun, input: PersistFindingInput) {
    const inserted = await this.client.query(
      `INSERT INTO findings (
         id, run_id, detector_id, detector_version, profile_version_id, resource, result, severity,
         title, explanation, fingerprint, citation_count, evaluated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,now()
       )
       ON CONFLICT (run_id, fingerprint) DO NOTHING
       RETURNING *`,
      [
        input.id,
        run.id,
        input.detectorId,
        input.detectorVersion,
        run.profileVersionId,
        JSON.stringify(run.resourceScope),
        input.result,
        input.severity,
        input.title,
        input.explanation,
        input.fingerprint,
        input.observationIds.length,
      ],
    );
    if (!inserted.rows[0]) {
      const existing = await this.client.query(
        `SELECT * FROM findings WHERE run_id = $1 AND fingerprint = $2`,
        [run.id, input.fingerprint],
      );
      const row = existing.rows[0];
      if (!row) {
        throw new Error('finding conflict without existing row');
      }
      return {
        finding: {
          id: String(row['id']),
          runId: run.id,
          detectorId: String(row['detector_id']),
          detectorVersion: String(row['detector_version']),
          profileVersionId: String(row['profile_version_id']),
          resource: parseResourceRef(row['resource']),
          result: String(row['result']) as FindingRecord['result'],
          severity: String(row['severity']),
          title: String(row['title']),
          explanation: String(row['explanation']),
          fingerprint: String(row['fingerprint']),
          citationCount: Number(row['citation_count']),
          observationIds: input.observationIds,
        },
        duplicate: true,
      };
    }
    for (const observationId of input.observationIds) {
      await this.client.query(
        `INSERT INTO finding_citations (finding_id, observation_id, run_id) VALUES ($1,$2,$3)`,
        [input.id, observationId, run.id],
      );
    }
    return {
      finding: {
        id: input.id,
        runId: run.id,
        detectorId: input.detectorId,
        detectorVersion: input.detectorVersion,
        profileVersionId: run.profileVersionId,
        resource: run.resourceScope,
        result: input.result,
        severity: input.severity,
        title: input.title,
        explanation: input.explanation,
        fingerprint: input.fingerprint,
        citationCount: input.observationIds.length,
        observationIds: input.observationIds,
      },
      duplicate: false,
    };
  }

  public async completeCollect(
    fence: { run: AssuranceRun; step: RunStep },
    workerId: string,
    leaseEpoch: number,
  ): Promise<void> {
    this.assertFence(fence, workerId, leaseEpoch, 'collect');
    const completed = await this.client.query(
      `UPDATE run_steps
       SET state = 'succeeded', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3 AND state = 'leased'`,
      [fence.step.id, workerId, leaseEpoch],
    );
    requireSingleUpdate(completed.rowCount);
    const evaluateReady = await this.client.query(
      `UPDATE run_steps SET state = 'ready', updated_at = now() WHERE run_id = $1 AND step_type = 'evaluate' AND state = 'blocked'`,
      [fence.run.id],
    );
    requireSingleUpdate(evaluateReady.rowCount);
    const evaluating = await this.client.query(
      `UPDATE assurance_runs SET state = 'evaluating', updated_at = now() WHERE id = $1 AND state = 'collecting'`,
      [fence.run.id],
    );
    requireSingleUpdate(evaluating.rowCount);
  }

  public async completeEvaluate(
    fence: { run: AssuranceRun; step: RunStep },
    workerId: string,
    leaseEpoch: number,
    outcome: {
      readonly state: 'healthy' | 'findings';
      readonly result: 'PASS' | 'FAIL' | 'UNKNOWN';
    },
  ): Promise<void> {
    this.assertFence(fence, workerId, leaseEpoch, 'evaluate');
    const completed = await this.client.query(
      `UPDATE run_steps
       SET state = 'succeeded', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3 AND state = 'leased'`,
      [fence.step.id, workerId, leaseEpoch],
    );
    requireSingleUpdate(completed.rowCount);
    const terminal = await this.client.query(
      `UPDATE assurance_runs
       SET state = $2, result = $3, terminal_at = now(), updated_at = now()
       WHERE id = $1 AND state = 'evaluating'`,
      [fence.run.id, outcome.state, outcome.result],
    );
    requireSingleUpdate(terminal.rowCount);
  }

  public async failStep(
    fence: { run: AssuranceRun; step: RunStep },
    workerId: string,
    leaseEpoch: number,
    errorClass: ErrorClass,
  ): Promise<void> {
    this.assertFence(fence, workerId, leaseEpoch, fence.step.stepType);
    const failed = await this.client.query(
      `UPDATE run_steps
       SET state = 'failed',
           error_class = $4,
           error_message = $5,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3 AND state = 'leased'`,
      [fence.step.id, workerId, leaseEpoch, errorClass, errorMessageFor(errorClass)],
    );
    requireSingleUpdate(failed.rowCount);
    const terminal = await this.client.query(
      `UPDATE assurance_runs
       SET state = 'failed', terminal_at = now(), updated_at = now()
       WHERE id = $1 AND state IN ('collecting', 'evaluating')`,
      [fence.run.id],
    );
    requireSingleUpdate(terminal.rowCount);
  }

  public async scheduleRetry(
    fence: { run: AssuranceRun; step: RunStep },
    workerId: string,
    leaseEpoch: number,
  ): Promise<void> {
    this.assertFence(fence, workerId, leaseEpoch, fence.step.stepType);
    const delay = backoffSeconds(fence.step.attempt);
    const retried = await this.client.query(
      `UPDATE run_steps
       SET state = 'ready',
           lease_owner = NULL,
           lease_expires_at = NULL,
           next_attempt_at = now() + make_interval(secs => $4),
           updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND lease_epoch = $3 AND state = 'leased' AND attempt < $5`,
      [fence.step.id, workerId, leaseEpoch, delay, MAX_STEP_ATTEMPTS],
    );
    requireSingleUpdate(retried.rowCount);
  }

  public async cancelCollect(runId: string): Promise<AssuranceRun> {
    const run = await this.lockRun(runId);
    if (run.state !== 'queued' && run.state !== 'collecting') {
      throw new Error('run is not cancellable');
    }
    await this.lockNamedStep(runId, 'collect');
    await this.lockNamedStep(runId, 'evaluate');
    await this.client.query(
      `UPDATE run_steps
       SET state = 'cancelled',
           lease_epoch = lease_epoch + 1,
           lease_owner = NULL,
           lease_expires_at = NULL,
           error_class = 'cancelled',
           error_message = $2,
           updated_at = now()
       WHERE run_id = $1 AND step_type = 'collect' AND state IN ('ready', 'leased')`,
      [runId, ERROR_MESSAGES.cancelled],
    );
    const updated = await this.client.query(
      `UPDATE assurance_runs
       SET state = 'cancelled',
           cancel_requested_at = now(),
           terminal_at = now(),
           updated_at = now()
       WHERE id = $1 AND state IN ('queued', 'collecting')
       RETURNING *`,
      [runId],
    );
    if (!updated.rows[0]) {
      throw new Error('run is not cancellable');
    }
    return mapRun(updated.rows[0]);
  }

  public async recordCancelRequested(runId: string): Promise<void> {
    await this.lockRun(runId);
    await this.client.query(
      `UPDATE assurance_runs
       SET cancel_requested_at = COALESCE(cancel_requested_at, now()), updated_at = now()
       WHERE id = $1`,
      [runId],
    );
  }

  public async incrementCollectorAttempts(runId: string): Promise<void> {
    await this.client.query(
      `UPDATE assurance_runs SET collector_attempt_count = collector_attempt_count + 1, updated_at = now() WHERE id = $1`,
      [runId],
    );
  }

  public async insertProfile(profile: ProfileVersion): Promise<ProfileVersion> {
    const result = await this.client.query(
      `INSERT INTO profile_versions (
         id, organisation_id, profile_id, version, scope, detector_versions, freshness_policy,
         detector_parameters, content_digest
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9)
       RETURNING *`,
      [
        profile.id,
        profile.organisationId,
        profile.profileId,
        profile.version,
        JSON.stringify(profile.scope),
        JSON.stringify(profile.detectorVersions),
        JSON.stringify(profile.freshnessPolicy),
        JSON.stringify(profile.detectorParameters),
        profile.contentDigest,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('profile insert failed');
    }
    return mapProfile(row);
  }

  public async insertGrant(grant: Grant): Promise<Grant> {
    const result = await this.client.query(
      `INSERT INTO authorisation_grants (
         id, organisation_id, actor_id, profile_version_id, resource_scope, resource_scope_digest,
         evidence_window_from, evidence_window_to, detector_versions, action, granted_at, expires_at,
         client_idempotency_key, request_digest
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,'assurance_run',$10,$11,$12,$13)
       RETURNING *`,
      [
        grant.id,
        grant.organisationId,
        grant.actorId,
        grant.profileVersionId,
        JSON.stringify(grant.resourceScope),
        grant.resourceScopeDigest,
        grant.evidenceWindow.from,
        grant.evidenceWindow.to,
        JSON.stringify(grant.detectorVersions),
        grant.grantedAt,
        grant.expiresAt,
        grant.clientIdempotencyKey,
        grant.requestDigest,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('grant insert failed');
    }
    return mapGrant(row);
  }

  private async lockNamedStep(runId: string, stepType: StepType): Promise<RunStep> {
    const result = await this.client.query(
      `SELECT * FROM run_steps WHERE run_id = $1 AND step_type = $2 FOR UPDATE`,
      [runId, stepType],
    );
    if (!result.rows[0]) {
      throw new Error('step not found');
    }
    return mapStep(result.rows[0]);
  }

  private async exhaust(run: AssuranceRun, step: RunStep): Promise<void> {
    await this.client.query(
      `UPDATE run_steps
       SET state = 'failed',
           error_class = 'attempts_exhausted',
           error_message = $2,
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
       WHERE id = $1`,
      [step.id, ERROR_MESSAGES.attempts_exhausted],
    );
    await this.client.query(
      `UPDATE assurance_runs
       SET state = 'failed', terminal_at = now(), updated_at = now()
       WHERE id = $1 AND state IN ('queued', 'collecting', 'evaluating')`,
      [run.id],
    );
    await this.appendEvent({
      aggregateType: 'assurance_run',
      aggregateId: run.id,
      type: 'step_failed',
      operationId: `${step.stepType}:failed:${run.id}`,
      payload: { errorClass: 'attempts_exhausted' },
      actorId: null,
    });
  }

  private assertFence(
    fence: { run: AssuranceRun; step: RunStep },
    workerId: string,
    leaseEpoch: number,
    stepType: StepType,
  ): void {
    if (
      fence.step.leaseOwner !== workerId ||
      fence.step.leaseEpoch !== leaseEpoch ||
      fence.step.stepType !== stepType
    ) {
      throw new FenceLostError();
    }
  }
}

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10 });
}
