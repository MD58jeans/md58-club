// Importa la base histórica (CSV del Drive restringido: telefono,nombre,dni,locales,origenes,consentimiento,revisar)
// como clientes "historico". No pisa socios registrados. Las filas marcadas en "revisar" se saltean.
// Uso: DATABASE_URL=... node scripts/importar_historicos.js /ruta/fuera/del/repo/base.csv
'use strict';
const fs = require('fs');
const { crearPool, migrar } = require('../lib/db');
const club = require('../lib/club');
const validar = require('../lib/validar');

function leerCsv(texto) {
  const filas = []; let fila = [], campo = '', q = false;
  texto = texto.replace(/^﻿/, '');
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (q) { if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') q = false; else campo += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += ch;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  const [h, ...resto] = filas.filter(f => f.some(x => x !== ''));
  return resto.map(f => Object.fromEntries(h.map((k, i) => [k.trim(), f[i] ?? ''])));
}

async function importar(pool, archivo) {
  const filas = leerCsv(fs.readFileSync(archivo, 'utf8'));
  const usar = filas.filter(f => !f.revisar);
  const t = await club.importarHistoricos(pool, usar, validar);
  return { ...t, salteadas_por_revisar: filas.length - usar.length };
}

if (require.main === module) {
  const archivo = process.argv[2];
  if (!archivo) { console.error('Uso: node scripts/importar_historicos.js <base.csv>'); process.exit(1); }
  if (require('path').resolve(archivo).includes('md58-sistema')) { console.error('El CSV con datos personales no puede estar dentro del repo.'); process.exit(1); }
  (async () => { const p = crearPool(); await migrar(p); console.log(await importar(p, archivo)); await p.end(); })().catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { leerCsv, importar };
