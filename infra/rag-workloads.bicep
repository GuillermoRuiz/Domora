// Stage 2, after vault secrets, DB migrations/principals and private DNS connectivity.
param location string = resourceGroup().location
param environmentName string
param workloadNames array
param identityIds array
param identityClientIds array
param identityPrincipalIds array
param vaultUrls array
param postgresHost string
param postgresUsers array
param storageAccountUrl string
param images array
param registryServer string
param acrName string
param acrResourceGroup string
param acrSubscriptionId string = subscription().subscriptionId
param chatModel string
param rerankModel string
param embeddingModel string = 'text-embedding-3-large'
@allowed(['openai','azure_openai'])
param llmProvider string = 'openai'
param azureOpenAIEndpoint string = ''
param azureOpenAIApiVersion string = ''
param scannerHost string = ''
param scannerPort string = '3310'
param scannerCAPath string = '/etc/ssl/certs/ca-certificates.crt'
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = { name: environmentName }
module registryGrants 'rag-acr-pull.bicep' = {
  name: 'rag-pull-permissions'
  scope: resourceGroup(acrSubscriptionId,acrResourceGroup)
  params: { acrName: acrName, identityPrincipalIds: identityPrincipalIds }
}
resource apps 'Microsoft.App/containerApps@2024-03-01' = [for (workload,index) in ['query','ingestion']: {
  name: workloadNames[index]
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identityIds[index]}': {} } }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      // External to CA environment, but environment itself uses ONLY an internal load balancer.
      ingress: { external: true, targetPort: 8000, transport: 'http', allowInsecure: false }
      registries: [{ server: registryServer, identity: identityIds[index] }]
    }
    template: {
      containers: [{
        name: 'rag-${workload}'
        image: images[index]
        resources: { cpu: 1, memory: '2Gi' }
        env: concat([
          { name: 'DOMORA_ENVIRONMENT', value: 'production' }
          { name: 'DOMORA_RAG_WORKLOAD', value: workload }
          { name: 'AZURE_CLIENT_ID', value: identityClientIds[index] }
          { name: 'DOMORA_KEY_VAULT_URL', value: vaultUrls[index] }
          { name: 'DOMORA_RAG_INTERNAL_KEY_SECRET_NAME', value: 'rag-signing-key' }
          { name: 'OPENAI_API_KEY_SECRET_NAME', value: 'openai-api-key' }
          { name: 'DOMORA_PG_HOST', value: postgresHost }
          { name: 'DOMORA_PG_DATABASE', value: 'domora_rag' }
          { name: 'DOMORA_${toUpper(workload)}_PG_USER', value: postgresUsers[index] }
          { name: 'DOMORA_CHAT_MODEL', value: chatModel }
          { name: 'DOMORA_RERANK_MODEL', value: rerankModel }
          { name: 'DOMORA_EMBED_MODEL', value: embeddingModel }
          { name: 'DOMORA_EMBED_DIMENSIONS', value: '512' }
          { name: 'DOMORA_LLM_PROVIDER', value: llmProvider }
          { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAIEndpoint }
          { name: 'AZURE_OPENAI_API_VERSION', value: azureOpenAIApiVersion }
        ],workload == 'ingestion' ? [
          { name: 'DOMORA_BLOB_ACCOUNT_URL', value: storageAccountUrl }
          { name: 'DOMORA_CLAMAV_HOST', value: scannerHost }
          { name: 'DOMORA_CLAMAV_PORT', value: scannerPort }
          { name: 'DOMORA_CLAMAV_CA_FILE', value: scannerCAPath }
        ] : [])
        probes: [{ type: 'Liveness', httpGet: { path: '/health', port: 8000 }, initialDelaySeconds: 10, periodSeconds: 30 }]
      }]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
  dependsOn: [registryGrants]
}]
output endpoints array = [for index in range(0,2): 'https://${apps[index].properties.configuration.ingress.fqdn}']
