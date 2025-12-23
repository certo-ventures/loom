import { z } from 'zod';

export const ToolCallChunkSchema = z.object({
  seq: z.number().int().nonnegative(),
  content: z.string(),
  contentType: z.string().optional(),
  ts: z.number().optional(),
});
export type ToolCallChunk = z.infer<typeof ToolCallChunkSchema>;

export const AiTraceEventSchema = z.object({
  type: z.string(),
  ts: z.number().optional(),
  toolCallId: z.string().optional(),
  chunk: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});
export type AiTraceEvent = z.infer<typeof AiTraceEventSchema>;
