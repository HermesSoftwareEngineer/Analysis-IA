-- Migration: torna as remessas de boletos compartilhadas entre usuarios autenticados
-- Execute este script no SQL Editor do Supabase (ou via CLI)

alter table public.analises_boletos enable row level security;
alter table public.contratos_analise enable row level security;
alter table public.extratos_boletos enable row level security;
alter table public.movimentos_boletos enable row level security;

drop policy if exists "Analises owner select" on public.analises_boletos;
drop policy if exists "Analises owner insert" on public.analises_boletos;
drop policy if exists "Analises owner update" on public.analises_boletos;
drop policy if exists "Analises owner delete" on public.analises_boletos;
drop policy if exists "Analises shared all" on public.analises_boletos;

create policy "Analises shared all"
on public.analises_boletos
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Contratos owner all" on public.contratos_analise;
drop policy if exists "Contratos shared all" on public.contratos_analise;

create policy "Contratos shared all"
on public.contratos_analise
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Extratos owner all" on public.extratos_boletos;
drop policy if exists "Extratos shared all" on public.extratos_boletos;

create policy "Extratos shared all"
on public.extratos_boletos
for all
to authenticated
using (true)
with check (true);

drop policy if exists "Movimentos owner all" on public.movimentos_boletos;
drop policy if exists "Movimentos shared all" on public.movimentos_boletos;

create policy "Movimentos shared all"
on public.movimentos_boletos
for all
to authenticated
using (true)
with check (true);
