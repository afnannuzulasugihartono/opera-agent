-- The id a person reads is not the id a provider accepts.
--
-- WHY THIS COLUMN EXISTS. Midtrans allows only letters, digits, dash, underscore, tilde
-- and dot in an order id, and refuses the whole transaction on any other character. The
-- invoice id is "<customer>:<period>", and a customer name has spaces, so the id a
-- customer reads in the link cannot be the id the provider is given. The provider id is
-- derived from the invoice id, the amount and the currency: legal characters, stable for
-- an unchanged invoice, different when the amount is corrected. The callback finds the
-- invoice by this column first and by the invoice id second, so a notification signed by
-- hand and an invoice written before this column existed both still close.

alter table opera_invoices add column if not exists provider_order_id text;

create unique index if not exists opera_invoices_provider_order_id_idx
  on opera_invoices (provider_order_id)
  where provider_order_id is not null;

comment on column opera_invoices.provider_order_id is
  'The id sent to the payment provider: legal characters, stable for an unchanged amount.';
