# Loom Examples

## Counter Actor

The simplest possible actor - a stateful counter.

```typescript
class CounterActor extends Actor {
  protected getDefaultState() {
    return { count: 0 }
  }

  async execute(input) {
    // Your logic here
  }
}
```

**That's it!** Just extend `Actor`, define state, implement `execute()`. 

### Run it:

```bash
npm run example:counter
```

## Workflow Actor

Shows calling activities, spawning children, and waiting for events.

See `workflow-actor.ts` for the full example.

## What Makes This So Minimal?

- **No decorators** - Just plain classes
- **No magic** - Explicit state management
- **No frameworks** - Pure TypeScript
- **Plain JSON** - All state is just objects

You should cry with joy at how little code this takes! 😭🎉
