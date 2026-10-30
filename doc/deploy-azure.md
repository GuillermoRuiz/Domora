# Despliegue de Domora en Azure (Container Apps + Azure DevOps)

> Runbook operativo. Arquitectura decidida: **Azure Container Apps** para
> cómputo y **Azure Pipelines** (`azure-pipelines.yml`) como CI/CD.
> Estado de preparación y bloqueadores resueltos: ver el plan aprobado y
> los commits `chore(repo)`/`feat(deploy)` de esta rama.

## Arquitectura

```
Internet ──HTTPS──▶ domora-web (nginx: SPA Angular + proxy /api/v1)
                         │ (ingress interno del CAE)
                         ▼
                    domora-api (NestJS; migraciones en el entrypoint)
                         │                        │
                         ▼                        ▼
        PostgreSQL Flexible Server        Azure Files (STORAGE_DIR)
```

- El frontend de producción usa `apiBaseUrl: '/api/v1'` (relativo): el
  navegador solo habla con `domora-web`, y nginx reenvía la API por la red
  interna del Container Apps Environment. Sin CORS en producción.
- Las migraciones Prisma se aplican en el arranque del contenedor de la
  API (`backend/docker-entrypoint.sh`, `migrate deploy` idempotente).
- Secretos (`DATABASE_URL`, `JWT_SECRET`, `SEPA_ENC_KEY`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `SMTP_USER`, `SMTP_PASS`) como secrets de
  Container Apps, inyectados por Bicep. Para endurecer: moverlos a Key
  Vault con referencias (`az containerapp secret set --secrets
  key=keyvaultref:...`).
- `JWT_SECRET`/`SEPA_ENC_KEY`/`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/
  `STRIPE_PRICE_*`/`INVOICE_ISSUER_*` son **obligatorias en producción**:
  `env.validation.ts` aborta el arranque completo de la API si falta
  cualquiera de ellas (no solo degrada lo que dependa de cada una) — ver el
  propio fichero para el porqué de cada una. `SMTP_*` es la excepción: si
  falta, `MailService` degrada a loguear el correo en vez de enviarlo, sin
  bloquear el arranque en ningún caso. `STRIPE_WEBHOOK_SECRET` es distinto
  por entorno: cada uno necesita su propio endpoint de webhook en el
  dashboard de Stripe (Developers → Webhooks), apuntando a
  `https://<fqdn-web-del-entorno>/api/v1/billing/webhook`. Antes de
  desplegar con datos/cobros reales, seguir una vez el runbook de
  `doc/testing-stripe-sandbox.md` contra el sandbox de Stripe — hasta ahora
  esta integración solo se había verificado con eventos simulados en los
  tests.

## 1. Bootstrap de Azure (una sola vez)

```bash
az login
az account set --subscription "<subscription-id-o-nombre>"

# Recursos compartidos
# La región (-l) se puede elegir con libertad para el RG compartido (solo
# aloja el ACR), pero las de test/prod están condicionadas por dónde tu
# suscripción permita crear PostgreSQL Flexible Server — ver nota más abajo.
az group create -n rg-domora-shared -l northeurope
az acr create -n acrdomora -g rg-domora-shared --sku Basic --admin-enabled true

# Entorno TEST
# Generar los secretos en variables ANTES de desplegar — si se generan
# inline dentro de -p (con "$(openssl ...)") el valor nunca se imprime ni
# se puede recuperar después: Azure no permite leer la contraseña de
# administrador de un PostgreSQL Flexible Server ya creado, solo rotarla.
#
# Los STRIPE_* NO se generan con openssl: son los reales de tu cuenta de
# Stripe (modo test para este entorno) — Developers > API keys (secret key),
# Developers > Webhooks (crea el endpoint de este entorno primero para
# obtener su firma) y Product catalog (el Price id de cada plan).
az group create -n rg-domora-test -l northeurope
PG_PASSWORD_TEST=$(openssl rand -base64 24)
JWT_SECRET_TEST=$(openssl rand -hex 32)
SEPA_KEY_TEST=$(openssl rand -hex 32)
echo "postgresPassword (test)=$PG_PASSWORD_TEST"
echo "jwtSecret (test)=$JWT_SECRET_TEST"
echo "sepaEncKey (test)=$SEPA_KEY_TEST"
# GUARDAR ahora mismo estos tres valores en un gestor de secretos, antes
# de continuar — es el único momento en que estarán visibles.
az deployment group create -g rg-domora-test -f infra/main.bicep \
  -p env=test \
     postgresPassword="$PG_PASSWORD_TEST" \
     jwtSecret="$JWT_SECRET_TEST" \
     sepaEncKey="$SEPA_KEY_TEST" \
     invoiceIssuerName="<razón social de Domora>" \
     invoiceIssuerTaxId="<NIF de Domora>" \
     invoiceIssuerAddress="<dirección fiscal de Domora>" \
     stripeSecretKey="<sk_test_... de la cuenta de Stripe de test>" \
     stripeWebhookSecret="<whsec_... del endpoint de webhook de test>" \
     stripePriceBase="<price_... plan BASE, modo test>" \
     stripePriceStandard="<price_... plan STANDARD, modo test>" \
     stripePricePremium="<price_... plan PREMIUM, modo test>"
# SMTP_* es opcional — omitido aquí a propósito (queda vacío, MailService
# degrada a log). Añadirlo más tarde es un redeploy más, ver el apartado
# "1a" más abajo; no hace falta tenerlo listo para este primer despliegue.

# Entorno PROD (grupo de recursos y despliegue propios; secretos PROPIOS,
# generados de nuevo — nunca reutilizar los de test, y usar la cuenta de
# Stripe en modo LIVE, no test)
az group create -n rg-domora-prod -l northeurope
PG_PASSWORD_PROD=$(openssl rand -base64 24)
JWT_SECRET_PROD=$(openssl rand -hex 32)
SEPA_KEY_PROD=$(openssl rand -hex 32)
echo "postgresPassword (prod)=$PG_PASSWORD_PROD"
echo "jwtSecret (prod)=$JWT_SECRET_PROD"
echo "sepaEncKey (prod)=$SEPA_KEY_PROD"
# GUARDAR ahora mismo estos tres valores (distintos de los de test) en el
# gestor de secretos.
az deployment group create -g rg-domora-prod -f infra/main.bicep \
  -p env=prod \
     postgresPassword="$PG_PASSWORD_PROD" \
     jwtSecret="$JWT_SECRET_PROD" \
     sepaEncKey="$SEPA_KEY_PROD" \
     invoiceIssuerName="<razón social de Domora>" \
     invoiceIssuerTaxId="<NIF de Domora>" \
     invoiceIssuerAddress="<dirección fiscal de Domora>" \
     stripeSecretKey="<sk_live_... de la cuenta de Stripe LIVE>" \
     stripeWebhookSecret="<whsec_... del endpoint de webhook LIVE>" \
     stripePriceBase="<price_... plan BASE, modo live>" \
     stripePriceStandard="<price_... plan STANDARD, modo live>" \
     stripePricePremium="<price_... plan PREMIUM, modo live>"
```

Los tres `invoiceIssuer*` y los cinco `stripe*` de arriba son **obligatorios**
(sin valor por defecto): `env.validation.ts` aborta el arranque de la API
en producción si falta cualquiera — no hay atajo posible, ni siquiera para
probar el resto de la app sin Stripe configurado. Si todavía no tienes las
claves de Stripe, no despliegues aún ese entorno — el propio `az
deployment group create` fallará con un error claro de "parámetro
obligatorio no proporcionado" en vez de crear algo que luego no arrancaría.

### 1a. Añadir SMTP más tarde (opcional, no bloquea el resto)

A diferencia de Stripe, `SMTP_*` nunca es obligatorio — sin él, `MailService`
sigue funcionando en modo degradado (loguea el correo en vez de enviarlo).
Cuando tengas las credenciales del proveedor SMTP, un redeploy incremental
sobre el mismo grupo de recursos las añade sin tocar nada más — hay que
repetir también `postgresPassword`/`jwtSecret`/`sepaEncKey` y el resto de
parámetros obligatorios porque Bicep no los recuerda entre despliegues:

```bash
az deployment group create -g rg-domora-test -f infra/main.bicep \
  -p env=test \
     postgresPassword="$PG_PASSWORD_TEST" jwtSecret="$JWT_SECRET_TEST" sepaEncKey="$SEPA_KEY_TEST" \
     invoiceIssuerName="<razón social de Domora>" invoiceIssuerTaxId="<NIF de Domora>" invoiceIssuerAddress="<dirección fiscal de Domora>" \
     stripeSecretKey="<el mismo de antes>" stripeWebhookSecret="<el mismo de antes>" \
     stripePriceBase="<el mismo de antes>" stripePriceStandard="<el mismo de antes>" stripePricePremium="<el mismo de antes>" \
     smtpHost="<smtp.tu-proveedor.com>" smtpPort="587" smtpSecure="false" \
     smtpUser="<usuario SMTP>" smtpPassword="<contraseña SMTP>" \
     smtpFrom="Domora <no-reply@domora.app>"
```

### 1b. Añadir alertas de 5xx y latencia (opcional, no bloquea el resto)

Igual que SMTP: sin `alertEmail`, no se crea ninguna alerta y el resto del
despliegue sigue igual. Con él, un redeploy incremental crea un *action
group* de email y 4 alertas de métrica — dos por cada Container App (API y
web): "más de N respuestas 5xx en 5 minutos" y "tiempo de respuesta medio
por encima de M ms en 5 minutos". Usan las métricas nativas de Container
Apps (`Requests` con dimensión `statusCodeCategory`, y `ResponseTime`) —
no hace falta instrumentar la app con Application Insights ni ningún SDK.

```bash
az deployment group create -g rg-domora-prod -f infra/main.bicep \
  -p env=prod \
     postgresPassword="$PG_PASSWORD_PROD" jwtSecret="$JWT_SECRET_PROD" sepaEncKey="$SEPA_KEY_PROD" \
     invoiceIssuerName="<razón social de Domora>" invoiceIssuerTaxId="<NIF de Domora>" invoiceIssuerAddress="<dirección fiscal de Domora>" \
     stripeSecretKey="<el mismo de antes>" stripeWebhookSecret="<el mismo de antes>" \
     stripePriceBase="<el mismo de antes>" stripePriceStandard="<el mismo de antes>" stripePricePremium="<el mismo de antes>" \
     alertEmail="<email que recibe las alertas>"
     # alert5xxThreshold (por defecto 5) y alertLatencyThresholdMs (por
     # defecto 3000) son ajustables si el umbral por defecto genera ruido
     # o tarda de más en avisar — ver los parámetros en infra/main.bicep.
```

Los umbrales por defecto (5 respuestas 5xx o 3 s de media en una ventana de
5 minutos) son un punto de partida razonable, no un valor validado contra
tráfico real — conviene revisarlos tras las primeras semanas en producción,
sobre todo si el *readiness probe* de la API genera algún falso positivo.

Si ya desplegaste usando la forma inline y no guardaste los valores, no
son recuperables (ni siquiera Azure puede leer la contraseña de
administrador de un servidor ya creado). Hay que rotarlos:

```bash
NEW_PG_PASSWORD=$(openssl rand -base64 24)
echo "$NEW_PG_PASSWORD"   # guárdala ahora
az postgres flexible-server update -g rg-domora-test -n pg-domora-test \
  --admin-password "$NEW_PG_PASSWORD"
# Luego re-ejecutar az deployment group create (paso anterior) con el
# mismo env y este mismo valor para que el secreto database-url del
# Container App de la API quede sincronizado — el despliegue es
# idempotente sobre el resto de recursos.
```

En el primer despliegue de cada entorno el ACR aún no tiene ninguna
imagen propia: `infra/main.bicep` usa por defecto (`imageTag = 'bootstrap'`)
una imagen pública de arranque (`mcr.microsoft.com/k8se/quickstart`) en
vez de `domora-api`/`domora-web:latest` — un tag propio inexistente hace
fallar el `ARM deployment` completo con `MANIFEST_UNKNOWN`, ya que Container
Apps valida la imagen al aprovisionar. El primer run del pipeline
sustituye esa imagen de inmediato por la real (`az containerapp update`
con el SHA del commit); las apps quedan con la app real en cuanto termina
`BuildImages`/`DeployTest`.

**Si tu suscripción restringe la región elegida para PostgreSQL Flexible
Server** (error `LocationIsOfferRestricted`), el resto de recursos del
`az deployment group create` puede haberse creado igualmente, pero el
deployment se marca como fallido en conjunto. Repite el mismo comando
con `-p env=test` sobre un grupo de recursos creado en otra región (o
solicita el aumento de cupo: https://aka.ms/postgres-request-quota-increase)
— es idempotente sobre los recursos ya creados.

## 2. Bootstrap de Azure DevOps (una sola vez)

1. **Proyecto** en dev.azure.com (p. ej. `Domora`).
2. **Repo**: conectar el repo GitHub existente (GitHub service connection)
   o espejarlo en Azure Repos. El pipeline apunta a `azure-pipelines.yml`
   en la raíz.
3. **Service connection ARM** `sc-domora-azure` (Workload Identity
   Federation):
   - Project Settings (icono de engranaje, abajo a la izquierda) →
     **Service connections** → **New service connection** → **Azure
     Resource Manager** → **Workload Identity federation (automatic)**.
   - Alcance: suscripción completa, o los 3 RG (`rg-domora-shared`,
     `rg-domora-test`, `rg-domora-prod`) si se prefiere alcance mínimo.
   - Nombre exacto: `sc-domora-azure` (debe coincidir con
     `azureSubscription` en `azure-pipelines.yml`).
   - **Permisos RBAC que necesita la identidad de esta service
     connection** (asignar en Azure, no en Azure DevOps):
     - `AcrPush` sobre `rg-domora-shared` (o sobre el ACR directamente) —
       para `docker push` en el stage `BuildImages`.
     - Rol `Contributor` (o equivalente) sobre `rg-domora-test` y
       `rg-domora-prod` — para `az containerapp update` en `DeployTest`/
       `DeployProd`.
     - Permiso de lectura + `listCredentials` sobre `rg-domora-shared` —
       requerido por `infra/main.bicep`, que hace `acr.listCredentials()`
       al desplegar/actualizar test o prod (si el bootstrap de un entorno
       se re-ejecuta con esta service connection en vez de tu propia
       sesión `az login`).
4. **Environments**: Pipelines → **Environments** → **New environment**.
   - `domora-test`: sin checks (deploy automático).
   - `domora-prod`: crear igual y luego, dentro del environment → menú
     `⋮` → **Approvals and checks** → **Approvals** → añadir el/los
     aprobador(es) humano(s) obligatorio(s).
5. **Variable group** `domora-deploy` (Pipelines → **Library** → **+
   Variable group**). Nombres de apps separados por entorno para evitar
   ambigüedad entre `DeployTest` y `DeployProd`:
   | Variable | Ejemplo |
   |---|---|
   | ACR_NAME | acrdomora |
   | RG_TEST | rg-domora-test |
   | RG_PROD | rg-domora-prod |
   | API_APP_NAME_TEST | domora-api-test |
   | WEB_APP_NAME_TEST | domora-web-test |
   | API_APP_NAME_PROD | domora-api-prod |
   | WEB_APP_NAME_PROD | domora-web-prod |
   | TEST_API_URL | https://\<fqdn-web-test\>/api/v1 |
   | PROD_API_URL | https://\<fqdn-web-prod\>/api/v1 |

   Los nombres de Container App (`domora-api-<env>`/`domora-web-<env>`)
   los fija `infra/main.bicep`; los FQDN de test/prod se obtienen del
   `output webUrl` que imprime `az deployment group create` al desplegar
   cada entorno (paso 1).
6. **Pipeline**: Pipelines → New → seleccionar el repo →
   `azure-pipelines.yml` existente → Run.

## 3. Qué hace el pipeline

| Stage | Cuándo | Qué |
|---|---|---|
| CI | Todo push/PR | Backend: lint+build+jest y **smoke e2e real** contra Postgres 16 de servicio (migraciones+seed+`scripts/smoke-e2e.sh`). Frontend: typecheck + build producción. |
| BuildImages | Rama principal | `docker build`+push de `domora-api` y `domora-web` a ACR, tag = SHA del commit. |
| DeployTest | Tras BuildImages | `az containerapp update` a la nueva imagen, **seed idempotente automático** (`npx prisma db seed` vía `az containerapp exec`) y smoke e2e contra la URL de test. |
| DeployProd | Tras DeployTest, **con aprobación manual** | Mismo update contra los RG/apps de prod (sin seed) + `curl` a `$(PROD_API_URL)/health` como verificación post-deploy. |

## 4. Rollback

Container Apps conserva revisiones. Para volver a la anterior:

```bash
az containerapp revision list -g rg-domora-prod -n domora-api-prod -o table
az containerapp revision activate -g rg-domora-prod -n domora-api-prod \
  --revision <nombre-revision-anterior>
```

Las migraciones Prisma son aditivas (nunca se ha emitido un DROP
destructivo salvo `users_active` en la 0.5); un rollback de imagen sobre
un esquema más nuevo es seguro para las revisiones recientes. Para
cambios de esquema incompatibles, planificar expand/contract.

## 5. Operación

- **Logs**: Log Analytics del environment
  (`ContainerAppConsoleLogs_CL`); `az containerapp logs show -n ... -g ... --follow`.
- **Backups BD**: automáticos (7 días test / 35 prod, geo-redundante en
  prod). Restore: `az postgres flexible-server restore`. **Probar el
  restore en test al menos una vez antes del go-live.**
- **Seed**: automático en cada `DeployTest` del pipeline (paso idempotente,
  seguro de re-ejecutar). Manual solo si hace falta forzarlo fuera del
  pipeline: `az containerapp exec -n domora-api-test -g rg-domora-test
  --command "npx prisma db seed"`. **Nunca en prod** — el pipeline no
  incluye ese paso en `DeployProd` a propósito.
- **Rotación de SEPA_ENC_KEY**: requiere re-cifrado por lotes de
  `mandates.debtor_iban` y `estates.creditor_iban` (script pendiente;
  hasta entonces, tratar la clave como no-rotable y custodiarla en
  consecuencia).
- **Alertas de 5xx y latencia**: si se desplegó con `alertEmail` (ver
  apartado 1b), 4 alertas de métrica (`alert-api-5xx-<env>`,
  `alert-api-latency-<env>`, `alert-web-5xx-<env>`, `alert-web-latency-<env>`)
  avisan al *action group* `ag-domora-<env>`. Ver/silenciar desde Azure
  Monitor → Alerts, o `az monitor metrics alert list -g rg-domora-<env>`.

## 6. Pendientes conocidos post-despliegue

- Key Vault + referencias en lugar de secrets planos de Container App.
- VNet integration + private endpoint para PostgreSQL (hoy: firewall
  "servicios de Azure").
- Driver Azure Blob en `backend/src/files/storage.service.ts` como
  alternativa a Azure Files (la clase está diseñada para sustituirse).
- Dominio propio + certificado gestionado en `domora-web`.
- ~~Alertas (App Insights / alertas de Log Analytics sobre 5xx y latencia)~~
  — resuelto: alertas de métrica nativa de Container Apps (apartado 1b,
  parámetro `alertEmail`). Queda pendiente, si hiciera falta más adelante,
  una alerta sobre `RestartCount` (reinicios en bucle) y trazas distribuidas
  reales vía Application Insights — ninguna de las dos se pidió todavía.
