-- Las juntas con el acta ya firmada pasan al nuevo estado.
UPDATE "meetings" SET "status" = 'firmada' WHERE "status" = 'celebrada' AND "acta_signed_at" IS NOT NULL;
