-- MD58 Club · esquema inicial (26/11/2026). DATOS PERSONALES: esta base vive en el servidor (Render), nunca en el repo.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE clientes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),     -- identificador interno (no es el DNI)
  dni                text UNIQUE,                                     -- número de socio visible; puede faltar en históricos
  celular            text UNIQUE,                                     -- 549 + característica + número
  nombre             text,
  apellido           text,
  email              text,
  email_verificado   boolean NOT NULL DEFAULT false,
  nacimiento         date,
  localidad          text,
  local_alta         text,                                            -- código Z Nube del local (Origen - Sitio)
  vendedor_alta      text,
  fecha_alta         timestamptz,                                     -- alta en el Club (null = solo histórico)
  estado             text NOT NULL DEFAULT 'registrado'
                     CHECK (estado IN ('historico','registrado','app_instalada','notificaciones')),
  celular_verificado boolean NOT NULL DEFAULT false,
  app_instalada_en   timestamptz,
  notificaciones_en  timestamptz,
  origen_historico   text,                                            -- de dónde vino si era histórico (contactos_local, tarjetas...)
  locales_historicos text,
  token_version      integer NOT NULL DEFAULT 1,                      -- subirla invalida todas las sesiones del socio
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now(),
  CHECK (dni IS NULL OR dni ~ '^[0-9]{7,8}$'),
  CHECK (celular IS NULL OR celular ~ '^549[0-9]{10}$')
);
CREATE INDEX clientes_local_alta ON clientes (local_alta, fecha_alta);
CREATE INDEX clientes_estado ON clientes (estado);

CREATE TABLE consentimientos (
  id         bigserial PRIMARY KEY,
  cliente_id uuid NOT NULL REFERENCES clientes(id),
  tipo       text NOT NULL CHECK (tipo IN ('datos','promos')),
  valor      boolean NOT NULL,
  texto      text NOT NULL,                                           -- el texto exacto que aceptó
  origen     text NOT NULL,                                           -- registro_qr, bot, panel...
  fecha      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consentimientos_cliente ON consentimientos (cliente_id, tipo, fecha DESC);

CREATE TABLE dispositivos (
  id          bigserial PRIMARY KEY,
  cliente_id  uuid NOT NULL REFERENCES clientes(id),
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  plataforma  text,
  activo      boolean NOT NULL DEFAULT true,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  ultimo_error text
);

CREATE TABLE beneficios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id     uuid NOT NULL REFERENCES clientes(id),
  tipo           text NOT NULL CHECK (tipo IN ('bienvenida','cumpleanios','campania')),
  porcentaje     numeric(5,2) NOT NULL,
  vigencia_desde date NOT NULL,
  vigencia_hasta date NOT NULL,
  estado         text NOT NULL DEFAULT 'asignado' CHECK (estado IN ('asignado','canjeado','vencido','anulado')),
  codigo         text NOT NULL UNIQUE,
  canje_fecha    timestamptz,
  canje_local    text,
  canje_vendedor text,
  canje_comprobante text,
  canje_validado_por text,
  creado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX beneficios_una_bienvenida ON beneficios (cliente_id) WHERE tipo = 'bienvenida';

CREATE TABLE compras_caja (                                         -- Plan B: identificación de compra desde /caja
  id          bigserial PRIMARY KEY,
  cliente_id  uuid NOT NULL REFERENCES clientes(id),
  local       text NOT NULL,
  vendedor    text,
  comprobante text NOT NULL,
  fecha       timestamptz NOT NULL DEFAULT now(),
  cargado_por text NOT NULL,
  UNIQUE (local, comprobante)
);

CREATE TABLE auditoria (
  id         bigserial PRIMARY KEY,
  fecha      timestamptz NOT NULL DEFAULT now(),
  tipo       text NOT NULL,                                           -- alta, union_historico, conflicto, recuperar, caja_compra, export...
  cliente_id uuid,
  quien      text,
  detalle    jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX auditoria_tipo_fecha ON auditoria (tipo, fecha);
