-- Qué distritos atiende cada compañía y qué compra cada campaña, para que el donante
-- sepa a dónde llega su aporte y en qué se convierte.

alter table companies add column cobertura text[] not null default '{}';
alter table campaigns add column compra text;
