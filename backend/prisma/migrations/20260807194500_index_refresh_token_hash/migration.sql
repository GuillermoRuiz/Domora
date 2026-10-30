-- CreateIndex
-- Índice único sobre el hash del refresh token. Además de expresar la
-- unicidad real (el hash identifica al token), es el índice que necesita
-- AuthService.refresh(), que buscaba por esta columna sin índice en cada
-- renovación de sesión — un seq scan en la ruta más caliente de la API.
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
