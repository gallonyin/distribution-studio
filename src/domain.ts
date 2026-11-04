import type {
  ImageAction,
  ImageConfigView,
  ImageRequest,
  ImageResult,
} from "./image-domain";
import { z } from "zod";
export const platformIds = [
  "wechat",
  "zhihu",
  "csdn",
  "xiaohongshu",
  "baijiahao",
  "sohu",
  "toutiao",
  "netease",
  "jianshu",
  "web",
] as const;
export type PlatformId = (typeof platformIds)[number];
export const platformSchema = z.enum(platformIds);
export const platforms: Record<
  PlatformId,
  {
    name: string;
    color: string;
    short: string;
    url: string;
    hosts: string[];
    hint: string;
    group: string;
  }
> = {
  wechat: {
    name: "微信公众号",
    short: "微",
    color: "#16a267",
    url: "https://mp.weixin.qq.com/",
    hosts: ["mp.weixin.qq.com"],
    hint: "先在后台打开新的图文编辑页；检查摘要、封面和图片后保存或发布。",
    group: "必选",
  },
  zhihu: {
    name: "知乎",
    short: "知",
    color: "#2876e9",
    url: "https://zhuanlan.zhihu.com/write",
    hosts: ["zhihu.com"],
    hint: "检查专栏、封面和引用来源。",
    group: "必选",
  },
  csdn: {
    name: "CSDN",
    short: "C",
    color: "#e36442",
    url: "https://mp.csdn.net/mp_blog/creation/editor",
    hosts: ["csdn.net"],
    hint: "检查代码块、图片、标签与分类。",
    group: "必选",
  },
  xiaohongshu: {
    name: "小红书",
    short: "红",
    color: "#ee4361",
    url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
    hosts: ["xiaohongshu.com"],
    hint: "使用独立短稿和配图；先进入图文编辑页，必要时手动上传图片。",
    group: "ToC 必选",
  },
  baijiahao: {
    name: "百家号",
    short: "百",
    color: "#4386ef",
    url: "https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1",
    hosts: ["baijiahao.baidu.com", "passport.baidu.com"],
    hint: "检查封面、分类和原创声明。",
    group: "第二批",
  },
  sohu: {
    name: "搜狐号",
    short: "搜",
    color: "#cf9b13",
    url: "https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle",
    hosts: ["sohu.com"],
    hint: "检查封面与标题。",
    group: "第二批",
  },
  toutiao: {
    name: "今日头条",
    short: "头",
    color: "#e34a49",
    url: "https://mp.toutiao.com/profile_v4/graphic/publish",
    hosts: ["toutiao.com"],
    hint: "检查封面、声明和内容分类。",
    group: "第二批",
  },
  netease: {
    name: "网易号",
    short: "网",
    color: "#cc4145",
    url: "https://mp.163.com/subscribe_v4/index.html#/article-publish",
    hosts: ["163.com"],
    hint: "检查封面和分类。",
    group: "补充分发",
  },
  jianshu: {
    name: "简书",
    short: "简",
    color: "#e78661",
    url: "https://www.jianshu.com/writer",
    hosts: ["jianshu.com"],
    hint: "选择文集并新建文章，再执行填充。",
    group: "补充分发",
  },
  web: {
    name: "自建 Web",
    short: "W",
    color: "#5759be",
    url: "",
    hosts: [],
    hint: "导出 Markdown、HTML 与素材包，对接自建站点。",
    group: "自有阵地",
  },
};
export const idSchema = z.string().uuid();
const text = z.string().max(1000000);
export const variantSchema = z.object({
  title: z.string().max(300),
  markdown: text,
});
export type Variant = z.infer<typeof variantSchema>;
export const articleSchema = z.object({
  id: idSchema,
  title: z.string().max(300),
  markdown: text,
  collection: z.enum(["链上说明书", "ToC 软件", "其他"]),
  tags: z.array(z.string().max(40)).max(30),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().positive(),
  overrides: z.record(platformSchema, variantSchema),
  history: z
    .array(
      z.object({
        revision: z.number(),
        title: z.string(),
        markdown: text,
        at: z.string(),
      }),
    )
    .max(30),
});
export type Article = z.infer<typeof articleSchema>;
export const accountSchema = z.object({
  id: idSchema,
  platform: platformSchema,
  name: z.string().min(1).max(80),
  status: z.enum(["unknown", "authenticated", "editor_ready", "needs_login"]),
  checkedAt: z.string().optional(),
  checkMethod: z.enum(["api", "http", "page"]).optional(),
  checkMessage: z.string().max(250).optional(),
});
export type Account = z.infer<typeof accountSchema>;
export const assetSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().max(250),
  mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  size: z
    .number()
    .int()
    .min(1)
    .max(12 * 1024 * 1024),
});
export type Asset = z.infer<typeof assetSchema>;
export const jobStatuses = [
  "queued",
  "running",
  "cancelling",
  "needs_attention",
  "awaiting_review",
  "published",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof jobStatuses)[number];
export const jobSchema = z.object({
  id: idSchema,
  articleId: idSchema,
  accountId: idSchema,
  platform: platformSchema,
  revision: z.number().int(),
  snapshot: variantSchema,
  status: z.enum(jobStatuses),
  createdAt: z.string(),
  scheduledAt: z.string().nullable(),
  updatedAt: z.string(),
  fingerprint: z.string(),
  attempts: z.number().int(),
  message: z.string(),
  phase: z.enum(["opening", "waiting", "inspecting", "filling"]).optional(),
  resultUrl: z.string(),
  logs: z.array(z.object({ at: z.string(), message: z.string() })).max(200),
});
export type Job = z.infer<typeof jobSchema>;
export const stateSchema = z.object({
  version: z.literal(1),
  articles: z.array(articleSchema).max(5000),
  accounts: z.array(accountSchema).max(200),
  assets: z.array(assetSchema).max(5000),
  jobs: z.array(jobSchema).max(20000),
  settings: z.object({ queuePaused: z.boolean() }),
});
export type State = z.infer<typeof stateSchema>;
export type Preview = Variant & {
  html: string;
  text: string;
  warnings: string[];
  images: { src: string; name: string }[];
};
export type Bootstrap = { state: State; dataPath: string; version: string };
export type Command =
  | { type: "article.save"; article: Article }
  | { type: "article.delete"; id: string }
  | { type: "article.duplicate"; id: string }
  | { type: "article.restore"; id: string; revision: number }
  | { type: "account.add"; platform: PlatformId; name: string }
  | { type: "account.delete"; id: string }
  | { type: "account.open"; id: string }
  | { type: "account.check"; id: string }
  | { type: "account.checkAll" }
  | { type: "account.reorder"; ids: string[] }
  | {
      type: "queue.add";
      articleId: string;
      accountIds: string[];
      scheduledAt: string | null;
    }
  | { type: "queue.pause"; paused: boolean }
  | { type: "queue.cancelAll" }
  | { type: "queue.clearCancelled" }
  | { type: "job.retry"; id: string }
  | { type: "job.cancel"; id: string }
  | { type: "job.delete"; id: string }
  | { type: "job.open"; id: string }
  | { type: "job.confirm"; id: string; url: string }
  | { type: "asset.import" }
  | { type: "asset.delete"; id: string }
  | { type: "article.import" }
  | { type: "backup.export" }
  | { type: "backup.import" }
  | { type: "article.export"; id: string }
  | { type: "data.open" };
export interface Bridge {
  imageConfig(action: ImageAction): Promise<ImageConfigView>;
  generateImage(request: ImageRequest): Promise<ImageResult>;
  bootstrap(): Promise<Bootstrap>;
  command(command: Command): Promise<State>;
  preview(article: Article, platform: PlatformId): Promise<Preview>;
  copy(
    article: Article,
    platform: PlatformId,
    format: "html" | "markdown" | "text",
  ): Promise<void>;
  onState(callback: (state: State) => void): () => void;
}
declare global {
  interface Window {
    studio: Bridge;
  }
}
export const statusLabels: Record<JobStatus, string> = {
  queued: "排队中",
  running: "正在执行",
  cancelling: "正在取消",
  needs_attention: "需要处理",
  awaiting_review: "待检查发布",
  published: "已人工确认发布",
  failed: "失败",
  cancelled: "已取消",
};
export function newArticle(): Article {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    markdown: "",
    collection: "链上说明书",
    tags: [],
    createdAt: now,
    updatedAt: now,
    revision: 1,
    overrides: {},
    history: [],
  };
}
export function allowedPlatformUrl(
  platform: PlatformId,
  value: string,
): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      platforms[platform].hosts.some(
        (h) => u.hostname === h || u.hostname.endsWith("." + h),
      )
    );
  } catch {
    return false;
  }
}
