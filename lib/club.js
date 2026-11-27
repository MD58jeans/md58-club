// Lógica del Club: alta/unión de socios, tarjeta, sesión, notificaciones, panel, caja e importación de históricos.
// Todo el SQL es parametrizado. Los datos personales viven solo en la base (DATABASE_URL).
'use strict';
const crypto = require('crypto');

const TEXTO_DATOS = 'Acepto los Términos del MD58 Club y que MD58 trate mis datos (nombre, DNI, celular, email, fecha de nacimiento y compras) para identificarme como socio, asignarme beneficios y registrar mis compras, según la Ley 25.326. Puedo pedir ver, corregir o borrar mis datos cuando quiera. (v1 · 26/11/2026)';
const TEXTO_PROMOS = 'Quiero recibir novedades, ingresos y beneficios de MD58 por notificaciones, email y WhatsApp. Me puedo dar de baja cuando quiera. (v1 · 26/11/2026)';
// Condiciones definidas por Braian (27/11/2026): 15% del 2 al 31 de enero de 2027, no acumulable con otras promociones.
const BIENVENIDA = { porcentaje: 15, desde: '2027-01-02', hasta: '2027-01-31', condiciones: 'Personal y de un solo uso. No se acumula con otras promociones.' };

const ESTADOS = ['historico', 'registrado', 'app_instalada', 'notificaciones'];
const subirEstado = (actual, nuevo) => (ESTADOS.indexOf(nuevo) > ESTADOS.indexOf(actual) ? nuevo : actual);

function codigoBeneficio() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sin 0/O ni 1/I para que se lea bien en caja
  let s = ''; for (const b of crypto.randomBytes(8)) s += abc[b % abc.length];
  return 'MD-' + s;
}

async function auditar(db, tipo, clienteId, quien, detalle = {}) {
  await db.query('INSERT INTO auditoria (tipo, cliente_id, quien, detalle) VALUES ($1,$2,$3,$4)', [tipo, clienteId || null, quien || null, detalle]);
}

/**
 * Alta o unión de un socio. datos: salida de validar.registro; local: {codigo, znube}.
 * Devuelve {resultado: 'alta'|'union_historico'|'ya_socio'|'conflicto', cliente?}
 */
async function registrar(pool, datos, local, origen = 'registro_qr') {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const A = (await c.query('SELECT * FROM clientes WHERE dni = $1 FOR UPDATE', [datos.dni])).rows[0];
    const B = (await c.query('SELECT * FROM clientes WHERE celular = $1 FOR UPDATE', [datos.celular])).rows[0];
    const conflicto = async motivo => {
      await auditar(c, 'conflicto', (A || B).id, origen, { motivo, local: local.znube, otro: A && B ? B.id : null });
      await c.query('COMMIT');
      return { resultado: 'conflicto' };
    };
    if (A && B && A.id !== B.id) return await conflicto('dni_y_celular_de_personas_distintas');
    const X = A || B;
    if (X && X.fecha_alta) {
      if ((A && A.celular && A.celular !== datos.celular) || (B && B.dni && B.dni !== datos.dni)) return await conflicto('socio_existente_con_otro_dato');
      await auditar(c, 'ya_socio', X.id, origen, { local: local.znube });
      await c.query('COMMIT');
      return { resultado: 'ya_socio', cliente: X };
    }
    if (X && B && B.dni && B.dni !== datos.dni) return await conflicto('historico_con_otro_dni');

    let cliente, resultado;
    const campos = [datos.dni, datos.celular, datos.nombre, datos.apellido, datos.email, datos.nacimiento, datos.localidad, local.znube, datos.vendedor];
    if (X) {   // era histórico: pasa a socio registrado, con los datos nuevos
      if (A && A.celular && A.celular !== datos.celular) await auditar(c, 'cambio_celular', A.id, origen, { anterior_termina: A.celular.slice(-4) });
      cliente = (await c.query(`UPDATE clientes SET dni=$1, celular=$2, nombre=$3, apellido=$4, email=$5, nacimiento=$6, localidad=$7,
        local_alta=$8, vendedor_alta=$9, fecha_alta=now(), estado='registrado', email_verificado=false, actualizado_en=now()
        WHERE id=$10 RETURNING *`, [...campos, X.id])).rows[0];
      resultado = 'union_historico';
    } else {
      cliente = (await c.query(`INSERT INTO clientes (dni, celular, nombre, apellido, email, nacimiento, localidad, local_alta, vendedor_alta, fecha_alta, estado)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), 'registrado') RETURNING *`, campos)).rows[0];
      resultado = 'alta';
    }
    await c.query('INSERT INTO consentimientos (cliente_id, tipo, valor, texto, origen) VALUES ($1,$2,$3,$4,$5),($1,$6,$7,$8,$5)',
      [cliente.id, 'datos', true, TEXTO_DATOS, origen, 'promos', !!datos.acepta_promos, TEXTO_PROMOS]);
    for (let i = 0; i < 3; i++) {   // código único (reintenta si choca)
      const r = await c.query(`INSERT INTO beneficios (cliente_id, tipo, porcentaje, vigencia_desde, vigencia_hasta, codigo)
        VALUES ($1,'bienvenida',$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, [cliente.id, BIENVENIDA.porcentaje, BIENVENIDA.desde, BIENVENIDA.hasta, codigoBeneficio()]);
      if (r.rowCount) break;
      const ya = await c.query("SELECT 1 FROM beneficios WHERE cliente_id=$1 AND tipo='bienvenida'", [cliente.id]);
      if (ya.rowCount) break;
    }
    await auditar(c, resultado, cliente.id, origen, { local: local.znube, vendedor: datos.vendedor || null, promos: !!datos.acepta_promos });
    await c.query('COMMIT');
    return { resultado, cliente };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return { resultado: 'conflicto' };   // carrera con otro registro igual
    throw e;
  } finally { c.release(); }
}

/** Lo que ve el socio en su tarjeta (solo sus datos). */
async function tarjeta(pool, id) {
  const cl = (await pool.query('SELECT id, nombre, apellido, dni, email, email_verificado, estado, token_version, local_alta FROM clientes WHERE id=$1 AND fecha_alta IS NOT NULL', [id])).rows[0];
  if (!cl) return null;
  const b = (await pool.query("SELECT porcentaje, vigencia_desde, vigencia_hasta, estado, codigo FROM beneficios WHERE cliente_id=$1 ORDER BY creado_en", [id])).rows;
  const promos = (await pool.query("SELECT valor FROM consentimientos WHERE cliente_id=$1 AND tipo='promos' ORDER BY fecha DESC, id DESC LIMIT 1", [id])).rows[0];
  return { ...cl, beneficios: b, promos: !!promos?.valor };
}

async function porId(pool, id) { return (await pool.query('SELECT * FROM clientes WHERE id=$1', [id])).rows[0] || null; }
async function porDni(pool, dni) { return (await pool.query('SELECT * FROM clientes WHERE dni=$1', [dni])).rows[0] || null; }

async function marcarInstalada(pool, id) {
  const cl = await porId(pool, id); if (!cl) return;
  await pool.query('UPDATE clientes SET app_instalada_en=COALESCE(app_instalada_en, now()), estado=$2, actualizado_en=now() WHERE id=$1', [id, subirEstado(cl.estado, 'app_instalada')]);
}

async function guardarSuscripcion(pool, id, sub, plataforma) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('suscripción inválida');
  await pool.query(`INSERT INTO dispositivos (cliente_id, endpoint, p256dh, auth, plataforma) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (endpoint) DO UPDATE SET cliente_id=EXCLUDED.cliente_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, activo=true, ultimo_error=NULL`,
    [id, sub.endpoint.slice(0, 1000), String(sub.keys.p256dh).slice(0, 200), String(sub.keys.auth).slice(0, 100), plataforma || null]);
  const cl = await porId(pool, id);
  await pool.query('UPDATE clientes SET notificaciones_en=COALESCE(notificaciones_en, now()), estado=$2, actualizado_en=now() WHERE id=$1', [id, subirEstado(cl.estado, 'notificaciones')]);
}

async function verificarEmail(pool, id, email) {
  const r = await pool.query('UPDATE clientes SET email_verificado=true, actualizado_en=now() WHERE id=$1 AND email=$2 RETURNING id', [id, email]);
  if (r.rowCount) await auditar(pool, 'email_verificado', id, 'socio');
  return r.rowCount === 1;
}

async function cambiarPromos(pool, id, valor, origen = 'tarjeta') {
  await pool.query('INSERT INTO consentimientos (cliente_id, tipo, valor, texto, origen) VALUES ($1,$2,$3,$4,$5)', [id, 'promos', !!valor, TEXTO_PROMOS, origen]);
}

// ---------- Panel de gerencia ----------
async function resumen(pool) {
  const q = async (sql, p = []) => (await pool.query(sql, p)).rows;
  const [tot] = await q(`SELECT count(*) FILTER (WHERE fecha_alta IS NOT NULL)::int AS socios,
      count(*) FILTER (WHERE fecha_alta IS NULL)::int AS historicos,
      count(*) FILTER (WHERE app_instalada_en IS NOT NULL)::int AS app_instalada,
      count(*) FILTER (WHERE notificaciones_en IS NOT NULL)::int AS notificaciones,
      count(*) FILTER (WHERE email_verificado)::int AS email_verificado,
      count(*) FILTER (WHERE fecha_alta IS NOT NULL AND origen_historico IS NOT NULL)::int AS historicos_que_se_sumaron
    FROM clientes`);
  const [promos] = await q(`SELECT count(*)::int AS con_permiso FROM (SELECT DISTINCT ON (cliente_id) valor FROM consentimientos WHERE tipo='promos' ORDER BY cliente_id, fecha DESC, id DESC) u WHERE valor`);
  const porDia = await q(`SELECT to_char(fecha_alta AT TIME ZONE 'America/Argentina/Buenos_Aires','YYYY-MM-DD') AS dia, count(*)::int AS n FROM clientes WHERE fecha_alta IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 60`);
  const porLocal = await q(`SELECT local_alta AS local, count(*)::int AS n, count(*) FILTER (WHERE app_instalada_en IS NOT NULL)::int AS app, count(*) FILTER (WHERE notificaciones_en IS NOT NULL)::int AS notif,
      count(*) FILTER (WHERE fecha_alta >= date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires')::int AS hoy
    FROM clientes WHERE fecha_alta IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`);
  const porVendedor = await q(`SELECT local_alta AS local, COALESCE(vendedor_alta,'(sin elegir)') AS vendedor, count(*)::int AS n FROM clientes WHERE fecha_alta IS NOT NULL GROUP BY 1,2 ORDER BY 3 DESC LIMIT 200`);
  const [conf] = await q(`SELECT count(*)::int AS n FROM auditoria WHERE tipo='conflicto'`);
  const [caja] = await q(`SELECT count(*)::int AS n FROM compras_caja`);
  return { totales: { ...tot, con_permiso_promos: promos.con_permiso, conflictos: conf.n, compras_caja: caja.n }, porDia, porLocal, porVendedor };
}

/** Export para gerencia (CSV). Incluye datos personales: solo desde el panel con clave, queda auditado. */
async function exportarCsv(pool, quien) {
  const rows = (await pool.query(`SELECT c.id, c.dni, c.nombre, c.apellido, c.celular, c.email, c.email_verificado, c.nacimiento, c.localidad, c.local_alta, c.vendedor_alta,
      to_char(c.fecha_alta AT TIME ZONE 'America/Argentina/Buenos_Aires','YYYY-MM-DD HH24:MI') AS fecha_alta, c.estado,
      (SELECT valor FROM consentimientos k WHERE k.cliente_id=c.id AND k.tipo='promos' ORDER BY fecha DESC, id DESC LIMIT 1) AS promos
    FROM clientes c WHERE c.fecha_alta IS NOT NULL ORDER BY c.fecha_alta`)).rows;
  await auditar(pool, 'export', null, quien, { filas: rows.length });
  const cols = ['id', 'dni', 'nombre', 'apellido', 'celular', 'email', 'email_verificado', 'nacimiento', 'localidad', 'local_alta', 'vendedor_alta', 'fecha_alta', 'estado', 'promos'];
  const esc = v => { let s = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map(r => cols.map(k => esc(r[k])).join(','))].join('\n') + '\n';
}

// ---------- Caja (Plan B) ----------
async function cajaBuscar(pool, dni) {
  const cl = (await pool.query('SELECT id, nombre, apellido, fecha_alta FROM clientes WHERE dni=$1', [dni])).rows[0];
  if (!cl || !cl.fecha_alta) return { socio: false };
  return { socio: true, nombre: `${cl.nombre} ${String(cl.apellido || '').slice(0, 1)}.` };   // lo mínimo para confirmar
}
async function cajaCompra(pool, { id, dni, local, vendedor, comprobante, quien }) {
  // Se guarda SIEMPRE (socio o no): el DNI queda con la compra y se vincula al socio cuando se registre.
  const cl = id ? await porId(pool, id) : await porDni(pool, dni);
  const socio = !!(cl && cl.fecha_alta);
  const r = await pool.query(`INSERT INTO compras_caja (cliente_id, dni, local, vendedor, comprobante, cargado_por) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (local, comprobante) DO NOTHING RETURNING id`, [cl ? cl.id : null, cl ? cl.dni : dni, local, vendedor || null, comprobante || null, quien]);
  if (!r.rowCount) return { ok: false, error: 'ese comprobante ya está cargado en este local' };
  await auditar(pool, 'caja_compra', cl ? cl.id : null, quien, { local, comprobante: comprobante || null, socio });
  return { ok: true, socio };
}

// ---------- Importación de históricos ----------
/** filas: [{telefono, nombre, dni, locales, origenes}]. No pisa socios registrados. Devuelve totales. */
async function importarHistoricos(pool, filas, normalizar) {
  const t = { leidas: 0, nuevas: 0, actualizadas: 0, ya_socios: 0, invalidas: 0, conflictos: 0 };
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const f of filas) {
      t.leidas++;
      const cel = normalizar.celular(f.telefono), dni = f.dni ? normalizar.dni(f.dni) : null;
      if (!cel) { t.invalidas++; continue; }
      const porCel = (await c.query('SELECT id, dni, fecha_alta FROM clientes WHERE celular=$1', [cel])).rows[0];
      const porD = dni ? (await c.query('SELECT id, celular, fecha_alta FROM clientes WHERE dni=$1', [dni])).rows[0] : null;
      const nombre = String(f.nombre || '').slice(0, 80) || null;
      if ((porCel && porCel.fecha_alta) || (porD && porD.fecha_alta)) { t.ya_socios++; continue; }
      if (porCel && porD && porCel.id !== porD.id) { t.conflictos++; continue; }
      const existe = porCel || porD;
      if (existe) {
        await c.query(`UPDATE clientes SET dni=COALESCE(dni,$2), celular=COALESCE(celular,$3), nombre=COALESCE(nombre,$4),
          locales_historicos=$5, origen_historico=$6, actualizado_en=now() WHERE id=$1`, [existe.id, porD ? null : dni, cel, nombre, f.locales || null, f.origenes || null]);
        t.actualizadas++;
      } else {
        await c.query(`INSERT INTO clientes (dni, celular, nombre, estado, locales_historicos, origen_historico) VALUES ($1,$2,$3,'historico',$4,$5)`,
          [dni, cel, nombre, f.locales || null, f.origenes || null]);
        t.nuevas++;
      }
    }
    await auditar(c, 'import_historicos', null, 'script', t);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  return t;
}

module.exports = { registrar, tarjeta, porId, porDni, marcarInstalada, guardarSuscripcion, verificarEmail, cambiarPromos, resumen, exportarCsv,
  cajaBuscar, cajaCompra, importarHistoricos, auditar, TEXTO_DATOS, TEXTO_PROMOS, BIENVENIDA };
