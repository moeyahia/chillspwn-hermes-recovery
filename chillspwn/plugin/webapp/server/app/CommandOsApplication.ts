import { Router, type Request, type Response } from "express";
import {
  createDatabaseConnection,
  getDatabaseHealth,
  migrateDatabase,
  type SqliteDatabase,
} from "../db";
import { EventRepository } from "../events/EventRepository";
import { createEventStreamRouter } from "../events/EventStreamRouter";
import { EventStreamService } from "../events/EventStreamService";
import type { EventSensitivity } from "../events/types";
import {
  createDatabaseReadinessProvider,
  type ReadinessCheckProvider,
} from "../missions";
import { createCommandOsRouter } from "../routes/commandOsRoutes";
import { RuntimeProjectionService, type RuntimeProjectionInput } from "./RuntimeProjectionService";
import { createApiContractRouter } from "../contracts";
import { attachV2RequestId } from "../contracts/ApiErrorContract";

export interface CommandOsApplicationOptions {
  readonly databasePath: string;
  readonly readinessProviders: (database: SqliteDatabase) => readonly ReadinessCheckProvider[];
  readonly runtimeProjection: () => RuntimeProjectionInput;
  readonly resolveActor: (request: Request) => string;
  readonly resolveEventSensitivity?: (request: Request) => EventSensitivity;
  readonly projectionIntervalMs?: number;
}

export interface CommandOsApplication {
  readonly database: SqliteDatabase;
  readonly eventStream: EventStreamService;
  readonly router: Router;
  readonly started: boolean;
  start(): void;
  stop(): Promise<void>;
}

/**
 * Owns the Command OS database, durable event stream, runtime projections, and
 * V2 API lifecycle. It can be mounted inside the legacy server during cutover
 * without making long-running work depend on an HTTP request.
 */
export function createCommandOsApplication(
  options: CommandOsApplicationOptions,
): CommandOsApplication {
  const database = createDatabaseConnection({ filename: options.databasePath });
  try {
    migrateDatabase(database);
  } catch (error) {
    database.close();
    throw error;
  }

  const eventStream = new EventStreamService({
    repository: new EventRepository(database),
  });
  const projection = new RuntimeProjectionService({
    database,
    read: options.runtimeProjection,
    intervalMs: options.projectionIntervalMs,
  });
  const router = Router();
  const readinessProviders = [
    createDatabaseReadinessProvider(database),
    ...options.readinessProviders(database),
  ];

  router.use((request, response, next) => {
    attachV2RequestId(request, response);
    next();
  });

  router.use(createApiContractRouter());

  router.use(createCommandOsRouter({
    database,
    readinessProviders,
    resolveActor: options.resolveActor,
  }));
  router.use(createEventStreamRouter({
    service: eventStream,
    resolveSensitivity: options.resolveEventSensitivity,
  }));
  const readinessHealth = (_request: Request, response: Response) => {
    const health = getDatabaseHealth(database);
    response.setHeader("Cache-Control", "no-store");
    response.json({
      schemaVersion: "2.1",
      status: health.healthy && eventStream.isStarted ? "healthy" : "degraded",
      database: health,
      eventStream: {
        status: eventStream.isStarted ? "healthy" : "unhealthy",
        subscribers: eventStream.subscriptionCount,
      },
      checkedAt: new Date().toISOString(),
    });
  };
  // Keep the process-level liveness/readiness contract distinct from the
  // paginated canonical component health API at /api/v2/system/health.
  router.get("/api/v2/system/readiness", readinessHealth);
  router.get("/api/v2/health", readinessHealth);

  let started = false;
  let stopped = false;
  return {
    database,
    eventStream,
    router,
    get started(): boolean {
      return started;
    },
    start(): void {
      if (stopped) throw new Error("Command OS application has already stopped");
      if (started) return;
      eventStream.start();
      try {
        projection.start();
        started = true;
      } catch (error) {
        void eventStream.stop();
        throw error;
      }
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      started = false;
      projection.stop();
      await eventStream.stop();
      database.close();
    },
  };
}
