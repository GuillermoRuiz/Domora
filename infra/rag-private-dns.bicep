param domain string
param privateIp string
param networkId string
param linkName string
resource zone 'Microsoft.Network/privateDnsZones@2020-06-01' = { name: domain, location: 'global' }
resource link 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: zone
  name: linkName
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: networkId } }
}
resource records 'Microsoft.Network/privateDnsZones/A@2020-06-01' = [for name in ['@','*']: {
  parent: zone
  name: name
  properties: { ttl: 60, aRecords: [{ ipv4Address: privateIp }] }
}]
