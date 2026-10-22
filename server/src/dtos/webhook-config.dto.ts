import z from 'zod';

export const WebhookConfigSchema = z.object({
  webhooks: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        events: z.array(z.string()),
        url: z.url({ protocol: /^https?$/ }),
        method: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        timeoutMs: z.number().int().min(0).optional(),
        retries: z.number().int().min(1).optional(),
        backoffMs: z.number().int().min(0).optional(),
        includeServerEvents: z.boolean().optional(),
      }),
    )
    .default([]),
});

export type WebhookDefinitionDto = z.infer<typeof WebhookConfigSchema>['webhooks'][number];
