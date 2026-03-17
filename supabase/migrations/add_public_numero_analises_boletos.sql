-- URL publica numerica para analises de remessa de boletos
create sequence if not exists public.analises_boletos_numero_seq;

alter table public.analises_boletos
  add column if not exists numero bigint;

alter table public.analises_boletos
  alter column numero set default nextval('public.analises_boletos_numero_seq');

update public.analises_boletos
set numero = nextval('public.analises_boletos_numero_seq')
where numero is null;

alter table public.analises_boletos
  alter column numero set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'analises_boletos_numero_key'
      and conrelid = 'public.analises_boletos'::regclass
  ) then
    alter table public.analises_boletos
      add constraint analises_boletos_numero_key unique (numero);
  end if;
end
$$;

do $$
declare
  current_max bigint;
begin
  select max(numero) into current_max
  from public.analises_boletos;

  if current_max is null then
    perform setval('public.analises_boletos_numero_seq', 1, false);
  else
    perform setval('public.analises_boletos_numero_seq', current_max, true);
  end if;
end
$$;

alter sequence public.analises_boletos_numero_seq
  owned by public.analises_boletos.numero;
