// Validación y normalización de los datos del registro.
'use strict';

const dni = v => { const d = String(v || '').replace(/[.\s-]/g, ''); return /^\d{7,8}$/.test(d) ? d.replace(/^0+(?=\d{7})/, '') : null; };

/** Celular argentino a 549 + 10 dígitos. Acepta 11 1234-5678, 011 15 1234 5678, +54 9 11 ..., 2323 15 45-6789. */
function celular(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) { d = d.slice(2); if (d.startsWith('9')) d = d.slice(1); }
  if (d.startsWith('0')) d = d.slice(1);
  // característica (2 a 4 dígitos) + 15 + número: se saca el 15
  for (const n of [2, 3, 4]) {
    if (d.length === 12 && d.slice(n, n + 2) === '15') { d = d.slice(0, n) + d.slice(n + 2); break; }
  }
  return /^[1-9]\d{9}$/.test(d) ? '549' + d : null;
}

const email = v => { const e = String(v || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) && e.length <= 120 ? e : null; };

/** Fecha de nacimiento AAAA-MM-DD, entre 12 y 100 años. */
function nacimiento(v, hoy = new Date()) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const f = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (f.getUTCMonth() !== +m[2] - 1) return null;   // 31/02 y similares
  const edad = (hoy - f) / (365.25 * 864e5);
  return edad >= 12 && edad <= 100 ? m[0] : null;
}

const texto = (v, max = 60) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t && t.length <= max && !/[<>{}]/.test(t) ? t : null; };

/** Valida el formulario completo. Devuelve {ok, datos} o {ok:false, errores:{campo: mensaje}}. */
function registro(b, hoy) {
  const e = {}, d = {};
  if (!(d.nombre = texto(b.nombre))) e.nombre = 'Completá tu nombre';
  if (!(d.apellido = texto(b.apellido))) e.apellido = 'Completá tu apellido';
  if (!(d.dni = dni(b.dni))) e.dni = 'El DNI tiene que tener 7 u 8 números';
  if (!(d.celular = celular(b.celular))) e.celular = 'Poné el celular con la característica, sin 0 ni 15 (ej. 11 2345 6789)';
  if (!(d.email = email(b.email))) e.email = 'Revisá el email';
  if (!(d.nacimiento = nacimiento(b.nacimiento, hoy))) e.nacimiento = 'Revisá la fecha de nacimiento';
  d.localidad = b.localidad ? texto(b.localidad, 60) : null;
  if (b.localidad && !d.localidad) e.localidad = 'Revisá la localidad';
  if (b.acepta_datos !== true) e.acepta_datos = 'Para sumarte tenés que aceptar los términos y el uso de tus datos';
  d.acepta_promos = b.acepta_promos === true;
  d.vendedor = b.vendedor ? texto(b.vendedor, 40) : null;
  return Object.keys(e).length ? { ok: false, errores: e } : { ok: true, datos: d };
}

module.exports = { dni, celular, email, nacimiento, texto, registro };
