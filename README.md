# MD58 Club · app de socios (MVP para el 1/12/2026)

Registro de socios por QR en cada local, tarjeta digital instalable (PWA), beneficio de bienvenida (15% para enero),
notificaciones web propias, panel de gerencia y página de caja (Plan B, apagada por defecto). Plan completo: `../CLUB_MD58.md`.

**Datos personales (Ley 25.326):** viven solo en la base Postgres del servidor (cuenta de gerencia en Render). Nunca en el repo.

## Qué hay
| Archivo | Qué hace |
|---|---|
| `server.js` | Servidor (Node 18+, dependencias: `pg` y `web-push`). Aplica migraciones al arrancar. |
| `migraciones/001_inicial.sql` | Tablas: clientes, consentimientos, dispositivos, beneficios, compras_caja, auditoria. |
| `lib/club.js` | Alta y unión de socios (sin duplicar), tarjeta, notificaciones, panel, caja, importación de históricos. |
| `lib/validar.js` · `lib/token.js` · `lib/http.js` | Validaciones, tokens firmados (HMAC), cabeceras de seguridad, claves y límite por IP. |
| `lib/correo.js` | Envío de emails detrás de una interfaz. Hoy **"consola"** (no manda nada real): falta elegir proveedor con gerencia. |
| `lib/push.js` | Notificaciones Web Push con claves VAPID propias (sin Firebase ni terceros). |
| `public/` | App del socio (`index.html`, `app.js`, `estilos.css`, `sw.js`), panel (`panel.*`), caja (`caja.*`), íconos, generador de QR (`vendor/qrcode.js`, MIT, Kazuhiko Arase). |
| `locales.json` · `vendedores.json` | Los 17 locales (código del QR → código Z Nube) y la lista opcional de vendedores por local (se edita y se republica). |
| `scripts/` | `migrar.js`, `importar_historicos.js`, `vapid.js` (genera claves), `qr_locales.js` (QR de los carteles), `pg_local.sh` (Postgres local para pruebas). |
| `test/club.test.js` | 13 pruebas contra Postgres real. `test/ui_playwright.js`: flujo en iPhone y Android emulados + panel, con capturas. |
| `../../../render.yaml` | Blueprint de Render: servicio web + Postgres. |

## Rutas
- Socio: `/r/<local>` (QR del local → registro) · `/t/<token>` (tarjeta) · `/tarjeta` · `/recuperar` · `/v/<token>` (confirmar email) · `/terminos`.
- Gerencia: `/panel` (usuario y clave de `PANEL_USUARIOS`): registros por día, local y vendedor; % app y notificaciones; export CSV (auditado); notificación de prueba.
- Caja (Plan B): `/caja`, solo con `CAJA_ACTIVA=1`; usuario = código del local, clave en `CAJA_CLAVES`. Busca socio por DNI o QR de la tarjeta y guarda el N° de comprobante.

## Cómo funciona el registro
1. QR del local → formulario: nombre, apellido, DNI, celular, email, fecha de nacimiento (obligatorios), localidad (opcional),
   aceptación de términos/datos (obligatoria) y permiso de promos (aparte, opcional). Vendedor: desplegable si el local tiene lista.
2. Mismo DNI o celular = mismo cliente. Si era **histórico** (base importada) pasa a socio. Si ya era socio, no entrega la sesión:
   le manda el link de su tarjeta al email. Si DNI y celular son de personas distintas: no fusiona, queda en auditoría y se le pide ayuda al vendedor.
3. Se asigna el beneficio de bienvenida (15%, del 2 al 31 de enero, código único `MD-XXXXXXXX`) y se manda el mail de confirmación.
4. Tarjeta: nombre, N° de socio (DNI), QR firmado, beneficio. Instrucciones para instalar según iPhone/Android y botón de notificaciones.
   En iPhone la app instalada no comparte datos con Safari: el manifest lleva la sesión en `start_url`, así el ícono abre la tarjeta.

## Variables (panel de Render; nunca en el repo)
| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Postgres (la pone el Blueprint). |
| `SECRET` | 32+ caracteres al azar (firma sesiones y QR). Cambiarlo cierra todas las sesiones. |
| `BASE_URL` | `https://md58club.com` (links de los emails). |
| `PANEL_USUARIOS` | `Braian:<clave>` (clave de 8+ caracteres; varios separados por coma). |
| `VAPID_PUBLIC` / `VAPID_PRIVATE` | Opcionales. Si no están, el servidor genera las claves de notificaciones en el primer arranque y las guarda en la base (tabla `config`); no hace falta cargarlas. |
| `CAJA_ACTIVA` · `CAJA_CLAVES` | Plan B: `1` y `las_vegas:<clave>,zarate:<clave>,...`. |
| `CONTACTO_DATOS` | Email o canal para pedir ver/corregir/borrar datos (se muestra en Términos). |
| `EMAIL_PROVEEDOR` | `consola` hasta que gerencia elija un proveedor. |
| `LIMITE_REGISTRO` | Registros por IP cada 10 min (20 por defecto). |

## Probar en la compu
```
bash scripts/pg_local.sh                                     # Postgres local (puerto 54329)
npm ci
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npm test
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres NODE_PATH=$(npm root -g):$PWD/node_modules node test/ui_playwright.js <carpeta_capturas>
DATABASE_URL=postgres://postgres@127.0.0.1:54329/md58club_dev SECRET=$(openssl rand -hex 32) PANEL_USUARIOS=Braian:clave-larga-1 node server.js
```
Importar la base histórica (CSV del Drive, **fuera del repo**): `DATABASE_URL=... node scripts/importar_historicos.js /ruta/base.csv`
(las filas con algo en `revisar` se saltean).

## Pendiente para salir (ver `../CLUB_MD58.md`)
Comprar `md58club.com` y apuntar el DNS a Render · crear el Blueprint en Render · cargar variables · elegir proveedor de email
(sin eso los mails de confirmación y recuperación no salen) · textos legales revisados e inscripción en AAIP · carteles con los QR ·
D2 (cómo se identifica la compra) · pruebas en iPhone y Android reales.
