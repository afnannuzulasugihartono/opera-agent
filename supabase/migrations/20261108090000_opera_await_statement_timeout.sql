-- The API kills a statement at about eight seconds, and the wait functions are the ones meant to hold a statement open while a device works, so a wait that outlived that limit came back as a failure with the answer already sitting in the row.

alter function public.opera_await(uuid, integer) set statement_timeout = '60s';
alter function public.opera_await_adaptive(uuid, integer) set statement_timeout = '60s';
alter function public.opera_await_capture(uuid, integer) set statement_timeout = '60s';
