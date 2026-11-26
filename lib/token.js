// Tokens firmados (HMAC-SHA256 con SECRET). Sesión del socio, link de email y código de la tarjeta.
'use strict';
const crypto = require('crypto');
const b64 = b => Buffer.from(b).toString('base64url');

function firmar(secreto, datos) {
  const cuerpo = b64(JSON.stringify(datos));
  return cuerpo + '.' + crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64url');
}
function verificar(secreto, token) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [cuerpo, firma] = token.split('.');
  if (!cuerpo || !firma) return null;
  const esperada = crypto.createHmac('sha256', secreto).update(cuerpo).digest();
  const dada = Buffer.from(firma, 'base64url');
  if (dada.length !== esperada.length || !crypto.timingSafeEqual(dada, esperada)) return null;
  try {
    const d = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    if (d.exp && Date.now() > d.exp) return null;
    return d;
  } catch { return null; }
}
// Tipos: s = sesión {t:'s', id, v}, e = verificar email {t:'e', id, email, exp}, r = recuperar {t:'r', id, v, exp}, c = tarjeta {t:'c', id}
module.exports = { firmar, verificar };
