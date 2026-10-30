// Infraestructura Domora por entorno (test/prod) — Azure Container Apps.
//
// Despliegue (una vez por entorno, ver el listado completo de parámetros
// obligatorios y opcionales en doc/deploy-azure.md):
//   az group create -n rg-domora-test -l northeurope
//   az deployment group create -g rg-domora-test -f infra/main.bicep \
//     -p env=test postgresPassword=<secreto> jwtSecret=<secreto> sepaEncKey=<64hex> \
//        invoiceIssuerName=<razon social> invoiceIssuerTaxId=<NIF> invoiceIssuerAddress=<direccion fiscal> \
//        stripeSecretKey=<sk_live_o_sk_test> stripeWebhookSecret=<whsec_...> \
//        stripePriceBase=<price_...> stripePriceStandard=<price_...> stripePricePremium=<price_...>
//   # SMTP_* es opcional (tiene valor por defecto vacío, ver más abajo) — sin
//   # él el correo se queda en log en vez de fallar el despliegue.
//
// Los parámetros de Stripe y de datos fiscales (VERI*FACTU) son obligatorios
// en CUALQUIER entorno desplegado con este fichero, test incluido: `NODE_ENV`
// se fija a 'production' más abajo sin distinguir por `env` (ver apiApp), y
// `env.validation.ts` aborta el arranque del contenedor si falta alguno de
// ellos con NODE_ENV=production — sin ellos, el contenedor de la API entra en
// crash-loop nada más arrancar, no responde con 503: no llega a levantar en
// absoluto.
//
// La región del resource group (-l) fija dónde se crean todos los
// recursos, incluido PostgreSQL Flexible Server. Si tu suscripción tiene
// restringida esa región para Postgres (error "LocationIsOfferRestricted"),
// prueba con otra (p. ej. northeurope, swedencentral, francecentral) o
// solicita el aumento de cupo: https://aka.ms/postgres-request-quota-increase
//
// El ACR es compartido entre entornos y se crea aparte (una sola vez):
//   az acr create -n acrdomora -g rg-domora-shared --sku Basic

@allowed(['test', 'prod'])
param env string
param location string = resourceGroup().location

@description('Opt-in private RAG foundation. Existing deployment remains unchanged when false.')
param enableRagFoundation bool = false
@description('Operator-supplied addressPrefix/subnetPrefixes/Entra admin/PG SKU+size. See docs/rag-audit/MIGRATION.md.')
param ragFoundation object = {}

module rag 'rag.bicep' = if (enableRagFoundation) {
  name: 'domora-rag-foundation'
  params: {
    env: env
    location: location
    addressPrefix: enableRagFoundation ? ragFoundation.addressPrefix : ''
    subnetPrefixes: enableRagFoundation ? ragFoundation.subnetPrefixes : {}
    entraAdminObjectId: enableRagFoundation ? ragFoundation.entraAdminObjectId : ''
    entraAdminName: enableRagFoundation ? ragFoundation.entraAdminName : ''
    postgresSku: enableRagFoundation ? ragFoundation.postgresSku : ''
    postgresStorageGB: enableRagFoundation ? ragFoundation.postgresStorageGB : 32
    azureOpenAIAccountName: contains(ragFoundation,'azureOpenAIAccountName') ? ragFoundation.azureOpenAIAccountName : ''
  }
}

@secure()
param postgresPassword string
@secure()
param jwtSecret string
@secure()
@description('64 hex chars — openssl rand -hex 32. Cifrado de IBAN en reposo.')
param sepaEncKey string

// ── Datos fiscales del emisor (VERI*FACTU) ──────────────────────────────
// Sin valor por defecto a propósito: env.validation.ts aborta el arranque
// en producción si falta cualquiera de los tres — mejor que el despliegue
// falle aquí a que salga una factura con datos fiscales inventados. No son
// secretos (van impresos en cada factura), pero sí obligatorios.
@description('Nombre legal de Domora tal y como debe figurar en cada factura emitida a las gestoras.')
param invoiceIssuerName string
@description('NIF/CIF de Domora.')
param invoiceIssuerTaxId string
@description('Dirección fiscal de Domora.')
param invoiceIssuerAddress string

// ── Stripe (cobro de la suscripción SaaS) ───────────────────────────────
// También sin valor por defecto: STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_*
// son igual de obligatorias en producción que JWT_SECRET — si faltan, la
// API entera no arranca (no solo los endpoints de pago). No hay un valor
// de prueba razonable que no sea simplemente no desplegar hasta tenerlos.
@secure()
param stripeSecretKey string
@secure()
param stripeWebhookSecret string
@description('Price ID de Stripe para el plan BASE (modo live o test según el entorno).')
param stripePriceBase string
@description('Price ID de Stripe para el plan STANDARD.')
param stripePriceStandard string
@description('Price ID de Stripe para el plan PREMIUM.')
param stripePricePremium string

// ── SMTP (correo transaccional) ─────────────────────────────────────────
// A diferencia de Stripe, MailService degrada a loguear en vez de enviar
// si SMTP_HOST falta — nunca bloquea el arranque (env.validation.ts no lo
// exige en ningún caso) — así que estos sí tienen valor por defecto vacío:
// se puede desplegar sin ellos y rellenarlos más tarde con un redeploy.
param smtpHost string = ''
param smtpPort string = '587'
param smtpSecure string = 'false'
@secure()
param smtpUser string = ''
@secure()
param smtpPassword string = ''
@description('Remitente de los correos transaccionales. Vacío = usa el valor por defecto del código ("Domora <no-reply@domora.app>").')
param smtpFrom string = ''

// ── VAPID (push real al navegador) ──────────────────────────────────────
// Mismo criterio que SMTP: PushService degrada a solo loguear si faltan
// — nunca bloquea el arranque (env.validation.ts no los exige en ningún
// caso) — así que también tienen valor por defecto vacío. Se generan una
// vez con `npx web-push generate-vapid-keys` y no cambian entre despliegues.
param vapidPublicKey string = ''
@secure()
param vapidPrivateKey string = ''
@description('Contacto del par VAPID (mailto: o https://). Vacío = usa el valor por defecto del código.')
param vapidSubject string = ''

// ── Alertas de monitorización (5xx y latencia) ──────────────────────────
// Igual que SMTP: opcional, con valor por defecto vacío — sin alertEmail
// no se crea ni el action group ni ninguna alerta, y el resto del
// despliegue sigue exactamente igual que antes de añadir esto. Con él, se
// usan las métricas NATIVAS de Container Apps (Requests con dimensión
// statusCodeCategory, y ResponseTime) — no hace falta instrumentar la app
// con Application Insights ni ningún SDK para esto.
@description('Email que recibe las alertas de 5xx y latencia. Vacío = no se crea ninguna alerta (monitorización opcional, no bloquea el despliegue).')
param alertEmail string = ''
@description('Nº de respuestas 5xx en la ventana de evaluación (5 min) que dispara la alerta.')
param alert5xxThreshold int = 5
@description('Tiempo medio de respuesta (ms) en la ventana de evaluación (5 min) que dispara la alerta.')
param alertLatencyThresholdMs int = 3000

param acrName string = 'acrdomora'
param acrResourceGroup string = 'rg-domora-shared'
@description('Tag de imagen inicial; los despliegues posteriores los hace el pipeline con az containerapp update. "bootstrap" usa una imagen pública de arranque porque en el primer despliegue el ACR aún no tiene ninguna imagen propia — un tag propio inexistente (p. ej. "latest") hace fallar el ARM deployment entero con MANIFEST_UNKNOWN.')
param imageTag string = 'bootstrap'

var bootstrapImage = 'mcr.microsoft.com/k8se/quickstart:latest'

var isProd = env == 'prod'
var pgServerName = 'pg-domora-${env}'
var pgDatabase = 'domora'
var pgUser = 'domora'

// ── Log Analytics + Container Apps Environment ──────────────────────────
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-domora-${env}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: isProd ? 90 : 30
  }
}

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-domora-${env}'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

// ── Azure Files para STORAGE_DIR (documentos/fotos, Fase 12) ────────────
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stdomora${env}'
  location: location
  sku: { name: isProd ? 'Standard_ZRS' : 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: 'domora-files'
  properties: { shareQuota: isProd ? 100 : 10 }
}

resource caeStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: cae
  name: 'domora-files'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: fileShare.name
      accessMode: 'ReadWrite'
    }
  }
}

// ── PostgreSQL Flexible Server ───────────────────────────────────────────
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: pgServerName
  location: location
  sku: {
    name: isProd ? 'Standard_D2ds_v5' : 'Standard_B1ms'
    tier: isProd ? 'GeneralPurpose' : 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: pgUser
    administratorLoginPassword: postgresPassword
    storage: { storageSizeGB: isProd ? 128 : 32 }
    backup: {
      backupRetentionDays: isProd ? 35 : 7
      geoRedundantBackup: isProd ? 'Enabled' : 'Disabled'
    }
    highAvailability: { mode: isProd ? 'ZoneRedundant' : 'Disabled' }
  }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: pg
  name: pgDatabase
}

// Simplificación deliberada: acceso desde servicios de Azure. Para prod
// endurecido, sustituir por VNet integration + private endpoint.
resource pgFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: pg
  name: 'allow-azure-services'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ── ACR (referencia; credenciales admin para el pull sencillo) ──────────
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: acrName
  scope: resourceGroup(acrResourceGroup)
}

var databaseUrl = 'postgresql://${pgUser}:${postgresPassword}@${pg.properties.fullyQualifiedDomainName}:5432/${pgDatabase}?schema=public&sslmode=require'

// ── Container App: API ───────────────────────────────────────────────────
resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'domora-api-${env}'
  location: location
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: false // solo accesible desde el environment (nginx del web)
        targetPort: 3000
        transport: 'http'
      }
      registries: [
        {
          server: '${acrName}.azurecr.io'
          username: acr.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        { name: 'acr-password', value: acr.listCredentials().passwords[0].value }
        { name: 'database-url', value: databaseUrl }
        { name: 'jwt-secret', value: jwtSecret }
        { name: 'sepa-enc-key', value: sepaEncKey }
        { name: 'stripe-secret-key', value: stripeSecretKey }
        { name: 'stripe-webhook-secret', value: stripeWebhookSecret }
        { name: 'smtp-user', value: smtpUser }
        { name: 'smtp-password', value: smtpPassword }
        { name: 'vapid-private-key', value: vapidPrivateKey }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: imageTag == 'bootstrap' ? bootstrapImage : '${acrName}.azurecr.io/domora-api:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
            { name: 'SEPA_ENC_KEY', secretRef: 'sepa-enc-key' }
            { name: 'JWT_ACCESS_EXPIRES', value: '15m' }
            { name: 'STORAGE_DIR', value: '/mnt/files' }
            { name: 'NODE_ENV', value: 'production' }
            // Defensivo: el flujo normal navegador→nginx→API no cruza origen
            // (nginx sirve SPA + proxy /api/v1 en el mismo host), pero se
            // configura por si se accede a la API directamente (diagnóstico,
            // clientes futuros no-web).
            { name: 'CORS_ORIGIN', value: 'https://domora-web-${env}.${cae.properties.defaultDomain}' }
            { name: 'INVOICE_ISSUER_NAME', value: invoiceIssuerName }
            { name: 'INVOICE_ISSUER_TAX_ID', value: invoiceIssuerTaxId }
            { name: 'INVOICE_ISSUER_ADDRESS', value: invoiceIssuerAddress }
            { name: 'STRIPE_SECRET_KEY', secretRef: 'stripe-secret-key' }
            { name: 'STRIPE_WEBHOOK_SECRET', secretRef: 'stripe-webhook-secret' }
            { name: 'STRIPE_PRICE_BASE', value: stripePriceBase }
            { name: 'STRIPE_PRICE_STANDARD', value: stripePriceStandard }
            { name: 'STRIPE_PRICE_PREMIUM', value: stripePricePremium }
            { name: 'SMTP_HOST', value: smtpHost }
            { name: 'SMTP_PORT', value: smtpPort }
            { name: 'SMTP_SECURE', value: smtpSecure }
            { name: 'SMTP_USER', secretRef: 'smtp-user' }
            { name: 'SMTP_PASS', secretRef: 'smtp-password' }
            { name: 'SMTP_FROM', value: smtpFrom }
            { name: 'VAPID_PUBLIC_KEY', value: vapidPublicKey }
            { name: 'VAPID_PRIVATE_KEY', secretRef: 'vapid-private-key' }
            { name: 'VAPID_SUBJECT', value: vapidSubject }
          ]
          volumeMounts: [{ volumeName: 'files', mountPath: '/mnt/files' }]
          probes: [
            {
              type: 'Readiness'
              httpGet: { path: '/api/v1/health', port: 3000 }
              initialDelaySeconds: 10
              periodSeconds: 15
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'files'
          storageType: 'AzureFile'
          storageName: caeStorage.name
        }
      ]
      scale: {
        // Ingress interno (external: false) no escala confiable desde 0 con tráfico interno; min 1 en ambos envs.
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// ── Container App: Web (nginx SPA + proxy) ───────────────────────────────
resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'domora-web-${env}'
  location: location
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
      }
      registries: [
        {
          server: '${acrName}.azurecr.io'
          username: acr.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        { name: 'acr-password', value: acr.listCredentials().passwords[0].value }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: imageTag == 'bootstrap' ? bootstrapImage : '${acrName}.azurecr.io/domora-web:${imageTag}'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            // FQDN interno del environment — el proxy /api/v1 del nginx
            { name: 'API_UPSTREAM', value: 'http://domora-api-${env}' }
          ]
        }
      ]
      scale: {
        minReplicas: isProd ? 1 : 0
        maxReplicas: 3
      }
    }
  }
}

// ── Alertas de 5xx y latencia (solo si se pasó alertEmail) ──────────────
var createAlerts = !empty(alertEmail)

resource alertActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (createAlerts) {
  name: 'ag-domora-${env}'
  location: 'global'
  properties: {
    groupShortName: 'domora${env}'
    enabled: true
    emailReceivers: [
      { name: 'ops', emailAddress: alertEmail, useCommonAlertSchema: true }
    ]
  }
}

resource apiApp5xxAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (createAlerts) {
  name: 'alert-api-5xx-${env}'
  location: 'global'
  properties: {
    description: 'La API de Domora (${env}) está devolviendo errores 5xx.'
    severity: 1
    enabled: true
    scopes: [apiApp.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Metric1'
          metricName: 'Requests'
          metricNamespace: 'Microsoft.App/containerapps'
          operator: 'GreaterThan'
          threshold: alert5xxThreshold
          timeAggregation: 'Count'
          criterionType: 'StaticThresholdCriterion'
          dimensions: [
            { name: 'statusCodeCategory', operator: 'Include', values: ['5xx'] }
          ]
        }
      ]
    }
    actions: [ { actionGroupId: alertActionGroup.id } ]
  }
}

resource apiAppLatencyAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (createAlerts) {
  name: 'alert-api-latency-${env}'
  location: 'global'
  properties: {
    description: 'El tiempo de respuesta medio de la API de Domora (${env}) supera el umbral configurado.'
    severity: 2
    enabled: true
    scopes: [apiApp.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Metric1'
          metricName: 'ResponseTime'
          metricNamespace: 'Microsoft.App/containerapps'
          operator: 'GreaterThan'
          threshold: alertLatencyThresholdMs
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [ { actionGroupId: alertActionGroup.id } ]
  }
}

resource webApp5xxAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (createAlerts) {
  name: 'alert-web-5xx-${env}'
  location: 'global'
  properties: {
    description: 'El frontend de Domora (${env}) está devolviendo errores 5xx (nginx, o la API caída detrás).'
    severity: 1
    enabled: true
    scopes: [webApp.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Metric1'
          metricName: 'Requests'
          metricNamespace: 'Microsoft.App/containerapps'
          operator: 'GreaterThan'
          threshold: alert5xxThreshold
          timeAggregation: 'Count'
          criterionType: 'StaticThresholdCriterion'
          dimensions: [
            { name: 'statusCodeCategory', operator: 'Include', values: ['5xx'] }
          ]
        }
      ]
    }
    actions: [ { actionGroupId: alertActionGroup.id } ]
  }
}

resource webAppLatencyAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (createAlerts) {
  name: 'alert-web-latency-${env}'
  location: 'global'
  properties: {
    description: 'El tiempo de respuesta medio del frontend de Domora (${env}) supera el umbral configurado.'
    severity: 2
    enabled: true
    scopes: [webApp.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Metric1'
          metricName: 'ResponseTime'
          metricNamespace: 'Microsoft.App/containerapps'
          operator: 'GreaterThan'
          threshold: alertLatencyThresholdMs
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [ { actionGroupId: alertActionGroup.id } ]
  }
}

output webUrl string = 'https://${webApp.properties.configuration.ingress.fqdn}'
output apiInternalFqdn string = apiApp.properties.configuration.ingress.fqdn
output postgresFqdn string = pg.properties.fullyQualifiedDomainName
