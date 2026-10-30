-- Una incidencia es siempre una incidencia: el antiguo «tipo de aviso» heredado de los tickets (Incidencia, Solicitud, Consulta,
-- Sugerencia) desaparece. `issues.type` (Avería, Fuga…) sigue clasificando el problema. Los datos actuales son de prueba: no se
-- conserva ni se traslada ninguna categoría anterior.
ALTER TABLE "issues" DROP COLUMN "category";
DROP TYPE "IssueCategory";
