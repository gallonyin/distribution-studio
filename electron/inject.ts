import type { PlatformId } from "../src/domain";
export type FillRequest = {
  taskId?: string;
  runId?: string;
  deadline?: number;
  mode: "probe" | "inspect" | "fill";
  platform: PlatformId;
  title: string;
  html: string;
  text: string;
  markdown: string;
  images: { src: string; name: string }[];
};
export type FillResult = {
  titleFound: boolean;
  bodyFound: boolean;
  titleFilled: boolean;
  bodyFilled: boolean;
  imagesSubmitted: number;
  conflict: boolean;
  message: string;
  notice?: string;
  blocked?: boolean;
};
const titleSelectors: Record<string, string[]> = {
  wechat: ["#title", 'textarea[name="title"]', 'input[name="title"]'],
  zhihu: ["textarea.WriteIndex-titleInput", 'textarea[placeholder*="标题"]'],
  csdn: ["#txtTitle", 'input[placeholder*="标题"]'],
  xiaohongshu: ['input[placeholder*="标题"]'],
  baijiahao: [
    '[data-lexical-editor="true"][contenteditable="true"]',
    "#title",
    'textarea[placeholder*="标题"]',
  ],
  sohu: ['input[placeholder*="标题"]'],
  toutiao: ['textarea[placeholder*="标题"]'],
  netease: ['input[placeholder*="标题"]'],
  bilibili: [
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    '.title-input[contenteditable="true"]',
  ],
  jianshu: ["input._24i7u", 'input[placeholder*="标题"]'],
};
const bodySelectors: Record<string, string[]> = {
  wechat: [
    '.ProseMirror[contenteditable="true"]',
    '#ueditor_0[contenteditable="true"]',
    '.edui-body-container[contenteditable="true"]',
    '[contenteditable="true"][data-placeholder*="正文"]',
  ],
  zhihu: [
    '.public-DraftEditor-content[contenteditable="true"]',
    '.public-DraftEditor-content [contenteditable="true"]',
    '.DraftEditor-editorContainer [contenteditable="true"]',
  ],
  csdn: [
    ".markdown-editor .CodeMirror",
    ".CodeMirror",
    '.ProseMirror[contenteditable="true"]',
  ],
  xiaohongshu: [
    '.tiptap[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
  ],
  baijiahao: ['.ProseMirror[contenteditable="true"]', ".edui-body-container"],
  sohu: ['.ql-editor[contenteditable="true"]'],
  toutiao: ['.ProseMirror[contenteditable="true"]'],
  netease: ['.ql-editor[contenteditable="true"]', ".edui-body-container"],
  bilibili: [
    '.ql-editor[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    '.tiptap[contenteditable="true"]',
    '.editor-content[contenteditable="true"]',
    ".edui-body-container",
  ],
  jianshu: [
    "#arthur-editor",
    "textarea#content",
    '.kalamu-area[contenteditable="true"]',
  ],
};
const titleFallback = [
  'input[placeholder*="标题"]',
  'textarea[placeholder*="标题"]',
  '[contenteditable="true"][data-placeholder*="标题"]',
  'input[aria-label*="标题"]',
];
const bodyFallback = [
  '.ProseMirror[contenteditable="true"]',
  '.ql-editor[contenteditable="true"]',
  '[data-slate-editor="true"][contenteditable="true"]',
  '[contenteditable="true"][data-placeholder*="正文"]',
  '[contenteditable="true"][data-placeholder*="内容"]',
  'textarea[placeholder*="正文"]',
  'textarea[placeholder*="内容"]',
  'body[contenteditable="true"]',
];
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
function roots(): ParentNode[] {
  const out: ParentNode[] = [document];
  for (let i = 0; i < out.length; i++)
    for (const e of out[i].querySelectorAll("*"))
      if (e.shadowRoot) out.push(e.shadowRoot);
  return out;
}
function visible(e: Element) {
  const h = e as HTMLElement;
  return (
    h.getBoundingClientRect().height > 0 &&
    getComputedStyle(h).visibility !== "hidden" &&
    !h.hasAttribute("disabled")
  );
}
function find(
  selectors: string[],
  accept: (e: HTMLElement) => boolean = () => true,
): HTMLElement | null {
  for (const selector of selectors)
    for (const root of roots())
      for (const e of root.querySelectorAll(selector))
        if (visible(e) && accept(e as HTMLElement)) return e as HTMLElement;
  return null;
}
function read(e: HTMLElement): string {
  // WeChat renders its empty-body hint inside the editable document.
  const hint = '.editor_content_placeholder[contenteditable="false"]';
  if (e.querySelector(hint)) {
    const content = e.cloneNode(true) as HTMLElement;
    content.querySelectorAll(hint).forEach((node) => node.remove());
    return content.textContent ?? "";
  }
  return "value" in e
    ? String(e.value ?? "")
    : (e.innerText ?? e.textContent ?? "");
}
function normalize(s: string) {
  return s.replace(/\s/g, "").replace(/\u200b/g, "");
}
const wechatRiskText =
  "当前使用的浏览器插件存在安全隐患，可能影响编辑器功能的正常使用，请禁用插件并联系插件开发者处理。";
async function dismissWechatRisk(
  runId: string,
  check: () => void,
): Promise<{ notice?: string; blocked?: boolean }> {
  const dialogs = roots()
    .flatMap((root) => [
      ...root.querySelectorAll<HTMLElement>(
        '[role="dialog"], .weui-desktop-dialog, .weui-dialog, .dialog_wrp',
      ),
    ])
    .filter(
      (dialog) =>
        visible(dialog) &&
        !dialog.closest('[contenteditable="true"]') &&
        [...dialog.querySelectorAll("p,div,span")].some(
          (node) =>
            normalize(node.textContent ?? "") === normalize(wechatRiskText),
        ),
    );
  const dialog = dialogs.find(
    (candidate) =>
      !dialogs.some(
        (other) => other !== candidate && candidate.contains(other),
      ),
  );
  if (!dialog) return {};
  const prefix = `公众号提示：${wechatRiskText}`;
  const attempts: Set<string> = ((window as any).__studioWechatRiskAttempts ??=
    new Set<string>());
  if (attempts.has(runId))
    return { blocked: true, notice: `${prefix} 提示再次出现，请人工检查。` };
  const buttons = [
    ...dialog.querySelectorAll<HTMLElement>('button,a,[role="button"]'),
  ].filter(
    (button) =>
      visible(button) &&
      button.getAttribute("aria-disabled") !== "true" &&
      normalize(button.textContent ?? "") === "我知道了",
  );
  if (buttons.length !== 1)
    return {
      blocked: true,
      notice: `${prefix} 未能定位唯一的“我知道了”按钮，请人工处理。`,
    };
  check();
  attempts.add(runId);
  if (attempts.size > 100) attempts.delete(attempts.values().next().value!);
  buttons[0].click();
  for (let i = 0; i < 5; i++) {
    await delay(100);
    check();
    if (!dialog.isConnected || !visible(dialog))
      return {
        notice: `${prefix} 已点击“我知道了”并确认弹窗已关闭；关闭不代表风险已消除。`,
      };
  }
  return { blocked: true, notice: `${prefix} 未能关闭弹窗，请人工处理。` };
}
function events(e: HTMLElement) {
  e.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText" }),
  );
  e.dispatchEvent(new Event("change", { bubbles: true }));
}
function select(e: HTMLElement) {
  e.focus();
  const r = document.createRange();
  r.selectNodeContents(e);
  const hint = e.querySelector(
    ':scope > .editor_content_placeholder[contenteditable="false"]',
  );
  if (hint) r.setStartAfter(hint);
  const s = getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
}
function setControl(e: HTMLElement, value: string) {
  const proto =
    e instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(e, value);
  events(e);
}
async function writeRich(
  e: HTMLElement,
  html: string,
  text: string,
  check: () => void,
  pasteFirst = true,
) {
  check();
  select(e);
  // WeChat's synthetic paste can insert plain text asynchronously and leave
  // its selection collapsed, causing a subsequent HTML fallback to append.
  if (!pasteFirst) {
    document.execCommand("insertHTML", false, html);
    events(e);
    await delay(500);
    check();
    return;
  }
  const transfer = new DataTransfer();
  transfer.setData("text/html", html);
  transfer.setData("text/plain", text);
  e.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    }),
  );
  await delay(150);
  check();
  if (normalize(read(e)) === normalize(text)) return;
  // A partially accepted paste must not be appended a second time.
  select(e);
  document.execCommand("insertHTML", false, html);
  events(e);
  await delay(350);
  check();
}
function modelEditor(): {
  get: () => string;
  set: (s: string) => void;
  markdown: boolean;
} | null {
  const w = window as any;
  const cm = (document.querySelector(".CodeMirror") as any)?.CodeMirror;
  if (cm)
    return {
      get: () => cm.getValue(),
      set: (s) => cm.setValue(s),
      markdown: true,
    };
  const tiny = w.tinymce?.activeEditor;
  if (tiny && !tiny.isHidden())
    return {
      get: () => tiny.getContent({ format: "text" }),
      set: (s) => tiny.setContent(s),
      markdown: false,
    };
  const ue = Object.values(w.UE_V2?.instants ?? w.UE?.instants ?? {}).find(
    (v: any) => v.isReady && (v.body || v.document),
  ) as any;
  if (ue)
    return {
      get: () => ue.getContentTxt(),
      set: (s) => ue.setContent(s),
      markdown: false,
    };
  return null;
}
export async function run(request: FillRequest): Promise<FillResult> {
  const check = () => {
    if (
      (request.deadline && Date.now() >= request.deadline) ||
      (request.runId &&
        (window as any).__studioCancelledRuns?.has(request.runId))
    )
      throw Error("本次填充已停止或超时。");
  };
  check();
  const out: FillResult = {
    titleFound: false,
    bodyFound: false,
    titleFilled: false,
    bodyFilled: false,
    imagesSubmitted: 0,
    conflict: false,
    message: "",
  };
  const handleNotice = async () => {
    if (request.platform !== "wechat" || !request.runId) return;
    const notice = await dismissWechatRisk(request.runId, check);
    if (notice.notice) Object.assign(out, notice);
  };
  await handleNotice();
  if (out.blocked) return out;
  const title = find([
    ...(titleSelectors[request.platform] ?? []),
    ...titleFallback,
  ]);
  const model = modelEditor();
  let body = find(
    [...(bodySelectors[request.platform] ?? []), ...bodyFallback],
    (candidate) =>
      candidate !== title &&
      !candidate.contains(title) &&
      !/标题|摘要|简介|summary|description/i.test(
        [
          candidate.id,
          candidate.getAttribute("placeholder"),
          candidate.getAttribute("data-placeholder"),
        ].join(" "),
      ),
  );
  if (!body && document.designMode.toLowerCase() === "on") body = document.body;
  if (body === title) body = null;
  if (
    body &&
    /摘要|简介|summary|description/i.test(
      [
        body.id,
        body.getAttribute("placeholder"),
        body.getAttribute("data-placeholder"),
      ].join(" "),
    )
  )
    body = null;
  out.titleFound = !!title;
  out.bodyFound = !!body || !!model;
  if (request.mode === "probe") return out;
  if (request.mode === "inspect") {
    const currentTitle = title ? normalize(read(title)) : "";
    const currentBody = model
      ? normalize(model.get())
      : body
        ? normalize(read(body))
        : "";
    const expectedBody = normalize(
      model?.markdown || body instanceof HTMLTextAreaElement
        ? request.markdown
        : request.text,
    );
    if (currentTitle && currentTitle !== normalize(request.title)) {
      out.conflict = true;
      out.message = "标题栏已有其他内容，未覆盖。";
    } else if (currentBody && currentBody !== expectedBody) {
      out.conflict = true;
      out.message = "正文编辑器已有其他内容，未覆盖。";
    }
    return out;
  }
  if (title) {
    check();
    const current = normalize(read(title)),
      expected = normalize(request.title);
    if (current && current !== expected) {
      out.conflict = true;
      out.message = "标题栏已有其他内容，未覆盖。";
    } else {
      if ("value" in title) setControl(title, request.title);
      else {
        select(title);
        document.execCommand("insertText", false, request.title);
        events(title);
      }
      await delay(100);
      check();
      out.titleFilled = normalize(read(title)) === expected;
    }
  }
  if (out.conflict) return out;
  if (model || body) {
    check();
    const expected = model?.markdown
      ? request.markdown
      : body instanceof HTMLTextAreaElement
        ? request.markdown
        : request.text;
    const current = model ? model.get() : read(body!);
    if (normalize(current) && normalize(current) !== normalize(expected)) {
      out.conflict = true;
      out.message = "正文编辑器已有其他内容，未覆盖。";
      return out;
    }
    if (model) {
      model.set(model.markdown ? request.markdown : request.html);
      await delay(350);
      check();
      out.bodyFilled = normalize(model.get()) === normalize(expected);
    } else if (body instanceof HTMLTextAreaElement) {
      setControl(body, request.markdown);
      out.bodyFilled = normalize(read(body)) === normalize(expected);
    } else if (
      body?.isContentEditable ||
      document.designMode.toLowerCase() === "on"
    ) {
      if (normalize(current) !== normalize(expected))
        await writeRich(
          body!,
          request.html,
          request.text,
          check,
          request.platform !== "wechat",
        );
      out.bodyFilled = normalize(read(body!)) === normalize(expected);
    }
  }
  const uploads: Set<string> = ((window as any).__studioImageSubmissions ??=
    new Set<string>());
  check();
  if (
    (!request.taskId || !uploads.has(request.taskId)) &&
    request.platform === "xiaohongshu" &&
    request.images.length &&
    out.bodyFilled
  ) {
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept*="image"]',
    );
    if (input) {
      const dt = new DataTransfer();
      for (const [i, img] of request.images.entries()) {
        if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(img.src)) continue;
        const blob = await (await fetch(img.src)).blob();
        check();
        dt.items.add(
          new File([blob], `${img.name}-${i}.${blob.type.split("/")[1]}`, {
            type: blob.type,
          }),
        );
      }
      if (dt.files.length) {
        check();
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        out.imagesSubmitted = dt.files.length;
        if (request.taskId) uploads.add(request.taskId);
      }
    }
  }
  if (request.platform === "wechat" && request.runId && out.bodyFilled) {
    const until = Date.now() + 2000;
    do {
      await handleNotice();
      if (out.blocked) break;
      await delay(100);
      check();
    } while (Date.now() < until);
  }
  out.message = out.conflict
    ? out.message
    : "编辑器内容已回读检查；平台保存、图片转存和正式发布仍需人工确认。";
  return out;
}
