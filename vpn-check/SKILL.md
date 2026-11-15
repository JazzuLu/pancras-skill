---
name: vpn-check
description: Network diagnostics for this machine — 自由猫 ziyoumao proxy, TUN, OpenRouter VPN, OpenClaw gateway connectivity. Clash Verge is retired and must not be launched.
trigger: network, proxy, vpn, discord down, can't connect, 网络, 代理, 挂了, 连不上
---

# VPN Check — Network Diagnostics

## Machine Network Architecture

The current proxy is **自由猫 (ziyoumao)** at `/Applications/ziyoumao.app`.

- **自由猫 GUI** plus **ziyoumaoCore**. The core often runs as root and talks to the GUI over `/tmp/ziyoumaoCoreSocket_*.sock`.
- **Clash Verge is retired.** Do not launch it. Never run `open -a "Clash Verge"`. Port **7897** is the old Clash mixed port. A leftover `clash-verge-service` helper is not a reason to start the GUI or to send traffic to 7897.
- **OpenRouter VPN** — company intranet VPN, scripts at `~/WorkingPlace/VPN/`.
- **OpenClaw gateway** — started by launchd when installed (Discord bots + Feishu). Config paths below may be absent.

### Discover the live HTTP inbound

Do not hardcode a port. `ziyoumaoCore` as root hides `LISTEN` sockets from a non-root `lsof`, so an empty user-level `lsof` does not prove that no port is open.

```bash
pgrep -lf 'ziyoumaoCore|ziyoumao.app|自由猫'
lsof -nP -p <those-pids> -iTCP -sTCP:LISTEN
nc -z -G 2 127.0.0.1 <candidate>
```

7898 is only a historical ziyoumao HTTP/mixed inbound. Use `http://127.0.0.1:7898` only after `nc` (or a real request) shows it is accepting. If nothing is listening, do not invent an inbound and do not fall back to 7897.

Direct HTTPS to `https://repo.maven.apache.org` can succeed with no proxy. `~/.m2/settings.xml` must not force Maven through a dead proxy. Point Maven at the live ziyoumao port, or set the proxies `active` to `false`, after you have checked.

Still-useful checks: `lsof`, `route -n get default`, `netstat -rn | grep '^default'`, `pgrep -lf ziyoumaoCore`.

### Key Routing Facts

| Service | Routing | Why |
|---------|---------|-----|
| Discord (`discord.com`, `gateway.discord.gg`) | Explicit proxy to the **live** ziyoumao HTTP port, if one is listening | Often blocked in China. TUN may not cover launchd processes. |
| Feishu (`open.feishu.cn`) | Direct, no proxy | Domestic, usually reachable |
| Maven Central | Direct works. Proxy only if a ziyoumao HTTP inbound is actually listening | A dead `127.0.0.1:7897` proxy makes `./mvnw` fail with connection refused |

### TUN

自由猫 may own a fake-ip interface such as `utun5` with `inet 198.18.0.1`. That is not Clash Verge, and it is not a reason to start Clash. The default route can still be `en0` via the LAN gateway. Browser traffic can be covered while terminal or launchd processes bypass TUN.

## When to Use

- Discord bots are down / not responding
- User mentions: network, proxy, VPN, "can't connect", "挂了", "连不上"
- OpenClaw gateway restart failed
- Maven or curl fails connecting to `127.0.0.1:7897`
- Diagnosing any connectivity issue

## How to Use

```bash
vpn-check            # full check
vpn-check --quick
vpn-check --json
vpn-check --fix      # only restarts the OpenClaw gateway if that CLI exists and the gateway is down
```

The script is `~/.local/bin/vpn-check`. It must not tell you to open Clash. If an old copy still does, ignore that line.

## Common Scenarios

### Discord bots down, Feishu works

Proxy problem, not general network.

1. Run `vpn-check`.
2. Discover the live ziyoumao HTTP port (`pgrep` / `lsof` / `nc`). Do not start Clash.
3. If OpenClaw is installed, `channels.discord.proxy` must be that live port, never `7897`.
4. `openclaw gateway restart` only when `openclaw` is actually installed.

### Everything looks down

1. `vpn-check --quick`.
2. If `ziyoumaoCore` is not running, say so. Do **not** run `open -a "Clash Verge"`.
3. If no HTTP inbound is listening, test direct connectivity (`curl -I --connect-timeout 5 https://open.feishu.cn` and `https://repo.maven.apache.org`). Do not invent a proxy.
4. If Feishu is also down, treat it as basic internet, not a missing Clash port.

### Browser works, OpenClaw bots do not

TUN can cover the browser and miss launchd. Set the explicit Discord proxy to the discovered ziyoumao port. Do not start Clash to "fix" TUN.

### VPN overlaps the proxy route

1. `vpn-check` — "VPN/proxy route" line.
2. Conflicting routes are manual and need root (`sudo route delete`). Do not start Clash.
3. VPN scripts live at `~/WorkingPlace/VPN/`.

### Maven cannot resolve artifacts

`Connect to 127.0.0.1:7897 failed: Connection refused` means `~/.m2/settings.xml` still points at retired Clash. Do not start Clash. Discover the live ziyoumao port and point both the `http` and `https` proxies there, or deactivate them so Maven goes direct.

## Key Config Files

| File | Purpose |
|------|---------|
| `~/.m2/settings.xml` | Maven proxies. Never leave them on `127.0.0.1:7897`. |
| `~/Library/Application Support/com.ziyoumao/` | 自由猫 data. Runtime config may be obfuscated; trust live sockets over the file. |
| `~/.openclaw/openclaw.json` | If present, `channels.discord.proxy` must be the live ziyoumao HTTP port. |
| `~/Library/LaunchAgents/ai.openclaw.gateway.plist` | If present, proxy env vars. Same port rule. Do not revive 7897. |
| `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml` | Retired Clash config (`mixed-port: 7897`). Do not apply it. |
| `~/WorkingPlace/VPN/` | OpenRouter VPN scripts |
