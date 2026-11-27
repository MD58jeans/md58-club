-- Corrección (27/11/2026): la bienvenida se cargó con vigencia enero 2026 por error; es enero 2027 (Braian: 15% del 2 al 31/1,
-- no acumulable con otras promociones). Solo toca las bienvenidas sin canjear con la fecha equivocada.
UPDATE beneficios SET vigencia_desde = '2027-01-02', vigencia_hasta = '2027-01-31'
 WHERE tipo = 'bienvenida' AND estado = 'asignado' AND vigencia_desde = '2026-01-02' AND vigencia_hasta = '2026-01-31';
