// QR de cada local para los carteles: un SVG por local que abre <BASE_URL>/r/<código>.
// Uso: node scripts/qr_locales.js https://md58club.com <carpeta_salida>
'use strict';
const fs = require('fs'), path = require('path');
const qrcode = require('../public/vendor/qrcode.js');
const { locales } = require('../locales.json');
const [base = 'https://md58club.com', out = 'qr_locales'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
for (const [cod, l] of Object.entries(locales)) {
  const url = `${base.replace(/\/$/, '')}/r/${cod}`;
  const q = qrcode(0, 'Q'); q.addData(url); q.make();
  fs.writeFileSync(path.join(out, `QR_${cod}.svg`), q.createSvgTag({ cellSize: 10, margin: 4, scalable: true }));
  console.log(`${l.nombre.padEnd(32)} ${url}`);
}
