import { Clock, CheckCircle, XCircle, Activity, Inbox, Database } from 'lucide-react';
import { JournalEntry } from '../types/loom';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { formatDuration, formatTimestamp } from '@/lib/utils';

interface JournalTimelineProps {
  entries: JournalEntry[];
  loading?: boolean;
}

export function JournalTimeline({ entries, loading }: JournalTimelineProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-sm text-muted-foreground">Loading journal...</p>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center max-w-sm">
          <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold mb-2">No Journal Entries</h3>
          <p className="text-sm text-muted-foreground">
            Journal entries will appear here as the actor processes operations.
          </p>
        </div>
      </div>
    );
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'state_updated':
        return Database;
      case 'activity_scheduled':
      case 'activity_completed':
        return Activity;
      case 'activity_failed':
        return XCircle;
      case 'message_received':
        return Inbox;
      default:
        return CheckCircle;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'state_updated':
        return 'text-blue-500';
      case 'activity_scheduled':
        return 'text-yellow-500';
      case 'activity_completed':
        return 'text-green-500';
      case 'activity_failed':
        return 'text-red-500';
      case 'message_received':
        return 'text-purple-500';
      default:
        return 'text-gray-500';
    }
  };

  const getTypeLabel = (type: string) => {
    return type.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  return (
    <div className="space-y-4">
      {/* Timeline */}
      <div className="relative">
        {entries.map((entry, index) => {
          const Icon = getIcon(entry.type);
          const isLast = index === entries.length - 1;

          return (
            <div key={entry.id} className="relative pb-8">
              {/* Timeline line */}
              {!isLast && (
                <div className="absolute left-4 top-8 bottom-0 w-0.5 bg-border"></div>
              )}

              {/* Entry */}
              <div className="flex gap-4">
                {/* Icon */}
                <div className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background border-2 border-border ${getTypeColor(entry.type)}`}>
                  <Icon className="h-4 w-4" />
                </div>

                {/* Content */}
                <Card className="flex-1">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-semibold text-sm">{getTypeLabel(entry.type)}</h4>
                        <p className="text-xs text-muted-foreground">
                          {formatTimestamp(entry.timestamp)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {entry.duration && (
                          <Badge variant="outline" className="text-xs">
                            {formatDuration(entry.duration)}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs">
                          #{index + 1}
                        </Badge>
                      </div>
                    </div>

                    {/* Data preview */}
                    {entry.data && (
                      <div className="mt-3 rounded-md bg-muted/50 p-3">
                        <pre className="text-xs font-mono text-muted-foreground overflow-x-auto">
                          {JSON.stringify(entry.data, null, 2).slice(0, 200)}
                          {JSON.stringify(entry.data).length > 200 && '...'}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function JournalTimelinePlaceholder() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center max-w-sm">
        <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="font-semibold mb-2">Select an Actor</h3>
        <p className="text-sm text-muted-foreground">
          Choose an actor from the list to view its journal timeline and operation history.
        </p>
      </div>
    </div>
  );
}
