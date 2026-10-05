-- Esquema inicial de Brigada Abierta.

create table companies (
  id          text primary key,
  number      text not null,
  name        text not null,
  department  text not null,
  district    text not null,
  founded     int,
  address     text,
  phone       text,
  description text,
  verified    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table needs (
  id             text primary key,
  company_id     text not null references companies(id),
  name           text not null,
  detail         text,
  priority       text not null check (priority in ('high', 'medium', 'low')),
  goal           numeric(12,2) not null check (goal > 0),
  -- Fondos recibidos fuera de la plataforma (o cifras referenciales en modo demo).
  raised_offline numeric(12,2) not null default 0,
  sort           int not null default 0
);

create table campaigns (
  id             text primary key,
  company_id     text not null references companies(id),
  need_id        text references needs(id),
  title          text not null,
  summary        text,
  category       text,
  goal           numeric(12,2) not null check (goal > 0),
  raised_offline numeric(12,2) not null default 0,
  donors_offline int not null default 0,
  ends_at        date not null,
  status         text not null default 'active' check (status in ('draft', 'active', 'closed')),
  featured       boolean not null default false
);

create table donations (
  id           uuid primary key,
  trace_code   text not null unique,
  amount       numeric(12,2) not null check (amount > 0),
  currency     text not null default 'PEN',
  method       text not null check (method in ('wallet', 'card', 'transfer')),
  target_type  text not null check (target_type in ('general', 'campaign', 'company')),
  campaign_id  text references campaigns(id),
  company_id   text references companies(id),
  donor_email  text not null,
  donor_name   text,
  anonymous    boolean not null default true,
  status       text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'failed')),
  gateway      text not null,
  gateway_ref  text unique,
  qr_payload   text,
  attempts     int not null default 0,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);
create index donations_status_idx on donations (status);
create index donations_campaign_idx on donations (campaign_id);

-- Registro contable de solo inserción: las correcciones son asientos nuevos.
create table ledger_entries (
  id          bigserial primary key,
  company_id  text not null references companies(id),
  donation_id uuid references donations(id),
  kind        text not null check (kind in ('assigned', 'executed', 'reassigned')),
  category    text,
  concept     text not null,
  amount      numeric(12,2) not null,
  evidence    text,
  entry_date  date not null default current_date,
  created_at  timestamptz not null default now()
);

create function forbid_ledger_change() returns trigger language plpgsql as $$
begin
  raise exception 'ledger_entries es de solo inserción';
end $$;

create trigger ledger_entries_immutable
  before update or delete on ledger_entries
  for each row execute function forbid_ledger_change();

-- Webhooks ya procesados (idempotencia).
create table webhook_events (
  id          text primary key,
  payload     jsonb not null,
  received_at timestamptz not null default now()
);
