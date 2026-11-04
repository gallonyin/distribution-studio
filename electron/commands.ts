import { z } from "zod";
import {
  articleSchema,
  idSchema,
  platformSchema,
  type Command,
} from "../src/domain";
const id = { id: idSchema };
const shapes = {
  "article.save": { article: articleSchema },
  "article.delete": id,
  "article.duplicate": id,
  "article.restore": { ...id, revision: z.number().int().positive() },
  "account.add": {
    platform: platformSchema,
    name: z.string().trim().min(1).max(80),
  },
  "account.delete": id,
  "account.open": id,
  "account.check": id,
  "account.checkAll": {},
  "account.reorder": {
    ids: z
      .array(idSchema)
      .min(1)
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "账号排序不能包含重复项",
      }),
  },
  "queue.add": {
    articleId: idSchema,
    accountIds: z.array(idSchema).min(1).max(200),
    scheduledAt: z.string().datetime().nullable(),
  },
  "queue.pause": { paused: z.boolean() },
  "queue.cancelAll": {},
  "queue.clearCancelled": {},
  "job.retry": id,
  "job.cancel": id,
  "job.delete": id,
  "job.open": id,
  "job.confirm": { ...id, url: z.string().max(2000) },
  "asset.import": {},
  "asset.delete": { id: z.string().regex(/^[a-f0-9]{64}$/) },
  "article.import": {},
  "backup.export": {},
  "backup.import": {},
  "article.export": id,
  "data.open": {},
} as const;
export function parseCommand(value: unknown): Command {
  const type = z
    .object({
      type: z.enum(
        Object.keys(shapes) as [
          keyof typeof shapes,
          ...(keyof typeof shapes)[],
        ],
      ),
    })
    .parse(value).type;
  return z
    .object({ type: z.literal(type), ...shapes[type] })
    .strict()
    .parse(value) as Command;
}
