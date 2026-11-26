// Envío de emails detrás de una interfaz. Hoy: "consola" (lo deja en el log y en memoria para las pruebas).
// Para enviar de verdad hay que sumar un proveedor (EMAIL_PROVEEDOR) con aprobación de gerencia; no hay ninguno elegido.
'use strict';
const enviados = [];
function crearCorreo(env = process.env) {
  const proveedor = env.EMAIL_PROVEEDOR || 'consola';
  if (proveedor !== 'consola') throw new Error(`Proveedor de email "${proveedor}" no implementado (falta elegirlo con gerencia)`);
  return {
    proveedor,
    async enviar({ para, asunto, texto }) {
      enviados.push({ para, asunto, texto, fecha: new Date().toISOString() });
      if (enviados.length > 200) enviados.shift();
      console.log(`[email consola] para ${para.replace(/^(.).*@/, '$1***@')} · ${asunto}`);
      return { ok: true };
    },
  };
}
module.exports = { crearCorreo, enviados };
