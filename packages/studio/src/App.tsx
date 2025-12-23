import { Moon, Sun, Activity, Network, Clock, Database, Search, Settings, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { useTheme } from './components/theme-provider';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Input } from './components/ui/input';
import { ActorList } from './components/actor-list';
import { ActorNetwork, ActorNetworkPlaceholder } from './components/actor-network';
import { JournalTimeline, JournalTimelinePlaceholder } from './components/journal-timeline';
import { MetricsDashboard } from './components/metrics-dashboard';
import { TimeTravelDebugger } from './components/time-travel-debugger';
import { useLoomConnection, useActors, useMetrics, useJournal } from './hooks/use-loom';
import { useState } from 'react';

function App() {
  const { theme, setTheme } = useTheme();
  const { isConnected, connectionStatus, error, reconnect } = useLoomConnection();
  const { actors, loading: actorsLoading } = useActors();
  const metrics = useMetrics();
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const { entries: journalEntries, loading: journalLoading } = useJournal(selectedActorId);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary shadow-lg">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-6 w-6 text-primary-foreground"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold">Loom Studio</h1>
                <p className="text-xs text-muted-foreground">
                  Actor Development Environment
                </p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              <Button variant="ghost" size="sm">
                <Activity className="h-4 w-4 mr-2" />
                Actors
              </Button>
              <Button variant="ghost" size="sm">
                <Network className="h-4 w-4 mr-2" />
                Network
              </Button>
              <Button variant="ghost" size="sm">
                <Clock className="h-4 w-4 mr-2" />
                Timeline
              </Button>
              <Button variant="ghost" size="sm">
                <Database className="h-4 w-4 mr-2" />
                State
              </Button>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="hidden sm:block w-64">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search actors..."
                  className="pl-8 h-9"
                />
              </div>
            </div>

            {/* Status Badge */}
            <Badge 
              variant={isConnected ? "success" : "outline"} 
              className="hidden sm:flex"
            >
              <span className={`mr-1.5 h-2 w-2 rounded-full ${
                isConnected ? 'bg-green-500' : 
                connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 
                'bg-gray-500'
              }`}></span>
              {isConnected ? 'Connected' : 
               connectionStatus === 'connecting' ? 'Connecting...' : 
               'Disconnected'}
            </Badge>

            {/* Settings */}
            <Button variant="ghost" size="icon">
              <Settings className="h-5 w-5" />
            </Button>

            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto p-6">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="actors">Actors</TabsTrigger>
            <TabsTrigger value="network">Network</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Connection Error Alert */}
            {error && (
              <Card className="border-destructive">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                    <CardTitle className="text-base">Connection Error</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">
                    {error.message || 'Unable to connect to Loom runtime'}
                  </p>
                  <Button onClick={reconnect} size="sm">
                    Retry Connection
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Status Cards */}
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Actors</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {metrics?.actorPools?.activeActors ?? 0}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <Badge variant={isConnected ? "success" : "outline"} className="mt-1">
                      <span className={`mr-1 h-1.5 w-1.5 rounded-full ${
                        isConnected ? 'bg-green-500' : 'bg-gray-500'
                      }`}></span>
                      {isConnected ? 'Live' : 'Offline'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Messages/sec</CardTitle>
                  <Network className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {metrics?.messageQueues?.messagesPerSecond?.toFixed(1) ?? '0.0'}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {metrics?.messageQueues ? `${metrics.messageQueues.pendingMessages} pending` : 'Waiting for activity'}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Queue Depth</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {metrics?.messageQueues?.pendingMessages ?? 0}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {metrics?.messageQueues ? `${metrics.messageQueues.processingMessages} processing` : 'No pending messages'}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Pool Usage</CardTitle>
                  <Database className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {metrics?.actorPools ? `${(metrics.actorPools.poolUtilization * 100).toFixed(0)}%` : '0%'}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {metrics?.actorPools ? `${metrics.actorPools.totalActors} total actors` : '0 / 0 actors'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Welcome Section */}
            <Card>
              <CardHeader>
                <CardTitle>Welcome to Loom Studio</CardTitle>
                <CardDescription>
                  Your visual development environment for building, debugging, and monitoring Loom actors.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[
                    {
                      title: 'Actor Network',
                      description: 'Visualize actor relationships and message flows',
                      color: 'bg-blue-500',
                      icon: '🕸️',
                    },
                    {
                      title: 'Journal Timeline',
                      description: 'Replay actor history step-by-step',
                      color: 'bg-purple-500',
                      icon: '⏱️',
                    },
                    {
                      title: 'State Inspector',
                      description: 'Examine actor state in real-time',
                      color: 'bg-green-500',
                      icon: '🔍',
                    },
                    {
                      title: 'Message Queue',
                      description: 'Monitor message throughput and failures',
                      color: 'bg-orange-500',
                      icon: '📬',
                    },
                    {
                      title: 'Trace Correlation',
                      description: 'Track distributed operations across actors',
                      color: 'bg-pink-500',
                      icon: '🔗',
                    },
                    {
                      title: 'Health & Metrics',
                      description: 'Real-time system health monitoring',
                      color: 'bg-cyan-500',
                      icon: '💊',
                    },
                  ].map((feature, i) => (
                    <div
                      key={i}
                      className="group rounded-lg border border-border p-4 hover:shadow-md transition-all hover:border-primary cursor-pointer"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`h-10 w-10 rounded-lg ${feature.color} flex items-center justify-center text-white text-xl`}>
                          {feature.icon}
                        </div>
                        <h3 className="font-semibold">{feature.title}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {feature.description}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Getting Started */}
            <Card>
              <CardHeader>
                <CardTitle>Getting Started</CardTitle>
                <CardDescription>
                  Connect Loom Studio to your running Loom instance
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                    1
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium mb-1">Start your Loom runtime</h4>
                    <p className="text-sm text-muted-foreground">
                      Ensure observability endpoints are enabled on port 9090
                    </p>
                    <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs font-mono">
                      createObservabilityServer(&#123; port: 9090 &#125;)
                    </code>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                    2
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium mb-1">Studio will auto-connect</h4>
                    <p className="text-sm text-muted-foreground">
                      Once connected, you'll see real-time actor activity and metrics
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                    3
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium mb-1">Start exploring!</h4>
                    <p className="text-sm text-muted-foreground">
                      Use the tabs above to navigate between different views
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Actors Tab */}
          <TabsContent value="actors">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Actor List</CardTitle>
                    <CardDescription>
                      {isConnected 
                        ? `${actors.length} actor${actors.length !== 1 ? 's' : ''} in pool`
                        : 'Connect to view active actors'}
                    </CardDescription>
                  </div>
                  {isConnected && (
                    <Badge variant="success">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Live Updates
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {isConnected ? (
                  <ActorList 
                    actors={actors} 
                    loading={actorsLoading}
                    onSelectActor={setSelectedActorId}
                  />
                ) : (
                  <div className="text-center py-12">
                    <XCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-semibold mb-2">Not Connected</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Start the Studio Server and demo to see live actors
                    </p>
                    <div className="flex gap-2 justify-center">
                      <Button onClick={reconnect}>
                        Retry Connection
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="network">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Actor Network Visualization</CardTitle>
                    <CardDescription>
                      Interactive graph showing actor relationships and message flows
                    </CardDescription>
                  </div>
                  {isConnected && actors.length > 0 && (
                    <Badge variant="secondary">
                      {actors.length} node{actors.length !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {actors && actors.length > 0 ? (
                  <ActorNetwork 
                    actors={actors}
                    onSelectActor={setSelectedActorId}
                  />
                ) : (
                  <ActorNetworkPlaceholder />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="timeline">
            <div className="space-y-6">
              {/* Time-Travel Debugger - The Star Feature! */}
              {selectedActorId && journalEntries && journalEntries.length > 0 && (
                <TimeTravelDebugger 
                  entries={journalEntries}
                  actorId={selectedActorId}
                />
              )}

              {/* Classic Timeline View */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Journal Timeline</CardTitle>
                      <CardDescription>
                        {selectedActorId 
                          ? `Viewing journal for ${selectedActorId}`
                          : 'Step through actor journal entries'}
                      </CardDescription>
                    </div>
                    {selectedActorId && journalEntries.length > 0 && (
                      <Badge variant="secondary">
                        {journalEntries.length} entr{journalEntries.length !== 1 ? 'ies' : 'y'}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {journalEntries && journalEntries.length > 0 ? (
                    <JournalTimeline 
                      entries={journalEntries}
                      loading={journalLoading}
                    />
                  ) : (
                    <JournalTimelinePlaceholder />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="metrics">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">System Metrics</h2>
                  <p className="text-sm text-muted-foreground">
                    Real-time performance and health monitoring
                  </p>
                </div>
                {isConnected && (
                  <Badge variant="success">
                    <Activity className="h-3 w-3 mr-1" />
                    Live Data
                  </Badge>
                )}
              </div>
              <MetricsDashboard metrics={metrics} />
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default App;
