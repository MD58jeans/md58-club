// Prueba de la app en navegador (iPhone y Android emulados) con capturas. No corre en `npm test` (necesita Chromium).
// Uso: TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres NODE_PATH=$(npm root -g) node test/ui_playwright.js <carpeta_capturas>
'use strict';
const assert = require('assert');
const { chromium, devices } = require('playwright');
const { Pool } = require('pg');
const webpush = require('web-push');
const { migrar } = require('../lib/db');
const { crearApp } = require('../server');

(async () => {
  const OUT = process.argv[2] || '.'; const ADMIN = process.env.TEST_DATABASE_URL; const DB = 'md58club_ui_' + process.pid;
  const admin = new Pool({ connectionString: ADMIN }); await admin.query(`CREATE DATABASE ${DB}`);
  const pool = new Pool({ connectionString: ADMIN.replace(/\/[^/]*$/, '/' + DB) }); await migrar(pool);
  const v = webpush.generateVAPIDKeys();
  const app = crearApp({ pool, env: { SECRET: 'u'.repeat(40), BASE_URL: 'http://127.0.0.1', PANEL_USUARIOS: 'Braian:clave-larga-1', VAPID_PUBLIC: v.publicKey, VAPID_PRIVATE: v.privateKey, CONTACTO_DATOS: 'el mail de contacto del Club' } });
  await new Promise(r => app.listen(0, '127.0.0.1', r)); const BASE = 'http://127.0.0.1:' + app.address().port;
  const b = await chromium.launch(); let ok = 0;
  try {
    for (const [nombre, disp, dni, cel] of [['iphone', devices['iPhone 13'], '31000001', '11 5555 0001'], ['android', devices['Pixel 7'], '31000002', '011 15 5555 0002']]) {
      const ctx = await b.newContext({ ...disp, locale: 'es-AR' }); const p = await ctx.newPage();
      const errores = []; p.on('pageerror', e => errores.push(e.message)); p.on('console', m => m.type() === 'error' && errores.push(m.text()));
      await p.goto(BASE + '/r/la_esquina'); await p.waitForSelector('form');
      await p.screenshot({ path: `${OUT}/club_${nombre}_1_registro.png`, fullPage: true });
      await p.click('button[type=submit]'); await p.waitForSelector('.campo-error');
      await p.screenshot({ path: `${OUT}/club_${nombre}_2_errores.png`, fullPage: true });
      await p.fill('[name=nombre]', 'Lucía'); await p.fill('[name=apellido]', 'Gómez'); await p.fill('[name=dni]', dni); await p.fill('[name=celular]', cel);
      await p.fill('[name=email]', `lucia.${nombre}@ejemplo.com`); await p.fill('[name=nacimiento]', '1995-03-21');
      await p.check('[name=acepta_datos]'); await p.check('[name=acepta_promos]');
      await p.click('button[type=submit]'); await p.waitForSelector('.tarjeta');
      assert.match(p.url(), /\/t\//);
      const txt = await p.textContent('main');
      assert.ok(txt.includes('Lucía Gómez') && txt.includes('15% OFF') && txt.includes('2/1 al 31/1'), txt);
      assert.ok(await p.$('.t-qr svg'), 'falta el QR');
      if (nombre === 'iphone') assert.ok(await p.isVisible('[data-ios]') && txt.includes('Agregar a inicio'));
      else assert.ok(await p.isVisible('[data-android]'));
      const man = await p.getAttribute('#manifest', 'href'); assert.match(man, /\?t=/);
      await p.screenshot({ path: `${OUT}/club_${nombre}_3_tarjeta.png`, fullPage: true });
      await p.reload(); await p.waitForSelector('.tarjeta');                         // la sesión queda guardada
      await p.goto(BASE + '/'); await p.waitForSelector('.tarjeta');                 // y abre la tarjeta desde el inicio
      assert.deepEqual(errores.filter(e => !/favicon|status of 422/.test(e)), []);   // el 422 es el envío vacío a propósito
      await ctx.close(); ok++; console.log('ok -', nombre);
    }
    const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, httpCredentials: { username: 'Braian', password: 'clave-larga-1' } });
    const p = await ctx.newPage(); await p.goto(BASE + '/panel'); await p.waitForSelector('.kpi');
    assert.ok((await p.textContent('#kpis')).includes('socios registrados'));
    await p.screenshot({ path: `${OUT}/club_panel.png`, fullPage: true }); ok++; console.log('ok - panel');
    const t = await (await b.newPage()).goto(BASE + '/terminos'); console.log('ok - terminos', t.status());
  } finally { await b.close(); app.close(); await pool.end(); await admin.query(`DROP DATABASE ${DB} WITH (FORCE)`); await admin.end(); }
  console.log(`\n${ok} pruebas de navegador OK`);
})().catch(e => { console.error(e); process.exit(1); });
