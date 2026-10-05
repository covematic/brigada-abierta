# Auditoría del prototipo v0.1 (`legacy/brigada-abierta_v0.1.html`)

Archivo único de 1 775 líneas: ~1 190 de CSS, ~180 de HTML y ~360 de JS en línea. Una dependencia externa (`qrcode@1.5.3` vía jsDelivr) y tres familias de Google Fonts.

## Lo que está bien (se mantuvo)

- **Concepto de trazabilidad**: el código de afiliación por donación y la conciliación por compañía son el núcleo diferenciador. Se mantuvo como *código de trazabilidad*.
- **Identidad visual**: la paleta rojo / tinta / papel y la tipografía Fraunces transmiten seriedad y calidez. Se conservó, reorganizada en tokens.
- **Variables CSS** para colores y un layout responsive básico con grid.
- **Datos separados de la vista**: había un arreglo `companies`. Se extendió a un modelo completo.
- **Donación en especie**: la dirección y el teléfono por compañía son útiles y reales.

## Problemas encontrados

### Seguridad, legal y confianza (críticos)
| Problema | Riesgo |
|---|---|
| El botón "Ya realicé el pago" marcaba la donación como registrada sin verificación | Una constancia falsa: cualquiera "dona" sin pagar |
| El QR codificaba una URL inventada en el dominio del Patronato (`patronatobomberosperu.org/qr?af=…`) | Yape/Plin no lo pueden leer; se usa un dominio de terceros sin autorización |
| La pantalla de pago imitaba la marca y los colores de Yape | Suplantación de marca, posible riesgo de phishing percibido |
| El pie decía "en alianza con el Patronato Nacional y el CGBVP" | Una alianza institucional sin confirmar |
| Cifras como "100 % trazabilidad", "S/0 comisión" y "165 años" se presentaban como hechos | Datos sin respaldo que se leen como reales |
| Necesidades y % de avance inventados para compañías reales, sin marcar como demo | Desinformación sobre instituciones reales |
| `innerHTML` con plantillas sin escape | XSS en cuanto los datos vengan de una API |
| Script de CDN sin `integrity` (SRI) | Riesgo de cadena de suministro |
| `target="_blank"` sin `rel="noopener"` | Tabnabbing |

### Accesibilidad
- Las tarjetas eran `div` con `onclick`: no se podían usar con teclado ni con lector de pantalla.
- El modal no tenía `role="dialog"`, ni foco atrapado, ni cierre con Escape, ni devolución de foco.
- El botón "×" no tenía nombre accesible.
- El input de monto no tenía `<label>`.
- No había *skip link*, ni `<header>`/`<main>`, ni landmarks.
- En móvil el menú desaparecía por completo (`display:none`) y no había alternativa.
- Las animaciones `.reveal` dejaban contenido en `opacity:0` si falla JS, y no se respetaba `prefers-reduced-motion`.
- Había texto de 0,68–0,72 rem en mayúsculas mono, difícil de leer.

### UX/UI
- Faltaban campañas, métricas de impacto, el uso de fondos, preguntas frecuentes, datos del donante y una confirmación real.
- El filtro por región solo tenía "Lima" (inútil).
- No había URL por compañía, así que no se podía compartir una compañía.
- El QR expiraba y cerraba el modal sin aviso.
- El número decorativo "04" en el hero no tenía significado.

### Código y escalabilidad
- Todo en un archivo, con estado global (`window.currentPayment`) y handlers `onclick` en línea.
- Había hacks con `setTimeout` para conectar eventos tras `innerHTML`.
- `setAmount` usaba `querySelectorAll` global.
- La validación `amount <= 0` comparaba un string.
- Se creaba un `IntersectionObserver` nuevo en cada render.
- No había SEO (description, Open Graph) ni manejo de estados de carga o error.

### Rendimiento
- Se cargaban tres familias tipográficas con 14 pesos en total, y la librería de QR en la carga inicial aunque solo se usaba en el pago.
- La tipografía "stamp" de 24 rem en el fondo solo era decorativa.

## Decisiones tomadas en v0.2

| Parte | Decisión | Justificación |
|---|---|---|
| Pantalla estilo Yape + QR | **Reemplazada** por un flujo de donación de 4 pasos con proveedor de pagos abstracto | El QR no funcionaba y la marca era ajena. El QR real lo debe generar la pasarela |
| "Ya realicé el pago" | **Eliminado** | El estado "pagado" solo puede venir del webhook de la pasarela |
| Librería `qrcode` | **Eliminada** | Ya no se genera QR en el cliente |
| IBM Plex Mono | **Eliminada** | Se usa la fuente monoespaciada del sistema para códigos |
| Directorio, modal de compañía, pasos y transparencia | **Refactorizados** | Accesibles, con datos desde la API y una URL por compañía |
| Alianza institucional en el pie | **Reformulada** como prototipo académico | Hasta tener el convenio firmado |
