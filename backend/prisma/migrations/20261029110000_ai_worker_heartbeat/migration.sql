-- Latido del worker de IA: cada proceso que atiende la cola escribe su fila periódicamente. La proyección de la
-- situación de las incidencias lo usa para distinguir «Domora gestionando» (hay worker sano) de «Automatización
-- pendiente» (hay un job pero nadie que lo atienda) sin esperar al margen de los jobs huérfanos. Dato operativo:
-- sin contenido del expediente y sin relación con el entitlement de ninguna gestora.
CREATE TABLE "ai_worker_heartbeats" (
  "instance_id" VARCHAR(120) NOT NULL,
  "kinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "beat_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "ai_worker_heartbeats_pkey" PRIMARY KEY ("instance_id")
);
CREATE INDEX "ai_worker_heartbeats_beat_at_idx" ON "ai_worker_heartbeats"("beat_at");
