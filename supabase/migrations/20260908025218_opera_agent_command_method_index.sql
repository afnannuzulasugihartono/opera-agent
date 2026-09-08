-- Cover the method foreign key and method-filtered command analysis.
create index if not exists opera_commands_method_idx on public.opera_commands(method);
