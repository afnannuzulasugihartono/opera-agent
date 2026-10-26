-- Every attempt an invoice opened stays on the invoice, because a notification for an older one must still find it.

-- WHY THE ATTEMPTS ARE A LIST AND THE SCALAR STAYS.
-- The scalar is the current attempt: the one the provider is asked about, and the one a retry expires before it opens another.
-- The array is every attempt this invoice ever opened, because a notification for an older attempt must still find its invoice.
-- The attempt opener keeps the two in step: it appends the attempt to the array and writes the same id to the scalar, and the scalar keeps its unique index so two invoices cannot share a live transaction.

-- WHY THE DEADLINE IS STORED.
-- A link whose deadline is unknown cannot be shown honestly: the page would either promise time it does not have or hide a link that still works.
-- The deadline comes from the same constant as the provider request, written once when the charge is opened, so the page cannot disagree with Midtrans.

-- WHY THE PAID FIELDS EXIST.
-- An operator has to see how the money arrived, not only that it did: a QRIS settlement, a card capture and a transfer are different evidence.
-- The method is the provider's own payment_type, and the transaction id is what the provider's support desk will ask for when a person disputes the charge.

alter table opera_invoices add column if not exists provider_order_ids text[] not null default '{}'::text[];
alter table opera_invoices add column if not exists pay_url_expires_at timestamptz;
alter table opera_invoices add column if not exists paid_method text;
alter table opera_invoices add column if not exists provider_transaction_id text;

-- WHY THE BACKFILL READS THE SCALAR.
-- Every invoice written before this file has exactly one attempt, and the scalar is it.
-- Without the backfill an open invoice would answer no containment lookup, so a settlement for the link its customer is holding would find nothing.

update public.opera_invoices
set provider_order_ids = array[provider_order_id]
where provider_order_id is not null and cardinality(provider_order_ids) = 0;

-- WHY THE LOOKUP IS INDEXED OVER THE ARRAY.
-- A notification carries one order id and the invoice is found by containment, so the search must not scan every invoice as they accumulate.
-- The array is the index now: the scalar is one attempt, not the way a notification is placed.

create index if not exists opera_invoices_provider_order_ids_idx
  on opera_invoices using gin (provider_order_ids);

comment on column opera_invoices.provider_order_ids is
  'Every provider order id this invoice opened, oldest first. A notification for any attempt finds its invoice here.';
comment on column opera_invoices.pay_url_expires_at is
  'When the provider said the current payment link stops working; null when no link was opened or nobody knows.';
comment on column opera_invoices.paid_method is
  'The provider''s payment_type for the settlement, so an operator can see how the money arrived.';
comment on column opera_invoices.provider_transaction_id is
  'The provider''s transaction_id for the settlement, the id its support desk asks for.';
