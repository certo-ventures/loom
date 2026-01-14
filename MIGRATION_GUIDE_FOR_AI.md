# Immer Integration Migration Guide for AI Agents

## Overview
The Loom Actor base class has been updated to use Immer for immutable state management. This is a **BREAKING CHANGE** that requires updating all actor implementations.

## API Change Summary

### Before (Old - Will Not Work)
```typescript
this.updateState({ key: value })
this.updateState({ 
  field1: newValue1,
  field2: newValue2 
})
```

### After (New - Required)
```typescript
this.updateState(draft => {
  draft.key = value
})

this.updateState(draft => {
  draft.field1 = newValue1
  draft.field2 = newValue2
})
```

## Migration Pattern

**The signature changed from:**
```typescript
updateState(updates: Record<string, unknown>): void
```

**To:**
```typescript
updateState(updater: (draft: T) => void): void
```

## Detailed Examples

### Example 1: Simple Property Update
```typescript
// ❌ OLD
this.updateState({ count: 42 })

// ✅ NEW
this.updateState(draft => {
  draft.count = 42
})
```

### Example 2: Multiple Properties
```typescript
// ❌ OLD
this.updateState({
  status: 'completed',
  result: data,
  timestamp: Date.now()
})

// ✅ NEW
this.updateState(draft => {
  draft.status = 'completed'
  draft.result = data
  draft.timestamp = Date.now()
})
```

### Example 3: Array Operations
```typescript
// ❌ OLD
this.updateState({
  items: [...this.state.items, newItem]
})

// ✅ NEW
this.updateState(draft => {
  draft.items.push(newItem)  // Direct mutation on draft!
})
```

### Example 4: Nested Object Updates
```typescript
// ❌ OLD
this.updateState({
  user: {
    ...this.state.user,
    profile: {
      ...this.state.user.profile,
      name: 'New Name'
    }
  }
})

// ✅ NEW
this.updateState(draft => {
  draft.user.profile.name = 'New Name'  // No spreading needed!
})
```

### Example 5: Conditional Updates
```typescript
// ❌ OLD
this.updateState({
  count: this.state.count + 1,
  isEven: (this.state.count + 1) % 2 === 0
})

// ✅ NEW
this.updateState(draft => {
  draft.count += 1
  draft.isEven = draft.count % 2 === 0
})
```

### Example 6: Array Filtering
```typescript
// ❌ OLD
this.updateState({
  messages: this.state.messages.filter(m => m.id !== messageId)
})

// ✅ NEW
this.updateState(draft => {
  const index = draft.messages.findIndex(m => m.id === messageId)
  if (index !== -1) {
    draft.messages.splice(index, 1)
  }
})
```

### Example 7: Array Mapping
```typescript
// ❌ OLD
this.updateState({
  items: this.state.items.map(item => 
    item.id === targetId ? { ...item, status: 'done' } : item
  )
})

// ✅ NEW
this.updateState(draft => {
  const item = draft.items.find(i => i.id === targetId)
  if (item) {
    item.status = 'done'
  }
})
```

## Automated Migration Instructions

### Step 1: Find All Instances
```bash
grep -rn "this\.updateState\s*(\s*{" --include="*.ts" --exclude-dir=node_modules .
```

### Step 2: Pattern Recognition
Look for these patterns:
- `this.updateState({`
- `this.updateState( {`
- `this.updateState  ({`

### Step 3: Apply Transformation Rules

1. **Wrap the object in an arrow function:**
   ```typescript
   this.updateState({ ... })
   →
   this.updateState(draft => { ... })
   ```

2. **Convert object properties to assignments:**
   ```typescript
   { key: value }
   →
   draft.key = value
   ```

3. **Handle array spreads - convert to mutations:**
   ```typescript
   { arr: [...this.state.arr, item] }
   →
   draft.arr.push(item)
   ```

4. **Remove spreading operators - use direct assignment:**
   ```typescript
   { obj: { ...this.state.obj, prop: value } }
   →
   draft.obj.prop = value
   ```

## Common Pitfalls

### ❌ Don't return values from updater
```typescript
// WRONG
this.updateState(draft => {
  return { ...draft, count: 42 }  // ❌ Don't return
})

// CORRECT
this.updateState(draft => {
  draft.count = 42  // ✅ Just mutate draft
})
```

### ❌ Don't access this.state inside updater
```typescript
// WRONG
this.updateState(draft => {
  draft.count = this.state.count + 1  // ❌ Use draft instead
})

// CORRECT
this.updateState(draft => {
  draft.count = draft.count + 1  // ✅ Use draft
})
```

### ❌ Don't mix old and new syntax
```typescript
// WRONG
this.updateState({ count: draft.count + 1 })  // ❌ draft doesn't exist here

// CORRECT
this.updateState(draft => {
  draft.count = draft.count + 1  // ✅ draft exists in arrow function
})
```

## Regex Pattern for Search & Replace

### Pattern to Find:
```regex
this\.updateState\(\s*\{([^}]+)\}\s*\)
```

### Manual Replacement Strategy:
For each match:
1. Extract the content between `{` and `}`
2. Parse key-value pairs
3. Convert each `key: value` to `draft.key = value`
4. Wrap in arrow function: `draft => { [assignments] }`

**Note:** Due to nested objects and complex expressions, automated regex replacement is risky. Manual review recommended.

## Special Case: Actors Using Temporal Mixins

If your project uses temporal mixins (`withTemporalFeatures`, `withContinueAsNew`, `withVersioning`, etc.), those actors also need migration:

```typescript
// ❌ OLD - in your actor using temporal mixins
class MyWorkflowActor extends withTemporalFeatures(Actor) {
  async execute() {
    this.updateState({ workflowStatus: 'running' })
  }
}

// ✅ NEW 
class MyWorkflowActor extends withTemporalFeatures(Actor) {
  async execute() {
    this.updateState(draft => {
      draft.workflowStatus = 'running'
    })
  }
}
```

**Note:** The temporal mixins themselves (`src/actor/temporal-mixins.ts`) have already been migrated in Loom core. You only need to migrate YOUR actor classes that use these mixins.

## Benefits of New Approach

1. **Simpler Deep Updates:** No more spreading nested objects
2. **Smaller Storage:** Journal stores patches instead of full state (90% reduction)
3. **Faster Replay:** 20-60x faster with patch application
4. **Auto Compensation:** `compensateLastStateChange()` for Saga pattern
5. **Immutability Guaranteed:** Immer prevents accidental mutations

## Files Requiring Updates

Based on grep search, the following files need migration:

**Core Actor Files (~18 instances):**
- `src/actor/ai-actor.ts` (8 calls)
- `src/actor/temporal-mixins.ts` (7 calls)
- `src/actor/supervisor-actor.ts` (2 calls)
- `src/actor/group-chat-actor.ts` (1 call)

**Example Files (~30 instances):**
- `examples/counter-actor.ts`
- `examples/workflow-actor.ts`
- `examples/event-driven-actors.ts`
- `examples/ai-agents.ts`
- `examples/ai-tools-example.ts`
- `examples/temporal-features-demo.ts`
- `examples/journal-persistence-usage.ts`
- `examples/journal-with-adapter-factory.ts`
- `examples/test-config-resolution.ts`
- `examples/test-triggers.ts`

**Demo Files (~11 instances):**
- `demos/test-backward-compat.ts`
- `demos/test-tracing.ts`

**Test Files (~30 instances):**
- `src/tests/integration/*.test.ts`
- `src/tests/actor/*.test.ts`
- `src/tests/runtime/*.test.ts`
- `src/tests/workflow/*.test.ts`
- `tests/*.test.ts`

**Total:** ~89 instances across entire codebase

## Verification Steps

After migration:

1. **Install Immer:**
   ```bash
   npm install
   ```

2. **Run Tests:**
   ```bash
   npm test
   ```

3. **Run Demo:**
   ```bash
   npm run demo:immer
   ```

4. **Check for Remaining Old Calls:**
   ```bash
   grep -rn "this\.updateState\s*(\s*{" --include="*.ts" --exclude-dir=node_modules .
   ```

## Questions?

Refer to `IMMER_INTEGRATION.md` for detailed technical documentation and performance benchmarks.

---

**Migration Status:** ✅ ai-actors-example.ts completed (reference implementation)
**Remaining:** 86 instances across core, examples, demos, and tests
