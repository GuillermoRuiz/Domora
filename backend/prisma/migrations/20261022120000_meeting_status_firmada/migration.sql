-- Nuevo estado de junta: el acta ya está firmada por presidente y secretario.
-- El valor se añade en su propia migración: no puede usarse en la misma transacción.
ALTER TYPE "MeetingStatus" ADD VALUE IF NOT EXISTS 'firmada';
