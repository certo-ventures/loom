// @ts-nocheck - Legacy file, references deleted WorkflowDefinition
import { WorkflowDefinition } from '../Workflow.js';
import type { ActionDefinition, TriggerDefinition, ParameterDefinition, OutputDefinition } from '../json/wdl-schema.js';

/**
 * Convert a UI flow (nodes, edges) into a loom WorkflowDefinition (WDL format).
 * Supports both legacy simple format and full WDL with triggers, actions, outputs.
 * Expects:
 * { nodes: [{ id, type, data }], edges: [{ source, sourceHandle?, target, targetHandle? }] }
 */
export function convertFlowToWorkflow(flow: any): WorkflowDefinition {
  const nodes = flow.nodes || [];
  const edges = flow.edges || [];

  const nodeMap = new Map<string, any>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Build adjacency map: for each node, list of outgoing node ids
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    const src = e.source; const tgt = e.target;
    if (!outgoing.has(src)) outgoing.set(src, []);
    outgoing.get(src)!.push(tgt);
  }

  // Determine if this should be a full WDL workflow or legacy format
  // Use full WDL if nodes contain trigger/action/parameter/output types
  const hasWDLTypes = nodes.some((n: any) => 
    ['wdlTrigger', 'wdlAction', 'wdlParameter', 'wdlOutput', 'trigger', 'action', 'parameter', 'output']
      .includes(n.type || n.data?.type)
  );

  if (hasWDLTypes) {
    return convertToFullWDL(flow, nodes, edges, nodeMap, outgoing);
  }

  // Fallback to legacy format
  return convertToLegacyFormat(flow, nodes, outgoing);
}

/**
 * Convert to full WDL format with triggers, actions, parameters, outputs
 */
function convertToFullWDL(
  flow: any, 
  nodes: any[], 
  edges: any[], 
  nodeMap: Map<string, any>, 
  outgoing: Map<string, string[]>
): WorkflowDefinition {
  const parameters: Record<string, ParameterDefinition> = {};
  const triggers: Record<string, TriggerDefinition> = {};
  const actions: Record<string, ActionDefinition> = {};
  const outputs: Record<string, OutputDefinition> = {};

  // Build incoming edge map (for runAfter dependencies)
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }

  // Process each node
  for (const node of nodes) {
    const nodeType = node.type || node.data?.type || 'unknown';
    const nodeData = node.data || {};

    if (nodeType === 'wdlParameter' || nodeType === 'parameter') {
      parameters[node.id] = {
        type: nodeData.parameterType || 'string',
        defaultValue: nodeData.defaultValue,
        metadata: {
          description: nodeData.description || ''
        }
      };
    } else if (nodeType === 'wdlTrigger' || nodeType === 'trigger') {
      triggers[node.id] = {
        type: nodeData.triggerType || 'manual',
        inputs: nodeData.inputs || {},
        conditions: nodeData.conditions
      } as TriggerDefinition;
    } else if (nodeType === 'wdlOutput' || nodeType === 'output') {
      outputs[node.id] = {
        type: nodeData.outputType || 'string',
        value: nodeData.value || `@variables('${node.id}')`,
        metadata: {
          description: nodeData.description || ''
        }
      };
    } else {
      // Treat as action
      const runAfter: Record<string, string[]> = {};
      const deps = incoming.get(node.id) || [];
      for (const dep of deps) {
        runAfter[dep] = ['Succeeded'];
      }

      actions[node.id] = {
        type: mapNodeTypeToActionType(nodeType),
        inputs: nodeData.inputs || nodeData,
        runAfter: Object.keys(runAfter).length > 0 ? runAfter : undefined,
        agentId: nodeData.agentId
      } as ActionDefinition;
    }
  }

  const wdl: any = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0.0',
    parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    triggers: Object.keys(triggers).length > 0 ? triggers : (
      // Add default manual trigger if none exist
      {
        manual: {
          type: 'manual',
          inputs: {}
        }
      }
    ),
    actions: Object.keys(actions).length > 0 ? actions : undefined,
    outputs: Object.keys(outputs).length > 0 ? outputs : undefined
  };

  return wdl as WorkflowDefinition;
}

/**
 * Map UI node type to WDL action type
 */
function mapNodeTypeToActionType(nodeType: string): string {
  const mapping: Record<string, string> = {
    'llm': 'InvokeAgent',
    'http': 'Http',
    'code': 'ExecuteCode',
    'choice': 'Condition',
    'prompt': 'InvokeAgent',
    'output': 'Compose'
  };
  return mapping[nodeType] || 'Compose';
}

/**
 * Convert to legacy simple step format
 * @deprecated Use full WDL format
 */
function convertToLegacyFormat(flow: any, nodes: any[], outgoing: Map<string, string[]>): WorkflowDefinition {
  // Construct steps: keep original node ids, map type -> agentType
  const steps = nodes.map((n: any) => {
    const next = (outgoing.get(n.id) || []) as string[];
    const agentType = n.type || (n.data && n.data.type) || 'unknown';
    return { id: n.id, agentType, agentId: n.data?.agentId, input: n.data || {}, next } as any;
  });

  // Return as legacy format with steps property
  const wf: any = { 
    id: flow.metadata?.id || `flow_${Date.now()}`, 
    steps 
  };
  return wf as WorkflowDefinition;
}

export function convertNodesToPalette(nodesRegistry: any) {
  // adapter to produce node palette JSON for UI from registry
  return Object.keys(nodesRegistry).map((k) => ({ type: k, label: nodesRegistry[k].label || k, category: nodesRegistry[k].category || 'misc' }));
}
