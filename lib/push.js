// Notificaciones Web Push estándar (claves VAPID propias, sin Firebase ni proveedores). Sin claves, queda apagado.
'use strict';
const webpush = require('web-push');

function crearPush(env = process.env) {
  const { VAPID_PUBLIC, VAPID_PRIVATE } = env;
  const VAPID_CONTACTO = env.VAPID_CONTACTO || (/^https:/.test(env.BASE_URL || '') ? env.BASE_URL : 'https://md58club.com');   // mailto: o URL https de contacto (lo pide el estándar)
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { activo: false, clavePublica: null, enviar: async () => ({ enviados: 0, fallidos: 0, motivo: 'sin claves VAPID' }) };
  webpush.setVapidDetails(VAPID_CONTACTO, VAPID_PUBLIC, VAPID_PRIVATE);
  return {
    activo: true, clavePublica: VAPID_PUBLIC,
    /** Manda {titulo, cuerpo, url} a todos los dispositivos activos del socio. Desactiva los que ya no existen. */
    async enviar(pool, clienteId, msg) {
      const ds = (await pool.query('SELECT id, endpoint, p256dh, auth FROM dispositivos WHERE cliente_id=$1 AND activo', [clienteId])).rows;
      let enviados = 0, fallidos = 0;
      for (const d of ds) {
        try {
          await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(msg), { TTL: 86400 });
          enviados++;
        } catch (e) {
          fallidos++;
          const muerto = e.statusCode === 404 || e.statusCode === 410;
          await pool.query('UPDATE dispositivos SET activo=$2, ultimo_error=$3 WHERE id=$1', [d.id, !muerto, String(e.statusCode || e.message).slice(0, 200)]);
        }
      }
      return { enviados, fallidos };
    },
  };
}
module.exports = { crearPush };
