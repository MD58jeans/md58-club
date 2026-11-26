// Aplica las migraciones pendientes: DATABASE_URL=... node scripts/migrar.js (el servidor también lo hace al arrancar).
'use strict';
const { crearPool, migrar } = require('../lib/db');
(async () => { const p = crearPool(); const a = await migrar(p); console.log(a.length ? 'aplicadas: ' + a.join(', ') : 'nada para aplicar'); await p.end(); })()
  .catch(e => { console.error(e.message); process.exit(1); });
