-- Keep the Singapore edge isolates warm so calls skip cold boot.
-- Two jobs, one per hot function: a single cheap request every two minutes with the region pin, so the warm isolate is the Singapore one.
-- Re-runnable: same names are unscheduled first.

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
DECLARE
  jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname IN ('opera-keepwarm-mcp', 'opera-keepwarm-bridge') LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END
$$;

SELECT cron.schedule(
  'opera-keepwarm-mcp',
  '*/2 * * * *',
  $$SELECT net.http_post('https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp/health', '{}'::jsonb, '{}'::jsonb, '{"Content-Type": "application/json", "x-region": "ap-southeast-1"}'::jsonb, 8000);$$
);

SELECT cron.schedule(
  'opera-keepwarm-bridge',
  '*/2 * * * *',
  $$SELECT net.http_post('https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-bridge', '{"action":"heartbeat","token":"","deviceName":""}'::jsonb, '{}'::jsonb, '{"Content-Type": "application/json", "x-region": "ap-southeast-1"}'::jsonb, 8000);$$
);
