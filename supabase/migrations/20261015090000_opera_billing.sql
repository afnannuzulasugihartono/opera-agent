-- The money: what a delivered client-month is worth, and the invoice that says so.
--
-- WHY THE PRICE IS A ROW AND NOT A CONSTANT. The unit that is sold is the delivered
-- client-month, and the price of it differs between a pilot, a market and a country.
-- A price in code is a price nobody can change without a release; a price in a table is
-- a price the operator can change between two customers, and it is the same shape for
-- every kind of thing this product will deliver later.
--
-- WHY THE INVOICE CARRIES ITS LINES. An invoice that says "Rp 25.000" and lists
-- nothing cannot be checked by the person paying it. An invoice that carries the
-- deliveries it charges for can be checked line by line, and the rule that a delivery
-- which did not happen is not charged follows from the same place: the lines are the
-- proof, and the amount is computed from them.

create table if not exists opera_price_list (
  id uuid primary key default gen_random_uuid(),
  kind text not null unique,
  unit text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'IDR',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table opera_price_list is 'What each kind of delivery is worth. The kind is what the manifest names.';

create table if not exists opera_invoices (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null,
  period text not null,
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  currency text not null default 'IDR',
  lines jsonb not null default '[]'::jsonb,
  provider text,
  provider_ref text,
  pay_url text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (customer_id, period)
);

comment on table opera_invoices is 'One invoice per customer per month. The lines are the deliveries it charges for.';

create index if not exists opera_invoices_open_idx on opera_invoices (customer_id, period) where status = 'open';

-- WHY NOBODY EXCEPT THE SERVER READS THIS. A customer opens their invoice through a
-- signed link, and the function that serves it reads the row with the service role.
-- Giving the table to anon would let anybody read anybody's deliveries and prices.
revoke all on table opera_price_list from anon, authenticated;
revoke all on table opera_invoices from anon, authenticated;
grant select, insert, update on opera_price_list to service_role;
grant select, insert, update on opera_invoices to service_role;

-- WHY THE PILOT PRICE IS SEEDED AS A ROW. The pilot is free, and the price that
-- follows it is an anchor, not a decision: the number the outreach sheet names. It
-- lives here so that changing it is a data change the operator can see, and so that
-- the invoice a customer opens says the same number the offer said.
insert into opera_price_list (kind, unit, amount_cents, currency, active)
values ('statement.client_month', 'delivered client-month', 500000, 'IDR', true)
on conflict (kind) do update set
  unit = excluded.unit,
  amount_cents = excluded.amount_cents,
  currency = excluded.currency,
  active = excluded.active;
