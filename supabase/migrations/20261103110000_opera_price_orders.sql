-- The public price page's orders: who asked to buy which plan, for which month, and the invoice that was opened.

-- WHY THE ORDER IS A ROW OF ITS OWN.
-- The invoice says what is owed; it does not say how the buyer asked for it.
-- A buyer types a firm name and one contact before any invoice exists, and the operator needs both when the first batch is discussed.
-- So the request is written first, with the invoice id it will open, and the invoice is written on the same request.

-- WHY ONE FIRM AND ONE MONTH IS ONE ORDER.
-- A firm that submits twice in one month means one purchase, not two; a second invoice would ask for the same month twice.
-- The unique key makes the second submit return the row the first one wrote, and the invoice id it already carries.

create table if not exists opera_price_orders (
  id bigserial primary key,
  firm text not null check (char_length(firm) between 2 and 80),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  contact text not null check (char_length(contact) between 3 and 120),
  kind text not null,
  amount_cents integer not null check (amount_cents > 0),
  invoice_id text not null,
  created_at timestamptz not null default now(),
  constraint opera_price_orders_firm_period_unique unique (firm, period)
);

create index if not exists opera_price_orders_created_idx
  on opera_price_orders (created_at desc);

-- WHY THE BROWSER GETS NOTHING.
-- The contact is personal data and the amount is the operator's business.
-- The function writes with the service role, so no policy is needed and none is granted.

alter table opera_price_orders enable row level security;

revoke all on table opera_price_orders from anon, authenticated;
grant select, insert, update on table opera_price_orders to service_role;
grant usage, select on sequence opera_price_orders_id_seq to service_role;

comment on table opera_price_orders is
  'One row per public order: the firm, the contact, the plan, the price at that moment, and the invoice it opened.';

-- WHY THE FILE RECORDS ITSELF.
-- scripts/apply-migrations.mjs sends the file through the Management API as one query and writes no ledger row.
-- So the file writes the version the ledger would have held, and the map can prove it applied from the ledger rather than by guessing.

insert into supabase_migrations.schema_migrations(version, statements)
values ('20261103110000', ARRAY['opera_price_orders'])
on conflict (version) do nothing;
