-- Caja rápida (Braian 27/11): en caja solo se carga el DNI; el comprobante es opcional y se resuelve después cruzando
-- local + hora con el INFORME COMPROBANTES de Z Nube. Varias filas sin comprobante pueden convivir (NULL no choca con UNIQUE).
ALTER TABLE compras_caja ALTER COLUMN comprobante DROP NOT NULL;
ALTER TABLE compras_caja ADD COLUMN IF NOT EXISTS comprobante_cruzado text;   -- lo completa el cruce con Z Nube
ALTER TABLE compras_caja ADD COLUMN IF NOT EXISTS cruce_estado text;          -- unico | a_revisar | sin_venta
