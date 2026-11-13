-- Remove the ambiguous overload of the pairing-code issuer.

-- WHY this file exists: the binding migration added a three-argument opera_create_pairing_code while the core migration left a two-argument one in place.
-- PostgREST cannot choose between them, so every call answered PGRST203 "function is not unique" and the dashboard pairing button could never work.
-- Measured on this project before the drop: HTTP 300.

-- Nothing in the runtime calls the two-argument form: the pairing code is issued from the account page only.
-- Dropping it is therefore safe, and leaving it would keep the endpoint broken for every user.

-- APPLY: paste into the Supabase dashboard SQL editor.

drop function if exists public.opera_create_pairing_code(text, integer);