# Complete Actor Metadata Structure

Production-ready actor metadata stored in CosmosDB with versioning, audit trails, and comprehensive discovery capabilities.

## Core Requirements (User-Specified)

1. **Name**: Human-readable actor name
2. **Description**: Detailed description of what the actor does
3. **Type**: Implementation type (javascript, wasm, native, remote, container)
4. **Reference**: Dynamic loading reference (file path, URL, package, container image)
5. **Version**: Semantic version (semver)
6. **Author/Owner**: Creator and team responsible
7. **Policies/Permissions**: Security, access control, rate limiting, data governance
8. **AI Context**: Purpose, usage guidelines, capabilities, tools
9. **Input Schema**: JSON Schema for input validation
10. **Output Schema**: JSON Schema for output validation

## Additional Production-Critical Fields

### Identity & Contact
- **contact**: Email for issues
- **repository**: Source code URL
- **license**: SPDX identifier (MIT, Apache-2.0, etc.)

### Lifecycle Management
- **stage**: experimental, beta, stable, deprecated, retired
- **deprecationReason**: Why it's deprecated
- **migrationGuide**: URL to migration docs
- **supportEndsAt**: End of support date
- **backwardCompatible**: Boolean for API compatibility
- **productionReady**: Boolean for production use

### Quality Metrics
- **testCoverage**: Percentage (0-100)
- **codeComplexity**: Cyclomatic complexity score
- **maintainabilityIndex**: Maintainability score (0-100)
- **technicalDebt**: Estimated time (e.g., "2h", "1d")
- **auditStatus**: passed, failed, pending

### Security
- **vulnerabilities**: Counts by severity (critical, high, medium, low)
- **lastScan**: Security scan timestamp
- **scanTool**: Tool used (snyk, dependabot, etc.)
- **compliant**: Compliance status
- **certifications**: Compliance certifications (SOC2, HIPAA, etc.)

### Business Context
- **costCenter**: Accounting code
- **budgetCode**: Budget allocation
- **businessOwner**: Business stakeholder
- **businessUnit**: Department or division
- **serviceLevel**: critical, high, medium, low
- **impactArea**: Business areas affected

### Usage Constraints
- **maxConcurrentUsers**: Concurrency limit
- **maxDataSize**: Data size limit
- **geographicRestrictions**: Region constraints
- **regulatoryRequirements**: Compliance needs (GDPR, CCPA, etc.)
- **approvalRequired**: Human approval needed

### Integration Metadata
- **upstream**: Actors that call this one
- **downstream**: Actors this one calls
- **eventEmits**: Events published
- **eventConsumes**: Events subscribed to
- **apiEndpoints**: External APIs used

### Testing
- **unitTestsPass**: Boolean
- **integrationTestsPass**: Boolean
- **e2eTestsPass**: Boolean
- **lastTestRun**: Test execution timestamp
- **testFramework**: Testing tool (vitest, jest, etc.)
- **mockDependencies**: Mocked services for testing

### CosmosDB-Specific Fields

Stored in `ActorDocument` wrapper:

- **actorType**: Partition key for efficient queries
- **revision**: Auto-incremented for same version
- **previousVersion/previousRevision**: Version history chain
- **registeredBy/registeredAt**: Audit trail
- **updatedBy/updatedAt**: Change tracking
- **status**: draft, published, deprecated, retired
- **publishedAt/deprecatedAt/retiredAt**: Lifecycle timestamps

### Usage Analytics (Real-time)

Tracked per actor version:

- **usageStats.totalInvocations**: Total calls
- **usageStats.lastInvokedAt**: Last execution time
- **usageStats.avgLatencyMs**: Average response time
- **usageStats.successRate**: Success percentage (0-1)
- **usageStats.activeInstances**: Current running instances

### Deployment Tracking

Per environment:

- **deployments[].environment**: prod, staging, dev, etc.
- **deployments[].deployedAt**: Deployment timestamp
- **deployments[].deployedBy**: Who deployed
- **deployments[].instanceCount**: Number of instances
- **deployments[].status**: active, inactive

### Cost Metrics

Per billing period:

- **costMetrics[].period**: e.g., "2024-12"
- **costMetrics[].totalCost**: Total spend
- **costMetrics[].currency**: USD, EUR, etc.
- **costMetrics[].invocations**: Call count
- **costMetrics[].avgCostPerInvocation**: Unit cost

### Compatibility Matrix

Actor relationships:

- **compatibleWith[].actorType**: Compatible actor
- **compatibleWith[].versionRange**: Semver range (e.g., "^1.0.0")

### Test Results History

Per test run:

- **testResults[].passed**: Boolean
- **testResults[].testSuite**: Test suite name
- **testResults[].testedAt**: Test timestamp
- **testResults[].coverage**: Coverage percentage
- **testResults[].failures**: Failed test names

## Storage Schema

```typescript
// CosmosDB Document Structure
{
  "id": "pdf-extractor:2.1.0:3",  // {actorType}:{version}:{revision}
  "actorType": "pdf-extractor",    // Partition key
  
  // Full metadata
  "metadata": { /* ActorMetadata */ },
  
  // Versioning
  "version": "2.1.0",
  "revision": 3,
  "previousVersion": "2.0.0",
  "previousRevision": 5,
  
  // Audit
  "registeredBy": "jane.smith@example.com",
  "registeredAt": "2024-12-22T10:00:00Z",
  "updatedBy": "admin@example.com",
  "updatedAt": "2024-12-22T15:30:00Z",
  
  // Status
  "status": "published",
  "publishedAt": "2024-12-22T12:00:00Z",
  
  // Real-time stats
  "usageStats": {
    "totalInvocations": 15420,
    "lastInvokedAt": "2024-12-22T16:45:00Z",
    "avgLatencyMs": 2350,
    "successRate": 0.978,
    "activeInstances": 5
  },
  
  // Test results
  "testResults": [
    {
      "passed": true,
      "testSuite": "unit",
      "testedAt": "2024-12-22T09:00:00Z",
      "coverage": 85,
      "failures": []
    }
  ],
  
  // Deployments
  "deployments": [
    {
      "environment": "production",
      "deployedAt": "2024-12-22T12:00:00Z",
      "deployedBy": "cd-pipeline",
      "instanceCount": 5,
      "status": "active"
    }
  ],
  
  // Cost tracking
  "costMetrics": [
    {
      "period": "2024-12",
      "totalCost": 1250.50,
      "currency": "USD",
      "invocations": 15420,
      "avgCostPerInvocation": 0.081
    }
  ]
}
```

## Query Patterns

### Discovery by Capability
```sql
SELECT * FROM c 
WHERE ARRAY_CONTAINS(c.metadata.aiContext.capabilities, 
  {"name": "extractText"}, true)
```

### Find Production-Ready Actors
```sql
SELECT * FROM c 
WHERE c.status = 'published' 
  AND c.metadata.lifecycle.productionReady = true
  AND c.usageStats.successRate > 0.95
ORDER BY c.usageStats.totalInvocations DESC
```

### Security Compliance Check
```sql
SELECT * FROM c 
WHERE c.security.vulnerabilities.critical > 0 
   OR c.security.vulnerabilities.high > 0
   OR c.security.compliant = false
```

### Cost Analysis
```sql
SELECT c.actorType, 
       SUM(cm.totalCost) as totalCost,
       SUM(cm.invocations) as totalInvocations
FROM c 
JOIN cm IN c.costMetrics
WHERE cm.period >= '2024-01'
GROUP BY c.actorType
ORDER BY totalCost DESC
```

### Version Deprecation Report
```sql
SELECT * FROM c 
WHERE c.status = 'published'
  AND c.metadata.lifecycle.supportEndsAt < '2025-01-01'
```

## What This Enables

1. **AI Orchestration**: Rich context for LLM-based workflow assembly
2. **Governance**: Audit trails, compliance tracking, security scanning
3. **Cost Management**: Per-actor cost tracking and budgeting
4. **Quality Gates**: Test coverage, security scans, audit status
5. **Discovery**: Find actors by capability, tags, performance
6. **Analytics**: Usage patterns, performance trends, cost optimization
7. **Lifecycle**: Version management, deprecation workflows, rollback
8. **Collaboration**: Owner contact, documentation links, examples
9. **Compliance**: Data classification, PII handling, certifications
10. **Operations**: Health checks, deployment tracking, scaling config

## Indexing Strategy

CosmosDB composite indexes:
```json
[
  ["/actorType", "/version"],           // Version queries
  ["/status", "/registeredAt"],         // Status timeline
  ["/metadata/tags", "/usageStats/totalInvocations"], // Popular by tag
  ["/metadata/category", "/metadata/lifecycle/stage"], // Category maturity
  ["/security/compliant", "/status"]    // Compliant published
]
```

## Missing Features You Might Want

1. **Change Approvals**: Workflow for metadata changes
2. **Schema Evolution**: Track input/output schema changes
3. **A/B Testing**: Support for canary deployments
4. **Feature Flags**: Per-actor feature toggles
5. **Monitoring Integration**: Links to dashboards, logs, traces
6. **Incident History**: Track production incidents
7. **Customer Feedback**: User ratings, issues, feature requests
8. **Training Materials**: Onboarding docs, videos, tutorials
9. **Marketplace Metadata**: Pricing, tiers, trial info
10. **Dependency Graph**: Visual actor relationships
11. **Performance Benchmarks**: Benchmark results per version
12. **Rollback Policies**: Automatic rollback rules
13. **SLA Definitions**: Response time, availability SLAs
14. **Quota Management**: Usage limits per customer/tenant
15. **Geographic Routing**: Region-specific deployments

Would you like me to implement any of these additional features?
