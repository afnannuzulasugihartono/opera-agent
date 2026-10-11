-- Register the bounded adaptive screenshot primitive shipped by Opera Agent 1.4.0.
-- Image bytes are returned once and atomically scrubbed from the command row;
-- the extension does not persist captures and performs its own URL, incognito,
-- private-tab, sensitive-surface,
-- crop, dimension, frequency, timeout, and result-size enforcement.

insert into public.opera_methods(method, default_timeout_ms, enabled, description)
values (
  'page.capture',
  10000,
  true,
  'Capture a bounded viewport or crop JPEG from an explicit HTTP/HTTPS tab using background CDP, with local privacy checks and unchanged-image hashing.'
)
on conflict (method) do update
set default_timeout_ms = excluded.default_timeout_ms,
    enabled = excluded.enabled,
    description = excluded.description;

create or replace function public.opera_await_capture(
  p_command_id uuid,
  p_timeout_ms integer default 12000
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deadline timestamptz;
  v_cmd public.opera_commands%rowtype;
  v_result jsonb;
  v_wait integer;
begin
  v_wait := least(greatest(coalesce(p_timeout_ms, 12000), 100), 32000);
  v_deadline := clock_timestamp() + make_interval(secs => v_wait / 1000.0);

  loop
    select * into v_cmd
    from public.opera_commands
    where id = p_command_id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'Command not found.');
    end if;
    if v_cmd.method <> 'page.capture' then
      return jsonb_build_object(
        'ok', false,
        'commandId', v_cmd.id,
        'error', jsonb_build_object('code', 'INVALID_CAPTURE_COMMAND', 'message', 'Command is not a page.capture request.')
      );
    end if;

    if v_cmd.status = 'completed' then
      select * into v_cmd
      from public.opera_commands
      where id = p_command_id
      for update;

      if coalesce((v_cmd.result ->> 'scrubbed')::boolean, false) then
        return jsonb_build_object(
          'ok', false,
          'commandId', v_cmd.id,
          'status', v_cmd.status,
          'error', jsonb_build_object('code', 'CAPTURE_RESULT_CONSUMED', 'message', 'Screenshot result has already been consumed.')
        );
      end if;

      v_result := v_cmd.result;
      update public.opera_commands
      set result = jsonb_build_object(
        'scrubbed', true,
        'sha256', v_result #>> '{screenshot,sha256}',
        'encodedBytes', v_result #> '{screenshot,encodedBytes}'
      )
      where id = v_cmd.id and status = 'completed';

      return jsonb_build_object(
        'ok', true,
        'commandId', v_cmd.id,
        'status', v_cmd.status,
        'result', v_result,
        'timing', jsonb_build_object(
          'queuedMs', round(extract(epoch from (coalesce(v_cmd.claimed_at, v_cmd.completed_at) - v_cmd.created_at)) * 1000),
          'totalMs', round(extract(epoch from (v_cmd.completed_at - v_cmd.created_at)) * 1000)
        )
      );
    elsif v_cmd.status in ('failed', 'expired', 'cancelled') then
      return jsonb_build_object('ok', false, 'commandId', v_cmd.id, 'status', v_cmd.status, 'error', v_cmd.error);
    end if;

    if clock_timestamp() >= v_deadline then
      update public.opera_commands
      set status = 'cancelled',
          result = null,
          error = jsonb_build_object('code', 'AWAIT_TIMEOUT', 'message', 'Timed out waiting for screenshot result.'),
          completed_at = now()
      where id = v_cmd.id and status in ('queued', 'claimed');

      return jsonb_build_object(
        'ok', false,
        'commandId', v_cmd.id,
        'status', 'cancelled',
        'error', jsonb_build_object('code', 'AWAIT_TIMEOUT', 'message', 'Timed out waiting for screenshot result.')
      );
    end if;

    perform pg_sleep(0.05);
  end loop;
end
$$;

revoke all on function public.opera_await_capture(uuid, integer) from public, anon, authenticated;
grant execute on function public.opera_await_capture(uuid, integer) to service_role;

insert into public.opera_audit(event_type, details)
values (
  'page.capture.registered',
  jsonb_build_object(
    'extensionVersion', '1.4.0',
    'protocolVersion', 1,
    'maxEncodedBytes', 225280,
    'defaultMaxWidth', 1280,
    'defaultMaxHeight', 900,
    'backgroundCapable', true,
    'persistentCaptureStorage', false,
    'resultDelivery', 'atomic-read-and-scrub'
  )
);
