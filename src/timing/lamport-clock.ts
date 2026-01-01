/**
 * Lamport Clock - Logical timestamp for distributed ordering
 * 
 * Provides happens-before relationship tracking across distributed actors.
 * Clock increments on local events and synchronizes on message receipt.
 * 
 * Usage:
 *   const clock = new LamportClock();
 *   const time1 = clock.tick();  // Local event
 *   const time2 = clock.tick(receivedTime);  // Sync with received message
 */
export class LamportClock {
  private clock: number;

  constructor(initialTime: number = 0) {
    this.clock = initialTime;
  }

  /**
   * Increment clock for local event OR sync with received timestamp
   * 
   * @param receivedTime - Optional timestamp from received message
   * @returns New timestamp after increment
   */
  tick(receivedTime?: number): number {
    if (receivedTime !== undefined) {
      // Message received: max(local, received) + 1
      this.clock = Math.max(this.clock, receivedTime) + 1;
    } else {
      // Local event: just increment
      this.clock += 1;
    }
    return this.clock;
  }

  /**
   * Get current time without incrementing
   */
  get(): number {
    return this.clock;
  }

  /**
   * Restore clock state (for actor recovery/revival)
   * Sets clock to max of current and restored time
   */
  restore(time: number): void {
    this.clock = Math.max(this.clock, time);
  }

  /**
   * Export state for persistence
   */
  serialize(): number {
    return this.clock;
  }
}
