-- Plan B de caja (Braian 27/11): se guarda el DNI de la venta aunque el cliente todavía no sea socio; cuando se registre, se vincula por DNI.
ALTER TABLE compras_caja ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE compras_caja ADD COLUMN IF NOT EXISTS dni text;
CREATE INDEX IF NOT EXISTS compras_caja_dni ON compras_caja (dni);
