/**
 * Azure Logic Apps Workflow Definition Language Types
 * 
 * Simplified subset focusing on core actor orchestration
 */

export interface WorkflowDefinition {
  $schema?: string;
  contentVersion?: string;
  parameters?: Record<string, WorkflowParameter>;
  triggers?: Record<string, WorkflowTrigger>;
  actions: Record<string, WorkflowAction>;
  outputs?: Record<string, WorkflowOutput>;
}

export interface WorkflowParameter {
  type: 'string' | 'int' | 'bool' | 'array' | 'object';
  defaultValue?: any;
  allowedValues?: any[];
  metadata?: {
    description?: string;
  };
}

export interface WorkflowTrigger {
  type: 'manual' | 'http' | 'schedule';
  inputs?: any;
  recurrence?: {
    frequency: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month';
    interval: number;
  };
}

export interface WorkflowAction {
  type: 'actor' | 'condition' | 'foreach' | 'scope' | 'http';
  runAfter?: Record<string, string[]>; // { "previousAction": ["Succeeded"] }
  inputs?: any;
  
  // Actor-specific
  actorType?: string;
  actorVersion?: string;
  
  // Condition-specific
  expression?: string; // WDL expression: @equals(actions('step1').outputs.status, 'ok')
  actions?: Record<string, WorkflowAction>; // If true
  else?: {
    actions?: Record<string, WorkflowAction>; // If false
  };
  
  // ForEach-specific
  foreach?: string; // Expression: @body('getData').items
  
  // HTTP-specific
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  uri?: string;
  headers?: Record<string, string>;
  body?: any;
}

export interface WorkflowOutput {
  type: 'string' | 'int' | 'bool' | 'array' | 'object';
  value: any; // Can be expression: @actions('step1').outputs.result
}

export interface WorkflowExecutionContext {
  parameters: Record<string, any>;
  actions: Record<string, WorkflowActionResult>;
  trigger?: any;
}

export interface WorkflowActionResult {
  status: 'Succeeded' | 'Failed' | 'Skipped';
  outputs?: any;
  error?: {
    message: string;
    code: string;
  };
  startTime: string;
  endTime: string;
  duration: number;
}

export interface WorkflowExecutionResult {
  workflowId: string;
  status: 'Succeeded' | 'Failed' | 'Cancelled';
  startTime: string;
  endTime: string;
  duration: number;
  actions: Record<string, WorkflowActionResult>;
  outputs?: Record<string, any>;
  error?: {
    message: string;
    failedAction?: string;
  };
}
