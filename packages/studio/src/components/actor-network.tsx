import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ActorInfo } from '../types/loom';
import { Activity, Inbox } from 'lucide-react';

interface ActorNodeData {
  actor: ActorInfo;
  onSelect?: (actorId: string) => void;
}

function ActorNode({ data }: { data: ActorNodeData }) {
  const { actor, onSelect } = data;
  
  const statusColor = 
    actor.status === 'active' ? 'bg-green-500' :
    actor.status === 'idle' ? 'bg-yellow-500' :
    actor.status === 'failed' ? 'bg-red-500' :
    'bg-gray-500';

  return (
    <div
      className="px-4 py-3 shadow-lg rounded-lg border-2 bg-card cursor-pointer hover:shadow-xl transition-all"
      style={{ borderColor: `hsl(var(--${actor.status === 'active' ? 'actor-active' : 'border'}))` }}
      onClick={() => onSelect?.(actor.id)}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`h-2.5 w-2.5 rounded-full ${statusColor} animate-pulse`}></div>
        <div className="font-semibold text-sm">{actor.id}</div>
      </div>
      <div className="text-xs text-muted-foreground mb-2">{actor.type}</div>
      <div className="flex gap-3 text-xs">
        <div className="flex items-center gap-1">
          <Activity className="h-3 w-3" />
          <span>{actor.messageCount}</span>
        </div>
        <div className="flex items-center gap-1">
          <Inbox className="h-3 w-3" />
          <span>{actor.queueDepth}</span>
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  actor: ActorNode,
};

interface ActorNetworkProps {
  actors: ActorInfo[];
  onSelectActor?: (actorId: string) => void;
}

export function ActorNetwork({ actors, onSelectActor }: ActorNetworkProps) {
  // Convert actors to nodes
  const initialNodes: Node[] = useMemo(() => {
    return actors.map((actor, index) => {
      // Simple circular layout
      const angle = (index / actors.length) * 2 * Math.PI;
      const radius = 200 + actors.length * 10;
      const x = 400 + radius * Math.cos(angle);
      const y = 300 + radius * Math.sin(angle);

      return {
        id: actor.id,
        type: 'actor',
        position: { x, y },
        data: { actor, onSelect: onSelectActor },
      };
    });
  }, [actors, onSelectActor]);

  // Create edges based on actor relationships (simplified)
  const initialEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
    
    // Connect active actors with pending messages to each other
    const activeActors = actors.filter(a => a.status === 'active');
    for (let i = 0; i < activeActors.length - 1; i++) {
      if (activeActors[i].queueDepth > 0) {
        edges.push({
          id: `${activeActors[i].id}-${activeActors[i + 1].id}`,
          source: activeActors[i].id,
          target: activeActors[i + 1].id,
          animated: true,
          style: { stroke: 'hsl(var(--primary))' },
        });
      }
    }

    return edges;
  }, [actors]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  // Update nodes when actors change
  useMemo(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  return (
    <div className="h-[600px] w-full rounded-lg border border-border bg-muted/20">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const nodeData = node.data as Record<string, unknown>;
            if (nodeData && typeof nodeData === 'object' && 'actor' in nodeData) {
              const actor = (nodeData as unknown as ActorNodeData).actor;
              return actor.status === 'active' ? '#22c55e' :
                     actor.status === 'idle' ? '#eab308' :
                     '#6b7280';
            }
            return '#6b7280';
          }}
          className="bg-background border border-border"
        />
      </ReactFlow>
    </div>
  );
}

export function ActorNetworkPlaceholder() {
  return (
    <div className="h-[600px] w-full rounded-lg border border-border bg-muted/20 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
          <Activity className="h-8 w-8 text-primary" />
        </div>
        <h3 className="font-semibold mb-2">No Actors to Visualize</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          The network graph will show actor relationships and message flows once actors are active.
        </p>
      </div>
    </div>
  );
}
