'use strict';
(async function () {
  const $ = id => document.getElementById(id);
  const pct = (a, b) => (b ? Math.round(a * 100 / b) + '%' : '–');
  const n = x => Number(x || 0).toLocaleString('es-AR');
  function tabla(el, cols, filas) {
    const t = document.getElementById(el); t.replaceChildren();
    const h = t.insertRow(); for (const [k, txt, num] of cols) { const th = document.createElement('th'); th.textContent = txt; if (num) th.className = 'n'; h.append(th); }
    for (const f of filas) { const r = t.insertRow(); for (const [k, , num] of cols) { const c = r.insertCell(); c.textContent = typeof k === 'function' ? k(f) : (num ? n(f[k]) : f[k]); if (num) c.className = 'n'; } }
    if (!filas.length) { const r = t.insertRow(); const c = r.insertCell(); c.colSpan = cols.length; c.textContent = 'Todavía no hay registros.'; }
  }
  async function cargar() {
    const r = await fetch('/panel/api/resumen'); const d = await r.json();
    $('usuario').textContent = d.usuario;
    const nombre = z => { for (const [, l] of Object.entries(d.locales)) if (l.znube === z) return l.nombre; return z || '–'; };
    const T = d.totales; const k = $('kpis'); k.replaceChildren();
    for (const [v, t] of [[n(T.socios), 'socios registrados'], [pct(T.app_instalada, T.socios), 'instalaron la app'], [pct(T.notificaciones, T.socios), 'activaron notificaciones'],
      [pct(T.email_verificado, T.socios), 'confirmaron el email'], [pct(T.con_permiso_promos, T.socios), 'aceptan promos'], [n(T.historicos), 'clientes históricos sin registrar'],
      [n(T.historicos_que_se_sumaron), 'históricos que se sumaron'], [n(T.conflictos), 'registros con conflicto'], [n(T.compras_caja), 'compras cargadas en caja']]) {
      const e = document.createElement('div'); e.className = 'kpi'; const b = document.createElement('b'); b.textContent = v; const s = document.createElement('span'); s.textContent = t; e.append(b, s); k.append(e);
    }
    $('estado').textContent = `Notificaciones: ${d.push ? 'activas' : 'APAGADAS (faltan claves VAPID)'} · Caja (plan B): ${d.caja ? 'activa' : 'apagada'} · actualizado ${new Date().toLocaleTimeString('es-AR')}`;
    tabla('t-local', [[f => nombre(f.local), 'Local'], ['hoy', 'Hoy', 1], ['n', 'Total', 1], [f => pct(f.app, f.n), 'App'], [f => pct(f.notif, f.n), 'Notif.']], d.porLocal);
    tabla('t-vendedor', [[f => nombre(f.local), 'Local'], ['vendedor', 'Vendedor'], ['n', 'Registros', 1]], d.porVendedor);
    tabla('t-dia', [['dia', 'Día'], ['n', 'Registros', 1]], d.porDia);
  }
  $('f-push').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    const r = await fetch('/panel/api/push-prueba', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1' }, body: JSON.stringify({ dni: f.dni.value, texto: f.texto.value }) });
    const d = await r.json(); $('push-res').textContent = r.ok ? `Enviadas: ${d.enviados} · fallidas: ${d.fallidos}${d.motivo ? ' (' + d.motivo + ')' : ''}` : (d.error || 'Error');
  });
  $('f-hist').addEventListener('submit', async e => {
    e.preventDefault(); const a = e.target.archivo.files[0]; const out = $('hist-res');
    if (!a) { out.textContent = 'Elegí el archivo CSV primero.'; return; }
    out.textContent = 'Subiendo y cargando… (puede tardar 1-2 minutos)';
    try {
      const r = await fetch('/panel/api/importar-historicos', { method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-Panel': '1' }, body: await a.text() });
      const d = await r.json();
      out.textContent = r.ok ? `Listo: ${n(d.leidas)} filas leídas · ${n(d.nuevas)} nuevas · ${n(d.actualizadas)} actualizadas · ${n(d.ya_socios)} ya eran socios · ${n(d.invalidas)} sin celular válido · ${n(d.conflictos)} con conflicto · ${n(d.salteadas_por_revisar)} salteadas (marcadas "revisar").` : (d.error || 'Error');
      cargar().catch(() => {});
    } catch (err) { out.textContent = 'No se pudo subir: ' + err.message; }
  });
  await cargar(); setInterval(() => cargar().catch(() => {}), 60000);
})();
