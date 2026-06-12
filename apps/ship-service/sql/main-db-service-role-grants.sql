-- Run in the Supabase SQL editor as a database owner/admin.
-- The service_role JWT bypasses RLS, but custom schemas still need explicit
-- USAGE and table privileges before PostgREST can read/write them.

grant usage on schema account to service_role;
grant usage on schema parcel to service_role;
grant usage on schema driver to service_role;
grant usage on schema location to service_role;
grant usage on schema notifications to service_role;
grant usage on schema routing to service_role;
grant usage on schema payment to service_role;

grant select, insert, update, delete on all tables in schema account to service_role;
grant select, insert, update, delete on all tables in schema parcel to service_role;
grant select, insert, update, delete on all tables in schema driver to service_role;
grant select, insert, update, delete on all tables in schema location to service_role;
grant select, insert, update, delete on all tables in schema notifications to service_role;
grant select, insert, update, delete on all tables in schema routing to service_role;
grant select, insert, update, delete on all tables in schema payment to service_role;

grant usage, select on all sequences in schema account to service_role;
grant usage, select on all sequences in schema parcel to service_role;
grant usage, select on all sequences in schema driver to service_role;
grant usage, select on all sequences in schema location to service_role;
grant usage, select on all sequences in schema notifications to service_role;
grant usage, select on all sequences in schema routing to service_role;
grant usage, select on all sequences in schema payment to service_role;
