// Utilidades HTTP sin dependencias: cabeceras de seguridad, JSON, cuerpo con límite, usuarios con clave y límite por IP.
'use strict';
const crypto = require('crypto');

function cabeceras(res, extra = {}) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(self)',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Strict-Transport-Security': 'max-age=15552000',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...extra,
  };
  for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
}

function json(res, obj, code = 200) {
  cabeceras(res, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.writeHead(code); res.end(JSON.stringify(obj));
}

function leerJson(req, max = 20000) {
  return new Promise((ok, mal) => {
    let b = '', corte = false;
    req.on('data', d => { b += d; if (b.length > max && !corte) { corte = true; mal(Object.assign(new Error('cuerpo muy grande'), { status: 413 })); req.destroy(); } });
    req.on('end', () => { if (corte) return; try { ok(b ? JSON.parse(b) : {}); } catch { mal(Object.assign(new Error('JSON inválido'), { status: 400 })); } });
    req.on('error', mal);
  });
}

function leerTexto(req, max = 8e6) {
  return new Promise((ok, mal) => {
    const partes = []; let largo = 0, corte = false;
    req.on('data', d => { largo += d.length; if (largo > max && !corte) { corte = true; mal(Object.assign(new Error('archivo muy grande'), { status: 413 })); req.destroy(); } else if (!corte) partes.push(d); });
    req.on('end', () => { if (!corte) ok(Buffer.concat(partes).toString('utf8')); });
    req.on('error', mal);
  });
}

const hash = x => crypto.createHash('sha256').update(String(x)).digest();
const igual = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));

/** conf = "Nombre:clave,Otro:clave" (claves de 8+ caracteres). Devuelve el nombre si el header Basic es válido. */
function usuarioBasic(authHeader, conf) {
  if (!conf || !authHeader || !authHeader.startsWith('Basic ')) return null;
  const txt = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  const i = txt.indexOf(':'); if (i < 1) return null;
  const u = txt.slice(0, i), clave = txt.slice(i + 1);
  for (const par of conf.split(',')) {
    const j = par.indexOf(':'); if (j < 1) continue;
    const nu = par.slice(0, j).trim(), nc = par.slice(j + 1).trim();
    if (nc.length >= 8 && nu === u && igual(clave, nc)) return nu;
  }
  return null;
}
function pedirClave(res, reino) {
  cabeceras(res, { 'WWW-Authenticate': `Basic realm="${reino}", charset="UTF-8"`, 'Content-Type': 'text/plain; charset=utf-8' });
  res.writeHead(401); res.end('Usuario o clave incorrectos');
}

/** Límite simple por IP: max pedidos por ventana (ms). */
function limitador(max, ventana) {
  const m = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of m) if (t - v.desde > ventana) m.delete(k); }, ventana).unref();
  return ip => {
    const t = Date.now(); let v = m.get(ip);
    if (!v || t - v.desde > ventana) { v = { desde: t, n: 0 }; m.set(ip, v); }
    return ++v.n <= max;
  };
}
const ipDe = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

module.exports = { leerTexto, cabeceras, json, leerJson, usuarioBasic, pedirClave, limitador, ipDe };
