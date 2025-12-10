/**
 * Workflow Definition Language Demo
 * 
 * Shows the complete lifecycle:
 * 1. Create workflow definition
 * 2. Compile & validate
 * 3. Store with versioning
 * 4. Execute workflow
 * 5. Publish new versions
 */

import {
  WorkflowDefinition,
  InMemoryWorkflowStore,
  WorkflowCompiler,
  InMemoryWorkflowExecutor,
} from '../src/workflow';

async function demo() {
  console.log('🌊 Loom Workflow Definition Language Demo\n');

  // ============================================================================
  // 1. CREATE WORKFLOW DEFINITION (Azure Logic Apps Compatible!)
  // ============================================================================

  console.log('📝 Creating workflow definition...');
  
  const aiAgentWorkflow: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    
    parameters: {
      userMessage: {
        type: 'string',
        defaultValue: 'Hello!',
        metadata: {
          description: 'Message from user to AI agent',
        },
      },
    },
    
    triggers: {
      manual: {
        type: 'manual',
        inputs: {},
      },
    },
    
    actions: {
      // Step 1: Call AI agent to process message
      analyzeMessage: {
        type: 'Actor',
        inputs: {
          actorType: 'AIAgent',
          method: 'chat',
          args: {
            message: '@parameters("userMessage")',
            systemPrompt: 'You are a helpful assistant. Analyze the sentiment.',
          },
        },
      },
      
      // Step 2: Process sentiment with activity
      processSentiment: {
        type: 'Activity',
        inputs: {
          activityName: 'sentiment-analyzer',
          input: {
            text: '@actions("analyzeMessage").output',
          },
        },
        runAfter: {
          analyzeMessage: ['Succeeded'],
        },
      },
      
      // Step 3: Generate response based on sentiment
      generateResponse: {
        type: 'Actor',
        inputs: {
          actorType: 'AIAgent',
          method: 'chat',
          args: {
            message: 'Generate a friendly response',
            context: '@actions("processSentiment").output',
          },
        },
        runAfter: {
          processSentiment: ['Succeeded'],
        },
      },
    },
    
    outputs: {
      sentiment: {
        type: 'string',
        value: '@actions("processSentiment").output.sentiment',
      },
      response: {
        type: 'string',
        value: '@actions("generateResponse").output',
      },
    },
  };

  console.log('✅ Workflow created with 3 actions in sequence\n');

  // ============================================================================
  // 2. COMPILE & VALIDATE
  // ============================================================================

  console.log('🔧 Compiling workflow...');
  
  const compiler = new WorkflowCompiler();
  const compilation = compiler.compile(aiAgentWorkflow);
  
  if (compilation.valid) {
    console.log('✅ Workflow is valid!');
  } else {
    console.log('❌ Compilation errors:');
    compilation.errors.forEach(err => {
      console.log(`   - ${err.action ? `[${err.action}] ` : ''}${err.message}`);
    });
    return;
  }
  console.log('');

  // ============================================================================
  // 3. STORE WITH VERSIONING
  // ============================================================================

  console.log('💾 Storing workflow...');
  
  const store = new InMemoryWorkflowStore();
  const v1 = await store.create('ai-chat-workflow', aiAgentWorkflow, {
    description: 'AI-powered chat with sentiment analysis',
    tags: ['ai', 'chat', 'sentiment'],
  });
  
  console.log(`✅ Stored version ${v1.metadata.version}`);
  console.log(`   ID: ${v1.metadata.id}`);
  console.log(`   Description: ${v1.metadata.description}`);
  console.log(`   Tags: ${v1.metadata.tags?.join(', ')}`);
  console.log('');

  // ============================================================================
  // 4. EXECUTE WORKFLOW
  // ============================================================================

  console.log('🚀 Executing workflow...');
  
  const executor = new InMemoryWorkflowExecutor();
  const instanceId = await executor.execute(aiAgentWorkflow, {
    userMessage: 'I love this workflow engine!',
  });
  
  console.log(`✅ Workflow instance started: ${instanceId}`);
  
  // Wait for execution to complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const status = await executor.getStatus(instanceId);
  const result = await executor.getResult(instanceId);
  
  console.log(`   Status: ${status}`);
  console.log(`   Result:`, result);
  console.log('');

  // ============================================================================
  // 5. PUBLISH NEW VERSIONS
  // ============================================================================

  console.log('📦 Publishing new versions...');
  
  // Patch version - bug fix
  const patchWorkflow = { ...aiAgentWorkflow };
  const v1_0_1 = await store.publish('ai-chat-workflow', patchWorkflow, 'patch');
  console.log(`✅ Published patch version: ${v1_0_1.metadata.version} (bug fix)`);
  
  // Minor version - new feature
  const minorWorkflow: WorkflowDefinition = {
    ...aiAgentWorkflow,
    actions: {
      ...aiAgentWorkflow.actions,
      logInteraction: {
        type: 'Activity',
        inputs: {
          activityName: 'logger',
          input: {
            event: 'chat',
            data: '@actions("generateResponse").output',
          },
        },
        runAfter: {
          generateResponse: ['Succeeded'],
        },
      },
    },
  };
  const v1_1_0 = await store.publish('ai-chat-workflow', minorWorkflow, 'minor');
  console.log(`✅ Published minor version: ${v1_1_0.metadata.version} (added logging)`);
  
  // Major version - breaking change
  const majorWorkflow: WorkflowDefinition = {
    ...aiAgentWorkflow,
    parameters: {
      userMessage: {
        type: 'object', // Changed from string to object
        defaultValue: { text: '', metadata: {} },
      },
    },
  };
  const v2_0_0 = await store.publish('ai-chat-workflow', majorWorkflow, 'major');
  console.log(`✅ Published major version: ${v2_0_0.metadata.version} (breaking change)`);
  console.log('');

  // ============================================================================
  // 6. LIST ALL VERSIONS
  // ============================================================================

  console.log('📚 All versions:');
  const versions = await store.listVersions('ai-chat-workflow');
  versions.forEach(v => {
    console.log(`   - ${v.version} (${v.updatedAt.toISOString()})`);
  });
  console.log('');

  // ============================================================================
  // 7. RETRIEVE SPECIFIC VERSION
  // ============================================================================

  console.log('🔍 Retrieving specific versions...');
  
  const original = await store.get('ai-chat-workflow', '1.0.0');
  console.log(`✅ Retrieved v1.0.0 - ${Object.keys(original?.definition.actions || {}).length} actions`);
  
  const withLogging = await store.get('ai-chat-workflow', '1.1.0');
  console.log(`✅ Retrieved v1.1.0 - ${Object.keys(withLogging?.definition.actions || {}).length} actions`);
  
  const latest = await store.get('ai-chat-workflow');
  console.log(`✅ Retrieved latest (${latest?.metadata.version})`);
  console.log('');

  // ============================================================================
  // 8. VALIDATION EXAMPLES
  // ============================================================================

  console.log('🛡️ Validation examples...');
  
  // Invalid: Missing trigger
  const noTrigger: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: {},
    actions: { step1: { type: 'Compose', inputs: {} } },
  };
  const r1 = compiler.compile(noTrigger);
  console.log(`❌ No trigger: ${r1.errors[0].message}`);
  
  // Invalid: Circular dependency
  const circular: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: { manual: { type: 'manual' } },
    actions: {
      a: { type: 'Compose', inputs: {}, runAfter: { b: ['Succeeded'] } },
      b: { type: 'Compose', inputs: {}, runAfter: { a: ['Succeeded'] } },
    },
  };
  const r2 = compiler.compile(circular);
  console.log(`❌ Circular dependency: ${r2.errors[0].message}`);
  
  // Invalid: Unknown dependency
  const unknownDep: WorkflowDefinition = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0',
    triggers: { manual: { type: 'manual' } },
    actions: {
      step2: { type: 'Compose', inputs: {}, runAfter: { step1: ['Succeeded'] } },
    },
  };
  const r3 = compiler.compile(unknownDep);
  console.log(`❌ Unknown dependency: ${r3.errors[0].message}`);
  console.log('');

  console.log('🎉 Demo complete!\n');
  console.log('Key Features:');
  console.log('  ✅ Azure Logic Apps compatible schema');
  console.log('  ✅ Semantic versioning (major.minor.patch)');
  console.log('  ✅ Compile-time validation');
  console.log('  ✅ Actor & Activity orchestration');
  console.log('  ✅ Dependency graph execution');
  console.log('  ✅ Version history & rollback');
  console.log('  ✅ Simple, minimal, maximally functional!');
}

demo().catch(console.error);
