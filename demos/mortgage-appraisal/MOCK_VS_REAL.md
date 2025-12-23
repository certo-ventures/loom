# 🎭 Mock vs 🚀 Real LLM Guide

## Quick Comparison

| Feature | Mock Mode 🎭 | Real Mode 🚀 |
|---------|-------------|-------------|
| **Cost** | FREE | ~$0.50-2.00 per run |
| **Speed** | 3-4 seconds | 30-60 seconds |
| **API Keys** | Not needed | Required |
| **Responses** | Hardcoded | Dynamic from LLMs |
| **PDF Parsing** | Supports real PDFs | Supports real PDFs |
| **Use Case** | Testing, demos | Production, real analysis |

## Mock Mode (Default) 🎭

### When to Use
- ✅ Testing the workflow logic
- ✅ Demonstrating the architecture
- ✅ Development without costs
- ✅ CI/CD pipelines
- ✅ Learning the system

### How to Enable
```bash
# Environment variable
export USE_MOCK_LLM=true

# Or in .env file
echo "USE_MOCK_LLM=true" > demos/mortgage-appraisal/.env

# Run
npx tsx demos/mortgage-appraisal/run-demo.ts
```

### What Gets Mocked
- ✅ Document extraction (returns hardcoded property data)
- ✅ Criterion reviews (returns predefined evaluations)
- ❌ PDF parsing (REAL - if you provide a PDF file)
- ❌ Consolidation logic (REAL)
- ❌ Workflow orchestration (REAL)

## Real Mode 🚀

### When to Use
- ✅ Production appraisal reviews
- ✅ Real data extraction
- ✅ Actual quality assessment
- ✅ Regulatory compliance
- ✅ Client deliverables

### Setup Instructions

#### Step 1: Get API Keys

**Azure OpenAI** (Recommended for Enterprise):
1. Create Azure OpenAI resource in Azure Portal
2. Deploy models: `gpt-4`, `gpt-4-turbo`, `gpt-35-turbo`
3. Get: API Key, Endpoint, Deployment Names

**Anthropic Claude**:
1. Sign up at https://console.anthropic.com
2. Get API key from console
3. Models available: `claude-3-sonnet`, `claude-3-opus`

#### Step 2: Configure Environment

```bash
# Copy template
cp demos/mortgage-appraisal/.env.template demos/mortgage-appraisal/.env

# Edit .env file
nano demos/mortgage-appraisal/.env
```

Set these values:
```bash
USE_MOCK_LLM=false

# Azure OpenAI
AZURE_OPENAI_API_KEY=abc123...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_GPT4_DEPLOYMENT=gpt-4
AZURE_OPENAI_GPT4_TURBO_DEPLOYMENT=gpt-4-turbo
AZURE_OPENAI_GPT35_DEPLOYMENT=gpt-35-turbo

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

#### Step 3: Run with Real LLMs

```bash
# Load environment
source demos/mortgage-appraisal/.env

# Run
npx tsx demos/mortgage-appraisal/run-demo.ts
```

Or inline:
```bash
USE_MOCK_LLM=false \
AZURE_OPENAI_API_KEY=your-key \
AZURE_OPENAI_ENDPOINT=https://your-endpoint \
npx tsx demos/mortgage-appraisal/run-demo.ts
```

### What Gets Called
- 🚀 **GPT-4**: Document extraction, detailed criterion reviews
- 🚀 **Claude-3**: Alternative perspective on criteria
- 🚀 **GPT-3.5**: Fast, cost-effective third opinion
- 🚀 **PDF Parser**: Real text extraction from PDFs
- ✅ **Consolidation**: Real multi-agent reconciliation

### Cost Estimation

**Per Run** (10 criteria × 3 models):
- Document Extraction: ~1,500 tokens × $0.01/1K = $0.015
- 30 Criterion Reviews: ~1,000 tokens each × $0.01/1K = $0.30
- **Total**: ~$0.50-2.00 depending on models used

**Optimization**:
- Use GPT-3.5 for non-critical criteria: ~70% cost savings
- Cache extracted data: Skip re-extraction
- Batch reviews: Share context across criteria

## Hybrid Mode 🎭🚀

### Mix Mock and Real

You can mix modes by selectively configuring API keys:

```bash
# Only GPT-4 real, others mock
USE_MOCK_LLM=false
AZURE_OPENAI_API_KEY=your-key  # GPT-4 will be real
# ANTHROPIC_API_KEY not set      # Claude will fall back to mock
```

The system automatically falls back to mock for unavailable models.

## Choosing Models

### Available Models

| Model | Provider | Speed | Cost | Best For |
|-------|----------|-------|------|----------|
| **GPT-4** | Azure OpenAI | Medium | $$$ | Critical analysis, detailed reasoning |
| **GPT-4-Turbo** | Azure OpenAI | Fast | $$ | Balanced speed/quality |
| **GPT-3.5** | Azure OpenAI | Very Fast | $ | Quick checks, volume processing |
| **Claude-3-Sonnet** | Anthropic | Medium | $$ | Alternative perspective, nuanced |
| **Claude-3-Opus** | Anthropic | Slow | $$$$ | Highest quality, critical decisions |

### Recommended Configurations

**Budget-Conscious**:
```typescript
llmModels: ['gpt-3.5', 'gpt-3.5', 'gpt-3.5']  // All fast/cheap
```

**Balanced**:
```typescript
llmModels: ['gpt-4', 'claude-3', 'gpt-3.5']  // Default, diverse
```

**Premium Quality**:
```typescript
llmModels: ['gpt-4', 'claude-3-opus', 'gpt-4-turbo']  // Best quality
```

**Speed Optimized**:
```typescript
llmModels: ['gpt-4-turbo', 'gpt-4-turbo']  // Fast + parallel
```

## Troubleshooting

### "Model not available" Error

**Symptom**: Falls back to mock despite `USE_MOCK_LLM=false`

**Solution**:
1. Check API key is set: `echo $AZURE_OPENAI_API_KEY`
2. Verify endpoint is correct
3. Confirm deployment names match Azure
4. Test connectivity: `curl https://your-endpoint/...`

### High Costs

**Solutions**:
- Use mock mode for testing
- Switch to GPT-3.5 for non-critical criteria
- Reduce number of review agents
- Cache extraction results

### Slow Performance

**Solutions**:
- Use GPT-4-Turbo instead of GPT-4
- Reduce `maxTokens` in llm-service.ts
- Use fewer review models (2 instead of 3)
- Parallelize more aggressively

## Best Practices

### Development
- ✅ Use mock mode during development
- ✅ Test with real mode before production
- ✅ Commit .env.template, NOT .env
- ✅ Use environment variables in CI/CD

### Production
- ✅ Use real mode with proper API keys
- ✅ Monitor costs with Azure/Anthropic dashboards
- ✅ Set up rate limiting
- ✅ Cache extraction results
- ✅ Log all API calls for auditing

### Security
- ✅ Never commit API keys
- ✅ Use Azure Key Vault for production keys
- ✅ Rotate keys regularly
- ✅ Use role-based access control
- ✅ Monitor for unusual usage

---

**Ready to go REAL?** Set `USE_MOCK_LLM=false` and let the AI do its magic! 🚀
