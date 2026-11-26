// MD58 Club · servidor (registro por QR, tarjeta PWA, notificaciones, panel de gerencia y caja Plan B).
// Correr: DATABASE_URL=... SECRET=... node server.js   (variables en README.md)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { crearPool, migrar } = require('./lib/db');
const validar = require('./lib/validar');
const tok = require('./lib/token');
const club = require('./lib/club');
const { crearCorreo } = require('./lib/correo');
const { crearPush } = require('./lib/push');
const { cabeceras, json, leerJson, usuarioBasic, pedirClave, limitador, ipDe } = require('./lib/http');

const LOCALES = require('./locales.json').locales;
const VENDEDORES = require('./vendedores.json').vendedores;
const PUB = path.join(__dirname, 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

function crearApp({ pool, env = process.env, correo = crearCorreo(env), push = crearPush(env) }) {
  const SECRET = env.SECRET;
  if (!SECRET || SECRET.length < 32) throw new Error('Falta SECRET (32+ caracteres al azar)');
  const BASE = (env.BASE_URL || 'http://localhost:' + (env.PORT || 8080)).replace(/\/$/, '');
  const limRegistro = limitador(Number(env.LIMITE_REGISTRO || 20), 10 * 60e3);   // por IP cada 10 min (un local con wifi compartido registra muchos)
  const limRecuperar = limitador(5, 10 * 60e3);
  const cajaActiva = env.CAJA_ACTIVA === '1';

  const sesion = cl => tok.firmar(SECRET, { t: 's', id: cl.id, v: cl.token_version });
  const linkVerificar = cl => `${BASE}/v/${tok.firmar(SECRET, { t: 'e', id: cl.id, email: cl.email, exp: Date.now() + 7 * 864e5 })}`;
  async function socioDe(req) {
    const h = req.headers.authorization || '';
    const d = tok.verificar(SECRET, h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!d || d.t !== 's') return null;
    const cl = await club.porId(pool, d.id);
    return cl && cl.fecha_alta && cl.token_version === d.v ? cl : null;
  }
  async function mandarVerificacion(cl) {
    await correo.enviar({ para: cl.email, asunto: 'Confirmá tu email · MD58 Club',
      texto: `Hola ${cl.nombre}! Bienvenido/a al MD58 Club.\n\nConfirmá tu email tocando este link:\n${linkVerificar(cl)}\n\nSi no fuiste vos, ignorá este mensaje.` });
  }
  async function mandarAcceso(cl) {
    await correo.enviar({ para: cl.email, asunto: 'Tu tarjeta MD58 Club',
      texto: `Hola ${cl.nombre}! Este es el link para abrir tu tarjeta del MD58 Club en este celular:\n${BASE}/t/${sesion(cl)}\n\nSi no lo pediste, ignorá este mensaje.` });
  }

  function estatico(res, archivo, cache = 'no-cache') {
    const p = path.join(PUB, archivo);
    if (!p.startsWith(PUB + path.sep) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { cabeceras(res); res.writeHead(404); res.end('No existe'); return; }
    const extra = { 'Content-Type': TIPOS[path.extname(p)] || 'application/octet-stream', 'Cache-Control': cache };
    if (archivo === 'sw.js') extra['Service-Worker-Allowed'] = '/';
    cabeceras(res, extra); res.writeHead(200); fs.createReadStream(p).pipe(res);
  }

  async function rutaPublica(req, res, url) {
    const p = url.pathname;
    if (req.method === 'GET' && p === '/salud') { cabeceras(res, { 'Content-Type': 'text/plain' }); res.end('ok'); return true; }
    if (req.method === 'GET' && (p === '/' || /^\/(r|t|v)\/[\w.-]+$/.test(p) || p === '/recuperar' || p === '/tarjeta' || p === '/terminos')) { estatico(res, 'index.html'); return true; }
    if (req.method === 'GET' && p === '/manifest.webmanifest') {
      // Manifest por socio: start_url lleva su sesión, así la app instalada (que en iPhone no comparte datos con Safari) abre su tarjeta.
      const t = url.searchParams.get('t'); const d = t && tok.verificar(SECRET, t);
      const m = { name: 'MD58 Club', short_name: 'MD58 Club', lang: 'es-AR', display: 'standalone', background_color: '#000000', theme_color: '#000000',
        start_url: d && d.t === 's' ? `/t/${t}` : '/tarjeta', scope: '/', id: '/md58-club',
        icons: [{ src: '/iconos/icono-192.png', sizes: '192x192', type: 'image/png' }, { src: '/iconos/icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/iconos/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] };
      cabeceras(res, { 'Content-Type': TIPOS['.webmanifest'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(m)); return true;
    }
    if (req.method === 'GET' && /^\/(app\.js|estilos\.css|panel\.css|sw\.js|panel\.js|caja\.js|vendor\/qrcode\.js|iconos\/[\w.-]+)$/.test(p)) { estatico(res, p.slice(1), p === '/sw.js' ? 'no-cache' : 'public, max-age=300'); return true; }

    if (req.method === 'GET' && p.startsWith('/api/local/')) {
      const cod = p.slice('/api/local/'.length); const l = LOCALES[cod];
      if (!l) return json(res, { error: 'local inexistente' }, 404), true;
      return json(res, { codigo: cod, nombre: l.nombre, vendedores: VENDEDORES[cod] || [] }), true;
    }
    if (req.method === 'GET' && p === '/api/textos') return json(res, { datos: club.TEXTO_DATOS, promos: club.TEXTO_PROMOS, bienvenida: club.BIENVENIDA, contacto: env.CONTACTO_DATOS || '' }), true;
    if (req.method === 'POST' && p === '/api/registro') {
      if (!limRegistro(ipDe(req))) return json(res, { error: 'Demasiados intentos, probá en unos minutos' }, 429), true;
      const b = await leerJson(req);
      const l = LOCALES[b.codigo_local];
      if (!l) return json(res, { error: 'Escaneá el QR del local para registrarte' }, 400), true;
      const v = validar.registro(b);
      if (!v.ok) return json(res, { errores: v.errores }, 422), true;
      if (v.datos.vendedor && !(VENDEDORES[b.codigo_local] || []).includes(v.datos.vendedor)) v.datos.vendedor = null;
      const r = await club.registrar(pool, v.datos, { codigo: b.codigo_local, znube: l.znube });
      if (r.resultado === 'alta' || r.resultado === 'union_historico') {
        mandarVerificacion(r.cliente).catch(e => console.error('email:', e.message));
        return json(res, { ok: true, token: sesion(r.cliente) }), true;
      }
      if (r.resultado === 'ya_socio') {
        mandarAcceso(r.cliente).catch(e => console.error('email:', e.message));
        return json(res, { ok: false, ya_socio: true, mensaje: '¡Ya sos socio del MD58 Club! Te mandamos a tu email el link para abrir tu tarjeta en este celular.' }), true;
      }
      return json(res, { ok: false, conflicto: true, mensaje: 'Ese DNI o celular ya está registrado con otros datos. Pedile ayuda al vendedor o escribinos y lo resolvemos.' }, 409), true;
    }
    if (req.method === 'POST' && p === '/api/recuperar') {
      if (!limRecuperar(ipDe(req))) return json(res, { error: 'Demasiados intentos, probá en unos minutos' }, 429), true;
      const b = await leerJson(req); const dni = validar.dni(b.dni);
      if (dni) { const cl = await club.porDni(pool, dni); if (cl && cl.fecha_alta && cl.email) { await mandarAcceso(cl); await club.auditar(pool, 'recuperar', cl.id, 'socio'); } }
      return json(res, { ok: true, mensaje: 'Si ese DNI es socio, te mandamos un link a tu email para abrir la tarjeta.' }), true;   // misma respuesta siempre
    }
    if (req.method === 'POST' && p === '/api/verificar-email') {
      const b = await leerJson(req); const d = tok.verificar(SECRET, b.token);
      if (!d || d.t !== 'e') return json(res, { ok: false }, 400), true;
      return json(res, { ok: await club.verificarEmail(pool, d.id, d.email) }), true;
    }
    if (p.startsWith('/api/socio/')) {
      const cl = await socioDe(req);
      if (!cl) return json(res, { error: 'sesión inválida' }, 401), true;
      if (req.method === 'GET' && p === '/api/socio/tarjeta') {
        const t = await club.tarjeta(pool, cl.id);
        return json(res, { nombre: t.nombre, apellido: t.apellido, dni: t.dni, email_verificado: t.email_verificado, estado: t.estado, promos: t.promos,
          beneficios: t.beneficios.map(b => ({ porcentaje: Number(b.porcentaje), desde: b.vigencia_desde, hasta: b.vigencia_hasta, estado: b.estado, codigo: b.codigo })),
          qr: 'MD58C:' + tok.firmar(SECRET, { t: 'c', id: cl.id }), push: push.clavePublica }), true;
      }
      if (req.method === 'POST' && p === '/api/socio/instalada') { await club.marcarInstalada(pool, cl.id); return json(res, { ok: true }), true; }
      if (req.method === 'POST' && p === '/api/socio/push') {
        const b = await leerJson(req);
        try { await club.guardarSuscripcion(pool, cl.id, b.suscripcion, String(b.plataforma || '').slice(0, 20)); } catch (e) { return json(res, { error: e.message }, 400), true; }
        return json(res, { ok: true }), true;
      }
      if (req.method === 'POST' && p === '/api/socio/promos') { const b = await leerJson(req); await club.cambiarPromos(pool, cl.id, b.valor === true); return json(res, { ok: true }), true; }
      if (req.method === 'POST' && p === '/api/socio/reenviar-email') { await mandarVerificacion(cl); return json(res, { ok: true }), true; }
      return json(res, { error: 'no existe' }, 404), true;
    }
    return false;
  }

  async function rutaPanel(req, res, url) {
    const quien = usuarioBasic(req.headers.authorization, env.PANEL_USUARIOS);
    if (!quien) return pedirClave(res, 'MD58 Club panel');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/panel') return estatico(res, 'panel.html');
    if (req.method === 'GET' && p === '/panel/api/resumen') return json(res, { usuario: quien, ...(await club.resumen(pool)), locales: LOCALES, push: push.activo, caja: cajaActiva });
    if (req.method === 'GET' && p === '/panel/export.csv') {
      const csv = await club.exportarCsv(pool, quien);
      cabeceras(res, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="md58club_socios_${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
      res.end('\uFEFF' + csv); return;
    }
    if (req.method === 'POST' && p === '/panel/api/push-prueba') {
      if (req.headers['x-panel'] !== '1') return json(res, { error: 'no' }, 403);
      const b = await leerJson(req); const cl = await club.porDni(pool, validar.dni(b.dni) || '');
      if (!cl) return json(res, { error: 'no existe ese socio' }, 404);
      const r = await push.enviar(pool, cl.id, { titulo: 'MD58 Club', cuerpo: String(b.texto || 'Notificación de prueba').slice(0, 140), url: '/tarjeta' });
      await club.auditar(pool, 'push_prueba', cl.id, quien, r);
      return json(res, r);
    }
    json(res, { error: 'no existe' }, 404);
  }

  async function rutaCaja(req, res, url) {
    if (!cajaActiva) { cabeceras(res); res.writeHead(404); res.end('No existe'); return; }
    const local = usuarioBasic(req.headers.authorization, env.CAJA_CLAVES);   // usuario = código del local (ej. las_vegas)
    if (!local || !LOCALES[local]) return pedirClave(res, 'MD58 Club caja');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/caja') return estatico(res, 'caja.html');
    if (req.headers['x-caja'] !== '1') return json(res, { error: 'no' }, 403);
    if (req.method === 'GET' && p === '/caja/api/local') return json(res, { local, nombre: LOCALES[local].nombre, vendedores: VENDEDORES[local] || [] });
    if (req.method === 'POST' && p === '/caja/api/buscar') {
      const b = await leerJson(req);
      if (b.qr) { const d = tok.verificar(SECRET, String(b.qr).replace(/^MD58C:/, '')); if (!d || d.t !== 'c') return json(res, { socio: false });
        const cl = await club.porId(pool, d.id); return json(res, cl && cl.fecha_alta ? { socio: true, dni: cl.dni, nombre: `${cl.nombre} ${String(cl.apellido || '').slice(0, 1)}.` } : { socio: false }); }
      const dni = validar.dni(b.dni); if (!dni) return json(res, { error: 'DNI inválido' }, 422);
      return json(res, await club.cajaBuscar(pool, dni));
    }
    if (req.method === 'POST' && p === '/caja/api/compra') {
      const b = await leerJson(req); const dni = validar.dni(b.dni); const comp = validar.texto(b.comprobante, 40);
      if (!dni || !comp) return json(res, { error: 'Falta el DNI o el número de comprobante' }, 422);
      const vend = b.vendedor && (VENDEDORES[local] || []).includes(b.vendedor) ? b.vendedor : null;
      const r = await club.cajaCompra(pool, { dni, local: LOCALES[local].znube, vendedor: vend, comprobante: comp, quien: 'caja:' + local });
      return json(res, r, r.ok ? 200 : 409);
    }
    json(res, { error: 'no existe' }, 404);
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const manejar = url.pathname === '/panel' || url.pathname.startsWith('/panel/') ? rutaPanel(req, res, url)
      : url.pathname === '/caja' || url.pathname.startsWith('/caja/') ? rutaCaja(req, res, url)
      : rutaPublica(req, res, url).then(ok => { if (!ok) { cabeceras(res); res.writeHead(404); res.end('No existe'); } });
    Promise.resolve(manejar).catch(e => {
      if (!e.status) console.error('error', req.method, url.pathname, e.message);
      if (!res.headersSent) json(res, { error: e.status ? e.message : 'Error del servidor, probá de nuevo' }, e.status || 500);
    });
  });
}

/** Claves de notificaciones: si no vienen por variable, se generan una sola vez y quedan guardadas en la base (tabla config).
 *  Así nadie tiene que copiar claves a mano al crear el servidor. Cambiarlas obligaría a los socios a reactivar notificaciones. */
async function clavesVapid(pool, env) {
  if (env.VAPID_PUBLIC && env.VAPID_PRIVATE) return {};
  const r = await pool.query("SELECT clave, valor FROM config WHERE clave IN ('vapid_public','vapid_private')");
  const c = Object.fromEntries(r.rows.map(x => [x.clave, x.valor]));
  if (c.vapid_public && c.vapid_private) return { VAPID_PUBLIC: c.vapid_public, VAPID_PRIVATE: c.vapid_private };
  const k = require('web-push').generateVAPIDKeys();
  await pool.query("INSERT INTO config (clave, valor) VALUES ('vapid_public',$1),('vapid_private',$2) ON CONFLICT (clave) DO NOTHING", [k.publicKey, k.privateKey]);
  console.log('claves de notificaciones generadas y guardadas en la base');
  return clavesVapid(pool, { });
}

if (require.main === module) {
  (async () => {
    const pool = crearPool();
    const a = await migrar(pool);
    if (a.length) console.log('migraciones aplicadas:', a.join(', '));
    const env = { ...process.env, ...(await clavesVapid(pool, process.env)) };
    const app = crearApp({ pool, env });
    const port = env.PORT || 8080;
    app.listen(port, () => console.log(`MD58 Club escuchando en ${port}` + (env.CAJA_ACTIVA === '1' ? ' · caja ACTIVA' : '') + (env.VAPID_PUBLIC ? ' · push activo' : ' · push APAGADO (faltan claves VAPID)')));
  })().catch(e => { console.error('No arranco:', e.message); process.exit(1); });
}

module.exports = { crearApp, clavesVapid };
