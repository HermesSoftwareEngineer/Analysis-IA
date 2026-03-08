-- Migration: adiciona colunas status, observacao, sort_order e situacao em contratos_analise
-- Execute este script no SQL Editor do Supabase (ou via CLI)

alter table public.contratos_analise
  add column if not exists status text not null default 'a_conferir'
    check (status in ('a_conferir', 'conferido')),
  add column if not exists observacao text not null default '',
  add column if not exists sort_order integer not null default 0,
  add column if not exists situacao text not null default 'desatualizado'
    check (situacao in ('desatualizado', 'atualizado'));
