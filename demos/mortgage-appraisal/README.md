# Mortgage Appraisal Review Demo

A real-world demonstration of the Loom framework showcasing **multi-agent workflow orchestration** for automated mortgage appraisal review.

## 🎯 Overview

This demo implements a production-ready workflow that:

1. **Extracts** structured data from appraisal PDFs (text or image-based)
2. **Reviews** each checklist criterion using multiple AI agents with different LLMs
3. **Consolidates** diverse agent opinions into final decisions
4. **Generates** comprehensive review reports with recommendations

## 🏗️ Architecture

```
┌─────────────────┐
│  Appraisal PDF  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ DocumentExtractorActor  │  ← Extracts structured data
└───────────┬─────────────┘
            │
            ▼
    ┌───────────────┐
    │  Checklist    │  ← FNMA 1004 criteria
    └───────┬───────┘
            │
            ▼
┌─────────────────────────────────────────────┐
│  Parallel Multi-Agent Review                │
│  ┌────────────────────────────────────────┐ │
│  │  CriteriaReviewerActor (GPT-4)        │ │
│  │  CriteriaReviewerActor (Claude-3)     │ │
│  │  CriteriaReviewerActor (GPT-3.5)      │ │
│  └────────────────────────────────────────┘ │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ ReviewConsolidator    │  ← Reconciles opinions
        └───────────┬───────────┘
                    │
                    ▼
            ┌───────────────┐
            │ Final Report  │
            └───────────────┘
```

## 🚀 Features Demonstrated

### Multi-Agent Coordination
- **Parallel execution** of multiple review agents
- **Different LLM models** for diverse perspectives (GPT-4, Claude-3, GPT-3.5)
- **Consensus building** and conflict resolution

### Document Intelligence
- **PDF extraction** with schema-driven parsing
- **Data validation** with confidence scoring
- **Flexible input** (text PDFs or image-based PDFs)

### Workflow Orchestration
- **Step-by-step** execution with clear logging
- **Error handling** and graceful degradation
- **State management** through Actor pattern

### Decision Logic
- **Automated evaluation**: pass/fail/needs-human-review
- **Importance weighting**: critical, high, medium, low
- **Conflict detection** and escalation
- **Confidence thresholds** for quality control

## 📁 Project Structure

```
demos/mortgage-appraisal/
├── actors/
│   ├── document-extractor.ts       # PDF → structured data
│   ├── criteria-reviewer.ts        # Single criterion review
│   └── review-consolidator.ts      # Multi-agent reconciliation
├── data/
│   └── checklist-templates/
│       └── fnma-1004.json          # Fannie Mae 1004 checklist
├── workflows/
│   └── (reserved for JSON workflow definitions)
├── types.ts                        # TypeScript interfaces
├── main.ts                         # Orchestration logic
├── run-demo.ts                     # Demo runner
└── README.md                       # This file
```

## 🏃 Running the Demo

### Prerequisites

```bash
# Ensure you're in the Loom root directory
cd /path/to/loom

# Install dependencies (if not already done)
npm install
```

### Configuration

The demo supports **TWO MODES**:

#### 🎭 Mock Mode (Default - No API Keys Required)
Perfect for testing the workflow without LLM costs:
```bash
# Set in environment or .env file
export USE_MOCK_LLM=true

# Or copy the template
cp demos/mortgage-appraisal/.env.template demos/mortgage-appraisal/.env
# (USE_MOCK_LLM is already true in template)
```

#### 🚀 Real Mode (Actual LLM APIs)
For production use with real Azure OpenAI and Anthropic:
```bash
# Copy environment template
cp demos/mortgage-appraisal/.env.template demos/mortgage-appraisal/.env

# Edit .env and set:
USE_MOCK_LLM=false
AZURE_OPENAI_API_KEY=your-key-here
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_GPT4_DEPLOYMENT=gpt-4
ANTHROPIC_API_KEY=your-anthropic-key-here

# Load environment
source demos/mortgage-appraisal/.env  # or use dotenv
```

### Execute Demo

```bash
# Run with tsx (TypeScript execution)
npx tsx demos/mortgage-appraisal/run-demo.ts

# Or with real LLMs
USE_MOCK_LLM=false npx tsx demos/mortgage-appraisal/run-demo.ts
```

### Expected Output

```
📋 Loaded checklist: FNMA 1004 Appraisal Review
   10 criteria to review

🏠 ========================================
   MORTGAGE APPRAISAL REVIEW WORKFLOW
========================================

📄 STEP 1: Extracting appraisal data from PDF...

✅ Extraction complete - Property: 123 Main Street, Springfield, IL 62701

🤖 STEP 2: Multi-agent review of checklist criteria...

   Reviewing: Property address and legal description are complete and accurate (critical)
   ✓ 3 reviews completed

   Reviewing: Appraiser is properly licensed and certified (critical)
   ✓ 3 reviews completed

   ... (continues for all criteria)

📊 STEP 3: Consolidating multi-agent reviews...

   Consolidating: Property address and legal description are complete and accurate
   → PASS

   ... (continues for all criteria)

📋 STEP 4: Generating final report...

========================================
   REVIEW COMPLETE
========================================

╔════════════════════════════════════════╗
║     APPRAISAL REVIEW REPORT SUMMARY    ║
╚════════════════════════════════════════╝

📍 Property: 123 Main Street, Springfield, IL 62701
💰 Appraised Value: $425,000
📅 Effective Date: 2024-11-15
👤 Appraiser: John Smith

📊 Overall Status: APPROVED

📋 Review Results:
   ✅ Pass: 10
   ❌ Fail: 0
   ⚠️  Needs Review: 0

✨ Demo completed successfully!
```

## 📊 Checklist Criteria

The demo uses the **FNMA 1004** (Fannie Mae Uniform Residential Appraisal Report) checklist, which includes:

1. **Property Identification** (Critical)
2. **Appraiser Certification** (Critical)
3. **Effective Date** (High)
4. **Comparable Sales** (Critical)
5. **Adjustments** (High)
6. **Property Condition** (High)
7. **Square Footage** (High)
8. **Market Conditions** (Medium)
9. **Highest and Best Use** (Medium)
10. **Reconciliation** (Critical)

## 🔧 Customization

### Adding New Checklists

Create a new JSON file in `data/checklist-templates/`:

```json
{
  "checklistName": "Custom Checklist",
  "version": "1.0",
  "description": "Description",
  "items": [
    {
      "id": "unique-id",
      "category": "Category Name",
      "criterion": "What to check",
      "description": "Detailed description",
      "importance": "critical|high|medium|low",
      "guidelines": "Guidelines for evaluation"
    }
  ]
}
```

### Configuring LLM Models

In `run-demo.ts`, modify the LLM array:

```typescript
const report = await orchestrator.reviewAppraisal(
  sampleAppraisalPDF,
  'text',
  ['gpt-4', 'claude-3', 'gpt-3.5', 'custom-model'] // Add your models
);
```

### Adjusting Consensus Requirements

In `main.ts`, set `requireConsensus` parameter:

```typescript
const consolidated = await this.consolidateReviews(
  criterion.id,
  criterionReviews,
  true  // ← Require unanimous agreement
);
```

## 🧪 Integration with Loom Features

This demo showcases:

- ✅ **Actor Pattern**: Document extraction, review, consolidation
- ✅ **Parallel Execution**: Multiple agents review simultaneously
- ✅ **State Management**: Each actor maintains its own state
- ✅ **Type Safety**: Full TypeScript typing throughout
- ⏳ **Workflow Orchestration**: Sequential + parallel steps
- ⏳ **Resilience**: (Can be added: retry, timeout, circuit breaker)
- ⏳ **Secrets Management**: (Can be added: API keys for LLMs)

## 🎓 Learning Outcomes

After exploring this demo, you'll understand:

1. **Multi-Actor Coordination**: How to orchestrate multiple actors
2. **Real-World Use Case**: Production-ready mortgage industry workflow
3. **Decision Consolidation**: Reconciling multiple AI opinions
4. **Error Handling**: Graceful degradation and human escalation
5. **Extensibility**: Easy to add new checklists, LLMs, or criteria

## 🚧 Future Enhancements

Potential additions (PRs welcome!):

- [ ] Actual LLM API integration (OpenAI, Anthropic)
- [ ] Workflow JSON definition (instead of procedural code)
- [ ] Real PDF parsing (pdf-parse, OCR for images)
- [ ] Database persistence (save reports)
- [ ] Web UI for report viewing
- [ ] Resilience patterns (retry on LLM failures)
- [ ] Metrics and observability
- [ ] Webhook notifications on completion

## 📝 Notes

- **🎭 Mock & 🚀 Real Modes**: Supports both mock LLM responses (no API keys, free) and real LLM APIs (Azure OpenAI, Anthropic Claude)
- **Real PDF Parsing**: Uses pdfjs-dist to extract text from actual PDF files
- **Self-Contained**: This demo is completely isolated in `demos/` and can be deleted without affecting the core Loom framework
- **Zero Bloat**: Approximately 800 lines including real LLM integration
- **Production-Ready**: The architecture demonstrated here is ready for production deployment with your API keys

## 🤝 Contributing

This demo is part of the Loom framework. To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

Same as Loom framework license.

---

**Built with ❤️ using the Loom Multi-Agent Framework**
