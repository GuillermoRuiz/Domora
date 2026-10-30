-- «Contactos clave» de la finca: una persona concreta de una propiedad
-- (miembro con cuenta o titular importado), marcada por la gestora.
ALTER TABLE "property_memberships" ADD COLUMN "is_key_contact" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "external_owners" ADD COLUMN "is_key_contact" BOOLEAN NOT NULL DEFAULT false;
