/**
 * PipelineStateStore
 *
 * Durable pipeline execution metadata persisted in Redis so orchestrators can
 * resume/monitor work without relying on in-memory Maps.
 */

import { Redis } from 'ioredis'
import { PipelineDefinition } from './pipeline-dsl'

export const DEFAULT_TASK_LEASE_TTL_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

export type PipelineStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused'
export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked'

export interface ResumeCursor {
  stageName: string
  taskIndex?: number
  attempt?: number
  stageNames?: string[]
}

export interface StageErrorState {
  message: string
  code?: string
  retryable?: boolean
  occurredAt: number
}

export interface PipelineRecord {
  pipelineId: string
  definition: PipelineDefinition
  status: PipelineStatus
  triggerData: any
  createdAt: number
  startedAt?: number
  completedAt?: number
  updatedAt: number
  stageOrder: string[]
  currentStage?: string
  resumeCursor?: ResumeCursor
  activeStages?: string[]
  contextVersion: number
  metadata?: Record<string, any>
}

export interface StageRecord {
  pipelineId: string
  stageName: string
  status: StageStatus
  attempt: number
  expectedTasks: number
  completedTasks: number
  startedAt?: number
  completedAt?: number
  updatedAt: number
  outputsRef?: string
  pendingApprovalId?: string
  error?: StageErrorState | null
}

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface TaskAttemptRecord {
  pipelineId: string
  stageName: string
  taskIndex: number
  attempt: number
  status: TaskStatus
  queueName?: string
  actorType?: string
  messageId?: string
  message?: any
  workerId?: string
  queuedAt?: number
  startedAt?: number
  retryAttempt?: number
  completedAt?: number
  availableAt?: number
  outputRef?: string
  output?: any
  input?: any
  metadata?: Record<string, any>
  error?: StageErrorState | null
  recordedAt?: number
  leaseId?: string
  leaseOwner?: string
}

export type TaskStatusMap = Record<string, TaskAttemptRecord>

export interface ContextSnapshot {
  pipelineId: string
  version: number
  data: any
  createdAt: number
}

export interface TaskLeaseRecord {
  pipelineId: string
  stageName: string
  taskIndex: number
  leaseId: string
  owner?: string
  expiresAt: number
  ttlMs: number
  createdAt: number
  updatedAt: number
}

export interface EnsureTaskLeaseInput {
  pipelineId: string
  stageName: string
  taskIndex: number
  leaseId: string
  ttlMs: number
}

export interface AcquireTaskLeaseInput extends EnsureTaskLeaseInput {
  owner: string
}

export interface PipelineCancellationRecord {
  pipelineId: string
  cancelledAt: number
  reason?: string
}

// ---------------------------------------------------------------------------
// Store contract
// ---------------------------------------------------------------------------

export interface PipelineStateStore {
  createPipeline(input: CreatePipelineInput): Promise<PipelineRecord>
  getPipeline(pipelineId: string): Promise<PipelineRecord | null>
  setPipelineStatus(pipelineId: string, status: PipelineStatus, patch?: Partial<PipelineRecord>): Promise<void>
  listRunningPipelines(limit?: number): Promise<string[]>

  upsertStage(record: StageRecord): Promise<void>
  getStage(pipelineId: string, stageName: string): Promise<StageRecord | null>
  updateStageProgress(input: UpdateStageProgressInput): Promise<StageRecord>

  recordTaskAttempt(input: TaskAttemptRecord): Promise<void>
  listTaskAttempts(pipelineId: string, stageName: string, opts?: { count?: number }): Promise<TaskAttemptRecord[]>
  getTaskStatusMap(pipelineId: string, stageName: string): Promise<TaskStatusMap>
  getPendingTasks(pipelineId: string, stageName: string): Promise<TaskAttemptRecord[]>
  ensureTaskLease(input: EnsureTaskLeaseInput): Promise<TaskLeaseRecord>
  acquireTaskLease(input: AcquireTaskLeaseInput): Promise<TaskLeaseRecord | null>
  renewTaskLease(input: AcquireTaskLeaseInput): Promise<TaskLeaseRecord | null>
  releaseTaskLease(pipelineId: string, stageName: string, taskIndex: number, leaseId: string): Promise<void>
  getTaskLease(pipelineId: string, stageName: string, taskIndex: number): Promise<TaskLeaseRecord | null>
  markPipelineCancelled(pipelineId: string, reason?: string): Promise<void>
  clearPipelineCancellation(pipelineId: string): Promise<void>
  isPipelineCancelled(pipelineId: string): Promise<boolean>

  snapshotContext(pipelineId: string, data: any): Promise<ContextSnapshot>
  getLatestContext(pipelineId: string): Promise<ContextSnapshot | null>

  appendStageOutput(pipelineId: string, stageName: string, attempt: number, output: any): Promise<void>
  getStageOutputs(pipelineId: string, stageName: string, attempt: number): Promise<any[]>
  clearStageOutputs(pipelineId: string, stageName: string, attempt: number): Promise<void>
}

export interface CreatePipelineInput {
  pipelineId: string
  definition: PipelineDefinition
  triggerData: any
  metadata?: Record<string, any>
  status?: PipelineStatus
  activeStages?: string[]
}

export interface UpdateStageProgressInput {
  pipelineId: string
  stageName: string
  startedAt?: number
  completedAt?: number
  status?: StageStatus
  expectedTasks?: number
  completedTasksDelta?: number
  outputsRef?: string
  error?: StageErrorState | null
  pendingApprovalId?: string | null
}

// ---------------------------------------------------------------------------
// Redis-backed implementation
// ---------------------------------------------------------------------------

export class RedisPipelineStateStore implements PipelineStateStore {
  private redis: Redis

  constructor(redis: Redis) {
    this.redis = redis
  }

  // ------------------- Pipeline API -------------------

  async createPipeline(input: CreatePipelineInput): Promise<PipelineRecord> {
    const now = Date.now()
    const record: PipelineRecord = {
      pipelineId: input.pipelineId,
      definition: input.definition,
      status: input.status ?? 'running',
      triggerData: input.triggerData,
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      stageOrder: input.definition.stages.map(stage => stage.name),
      activeStages: input.activeStages ?? [],
      contextVersion: 0,
      metadata: input.metadata
    }

    await this.redis
      .multi()
      .set(this.pipelineRecordKey(input.pipelineId), JSON.stringify(record))
      .sadd('pipelines:running', input.pipelineId)
      .exec()

    return record
  }

  async getPipeline(pipelineId: string): Promise<PipelineRecord | null> {
    const payload = await this.redis.get(this.pipelineRecordKey(pipelineId))
    return payload ? (JSON.parse(payload) as PipelineRecord) : null
  }

  async setPipelineStatus(
    pipelineId: string,
    status: PipelineStatus,
    patch?: Partial<PipelineRecord>
  ): Promise<void> {
    const existing = await this.getPipeline(pipelineId)
    if (!existing) {
      throw new Error(`Pipeline not found: ${pipelineId}`)
    }

    const updated: PipelineRecord = {
      ...existing,
      ...patch,
      status,
      updatedAt: Date.now()
    }

    if (status === 'completed' || status === 'failed' || status === 'paused') {
      await this.redis.srem('pipelines:running', pipelineId)
      if (status === 'completed' || status === 'failed') {
        updated.completedAt = updated.completedAt ?? Date.now()
      }
    } else if (status === 'running') {
      await this.redis.sadd('pipelines:running', pipelineId)
    }

    await this.redis.set(this.pipelineRecordKey(pipelineId), JSON.stringify(updated))
  }

  async listRunningPipelines(limit = 100): Promise<string[]> {
    const members = await this.redis.smembers('pipelines:running')
    return members.slice(0, limit)
  }

  // ------------------- Stage API -------------------

  async upsertStage(record: StageRecord): Promise<void> {
    const toPersist = {
      ...record,
      updatedAt: Date.now()
    }
    await this.redis.set(this.stageRecordKey(record.pipelineId, record.stageName), JSON.stringify(toPersist))
  }

  async getStage(pipelineId: string, stageName: string): Promise<StageRecord | null> {
    const payload = await this.redis.get(this.stageRecordKey(pipelineId, stageName))
    return payload ? (JSON.parse(payload) as StageRecord) : null
  }

  async updateStageProgress(input: UpdateStageProgressInput): Promise<StageRecord> {
    const existing = await this.getStage(input.pipelineId, input.stageName)
    if (!existing) {
      throw new Error(`Stage not found: ${input.pipelineId}/${input.stageName}`)
    }

    const updated: StageRecord = {
      ...existing,
      status: input.status ?? existing.status,
      expectedTasks: input.expectedTasks ?? existing.expectedTasks,
      completedTasks: typeof input.completedTasksDelta === 'number'
        ? existing.completedTasks + input.completedTasksDelta
        : existing.completedTasks,
      startedAt: input.startedAt ?? existing.startedAt,
      completedAt: input.completedAt ?? existing.completedAt,
      outputsRef: input.outputsRef ?? existing.outputsRef,
      pendingApprovalId: input.pendingApprovalId === undefined
        ? existing.pendingApprovalId
        : input.pendingApprovalId || undefined,
      error: input.error ?? existing.error,
      updatedAt: Date.now()
    }

    await this.redis.set(this.stageRecordKey(input.pipelineId, input.stageName), JSON.stringify(updated))
    return updated
  }

  // ------------------- Task attempts -------------------

  async recordTaskAttempt(input: TaskAttemptRecord): Promise<void> {
    const enriched: TaskAttemptRecord = {
      ...input,
      recordedAt: Date.now()
    }

    const statusKey = this.taskStatusKey(input.pipelineId, input.stageName)
    const existingRaw = await this.redis.hget(statusKey, String(input.taskIndex))
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as TaskAttemptRecord
      enriched.message = enriched.message ?? existing.message
      enriched.input = enriched.input ?? existing.input
      enriched.actorType = enriched.actorType ?? existing.actorType
      enriched.queueName = enriched.queueName ?? existing.queueName
      enriched.messageId = enriched.messageId ?? existing.messageId
      enriched.metadata = enriched.metadata ?? existing.metadata
      enriched.availableAt = enriched.availableAt ?? existing.availableAt
    }

    const serialized = JSON.stringify(enriched)

    await this.redis
      .multi()
      .rpush(this.taskListKey(input.pipelineId, input.stageName), serialized)
      .hset(statusKey, String(input.taskIndex), serialized)
      .exec()
  }

  async listTaskAttempts(
    pipelineId: string,
    stageName: string,
    opts?: { count?: number }
  ): Promise<TaskAttemptRecord[]> {
    const count = opts?.count ?? -1
    const entries = await this.redis.lrange(this.taskListKey(pipelineId, stageName), 0, count < 0 ? -1 : count - 1)
    return entries.map(entry => JSON.parse(entry) as TaskAttemptRecord)
  }

  async getTaskStatusMap(pipelineId: string, stageName: string): Promise<TaskStatusMap> {
    const entries = await this.redis.hgetall(this.taskStatusKey(pipelineId, stageName))
    const map: TaskStatusMap = {}
    for (const [taskIndex, payload] of Object.entries(entries)) {
      map[taskIndex] = JSON.parse(payload) as TaskAttemptRecord
    }
    return map
  }

  async getPendingTasks(pipelineId: string, stageName: string): Promise<TaskAttemptRecord[]> {
    const map = await this.getTaskStatusMap(pipelineId, stageName)
    return Object.values(map).filter(record => record.status !== 'completed')
  }

  // ------------------- Task leases -------------------

  async ensureTaskLease(input: EnsureTaskLeaseInput): Promise<TaskLeaseRecord> {
    const key = this.taskLeaseKey(input.pipelineId, input.stageName, input.taskIndex)
    const now = Date.now()
    const record: TaskLeaseRecord = {
      pipelineId: input.pipelineId,
      stageName: input.stageName,
      taskIndex: input.taskIndex,
      leaseId: input.leaseId,
      ttlMs: input.ttlMs,
      expiresAt: now + input.ttlMs,
      createdAt: now,
      updatedAt: now
    }

    await this.redis.set(key, JSON.stringify(record), 'PX', input.ttlMs)
    return record
  }

  async acquireTaskLease(input: AcquireTaskLeaseInput): Promise<TaskLeaseRecord | null> {
    return this.updateLeaseRecord(input, record => {
      if (!record) {
        return null
      }
      if (record.leaseId !== input.leaseId) {
        return null
      }

      const now = Date.now()
      if (record.owner && record.owner !== input.owner && record.expiresAt > now) {
        return null
      }

      record.owner = input.owner
      record.expiresAt = now + input.ttlMs
      record.updatedAt = now
      record.ttlMs = input.ttlMs
      return record
    })
  }

  async renewTaskLease(input: AcquireTaskLeaseInput): Promise<TaskLeaseRecord | null> {
    return this.updateLeaseRecord(input, record => {
      if (!record || record.leaseId !== input.leaseId || record.owner !== input.owner) {
        return null
      }
      const now = Date.now()
      record.expiresAt = now + input.ttlMs
      record.updatedAt = now
      record.ttlMs = input.ttlMs
      return record
    })
  }

  async releaseTaskLease(
    pipelineId: string,
    stageName: string,
    taskIndex: number,
    leaseId: string
  ): Promise<void> {
    const key = this.taskLeaseKey(pipelineId, stageName, taskIndex)
    const raw = await this.redis.get(key)
    if (!raw) {
      return
    }
    const record = JSON.parse(raw) as TaskLeaseRecord
    if (record.leaseId !== leaseId) {
      return
    }
    await this.redis.del(key)
  }

  async getTaskLease(pipelineId: string, stageName: string, taskIndex: number): Promise<TaskLeaseRecord | null> {
    const key = this.taskLeaseKey(pipelineId, stageName, taskIndex)
    const raw = await this.redis.get(key)
    return raw ? (JSON.parse(raw) as TaskLeaseRecord) : null
  }

  // ------------------- Pipeline cancellation -------------------

  async markPipelineCancelled(pipelineId: string, reason?: string): Promise<void> {
    const record: PipelineCancellationRecord = {
      pipelineId,
      reason,
      cancelledAt: Date.now()
    }
    await this.redis.set(this.pipelineCancellationKey(pipelineId), JSON.stringify(record))
  }

  async clearPipelineCancellation(pipelineId: string): Promise<void> {
    await this.redis.del(this.pipelineCancellationKey(pipelineId))
  }

  async isPipelineCancelled(pipelineId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.pipelineCancellationKey(pipelineId))
    return exists === 1
  }

  private taskLeaseKey(pipelineId: string, stageName: string, taskIndex: number): string {
    return `${this.pipelineTaskKey(pipelineId, stageName, taskIndex)}:lease`
  }

  private pipelineCancellationKey(pipelineId: string): string {
    return this.pipelineKey(pipelineId, 'cancellation')
  }

  private async updateLeaseRecord(
    input: AcquireTaskLeaseInput,
    mutate: (record: TaskLeaseRecord | null) => TaskLeaseRecord | null
  ): Promise<TaskLeaseRecord | null> {
    const key = this.taskLeaseKey(input.pipelineId, input.stageName, input.taskIndex)
    const raw = await this.redis.get(key)
    const current = raw ? (JSON.parse(raw) as TaskLeaseRecord) : null
    const next = mutate(current)
    if (!next) {
      return null
    }
    await this.redis.set(key, JSON.stringify(next), 'PX', input.ttlMs)
    return next
  }

  // ------------------- Context snapshots -------------------

  async snapshotContext(pipelineId: string, data: any): Promise<ContextSnapshot> {
    const latestVersion = await this.redis.get(this.contextVersionKey(pipelineId))
    const nextVersion = latestVersion ? Number(latestVersion) + 1 : 1
    const snapshot: ContextSnapshot = {
      pipelineId,
      version: nextVersion,
      data,
      createdAt: Date.now()
    }

    await this.redis
      .multi()
      .set(this.contextSnapshotKey(pipelineId, nextVersion), JSON.stringify(snapshot))
      .set(this.contextVersionKey(pipelineId), String(nextVersion))
      .exec()

    const pipelineRecord = await this.getPipeline(pipelineId)
    if (pipelineRecord) {
      pipelineRecord.contextVersion = nextVersion
      pipelineRecord.updatedAt = Date.now()
      await this.redis.set(this.pipelineRecordKey(pipelineId), JSON.stringify(pipelineRecord))
    }
    return snapshot
  }

  async getLatestContext(pipelineId: string): Promise<ContextSnapshot | null> {
    const latestVersion = await this.redis.get(this.contextVersionKey(pipelineId))
    if (!latestVersion) {
      return null
    }
    const payload = await this.redis.get(this.contextSnapshotKey(pipelineId, Number(latestVersion)))
    return payload ? (JSON.parse(payload) as ContextSnapshot) : null
  }

  // ------------------- Stage output helpers -------------------

  async appendStageOutput(pipelineId: string, stageName: string, attempt: number, output: any): Promise<void> {
    await this.redis.rpush(this.stageOutputsKey(pipelineId, stageName, attempt), JSON.stringify(output))
  }

  async getStageOutputs(pipelineId: string, stageName: string, attempt: number): Promise<any[]> {
    const entries = await this.redis.lrange(this.stageOutputsKey(pipelineId, stageName, attempt), 0, -1)
    return entries.map(entry => JSON.parse(entry))
  }

  async clearStageOutputs(pipelineId: string, stageName: string, attempt: number): Promise<void> {
    await this.redis.del(this.stageOutputsKey(pipelineId, stageName, attempt))
  }

  // ------------------- Key helpers -------------------

  private pipelineRecordKey(pipelineId: string): string {
    return `${pipelineId}:record`
  }

  private stageRecordKey(pipelineId: string, stageName: string): string {
    return `${pipelineId}:stage:${stageName}`
  }

  private taskListKey(pipelineId: string, stageName: string): string {
    return `${pipelineId}:stage:${stageName}:tasks`
  }

  private taskStatusKey(pipelineId: string, stageName: string): string {
    return `${pipelineId}:stage:${stageName}:tasks:latest`
  }

  private pipelineTaskKey(pipelineId: string, stageName: string, taskIndex: number): string {
    return `${pipelineId}:stage:${stageName}:task:${taskIndex}`
  }

  private contextSnapshotKey(pipelineId: string, version: number): string {
    return `${pipelineId}:context:${version}`
  }

  private contextVersionKey(pipelineId: string): string {
    return `${pipelineId}:context:latest`
  }

  private stageOutputsKey(pipelineId: string, stageName: string, attempt: number): string {
    return `${pipelineId}:stage:${stageName}:attempt:${attempt}:outputs`
  }

  private pipelineKey(pipelineId: string, suffix: string): string {
    return `${pipelineId}:${suffix}`
  }
}
