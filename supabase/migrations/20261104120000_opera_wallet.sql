-- The wallet: money that arrived before the work, and the hold that says what one task may spend.

-- WHY THE BALANCE IS A SUM AND NOT A COLUMN.
-- A column is overwritten by whoever writes it last, and then the number nobody can explain is the one the customer sees.
-- Every movement is a row, the balance is their sum, and a wrong balance is a row that can be read rather than a number that cannot.
-- A correction is another row, never an edit: deleting history is how a wallet becomes unauditable.

-- WHY A HOLD IS NOT A LEDGER ROW.
-- A hold moves no money; it only promises that the money is still there when the task finishes.
-- Keeping it in the ledger as well would give two places to disagree about the same promise, so the promise lives in opera_reservations and the ledger holds only money that moved.

-- WHY THE HOLD EXPIRES.
-- A client that crashes between reserving and finishing leaves a promise nobody will ever keep or settle, and the customer's balance stays spoken for forever.
-- Thirty minutes is longer than any single task this product accepts, so an expired hold is an abandoned one, and expiry refunds it without asking.

-- WHY A TASK CANNOT RESERVE MORE THAN TEN ACTIONS.
-- The price is flat and the promise is one completed job, so a plan that needs more than ten actions is not one job and must be split before any money is held.
-- The bound lives in the table, not only in the client, because a client is the thing being bounded.

create table if not exists public.opera_wallets (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

comment on table public.opera_wallets is 'One wallet per person. It carries no balance: the balance is the sum of its ledger rows.';

create table if not exists public.opera_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.opera_wallets (owner_id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 64),
  amount_cents bigint not null check (amount_cents > 0),
  actions_planned integer check (actions_planned between 1 and 10),
  actions_actual integer check (actions_actual is null or actions_actual >= 0),
  status text not null default 'open' check (status in ('open', 'settled', 'refunded', 'expired')),
  artifact_hash text check (artifact_hash is null or artifact_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  closed_at timestamptz,
  check (closed_at is null or closed_at >= created_at),
  check (status = 'open' or closed_at is not null),
  check (status <> 'settled' or artifact_hash is not null)
);

comment on table public.opera_reservations is 'One row per task that was allowed to spend: the price it agreed to, the window it may finish in, and how it ended.';
comment on column public.opera_reservations.actions_actual is 'What the task cost in actions, recorded for price calibration only. It never changes what was charged.';

create index if not exists opera_reservations_open_idx
  on public.opera_reservations (owner_id, expires_at) where status = 'open';

create table if not exists public.opera_ledger (
  id bigserial primary key,
  owner_id uuid not null references public.opera_wallets (owner_id) on delete cascade,
  kind text not null check (kind in ('deposit', 'settle', 'refund', 'adjust')),
  amount_cents bigint not null,
  reservation_id uuid references public.opera_reservations (id) on delete restrict,
  ref text check (ref is null or char_length(ref) between 1 and 128),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint opera_ledger_sign check (
    (kind in ('deposit', 'refund') and amount_cents > 0)
    or (kind = 'settle' and amount_cents < 0)
    or (kind = 'adjust' and amount_cents <> 0)
  )
);

comment on table public.opera_ledger is 'Append-only money movements. Balance is the sum of amount_cents; a deposit is positive and a settle is negative.';
comment on column public.opera_ledger.ref is 'What the money came from, such as a provider order id. Unique per kind, so a repeated notification cannot credit twice.';

-- WHY THE UNIQUE INDEX IS ON THE PAIR AND NOT ONLY THE RESERVATION.
-- A network retry sends the same settle twice, and the second one must charge nothing; that is one settle per reservation.
-- A refund after a settle is a different row with a different meaning, so the pair is what must be unique, not the reservation.

create unique index if not exists opera_ledger_once_idx
  on public.opera_ledger (reservation_id, kind) where reservation_id is not null;

create unique index if not exists opera_ledger_ref_once_idx
  on public.opera_ledger (kind, ref) where ref is not null;

create index if not exists opera_ledger_owner_idx
  on public.opera_ledger (owner_id, created_at desc);

-- WHY NOBODY READS THESE TABLES DIRECTLY.
-- A wallet is money, and a browser that can read the table can read every customer's balance by changing one id.
-- So the tables are closed to the anonymous and signed-in roles, and every read and write goes through a function that names its own owner.

alter table public.opera_wallets enable row level security;
alter table public.opera_reservations enable row level security;
alter table public.opera_ledger enable row level security;

revoke all on table public.opera_wallets from anon, authenticated;
revoke all on table public.opera_reservations from anon, authenticated;
revoke all on table public.opera_ledger from anon, authenticated;
grant select, insert, update on table public.opera_wallets to service_role;
grant select, insert, update on table public.opera_reservations to service_role;
grant select, insert on table public.opera_ledger to service_role;
grant usage, select on sequence public.opera_ledger_id_seq to service_role;

-- WHY THE BALANCE HAS A FUNCTION OF ITS OWN.
-- The sum is asked in three places — the reserve check, the settle guard and the dashboard — and three copies of it would drift.
-- It is stable, so the planner can fold it into the same statement that reads the holds.

create or replace function public.opera_wallet_balance(p_owner uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount_cents), 0)::bigint
  from public.opera_ledger
  where owner_id = p_owner;
$$;

-- WHY AVAILABLE IS NOT THE SAME NUMBER AS BALANCE.
-- The balance is what the customer owns; available is what the next task may promise, and an open hold is already promised to a task that is still running.
-- A hold that has passed its window promises nothing, so it is left out here rather than waited on by a sweep that may never come.

create or replace function public.opera_wallet_available(p_owner uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select public.opera_wallet_balance(p_owner) - coalesce((
    select sum(amount_cents)
    from public.opera_reservations
    where owner_id = p_owner and status = 'open' and expires_at > now()
  ), 0)::bigint;
$$;

-- WHY THE OWNER ROW IS LOCKED BEFORE THE BALANCE IS READ.
-- Two reserves that read the same balance both pass, and together they promise money that exists once.
-- The lock serialises them, so the second one reads what the first one left behind; the check and the write that follows it cannot be split by another caller.

create or replace function public.opera_wallet_reserve(
  p_owner uuid,
  p_kind text,
  p_amount_cents bigint,
  p_actions_planned integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available bigint;
  v_res public.opera_reservations%rowtype;
begin
  if p_owner is null then return jsonb_build_object('ok', false, 'why', 'no-owner'); end if;
  if p_amount_cents is null or p_amount_cents <= 0 then return jsonb_build_object('ok', false, 'why', 'bad-amount'); end if;
  if p_kind is null or char_length(trim(p_kind)) not between 1 and 64 then return jsonb_build_object('ok', false, 'why', 'bad-kind'); end if;
  perform public.opera_wallet_expire(p_owner);
  perform 1 from public.opera_wallets where owner_id = p_owner for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'no-wallet'); end if;
  v_available := public.opera_wallet_available(p_owner);
  if v_available < p_amount_cents then
    return jsonb_build_object('ok', false, 'why', 'insufficient', 'availableCents', v_available, 'amountCents', p_amount_cents);
  end if;
  insert into public.opera_reservations (owner_id, kind, amount_cents, actions_planned)
  values (p_owner, trim(p_kind), p_amount_cents, p_actions_planned)
  returning * into v_res;
  return jsonb_build_object(
    'ok', true,
    'reservationId', v_res.id,
    'amountCents', v_res.amount_cents,
    'expiresAt', v_res.expires_at,
    'availableCents', v_available - v_res.amount_cents
  );
end $$;

-- WHY A DEADLINE IS ALSO REFUNDED WHEN THE HOLD IS ASKED AFTER IT.
-- The sweep is a convenience, not the rule; a settle that arrives after the window must not charge a task that overran.
-- So the same closure happens on the way in, and the hold is refunded exactly once whichever path reaches it first.

create or replace function public.opera_wallet_expire(p_owner uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_expired integer := 0;
begin
  for v_row in
    select * from public.opera_reservations
    where status = 'open' and expires_at <= now() and (p_owner is null or owner_id = p_owner)
    for update skip locked
  loop
    update public.opera_reservations
    set status = 'expired', closed_at = now()
    where id = v_row.id;
    insert into public.opera_ledger (owner_id, kind, amount_cents, reservation_id, note)
    values (v_row.owner_id, 'refund', v_row.amount_cents, v_row.id, 'hold expired')
    on conflict do nothing;
    v_expired := v_expired + 1;
  end loop;
  return jsonb_build_object('ok', true, 'expired', v_expired);
end $$;

create or replace function public.opera_wallet_settle(
  p_reservation uuid,
  p_owner uuid,
  p_artifact_hash text,
  p_actions_actual integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.opera_reservations%rowtype;
begin
  if p_artifact_hash is null or p_artifact_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'why', 'bad-artifact-hash');
  end if;
  select * into v_res from public.opera_reservations where id = p_reservation and owner_id = p_owner for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'not-found'); end if;
  if v_res.status = 'settled' then
    return jsonb_build_object('ok', true, 'already', true, 'amountCents', v_res.amount_cents, 'balanceCents', public.opera_wallet_balance(p_owner));
  end if;
  if v_res.status <> 'open' then return jsonb_build_object('ok', false, 'why', v_res.status); end if;
  if v_res.expires_at <= now() then
    update public.opera_reservations set status = 'expired', closed_at = now() where id = v_res.id;
    insert into public.opera_ledger (owner_id, kind, amount_cents, reservation_id, note)
    values (v_res.owner_id, 'refund', v_res.amount_cents, v_res.id, 'hold expired')
    on conflict do nothing;
    return jsonb_build_object('ok', false, 'why', 'expired');
  end if;
  if public.opera_wallet_balance(p_owner) < v_res.amount_cents then
    return jsonb_build_object('ok', false, 'why', 'insufficient');
  end if;
  insert into public.opera_ledger (owner_id, kind, amount_cents, reservation_id)
  values (v_res.owner_id, 'settle', -v_res.amount_cents, v_res.id)
  on conflict do nothing;
  update public.opera_reservations
  set status = 'settled', artifact_hash = p_artifact_hash, actions_actual = p_actions_actual, closed_at = now()
  where id = v_res.id;
  return jsonb_build_object('ok', true, 'amountCents', v_res.amount_cents, 'balanceCents', public.opera_wallet_balance(p_owner));
end $$;

-- WHY A SETTLED TASK IS NEVER REFUNDED.
-- The money was spent on work that finished; a later refund would give back money for a job the customer already received.
-- A refund is terminal and idempotent: asking twice returns the same answer and moves the money once.

create or replace function public.opera_wallet_refund(
  p_reservation uuid,
  p_owner uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.opera_reservations%rowtype;
begin
  select * into v_res from public.opera_reservations where id = p_reservation and owner_id = p_owner for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'not-found'); end if;
  if v_res.status = 'settled' then return jsonb_build_object('ok', false, 'why', 'settled'); end if;
  if v_res.status = 'refunded' or v_res.status = 'expired' then
    return jsonb_build_object('ok', true, 'already', true, 'amountCents', v_res.amount_cents, 'balanceCents', public.opera_wallet_balance(p_owner));
  end if;
  insert into public.opera_ledger (owner_id, kind, amount_cents, reservation_id, note)
  values (v_res.owner_id, 'refund', v_res.amount_cents, v_res.id, left(coalesce(p_reason, 'task failed'), 500))
  on conflict do nothing;
  update public.opera_reservations set status = 'refunded', closed_at = now() where id = v_res.id;
  return jsonb_build_object('ok', true, 'amountCents', v_res.amount_cents, 'balanceCents', public.opera_wallet_balance(p_owner));
end $$;

-- WHY A DEPOSIT TAKES A REFERENCE.
-- The provider sends the same settlement more than once; the reference is the provider's order id, so the second one is the same row and credits nothing.
-- The wallet is created here, because a person who has just paid has a wallet whether or not they had one before.

create or replace function public.opera_wallet_credit(
  p_owner uuid,
  p_amount_cents bigint,
  p_ref text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if p_owner is null then return jsonb_build_object('ok', false, 'why', 'no-owner'); end if;
  if p_amount_cents is null or p_amount_cents <= 0 then return jsonb_build_object('ok', false, 'why', 'bad-amount'); end if;
  if p_ref is null or char_length(trim(p_ref)) not between 1 and 128 then return jsonb_build_object('ok', false, 'why', 'bad-ref'); end if;
  insert into public.opera_wallets (owner_id) values (p_owner) on conflict do nothing;
  insert into public.opera_ledger (owner_id, kind, amount_cents, ref, note)
  values (p_owner, 'deposit', p_amount_cents, trim(p_ref), left(p_note, 500))
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'credited', v_rows > 0, 'balanceCents', public.opera_wallet_balance(p_owner));
end $$;

revoke all on function public.opera_wallet_balance(uuid) from public, anon, authenticated;
revoke all on function public.opera_wallet_available(uuid) from public, anon, authenticated;
revoke all on function public.opera_wallet_reserve(uuid, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.opera_wallet_expire(uuid) from public, anon, authenticated;
revoke all on function public.opera_wallet_settle(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.opera_wallet_refund(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.opera_wallet_credit(uuid, bigint, text, text) from public, anon, authenticated;

grant execute on function public.opera_wallet_balance(uuid) to service_role;
grant execute on function public.opera_wallet_available(uuid) to service_role;
grant execute on function public.opera_wallet_reserve(uuid, text, bigint, integer) to service_role;
grant execute on function public.opera_wallet_expire(uuid) to service_role;
grant execute on function public.opera_wallet_settle(uuid, uuid, text, integer) to service_role;
grant execute on function public.opera_wallet_refund(uuid, uuid, text) to service_role;
grant execute on function public.opera_wallet_credit(uuid, bigint, text, text) to service_role;

-- WHY THE TOP-UP IS A PRICE ROW AND NOT A CONSTANT IN THE PAGE.
-- The smallest deposit that makes the wallet worth opening is a business decision, not a rendering detail.
-- It lives with every other price, so the page and the invoice cannot disagree and raising it needs no release.

insert into public.opera_price_list (kind, unit, amount_cents, currency, active)
values
  ('wallet.deposit', 'wallet top-up', 1000000, 'IDR', true),
  ('task.simple', 'completed simple task', 10000, 'IDR', true),
  ('task.report', 'completed report', 100000, 'IDR', true),
  ('task.batch_item', 'completed batch item', 8000, 'IDR', true)
on conflict (kind) do update set
  unit = excluded.unit,
  amount_cents = excluded.amount_cents,
  currency = excluded.currency,
  active = excluded.active;
