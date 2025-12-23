import { randomUUID } from 'crypto'
import type { ActorLock, CoordinationAdapter } from './coordination-adapter'

/**
 * In-memory coordination for single-instance development.
 * DO NOT use in production with multiple instances.
 */
export class InMemoryCoordinationAdapter implements CoordinationAdapter {
  private locks = new Map<string, ActorLock>()

  async acquireLock(actorId: string, ttlMs: number): Promise<ActorLock | null> {
    const existing = this.locks.get(actorId)
    if (existing && existing.expiresAt > Date.now()) {
      return null // Still locked
    }

    const lock: ActorLock = {
      actorId,
      lockId: randomUUID(),
      expiresAt: Date.now() + ttlMs,
    }
    this.locks.set(actorId, lock)
    return lock
  }

  async releaseLock(lock: ActorLock): Promise<void> {
    const existing = this.locks.get(lock.actorId)
    if (existing?.lockId === lock.lockId) {
      this.locks.delete(lock.actorId)
    }
  }

  async renewLock(lock: ActorLock, ttlMs: number): Promise<boolean> {
    const existing = this.locks.get(lock.actorId)
    if (existing?.lockId !== lock.lockId) {
      return false // Lock was stolen or expired
    }

    lock.expiresAt = Date.now() + ttlMs
    this.locks.set(lock.actorId, lock)
    return true
  }
}
