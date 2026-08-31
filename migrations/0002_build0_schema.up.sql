CREATE TABLE profile_versions (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  profile_id text NOT NULL,
  version integer NOT NULL,
  scope jsonb NOT NULL,
  detector_versions jsonb NOT NULL,
  freshness_policy jsonb NOT NULL,
  detector_parameters jsonb NOT NULL,
  content_digest text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, profile_id, version),
  UNIQUE (id, organisation_id)
);

CREATE TABLE authorisation_grants (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  actor_id text NOT NULL,
  profile_version_id uuid NOT NULL,
  resource_scope jsonb NOT NULL,
  resource_scope_digest text NOT NULL,
  evidence_window_from timestamptz NOT NULL,
  evidence_window_to timestamptz NOT NULL,
  detector_versions jsonb NOT NULL,
  action text NOT NULL CHECK (action = 'assurance_run'),
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  client_idempotency_key text NOT NULL UNIQUE,
  request_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  UNIQUE (id, organisation_id, profile_version_id),
  CHECK (evidence_window_from < evidence_window_to),
  FOREIGN KEY (profile_version_id, organisation_id)
    REFERENCES profile_versions (id, organisation_id)
);

CREATE TABLE assurance_runs (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  profile_version_id uuid NOT NULL,
  authorisation_grant_id uuid NOT NULL UNIQUE,
  resource_scope jsonb NOT NULL,
  resource_scope_digest text NOT NULL,
  evidence_window_from timestamptz NOT NULL,
  evidence_window_to timestamptz NOT NULL,
  detector_versions jsonb NOT NULL,
  state text NOT NULL CHECK (state IN (
    'queued', 'collecting', 'evaluating',
    'healthy', 'findings', 'failed', 'cancelled'
  )),
  result text NULL CHECK (result IS NULL OR result IN ('PASS', 'FAIL', 'UNKNOWN')),
  client_idempotency_key text NOT NULL UNIQUE,
  request_digest text NOT NULL,
  run_identity_digest text NOT NULL UNIQUE,
  cancel_requested_at timestamptz NULL,
  collector_attempt_count integer NOT NULL DEFAULT 0 CHECK (collector_attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz NULL,
  CHECK (evidence_window_from < evidence_window_to),
  CHECK (
    (state = 'queued' AND started_at IS NULL AND result IS NULL AND terminal_at IS NULL)
    OR (state IN ('collecting', 'evaluating') AND started_at IS NOT NULL AND result IS NULL AND terminal_at IS NULL)
    OR (state = 'healthy' AND started_at IS NOT NULL AND result = 'PASS' AND terminal_at IS NOT NULL)
    OR (state = 'findings' AND started_at IS NOT NULL AND result IN ('FAIL', 'UNKNOWN') AND terminal_at IS NOT NULL)
    OR (state = 'failed' AND started_at IS NOT NULL AND result IS NULL AND terminal_at IS NOT NULL)
    OR (state = 'cancelled' AND result IS NULL AND terminal_at IS NOT NULL)
  ),
  UNIQUE (id, organisation_id),
  UNIQUE (id, profile_version_id),
  FOREIGN KEY (profile_version_id, organisation_id)
    REFERENCES profile_versions (id, organisation_id),
  FOREIGN KEY (authorisation_grant_id, organisation_id, profile_version_id)
    REFERENCES authorisation_grants (id, organisation_id, profile_version_id)
);

CREATE TABLE run_steps (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES assurance_runs (id),
  step_type text NOT NULL CHECK (step_type IN ('collect', 'evaluate')),
  state text NOT NULL CHECK (state IN ('blocked', 'ready', 'leased', 'succeeded', 'failed', 'cancelled')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0 AND attempt <= 5),
  next_attempt_at timestamptz NULL,
  lease_owner text NULL,
  lease_expires_at timestamptz NULL,
  lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  error_class text NULL CHECK (error_class IS NULL OR error_class IN (
    'attempts_exhausted', 'persist_failure', 'invariant_violation', 'cancelled'
  )),
  error_message text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_type),
  CHECK (
    state <> 'leased'
    OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_epoch >= 1)
  ),
  CHECK (
    state NOT IN ('blocked', 'ready')
    OR lease_owner IS NULL
  ),
  CHECK (
    (error_class IS NULL AND error_message IS NULL)
    OR (error_class = 'attempts_exhausted' AND error_message = 'step attempts exhausted')
    OR (error_class = 'persist_failure' AND error_message = 'durable persist failed')
    OR (error_class = 'invariant_violation' AND error_message = 'orchestration invariant violated')
    OR (error_class = 'cancelled' AND error_message = 'run cancelled')
  )
);

CREATE INDEX run_steps_claim_idx
  ON run_steps (state, lease_expires_at, next_attempt_at, attempt, run_id);

CREATE TABLE observations (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES assurance_runs (id),
  organisation_id text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  resource jsonb NOT NULL,
  kind text NOT NULL,
  collected_at timestamptz NOT NULL,
  window_from timestamptz NOT NULL,
  window_to timestamptz NOT NULL,
  source_adapter text NOT NULL,
  source_operation text NOT NULL,
  request_digest text NOT NULL,
  freshness text NOT NULL CHECK (freshness IN ('FRESH', 'STALE')),
  payload jsonb NOT NULL,
  payload_digest text NOT NULL,
  redaction_version text NOT NULL,
  truncated boolean NOT NULL DEFAULT false,
  inaccessible boolean NOT NULL DEFAULT false,
  content_identity text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, content_identity),
  UNIQUE (id, run_id),
  FOREIGN KEY (run_id, organisation_id) REFERENCES assurance_runs (id, organisation_id)
);

CREATE TABLE findings (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES assurance_runs (id),
  detector_id text NOT NULL,
  detector_version text NOT NULL,
  profile_version_id uuid NOT NULL,
  resource jsonb NOT NULL,
  result text NOT NULL CHECK (result IN ('PASS', 'FAIL', 'UNKNOWN')),
  severity text NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  title text NOT NULL,
  explanation text NOT NULL,
  fingerprint text NOT NULL,
  citation_count integer NOT NULL CHECK (citation_count >= 1),
  evaluated_at timestamptz NOT NULL,
  UNIQUE (run_id, fingerprint),
  UNIQUE (id, run_id),
  FOREIGN KEY (profile_version_id) REFERENCES profile_versions (id),
  FOREIGN KEY (run_id, profile_version_id) REFERENCES assurance_runs (id, profile_version_id)
);

CREATE TABLE finding_citations (
  finding_id uuid NOT NULL,
  observation_id uuid NOT NULL,
  run_id uuid NOT NULL,
  PRIMARY KEY (finding_id, observation_id),
  FOREIGN KEY (finding_id, run_id) REFERENCES findings (id, run_id),
  FOREIGN KEY (observation_id, run_id) REFERENCES observations (id, run_id)
);

CREATE TABLE cases (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, fingerprint)
);

CREATE TABLE events (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  sequence bigint NOT NULL,
  type text NOT NULL,
  operation_id text NOT NULL,
  payload jsonb NOT NULL,
  actor_id text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_type, aggregate_id, sequence),
  UNIQUE (aggregate_type, aggregate_id, type, operation_id)
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL
);

CREATE FUNCTION reject_append_only() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER profile_versions_append_only
  BEFORE UPDATE OR DELETE ON profile_versions
  FOR EACH ROW EXECUTE FUNCTION reject_append_only();

CREATE TRIGGER observations_append_only
  BEFORE UPDATE OR DELETE ON observations
  FOR EACH ROW EXECUTE FUNCTION reject_append_only();

CREATE TRIGGER findings_append_only
  BEFORE UPDATE OR DELETE ON findings
  FOR EACH ROW EXECUTE FUNCTION reject_append_only();

CREATE TRIGGER finding_citations_append_only
  BEFORE UPDATE OR DELETE ON finding_citations
  FOR EACH ROW EXECUTE FUNCTION reject_append_only();

CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION reject_append_only();

CREATE FUNCTION authorisation_grants_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'authorisation_grants cannot be deleted';
  END IF;
  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'authorisation_grants cannot be updated after consumption';
  END IF;
  IF NEW.consumed_at IS NULL THEN
    RAISE EXCEPTION 'authorisation_grants updates must set consumed_at';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.profile_version_id IS DISTINCT FROM OLD.profile_version_id
    OR NEW.resource_scope IS DISTINCT FROM OLD.resource_scope
    OR NEW.resource_scope_digest IS DISTINCT FROM OLD.resource_scope_digest
    OR NEW.evidence_window_from IS DISTINCT FROM OLD.evidence_window_from
    OR NEW.evidence_window_to IS DISTINCT FROM OLD.evidence_window_to
    OR NEW.detector_versions IS DISTINCT FROM OLD.detector_versions
    OR NEW.action IS DISTINCT FROM OLD.action
    OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.client_idempotency_key IS DISTINCT FROM OLD.client_idempotency_key
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'authorisation_grants columns other than consumed_at are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER authorisation_grants_guard
  BEFORE UPDATE OR DELETE ON authorisation_grants
  FOR EACH ROW EXECUTE FUNCTION authorisation_grants_guard();

CREATE FUNCTION assurance_runs_match_grant() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grant_row authorisation_grants%ROWTYPE;
BEGIN
  SELECT * INTO STRICT grant_row
  FROM authorisation_grants
  WHERE id = NEW.authorisation_grant_id;
  IF grant_row.organisation_id IS DISTINCT FROM NEW.organisation_id
    OR grant_row.profile_version_id IS DISTINCT FROM NEW.profile_version_id
    OR grant_row.resource_scope IS DISTINCT FROM NEW.resource_scope
    OR grant_row.resource_scope_digest IS DISTINCT FROM NEW.resource_scope_digest
    OR grant_row.evidence_window_from IS DISTINCT FROM NEW.evidence_window_from
    OR grant_row.evidence_window_to IS DISTINCT FROM NEW.evidence_window_to
    OR grant_row.detector_versions IS DISTINCT FROM NEW.detector_versions
  THEN
    RAISE EXCEPTION 'assurance_runs fields must equal the consumed grant';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assurance_runs_match_grant
  BEFORE INSERT OR UPDATE ON assurance_runs
  FOR EACH ROW EXECUTE FUNCTION assurance_runs_match_grant();

CREATE FUNCTION assurance_runs_immutable_pins() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
    OR NEW.profile_version_id IS DISTINCT FROM OLD.profile_version_id
    OR NEW.authorisation_grant_id IS DISTINCT FROM OLD.authorisation_grant_id
    OR NEW.resource_scope IS DISTINCT FROM OLD.resource_scope
    OR NEW.resource_scope_digest IS DISTINCT FROM OLD.resource_scope_digest
    OR NEW.evidence_window_from IS DISTINCT FROM OLD.evidence_window_from
    OR NEW.evidence_window_to IS DISTINCT FROM OLD.evidence_window_to
    OR NEW.detector_versions IS DISTINCT FROM OLD.detector_versions
    OR NEW.client_idempotency_key IS DISTINCT FROM OLD.client_idempotency_key
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.run_identity_digest IS DISTINCT FROM OLD.run_identity_digest
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'pinned assurance_runs columns are immutable';
  END IF;
  IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'started_at is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assurance_runs_immutable_pins
  BEFORE UPDATE ON assurance_runs
  FOR EACH ROW EXECUTE FUNCTION assurance_runs_immutable_pins();

CREATE FUNCTION assert_finding_citation_count() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  finding uuid;
  expected integer;
  actual integer;
BEGIN
  IF TG_TABLE_NAME = 'findings' THEN
    finding := NEW.id;
    expected := NEW.citation_count;
  ELSE
    finding := COALESCE(NEW.finding_id, OLD.finding_id);
    SELECT citation_count INTO expected FROM findings WHERE id = finding;
  END IF;
  SELECT count(*)::integer INTO actual FROM finding_citations WHERE finding_id = finding;
  IF expected IS DISTINCT FROM actual THEN
    RAISE EXCEPTION 'finding citation_count must equal citation rows';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER findings_citation_count
  AFTER INSERT ON findings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_finding_citation_count();

CREATE CONSTRAINT TRIGGER finding_citations_count
  AFTER INSERT OR UPDATE OR DELETE ON finding_citations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_finding_citation_count();
