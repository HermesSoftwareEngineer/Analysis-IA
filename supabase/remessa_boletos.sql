-- Estrutura da funcionalidade Remessa de Boletos
create extension if not exists pgcrypto;

create table if not exists public.analises_boletos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  nome text not null,
  mes_foco smallint not null check (mes_foco between 1 and 12),
  ano_foco integer not null check (ano_foco >= 2000),
  mes_comparacao smallint not null check (mes_comparacao between 1 and 12),
  ano_comparacao integer not null check (ano_comparacao >= 2000),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade
);

create table if not exists public.contratos_analise (
  id bigint generated always as identity primary key,
  analise_id uuid not null references public.analises_boletos (id) on delete cascade,
  codigo_cliente text not null,
  codigo_contrato text not null default '',
  codigo_imovel text not null default '',
  cpf_locatario text not null default '',
  locatario text,
  locador text,
  status text not null default 'a_conferir' check (status in ('a_conferir', 'conferido')),
  observacao text not null default '',
  analise_ia text not null default '',
  sort_order integer not null default 0,
  situacao text not null default 'desatualizado' check (situacao in ('desatualizado', 'atualizado')),
  created_at timestamptz not null default now(),
  constraint contratos_analise_unique unique (analise_id, codigo_cliente, codigo_contrato, codigo_imovel)
);

-- Migracao incremental (se a tabela ja existir)
alter table public.contratos_analise
  add column if not exists status text not null default 'a_conferir' check (status in ('a_conferir', 'conferido')),
  add column if not exists observacao text not null default '',
  add column if not exists analise_ia text not null default '',
  add column if not exists sort_order integer not null default 0,
  add column if not exists situacao text not null default 'desatualizado' check (situacao in ('desatualizado', 'atualizado'));

create table if not exists public.extratos_boletos (
  id bigint generated always as identity primary key,
  analise_id uuid not null references public.analises_boletos (id) on delete cascade,
  codigo_contrato text not null default '',
  codigo_cliente text not null,
  mes smallint not null check (mes between 1 and 12),
  ano integer not null check (ano >= 2000),
  dados_json jsonb not null,
  subtotal numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint extratos_boletos_unique unique (analise_id, codigo_cliente, codigo_contrato, mes, ano)
);

create table if not exists public.movimentos_boletos (
  id bigint generated always as identity primary key,
  extrato_id bigint not null references public.extratos_boletos (id) on delete cascade,
  codigo text,
  historico text,
  valor numeric(14,2) not null default 0,
  data_vencimento date,
  data_pagamento date,
  dados_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_analises_boletos_user_id on public.analises_boletos (user_id);
create index if not exists idx_contratos_analise_analise_id on public.contratos_analise (analise_id);
create index if not exists idx_extratos_boletos_analise_periodo on public.extratos_boletos (analise_id, ano, mes);
create index if not exists idx_movimentos_boletos_extrato_id on public.movimentos_boletos (extrato_id);

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
