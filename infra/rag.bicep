// New private RAG foundation, NOT deployed by default. No changes to legacy data plane.
param location string = resourceGroup().location
@allowed(['test','prod'])
param env string
@description('Existing network allocation, supplied by operator; do not overlap existing VNets.')
param addressPrefix string
@description('CIDRs for ingress/api/app/agents/rag/privateEndpoints/data/firewall; rag >= /23, firewall /26.')
param subnetPrefixes object
param entraAdminObjectId string
param entraAdminName string
param postgresSku string
param postgresStorageGB int
param azureOpenAIAccountName string = ''

var suffix = uniqueString(resourceGroup().id, env, 'rag')
var names = ['snet-ingress','snet-api','snet-app','snet-agents','snet-rag','snet-private-endpoints','snet-data','AzureFirewallSubnet']
var prefixes = [subnetPrefixes.ingress,subnetPrefixes.api,subnetPrefixes.app,subnetPrefixes.agents,subnetPrefixes.rag,subnetPrefixes.privateEndpoints,subnetPrefixes.data,subnetPrefixes.firewall]
resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'VNET-DOMORA-${toUpper(env)}'
  location: location
  properties: {
    addressSpace: { addressPrefixes: [addressPrefix] }
    subnets: [for (name,index) in names: {
      name: name
      properties: union({ addressPrefix: prefixes[index] },
        name == 'snet-data' ? { delegations: [{ name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }] } : {},
        name == 'snet-rag' ? { delegations: [{ name: 'container-apps', properties: { serviceName: 'Microsoft.App/environments' } }] } : {},
        name == 'snet-private-endpoints' ? { privateEndpointNetworkPolicies: 'Disabled' } : {})
    }]
  }
}
resource identities 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = [for workload in ['query','ingestion']: {
  name: 'id-domora-rag-${workload}-${env}'
  location: location
}]
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'rag${suffix}'
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', bypass: 'None' }
  }
}
resource blob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: { isVersioningEnabled: true }
}
resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for container in ['raw','processed','quarantine']: {
  parent: blob
  name: container
  properties: { publicAccess: 'None' }
}]
resource blobGrants 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (container,index) in ['raw','processed','quarantine']: {
  name: guid(containers[index].id,identities[1].id,'blob-contributor')
  scope: containers[index]
  properties: {
    principalId: identities[1].properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}]
// Separate vaults prevent query identity from obtaining ingestion signing/provider credentials.
resource vaults 'Microsoft.KeyVault/vaults@2023-07-01' = [for workload in ['query','ingestion']: {
  name: 'kv-rag-${workload}-${suffix}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', bypass: 'None' }
    accessPolicies: []
  }
}]
resource vaultGrants 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (workload,index) in ['query','ingestion']: {
  name: guid(vaults[index].id,identities[index].id,'secret-reader')
  scope: vaults[index]
  properties: {
    principalId: identities[index].properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','4633458b-17de-408a-b874-0445c86b69e6')
  }
}]
resource zones 'Microsoft.Network/privateDnsZones@2020-06-01' = [for zone in ['privatelink.blob.core.windows.net','privatelink.vaultcore.azure.net','rag.postgres.database.azure.com']: {
  name: zone
  location: 'global'
}]
resource links 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [for (zone,index) in ['blob','vault','postgres']: {
  parent: zones[index]
  name: 'rag-${env}'
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: network.id } }
}]
var privateServices = [storage.id,vaults[0].id,vaults[1].id]
resource endpoints 'Microsoft.Network/privateEndpoints@2024-05-01' = [for (service,index) in privateServices: {
  name: 'pe-domora-rag-${index}-${env}'
  location: location
  properties: {
    subnet: { id: '${network.id}/subnets/snet-private-endpoints' }
    privateLinkServiceConnections: [{
      name: 'rag'
      properties: { privateLinkServiceId: service, groupIds: [index==0 ? 'blob' : 'vault'] }
    }]
  }
}]
resource zoneGroups 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = [for (service,index) in privateServices: {
  parent: endpoints[index]
  name: 'default'
  properties: { privateDnsZoneConfigs: [{ name: 'rag', properties: { privateDnsZoneId: zones[index==0 ? 0 : 1].id } }] }
}]
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'pg-rag-${env}-${suffix}'
  location: location
  sku: { name: postgresSku, tier: 'GeneralPurpose' }
  properties: {
    version: '16'
    authConfig: { activeDirectoryAuth: 'Enabled', passwordAuth: 'Disabled', tenantId: subscription().tenantId }
    storage: { storageSizeGB: postgresStorageGB }
    network: { delegatedSubnetResourceId: '${network.id}/subnets/snet-data', privateDnsZoneArmResourceId: zones[2].id, publicNetworkAccess: 'Disabled' }
  }
  dependsOn: [links]
}
resource administrator 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: postgres
  name: entraAdminObjectId
  properties: { principalName: entraAdminName, principalType: 'User', tenantId: subscription().tenantId }
}
resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: { value: 'VECTOR', source: 'user-override' }
}
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'domora_rag'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-domora-rag-${env}'
  location: location
  properties: { sku: { name: 'PerGB2018' } }
}
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-domora-rag-${env}'
  location: location
  properties: {
    vnetConfiguration: { internal: true, infrastructureSubnetId: '${network.id}/subnets/snet-rag' }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: { destination: 'log-analytics', logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey } }
  }
}
// Optional existing Azure OpenAI account; networking/publicAccess is operator-reviewed, never implied.
resource openai 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = if (!empty(azureOpenAIAccountName)) {
  name: azureOpenAIAccountName
}
resource openaiZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (!empty(azureOpenAIAccountName)) {
  name: 'privatelink.openai.azure.com'
  location: 'global'
}
resource openaiLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (!empty(azureOpenAIAccountName)) {
  parent: openaiZone
  name: 'rag-${env}'
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: network.id } }
}
resource openaiEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = if (!empty(azureOpenAIAccountName)) {
  name: 'pe-domora-rag-openai-${env}'
  location: location
  properties: { subnet: { id: '${network.id}/subnets/snet-private-endpoints' }, privateLinkServiceConnections: [{ name: 'openai', properties: { privateLinkServiceId: openai.id, groupIds: ['account'] } }] }
}
resource openaiZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = if (!empty(azureOpenAIAccountName)) {
  parent: openaiEndpoint
  name: 'default'
  properties: { privateDnsZoneConfigs: [{ name: 'openai', properties: { privateDnsZoneId: openaiZone.id } }] }
}
resource openaiGrants 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for index in range(0,2): if (!empty(azureOpenAIAccountName)) {
  name: guid(openai.id,identities[index].id,'openai-user')
  scope: openai
  properties: { principalId: identities[index].properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','5e0bd9bd-7b93-4f28-af87-19fc36ad61bd') }
}]
output environmentId string = environment.id
output environmentName string = environment.name
output networkId string = network.id
output storageAccountUrl string = storage.properties.primaryEndpoints.blob
output vaultUrls array = [for index in range(0,2): vaults[index].properties.vaultUri]
output identityIds array = [for index in range(0,2): identities[index].id]
output identityClientIds array = [for index in range(0,2): identities[index].properties.clientId]
output identityPrincipalIds array = [for index in range(0,2): identities[index].properties.principalId]
output postgresHost string = postgres.properties.fullyQualifiedDomainName

module environmentDns 'rag-private-dns.bicep' = {
  name: 'rag-environment-dns'
  params: { domain: environment.properties.defaultDomain, privateIp: environment.properties.staticIp, networkId: network.id, linkName: 'rag-${env}' }
}
