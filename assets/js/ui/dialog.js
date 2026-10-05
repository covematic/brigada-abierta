// Envoltorio mínimo sobre <dialog> nativo: el navegador ya resuelve
// foco atrapado, tecla Escape, capa superior y devolución de foco.

export function setupDialog(dialog) {
  // Clic en el fondo (backdrop) cierra.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  // Botones con [data-close] cierran.
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) dialog.close();
  });
  // Al cerrar, limpiar SU ruta del hash (data-route) para que "atrás" no reabra el
  // diálogo. Si ya se navegó a la ruta de otro diálogo, no se toca.
  dialog.addEventListener('close', () => {
    if (location.hash.startsWith(`#${dialog.dataset.route}`)) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  });
}

export function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('.dialog-body')?.scrollTo(0, 0);
}

export function closeAllDialogs() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
}
