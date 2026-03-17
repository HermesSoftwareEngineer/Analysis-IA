-- Migration: substituir mes/ano por intervalos de data em analises_boletos
-- e periodo_tipo em extratos_boletos.
-- Execute no SQL Editor do Supabase (ou via CLI).

-- ============================================================
-- 1. Novas colunas de data em analises_boletos
-- ============================================================
alter table public.analises_boletos
  add column if not exists data_inicio_foco      date,
  add column if not exists data_fim_foco          date,
  add column if not exists data_inicio_comparacao date,
  add column if not exists data_fim_comparacao    date;

-- ============================================================
-- 2. Backfill: converte mes/ano existentes para datas
-- ============================================================
update public.analises_boletos
set
  data_inicio_foco      = make_date(ano_foco::int,       mes_foco::int,       1),
  data_fim_foco         = (make_date(ano_foco::int,       mes_foco::int,       1) + interval '1 month' - interval '1 day')::date,
  data_inicio_comparacao = make_date(ano_comparacao::int, mes_comparacao::int, 1),
  data_fim_comparacao   = (make_date(ano_comparacao::int, mes_comparacao::int, 1) + interval '1 month' - interval '1 day')::date
where data_inicio_foco is null;

-- ============================================================
-- 3. Tornar colunas not null
-- ============================================================
alter table public.analises_boletos
  alter column data_inicio_foco      set not null,
  alter column data_fim_foco          set not null,
  alter column data_inicio_comparacao set not null,
  alter column data_fim_comparacao    set not null;

-- ============================================================
-- 4. Remover colunas antigas de analises_boletos
-- ============================================================
alter table public.analises_boletos
  drop column if exists mes_foco,
  drop column if exists ano_foco,
  drop column if exists mes_comparacao,
  drop column if exists ano_comparacao;

-- ============================================================
-- 5. Adicionar periodo_tipo em extratos_boletos
-- ============================================================
alter table public.extratos_boletos
  add column if not exists periodo_tipo text
    check (periodo_tipo in ('foco', 'comparacao'));

-- ============================================================
-- 6. Backfill periodo_tipo via join com analise (foco)
-- ============================================================
update public.extratos_boletos eb
set periodo_tipo = 'foco'
from public.analises_boletos ab
where eb.analise_id = ab.id
  and eb.periodo_tipo is null
  and (
    -- O extrato foi gerado para o mes/ano que coincide com o periodo foco backfilled.
    -- Como as colunas mes/ano ainda existem nesse momento do script (foram dropadas acima
    -- apenas em analises_boletos), o join usa os campos de data calculados acima.
    -- Se mes/ano ainda exisitirem no extrato precisamos de uma heuristica:
    -- extrato.mes e extrato.ano dentro do intervalo data_inicio_foco..data_fim_foco
    eb.mes is not null and eb.ano is not null
    and make_date(eb.ano::int, eb.mes::int, 1) >= ab.data_inicio_foco
    and make_date(eb.ano::int, eb.mes::int, 1) <= ab.data_fim_foco
  );

update public.extratos_boletos eb
set periodo_tipo = 'comparacao'
from public.analises_boletos ab
where eb.analise_id = ab.id
  and eb.periodo_tipo is null
  and (
    eb.mes is not null and eb.ano is not null
    and make_date(eb.ano::int, eb.mes::int, 1) >= ab.data_inicio_comparacao
    and make_date(eb.ano::int, eb.mes::int, 1) <= ab.data_fim_comparacao
  );

-- Linhas que nao caíram em nenhum periodo: assume foco (evita violacao not null)
update public.extratos_boletos
set periodo_tipo = 'foco'
where periodo_tipo is null;

-- ============================================================
-- 7. Tornar periodo_tipo not null
-- ============================================================
alter table public.extratos_boletos
  alter column periodo_tipo set not null;

-- ============================================================
-- 8. Substituir unique constraint de extratos_boletos
-- ============================================================
alter table public.extratos_boletos
  drop constraint if exists extratos_boletos_unique;

alter table public.extratos_boletos
  add constraint extratos_boletos_unique
    unique (analise_id, codigo_cliente, codigo_contrato, periodo_tipo);

-- ============================================================
-- 9. Remover colunas mes/ano de extratos_boletos
-- ============================================================
alter table public.extratos_boletos
  drop column if exists mes,
  drop column if exists ano;

-- Indices antigos que referenciavam mes/ano
drop index if exists idx_extratos_boletos_analise_periodo;

create index if not exists idx_extratos_boletos_analise_tipo
  on public.extratos_boletos (analise_id, periodo_tipo);
