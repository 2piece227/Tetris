-- Review-code server for the booth. Run once in the Supabase SQL Editor.
--
-- The app never touches the table directly. Two functions are all the public
-- (anon) key can call:
--   save_round(rec)  keep a round, pick an unused 4-digit code server-side, return it
--   get_round(c)     the round saved under a code, or null
-- So a visitor can fetch a round only by knowing its code, and nobody can list,
-- edit or delete rounds through the key. Rounds hold game moves only — no names
-- or other personal data.

create table if not exists public.rounds (
  code       text primary key check (code ~ '^[0-9]{4}$'),
  record     jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.rounds enable row level security;
-- No policies: with RLS on and none granted, the table is closed to the API keys.
revoke all on table public.rounds from anon, authenticated;

create or replace function public.save_round(rec jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c text;
  tries int := 0;
begin
  -- A 600-piece round is well under this; anything bigger is not a round.
  if octet_length(rec::text) > 300000 then
    raise exception 'record too large';
  end if;
  -- Four digits run out eventually; a fair day is well inside three days.
  delete from rounds where created_at < now() - interval '3 days';
  loop
    c := lpad(floor(random() * 10000)::int::text, 4, '0');
    begin
      insert into rounds (code, record) values (c, rec);
      return c;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 50 then
        raise exception 'no free code';
      end if;
    end;
  end loop;
end;
$$;

create or replace function public.get_round(c text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select record from rounds where code = c;
$$;

revoke all on function public.save_round(jsonb) from public;
revoke all on function public.get_round(text) from public;
grant execute on function public.save_round(jsonb) to anon;
grant execute on function public.get_round(text) to anon;
