# Azure Container Apps Deployment Architecture for LoomDB

## Overview

LoomDB is designed to run on **Azure Container Apps** (ACA) with distributed state sync via LoomMesh. This document outlines the deployment architecture, networking, persistence, and service discovery patterns.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│     Azure Container Apps Environment                    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  LoomMesh Relay Service (gundb/gun:latest)          │   │
│  │  - Internal ingress only                        │   │
│  │  - Port 8765                                    │   │
│  │  - Replicas: 2-5 (auto-scale)                  │   │
│  │  - Persistent: Azure Files mount                │   │
│  └───────────────┬─────────────────────────────────┘   │
│                  │                                       │
│  ┌───────────────▼─────────────────────────────────┐   │
│  │  Loom Node Containers (loom:latest)             │   │
│  │  - Embedded LoomMesh client + server                 │   │
│  │  - Connect to relay via DNS                     │   │
│  │  - Replicas: 3-20 (auto-scale)                  │   │
│  │  - Persistent: Azure Files mount                │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  Service Discovery: DNS-based                           │
│  - gun-relay.internal.{env}.azurecontainerapps.io      │
│  - loom-node.internal.{env}.azurecontainerapps.io      │
└─────────────────────────────────────────────────────────┘
         │                            │
         ▼                            ▼
┌──────────────────┐        ┌──────────────────┐
│  Azure Files     │        │  Azure Monitor   │
│  (Persistence)   │        │  (Observability) │
└──────────────────┘        └──────────────────┘
```

## Container Apps Configuration

### 1. LoomMesh Relay Service

**Purpose:** Central relay for LoomMesh peer synchronization

```yaml
# Bicep excerpt (actual implementation in infrastructure/azure/)
resource gunRelay 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'gun-relay'
  properties: {
    environmentId: containerAppsEnvironment.id
    configuration: {
      ingress: {
        external: false              // Internal only
        targetPort: 8765
        transport: 'http'
        allowInsecure: true          // LoomMesh uses WebSocket
      }
      dapr: {
        enabled: false
      }
    }
    template: {
      containers: [
        {
          name: 'gun-relay'
          image: 'gundb/gun:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'GUN_PORT'
              value: '8765'
            }
          ]
          volumeMounts: [
            {
              volumeName: 'gun-data'
              mountPath: '/opt/data'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 2
        maxReplicas: 5
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
      volumes: [
        {
          name: 'gun-data'
          storageType: 'AzureFile'
          storageName: 'gun-storage'
        }
      ]
    }
  }
}
```

### 2. Loom Node Service

**Purpose:** Application containers running Loom actors with embedded LoomMesh

```yaml
resource loomNode 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'loom-node'
  properties: {
    environmentId: containerAppsEnvironment.id
    configuration: {
      ingress: {
        external: true               // External for API/webhooks
        targetPort: 3000
        transport: 'auto'
      }
      secrets: [
        {
          name: 'openai-api-key'
          value: openAiApiKey         // From Key Vault
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'loom-node'
          image: 'loom:latest'
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            // LoomMesh Configuration
            {
              name: 'GUN_ENABLED'
              value: 'true'
            }
            {
              name: 'GUN_SERVER_PORT'
              value: '8765'              // Also act as server
            }
            {
              name: 'GUN_PEERS'
              value: 'http://gun-relay.internal.${containerAppsEnvironment.defaultDomain}:8765'
            }
            {
              name: 'GUN_DATA_PATH'
              value: '/mnt/gun-data'
            }
            {
              name: 'GUN_ALLOW_OFFLINE'
              value: 'true'
            }
            // Azure-specific
            {
              name: 'CONTAINER_APP_NAME'
              value: containerAppName
            }
            {
              name: 'CONTAINER_APP_REPLICA_NAME'
              value: replicaName         // Unique per replica
            }
            // Other Loom config...
          ]
          volumeMounts: [
            {
              volumeName: 'gun-data'
              mountPath: '/mnt/gun-data'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 3
        maxReplicas: 20
        rules: [
          {
            name: 'cpu-scaling'
            custom: {
              type: 'cpu'
              metadata: {
                type: 'Utilization'
                value: '70'
              }
            }
          }
        ]
      }
      volumes: [
        {
          name: 'gun-data'
          storageType: 'AzureFile'
          storageName: 'gun-storage'
        }
      ]
    }
  }
}
```

## Service Discovery

### DNS-Based Discovery

Azure Container Apps provides automatic DNS within the environment:

```typescript
// src/services/gun/azure-discovery.ts
export class AzureServiceDiscovery {
  /**
   * Get LoomMesh peer URLs from Azure environment
   */
  static getPeers(): string[] {
    const peers: string[] = []
    
    // 1. Relay service (always included)
    const relayHost = process.env.GUN_RELAY_HOST || 
                     'gun-relay.internal.{env}.azurecontainerapps.io'
    peers.push(`http://${relayHost}:8765`)
    
    // 2. Other Loom nodes (P2P optimization)
    const loomNodeHost = process.env.LOOM_NODE_HOST ||
                        'loom-node.internal.{env}.azurecontainerapps.io'
    
    // Don't connect to self
    const currentReplica = process.env.CONTAINER_APP_REPLICA_NAME
    if (currentReplica) {
      // In multi-replica, connect to service DNS (load balancer)
      peers.push(`http://${loomNodeHost}:8765`)
    }
    
    return peers
  }
}
```

### Environment Variables

Container Apps automatically provides:
- `CONTAINER_APP_NAME`: Application name
- `CONTAINER_APP_REPLICA_NAME`: Unique replica identifier
- `CONTAINER_APP_REVISION`: Current revision
- Custom: `GUN_RELAY_HOST`, `LOOM_NODE_HOST` (via configuration)

## Persistent Storage

### Azure Files Integration

**Setup:**
1. Create Azure Files share: `gun-storage`
2. Mount in Container Apps environment
3. Configure as volume in container

**Benefits:**
- ✅ Shared across replicas
- ✅ Survives container restarts
- ✅ Automatic backup (Azure Files snapshots)
- ✅ NFS/SMB support

**Configuration:**

```typescript
// LoomMesh configuration with Azure Files
const gunConfig: GunServiceConfig = {
  peers: AzureServiceDiscovery.getPeers(),
  dataPath: '/mnt/gun-data',  // Azure Files mount
  radisk: true,                // Enable persistence
  allowOffline: true
}
```

**File Locking:**

Azure Files supports file locking, but LoomMesh's RAD storage is append-only and uses atomic operations, so conflicts are minimal.

## Networking

### Ingress Configuration

| Service | Type | Port | Purpose |
|---------|------|------|---------|
| LoomMesh Relay | Internal | 8765 | WebSocket sync |
| Loom Node | External | 3000 | HTTP API |
| Loom Node | Internal | 8765 | LoomMesh P2P |

### Network Flow

```
Internet
   │
   ▼
External Ingress (:3000)
   │
   ▼
Loom Node Replicas
   │ │ │
   ├─┼─┼──► LoomMesh Relay (:8765) ──► Azure Files
   │ │ │
   └─┴─┴──► Direct P2P (:8765)
```

### Firewall Rules

- External ingress: HTTPS only (3000 → 443 mapping)
- Internal: Allow all within environment
- Egress: OpenAI API, Azure services

## Scaling

### Auto-scaling Rules

**LoomMesh Relay:**
- Min: 2 replicas (HA)
- Max: 5 replicas
- Trigger: HTTP concurrent requests > 100

**Loom Nodes:**
- Min: 3 replicas (distribute load)
- Max: 20 replicas
- Triggers:
  - CPU > 70%
  - Memory > 80%
  - HTTP requests > 1000/sec

### LoomMesh Sync Performance

With auto-scaling:
- Adding replicas: New nodes connect to relay, sync state (~10s)
- Removing replicas: Graceful shutdown, state persisted to Azure Files
- Network partition: Replicas work offline, sync when reconnected

## Monitoring & Observability

### Azure Monitor Integration

```typescript
// src/services/gun/azure-monitoring.ts
export class AzureGunMonitoring {
  private appInsights: ApplicationInsights
  
  async trackMetrics(metrics: GunMetrics): Promise<void> {
    // Send to Azure Monitor
    this.appInsights.trackMetric({
      name: 'gun.peers.connected',
      value: metrics.peers
    })
    
    this.appInsights.trackMetric({
      name: 'gun.nodes.count',
      value: metrics.nodes
    })
    
    this.appInsights.trackMetric({
      name: 'gun.sync.latency_ms',
      value: metrics.syncLatency
    })
  }
}
```

### Log Analytics Queries

```kusto
// LoomMesh peer connection issues
ContainerAppConsoleLogs_CL
| where ContainerName_s == "loom-node"
| where Log_s contains "LoomMesh peer"
| where Log_s contains "error" or Log_s contains "disconnected"
| project TimeGenerated, ReplicaName_s, Log_s

// State sync latency
customMetrics
| where name == "gun.sync.latency_ms"
| summarize avg(value), percentiles(value, 50, 95, 99) by bin(timestamp, 5m)
```

### Dashboards

Azure Portal dashboard with:
- LoomMesh peer connection status
- State sync latency (P50, P95, P99)
- Replica count over time
- Storage usage (Azure Files)
- Network throughput

## Cost Optimization

### Resource Allocation

| Component | vCPU | Memory | Cost ($/month) |
|-----------|------|--------|----------------|
| LoomMesh Relay (2x) | 0.5 | 1 GB | ~$50 |
| Loom Node (3x min) | 1.0 | 2 GB | ~$200 |
| Azure Files (100 GB) | - | - | ~$10 |
| **Total (base)** | - | - | **~$260** |

### Scaling Costs

- Each additional Loom replica: ~$70/month
- Auto-scale only during peak hours: Save 50%
- Dev environment (1 relay + 1 node): ~$100/month

### Storage Optimization

- LoomMesh data: ~1-10 GB typical
- Enable compression: 50% reduction
- Retention policy: 30 days (rotate old data)

## Deployment

### Prerequisites

1. Azure subscription
2. Resource group
3. Container Apps environment
4. Azure Files storage account
5. Container registry (ACR)

### Deployment Steps

```bash
# 1. Build and push container
docker build -t loom:latest .
docker push {acr}.azurecr.io/loom:latest

# 2. Deploy infrastructure
az deployment group create \
  --resource-group loom-prod \
  --template-file infrastructure/azure/main.bicep \
  --parameters @parameters.json

# 3. Verify deployment
az containerapp show \
  --name loom-node \
  --resource-group loom-prod \
  --query "properties.runningStatus"
```

### CI/CD Pipeline

```yaml
# Azure Pipelines excerpt
- task: AzureCLI@2
  inputs:
    scriptType: 'bash'
    scriptLocation: 'inlineScript'
    inlineScript: |
      # Deploy with zero downtime
      az containerapp update \
        --name loom-node \
        --resource-group loom-prod \
        --image $(containerRegistry)/loom:$(Build.BuildId) \
        --revision-suffix $(Build.BuildId)
```

## High Availability

### Multi-Region Setup

For global deployment:

```
Region 1 (Primary)          Region 2 (Secondary)
┌──────────────────┐        ┌──────────────────┐
│ ACA Environment  │◄──────►│ ACA Environment  │
│ - LoomMesh Relay (2x) │ Sync   │ - LoomMesh Relay (2x) │
│ - Loom Nodes     │        │ - Loom Nodes     │
└──────────────────┘        └──────────────────┘
         │                           │
         ▼                           ▼
   Azure Files                 Azure Files
   (Primary)                   (Secondary)
         │                           │
         └───────────┬───────────────┘
                     ▼
           Azure Files Sync
```

### Disaster Recovery

- **RTO:** <5 minutes (auto-failover)
- **RPO:** <1 minute (continuous sync)
- **Backup:** Azure Files snapshots (hourly)

## Security

### Network Security

- Private endpoints for Azure Files
- VNET integration for Container Apps
- NSG rules for LoomMesh relay (internal only)

### Data Security

- Encryption at rest (Azure Files)
- Encryption in transit (TLS for external)
- LoomMesh SEA for sensitive data (optional)

### Access Control

- Managed identities for Azure resources
- RBAC for Container Apps management
- Key Vault for secrets

## Troubleshooting

### Common Issues

**Issue: LoomMesh peers not connecting**
```bash
# Check DNS resolution
az containerapp exec \
  --name loom-node \
  --command "nslookup gun-relay.internal"

# Check network connectivity
az containerapp exec \
  --name loom-node \
  --command "curl http://gun-relay:8765"
```

**Issue: Azure Files mount fails**
```bash
# Verify storage account
az storage account show --name {storage} --resource-group {rg}

# Check file share
az storage share show --name gun-storage --account-name {storage}
```

**Issue: High sync latency**
- Check peer count: Should be 2-5
- Check Azure Files throttling: Monitor IOPS
- Increase replica count: Scale out

## Next Steps

1. Deploy to dev environment
2. Run load tests (TODO-043)
3. Optimize costs based on usage
4. Set up monitoring dashboards
5. Document runbook for operations team

## References

- [Azure Container Apps Documentation](https://learn.microsoft.com/en-us/azure/container-apps/)
- [Azure Files in Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts)
- [LoomMesh Documentation](https://gun.eco/docs/)
- [LoomDB Architecture](./LOOMWEAVE.md)
