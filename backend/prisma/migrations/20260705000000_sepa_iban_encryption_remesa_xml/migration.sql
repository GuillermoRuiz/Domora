-- Fase 6 (SEPA/Remesas):
--
-- 1. Los IBAN en reposo pasan a cifrarse a nivel de aplicación
--    (AES-256-GCM, ver backend/src/sepa/crypto.service.ts). El texto
--    cifrado ('enc:v1:' + base64(iv|tag|ciphertext)) no cabe en
--    VARCHAR(34), así que se ensanchan las dos columnas afectadas.
-- 2. El XML pain.008 presentado al banco se persiste en la propia remesa
--    (xml_content) para servirlo byte a byte en descargas posteriores —
--    nunca se regenera (preservación del snapshot legal).

ALTER TABLE "mandates" ALTER COLUMN "debtor_iban" TYPE VARCHAR(255);
ALTER TABLE "estates" ALTER COLUMN "creditor_iban" TYPE VARCHAR(255);
ALTER TABLE "remesas" ADD COLUMN "xml_content" TEXT;
