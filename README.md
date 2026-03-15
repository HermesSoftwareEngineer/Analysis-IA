# Imobi Analytics

Plataforma web para analise financeira de imobiliarias, centralizando:

- Boletos cobrados de inquilinos
- Repasses feitos para proprietarios
- Pagamentos realizados para fornecedores

## Stack

- React + Vite
- TailwindCSS
- Supabase (Auth + banco)
- React Router

## Estrutura do projeto

```text
src/
	components/
	layouts/
	pages/
	services/
	hooks/
	lib/
	styles/
```

## Variaveis de ambiente

Copie o arquivo `.env.example` para `.env` e preencha:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_IMOVIEW_API_KEY=
VITE_AI_PROVIDER=google
VITE_AI_MODEL=gemini-2.0-flash
VITE_AI_MAX_OUTPUT_TOKENS=1400
VITE_GOOGLE_API_KEY=
VITE_LANGSMITH_TRACING=false
VITE_LANGSMITH_API_KEY=
VITE_LANGSMITH_PROJECT=analysis-ia
VITE_LANGSMITH_ENDPOINT=https://api.smith.langchain.com
VITE_REMESSA_CONCURRENCY=4
VITE_REMESSA_RAPIDA_CONCURRENCY=6
```

## Setup do Supabase

1. Crie um projeto no Supabase.
2. Ative Auth por email/senha.
3. Execute os scripts SQL abaixo no SQL Editor (na ordem):

- `supabase/users.sql`
- `supabase/remessa_boletos.sql`
- `supabase/migrations/add_situacao_contratos_analise.sql`
- `supabase/migrations/add_analise_ia_contratos_analise.sql`
- `supabase/migrations/open_access_remessa_boletos.sql`

4. Caso queira validar rapidamente, a estrutura minima da `users` e:

```sql
create table if not exists public.users (
	id uuid primary key,
	name text not null,
	email text not null unique,
	created_at timestamp with time zone default now()
);
```

5. Configure politicas RLS conforme a necessidade do seu ambiente.

## Rodando localmente

```bash
npm install
npm run dev
```

## Fluxo implementado

- Landing page moderna e responsiva (`/`)
- Login (`/login`) com Supabase Auth
- Cadastro (`/cadastro`) com salvamento adicional em `users`
- Rotas privadas com redirecionamento para `/login`
- Dashboard com sidebar fixa (`/dashboard`)
- Remessa de boletos com:
- listagem de analises (`/remessa-boletos`)
- criacao de analise (`/remessa-boletos/nova`)
- importacao de planilha `.xls/.xlsx`
- coleta de extratos na API Imoview
- comparativo com filtros, ordenacao, busca e expansao de movimentos
- analise com IA (Google) por contrato ou em lote para contratos com diferenca

## Analise com IA

Na tela de analise de remessa, existem dois botoes:

- `Analisar com IA (todos)`: processa todos os contratos da remessa que possuem diferenca.
- `Analisar com IA`: processa apenas o contrato da linha.

O texto retornado pela IA e salvo automaticamente no campo `analise_ia` do contrato.

### Configuracao

- `VITE_AI_PROVIDER`: provider de IA (atualmente `google`).
- `VITE_AI_MODEL`: modelo Google (ex: `gemini-2.0-flash`).
- `VITE_AI_MAX_OUTPUT_TOKENS`: limite maximo de tokens de saida por resposta (ex: `1400`).
- `VITE_GOOGLE_API_KEY`: chave da API Google para inferencia.
- `VITE_LANGSMITH_TRACING`: `true` para habilitar tracing no LangSmith.
- `VITE_LANGSMITH_API_KEY`: chave da API do LangSmith (quando tracing estiver ativo).
- `VITE_LANGSMITH_PROJECT`: nome do projeto no LangSmith.
- `VITE_LANGSMITH_ENDPOINT`: endpoint da API do LangSmith.
- `VITE_REMESSA_CONCURRENCY`: quantidade de contratos processados em paralelo na remessa normal (padrao `4`, recomendado entre `3` e `8`).
- `VITE_REMESSA_RAPIDA_CONCURRENCY`: quantidade de contratos processados em paralelo na Remessa rapida (padrao `6`, recomendado entre `4` e `10`).
