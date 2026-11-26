// Conexión a Postgres y migraciones versionadas (migraciones/NNN_*.sql, se aplican una sola vez y en orden).
'use strict';
const fs = require('fs'), path = require('path');
const { Pool, types } = require('pg');
types.setTypeParser(1082, v => v);   // las fechas (DATE) quedan como 'AAAA-MM-DD', sin corrimiento por zona horaria

function crearPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('Falta DATABASE_URL');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  return new Pool({ connectionString: url, max: 10, ssl: local || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false } });
}

async function migrar(pool, dir = path.join(__dirname, '..', 'migraciones')) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migraciones (nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())');
  const hechas = new Set((await pool.query('SELECT nombre FROM schema_migraciones')).rows.map(r => r.nombre));
  const aplicadas = [];
  for (const f of fs.readdirSync(dir).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()) {
    if (hechas.has(f)) continue;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('INSERT INTO schema_migraciones (nombre) VALUES ($1)', [f]);
      await c.query('COMMIT'); aplicadas.push(f);
    } catch (e) { await c.query('ROLLBACK'); throw new Error(`migración ${f}: ${e.message}`); } finally { c.release(); }
  }
  return aplicadas;
}

module.exports = { crearPool, migrar };
