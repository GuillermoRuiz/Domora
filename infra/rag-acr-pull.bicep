param acrName string
param identityPrincipalIds array
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: acrName }
resource grants 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principalId in identityPrincipalIds: {
  name: guid(registry.id,principalId,'rag-pull')
  scope: registry
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}]
