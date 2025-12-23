import { Activity, Clock, Inbox, Trash2, Play, Pause } from 'lucide-react';
import { ActorInfo } from '../types/loom';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { formatDuration, formatTimestamp, getStatusColor } from '@/lib/utils';

interface ActorCardProps {
  actor: ActorInfo;
  onSelect?: (actorId: string) => void;
  onEvict?: (actorId: string) => void;
  onRestart?: (actorId: string) => void;
}

export function ActorCard({ actor, onSelect, onEvict, onRestart }: ActorCardProps) {
  const statusVariant = actor.status === 'active' 
    ? 'success' 
    : actor.status === 'idle' 
    ? 'warning' 
    : actor.status === 'failed'
    ? 'destructive'
    : 'secondary';

  return (
    <Card 
      className="cursor-pointer transition-all hover:shadow-md hover:border-primary"
      onClick={() => onSelect?.(actor.id)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-semibold truncate">
              {actor.id}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {actor.type}
            </p>
          </div>
          <Badge variant={statusVariant} className="ml-2 shrink-0">
            <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${getStatusColor(actor.status)}`}></span>
            {actor.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Messages</p>
              <p className="font-medium">{actor.messageCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Queue</p>
              <p className="font-medium">{actor.queueDepth}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="font-medium text-xs">{formatTimestamp(actor.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Last Active</p>
              <p className="font-medium text-xs">{formatTimestamp(actor.lastActiveAt)}</p>
            </div>
          </div>
        </div>

        {actor.status === 'active' && (
          <div className="flex gap-2 mt-4 pt-3 border-t">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={(e) => {
                e.stopPropagation();
                onRestart?.(actor.id);
              }}
            >
              <Play className="h-3 w-3 mr-1" />
              Restart
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={(e) => {
                e.stopPropagation();
                onEvict?.(actor.id);
              }}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Evict
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ActorListProps {
  actors: ActorInfo[];
  loading?: boolean;
  onSelectActor?: (actorId: string) => void;
}

export function ActorList({ actors, loading, onSelectActor }: ActorListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-sm text-muted-foreground">Loading actors...</p>
        </div>
      </div>
    );
  }

  if (actors.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center max-w-sm">
          <Activity className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold mb-2">No Active Actors</h3>
          <p className="text-sm text-muted-foreground">
            Actors will appear here once your Loom runtime starts processing work.
          </p>
        </div>
      </div>
    );
  }

  const activeActors = actors.filter(a => a.status === 'active');
  const idleActors = actors.filter(a => a.status === 'idle');
  const otherActors = actors.filter(a => a.status !== 'active' && a.status !== 'idle');

  return (
    <div className="space-y-6">
      {activeActors.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500"></span>
            Active ({activeActors.length})
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeActors.map(actor => (
              <ActorCard
                key={actor.id}
                actor={actor}
                onSelect={onSelectActor}
              />
            ))}
          </div>
        </div>
      )}

      {idleActors.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-yellow-500"></span>
            Idle ({idleActors.length})
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {idleActors.map(actor => (
              <ActorCard
                key={actor.id}
                actor={actor}
                onSelect={onSelectActor}
              />
            ))}
          </div>
        </div>
      )}

      {otherActors.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-gray-500"></span>
            Other ({otherActors.length})
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {otherActors.map(actor => (
              <ActorCard
                key={actor.id}
                actor={actor}
                onSelect={onSelectActor}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
