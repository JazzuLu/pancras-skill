// gemini-ask.mjs — v0.3.0 (2026-11-23)
// Fixed flow: ask or continue a Gemini web conversation in the local Mac Ego browser.
// Incorporates live Gemini pitfalls from ego-gemini-assist & ego-browser guide v2.2.1:
//   - NEVER page.click() or page.fill() on .ql-editor (hangs page/taskSpace)
//   - NEVER execCommand("insertText") for long text
//   - Focus .ql-editor via page.evaluate() with explicit Range, paste via keyboard.paste(),
//     poll until paste settles, verify head/tail in innerText (&nbsp; normalized)
//   - Send via scoped Send message button, confirm send started, wait until typing/stop
//     indicators clear and the latest model-response turn stabilizes (live DOM, no cloneNode)
//   - Soft-handle page.goto() 15s timeout ONLY when landed on the intended /app or /gem target
//   - Support sessionFile (1:1 article-to-conversation binding, two-phase atomic persistence,
//     anti-resend lock), newChat (inherits /u/<n> account prefix), startUrl (/app or /gem),
//     contextFiles (new-chat injection + SHA-256 change detection + double-injection guard),
//     and maxPromptChars guard
//   - Check login wall & optional expectedAccount (never log emails or raw snapshots to stdout)
//   - Support extract-only mode (empty prompt + empty promptFile) without reloading the page
//   - Respect ego-browser finish() semantics (invalidated page labels return page: null)

// ===================== DEFAULT_INPUT (for direct heredoc use) =====================
const DEFAULT_INPUT = {
  prompt: "",              // exact prompt text (leave empty + set promptFile for long text)
  promptFile: "",          // absolute path of a file holding the prompt
  sessionFile: "",         // optional absolute path to gemini-session.json (1:1 conversation binding)
  convUrl: "",             // explicit Gemini /app or /gem conversation URL (mutually exclusive with sessionFile)
  startUrl: "",            // optional new-chat entry URL (default /app or /u/<n>/app; supports /gem/<id>)
  newChat: false,          // true = start a fresh conversation (archives old sessionFile.convUrl into previousUrls)
  forceSend: false,        // true = override pending_response anti-resend lock on sessionFile
  contextFiles: [],        // optional array of absolute file paths injected on new chat first turn
  onContextChange: "warn", // "warn" | "reinject" | "error" when contextFiles hash changes on follow-up turn
  maxPromptChars: 30000,   // safety cap to prevent Gemini auto-converting huge pastes into attachments
  spaceId: null,           // integer spaceId from previous run (auto-read from sessionFile when set)
  spaceName: "gemini-web",
  expectedAccount: "",     // optional account substring to verify (never logged)
  outFile: "",             // required absolute path: response text is written here
  finish: true,            // true = task.finish({ keep: [label] }); false = keep space active in reply
};
// ==================================================================================

const INPUT = {
  ...DEFAULT_INPUT,
  ...(globalThis.__GEMINI_INPUT__ || {}),
};

const fs = await import("node:fs/promises");
const path = await import("node:path");
const crypto = await import("node:crypto");

const GEMINI_HOME = "https://gemini.google.com/app";
const EMBEDDED_CORPUS_MARKER = "<!-- CORPUS_CONTEXT_EMBEDDED -->";
const GOTO_TIMEOUT_MS = 15000;
const UI_WAIT_TIMEOUT_MS = 10000;
const UI_POLL_MS = 500;
const SEND_BUTTON_WAIT_MS = 5000;
const SEND_BUTTON_POLL_MS = 250;
const SEND_START_TIMEOUT_MS = 15000;
const PASTE_POLL_MS = 250;
const PASTE_SETTLE_MAX_MS = 4000;
const POLL_MS = 2000;
const MAX_WAIT_MS = 180000;
const SHORT_RESIDUAL_LIMIT = 2000;
const VERIFY_EDGE_CHARS = 24;
const STABLE_POLLS_STRUCTURED = 2;
const STABLE_POLLS_FALLBACK = 4;
const STABLE_POLLS_EXTRACT_ONLY = 2;

// Supported Gemini web paths:
//   Entry pages:        /app, /u/<n>/app, /gem/<gemId>, /u/<n>/gem/<gemId>
//   Conversation pages: /app/<convId>, /u/<n>/app/<convId>, /gem/<gemId>/<convId>, /u/<n>/gem/<gemId>/<convId>
const GEMINI_SUPPORTED_PATH_RE = /^(\/u\/\d+)?\/(app|gem)(\/|$)/;
const GEMINI_APP_HOME_RE = /^(\/u\/\d+)?\/app\/?$/;
const GEMINI_APP_CONV_RE = /^(\/u\/\d+)?\/app\/([^/?#]+)/;
const GEMINI_GEM_ENTRY_RE = /^(\/u\/\d+)?\/gem\/([^/?#]+)\/?$/;
const GEMINI_GEM_CONV_RE = /^(\/u\/\d+)?\/gem\/([^/?#]+)\/([^/?#]+)/;

function out(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function fail(message, extra = {}) {
  const payload = {
    ok: false,
    error: message,
    handOff: Boolean(extra.handOff),
    spaceId: extra.spaceId ?? null,
    page: extra.page ?? null,
    url: extra.url ?? "",
    ...extra,
  };
  out(payload);
  const err = new Error(message);
  err.__reported = true;
  throw err;
}

function redactSensitive(text) {
  return String(text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/Google\s*(Account|账号|帐号|帳戶)\s*[:：][^\n"']*/gi, "Google $1: [REDACTED]");
}

function sha256Short(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex").slice(0, 12);
}

function normalizeSpaceId(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    if (!/^\d+$/.test(trimmed)) {
      fail("INPUT.spaceId must be a non-negative integer or null");
    }
    return Number(trimmed);
  }
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
    return raw;
  }
  fail("INPUT.spaceId must be a non-negative integer or null");
}

function normalizeText(str) {
  return String(str || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
}

function normalizeCompact(str) {
  return normalizeText(str).replace(/\s+/g, " ");
}

function parseUrlSafe(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isGeminiSupportedUrl(url) {
  return Boolean(parseGeminiRoute(url));
}

function isGeminiEntryUrl(url) {
  const r = parseGeminiRoute(url);
  return Boolean(r && r.convId === "");
}

function isGoogleLoginUrl(url) {
  const u = parseUrlSafe(url);
  return Boolean(u && u.hostname === "accounts.google.com");
}

function normalizeAccountPrefix(prefix) {
  if (!prefix || prefix === "/u/0") return "";
  return prefix;
}

function parseGeminiRoute(url) {
  const u = parseUrlSafe(url);
  if (!u || u.hostname !== "gemini.google.com") return null;
  const p = u.pathname;
  let m = p.match(GEMINI_GEM_CONV_RE);
  if (m) return { accountPrefix: normalizeAccountPrefix(m[1]), kind: "gem", gemId: m[2], convId: m[3] };
  m = p.match(GEMINI_GEM_ENTRY_RE);
  if (m) return { accountPrefix: normalizeAccountPrefix(m[1]), kind: "gem", gemId: m[2], convId: "" };
  m = p.match(GEMINI_APP_CONV_RE);
  if (m) return { accountPrefix: normalizeAccountPrefix(m[1]), kind: "app", gemId: "", convId: m[2] };
  m = p.match(GEMINI_APP_HOME_RE);
  if (m) return { accountPrefix: normalizeAccountPrefix(m[1]), kind: "app", gemId: "", convId: "" };
  return null;
}

function extractAccountPrefix(url) {
  const r = parseGeminiRoute(url);
  return r ? r.accountPrefix : "";
}

function normalizeConvKey(url) {
  const r = parseGeminiRoute(url);
  if (r) {
    const base = `https://gemini.google.com${r.accountPrefix}/${r.kind}`;
    if (r.kind === "gem") return r.convId ? `${base}/${r.gemId}/${r.convId}` : `${base}/${r.gemId}`;
    return r.convId ? `${base}/${r.convId}` : base;
  }
  const u = parseUrlSafe(url);
  if (!u) return String(url || "").trim().replace(/\/+$/, "");
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

function sameConversation(currentUrl, targetUrl) {
  if (!currentUrl || !targetUrl) return false;
  return normalizeConvKey(currentUrl) === normalizeConvKey(targetUrl);
}

function matchesTargetNavigation(curUrl, targetUrl) {
  const cur = parseGeminiRoute(curUrl);
  const tgt = parseGeminiRoute(targetUrl);
  if (!cur || !tgt) return false;
  if (cur.accountPrefix !== tgt.accountPrefix) return false;
  if (tgt.kind !== cur.kind) return false;
  if (tgt.kind === "gem" && cur.gemId !== tgt.gemId) return false;
  if (tgt.convId) {
    return cur.convId === tgt.convId;
  }
  // Target is a fresh entry URL (/app or /gem/<id>): must NOT remain on an old conversation ID.
  return cur.convId === "";
}

function buildNewChatEntryUrl(startUrl, fallbackUrlForPrefix) {
  if (startUrl) return startUrl;
  const prefix = extractAccountPrefix(fallbackUrlForPrefix);
  return prefix ? `https://gemini.google.com${prefix}/app` : GEMINI_HOME;
}

async function safePageUrl(page, fallback = "") {
  if (!page) return fallback;
  return await page.url().catch(() => fallback);
}

async function readSessionFile(sessionFilePath) {
  if (!sessionFilePath) return null;
  try {
    const raw = await fs.readFile(sessionFilePath, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      fail("INPUT.sessionFile contains invalid JSON object");
    }
    return data;
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    if (err?.__reported) throw err;
    fail(`failed to read INPUT.sessionFile: ${err?.message || String(err)}`);
  }
}

async function writeSessionFileAtomic(sessionFilePath, sessionData) {
  if (!sessionFilePath) return;
  await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
  const tmpPath = `${sessionFilePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(sessionData, null, 2) + "\n", "utf8");
  await fs.rename(tmpPath, sessionFilePath);
}

async function writeDebugFile(outFile, title, details) {
  if (!outFile) return;
  try {
    await fs.writeFile(
      outFile + ".debug.txt",
      `=== ${title} ===\n${redactSensitive(details)}\n`,
      "utf8",
    );
  } catch {
    // Best-effort debug output; never mask primary error.
  }
}

async function failWithContext(task, page, message, extra = {}) {
  const url = await safePageUrl(page, extra.url || "");
  if (page && extra.captureDebug && INPUT.outFile) {
    const snap = await page.snapshot().catch(() => "");
    await writeDebugFile(
      INPUT.outFile,
      `ERROR: ${message}`,
      `url=${url}\n${JSON.stringify(extra.diagnostics || {}, null, 2)}\n\n=== SNAPSHOT (REDACTED) ===\n${String(snap).slice(0, 8000)}`,
    );
  }
  const { captureDebug, ...safeExtra } = extra;
  fail(message, {
    handOff: Boolean(safeExtra.handOff),
    spaceId: task ? task.spaceId : null,
    page: page ? page.label : null,
    url,
    ...safeExtra,
  });
}

async function handOffAndFail(task, page, message, extra = {}) {
  if (task) {
    try {
      await task.handOff();
    } catch {
      // User may already hold control; preserve the primary error message.
    }
  }
  await failWithContext(task, page, message, { ...extra, handOff: true });
}

async function navigateSoft(page, targetUrl) {
  try {
    await page.goto(targetUrl, { timeout: GOTO_TIMEOUT_MS });
  } catch (err) {
    const curUrl = await safePageUrl(page);
    const ready = await page.evaluate(() => document.readyState).catch(() => "");
    if (
      matchesTargetNavigation(curUrl, targetUrl) &&
      (ready === "interactive" || ready === "complete")
    ) {
      return;
    }
    throw err;
  }
}

async function readGeminiState(page, expectedAccount) {
  return await page.evaluate((acctQuery) => {
    const clean = (s) =>
      String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\r\n/g, "\n")
        .trim();

    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const bodyText = clean(document.body ? document.body.innerText : "");

    const signInSelectors = [
      'a[href*="accounts.google.com/ServiceLogin"]',
      'a[href*="accounts.google.com/v3/signin"]',
      'button[aria-label="Sign in"]',
      'a[aria-label="Sign in"]',
      'button[aria-label="登录"]',
      'a[aria-label="登录"]',
      'button[aria-label="登入"]',
      'a[aria-label="登入"]',
    ];
    const hasSignInControl = signInSelectors.some((sel) => isVisible(document.querySelector(sel)));

    const accountSelectors = [
      'a[aria-label*="Google Account"]',
      'button[aria-label*="Google Account"]',
      'a[aria-label*="Google 账号"]',
      'button[aria-label*="Google 账号"]',
      'a[aria-label*="Google 帐号"]',
      'button[aria-label*="Google 帐号"]',
      'a[aria-label*="Google 帳戶"]',
      'button[aria-label*="Google 帳戶"]',
    ];
    let accountLabel = "";
    for (const sel of accountSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        accountLabel = el.getAttribute("aria-label") || el.getAttribute("title") || "";
        if (accountLabel) break;
      }
    }

    const hasAccountControl = Boolean(accountLabel);
    const expectedAccountMatched = !acctQuery
      ? true
      : hasAccountControl &&
        accountLabel.toLowerCase().includes(String(acctQuery).toLowerCase());

    // Detect typing/busy state using status/live/progress elements — NEVER scan user prompt text
    // or outer feed wrappers that contain user-query / model-response.
    const typingTextRe = /(Gemini is typing|Gemini 正在输入|Gemini 正在輸入|Just a sec)/i;
    const statusNodes = [
      ...document.querySelectorAll(
        '[aria-live], [role="status"], [aria-busy="true"], mat-progress-bar, mat-spinner, .typing-indicator',
      ),
    ];
    const hasTypingIndicator = statusNodes.some((el) => {
      if (el.closest("user-query, .ql-editor")) return false;
      if (el.querySelector("user-query, model-response, .ql-editor")) return false;
      if (el.getAttribute("aria-busy") === "true" && isVisible(el)) return true;
      if ((el.tagName === "MAT-PROGRESS-BAR" || el.tagName === "MAT-SPINNER") && isVisible(el)) {
        return true;
      }
      const txt = clean(el.innerText || el.textContent || "");
      return typingTextRe.test(txt);
    });

    const stopSelectors = [
      'button[aria-label*="Stop response"]',
      'button[aria-label*="Stop generating"]',
      'button[aria-label="Stop"]',
      'button[aria-label*="停止回答"]',
      'button[aria-label*="停止生成"]',
      'button[aria-label*="停止回覆"]',
      'button[aria-label="停止"]',
    ];
    const hasStopButton = stopSelectors.some((sel) =>
      [...document.querySelectorAll(sel)].some((el) => isVisible(el)),
    );

    // Extract model turns directly from live DOM (preserves layout-aware innerText newlines,
    // excludes thoughts/toolbars, and avoids nested selector duplication).
    const THOUGHT_EXCLUDE = 'model-thoughts, thinking-process, [class*="thought"], button, [role="toolbar"]';
    const extractLiveBlocks = (turnEl, selector) => {
      const candidates = [...turnEl.querySelectorAll(selector)].filter(
        (el) => !el.closest(THOUGHT_EXCLUDE) && isVisible(el),
      );
      const topLevel = candidates.filter(
        (el) => !candidates.some((other) => other !== el && other.contains(el)),
      );
      return topLevel
        .map((el) => clean(el.innerText || ""))
        .filter(Boolean)
        .join("\n\n");
    };

    const extractTurnText = (turnEl) => {
      const fromMarkdown = extractLiveBlocks(turnEl, ".markdown");
      if (fromMarkdown) return fromMarkdown;
      const fromMessage = extractLiveBlocks(turnEl, "message-content");
      if (fromMessage) return fromMessage;
      return clean(turnEl.innerText || "");
    };

    let turnNodes = [...document.querySelectorAll("model-response")];
    if (turnNodes.length === 0) {
      turnNodes = [...document.querySelectorAll('[data-message-author-role="model"]')];
    }
    const responses = turnNodes.map(extractTurnText).filter((t) => t.length > 0);

    const editorEl = document.querySelector(".ql-editor");
    const hasEditor = Boolean(editorEl);
    const editorText = editorEl ? clean(editorEl.innerText || "") : "";

    return {
      readyState: document.readyState,
      hasEditor,
      editorText,
      hasSignInControl,
      hasAccountControl,
      expectedAccountMatched,
      isTyping: hasTypingIndicator,
      hasStopButton,
      responseCount: responses.length,
      lastResponse: responses.length > 0 ? responses[responses.length - 1] : "",
      bodyText,
    };
  }, expectedAccount || "");
}

async function openOrResumeSpace(spaceId, requestedName, requireExisting) {
  const existingSpaces = await listTaskSpaces();
  const entry =
    spaceId === null
      ? undefined
      : existingSpaces.find((s) => Number(s.id) === spaceId);

  if (!entry) {
    if (requireExisting && spaceId !== null) {
      fail(`TaskSpace ${spaceId} no longer exists; cannot extract without convUrl`);
    }
    let name = requestedName || "gemini-web";
    const taken = new Set(existingSpaces.map((s) => s.name));
    if (taken.has(name)) {
      name = `${name}-${Date.now().toString(36)}`;
    }
    return { task: await taskSpace(name), mode: "created" };
  }

  if (entry.ownership === "user") {
    return { task: await claimTaskSpace(spaceId), mode: "claimed" };
  }
  if (entry.ownership === "agentDelegatedToUser") {
    return { task: await takeOverTaskSpace(spaceId), mode: "takenOver" };
  }
  return { task: await taskSpace(spaceId), mode: "resumed" };
}

async function resolvePage(task, targetUrl, spaceMode) {
  // After takeOverTaskSpace, prioritize task.userPage() per ego-browser guide v2.2.1.
  if (spaceMode === "takenOver" && typeof task.userPage === "function") {
    const uPage = task.userPage();
    if (uPage) {
      const uUrl = await safePageUrl(uPage);
      if (isGeminiSupportedUrl(uUrl) || !targetUrl) {
        return uPage.label ? task.page(uPage.label) : await task.adopt(uPage);
      }
    }
  }

  const managed = await task.pages();
  if (managed.length > 0) {
    if (targetUrl) {
      for (const p of managed) {
        const u = await safePageUrl(p);
        if (sameConversation(u, targetUrl)) return p;
      }
    }
    for (const p of managed) {
      const u = await safePageUrl(p);
      if (isGeminiSupportedUrl(u)) return p;
    }
    return managed[0];
  }

  const tabs = await task.tabs();
  if (tabs.length === 0) {
    return await task.newPage();
  }

  const chosen =
    (targetUrl && tabs.find((t) => sameConversation(t.url, targetUrl))) ||
    tabs.find((t) => isGeminiSupportedUrl(t.url) && t.active) ||
    tabs.find((t) => isGeminiSupportedUrl(t.url)) ||
    tabs.find((t) => t.active) ||
    tabs[0];

  return chosen.label ? task.page(chosen.label) : await task.adopt(chosen.page);
}

async function loadContextFiles(filePaths) {
  if (!Array.isArray(filePaths)) {
    fail("INPUT.contextFiles must be an array of absolute paths");
  }
  const items = [];
  for (const fp of filePaths) {
    if (typeof fp !== "string" || !path.isAbsolute(fp)) {
      fail(`every entry in INPUT.contextFiles must be an absolute path: ${String(fp)}`);
    }
    const content = normalizeText(await fs.readFile(fp, "utf8"));
    if (!content) {
      fail(`contextFile is empty: ${fp}`);
    }
    items.push({
      path: fp,
      name: path.basename(fp),
      content,
      hash: sha256Short(content),
    });
  }
  return items;
}

function buildContextHashesMap(contextItems) {
  const map = {};
  for (const item of contextItems) {
    map[item.path] = item.hash;
  }
  return map;
}

function assemblePromptWithContext(prompt, items, isIncrementalUpdate) {
  if (items.length === 0) return prompt;
  const header = isIncrementalUpdate
    ? "【规则增量更新：以下背景文件已更新，请以最新版为准覆盖前文对应规则】"
    : "【以下为本次对话的背景参考与写作规范，请严格遵守】";
  const blocks = items.map(
    (item) => `--- ${item.name} (sha256:${item.hash}) ---\n${item.content}`,
  );
  return `${header}\n\n${blocks.join("\n\n")}\n\n--- 本次任务 ---\n${prompt}`;
}

async function validateAndResolvePlan() {
  if (!INPUT.outFile || !path.isAbsolute(INPUT.outFile)) {
    fail("INPUT.outFile is required and must be an absolute path");
  }
  if (INPUT.promptFile && !path.isAbsolute(INPUT.promptFile)) {
    fail("INPUT.promptFile must be an absolute path");
  }
  if (INPUT.sessionFile && !path.isAbsolute(INPUT.sessionFile)) {
    fail("INPUT.sessionFile must be an absolute path");
  }
  if (INPUT.convUrl && !isGeminiSupportedUrl(INPUT.convUrl)) {
    fail("INPUT.convUrl must be a https://gemini.google.com/app... or /gem/... URL");
  }
  if (INPUT.startUrl && !isGeminiEntryUrl(INPUT.startUrl)) {
    fail("INPUT.startUrl must be a Gemini entry URL (/app, /u/<n>/app, /gem/<id>, or /u/<n>/gem/<id>)");
  }
  if (typeof INPUT.finish !== "boolean") {
    fail("INPUT.finish must be a boolean");
  }
  if (typeof INPUT.newChat !== "boolean") {
    fail("INPUT.newChat must be a boolean");
  }
  if (typeof INPUT.forceSend !== "boolean") {
    fail("INPUT.forceSend must be a boolean");
  }
  if (!["warn", "reinject", "error"].includes(INPUT.onContextChange)) {
    fail('INPUT.onContextChange must be "warn", "reinject", or "error"');
  }
  if (!Number.isFinite(INPUT.maxPromptChars) || INPUT.maxPromptChars <= 0) {
    fail("INPUT.maxPromptChars must be a finite positive number");
  }

  const explicitSpaceId = normalizeSpaceId(INPUT.spaceId);
  const inlinePrompt = normalizeText(INPUT.prompt);
  const promptFilePath = String(INPUT.promptFile || "").trim();

  if (inlinePrompt && promptFilePath) {
    fail("provide either INPUT.prompt or INPUT.promptFile, not both");
  }

  let basePrompt = inlinePrompt;
  let rawPromptFileText = "";
  if (!basePrompt && promptFilePath) {
    rawPromptFileText = await fs.readFile(promptFilePath, "utf8");
    basePrompt = normalizeText(rawPromptFileText);
    if (!basePrompt) {
      fail("INPUT.promptFile is empty");
    }
  }

  const isExtractOnly = basePrompt.length === 0;
  if (INPUT.newChat && isExtractOnly) {
    fail("INPUT.newChat=true cannot be combined with extract-only mode (empty prompt)");
  }
  if (INPUT.startUrl && isExtractOnly) {
    fail("INPUT.startUrl cannot be combined with extract-only mode (empty prompt)");
  }
  if (INPUT.startUrl && INPUT.convUrl) {
    fail("INPUT.startUrl cannot be combined with INPUT.convUrl");
  }

  const sessionFilePath = String(INPUT.sessionFile || "").trim();
  const existingSession = await readSessionFile(sessionFilePath);

  if (sessionFilePath && INPUT.convUrl) {
    fail("INPUT.sessionFile and INPUT.convUrl are mutually exclusive; let sessionFile manage convUrl or omit sessionFile");
  }

  // Enforce anti-resend lock when previous turn is still pending_response.
  if (
    !isExtractOnly &&
    !INPUT.newChat &&
    !INPUT.forceSend &&
    existingSession?.status === "pending_response"
  ) {
    fail(
      "sessionFile is in pending_response state; run extract-only (empty prompt) first to retrieve the previous answer, or set forceSend:true",
      { spaceId: existingSession.spaceId ?? null, url: existingSession.convUrl || "" },
    );
  }

  const existingHasConv = Boolean(parseGeminiRoute(existingSession?.convUrl)?.convId);
  const hasExistingSessionForReuse = Boolean(existingSession && !INPUT.newChat && (existingHasConv || existingSession.status === "pending_response"));
  if (hasExistingSessionForReuse && INPUT.startUrl) {
    fail("INPUT.startUrl is only valid when starting a new conversation (no existing sessionFile or newChat:true)");
  }
  if (!sessionFilePath && INPUT.startUrl && !INPUT.newChat) {
    fail("when INPUT.sessionFile is omitted, INPUT.startUrl requires INPUT.newChat=true");
  }

  const startingFreshChat = isExtractOnly
    ? false
    : sessionFilePath
      ? !hasExistingSessionForReuse
      : Boolean(INPUT.newChat);

  // Eliminate convUrl="" ambiguity when no sessionFile is given in ask mode.
  if (!sessionFilePath && !isExtractOnly && !INPUT.convUrl && !startingFreshChat) {
    fail(
      "when INPUT.sessionFile is omitted in ask mode, pass either INPUT.convUrl (continue) or INPUT.newChat:true (new conversation)",
    );
  }

  // Context files & double-injection guard.
  const contextItems = await loadContextFiles(INPUT.contextFiles || []);
  if (
    contextItems.length > 0 &&
    (rawPromptFileText.includes(EMBEDDED_CORPUS_MARKER) || basePrompt.includes(EMBEDDED_CORPUS_MARKER))
  ) {
    fail(
      "prompt already contains embedded corpus marker (<!-- CORPUS_CONTEXT_EMBEDDED -->); do not also pass INPUT.contextFiles to avoid double injection",
    );
  }
  if (!isExtractOnly && !startingFreshChat && !sessionFilePath && contextItems.length > 0) {
    fail(
      "passing INPUT.contextFiles on a follow-up turn requires INPUT.sessionFile so prior contextHashes can be compared; omit contextFiles or provide sessionFile",
    );
  }

  let finalPrompt = basePrompt;
  let contextChanged = false;
  let changedContextFiles = [];
  let effectiveContextHashes = existingSession?.contextHashes || {};

  if (!isExtractOnly && contextItems.length > 0) {
    const newHashes = buildContextHashesMap(contextItems);
    if (startingFreshChat) {
      finalPrompt = assemblePromptWithContext(basePrompt, contextItems, false);
      effectiveContextHashes = newHashes;
    } else {
      const prevHashes = existingSession?.contextHashes || {};
      const changedItems = contextItems.filter((item) => prevHashes[item.path] !== item.hash);
      if (changedItems.length > 0) {
        contextChanged = true;
        changedContextFiles = changedItems.map((i) => i.path);
        if (INPUT.onContextChange === "error") {
          fail("contextFiles changed since conversation started (onContextChange=error)", {
            changedFiles: changedContextFiles,
            spaceId: existingSession?.spaceId ?? null,
            url: existingSession?.convUrl || "",
          });
        } else if (INPUT.onContextChange === "reinject") {
          finalPrompt = assemblePromptWithContext(basePrompt, changedItems, true);
          effectiveContextHashes = { ...prevHashes, ...newHashes };
        }
      }
    }
  }

  if (!isExtractOnly && finalPrompt.length > INPUT.maxPromptChars) {
    fail(
      `assembled prompt length (${finalPrompt.length}) exceeds maxPromptChars (${INPUT.maxPromptChars}); trim context or use summary mode for reference articles`,
      { promptLength: finalPrompt.length, maxPromptChars: INPUT.maxPromptChars },
    );
  }

  const effectiveSpaceId =
    explicitSpaceId !== null
      ? explicitSpaceId
      : normalizeSpaceId(existingSession?.spaceId ?? null);

  // Only treat existingSession.convUrl as a navigation target if it has an actual convId
  // (avoid navigating back to blank /app during extract-only recovery!).
  const targetConvUrl = startingFreshChat
    ? ""
    : INPUT.convUrl || (existingHasConv ? existingSession.convUrl : "");

  const previousUrls = Array.isArray(existingSession?.previousUrls)
    ? [...existingSession.previousUrls]
    : [];
  if (
    INPUT.newChat &&
    existingHasConv &&
    !previousUrls.includes(existingSession.convUrl)
  ) {
    previousUrls.push(existingSession.convUrl);
  }

  return {
    prompt: finalPrompt,
    isExtractOnly,
    sessionFilePath,
    existingSession,
    startingFreshChat,
    spaceId: effectiveSpaceId,
    targetConvUrl,
    startUrl: INPUT.startUrl || "",
    previousUrls,
    contextChanged,
    changedContextFiles,
    effectiveContextHashes,
  };
}

async function waitForUiAndVerifyAuth(task, page, expectedAccount) {
  const currentUrl = await safePageUrl(page);
  if (isGoogleLoginUrl(currentUrl) || !isGeminiSupportedUrl(currentUrl)) {
    await handOffAndFail(
      task,
      page,
      "redirected away from Gemini (/app or /gem); handed off to user",
    );
  }

  let state = await readGeminiState(page, expectedAccount);
  const waitStart = Date.now();
  while (Date.now() - waitStart < UI_WAIT_TIMEOUT_MS) {
    const editorReady = state.hasEditor || state.hasSignInControl;
    const accountReady = !expectedAccount || state.hasAccountControl || state.hasSignInControl;
    if (editorReady && accountReady) break;
    await page.waitForTimeout(UI_POLL_MS);
    state = await readGeminiState(page, expectedAccount);
  }

  if (state.hasSignInControl && !state.hasAccountControl) {
    await handOffAndFail(task, page, "Gemini is not signed in; handed off to user");
  }
  if (expectedAccount && !state.expectedAccountMatched) {
    await handOffAndFail(
      task,
      page,
      "logged-in Google account does not match expectedAccount; handed off to user",
    );
  }
  return state;
}

async function waitForPasteSettled(page, expectedLen) {
  const start = Date.now();
  let prevLen = -1;
  let stable = 0;
  let latestRaw = "";
  while (Date.now() - start < PASTE_SETTLE_MAX_MS) {
    await page.waitForTimeout(PASTE_POLL_MS);
    latestRaw = await page.evaluate(() => {
      const el = document.querySelector(".ql-editor");
      return el ? el.innerText || "" : "";
    });
    const curLen = normalizeCompact(latestRaw).length;
    if (curLen >= expectedLen && curLen === prevLen) {
      stable += 1;
      if (stable >= 1) return latestRaw;
    } else if (curLen > 0 && curLen === prevLen) {
      stable += 1;
      if (stable >= 2) return latestRaw;
    } else {
      prevLen = curLen;
      stable = 0;
    }
  }
  return latestRaw;
}

async function pasteAndSend(task, page, prompt, preSendState) {
  if (!preSendState.hasEditor) {
    await failWithContext(task, page, "Gemini prompt editor (.ql-editor) not found on page", {
      captureDebug: true,
      diagnostics: { readyState: preSendState.readyState, hasEditor: false },
    });
  }

  // Focus .ql-editor via page.evaluate() with explicit Range (NEVER page.click/page.fill).
  const focusResult = await page.evaluate((shortLimit) => {
    const el = document.querySelector(".ql-editor");
    if (!el) return { ok: false, reason: "missing" };
    el.focus();
    const existing = (el.innerText || "").replace(/\u00a0/g, " ").trim();
    if (existing.length > shortLimit) {
      return { ok: false, reason: "long_residual", length: existing.length };
    }
    if (existing.length > 0) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("delete", false, null);
    }
    return { ok: true };
  }, SHORT_RESIDUAL_LIMIT);

  if (!focusResult.ok) {
    if (focusResult.reason === "long_residual") {
      await handOffAndFail(
        task,
        page,
        "long residual text found in .ql-editor; handed off to user to clear safely",
        { residualLength: focusResult.length },
      );
    }
    await failWithContext(task, page, `cannot prepare .ql-editor (${focusResult.reason})`);
  }

  await page.keyboard.paste(prompt);
  const expectedCompact = normalizeCompact(prompt);
  const pastedRaw = await waitForPasteSettled(page, expectedCompact.length);

  // Verify head & tail in .ql-editor innerText (&nbsp; normalized).
  const pastedCompact = normalizeCompact(pastedRaw);
  const checkLen = Math.min(VERIFY_EDGE_CHARS, expectedCompact.length);
  const headOk = pastedCompact.startsWith(expectedCompact.slice(0, checkLen));
  const tailOk = pastedCompact.endsWith(expectedCompact.slice(-checkLen));

  if (!pastedCompact || !headOk || !tailOk) {
    await failWithContext(
      task,
      page,
      "pasted prompt verification failed in .ql-editor (head/tail mismatch); clear editor before retrying",
      {
        expectedLength: expectedCompact.length,
        pastedLength: pastedCompact.length,
        headOk,
        tailOk,
      },
    );
  }

  // Click Send button scoped near .ql-editor first (never match broad "发送反馈").
  let sent = false;
  const sendWaitStart = Date.now();
  while (Date.now() - sendWaitStart < SEND_BUTTON_WAIT_MS) {
    const clickResult = await page.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const exactSelectors = [
        'button[aria-label="Send message"]',
        'button[aria-label="发送消息"]',
        'button[aria-label="傳送訊息"]',
        'button[aria-label="Submit"]',
      ];
      const editor = document.querySelector(".ql-editor");
      const scope =
        editor?.closest("input-area-v2, form, [class*='input-area']") || document;
      const scopes = scope === document ? [document] : [scope, document];

      for (const root of scopes) {
        for (const sel of exactSelectors) {
          const btn = root.querySelector(sel);
          if (!btn || !isVisible(btn)) continue;
          const disabled = btn.disabled || btn.getAttribute("aria-disabled") === "true";
          if (!disabled) {
            btn.click();
            return { clicked: true, selector: sel };
          }
        }
      }
      return { clicked: false };
    });
    if (clickResult.clicked) {
      sent = true;
      break;
    }
    await page.waitForTimeout(SEND_BUTTON_POLL_MS);
  }

  if (!sent) {
    await failWithContext(
      task,
      page,
      'Send button (aria-label="Send message") not found or stayed disabled',
      { captureDebug: true },
    );
  }

  // Confirm send actually took effect before sampling post-send baseline.
  const confirmStart = Date.now();
  while (Date.now() - confirmStart < SEND_START_TIMEOUT_MS) {
    const state = await readGeminiState(page, INPUT.expectedAccount);
    const editorCleared = state.editorText.length === 0;
    const busy = state.isTyping || state.hasStopButton;
    const structuredStarted =
      state.responseCount > preSendState.responseCount ||
      (state.responseCount > 0 && state.lastResponse !== preSendState.lastResponse);
    if (editorCleared || busy || structuredStarted) {
      return state;
    }
    await page.waitForTimeout(UI_POLL_MS);
  }

  await failWithContext(
    task,
    page,
    "prompt send did not clear editor or start Gemini response within 15s",
    { captureDebug: true },
  );
}

async function waitForAnswer(
  task,
  page,
  isExtractOnly,
  preSendState,
  postSendState,
  initialUrl,
  onUrlChange,
) {
  let latest = postSendState;
  const waitStart = Date.now();
  let sawBusy = latest.isTyping || latest.hasStopButton;
  let prevSample = "";
  let stableHits = 0;
  let lastObservedUrl = initialUrl || "";

  while (Date.now() - waitStart < MAX_WAIT_MS) {
    const curUrl = await safePageUrl(page);
    if (curUrl && curUrl !== lastObservedUrl && parseGeminiRoute(curUrl)?.convId) {
      lastObservedUrl = curUrl;
      if (onUrlChange) await onUrlChange(curUrl);
    }

    const busy = latest.isTyping || latest.hasStopButton;
    const hasStructured = latest.responseCount > 0;
    const structuredAdvanced =
      latest.responseCount > preSendState.responseCount ||
      (hasStructured &&
        latest.lastResponse.length > 0 &&
        latest.lastResponse !== preSendState.lastResponse);

    if (busy) {
      sawBusy = true;
      stableHits = 0;
      prevSample = hasStructured ? latest.lastResponse : latest.bodyText;
    } else if (isExtractOnly) {
      const sample = hasStructured ? latest.lastResponse : latest.bodyText;
      if (hasStructured && sample && sample === prevSample) {
        stableHits += 1;
        if (stableHits >= STABLE_POLLS_EXTRACT_ONLY) {
          return { completed: true, latest };
        }
      } else if (!hasStructured) {
        if (isGeminiEntryUrl(curUrl)) {
          return { completed: true, latest, emptyHome: true };
        }
        if (sample && sample === prevSample) {
          stableHits += 1;
          if (stableHits >= STABLE_POLLS_FALLBACK) {
            return { completed: true, latest };
          }
        } else {
          prevSample = sample;
          stableHits = 0;
        }
      } else {
        prevSample = sample;
        stableHits = 0;
      }
    } else {
      if (hasStructured && structuredAdvanced) {
        if (latest.lastResponse === prevSample) {
          stableHits += 1;
          const threshold = sawBusy ? STABLE_POLLS_STRUCTURED : STABLE_POLLS_STRUCTURED + 1;
          if (stableHits >= threshold) {
            return { completed: true, latest };
          }
        } else {
          prevSample = latest.lastResponse;
          stableHits = 0;
        }
      } else if (
        !hasStructured &&
        sawBusy &&
        latest.bodyText !== postSendState.bodyText &&
        latest.bodyText.length > 0
      ) {
        if (latest.bodyText === prevSample) {
          stableHits += 1;
          if (stableHits >= STABLE_POLLS_FALLBACK) {
            return { completed: true, latest };
          }
        } else {
          prevSample = latest.bodyText;
          stableHits = 0;
        }
      }
    }

    await page.waitForTimeout(POLL_MS);
    latest = await readGeminiState(page, INPUT.expectedAccount);
  }

  return { completed: false, latest };
}

let task = null;
let page = null;

try {
  // 1. Validate all inputs & resolve session/context plan BEFORE touching filesystem or browser.
  const plan = await validateAndResolvePlan();
  await fs.mkdir(path.dirname(INPUT.outFile), { recursive: true });

  // 2. Open or resume TaskSpace and reuse conversation page.
  const requireExistingSpace =
    plan.isExtractOnly && !plan.targetConvUrl && plan.spaceId !== null;
  const opened = await openOrResumeSpace(plan.spaceId, INPUT.spaceName, requireExistingSpace);
  task = opened.task;
  page = await resolvePage(task, plan.targetConvUrl, opened.mode);

  // 3. Navigate only when required (respecting /u/<n> account prefix & fresh chat semantics).
  const currentUrl = await safePageUrl(page);
  if (plan.startingFreshChat) {
    const entryUrl = buildNewChatEntryUrl(
      plan.startUrl,
      plan.existingSession?.convUrl || currentUrl,
    );
    if (!matchesTargetNavigation(currentUrl, entryUrl)) {
      await navigateSoft(page, entryUrl);
    }
  } else if (plan.targetConvUrl) {
    if (!sameConversation(currentUrl, plan.targetConvUrl)) {
      await navigateSoft(page, plan.targetConvUrl);
    }
  } else if (!isGeminiSupportedUrl(currentUrl)) {
    await navigateSoft(page, GEMINI_HOME);
  }

  // 4. Verify login state and optional expectedAccount.
  const preSendState = await waitForUiAndVerifyAuth(task, page, INPUT.expectedAccount);

  // Helper to persist sessionFile cleanly at both Phase 1 (post-send) and Phase 2 (completed).
  const buildSessionPayload = (status, url, extra = {}) => ({
    spaceId: task.spaceId,
    convUrl: url,
    status,
    updatedAt: new Date().toISOString(),
    contextHashes: plan.effectiveContextHashes,
    previousUrls: plan.previousUrls,
    ...extra,
  });

  // 5. Paste & send prompt (skipped in extract-only mode), then Phase 1 atomic persist immediately.
  const postSendState = plan.isExtractOnly
    ? preSendState
    : await pasteAndSend(task, page, plan.prompt, preSendState);

  const sentAt = plan.isExtractOnly ? plan.existingSession?.sentAt : new Date().toISOString();
  const postSendUrl = await safePageUrl(page);

  if (!plan.isExtractOnly && plan.sessionFilePath) {
    await writeSessionFileAtomic(
      plan.sessionFilePath,
      buildSessionPayload("pending_response", postSendUrl, { sentAt }),
    );
  }

  // 6. Wait for generation completion (updating sessionFile as soon as /app/<id> appears).
  const { completed, latest, emptyHome } = await waitForAnswer(
    task,
    page,
    plan.isExtractOnly,
    preSendState,
    postSendState,
    postSendUrl,
    async (newConvUrl) => {
      if (plan.sessionFilePath && !plan.isExtractOnly) {
        await writeSessionFileAtomic(
          plan.sessionFilePath,
          buildSessionPayload("pending_response", newConvUrl, { sentAt }),
        );
      }
    },
  );

  if (emptyHome) {
    await failWithContext(task, page, "no conversation answer found on blank Gemini entry page", {
      captureDebug: true,
      diagnostics: { responseCount: latest.responseCount },
    });
  }

  const extractionMode = latest.responseCount > 0 ? "model_response" : "fallback_body";
  const response =
    extractionMode === "model_response" ? latest.lastResponse : latest.bodyText;

  if (!completed) {
    if (response) {
      await fs.writeFile(INPUT.outFile, response, "utf8");
    }
    await writeDebugFile(
      INPUT.outFile,
      `TIMEOUT (${MAX_WAIT_MS}ms)`,
      `extractionMode=${extractionMode}\nisTyping=${latest.isTyping}\nhasStopButton=${latest.hasStopButton}\nresponseCount=${latest.responseCount}\n\n=== BODY ===\n${latest.bodyText}`,
    );
    await failWithContext(
      task,
      page,
      `answer did not finish within ${MAX_WAIT_MS / 1000}s; partial text saved`,
      { responseFile: INPUT.outFile, extractionMode },
    );
  }

  if (!response) {
    await failWithContext(task, page, "no answer text found after completion", {
      captureDebug: true,
      extractionMode,
      diagnostics: { responseCount: latest.responseCount },
    });
  }

  await fs.writeFile(INPUT.outFile, response, "utf8");
  await writeDebugFile(
    INPUT.outFile,
    "META",
    `mode=${plan.isExtractOnly ? "extract_only" : "ask"}\nextractionMode=${extractionMode}\nbeforeCount=${preSendState.responseCount}\nafterCount=${latest.responseCount}\n\n=== BEFORE BODY ===\n${preSendState.bodyText}\n\n=== AFTER BODY ===\n${latest.bodyText}`,
  );

  // 7. Capture metadata BEFORE finish() and Phase 2 atomic persist sessionFile.
  const finalSpaceId = task.spaceId;
  const finalPageLabel = page.label;
  const finalUrl = await page.url();

  if (plan.sessionFilePath) {
    await writeSessionFileAtomic(
      plan.sessionFilePath,
      buildSessionPayload("ready", finalUrl, {
        lastResponseFile: INPUT.outFile,
      }),
    );
  }

  if (INPUT.finish) {
    await task.finish({ keep: [finalPageLabel] });
  }

  out({
    ok: true,
    spaceId: finalSpaceId,
    page: INPUT.finish ? null : finalPageLabel,
    finished: INPUT.finish,
    url: finalUrl,
    responseFile: INPUT.outFile,
    sessionFile: plan.sessionFilePath || null,
    extractionMode,
    contextChanged: plan.contextChanged,
    changedFiles: plan.changedContextFiles,
  });
} catch (err) {
  if (!err?.__reported) {
    const safeUrl = await safePageUrl(page);
    out({
      ok: false,
      error: redactSensitive(err?.message || String(err)),
      handOff: false,
      spaceId: task ? task.spaceId : null,
      page: page ? page.label : null,
      url: safeUrl,
    });
  }
  throw err;
}
