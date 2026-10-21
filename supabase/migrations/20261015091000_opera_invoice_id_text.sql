-- The invoice id is the customer and the month, not a generated uuid.
--
-- WHY THIS MOVES. The invoice is addressed by its customer and its period, and the
-- link a customer opens signs that address. A generated uuid would mean the server
-- had to look the invoice up before it could check the link, and a lookup is a
-- place where a wrong id becomes somebody else's invoice.

alter table opera_invoices alter column id drop default;
alter table opera_invoices alter column id type text using id::text;
