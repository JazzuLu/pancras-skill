---
name: magpie-gemini-login
description: >-
  Fix and re-login Google/Gemini accounts for Magpie's magpie-gemini-web plugin
  (AI Studio + Gemini Web providers). Use when a Magpie Gemini account keeps
  dropping every few hours, shows auth_required / 401 Code 16, "登录态失效",
  "隔离登录态失效", or needs a long-lived session. Covers the remote-add
  (setup --remote --login) flow with a local Camoufox window, plus the pitfalls
  that make a login silently fail.
allowed-tools:
  - Bash
  - Read
metadata:
  version: "1.0.0"
  date: "2026-11-21"
  machines: "txy-sg (server), this Mac (login window)"
---

# magpie-gemini-login

Re-login a Gemini account for the Magpie `magpie-gemini-web` plugin so it stops
dropping every few hours.

## 0. First: is this the right problem?

Symptom cluster that this skill fixes:

- Account state `auth_required`, requests fail `401 Code 16`
  ("invalid authentication credentials")
- Server log shows `隔离登录态失效` → `登录态失效，账户认证续签` → `WAA Worker 启动失败`
- Account works for a few hours after each re-login, then dies again

**If the account keeps dying within hours, it was almost certainly imported as a
cookie** (`粘贴 Cookie` / `从 Chrome 导入`). Do not try to fix that by re-pasting
cookies — see the root cause below. The author of AIStudio2API states it directly
in issue #99: a copied, device-bound cookie cannot renew itself without the
original device key.

## 1. Root cause (do not skip — it decides the method)

Google binds the login session to the device via cookies including
`__Secure-1PSIDTS` / `__Secure-3PSIDTS`. A cookie copied out of a normal browser
carries that binding but not the ability to renew it. Result: works a few hours,
then dies. Re-pasting only restarts the clock.

**The only durable fix** is an isolated Camoufox session created by the backend
itself (`浏览器登录` / remote-add). That session does not carry the
device-bound cookie and survives long-term.

Camoufox = a Firefox-based anti-detection browser (spoofs TLS, headers, canvas,
device fingerprint) so Google does not treat the login as automation. On a
headless Linux server it needs `xvfb`; on macOS it opens a real window.

## 2. Pick the login path

| Path | When | Speed |
|---|---|---|
| **remote-add on this Mac** (`setup --remote --login`) | **Default. Server is headless; you have a Mac with a GUI.** | Fast, native window, zero input lag |
| 浏览器登录 in the admin page | Server has a display, or you accept the streamed canvas window | Slow — keystrokes go over WebSocket |
| 粘贴 Cookie / Chrome 导入 | **Never for a long-lived account** | Dies in hours |

The streamed admin-page window is a canvas fed by WebSocket; typing into it
feels laggy and the i18n string `accounts.liveUnavailable`
("无法连接登录窗口…需要转发 WebSocket") is usually a **secondary** symptom, not
the real cause. Check the real cause first: the task's `items[].error` field.

## 3. Procedure — remote-add (the reliable path)

Work on **this Mac**; the server is `txy-sg`.

### 3.1 Prepare

```bash
# a) Tool + Camoufox must already be downloaded (549MiB, slow — do this BEFORE
#    generating a token, because the token expires in ~10 min).
#    Keep them somewhere stable, e.g. <workdir>/tool/
ls <tool-dir>/aistudio2api-*/aistudio2api
ls <tool-dir>/runtime/camoufox/Camoufox.app
```

If Camoufox is missing, run any `setup ... --login` once and let it download;
watch `runtime/logs/aistudio2api.log` for `Camoufox 已就绪`. It resumes after
`unexpected EOF`, just let it run.

```bash
# b) Tunnel to the admin page. 2048 is enough — the login-view WebSocket is on
#    the same port, and ssh -L forwards it transparently.
ssh -N -o BatchMode=yes -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
    -L 2048:127.0.0.1:2048 txy-sg
```

Run it in a way that survives your shell (background shell / `nohup`).
Do **not** forward 2050 in the same command — a bind conflict there makes the
whole tunnel fail to come up.

```bash
# c) Verify the tunnel is STABLE, not just up. Five 200s in a row.
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "$i:%{http_code} " --max-time 5 \
  http://127.0.0.1:2048/; done; echo
```

### 3.2 Delete the stale account FIRST

**This is the #1 cause of "I logged in and nothing happened."** If an account
with the same email already exists, the upload fails with
`HTTP 409: 账户已存在` and your login is wasted.

```bash
# Log in to the admin API (password lives in the server .env — never echo it)
ssh txy-sg 'PW=$(grep "^ADMIN_PASSWORD=" ~/.local/share/magpie-ai-studio/.env | cut -d= -f2-); \
  curl -s -c /tmp/admin.jar -o /dev/null -H "Content-Type: application/json" \
  -d "{\"username\":\"magpie\",\"password\":\"$PW\"}" http://127.0.0.1:2048/api/auth/login'

# List accounts
ssh txy-sg 'curl -s -b /tmp/admin.jar http://127.0.0.1:2048/api/accounts'

# Delete the broken one (only if its state is auth_required / you are replacing it)
ssh txy-sg 'curl -s -b /tmp/admin.jar -X DELETE \
  -w "\nHTTP %{http_code}\n" http://127.0.0.1:2048/api/accounts/<email>'
```

### 3.3 Generate a token and start the login

```bash
ssh txy-sg 'curl -s -b /tmp/admin.jar -X POST http://127.0.0.1:2048/api/pairing' \
  > /tmp/pair.json
TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/pair.json'))['token'])")

cd <tool-dir>
./aistudio2api-*/aistudio2api setup --remote http://127.0.0.1:2048 \
  --token "$TOKEN" --login > /tmp/setup_run.log 2>&1 &
```

`http://` is only accepted for a loopback address — which is exactly what the
tunnel gives you. A public hostname would require HTTPS.

### 3.4 Hand the window to the user

The tool opens a real Camoufox window titled `Sign in - Google Accounts`
(or `ログイン - Google アカウント` when the egress geolocates to JP). Bring it
front so the user can actually type:

```bash
osascript -e 'tell application "camoufox" to activate'
osascript -e 'tell application "System Events" to tell process "camoufox" \
  to get name of every window'
```

**The user types the Google password. Never type it for them, never ask for it.**

Token lifetime is ~10 minutes. If it expires, regenerate and restart — do not
leave a dead window open, and do not make the user log in repeatedly (Google
will flag the account). Get the tunnel stable and the account deleted *before*
asking them to log in.

### 3.5 Verify — two checks, both required

```bash
# a) Account state
ssh txy-sg 'curl -s -b /tmp/admin.jar http://127.0.0.1:2048/api/accounts'
#    want: state=ready, message empty, models populated

# b) A real generation request — a "ready" flag alone is not proof.
#    Use max_tokens 800, NOT 10: reasoning models burn a tiny budget on
#    thinking and return empty content, which looks like a failure but is not.
ssh txy-sg 'KEY=$(grep "^PROXY_API_KEY=" ~/.local/share/magpie-ai-studio/.env | cut -d= -f2-); \
  curl -s --max-time 45 -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"gemini-flash-latest\",\"messages\":[{\"role\":\"user\",\"content\":\"say OK\"}],\"max_tokens\":800}" \
  http://127.0.0.1:2048/v1/chat/completions | head -c 400'
```

A `200` with real content means done. An empty `content` at `max_tokens: 10` is
NOT a failure — raise the budget before concluding anything.

## 4. Pitfalls that silently waste a login

1. **Stale account not deleted** → `409 账户已存在`. Delete first (3.2).
2. **Tunnel dies during upload** → `Post .../api/pairing/accounts: EOF`. The login
   succeeded locally but never reached the server. Test the tunnel 5× first (3.1c).
3. **Token expires while Camoufox downloads** (549MiB, can take 30 min on a slow
   link) → `context deadline exceeded`. Download Camoufox before minting a token.
4. **Missing xvfb on a headless server** (only for the server-side
   `浏览器登录` path) → `没有 DISPLAY 时 Camoufox 需要 Xvfb`. Fix:
   `sudo apt-get install -y xvfb`.
5. **Port 2050 forwarded together with 2048** → bind conflict, whole tunnel dead.
6. **Repeated logins trigger Google risk control.** Do not retry in a loop; fix
   the blocker first, then ask the user to log in once.

## 5. Admin API reference

Base `http://127.0.0.1:2048`, cookie `aistudio_admin`.

| Purpose | Call |
|---|---|
| Login | `POST /api/auth/login` `{"username","password"}` |
| Session | `GET /api/auth/session` |
| Pairing token | `POST /api/pairing` (also `GET` for the active one) |
| Accounts | `GET /api/accounts`, `DELETE /api/accounts/{id}` |
| Account state | `PUT /api/accounts/{id}/state` |
| Tasks | `GET /api/accounts/tasks`, `DELETE /api/accounts/tasks/{id}` |
| Login window WS | `GET /api/login-view/{view}` |

`DELETE` on a task is the clean way to clear a stuck `等待登录` row.

## 6. Gemini Web (`gemini-web`) — separate provider, DIFFERENT answer

Do not confuse the two providers. Their fixes are opposite:

| | `ai-studio` | `gemini-web` |
|---|---|---|
| Copied cookie | **Hopeless** — device-bound, cannot renew | **Works** — backend keeps it alive |
| Fix | Camoufox isolated session (§3) | Paste a **Firefox** cookie |

`gemini-web` (`gemini-web2api-go`, port 8083) does keep cookies alive on its
own: every 10 minutes (first refresh 15s after start) it calls
`accounts.google.com/RotateCookies`, swaps `__Secure-1PSIDTS` with a sentinel
payload, and refreshes SIDCC via the browser iframe. Upstream `SIDCC` /
`__Secure-1PSIDCC` / `__Secure-3PSIDCC` responses are written back too.

**So if a `gemini-web` cookie dies in ~30 minutes, the cookie source is wrong —
not the approach.** Chrome's Device Bound Session Credentials bind the exported
session to that machine, so `*PSIDTS` cannot be renewed and the keepalive is
useless. The upstream README states this outright.

### 6.1 Export from Firefox (required)

1. Sign in to <https://gemini.google.com> in **Firefox** (a fresh profile or a
   private window is safest — do not share the session with daily browsing).
2. DevTools → Application → Cookies → `https://gemini.google.com`.
3. Copy exactly these seven:
   `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `__Secure-1PSID`,
   `__Secure-1PSIDTS`.
   `SAPISID` is mandatory — it is used to compute the `SAPISIDHASH` auth header.
4. Paste into the Cookie pool, or supply a `cookie.txt` as a single
   `k=v; k=v; …` line.

Chrome is a last resort: brand-new private window, log in, export immediately,
**close that window right away** so the browser stops rotating the same session.

### 6.1.1 BEST: use Camoufox with a txy-sg SOCKS proxy (爹地's standing choice)

Do not ask the user to copy cookie values by hand. Log in with a **local
Camoufox** profile whose traffic goes through **txy-sg**, so the login IP and the
backend's request IP are identical (`43.153.204.104`). This avoids the Google
risk-control the user hit when a login came from a Guangzhou/Shenzhen exit while
the backend used Singapore. ** Standing rule: all Gemini-family logins go
through txy-sg from now on.**

```bash
# a) SSH SOCKS5 tunnel via txy-sg
ssh -N -o BatchMode=yes -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
    -D 1080 txy-sg
curl -x socks5h://127.0.0.1:1080 https://api.ip.sb/ip   # -> 43.153.204.104 (verify!)

# b) Dedicated Camoufox profile, proxy pinned in prefs.js
PROFILE=<workdir>/tool/profiles/gemini-login
cat >> "$PROFILE/prefs.js" <<'EOF'
user_pref("network.proxy.type", 1);
user_pref("network.proxy.socks", "127.0.0.1");
user_pref("network.proxy.socks_port", 1080);
user_pref("network.proxy.socks_version", 5);
user_pref("network.proxy.socks_remote_dns", true);
EOF
TOOL/runtime/camoufox/Camoufox.app/Contents/MacOS/camoufox \
  --profile "$PROFILE" --no-remote https://gemini.google.com/app &
osascript -e 'tell application "camoufox" to activate'   # bring window front
```

User clicks Sign in and completes the login (may see a phone prompt; it should
now show **Singapore / 腾讯云**, not Guangzhou). **Do NOT screenshot the window
just to "confirm" it is open** — the user says so; opening == open.

### 6.1.2 Import automatically — no manual copy/paste

```bash
# cookies.sqlite is locked while Camoufox runs: COPY it first, then read.
# Extract SID/HSID/SSID/APISID/SAPISID/__Secure-1PSID/__Secure-1PSIDTS (all google.com).
# Write a 0600 file /tmp/gemini_cookie.txt with "k=v; k=v; ...", then:
curl -s -b <admin.jar> -X POST -H "Content-Type: application/json" \
  --data-binary @/tmp/import_body.json http://127.0.0.1:8083/admin/api/cookies
#   import_body.json = {"label","cookie","note","authuser":0}
# Delete the old dead accounts first: DELETE /admin/api/cookies/{id}
# Verify: POST /admin/api/cookies/{id}/check -> {"ok":true,"detail":"登录态有效"}
#         GET /v1/models -> gemini-gemini-4-hydrogen etc. appear (not just 2 anonymous)
#         a real generate call returns 200 with content.
```

A cookie with `has_1psidts: true` is fine here — Camoufox provides the renewal
material and the backend keepalive works. What killed the old accounts was
**Chrome's device binding**, not the presence of PSIDTS itself.

If the browser has several Google accounts, set 账号序号: check the URL
(`gemini.google.com/u/1/app` → `1`; no `/u/` → `0`). Wrong index means requests
silently land on the default account and paid models get downgraded without an
error.

### 6.2 Diagnose a dead pool

```bash
# ADMIN_TOKEN lives in the server process environ
ssh txy-sg 'TOK=$(sudo cat /proc/$(pgrep -f gemini-web2api-go | head -1)/environ \
  | tr "\0" "\n" | grep "^ADMIN_TOKEN=" | cut -d= -f2-); \
  curl -s -H "Authorization: Bearer $TOK" http://127.0.0.1:8083/admin/api/cookies'
```

Signals:

- `health: "dead"` + `last_error: "no SNlM0e in page (cookie expired or not signed in)"`
  → cookie invalid or not signed in.
- `has_1psidts: true` + dies in ~30 min → **Chrome-bound cookie**. Re-export from
  Firefox. This is the smoking gun.
- `status: "disabled"` → auto-disabled after 3 consecutive auth failures (not
  deleted). Delete or re-enable after re-importing.
- `GET /v1/models` returning only `gemini-3.5-flash-lite` and `gemini-3.6-flash`
  → anonymous only, no usable account in the pool. With a live cookie,
  `gemini-4-hydrogen` etc. appear.

Note: "last success" does not mean the cookie is still valid — once expired,
Gemini treats the request as anonymous instead of erroring. Use the panel's
检测 button rather than a real request.

Only genuine auth failures count toward `fail_count` (401/403, redirected to the
login page, no signed-in state). Network errors, timeouts, proxy failures and
`/sorry` redirects are excluded on purpose, so a flaky proxy cannot bury a good
cookie.

### 6.3 Admin API (port 8083, `Authorization: Bearer <ADMIN_TOKEN>`)

| Purpose | Call |
|---|---|
| Cookie pool | `GET /admin/api/cookies`, `POST /admin/api/cookies` |
| Proxies | `GET/POST /admin/api/proxies` |
| Stats / error breakdown | `GET /admin/api/stats` |
| Runtime config | `GET /admin/api/config` |
| API key rotation | `POST /admin/api/apikey` |
| Panel | `http://127.0.0.1:8083/admin` |

## 7. Files on txy-sg

| Path | What |
|---|---|
| `~/.local/share/magpie-ai-studio/.env` | `ADMIN_PASSWORD`, `PROXY_API_KEY`, `WAA_BACKEND` |
| `~/.local/share/magpie-ai-studio/auth/<email>/storage-state.json` | account cookies (contains secrets — never print) |
| `~/.local/share/magpie-ai-studio/runtime/logs/aistudio2api.log` | backend log |
| `~/.local/share/magpie-ai-studio/backend.log` | launcher log |
| `~/.local/share/magpie-gemini-web/` | Gemini Web backend (`config.json`, `gemini.db`, `backend.log`) |

## 8. Tunnels are launchd-managed (always on)

`~/Library/LaunchAgents/com.pancras.magpie-gemini-tunnels.plist` keeps all three
forwardings up across reboots: `2048` (ai-studio admin), `8083` (gemini-web),
and `-D 1080` (SOCKS5 → txy-sg). Do not start ad-hoc `-L`/`-D` for these ports;
they are already held by launchd. Never touch `com.pancras.magpie-sg-tunnel`
(port 3426) — that is the separate always-on Magpie gateway tunnel.

```bash
launchctl list | grep magpie-gemini-tunnels        # status
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pancras.magpie-gemini-tunnels.plist
launchctl bootout  gui/$(id -u) ~/Library/LaunchAgents/com.pancras.magpie-gemini-tunnels.plist
```

After a re-pull, allow ~5s before testing — 8083/SOCKS may briefly return
000/empty while the ssh session settles.
