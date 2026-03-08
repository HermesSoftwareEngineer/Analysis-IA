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
```

## Setup do Supabase

1. Crie um projeto no Supabase.
2. Ative Auth por email/senha.
3. Execute os scripts SQL abaixo no SQL Editor (na ordem):

- `supabase/users.sql`
- `supabase/remessa_boletos.sql`

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
