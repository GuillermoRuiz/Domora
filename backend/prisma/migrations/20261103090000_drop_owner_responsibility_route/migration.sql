-- Las incidencias son solo de la comunidad: la vía «Responsabilidad del propietario» deja de existir. Las que la tenían
-- vuelven a «sin decidir» (la gestión elige otra); el historial conserva el evento tal como se escribió.
UPDATE "issues" SET "resolution_route" = NULL WHERE "resolution_route" = 'owner_responsibility';
