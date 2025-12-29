/**
 * Time-Travel Debugger - Scrub through actor journal history
 * 
 * Features:
 * - Timeline scrubber with all journal entries
 * - State viewer at any point in time
 * - Diff viewer between entries
 * - Play/pause/step controls
 * 
 * ~150 lines. Maximum functionality.
 */

import { useState, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, FastForward } from 'lucide-react';
import { JournalEntry } from '../types/loom';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface TimeTravelDebuggerProps {
  entries: JournalEntry[];
  actorId: string;
}

export function TimeTravelDebugger({ entries }: TimeTravelDebuggerProps) {
  const [currentIndex, setCurrentIndex] = useState(entries.length - 1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Calculate state at current index by replaying entries
  const stateAtIndex = useMemo(() => {
    let state: any = {};
    
    for (let i = 0; i <= currentIndex && i < entries.length; i++) {
      const entry = entries[i];
      if (entry.type === 'state_updated' && entry.data) {
        // Merge state changes
        state = { ...state, ...entry.data };
      }
    }
    
    return state;
  }, [entries, currentIndex]);

  // Calculate diff from previous entry
  const diffFromPrevious = useMemo(() => {
    if (currentIndex === 0) return null;
    
    const current = stateAtIndex;
    let previous: any = {};
    
    for (let i = 0; i < currentIndex && i < entries.length; i++) {
      const entry = entries[i];
      if (entry.type === 'state_updated' && entry.data) {
        previous = { ...previous, ...entry.data };
      }
    }
    
    const added: string[] = [];
    const changed: string[] = [];
    
    Object.keys(current).forEach(key => {
      if (!(key in previous)) {
        added.push(key);
      } else if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) {
        changed.push(key);
      }
    });
    
    return { added, changed };
  }, [entries, currentIndex, stateAtIndex]);

  const currentEntry = entries[currentIndex];
  const timestamp = currentEntry ? new Date(currentEntry.timestamp) : new Date();
  const firstTimestamp = entries[0] ? new Date(entries[0].timestamp) : new Date();
  const timelineProgress = entries.length > 0 
    ? ((currentIndex + 1) / entries.length) * 100 
    : 0;

  const handlePlay = () => {
    setIsPlaying(true);
    const interval = setInterval(() => {
      setCurrentIndex(prev => {
        if (prev >= entries.length - 1) {
          setIsPlaying(false);
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 1000 / playbackSpeed);
  };

  const handlePause = () => setIsPlaying(false);
  const handleStepBack = () => setCurrentIndex(Math.max(0, currentIndex - 1));
  const handleStepForward = () => setCurrentIndex(Math.min(entries.length - 1, currentIndex + 1));
  const handleSkipToStart = () => setCurrentIndex(0);
  const handleSkipToEnd = () => setCurrentIndex(entries.length - 1);

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No journal entries yet. Execute the actor to see history.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Time Travel Controls</CardTitle>
            <Badge variant="outline">
              Entry {currentIndex + 1} of {entries.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Transport Controls */}
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handleSkipToStart}
              disabled={currentIndex === 0}
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            
            <Button
              variant="outline"
              size="icon"
              onClick={handleStepBack}
              disabled={currentIndex === 0}
            >
              <SkipForward className="h-4 w-4 rotate-180" />
            </Button>
            
            {isPlaying ? (
              <Button onClick={handlePause} size="icon">
                <Pause className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handlePlay} size="icon" disabled={currentIndex === entries.length - 1}>
                <Play className="h-4 w-4" />
              </Button>
            )}
            
            <Button
              variant="outline"
              size="icon"
              onClick={handleStepForward}
              disabled={currentIndex === entries.length - 1}
            >
              <SkipForward className="h-4 w-4" />
            </Button>
            
            <Button
              variant="outline"
              size="icon"
              onClick={handleSkipToEnd}
              disabled={currentIndex === entries.length - 1}
            >
              <FastForward className="h-4 w-4" />
            </Button>
          </div>

          {/* Timeline Scrubber */}
          <div className="space-y-2">
            <input
              type="range"
              min={0}
              max={entries.length - 1}
              value={currentIndex}
              onChange={(e) => setCurrentIndex(parseInt(e.target.value))}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${timelineProgress}%, hsl(var(--muted)) ${timelineProgress}%, hsl(var(--muted)) 100%)`
              }}
            />
            
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{firstTimestamp.toLocaleTimeString()}</span>
              <span>{timestamp.toLocaleTimeString()}.{timestamp.getMilliseconds()}</span>
            </div>
          </div>

          {/* Playback Speed */}
          <div className="flex items-center justify-center gap-2">
            <span className="text-sm text-muted-foreground">Speed:</span>
            {[0.5, 1, 2, 4].map(speed => (
              <Button
                key={speed}
                variant={playbackSpeed === speed ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPlaybackSpeed(speed)}
              >
                {speed}x
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Current Entry Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge>{currentEntry.type}</Badge>
              <span className="text-sm text-muted-foreground">
                {new Date(currentEntry.timestamp).toLocaleString()}
              </span>
              {currentEntry.duration && (
                <Badge variant="outline">{currentEntry.duration}ms</Badge>
              )}
            </div>
            {currentEntry.data && (
              <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
                {JSON.stringify(currentEntry.data, null, 2)}
              </pre>
            )}
          </div>
        </CardContent>
      </Card>

      {/* State at Current Point */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">State at Entry {currentIndex + 1}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-96">
              {JSON.stringify(stateAtIndex, null, 2)}
            </pre>
          </CardContent>
        </Card>

        {/* Diff View */}
        {diffFromPrevious && (diffFromPrevious.added.length > 0 || diffFromPrevious.changed.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Changes from Previous</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {diffFromPrevious.added.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-green-600 mb-1">Added:</h4>
                  {diffFromPrevious.added.map(key => (
                    <Badge key={key} variant="outline" className="mr-1 mb-1 text-green-600">
                      + {key}
                    </Badge>
                  ))}
                </div>
              )}
              {diffFromPrevious.changed.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-orange-600 mb-1">Changed:</h4>
                  {diffFromPrevious.changed.map(key => (
                    <Badge key={key} variant="outline" className="mr-1 mb-1 text-orange-600">
                      ~ {key}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
