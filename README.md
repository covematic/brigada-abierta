# Brigada Abierta

Plataforma de donaciones trazables para las compañías de Bomberos Voluntarios del Perú.

> **Estado: v0.5 · backend en modo sandbox.** El flujo de pago completo funciona (Yape/Plin por QR o código de aprobación, tarjeta, transferencia), pero sin dinero real hasta integrar una pasarela. Las cifras iniciales son referenciales (`DEMO_DATA=true`).

## Ejecutar en tu computadora

Requiere Node 20 o superior.

```bash
npm install
npm run dev
```

Abre http://localhost:5173. No necesitas instalar PostgreSQL: en desarrollo se usa **PGlite**, que es Postgres real embebido, guardado en `.data/pglite`. Para empezar con la base vacía, borra esa carpeta.

```bash
npm test
```

Las pruebas corren contra una base temporal en memoria. Cubren el catálogo, las validaciones, el pago por QR, el código de aprobación, el vencimiento, el webhook firmado, la idempotencia y la protección del registro contable.

## Estructura

```
index.html, assets/, data/   Página (HTML/CSS/JS sin build)
server.js                    Arranque: base de datos → migraciones → datos iniciales → HTTP
api/
  app.js                     Rutas /api/v1, validación, webhook, archivos públicos
  store.js                   Todas las consultas SQL
  payments.js                Pasarela (sandbox hoy; aquí se integra Culqi/Niubiz/Izipay)
  db.js                      PostgreSQL (pg) o PGlite
  migrations/                Esquema SQL versionado
  seed.js                    Carga compañías, campañas y cifras de /data
test/                        Pruebas de la API (node --test)
render.yaml                  Despliegue en Render (Web Service + PostgreSQL)
```

La página detecta sola si hay backend, consultando `/api/v1/health`. Si se publica sin backend, como sitio estático, sigue funcionando con `/data/*.json` y pagos simulados.

## API

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/v1/health` | Estado y modo de pagos |
| GET | `/api/v1/impact` · `/campaigns` · `/companies` | Datos públicos (`{ demo, updatedAt, data }`) |
| POST | `/api/v1/donations` | Tarjeta o transferencia |
| POST | `/api/v1/wallet-charges` | Crea un cobro de Yape/Plin y devuelve el QR |
| GET | `/api/v1/wallet-charges/:id` | Estado del cobro (`pending`, `paid`, `expired`) |
| POST | `/api/v1/wallet-charges/:id/approval-code` | Pago con código de aprobación de Yape |
| POST | `/api/v1/wallet-charges/:id/simulate` | Solo sandbox: simula el pago |
| POST | `/api/v1/webhooks/payments` | Aviso de la pasarela, firmado con HMAC-SHA256 (`X-Signature`) |

## Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `DATABASE_URL` | (vacío → PGlite) | Conexión a PostgreSQL. Obligatoria en producción |
| `PAYMENTS_MODE` | `sandbox` | `sandbox` o `live` |
| `PAYMENT_WEBHOOK_SECRET` | — | Secreto de los webhooks. Obligatorio en producción |
| `DEMO_DATA` | `true` | Carga cifras referenciales en una base nueva |
| `WALLET_CHARGE_MINUTES` | `10` | Vigencia del QR |

## Publicar en Render

1. Sube los cambios con `git push`.
2. En https://dashboard.render.com elige **New → Blueprint**, selecciona este repositorio y pulsa **Apply**. Se crean el servicio web `brigada-abierta` y la base de datos `brigada-db`.

En el plan gratuito, el servicio se suspende tras 15 minutos sin visitas, y la primera visita tarda alrededor de un minuto en despertarlo. La base de datos gratuita **vence a los 30 días**. Para uso real, conviene el plan pagado de ambos.

## Antes de recibir dinero real

- Integrar una pasarela en `api/payments.js` y cambiar a `PAYMENTS_MODE=live`.
- Definir la cuenta receptora y el convenio institucional; publicar términos y privacidad (ver `docs/legal-pendiente.md`).
- Verificar los datos de cada compañía (`verified`) y cambiar a `DEMO_DATA=false` en una base nueva.

Ver también [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) y [docs/AUDITORIA.md](docs/AUDITORIA.md).
