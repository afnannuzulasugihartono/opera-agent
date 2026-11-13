-- The price is decided: a firm pays for a month of up to 15 or 50 client-months, and a client above the cap is priced one by one.

-- WHY THE PLAN IS THE UNIT AND THE CLIENT-MONTH IS THE OVERAGE.
-- A bookkeeper does not buy a download; they buy the month's work across their client list.
-- One plan number is what they can compare with the hours it saves, and the overage keeps a larger firm from being undercharged.
-- Both are rows, so the first customer can be quoted without a release, and the invoice reads the same number the offer did.

insert into opera_price_list (kind, unit, amount_cents, currency, active)
values
  ('plan.pilot', 'firm-month, up to 15 client-months', 9900000, 'IDR', true),
  ('plan.firm', 'firm-month, up to 50 client-months', 24900000, 'IDR', true)
on conflict (kind) do update set
  unit = excluded.unit,
  amount_cents = excluded.amount_cents,
  currency = excluded.currency,
  active = excluded.active;

update opera_price_list
set unit = 'delivered client-month above the plan', amount_cents = 1000000
where kind = 'statement.client_month';
