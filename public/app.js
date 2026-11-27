// MD58 Club · app del socio (registro, tarjeta, instalación, notificaciones). Sin librerías salvo el generador de QR.
'use strict';
(function () {
  const app = document.getElementById('app');
  const LS = 'md58club_sesion';
  const leerSesion = () => { try { return localStorage.getItem(LS); } catch { return null; } };
  const guardarSesion = t => { try { localStorage.setItem(LS, t); } catch {} };
  const borrarSesion = () => { try { localStorage.removeItem(LS); } catch {} };
  const ua = navigator.userAgent;
  const esIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const esAndroid = /Android/.test(ua);
  const esSafari = esIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Instagram|FBAN|FBAV|GSA/.test(ua);
  const instalada = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let promptInstalar = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); promptInstalar = e;
    const b = document.querySelector('[data-boton-instalar]');
    if (b) { b.hidden = false; document.querySelector('[data-android-manual]').hidden = true; }
  });

  const plantilla = id => document.getElementById(id).content.cloneNode(true);
  const $ = (raiz, sel) => raiz.querySelector(sel);
  async function api(ruta, { metodo = 'GET', cuerpo, token } = {}) {
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    const r = await fetch(ruta, { method: metodo, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    let d = {}; try { d = await r.json(); } catch {}
    return { status: r.status, ...d };
  }
  function ponerManifest(token) { document.getElementById('manifest').href = '/manifest.webmanifest' + (token ? '?t=' + encodeURIComponent(token) : ''); }
  const fecha = s => { const [, m, d] = String(s).slice(0, 10).split('-'); return `${+d}/${+m}`; };
  const parrafo = (clase, texto) => { const p = document.createElement('p'); p.className = clase; p.textContent = texto; return p; };

  // ---------- Registro ----------
  async function registro(codigo) {
    const l = await api('/api/local/' + encodeURIComponent(codigo));
    if (l.status !== 200) return inicio('Ese QR no es de un local MD58. Escaneá el QR de la caja.');
    const f = plantilla('t-registro');
    $(f, '[data-local]').textContent = 'Local: ' + l.nombre;
    if (l.vendedores && l.vendedores.length) {
      const sel = $(f, 'select[name=vendedor]');
      for (const v of l.vendedores) { const o = document.createElement('option'); o.value = o.textContent = v; sel.append(o); }
      $(f, '[data-vendedor]').hidden = false;
    }
    const form = $(f, 'form'), err = $(f, '[data-error]'), boton = $(f, 'button[type=submit]');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      form.querySelectorAll('.campo-error').forEach(x => x.remove());
      form.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
      err.hidden = true;
      const d = Object.fromEntries(new FormData(form));
      d.acepta_datos = form.acepta_datos.checked; d.acepta_promos = form.acepta_promos.checked; d.codigo_local = codigo;
      boton.disabled = true; boton.textContent = 'Registrando…';
      try {
        const r = await api('/api/registro', { metodo: 'POST', cuerpo: d });
        if (r.ok && r.token) { guardarSesion(r.token); history.replaceState(null, '', '/t/' + r.token); return tarjeta(r.token, true); }
        if (r.errores) {
          let primero = null;
          for (const [k, m] of Object.entries(r.errores)) {
            const campo = form.elements[k];
            const s = document.createElement('span'); s.className = 'campo-error'; s.textContent = m;
            if (campo) { campo.setAttribute('aria-invalid', 'true'); campo.closest('label').append(s); primero = primero || campo; }
          }
          if (primero) primero.focus();
        } else { err.textContent = r.mensaje || r.error || 'No se pudo registrar. Probá de nuevo.'; err.hidden = false; }
      } catch { err.textContent = 'Sin conexión. Probá de nuevo.'; err.hidden = false; }
      boton.disabled = false; boton.textContent = 'Quiero ser socio';
    });
    app.replaceChildren(f);
  }

  // ---------- Tarjeta ----------
  async function tarjeta(token, recienRegistrado) {
    ponerManifest(token);
    const d = await api('/api/socio/tarjeta', { token });
    if (d.status === 401) { borrarSesion(); return inicio('Tu sesión venció. Abrí tu tarjeta de nuevo.'); }
    if (d.status !== 200) return inicio('No pudimos cargar tu tarjeta. Probá de nuevo.');
    guardarSesion(token);
    const f = plantilla('t-tarjeta');
    $(f, '[data-nombre]').textContent = `${d.nombre} ${d.apellido}`;
    $(f, '[data-dni]').textContent = Number(d.dni).toLocaleString('es-AR');
    try { const q = qrcode(0, 'M'); q.addData(d.qr); q.make(); $(f, '[data-qr]').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch {}
    const b = (d.beneficios || []).find(x => x.estado === 'asignado');
    if (b) {
      const box = $(f, '[data-beneficio]'); box.hidden = false;
      const pct = document.createElement('div'); pct.className = 'pct'; pct.textContent = `${b.porcentaje}% OFF`;
      const t = document.createElement('div');
      t.textContent = `${recienRegistrado ? '¡Bienvenido/a al Club! ' : ''}Tu beneficio de bienvenida para usar del ${fecha(b.desde)} al ${fecha(b.hasta)} en cualquier local MD58. No se acumula con otras promociones.`;
      const c = document.createElement('div'); c.className = 'cod'; c.textContent = 'Código ' + b.codigo;
      box.append(pct, t, c);
    }
    if (!d.email_verificado) {
      const a = $(f, '[data-email]'); a.hidden = false;
      $(a, '[data-reenviar]').addEventListener('click', async ev => {
        ev.target.disabled = true; await api('/api/socio/reenviar-email', { metodo: 'POST', token }); ev.target.textContent = 'Listo, revisá tu email';
      });
    }
    const chk = $(f, '[data-promos]'); chk.checked = !!d.promos;
    chk.addEventListener('change', () => api('/api/socio/promos', { metodo: 'POST', cuerpo: { valor: chk.checked }, token }));

    if (instalada()) api('/api/socio/instalada', { metodo: 'POST', token });
    else {
      $(f, '[data-instalar]').hidden = false;
      if (esIOS) { $(f, '[data-ios]').hidden = false; if (!esSafari) $(f, '[data-ios-no-safari]').hidden = false; }
      else {
        $(f, '[data-android]').hidden = false;
        const bi = $(f, '[data-boton-instalar]');
        if (promptInstalar) { bi.hidden = false; $(f, '[data-android-manual]').hidden = true; }
        bi.addEventListener('click', async () => {
          if (!promptInstalar) return;
          promptInstalar.prompt(); const r = await promptInstalar.userChoice; promptInstalar = null;
          if (r.outcome === 'accepted') { bi.hidden = true; api('/api/socio/instalada', { metodo: 'POST', token }); }
        });
      }
    }
    configurarNotificaciones(f, d, token);
    app.replaceChildren(f);
  }

  function configurarNotificaciones(f, d, token) {
    const caja = $(f, '[data-notif]'), boton = $(f, '[data-activar]'), estado = $(f, '[data-notif-estado]');
    const soporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!d.push) return;   // el servidor todavía no tiene claves de notificaciones
    if (!soporta) {
      if (esIOS && !instalada()) { caja.hidden = false; boton.disabled = true; estado.textContent = 'En iPhone primero agregá la tarjeta a tu pantalla de inicio (pasos de arriba) y abrila desde el ícono.'; }
      return;
    }
    caja.hidden = false;
    if (Notification.permission === 'granted') { boton.hidden = true; estado.textContent = '✓ Notificaciones activadas.'; }
    if (Notification.permission === 'denied') { boton.hidden = true; estado.textContent = 'Las notificaciones están bloqueadas. Activalas desde la configuración del celular.'; }
    let reg = null; navigator.serviceWorker.ready.then(r => { reg = r; });
    boton.addEventListener('click', () => {
      if (!reg) { estado.textContent = 'Un segundo y probá de nuevo…'; return; }
      // subscribe() directo dentro del toque (requisito de iPhone): el propio subscribe pide el permiso.
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(d.push) })
        .then(sub => api('/api/socio/push', { metodo: 'POST', cuerpo: { suscripcion: sub.toJSON(), plataforma: esIOS ? 'ios' : esAndroid ? 'android' : 'otro' }, token }))
        .then(r => { if (r.ok) { boton.hidden = true; estado.textContent = '✓ ¡Listo! Te vamos a avisar de ingresos y beneficios.'; } else estado.textContent = 'No se pudo activar. Probá de nuevo.'; })
        .catch(() => { estado.textContent = Notification.permission === 'denied' ? 'Bloqueaste las notificaciones. Podés activarlas desde la configuración.' : 'No se pudo activar. Probá de nuevo.'; });
    });
  }
  function claveABytes(b64) { const p = '='.repeat((4 - b64.length % 4) % 4); const s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }

  // ---------- Otras pantallas ----------
  function inicio(msg) {
    const f = plantilla('t-inicio');
    if (msg) f.querySelector('section').prepend(parrafo('error', msg));
    app.replaceChildren(f);
  }
  function recuperar() {
    const f = plantilla('t-recuperar'); const form = $(f, 'form'), ok = $(f, '[data-ok]'), err = $(f, '[data-error]');
    form.addEventListener('submit', async e => {
      e.preventDefault(); err.hidden = true;
      const r = await api('/api/recuperar', { metodo: 'POST', cuerpo: { dni: form.dni.value } });
      if (r.ok) { form.hidden = true; ok.textContent = r.mensaje; ok.hidden = false; } else { err.textContent = r.error || 'Probá de nuevo'; err.hidden = false; }
    });
    app.replaceChildren(f);
  }
  async function verificarEmail(t) {
    const r = await api('/api/verificar-email', { metodo: 'POST', cuerpo: { token: t } });
    const msg = r.ok ? '✓ Email confirmado.' : 'El link venció o no es válido.';
    const s = leerSesion();
    if (s) { await tarjeta(s); app.prepend(parrafo(r.ok ? 'ok' : 'error', msg)); return; }
    inicio(); app.prepend(parrafo(r.ok ? 'ok' : 'error', r.ok ? msg + ' Abrí tu tarjeta desde el ícono o con "Ya soy socio".' : msg));
  }
  async function terminos() {
    const t = await api('/api/textos');
    const s = document.createElement('section'); const h = document.createElement('h1'); h.textContent = 'Términos y datos personales';
    const p = document.createElement('div'); p.className = 'terminos';
    p.textContent = `${t.datos}\n\n${t.promos}\n\nBeneficio de bienvenida: ${t.bienvenida.porcentaje}% de descuento en una compra, del ${fecha(t.bienvenida.desde)} al ${fecha(t.bienvenida.hasta)}, personal, de un solo uso, en locales MD58. No se acumula con otras promociones.\n\nResponsable de los datos: MD58.${t.contacto ? ' Para ver, corregir o borrar tus datos escribí a ' + t.contacto + '.' : ''} La Agencia de Acceso a la Información Pública, órgano de control de la Ley 25.326, atiende denuncias y reclamos sobre protección de datos personales.`;
    s.append(h, p); app.replaceChildren(s);
  }

  // ---------- Rutas ----------
  const ruta = location.pathname;
  let m;
  if ((m = ruta.match(/^\/r\/([\w-]+)$/))) registro(m[1]);
  else if ((m = ruta.match(/^\/t\/([\w.-]+)$/))) tarjeta(m[1]);
  else if ((m = ruta.match(/^\/v\/([\w.-]+)$/))) verificarEmail(m[1]);
  else if (ruta === '/recuperar') recuperar();
  else if (ruta === '/terminos') terminos();
  else { const s = leerSesion(); if (s) tarjeta(s); else inicio(); }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
})();
