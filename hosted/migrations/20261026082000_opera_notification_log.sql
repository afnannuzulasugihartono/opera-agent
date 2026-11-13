-- A notification that leaves no trace cannot be told apart from one that never came.

-- WHY THIS TABLE EXISTS.
-- A provider notification is the only thing that closes an invoice, so "the invoice is still open" has two completely different causes: the provider never reached the endpoint, or it reached the endpoint and the endpoint refused what it sent.
-- Measured on 2026-10-26: the provider's own history showed eleven notifications, every one marked undelivered, and the function's console said nothing at all — so the two causes were indistinguishable for four payment attempts.
-- Every notification-shaped request is written here before it is judged, accepted or refused, with the answer and the reason.
-- The signature itself is not stored: which field carried it is enough to diagnose a name mismatch, and the value is derived from the server key.

create table if not exists opera_notification_log (
  id bigserial primary key,
  received_at timestamptz not null default now(),
  order_id text,
  transaction_status text,
  status_code text,
  gross_amount text,
  signature_field text,
  accepted boolean not null,
  why text,
  environment text,
  user_agent text
);

create index if not exists opera_notification_log_order_idx
  on opera_notification_log (order_id, received_at desc);

grant select, insert on opera_notification_log to service_role;
grant usage, select on sequence opera_notification_log_id_seq to service_role;

comment on table opera_notification_log is
  'Every provider notification that reached the function, and what the function did with it.';
comment on column opera_notification_log.signature_field is
  'The field the signature arrived in, never the signature: it separates a provider contract mismatch from a bad secret.';
