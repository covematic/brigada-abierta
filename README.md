# Brigada Abierta

Plataforma de donaciones trazables para las compañías de Bomberos Voluntarios del Perú.

> **Estado: prototipo v0.4 en fase de prueba.** Las cifras y campañas son referenciales y no se realizan cobros reales.
> Con `mode: 'demo'` en `assets/js/config.js` la página muestra dos avisos discretos: uno bajo las cifras de impacto y otro en el paso de pago.
> Desaparecen solos al cambiar a `mode: 'live'` y conectar la API y la pasarela.

## Ejecutar

Requiere Node 18 o superior. No hay dependencias que instalar.

```bash
npm run dev
```

Luego abre http://localhost:5173. Hace falta un servidor porque la app usa módulos ES y `fetch`, que no funcionan abriendo el archivo con doble clic.

## Enlaces directos

- `#/compania/SBO-011`: ficha de una compañía
- `#/donar?campana=CMP-2026-001`: donar a una campaña
- `#/donar?compania=SUR-134`: donar a una compañía
- `#/donar`: donar donde más se necesite
- `#/donar?monto=100`: abrir el formulario con un monto ya elegido

## Documentación

- [docs/AUDITORIA.md](docs/AUDITORIA.md): análisis del prototipo v0.1 y decisiones tomadas
- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md): estructura actual, arquitectura de producción y hoja de ruta

## Antes de publicar con datos reales

- Verificar la dirección y el teléfono de cada compañía (`verified: false` en `data/companies.json`).
- Formalizar el convenio institucional y publicar los términos y la privacidad (ver `docs/legal-pendiente.md`).
- Integrar la pasarela de pagos desde el backend; nunca desde el navegador.
