// Dibuja códigos QR en <canvas>. La librería (qrcode-generator, ~20 KB) se carga
// solo cuando alguien elige pagar con billetera digital, con verificación SRI.

const LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const LIB_SRI = 'sha512-ZDSPMa/JM1D+7kdg2x3BsruQ6T/JpJo3jWDWkCZsP+5yVyp1KfESqLI+7RqB5k24F7p2cV7i2YHh/890y6P6Sw==';

let loading;

function loadLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB_URL;
    s.integrity = LIB_SRI;
    s.crossOrigin = 'anonymous';
    s.referrerPolicy = 'no-referrer';
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => { loading = null; reject(new Error('No se pudo cargar el generador de QR.')); };
    document.head.append(s);
  });
  return loading;
}

/** Dibuja `text` como QR dentro de `canvas`. Devuelve el canvas. */
export async function drawQR(canvas, text, { size = 240, margin = 2 } = {}) {
  const qrcode = await loadLib();
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const modules = qr.getModuleCount();
  const total = modules + margin * 2;
  const cell = Math.floor((size * (window.devicePixelRatio || 1)) / total);
  const px = cell * total;

  canvas.width = px;
  canvas.height = px;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#17171B';
  for (let r = 0; r < modules; r += 1) {
    for (let c = 0; c < modules; c += 1) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    }
  }
  return canvas;
}

/** Descarga el contenido del canvas como PNG (para escanearlo desde la galería). */
export function downloadCanvas(canvas, filename) {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}
