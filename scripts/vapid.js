// Genera un par de claves VAPID para las notificaciones. Se cargan en el panel de Render (VAPID_PUBLIC, VAPID_PRIVATE).
// NUNCA se guardan en el repo. Uso: node scripts/vapid.js
'use strict';
const k = require('web-push').generateVAPIDKeys();
console.log('VAPID_PUBLIC=' + k.publicKey);
console.log('VAPID_PRIVATE=' + k.privateKey);
console.log('\nCopialas al panel de Render > Environment. No las pegues en el chat ni en archivos del repo.');
