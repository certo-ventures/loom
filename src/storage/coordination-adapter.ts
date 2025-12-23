/**
 * Distributed coordination for actor locking across multiple Loom instances.
 * Prevents duplicate actor execution in horizontally scaled deployments.
 */

export interface ActorLock {
  actorId: string
  lockId: string
  expiresAt: number
}

export interface CoordinationAdapter {
  /**
   * Attempt to acquire exclusive lock on an actor.
   * Returns lock if successful, null if already locked by another instance.
   */
  acquireLock(actorId: string, ttlMs: number): Promise<ActorLock | null>

  /**
   * Release a previously acquired lock.
   */
  releaseLock(lock: ActorLock): Promise<void>

  /**
   * Renew a lock before it expires.
   * Returns true if renewed successfully, false if lock was lost.
   */
  renewLock(lock: ActorLock, ttlMs: number): Promise<boolean>
}
