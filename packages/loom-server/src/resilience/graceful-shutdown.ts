/**
 * Graceful Shutdown - Clean exit on SIGTERM/SIGINT
 */

import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

export class GracefulShutdown {
  private isShuttingDown = false;

  constructor(
    private server: FastifyInstance,
    private redis: Redis,
    private logger: any
  ) {
    this.registerHandlers();
  }

  private registerHandlers(): void {
    // Handle termination signals
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      this.logger.fatal({ error }, 'Uncaught exception');
      this.shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.fatal({ reason, promise }, 'Unhandled rejection');
      this.shutdown('unhandledRejection');
    });
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    this.logger.info({ signal }, 'Shutdown initiated');

    try {
      // 1. Stop accepting new requests
      this.logger.info('Closing server...');
      await this.server.close();

      // 2. Wait for in-flight requests (Fastify handles this)
      
      // 3. Close external connections
      this.logger.info('Closing Redis connection...');
      await this.redis.quit();

      this.logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      this.logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  }
}
