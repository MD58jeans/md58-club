'use strict';
(async function () {
  const $ = id => document.getElementById(id);
  const api = (ruta, cuerpo) => fetch(ruta, { method: cuerpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Caja': '1' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
  const L = await api('/caja/api/local'); $('local').textContent = 'Caja · ' + L.nombre;
  if (L.vendedores && L.vendedores.length) { const s = document.querySelector('select[name=vendedor]'); for (const v of L.vendedores) { const o = document.createElement('option'); o.value = o.textContent = v; s.append(o); } $('l-vend').hidden = false; }
  const f = $('f');
  async function buscar(cuerpo) {
    const r = await api('/caja/api/buscar', cuerpo);
    $('socio').textContent = r.socio ? `✓ Socio: ${r.nombre}` : r.error || 'Todavía no es socio: guardá la compra igual e invitalo con el QR del local.';
    if (r.dni) f.dni.value = r.dni;
  }
  f.dni.addEventListener('change', () => f.dni.value && buscar({ dni: f.dni.value }));
  f.addEventListener('submit', async e => {
    e.preventDefault(); $('err').hidden = $('ok').hidden = true;
    const r = await api('/caja/api/compra', { dni: f.dni.value, comprobante: f.comprobante.value, vendedor: f.vendedor.value });
    if (r.ok) { $('ok').textContent = r.socio ? '✓ Compra guardada (socio del Club).' : '✓ Compra guardada. Todavía no es socio: invitalo con el QR del local (15% para enero).'; $('ok').hidden = false; f.dni.value = f.comprobante.value = ''; $('socio').textContent = ''; }
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
