import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type {
  Article,
  Asset,
  PlatformId,
  Preview,
  Variant,
} from "../src/domain";
export function cleanHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "h1",
      "h2",
      "span",
      "section",
      "del",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title"],
      code: ["class"],
      "*": [],
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowedSchemesByTag: { img: ["https", "data"] },
    allowProtocolRelative: false,
    transformTags: {
      img: (_tag, attrs) => ({
        tagName: "img",
        attribs: /^(https:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(
          attrs.src ?? "",
        )
          ? attrs
          : { alt: attrs.alt ?? "图片地址不可用" },
      }),
    },
  });
}
export function plain(html: string): string {
  return sanitizeHtml(
    html
      .replace(/<\/(p|h[1-6]|li|pre|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?\s*>/gi, "\n"),
    { allowedTags: [], allowedAttributes: {} },
  )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
export function adapt(article: Article, platform: PlatformId): Variant {
  const override = article.overrides[platform];
  if (override) return { ...override };
  // Short-form adaptation is deliberately opt-in: do not silently truncate the canonical article.
  return { title: article.title, markdown: article.markdown };
}
const wechatStyles: Record<string, string> = {
  h1: "font-size:26px;line-height:1.5;margin:28px 0 18px;color:#20332e",
  h2: "font-size:21px;line-height:1.6;margin:26px 0 14px;color:#247b64",
  h3: "font-size:18px;margin:22px 0 12px",
  p: "font-size:16px;line-height:1.9;margin:14px 0;color:#333",
  blockquote:
    "border-left:3px solid #8bbdaa;padding:10px 16px;background:#f4f8f6;margin:18px 0",
  pre: "font-size:13px;line-height:1.65;background:#f4f5f6;padding:16px;white-space:pre-wrap;word-break:break-word",
  img: "max-width:100%;height:auto;display:block;margin:16px auto",
  table: "border-collapse:collapse;width:100%;font-size:14px",
  td: "border:1px solid #ddd;padding:8px",
  th: "border:1px solid #ddd;padding:8px;background:#f4f8f6",
  li: "line-height:1.9;font-size:16px",
  a: "color:#247b64;text-decoration:underline",
};
export async function makePreview(
  article: Article,
  platform: PlatformId,
  assets: Asset[],
  resolve: (a: Asset) => string,
): Promise<Preview> {
  const v = adapt(article, platform);
  const warnings: string[] = [];
  const markdown = v.markdown.replace(/asset:\/\/([a-f0-9]{64})/g, (_, id) => {
    const a = assets.find((a) => a.id === id);
    if (!a) {
      warnings.push("有本地图片缺失，请重新导入。");
      return "";
    }
    return resolve(a);
  });
  const rendered = await marked.parse(markdown, { gfm: true, breaks: false });
  for (const image of rendered.matchAll(/<img\b[^>]*src="([^"]*)"/g))
    if (
      !/^(https:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(image[1])
    )
      warnings.push("图片地址未解析，请导入本地图片并重新插入。");
  let html = cleanHtml(rendered);
  const text = plain(html);
  const images = [...html.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/g)].map(
    (m, i) => ({ src: m[1].replace(/&amp;/g, "&"), name: `image-${i + 1}` }),
  );
  if (!v.title.trim()) warnings.push("标题为空。");
  if (!text.trim()) warnings.push("正文为空。");
  if (platform === "wechat") {
    html = html.replace(
      /<(h[1-3]|p|blockquote|pre|img|table|td|th|li|a)(\s[^>]*|)>/g,
      (s, tag, attrs) => `<${tag}${attrs} style="${wechatStyles[tag]}">`,
    );
    if (/<a /i.test(html))
      warnings.push("公众号可能限制正文外链，请检查链接可用性。");
  }
  if (platform === "bilibili") {
    warnings.push(
      "Bilibili 图文文章：请在官方编辑器检查封面、分区、标签与图片转存；不会投稿视频。只有登录接口通过时，尚不代表已验证图文编辑器。",
    );
  }
  if (platform === "xiaohongshu") {
    if (!article.overrides.xiaohongshu)
      warnings.push("尚未创建小红书独立短稿，请压缩内容并配置配图。");
    if ([...v.title].length > 20)
      warnings.push("标题超过 20 字，建议缩短并以平台当前限制为准。");
    if ([...text].length > 1000)
      warnings.push("正文超过 1000 字，请改为短文；不会自动截断。");
    if (!images.length) warnings.push("小红书图文稿至少需要一张配图。");
  }
  if (images.some((i) => i.src.startsWith("https:")))
    warnings.push("含远程图片：平台可能拒绝外链，建议导入本地图片。");
  if (platform !== "web" && images.length)
    warnings.push("图片已包含在稿件中；平台是否转存成功需在编辑器检查。");
  return { ...v, html, text, warnings: [...new Set(warnings)], images };
}
export function htmlDocument(title: string, html: string): string {
  const safeTitle = sanitizeHtml(title, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'"><title>${safeTitle}</title><style>body{max-width:800px;margin:48px auto;padding:0 24px;font:16px/1.9 system-ui;color:#24342e}img{max-width:100%}pre{overflow:auto;background:#f4f6f5;padding:20px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}blockquote{border-left:3px solid #8bbdaa;padding-left:20px}</style><body><h1>${safeTitle}</h1>${html}</body></html>`;
}
