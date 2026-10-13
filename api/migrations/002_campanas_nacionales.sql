-- Campañas que no pertenecen a una sola compañía (por ejemplo, emergencias nacionales
-- como los incendios forestales). El alcance dice a quién llega el dinero y la fuente
-- respalda el contexto que la campaña describe.

alter table campaigns alter column company_id drop not null;
alter table campaigns add column alcance text;
alter table campaigns add column fuente text;
alter table campaigns add column fuente_url text;

-- Una campaña sin compañía debe decir a quién llega el dinero.
alter table campaigns add constraint campaigns_destino_check
  check (company_id is not null or alcance is not null);
