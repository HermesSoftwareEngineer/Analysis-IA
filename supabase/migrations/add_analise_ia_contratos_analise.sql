-- Migration: adiciona coluna exclusiva para comentario da IA em contratos_analise
-- Execute este script no SQL Editor do Supabase (ou via CLI)

alter table public.contratos_analise
  add column if not exists analise_ia text not null default '';
