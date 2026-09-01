CREATE TABLE http_idempotency (
  id uuid PRIMARY KEY,
  organisation_id text NOT NULL,
  actor_id text NOT NULL,
  method text NOT NULL,
  route text NOT NULL,
  client_idempotency_key text NOT NULL,
  request_digest text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, actor_id, method, route, client_idempotency_key)
);

CREATE TRIGGER http_idempotency_append_only
  BEFORE UPDATE OR DELETE ON http_idempotency
  FOR EACH ROW EXECUTE FUNCTION reject_append_only();

CREATE FUNCTION observations_match_run() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_row assurance_runs%ROWTYPE;
BEGIN
  SELECT * INTO STRICT run_row FROM assurance_runs WHERE id = NEW.run_id;
  IF run_row.organisation_id IS DISTINCT FROM NEW.organisation_id
    OR run_row.resource_scope IS DISTINCT FROM NEW.resource
    OR run_row.evidence_window_from IS DISTINCT FROM NEW.window_from
    OR run_row.evidence_window_to IS DISTINCT FROM NEW.window_to
  THEN
    RAISE EXCEPTION 'observation organisation, resource and window must equal the run';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER observations_match_run
  BEFORE INSERT ON observations
  FOR EACH ROW EXECUTE FUNCTION observations_match_run();

CREATE FUNCTION findings_match_run() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_row assurance_runs%ROWTYPE;
  pinned text;
BEGIN
  SELECT * INTO STRICT run_row FROM assurance_runs WHERE id = NEW.run_id;
  IF run_row.resource_scope IS DISTINCT FROM NEW.resource
    OR run_row.profile_version_id IS DISTINCT FROM NEW.profile_version_id
  THEN
    RAISE EXCEPTION 'finding resource and profile must equal the run';
  END IF;
  pinned := run_row.detector_versions ->> NEW.detector_id;
  IF pinned IS NULL OR pinned IS DISTINCT FROM NEW.detector_version THEN
    RAISE EXCEPTION 'finding detector is not pinned on the run';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER findings_match_run
  BEFORE INSERT ON findings
  FOR EACH ROW EXECUTE FUNCTION findings_match_run();
