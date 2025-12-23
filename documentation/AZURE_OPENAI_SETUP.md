# Azure OpenAI Configuration Guide

## Quick Setup

1. **Copy the example environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your Azure OpenAI credentials:**
   ```bash
   # Get these from Azure Portal
   AZURE_OPENAI_API_KEY=your-api-key-here
   AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
   AZURE_OPENAI_DEPLOYMENT=your-deployment-name
   AZURE_OPENAI_MODEL=gpt-4o
   ```

3. **Run the AI-powered group chat example:**
   ```bash
   npx tsx examples/ai-group-chat-example.ts
   ```

## Finding Your Azure OpenAI Credentials

### 1. API Key
- Go to [Azure Portal](https://portal.azure.com)
- Navigate to your Azure OpenAI resource
- Click "Keys and Endpoint" in the left menu
- Copy either KEY 1 or KEY 2

### 2. Endpoint
- Same location as API Key
- Copy the "Endpoint" URL (e.g., `https://your-resource.openai.azure.com`)
- **Important:** Use only the base URL, not the full path with `/chat/completions`

### 3. Deployment Name
- In Azure Portal, go to your Azure OpenAI resource
- Click "Model deployments" 
- Note the deployment name (e.g., `gpt-4o-deployment`)

### 4. Model
- This is the underlying model (e.g., `gpt-4o`, `gpt-4`, `gpt-35-turbo`)
- Check your deployment details to see which model it uses

## Example Configuration

Example `.env` configuration:

```env
AZURE_OPENAI_API_KEY=your-api-key-here
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
AZURE_OPENAI_MODEL=gpt-4o
AZURE_OPENAI_API_VERSION=2024-04-01-preview
```

## Testing Your Configuration

Run the test example:
```bash
npx tsx examples/ai-group-chat-example.ts
```

You should see:
```
✅ Azure OpenAI coordinator enabled
   Endpoint: https://your-resource.openai.azure.com
   Deployment: your-deployment-name
   Model: gpt-4o
```

## Features Enabled with Azure OpenAI

When Azure OpenAI is configured, you get:

✅ **Smart Coordination** - AI selects the most appropriate team member to speak next  
✅ **Natural Termination** - AI detects when the conversation goal is achieved  
✅ **Automatic Context** - Full conversation history passed to AI automatically  
✅ **Intelligent Routing** - Best speaker selected based on expertise and context  

## Without Azure OpenAI

If Azure OpenAI is not configured, the system gracefully falls back to:
- Round-robin speaker selection
- Keyword-based termination detection
- All other features still work!

## Security Notes

- ⚠️ **Never commit `.env` file to git** - It's already in `.gitignore`
- ✅ Use `.env.example` as a template
- ✅ Keep API keys secure
- ✅ Rotate keys regularly

## API Costs

Azure OpenAI API calls have costs:
- Each speaker selection = 1 API call (~150 tokens)
- Each termination check = 1 API call (~100 tokens)
- Costs are typically $0.03-0.06 per 1K tokens for GPT-4o

Estimate: ~$0.01-0.02 per conversation round

## Troubleshooting

### 404 Resource Not Found
- ✅ Check that endpoint is just the base URL (no `/chat/completions` path)
- ✅ Verify deployment name matches exactly
- ✅ Ensure API version is correct

### 401 Unauthorized
- ✅ Check API key is correct
- ✅ Verify key hasn't expired
- ✅ Check resource is active in Azure Portal

### Model Not Found
- ✅ Verify deployment exists in Azure Portal
- ✅ Check model name matches deployment
- ✅ Ensure deployment is active

## More Information

- [Azure OpenAI Service Documentation](https://learn.microsoft.com/en-us/azure/ai-services/openai/)
- [OpenAI Node.js Library](https://github.com/openai/openai-node)
- [Loom Documentation](./docs/)
