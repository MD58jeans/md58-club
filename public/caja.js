'use strict';
(async function () {
  const $ = id => document.getElementById(id);
  const api = (ruta, cuerpo) => fetch(ruta, { method: cuerpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Caja': '1' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  const L = await api('/caja/api/local'); $('local').textContent = 'Caja · ' + L.nombre;
  if (L.vendedores && L.vendedores.length) { const s = document.querySelector('select[name=vendedor]'); for (const v of L.vendedores) { const o = document.createElement('option'); o.value = o.textContent = v; s.append(o); } $('l-vend').hidden = false; }
  const f = $('f');
  const hoy = new Date().toISOString().slice(0, 10), CK = 'md58caja_' + hoy;
  const contar = (sumar = 1) => { let n = 0; try { n = Number(localStorage.getItem(CK) || 0) + sumar; localStorage.setItem(CK, String(n)); } catch {} $('cuenta').textContent = n; };
  contar(0);
  async function buscar(cuerpo) {
    const r = await api('/caja/api/buscar', cuerpo);
    $('socio').textContent = r.socio ? `✓ Socio: ${r.nombre}` : r.error || 'Todavía no es socio: guardá la compra igual e invitalo con el QR del local.';
    if (r.dni) f.dni.value = r.dni;
  }
  f.dni.addEventListener('change', () => f.dni.value && buscar({ dni: f.dni.value }));
  f.fin.addEventListener('input', () => { f.fin.value = f.fin.value.replace(/\D/g, '').slice(0, 2); });
  f.dni.addEventListener('input', () => { if (f.dni.value.replace(/\D/g, '').length === 8) f.fin.focus(); });   // DNI completo: salta solo a la factura
  f.addEventListener('submit', async e => {
    e.preventDefault(); $('err').hidden = $('ok').hidden = true;
    const r = await api('/caja/api/compra', { dni: f.dni.value, fin: f.fin.value, vendedor: f.vendedor.value });
    if (r.ok) { $('ok').textContent = r.socio ? '✓ Guardado (socio del Club).' : '✓ Guardado. No es socio todavía: invitalo con el QR del local (15% en enero).'; $('ok').hidden = false;
      f.dni.value = f.fin.value = ''; $('socio').textContent = ''; contar(); f.dni.focus(); }
    else { $('err').textContent = r.error || 'No se pudo guardar'; $('err').hidden = false; }
  });
  // Escaneo con la cámara (Chrome en Android tiene lector de QR nativo; en iPhone se escribe el DNI).
  if ('BarcodeDetector' in window) {
    $('escanear').hidden = false;
    $('escanear').addEventListener('click', async () => {
      const v = $('video'); v.hidden = false;
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); v.srcObject = st; await v.play();
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      const loop = async () => { const c = await det.detect(v).catch(() => []); const q = c.find(x => x.rawValue.startsWith('MD58C:'));
        if (q) { st.getTracks().forEach(t => t.stop()); v.hidden = true; buscar({ qr: q.rawValue }); } else requestAnimationFrame(loop); };
      loop();
    });
  }
})();
