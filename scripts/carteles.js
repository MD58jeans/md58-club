// Uso: node scripts/qr_locales.js https://md58club.com <out>/qr && NODE_PATH=$(npm root -g) node scripts/carteles.js <carpeta club> <out>
// Arma los carteles A4 (uno por local) y el instructivo para vendedores, en PDF.
// Diseño (Axel, 27/11/2026): identidad MD58 · navy #1D2046, crudo #F2EEE6, acento naranja chico, Montserrat, logotipo MD58 en curvas.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const [club, out] = process.argv.slice(2);
const { locales } = require(path.join(club, 'locales.json'));
// Logotipo MD58 (blanco) de public/iconos/logo-md58.svg, el mismo de la app.
const logo = fs.readFileSync(path.join(club, 'public', 'iconos', 'logo-md58.svg'), 'utf8');
const fuente = '<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">';
const css = `@page{size:A4;margin:0}*{box-sizing:border-box}
:root{--navy:#1D2046;--crudo:#F2EEE6;--gris:#53565A;--naranja:#E8692A}
body{margin:0;font-family:Montserrat,Inter,sans-serif;color:var(--navy);background:var(--crudo)}
.p{width:210mm;height:297mm;background:var(--crudo);display:flex;flex-direction:column;align-items:center;text-align:center;overflow:hidden;page-break-after:always}
.banda{background:var(--navy);width:100%;padding:15mm 0 12mm;display:flex;flex-direction:column;align-items:center;gap:5mm}
.banda svg{height:20mm;width:auto;display:block}
.banda .club{color:#fff;font-weight:500;font-size:15pt;letter-spacing:14pt;margin-right:-14pt}
.cuerpo{flex:1;width:100%;padding:13mm 18mm 0;display:flex;flex-direction:column;align-items:center}
.titulo{font-weight:300;font-size:21pt;letter-spacing:5pt;text-transform:uppercase;margin:0}
.of{font-weight:700;font-size:66pt;line-height:1;margin:6mm 0 0;letter-spacing:-1pt}
.acento{width:22mm;height:1.6mm;background:var(--naranja);margin:5mm 0 4mm}
.sub{font-weight:400;font-size:15pt;margin:0}
.legal{font-weight:400;font-size:9.5pt;letter-spacing:.6pt;color:var(--gris);margin:2.5mm 0 0;text-transform:uppercase}
.qr{margin-top:10mm;width:92mm;height:92mm;background:#fff;border:.6mm solid var(--navy);padding:4mm}
.qr svg{width:100%;height:100%;display:block}
.pasos{font-weight:500;font-size:12.5pt;margin:7mm 0 0;line-height:1.5}.pasos span{font-weight:300}
.pie{width:100%;padding:0 18mm 12mm;margin-top:auto}
.pie .l{border-top:.35mm solid var(--navy);padding-top:4mm;display:flex;justify-content:space-between;align-items:baseline;font-size:10pt;letter-spacing:1.5pt;text-transform:uppercase}
.pie .l b{font-weight:600}
.claim{font-weight:300;font-size:9.5pt;letter-spacing:2pt;text-transform:uppercase;color:var(--gris);margin-top:3mm}
.ins{width:210mm;min-height:297mm;background:var(--crudo);font-size:11.5pt;line-height:1.45}
.ins .banda{padding:9mm 0 7mm;gap:3mm}.ins .banda svg{height:11mm}.ins .banda .club{font-size:10pt;letter-spacing:9pt;margin-right:-9pt}
.ins .txt{padding:9mm 16mm 12mm}
.ins h1{font-weight:300;font-size:17pt;letter-spacing:3pt;text-transform:uppercase;margin:0 0 4mm}
.ins h2{font-weight:600;font-size:11.5pt;letter-spacing:1.5pt;text-transform:uppercase;margin:6mm 0 2mm}
.ins .box{background:#fff;border-left:1.6mm solid var(--navy);padding:4mm 5mm;margin:3mm 0}
.ins ol,.ins ul{margin:1mm 0 0 5mm;padding-left:4mm}.ins .no{color:#a40000}.ins .chico{margin-top:6mm;color:var(--gris);font-size:10pt}`;
const banda = `<div class="banda">${logo}<div class="club">CLUB</div></div>`;
const cartel = (nombre, svg) => `<div class="p">${banda}
  <div class="cuerpo"><p class="titulo">Sumate al MD58 Club</p><p class="of">15% OFF</p><div class="acento"></div>
  <p class="sub">en tu compra de enero · es gratis</p><p class="legal">Del 2 al 31 de enero · No acumulable con otras promociones</p>
  <div class="qr">${svg}</div>
  <p class="pasos">Escaneá el código con la cámara del celular<br><span>y registrate en 1 minuto.</span></p></div>
  <div class="pie"><div class="l"><b>md58club.com</b><span>Local: ${nombre}</span></div><div class="claim">Somos tu próxima marca favorita</div></div></div>`;
let html = `<html><head><meta charset="utf-8">${fuente}<style>${css}</style></head><body>`;
for (const [cod, l] of Object.entries(locales)) html += cartel(l.nombre, fs.readFileSync(path.join(out, 'qr', `QR_${cod}.svg`), 'utf8'));
html += '</body></html>';
const ins = `<html><head><meta charset="utf-8">${fuente}<style>${css}</style></head><body><div class="ins">${banda}<div class="txt">
<h1>Instructivo para vendedores</h1>
<p>Desde el <b>1 de diciembre</b> ofrecemos el <b>MD58 Club</b> en cada venta. Es gratis para el cliente y le regala <b>15% OFF en su compra de enero</b>. Para MD58 es clave: así sabemos quién compra, qué y cuándo, y lo podemos volver a traer.</p>
<h2>En cada venta, 2 cosas</h2>
<div class="box"><b>1. Después de facturar, cargá el DNI en md58club.com/caja</b> (celular o compu de caja, con la clave del local).<br>
Escribí el <b>DNI</b> (sin puntos) y los <b>últimos 2 números de la factura</b> (fiscal o manual) → <b>Guardar</b>. Son 5 segundos.<br>
Aunque el cliente no quiera sumarse al Club, si te da el DNI, cargalo igual.</div>
<div class="box"><b>2. Ofrecé el Club:</b> "¿Ya sos del MD58 Club? Escaneá este QR, te registrás en un minuto y te regalamos 15% para enero."<br>
El cliente escanea el cartel con la cámara y completa sus datos <b>él mismo</b> (nombre, DNI, celular, mail y fecha de nacimiento).</div>
<h2>Si te preguntan</h2>
<ul><li><b>¿Cuándo uso el 15%?</b> Del 2 al 31 de enero, en cualquier local MD58, una sola vez. <b>No se acumula con otras promociones.</b> Lo ve en su tarjeta digital del celular.</li>
<li><b>¿Me van a llenar de mensajes?</b> No. Solo si acepta recibir novedades, y como mucho 2 por mes. Se puede dar de baja cuando quiera.</li>
<li><b>¿Tengo que bajar una app?</b> No hace falta. Se abre en el navegador; si quiere, la guarda en la pantalla de inicio.</li>
<li><b>Ya me registré y perdí la tarjeta.</b> Que entre a md58club.com → "Abrí tu tarjeta" y pone su DNI: le llega un mail para recuperarla.</li></ul>
<h2>Importante</h2>
<ul><li class="no">No completes el registro por el cliente ni con tus datos: cada registro queda asociado al local y se controla.</li>
<li class="no">No anotes DNI ni celulares de clientes en papeles, cuadernos ni WhatsApp.</li>
<li>Cuantos más socios sume tu local, mejor: vamos a mostrar el ranking por local.</li></ul>
<p class="chico">Dudas: con tu supervisor.</p>
</div></div></body></html>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent(html, { waitUntil: 'networkidle' }); await p.pdf({ path: path.join(out, 'MD58_Club_carteles_17_locales_A4.pdf'), format: 'A4', printBackground: true });
  await p.setViewportSize({ width: 794, height: 1123 }); await p.screenshot({ path: path.join(out, 'muestra_cartel.png'), clip: { x: 0, y: 0, width: 794, height: 1123 } });
  await p.setContent(ins, { waitUntil: 'networkidle' }); await p.pdf({ path: path.join(out, 'MD58_Club_instructivo_vendedores.pdf'), format: 'A4', printBackground: true });
  await p.screenshot({ path: path.join(out, 'muestra_instructivo.png'), fullPage: true });
  await b.close();
})();
