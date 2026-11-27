// Envío de emails detrás de una interfaz.
// - "consola": lo deja en el log y en memoria (pruebas, o si falta la clave).
// - "resend" (aprobado por Braian 27/11): API de resend.com, remitente EMAIL_REMITENTE (por defecto club@md58club.com).
//   Necesita RESEND_API_KEY (se carga a mano en Render, nunca en el repo) y el dominio md58club.com verificado en Resend.
// Un mail que no sale NUNCA frena el registro: se registra el error en el log y se sigue.
'use strict';
const enviados = [];
function crearCorreo(env = process.env, fetchImpl = globalThis.fetch) {
  let proveedor = env.EMAIL_PROVEEDOR || 'consola';
  if (proveedor === 'resend' && !env.RESEND_API_KEY) { console.warn('EMAIL_PROVEEDOR=resend pero falta RESEND_API_KEY: los mails quedan en consola'); proveedor = 'consola'; }
  if (!['consola', 'resend'].includes(proveedor)) throw new Error(`Proveedor de email "${proveedor}" no implementado`);
  const tapado = para => String(para).replace(/^(.).*@/, '$1***@');
  const remitente = env.EMAIL_REMITENTE || 'MD58 Club <club@md58club.com>';
  return {
    proveedor,
    async enviar({ para, asunto, texto }) {
      enviados.push({ para, asunto, texto, fecha: new Date().toISOString() });
      if (enviados.length > 200) enviados.shift();
      if (proveedor === 'consola') { console.log(`[email consola] para ${tapado(para)} · ${asunto}`); return { ok: true }; }
      try {
        const r = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: remitente, to: [para], subject: asunto, text: texto }),
        });
        if (!r.ok) { console.error(`[email resend] ${r.status} para ${tapado(para)}: ${(await r.text()).slice(0, 200)}`); return { ok: false }; }
        return { ok: true };
      } catch (e) { console.error(`[email resend] error para ${tapado(para)}: ${e.message}`); return { ok: false }; }
    },
  };
}
module.exports = { crearCorreo, enviados };
