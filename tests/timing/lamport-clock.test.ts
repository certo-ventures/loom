import { describe, it, expect } from 'vitest';
import { LamportClock } from '../../src/timing/lamport-clock';

describe('LamportClock', () => {
  describe('Local events', () => {
    it('should start at 0 by default', () => {
      const clock = new LamportClock();
      expect(clock.get()).toBe(0);
    });

    it('should start at provided initial time', () => {
      const clock = new LamportClock(42);
      expect(clock.get()).toBe(42);
    });

    it('should increment on local event', () => {
      const clock = new LamportClock();
      
      expect(clock.tick()).toBe(1);
      expect(clock.tick()).toBe(2);
      expect(clock.tick()).toBe(3);
    });

    it('should not change time on get()', () => {
      const clock = new LamportClock();
      clock.tick();
      
      expect(clock.get()).toBe(1);
      expect(clock.get()).toBe(1);  // Still 1
    });
  });

  describe('Message synchronization', () => {
    it('should sync with received timestamp when received > local', () => {
      const clock = new LamportClock();
      
      // Local clock is at 2
      clock.tick();
      clock.tick();
      
      // Receive message with timestamp 5
      const newTime = clock.tick(5);
      
      expect(newTime).toBe(6);  // max(2, 5) + 1
      expect(clock.get()).toBe(6);
    });

    it('should increment when received < local', () => {
      const clock = new LamportClock();
      
      // Local clock advances to 10
      for (let i = 0; i < 10; i++) {
        clock.tick();
      }
      
      // Receive message with old timestamp 3
      const newTime = clock.tick(3);
      
      expect(newTime).toBe(11);  // max(10, 3) + 1
    });

    it('should handle received === local', () => {
      const clock = new LamportClock();
      
      clock.tick();
      clock.tick();  // local = 2
      
      const newTime = clock.tick(2);  // received = 2
      
      expect(newTime).toBe(3);  // max(2, 2) + 1
    });
  });

  describe('Multi-actor scenario', () => {
    it('should maintain causality between two actors', () => {
      const clockA = new LamportClock();
      const clockB = new LamportClock();
      
      // Actor A does some work
      clockA.tick();  // A = 1
      clockA.tick();  // A = 2
      clockA.tick();  // A = 3
      
      // Actor A sends message to B (includes timestamp 3)
      const sentTime = clockA.get();
      
      // Actor B receives message
      clockB.tick(sentTime);  // B = max(0, 3) + 1 = 4
      
      // Actor B does work
      clockB.tick();  // B = 5
      
      // Actor B sends message back to A
      const returnTime = clockB.get();
      
      // Actor A receives message
      clockA.tick(returnTime);  // A = max(3, 5) + 1 = 6
      
      expect(clockA.get()).toBe(6);
      expect(clockB.get()).toBe(5);
    });

    it('should detect concurrent events', () => {
      const clockA = new LamportClock();
      const clockB = new LamportClock();
      
      // Both actors do independent work (no communication)
      clockA.tick();  // A = 1
      clockB.tick();  // B = 1
      
      // Both have same timestamp - events are concurrent!
      expect(clockA.get()).toBe(clockB.get());
    });
  });

  describe('Persistence', () => {
    it('should serialize clock state', () => {
      const clock = new LamportClock();
      clock.tick();
      clock.tick();
      
      const state = clock.serialize();
      expect(state).toBe(2);
    });

    it('should restore clock state', () => {
      const clock = new LamportClock();
      clock.tick();
      
      clock.restore(5);
      
      expect(clock.get()).toBe(5);
    });

    it('should not go backwards on restore', () => {
      const clock = new LamportClock();
      
      // Clock advances to 10
      for (let i = 0; i < 10; i++) {
        clock.tick();
      }
      
      // Try to restore to earlier time
      clock.restore(5);
      
      // Clock stays at 10
      expect(clock.get()).toBe(10);
    });

    it('should support full save/restore cycle', () => {
      const clock1 = new LamportClock();
      clock1.tick();
      clock1.tick();
      clock1.tick();
      
      // Save state
      const savedState = clock1.serialize();
      
      // Create new clock from saved state
      const clock2 = new LamportClock(savedState);
      
      expect(clock2.get()).toBe(3);
      
      // Continue from where we left off
      clock2.tick();
      expect(clock2.get()).toBe(4);
    });
  });
});
