// Pruebas del MD58 Club contra un Postgres REAL (se crea una base temporal y se borra al final).
// Necesita TEST_DATABASE_URL apuntando a un Postgres donde se pueda crear bases (ej. el local de scripts/pg_local.sh):
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Pool } = require('pg');
const { migrar } = require('../lib/db');
const validar = require('../lib/validar');
const tok = require('../lib/token');
const { crearApp } = require('../server');
const { enviados } = require('../lib/correo');
const { leerCsv, importar } = require('../scripts/importar_historicos');

const ADMIN = process.env.TEST_DATABASE_URL;
if (!ADMIN) { console.error('Falta TEST_DATABASE_URL (ver scripts/pg_local.sh)'); process.exit(1); }
const NOMBRE_DB = 'md58club_test_' + process.pid;
const SECRET = 'x'.repeat(40);
let admin, pool, server, base, env;

const auth = (u, c) => 'Basic ' + Buffer.from(u + ':' + c).toString('base64');
async function pedir(metodo, ruta, { cuerpo, headers = {} } = {}) {
  const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...headers }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: r.status, j, txt, h: r.headers };
}
let n = 0;
const socio = (extra = {}) => ({ codigo_local: 'las_vegas', nombre: 'Ana', apellido: 'Prueba', dni: String(30000000 + (++n)), celular: '11' + String(40000000 + n),
  email: `socio${n}@ejemplo.com`, nacimiento: '1990-05-10', acepta_datos: true, acepta_promos: false, ...extra });
const registrar = d => pedir('POST', '/api/registro', { cuerpo: d });

test.before(async () => {
  admin = new Pool({ connectionString: ADMIN });
  await admin.query(`CREATE DATABASE ${NOMBRE_DB}`);
  pool = new Pool({ connectionString: ADMIN.replace(/\/[^/]*$/, '/' + NOMBRE_DB) });
  await migrar(pool);
  env = { SECRET, BASE_URL: 'https://md58club.com', PANEL_USUARIOS: 'Braian:clave-larga-1', CAJA_ACTIVA: '1', CAJA_CLAVES: 'las_vegas:caja-clave-1', LIMITE_REGISTRO: '1000' };
  server = crearApp({ pool, env });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => {
  server.close(); await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${NOMBRE_DB} WITH (FORCE)`); await admin.end();
});

test('validaciones: DNI, celular, email, fecha', () => {
  assert.equal(validar.dni('30.123.456'), '30123456'); assert.equal(validar.dni('1234567'), '1234567'); assert.equal(validar.dni('123'), null);
  for (const c of ['11 2345 6789', '011 15 2345 6789', '+54 9 11 2345-6789', '1123456789', '541123456789', '5491123456789']) assert.equal(validar.celular(c), '5491123456789', c);
  assert.equal(validar.celular('2323 15 45-6789'), '5492323456789');
  assert.equal(validar.celular('341 15 456 7890'), '5493414567890');
  assert.equal(validar.celular('15 4567 890'), null); assert.equal(validar.celular('123'), null);
  assert.equal(validar.email(' Ana@Ejemplo.COM '), 'ana@ejemplo.com'); assert.equal(validar.email('ana@'), null);
  assert.equal(validar.nacimiento('1990-02-31'), null); assert.equal(validar.nacimiento('2020-01-01', new Date('2026-11-26')), null); assert.equal(validar.nacimiento('1990-05-10'), '1990-05-10');
  const v = validar.registro({ nombre: '<b>', acepta_datos: false });
  assert.ok(!v.ok && v.errores.nombre && v.errores.acepta_datos && v.errores.email);
});

test('tokens: firma, adulteración y vencimiento', () => {
  const t = tok.firmar(SECRET, { t: 's', id: 'a' });
  assert.deepEqual(tok.verificar(SECRET, t), { t: 's', id: 'a' });
  assert.equal(tok.verificar('otro'.repeat(10), t), null);
  assert.equal(tok.verificar(SECRET, t.slice(0, -2) + 'xx'), null);
  assert.equal(tok.verificar(SECRET, tok.firmar(SECRET, { t: 'e', exp: Date.now() - 1 })), null);
});

test('alta: token, tarjeta con 15% para enero, consentimientos y email de confirmación', async () => {
  const d = socio({ acepta_promos: true });
  const r = await registrar(d);
  assert.equal(r.status, 200); assert.ok(r.j.token);
  const t = await pedir('GET', '/api/socio/tarjeta', { headers: { Authorization: 'Bearer ' + r.j.token } });
  assert.equal(t.status, 200);
  assert.equal(t.j.dni, d.dni); assert.equal(t.j.promos, true); assert.equal(t.j.email_verificado, false);
  assert.equal(t.j.beneficios.length, 1); const b = t.j.beneficios[0];
  assert.equal(b.porcentaje, 15); assert.match(b.codigo, /^MD-[A-Z2-9]{8}$/);
  assert.equal(new Date(b.desde).toISOString().slice(0, 10), '2027-01-02'); assert.equal(new Date(b.hasta).toISOString().slice(0, 10), '2027-01-31');
  assert.ok(t.j.qr.startsWith('MD58C:'));
  const k = (await pool.query("SELECT tipo, valor FROM consentimientos c JOIN clientes x ON x.id=c.cliente_id WHERE x.dni=$1 ORDER BY tipo", [d.dni])).rows;
  assert.deepEqual(k, [{ tipo: 'datos', valor: true }, { tipo: 'promos', valor: true }]);
  const cl = (await pool.query('SELECT local_alta, celular, estado FROM clientes WHERE dni=$1', [d.dni])).rows[0];
  assert.deepEqual(cl, { local_alta: 'LV', celular: '549' + d.celular, estado: 'registrado' });
  await new Promise(r => setTimeout(r, 50));
  const mail = enviados.filter(e => e.para === d.email).pop(); assert.ok(mail && /\/v\//.test(mail.texto));
  const link = mail.texto.match(/\/v\/([\w.-]+)/)[1];
  assert.equal((await pedir('POST', '/api/verificar-email', { cuerpo: { token: link } })).j.ok, true);
  assert.equal((await pool.query('SELECT email_verificado FROM clientes WHERE dni=$1', [d.dni])).rows[0].email_verificado, true);
});

test('duplicados: mismo socio, mismo DNI con otro celular, mismo celular con otro DNI', async () => {
  const d = socio(); assert.equal((await registrar(d)).status, 200);
  const otra = await registrar({ ...d });                                      // de nuevo, mismos datos
  assert.equal(otra.j.ya_socio, true); assert.ok(!otra.j.token);              // no entrega sesión: manda el link al email
  await new Promise(r => setTimeout(r, 50));
  assert.ok(enviados.some(e => e.para === d.email && /Tu tarjeta/.test(e.asunto)));
  const c1 = await registrar({ ...socio(), dni: d.dni });                      // mismo DNI, otro celular
  assert.equal(c1.status, 409); assert.equal(c1.j.conflicto, true);
  const c2 = await registrar({ ...socio(), celular: d.celular });              // mismo celular, otro DNI
  assert.equal(c2.status, 409);
  assert.equal((await pool.query('SELECT count(*)::int n FROM clientes WHERE dni=$1 OR celular=$2', [d.dni, '549' + d.celular])).rows[0].n, 1);
  assert.ok((await pool.query("SELECT count(*)::int n FROM auditoria WHERE tipo='conflicto'")).rows[0].n >= 2);
});

test('históricos: importar y después registrarse se une (sin duplicar); conflictos no se fusionan', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md58club-'));
  const csv = path.join(dir, 'base.csv');
  fs.writeFileSync(csv, '﻿telefono,nombre,dni,locales,origenes,consentimiento,revisar\n' +
    '5491150000001,"Pérez, Juan",,LV Las Vegas,contactos_local,no,\n' +
    '5491150000002,Marta,25111222,LVP Pilar,tarjetas,no,\n' +
    '5491150000003,Flete Rápido,,LV Las Vegas,contactos_local,no,posible no cliente\n' +
    '123,Mal,,,,no,\n' +
    '5491150000004,Hist4,,LV,contactos_local,no,\n5491150000005,Hist5,26000005,LV,tarjetas,no,\n');
  assert.equal(leerCsv(fs.readFileSync(csv, 'utf8'))[0].nombre, 'Pérez, Juan');
  const t = await importar(pool, csv);
  assert.deepEqual({ nuevas: t.nuevas, invalidas: t.invalidas, salteadas: t.salteadas_por_revisar }, { nuevas: 4, invalidas: 1, salteadas: 1 });
  // histórico por celular (sin DNI) que se registra
  const r1 = await registrar(socio({ celular: '1150000001', dni: '27000001' }));
  assert.equal(r1.status, 200);
  const h1 = (await pool.query("SELECT estado, dni, fecha_alta IS NOT NULL alta, origen_historico FROM clientes WHERE celular='5491150000001'")).rows;
  assert.equal(h1.length, 1); assert.deepEqual(h1[0], { estado: 'registrado', dni: '27000001', alta: true, origen_historico: 'contactos_local' });
  // histórico por DNI con celular viejo: se registra con celular nuevo
  const r2 = await registrar(socio({ dni: '25111222', celular: '1160000002' }));
  assert.equal(r2.status, 200);
  assert.equal((await pool.query("SELECT celular FROM clientes WHERE dni='25111222'")).rows[0].celular, '5491160000002');
  // DNI de un histórico + celular de otro histórico → conflicto, no se fusionan
  const r3 = await registrar(socio({ dni: '26000005', celular: '1150000004' }));
  assert.equal(r3.status, 409);
  // reimportar no pisa a los registrados
  const t2 = await importar(pool, csv);
  assert.ok(t2.ya_socios >= 2);
  assert.equal((await pool.query("SELECT estado FROM clientes WHERE celular='5491150000001'")).rows[0].estado, 'registrado');
  fs.rmSync(dir, { recursive: true });
});

test('sesión: token inválido, versión revocada y datos de otro socio', async () => {
  assert.equal((await pedir('GET', '/api/socio/tarjeta', { headers: { Authorization: 'Bearer basura' } })).status, 401);
  const a = await registrar(socio()), b = await registrar(socio());
  const ta = await pedir('GET', '/api/socio/tarjeta', { headers: { Authorization: 'Bearer ' + a.j.token } });
  const tb = await pedir('GET', '/api/socio/tarjeta', { headers: { Authorization: 'Bearer ' + b.j.token } });
  assert.notEqual(ta.j.dni, tb.j.dni);
  const id = tok.verificar(SECRET, a.j.token).id;
  await pool.query('UPDATE clientes SET token_version = token_version + 1 WHERE id=$1', [id]);
  assert.equal((await pedir('GET', '/api/socio/tarjeta', { headers: { Authorization: 'Bearer ' + a.j.token } })).status, 401);
});

test('recuperar: misma respuesta siempre; manda link solo si es socio', async () => {
  const d = socio(); await registrar(d);
  const antes = enviados.length;
  const x = await pedir('POST', '/api/recuperar', { cuerpo: { dni: '11111111' } });
  const y = await pedir('POST', '/api/recuperar', { cuerpo: { dni: d.dni } });
  assert.equal(x.j.mensaje, y.j.mensaje);
  assert.equal(enviados.length, antes + 1); assert.match(enviados[enviados.length - 1].texto, /\/t\//);
});

test('app instalada y notificaciones: suben el estado', async () => {
  const r = await registrar(socio()); const H = { Authorization: 'Bearer ' + r.j.token };
  assert.equal((await pedir('POST', '/api/socio/instalada', { headers: H })).status, 200);
  assert.equal((await pedir('POST', '/api/socio/push', { headers: H, cuerpo: { suscripcion: { endpoint: 'http://malo' } } })).status, 400);
  const sub = { endpoint: 'https://push.ejemplo.com/abc' + n, keys: { p256dh: 'BOr' + 'a'.repeat(60), auth: 'x'.repeat(16) } };
  assert.equal((await pedir('POST', '/api/socio/push', { headers: H, cuerpo: { suscripcion: sub, plataforma: 'ios' } })).status, 200);
  const id = tok.verificar(SECRET, r.j.token).id;
  const c = (await pool.query('SELECT estado, app_instalada_en IS NOT NULL a, notificaciones_en IS NOT NULL n FROM clientes WHERE id=$1', [id])).rows[0];
  assert.deepEqual(c, { estado: 'notificaciones', a: true, n: true });
  await pedir('POST', '/api/socio/promos', { headers: H, cuerpo: { valor: true } });
  assert.equal((await pedir('GET', '/api/socio/tarjeta', { headers: H })).j.promos, true);
});

test('panel: con clave, resumen, export auditado y prueba de push protegida', async () => {
  assert.equal((await pedir('GET', '/panel')).status, 401);
  assert.equal((await pedir('GET', '/panel/api/resumen', { headers: { Authorization: auth('Braian', 'mala-clave-9') } })).status, 401);
  const A = { Authorization: auth('Braian', 'clave-larga-1') };
  const r = await pedir('GET', '/panel/api/resumen', { headers: A });
  assert.equal(r.status, 200); assert.ok(r.j.totales.socios > 0); assert.ok(r.j.porLocal.find(x => x.local === 'LV'));
  assert.ok(r.j.totales.historicos >= 1);
  const csv = await pedir('GET', '/panel/export.csv', { headers: A });
  assert.equal(csv.status, 200); assert.ok(csv.txt.includes('id,dni,nombre')); assert.match(csv.h.get('content-disposition'), /attachment/);
  assert.ok((await pool.query("SELECT count(*)::int n FROM auditoria WHERE tipo='export' AND quien='Braian'")).rows[0].n >= 1);
  assert.equal((await pedir('POST', '/panel/api/push-prueba', { headers: A, cuerpo: { dni: '1' } })).status, 403);
});

test('caja (plan B): clave por local, busca mostrando lo mínimo y guarda el comprobante una vez', async () => {
  const d = socio(); const s = await registrar(d);
  assert.equal((await pedir('GET', '/caja')).status, 401);
  const C = { Authorization: auth('las_vegas', 'caja-clave-1'), 'X-Caja': '1' };
  assert.equal((await pedir('POST', '/caja/api/buscar', { headers: { Authorization: C.Authorization }, cuerpo: { dni: d.dni } })).status, 403);
  const b = await pedir('POST', '/caja/api/buscar', { headers: C, cuerpo: { dni: d.dni } });
  assert.deepEqual(b.j, { socio: true, nombre: 'Ana P.' });
  assert.deepEqual((await pedir('POST', '/caja/api/buscar', { headers: C, cuerpo: { dni: '99999999' } })).j, { socio: false });
  const qr = (await pedir('GET', '/api/socio/tarjeta', { headers: { Authorization: 'Bearer ' + s.j.token } })).j.qr;
  assert.equal((await pedir('POST', '/caja/api/buscar', { headers: C, cuerpo: { qr } })).j.dni, d.dni);
  assert.equal((await pedir('POST', '/caja/api/compra', { headers: C, cuerpo: { dni: d.dni, comprobante: 'B-0001-00012345', fin: '45' } })).status, 200);
  assert.equal((await pedir('POST', '/caja/api/compra', { headers: C, cuerpo: { dni: d.dni, comprobante: 'B-0001-00012345', fin: '45' } })).status, 409);
  const cc = (await pool.query('SELECT local, cargado_por FROM compras_caja WHERE comprobante=$1', ['B-0001-00012345'])).rows[0];
  assert.deepEqual(cc, { local: 'LV', cargado_por: 'caja:las_vegas' });
});

test('caja apagada (CAJA_ACTIVA distinto de 1) no existe', async () => {
  const s2 = crearApp({ pool, env: { ...env, CAJA_ACTIVA: '0' } });
  await new Promise(r => s2.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${s2.address().port}/caja`, { headers: { Authorization: auth('las_vegas', 'caja-clave-1') } });
  assert.equal(r.status, 404); s2.close();
});

test('límite de registros por IP', async () => {
  const s2 = crearApp({ pool, env: { ...env, LIMITE_REGISTRO: '2' } });
  await new Promise(r => s2.listen(0, '127.0.0.1', r));
  const u = `http://127.0.0.1:${s2.address().port}/api/registro`;
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(socio()) })).status);
  assert.deepEqual(codes, [200, 200, 429]); s2.close();
});

test('seguridad: cabeceras, rutas inexistentes, QR de local inválido, cuerpo grande', async () => {
  const r = await pedir('GET', '/r/las_vegas');
  assert.equal(r.status, 200); assert.match(r.h.get('content-security-policy'), /default-src 'self'/); assert.equal(r.h.get('x-frame-options'), 'DENY');
  assert.equal((await pedir('GET', '/iconos/../server.js')).status, 404);
  assert.equal((await pedir('GET', '/api/local/no_existe')).status, 404);
  assert.equal((await registrar(socio({ codigo_local: 'no_existe' }))).status, 400);
  const grande = await fetch(base + '/api/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(50000) }) }).catch(() => ({ status: 413 }));
  assert.equal(grande.status, 413);
  const m = await pedir('GET', '/manifest.webmanifest?t=' + (await registrar(socio())).j.token);
  assert.match(m.j.start_url, /^\/t\//);
  assert.equal((await pedir('GET', '/manifest.webmanifest?t=falso')).j.start_url, '/tarjeta');
});

test('claves de notificaciones: se generan una vez y se reutilizan', async () => {
  const { clavesVapid } = require('../server');
  const a = await clavesVapid(pool, {});
  assert.ok(a.VAPID_PUBLIC && a.VAPID_PRIVATE);
  const b = await clavesVapid(pool, {});
  assert.deepEqual(a, b);                                                   // el segundo arranque usa las mismas
  assert.deepEqual(await clavesVapid(pool, { VAPID_PUBLIC: 'x', VAPID_PRIVATE: 'y' }), {});   // si vienen por variable, mandan esas
});

test('email por Resend: manda bien, y si falla no rompe; sin clave queda en consola', async () => {
  const { crearCorreo } = require('../lib/correo');
  const llamadas = [];
  const ok = crearCorreo({ EMAIL_PROVEEDOR: 'resend', RESEND_API_KEY: 'k' }, async (url, o) => { llamadas.push({ url, o }); return { ok: true, status: 200, text: async () => '' }; });
  assert.equal(ok.proveedor, 'resend');
  assert.deepEqual(await ok.enviar({ para: 'a@b.com', asunto: 'x', texto: 'y' }), { ok: true });
  assert.equal(llamadas[0].url, 'https://api.resend.com/emails');
  const cuerpo = JSON.parse(llamadas[0].o.body); assert.equal(cuerpo.from, 'MD58 Club <club@md58club.com>'); assert.deepEqual(cuerpo.to, ['a@b.com']);
  const mal = crearCorreo({ EMAIL_PROVEEDOR: 'resend', RESEND_API_KEY: 'k' }, async () => ({ ok: false, status: 403, text: async () => 'dominio sin verificar' }));
  assert.deepEqual(await mal.enviar({ para: 'a@b.com', asunto: 'x', texto: 'y' }), { ok: false });
  const caido = crearCorreo({ EMAIL_PROVEEDOR: 'resend', RESEND_API_KEY: 'k' }, async () => { throw new Error('sin red'); });
  assert.deepEqual(await caido.enviar({ para: 'a@b.com', asunto: 'x', texto: 'y' }), { ok: false });
  assert.equal(crearCorreo({ EMAIL_PROVEEDOR: 'resend' }).proveedor, 'consola');
});

test('panel: subir base histórica por CSV (con clave, no duplica, saltea "revisar")', async () => {
  const csv = 'telefono,nombre,dni,locales,origenes,consentimiento,revisar\n' +
    '5491170000001,Hist Panel 1,,LV Las Vegas,contactos_local,no,\n' +
    '5491170000002,Flete,,LV Las Vegas,contactos_local,no,posible no cliente\n' +
    '1170000003,Hist Panel 3,27000003,Pilar,tarjetas,no,\n';
  const sinClave = await fetch(base + '/panel/api/importar-historicos', { method: 'POST', headers: { 'X-Panel': '1' }, body: csv });
  assert.equal(sinClave.status, 401);
  const h = { Authorization: auth('Braian', 'clave-larga-1'), 'X-Panel': '1', 'Content-Type': 'text/csv' };
  const sinX = await fetch(base + '/panel/api/importar-historicos', { method: 'POST', headers: { Authorization: h.Authorization }, body: csv });
  assert.equal(sinX.status, 403);
  let r = await fetch(base + '/panel/api/importar-historicos', { method: 'POST', headers: h, body: csv }); let d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.nuevas, 2); assert.equal(d.salteadas_por_revisar, 1);
  r = await fetch(base + '/panel/api/importar-historicos', { method: 'POST', headers: h, body: csv }); d = await r.json();
  assert.equal(d.nuevas, 0); assert.equal(d.actualizadas, 2);   // subirla de nuevo no duplica
  r = await fetch(base + '/panel/api/importar-historicos', { method: 'POST', headers: h, body: 'a,b\n1,2\n' });
  assert.equal(r.status, 400);
});

test('migración 003: corrige la bienvenida cargada con enero 2026 a enero 2027', async () => {
  const fs = require('fs'), path = require('path');
  const c = (await pool.query("INSERT INTO clientes (dni, celular, nombre, estado) VALUES ('39000001','5491179000001','Mig','registrado') RETURNING id")).rows[0];
  await pool.query("INSERT INTO beneficios (cliente_id, tipo, porcentaje, vigencia_desde, vigencia_hasta, codigo) VALUES ($1,'bienvenida',15,'2026-01-02','2026-01-31','MD-MIGTEST1')", [c.id]);
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migraciones', '003_bienvenida_2027.sql'), 'utf8'));
  const b = (await pool.query("SELECT to_char(vigencia_desde,'YYYY-MM-DD') d, to_char(vigencia_hasta,'YYYY-MM-DD') h FROM beneficios WHERE codigo='MD-MIGTEST1'")).rows[0];
  assert.deepEqual(b, { d: '2027-01-02', h: '2027-01-31' });
});

test('iPhone: la página /t/<sesión> trae el manifest del socio (el ícono instalado abre su tarjeta)', async () => {
  const r = await registrar(socio()); assert.equal(r.status, 200);
  const t = r.j.token;
  const html = await (await fetch(base + '/t/' + t)).text();
  assert.ok(html.includes(`href="/manifest.webmanifest?t=${t}"`));
  const m = await (await fetch(base + '/manifest.webmanifest?t=' + t)).json();
  assert.equal(m.start_url, '/t/' + t);
  const falso = await (await fetch(base + '/t/token-falso')).text();
  assert.ok(falso.includes('href="/manifest.webmanifest"') && !falso.includes('?t=token-falso'));   // token inválido: manifest genérico
});

test('caja (plan B): guarda el DNI aunque no sea socio; claves derivadas y visibles solo en el panel', async () => {
  const C = { Authorization: auth('las_vegas', 'caja-clave-1'), 'X-Caja': '1' };
  const r = await pedir('POST', '/caja/api/compra', { headers: C, cuerpo: { dni: '30999001', comprobante: 'FCV B 0001-00099999', fin: '99' } });
  assert.equal(r.status, 200); assert.equal(r.j.socio, false);
  const cc = (await pool.query("SELECT dni, cliente_id FROM compras_caja WHERE comprobante='FCV B 0001-00099999'")).rows[0];
  assert.deepEqual(cc, { dni: '30999001', cliente_id: null });
  // Sin CAJA_CLAVES: cada local tiene su clave derivada, y el panel las muestra
  const env2 = { ...env, CAJA_CLAVES: '' }; const s2 = crearApp({ pool, env: env2 });
  await new Promise(ok => s2.listen(0, '127.0.0.1', ok)); const b2 = `http://127.0.0.1:${s2.address().port}`;
  const res = await (await fetch(b2 + '/panel/api/resumen', { headers: { Authorization: auth('Braian', 'clave-larga-1') } })).json();
  const lv = res.accesosCaja.find(a => a.usuario === 'las_vegas'); assert.ok(lv && lv.clave.length === 10);
  assert.equal((await fetch(b2 + '/caja', { headers: { Authorization: auth('las_vegas', lv.clave) } })).status, 200);
  assert.equal((await fetch(b2 + '/caja', { headers: { Authorization: auth('pilar', lv.clave) } })).status, 401);   // la clave de un local no abre otro
  const dep = res.accesosCaja.find(a => a.usuario === 'deposito'); assert.ok(dep);                                   // el depósito tiene caja…
  assert.equal((await fetch(b2 + '/caja', { headers: { Authorization: auth('deposito', dep.clave) } })).status, 200);
  assert.equal((await fetch(b2 + '/api/local/deposito')).status, 404);                                               // …pero no registro por QR
  await new Promise(ok => s2.close(ok));
});

test('caja rápida: DNI + últimos 2 números de la factura (obligatorios)', async () => {
  const C = { Authorization: auth('las_vegas', 'caja-clave-1'), 'X-Caja': '1' };
  for (const fin of ['68', '68']) { const r = await pedir('POST', '/caja/api/compra', { headers: C, cuerpo: { dni: '30999002', fin } }); assert.equal(r.status, 200, JSON.stringify(r.j)); }
  assert.equal((await pool.query("SELECT count(*)::int n FROM compras_caja WHERE dni='30999002' AND fin_factura='68' AND comprobante IS NULL")).rows[0].n, 2);
  assert.equal((await pedir('POST', '/caja/api/compra', { headers: C, cuerpo: { dni: '30999002' } })).status, 422);              // sin los 2 números
  assert.equal((await pedir('POST', '/caja/api/compra', { headers: C, cuerpo: { dni: '30999002', fin: '6' } })).status, 422);
  assert.equal((await pedir('POST', '/caja/api/compra', { headers: C, cuerpo: { dni: '12' } })).status, 422);
});

test('agente: lectura de cargas de caja solo con su clave', async () => {
  assert.equal((await pedir('GET', '/agente/api/compras-caja')).status, 401);
  assert.equal((await pedir('GET', '/agente/api/compras-caja', { headers: { Authorization: 'Bearer mala' } })).status, 401);
  const res = await (await fetch(base + '/panel/api/resumen', { headers: { Authorization: auth('Braian', 'clave-larga-1') } })).json();
  assert.equal(res.claveAgente.length, 32);
  const r = await pedir('GET', '/agente/api/compras-caja?desde=2020-01-01', { headers: { Authorization: 'Bearer ' + res.claveAgente } });
  assert.equal(r.status, 200); assert.ok(r.j.filas.some(f => f.fin_factura === '68'));
  const t = await pedir('GET', '/agente/api/resumen', { headers: { Authorization: 'Bearer ' + res.claveAgente } });
  assert.equal(t.status, 200); assert.ok(t.j.totales && Array.isArray(t.j.porHora)); assert.ok(!JSON.stringify(t.j).includes('@'));
});
