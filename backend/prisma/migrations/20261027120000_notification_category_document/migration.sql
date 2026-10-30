-- Aviso a los propietarios cuando se les abre un documento de la biblioteca.
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'document';
