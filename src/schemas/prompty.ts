import { z } from 'zod';

export const PromptyFrontmatterSchema = z.object({
  template_format: z.union([z.literal('f-string'), z.literal('jinja2')]).default('f-string'),
  kind: z.union([z.literal('string'), z.literal('chat')]).default('string'),
  system: z.string().optional(),
  user: z.string().optional(),
  assistant: z.string().optional(),
  inputs: z.record(z.string(), z.any()).optional(),
});
export type PromptyFrontmatter = z.infer<typeof PromptyFrontmatterSchema>;
