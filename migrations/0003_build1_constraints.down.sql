DROP TRIGGER IF EXISTS findings_match_run ON findings;
DROP FUNCTION IF EXISTS findings_match_run();
DROP TRIGGER IF EXISTS observations_match_run ON observations;
DROP FUNCTION IF EXISTS observations_match_run();
DROP TRIGGER IF EXISTS http_idempotency_append_only ON http_idempotency;
DROP TABLE IF EXISTS http_idempotency;
