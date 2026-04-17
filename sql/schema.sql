-- Run in Supabase SQL editor (or migrate) when prerequisite tables exist:
-- public.accounts, public.account_tunnels, public.document_analysis_result, auth.users

create table public.users (
  id bigserial not null,
  telegram_id bigint not null,
  username character varying(255) null,
  first_name character varying(255) null,
  last_name character varying(255) null,
  language_code character varying(10) null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  customer_id character varying null,
  credit numeric null default '0'::numeric,
  analyzing_status boolean null default false,
  constraint users_pkey primary key (id),
  constraint users_telegram_id_key unique (telegram_id)
) TABLESPACE pg_default;

create index IF not exists idx_users_telegram_id on public.users using btree (telegram_id) TABLESPACE pg_default;

create table public.essay_uploads (
  id bigserial not null,
  user_id bigint not null,
  file_name character varying(500) not null,
  file_size bigint not null,
  file_path character varying(1000) not null,
  mime_type character varying(100) null,
  status character varying(20) not null default 'queued'::character varying,
  payment_status character varying(20) not null default 'not_paid'::character varying,
  payment_session_id character varying(255) null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  submission_id uuid null,
  note text null,
  account_tunnel_id uuid null,
  account_id uuid null,
  assignee_id uuid null,
  analysis_result_id uuid null,
  constraint essay_uploads_pkey primary key (id),
  constraint essay_uploads_account_id_fkey foreign KEY (account_id) references accounts (id) on delete set null,
  constraint essay_uploads_account_tunnel_id_fkey foreign KEY (account_tunnel_id) references account_tunnels (id) on delete set null,
  constraint essay_uploads_analysis_result_id_fkey foreign KEY (analysis_result_id) references document_analysis_result (id) on update CASCADE on delete set null,
  constraint essay_uploads_assignee_id_fkey foreign KEY (assignee_id) references auth.users (id) on update CASCADE on delete set null,
  constraint essay_uploads_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_essay_uploads_user_id on public.essay_uploads using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_essay_uploads_created_at on public.essay_uploads using btree (created_at desc) TABLESPACE pg_default;
