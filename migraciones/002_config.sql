-- Configuración interna del servidor (ej. claves VAPID de notificaciones generadas en el primer arranque).
CREATE TABLE IF NOT EXISTS config (
  clave text PRIMARY KEY,
  valor text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
