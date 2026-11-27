-- Caja rápida (Braian 27/11): además del DNI, el vendedor carga los ÚLTIMOS 2 NÚMEROS de la factura (fiscal o manual).
-- Con local + fecha/hora + esos 2 números se ubica la factura en Z Nube sin ambigüedad.
ALTER TABLE compras_caja ADD COLUMN IF NOT EXISTS fin_factura text;
