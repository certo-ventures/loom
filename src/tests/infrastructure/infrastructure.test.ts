import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCosmos } from '../../storage/in-memory-cosmos';
import { InMemoryBlobStorage } from '../../storage/in-memory-blob';

describe('Infrastructure - In-Memory Storage (Cosmos & Blob)', () => {
  describe('InMemoryCosmos', () => {
    let cosmos: InMemoryCosmos;

    beforeEach(async () => {
      cosmos = new InMemoryCosmos();
    });

    it('creates document', async () => {
      await cosmos.create({
        id: 'user-1',
        partitionKey: 'users',
        name: 'Alice',
        age: 30,
      });

      const doc = await cosmos.read('user-1', 'users');
      expect(doc).toEqual({
        id: 'user-1',
        partitionKey: 'users',
        name: 'Alice',
        age: 30,
      });
    });

    it('prevents duplicate documents', async () => {
      await cosmos.create({
        id: 'user-1',
        partitionKey: 'users',
        name: 'Alice',
      });

      await expect(
        cosmos.create({
          id: 'user-1',
          partitionKey: 'users',
          name: 'Bob',
        })
      ).rejects.toThrow('already exists');
    });

    it('updates document', async () => {
      await cosmos.create({
        id: 'user-1',
        partitionKey: 'users',
        name: 'Alice',
        age: 30,
      });

      await cosmos.update({
        id: 'user-1',
        partitionKey: 'users',
        name: 'Alice',
        age: 31,
      });

      const doc = await cosmos.read('user-1', 'users');
      expect(doc?.age).toBe(31);
    });

    it('upserts document (create or update)', async () => {
      // Create
      await cosmos.upsert({
        id: 'user-1',
        partitionKey: 'users',
        name: 'Alice',
      });

      let doc = await cosmos.read('user-1', 'users');
      expect(doc?.name).toBe('Alice');

      // Update
      await cosmos.upsert({
        id: 'user-1',
        partitionKey: 'users',
        name: 'Alice Updated',
      });

      doc = await cosmos.read('user-1', 'users');
      expect(doc?.name).toBe('Alice Updated');
    });

    it('deletes document', async () => {
      await cosmos.create({
        id: 'user-1',
        partitionKey: 'users',
        name: 'Alice',
      });

      await cosmos.delete('user-1', 'users');

      const doc = await cosmos.read('user-1', 'users');
      expect(doc).toBeNull();
    });

    it('queries by partition key', async () => {
      await cosmos.create({ id: 'user-1', partitionKey: 'users', name: 'Alice' });
      await cosmos.create({ id: 'user-2', partitionKey: 'users', name: 'Bob' });
      await cosmos.create({ id: 'order-1', partitionKey: 'orders', total: 100 });

      const users = await cosmos.query({ partitionKey: 'users' });
      expect(users).toHaveLength(2);
      expect(users.every(u => u.partitionKey === 'users')).toBe(true);
    });

    it('queries with custom filter', async () => {
      await cosmos.create({ id: 'user-1', partitionKey: 'users', name: 'Alice', age: 30 });
      await cosmos.create({ id: 'user-2', partitionKey: 'users', name: 'Bob', age: 25 });
      await cosmos.create({ id: 'user-3', partitionKey: 'users', name: 'Charlie', age: 35 });

      const adults = await cosmos.query({
        partitionKey: 'users',
        filter: doc => doc.age >= 30,
      });

      expect(adults).toHaveLength(2);
      expect(adults.map(u => u.name).sort()).toEqual(['Alice', 'Charlie']);
    });
  });

  describe('InMemoryBlobStorage', () => {
    let storage: InMemoryBlobStorage;

    beforeEach(() => {
      storage = new InMemoryBlobStorage();
    });

    it('uploads and downloads blob', async () => {
      await storage.upload('files/test.txt', 'Hello World');

      const data = await storage.download('files/test.txt');
      expect(data?.toString()).toBe('Hello World');
    });

    it('stores blob metadata', async () => {
      await storage.upload('files/test.txt', 'Hello', {
        contentType: 'text/plain',
        author: 'Alice',
      });

      const metadata = await storage.getMetadata('files/test.txt');
      expect(metadata?.contentType).toBe('text/plain');
      expect(metadata?.author).toBe('Alice');
      expect(metadata?.contentLength).toBe(5);
    });

    it('deletes blob', async () => {
      await storage.upload('files/test.txt', 'Hello');
      await storage.delete('files/test.txt');

      const data = await storage.download('files/test.txt');
      expect(data).toBeNull();
    });

    it('checks blob existence', async () => {
      await storage.upload('files/test.txt', 'Hello');

      expect(await storage.exists('files/test.txt')).toBe(true);
      expect(await storage.exists('files/missing.txt')).toBe(false);
    });

    it('lists blobs by prefix', async () => {
      await storage.upload('files/a.txt', 'A');
      await storage.upload('files/b.txt', 'B');
      await storage.upload('images/c.png', 'C');

      const files = await storage.list('files/');
      expect(files).toHaveLength(2);
      expect(files).toContain('files/a.txt');
      expect(files).toContain('files/b.txt');
    });
  });
});
