// gemini-ask.mjs — v0.2.1 (2026-11-22)
// Fixed flow: ask or continue a Gemini web conversation in the local Mac Ego browser.
// Incorporates live Gemini pitfalls from ego-gemini-assist & ego-browser guide v2.2.1:
//   - NEVER page.click() or page.fill() on .ql-editor (hangs page/taskSpace)
//   - NEVER execCommand("insertText") for long text
//   - Focus .ql-editor via page.evaluate() with explicit Range, paste via keyboard.paste(),
//     verify head/tail in innerText (&nbsp; normalized)
//   - Send via scoped Send message button, confirm send started, wait until typing/stop
//     indicators clear and the latest model-response turn stabilizes
//   - Soft-handle page.goto() 15s timeout ONLY when landed on the intended /app target
//   - Check login wall & optional expectedAccount (never log emails or raw snapshots to stdout)
//   - Support extract-only mode (empty prompt + empty promptFile) without reloading the page
//   - Respect ego-browser finish() semantics (invalidated page labels return page: null)

// ===================== DEFAULT_INPUT (for direct heredoc use) =====================
const DEFAULT_INPUT = {
  prompt: "",          // exact prompt text (leave empty + set promptFile for long text)
  promptFile: "",      // absolute path of a file holding the prompt
  convUrl: "",         // Gemini /app conversation URL; "" keeps current tab or opens /app
  spaceId: null,       // integer spaceId from previous run; null = create new space
  spaceName: "gemini-web",
  expectedAccount: "", // optional account substring to verify (never logged)
  outFile: "",         // required absolute path: response text is written here
  finish: true,        // true = task.finish({ keep: [label] }); false = keep space active in reply
};
// ==================================================================================

const INPUT = {
  ...DEFAULT_INPUT,
  ...(globalThis.__GEMINI_INPUT__ || {}),
};

const fs = await import("node:fs/promises");
const path = await import("node:path");

const GEMINI_HOME = "https://gemini.google.com/app";
const GOTO_TIMEOUT_MS = 15000;
const UI_WAIT_TIMEOUT_MS = 10000;
const UI_POLL_MS = 500;
const SEND_BUTTON_WAIT_MS = 5000;
const SEND_BUTTON_POLL_MS = 250;
const SEND_START_TIMEOUT_MS = 15000;
const PASTE_SETTLE_MS = 300;
const POLL_MS = 2000;
const MAX_WAIT_MS = 180000;
const SHORT_RESIDUAL_LIMIT = 2000;
const VERIFY_EDGE_CHARS = 24;
const STABLE_POLLS_STRUCTURED = 2;
const STABLE_POLLS_FALLBACK = 4;
const STABLE_POLLS_EXTRACT_ONLY = 2;

const GEMINI_APP_PATH_RE = /^(\/u\/\d+)?\/app(\/|$)/;
const GEMINI_HOME_PATH_RE = /^(\/u\/\d+)?\/app\/?$/;
const GEMINI_CONV_PATH_RE = /^(\/u\/\d+)?\/app\/([^/?#]+)/;

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

function isGeminiAppUrl(url) {
  const u = parseUrlSafe(url);
  return Boolean(u && u.hostname === "gemini.google.com" && GEMINI_APP_PATH_RE.test(u.pathname));
}

function isGeminiHomeUrl(url) {
  const u = parseUrlSafe(url);
  return Boolean(u && u.hostname === "gemini.google.com" && GEMINI_HOME_PATH_RE.test(u.pathname));
}

function isGoogleLoginUrl(url) {
  const u = parseUrlSafe(url);
  return Boolean(u && u.hostname === "accounts.google.com");
}

function extractConvId(url) {
  const u = parseUrlSafe(url);
  if (!u || u.hostname !== "gemini.google.com") return "";
  const m = u.pathname.match(GEMINI_CONV_PATH_RE);
  return m ? m[2] : "";
}

function extractAccountPrefix(url) {
  const u = parseUrlSafe(url);
  if (!u || u.hostname !== "gemini.google.com") return "";
  const m = u.pathname.match(/^(\/u\/\d+)\/app(\/|$)/);
  return m ? m[1] : "";
}

function normalizeConvKey(url) {
  const u = parseUrlSafe(url);
  if (!u) return String(url || "").trim().replace(/\/+$/, "");
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

function sameConversation(currentUrl, targetUrl) {
  if (!currentUrl || !targetUrl) return false;
  return normalizeConvKey(currentUrl) === normalizeConvKey(targetUrl);
}

function matchesTargetNavigation(curUrl, targetUrl) {
  if (!isGeminiAppUrl(curUrl)) return false;
  const targetConvId = extractConvId(targetUrl);
  const targetAcct = extractAccountPrefix(targetUrl);
  if (targetAcct && extractAccountPrefix(curUrl) !== targetAcct) {
    return false;
  }
  if (targetConvId) {
    return extractConvId(curUrl) === targetConvId;
  }
  // Target is a new-chat home URL (/app or /u/<n>/app): must NOT stay on an old /app/<id>.
  return isGeminiHomeUrl(curUrl);
}

async function safePageUrl(page, fallback = "") {
  if (!page) return fallback;
  return await page.url().catch(() => fallback);
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
      if (isGeminiAppUrl(uUrl) || !targetUrl) {
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
      if (isGeminiAppUrl(u)) return p;
    }
    return managed[0];
  }

  const tabs = await task.tabs();
  if (tabs.length === 0) {
    return await task.newPage();
  }

  const chosen =
    (targetUrl && tabs.find((t) => sameConversation(t.url, targetUrl))) ||
    tabs.find((t) => isGeminiAppUrl(t.url) && t.active) ||
    tabs.find((t) => isGeminiAppUrl(t.url)) ||
    tabs.find((t) => t.active) ||
    tabs[0];

  return chosen.label ? task.page(chosen.label) : await task.adopt(chosen.page);
}

async function validateInputs() {
  if (!INPUT.outFile || !path.isAbsolute(INPUT.outFile)) {
    fail("INPUT.outFile is required and must be an absolute path");
  }
  if (INPUT.promptFile && !path.isAbsolute(INPUT.promptFile)) {
    fail("INPUT.promptFile must be an absolute path");
  }
  if (INPUT.convUrl && !isGeminiAppUrl(INPUT.convUrl)) {
    fail("INPUT.convUrl must be a https://gemini.google.com/app... URL");
  }
  if (typeof INPUT.finish !== "boolean") {
    fail("INPUT.finish must be a boolean");
  }

  const spaceId = normalizeSpaceId(INPUT.spaceId);
  const inlinePrompt = normalizeText(INPUT.prompt);
  const promptFilePath = String(INPUT.promptFile || "").trim();

  if (inlinePrompt && promptFilePath) {
    fail("provide either INPUT.prompt or INPUT.promptFile, not both");
  }

  let prompt = inlinePrompt;
  if (!prompt && promptFilePath) {
    prompt = normalizeText(await fs.readFile(promptFilePath, "utf8"));
    if (!prompt) {
      fail("INPUT.promptFile is empty");
    }
  }

  return {
    prompt,
    isExtractOnly: prompt.length === 0,
    spaceId,
  };
}

async function waitForUiAndVerifyAuth(task, page, expectedAccount) {
  const currentUrl = await safePageUrl(page);
  if (isGoogleLoginUrl(currentUrl) || !isGeminiAppUrl(currentUrl)) {
    await handOffAndFail(
      task,
      page,
      "redirected away from Gemini /app (login wall or unexpected page); handed off to user",
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
  await page.waitForTimeout(PASTE_SETTLE_MS);

  // Verify head & tail in .ql-editor innerText (&nbsp; normalized).
  const pastedRaw = await page.evaluate(() => {
    const el = document.querySelector(".ql-editor");
    return el ? el.innerText || "" : "";
  });
  const expectedCompact = normalizeCompact(prompt);
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

async function waitForAnswer(task, page, isExtractOnly, preSendState, postSendState) {
  let latest = postSendState;
  const waitStart = Date.now();
  let sawBusy = latest.isTyping || latest.hasStopButton;
  let prevSample = "";
  let stableHits = 0;

  while (Date.now() - waitStart < MAX_WAIT_MS) {
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
        // On a blank /app home page with no model turns, do not falsely succeed.
        const curUrl = await safePageUrl(page);
        if (isGeminiHomeUrl(curUrl)) {
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
      // Ask mode: prefer structured model-response turn advancement.
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
        // Fallback only after an explicit busy -> idle transition and post-send body growth.
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
  // 1. Validate all inputs BEFORE touching filesystem or browser.
  const { prompt, isExtractOnly, spaceId } = await validateInputs();
  await fs.mkdir(path.dirname(INPUT.outFile), { recursive: true });

  // 2. Open or resume TaskSpace and reuse conversation page.
  const requireExistingSpace = isExtractOnly && !INPUT.convUrl && spaceId !== null;
  const opened = await openOrResumeSpace(spaceId, INPUT.spaceName, requireExistingSpace);
  task = opened.task;
  page = await resolvePage(task, INPUT.convUrl, opened.mode);

  // 3. Navigate only when needed (never reload an existing conversation on extract-only).
  const currentUrl = await safePageUrl(page);
  if (INPUT.convUrl) {
    if (!sameConversation(currentUrl, INPUT.convUrl)) {
      await navigateSoft(page, INPUT.convUrl);
    }
  } else if (!isGeminiAppUrl(currentUrl)) {
    await navigateSoft(page, GEMINI_HOME);
  }

  // 4. Verify login state and optional expectedAccount.
  const preSendState = await waitForUiAndVerifyAuth(task, page, INPUT.expectedAccount);

  // 5. Paste & send prompt (skipped in extract-only mode).
  const postSendState = isExtractOnly
    ? preSendState
    : await pasteAndSend(task, page, prompt, preSendState);

  // 6. Wait for generation completion and extract answer.
  const { completed, latest, emptyHome } = await waitForAnswer(
    task,
    page,
    isExtractOnly,
    preSendState,
    postSendState,
  );

  if (emptyHome) {
    await failWithContext(task, page, "no conversation answer found on blank Gemini /app home page", {
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
    `mode=${isExtractOnly ? "extract_only" : "ask"}\nextractionMode=${extractionMode}\nbeforeCount=${preSendState.responseCount}\nafterCount=${latest.responseCount}\n\n=== BEFORE BODY ===\n${preSendState.bodyText}\n\n=== AFTER BODY ===\n${latest.bodyText}`,
  );

  // 7. Capture metadata BEFORE finish(): finish() invalidates all page labels.
  const finalSpaceId = task.spaceId;
  const finalPageLabel = page.label;
  const finalUrl = await page.url();

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
    extractionMode,
  });
} catch (err) {
  if (!err?.__reported) {
    const safeUrl = await safePageUrl(page);
    out({
      ok: false,
      error: err?.message || String(err),
      handOff: false,
      spaceId: task ? task.spaceId : null,
      page: page ? page.label : null,
      url: safeUrl,
    });
  }
  throw err;
}
