# Arquitectura

## Hoy (v0.2): frontend estático modular

```
brigada-abierta/
├─ index.html              HTML semántico + sprite de íconos
├─ server.js               servidor estático de desarrollo (sin dependencias)
├─ data/                   respuestas DEMO con el mismo contrato que la API futura
│  ├─ impact.json          métricas, distribución de fondos, movimientos
│  ├─ campaigns.json
│  └─ companies.json
├─ assets/css/
│  ├─ base.css             tokens de diseño, reset, accesibilidad
│  ├─ components.css       botones, badges, progreso, formularios, diálogos
│  └─ sections.css         layout de cada sección
├─ assets/js/
│  ├─ config.js            modo demo/live, montos, moneda
│  ├─ main.js              arranque y rutas
│  ├─ router.js            #/compania/:id, #/donar?campana=|compania=
│  ├─ api/client.js        ÚNICO punto de acceso a datos
│  ├─ payments/provider.js interfaz de pagos (demo ↔ pasarela real)
│  ├─ ui/                  dom (plantillas con escape), formato, diálogos
│  └─ sections/            impacto, campañas, compañías, donación
└─ legacy/                 prototipo v0.1 sin modificar
```

**Contrato de datos**: toda respuesta es `{ demo, updatedAt, data }`. Si `demo` es `true`, la UI muestra la etiqueta **DEMO** de forma automática. Para conectar el backend basta con cambiar `config.mode` a `'live'` y exponer los mismos recursos en `apiBaseUrl`.

## Producción recomendada

```
[Navegador] ──► [Frontend: Astro o Next.js (SSR/SSG para SEO)]
                       │ HTTPS/JSON
                       ▼
               [API: NestJS / Fastify]  ◄── webhook firmado ── [Pasarela: Culqi / Niubiz / Izipay / Mercado Pago]
                       │
         ┌─────────────┼─────────────────┐
         ▼             ▼                 ▼
   [PostgreSQL]   [Almacenamiento    [Correo transaccional]
   donaciones,     de evidencias:     constancias,
   campañas,       facturas, actas]   avisos de ejecución
   ledger
         ▲
   [Panel de administración: compañías publican necesidades y evidencias;
    el Patronato concilia y aprueba]
```

### Principios
1. **El navegador nunca decide que algo está pagado.** El estado `paid` solo lo escribe el webhook verificado de la pasarela.
2. **Sin datos de tarjeta en nuestros servidores.** Se usa el checkout o los campos alojados de la pasarela (PCI DSS SAQ-A).
3. **Ledger de solo inserción.** Las reasignaciones son nuevos asientos auditados, nunca ediciones.
4. **Métricas calculadas, no escritas a mano.** Las cifras del inicio salen de consultas sobre donaciones conciliadas.
5. **Datos personales mínimos** (Ley N.° 29733): correo para la constancia y nombre opcional. Debe existir una política de privacidad publicada antes de recibir datos reales.

### Modelo de datos inicial
- `companies` (id, número, nombre, distrito, dirección, teléfono, verified_at)
- `needs` (company_id, nombre, prioridad, meta, estado)
- `campaigns` (company_id, need_id, meta, inicio, fin, estado)
- `donations` (id, trace_code, amount, currency, frequency, target, donor_email, status, gateway_ref)
- `ledger_entries` (donation_id?, company_id, tipo: assigned|executed|reassigned, monto, evidencia_url)
- `subscriptions` (para donaciones mensuales: token de la pasarela, día de cargo, estado)

## Hoja de ruta

| Fase | Entregable |
|---|---|
| **0.2 (actual)** | Frontend modular, accesible, con datos DEMO y flujo de donación simulado |
| 0.3 | Backend + PostgreSQL. La API reemplaza `/data`. Panel para que las compañías editen sus necesidades |
| 0.4 | Integración con la pasarela en modo *sandbox*: webhooks, constancia por correo y estados reales |
| 0.5 | Ledger público con evidencias y conciliación automática |
| 1.0 | Convenio institucional firmado, políticas legales, pagos en producción y auditoría de seguridad |
| 1.x | Donaciones mensuales, cuenta del donante e historial, más compañías y regiones |

## Pago con Yape / Plin (v0.4)

El frontend ya implementa el flujo completo. En producción, el backend debe exponer:

| Endpoint | Qué hace |
|---|---|
| `POST /api/v1/wallet-charges` | Crea el cobro en la pasarela. Devuelve `{ id, traceCode, qrPayload, expiresAt }`. `qrPayload` es el texto del QR interoperable (EMVCo) que entrega la pasarela, con monto y vencimiento |
| `GET /api/v1/wallet-charges/:id` | Devuelve `{ status: 'pending' \| 'paid' \| 'expired' }`. El estado `paid` solo lo escribe el webhook firmado de la pasarela |
| `POST /api/v1/wallet-charges/:id/approval-code` | Recibe `{ phone, code }` (código de aprobación de Yape) y lo envía a la pasarela. Devuelve `{ status }` |

Comportamiento de la interfaz:
- **Computadora:** muestra el QR primero, porque se escanea con el celular.
- **Celular:** muestra primero el **código de aprobación de Yape**, porque no se puede escanear la propia pantalla. También ofrece guardar el QR en la galería para leerlo desde Yape o Plin.
- **Consulta del estado** cada 3 s. El botón "Ya pagué, verificar" solo consulta el estado; nunca marca la donación como pagada.
- **Vencimiento del QR** a los 10 minutos, con un botón para generar uno nuevo.
- **Botón atrás del celular:** retrocede un paso del formulario. Desde la constancia, lo cierra.

En la fase de prueba, el QR contiene un texto que ninguna billetera puede cobrar, y aparece el botón "Simular pago recibido".
