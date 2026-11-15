---
name: ego-browser
description: >-
  Use this skill before any browser task on this Mac: open and operate websites,
  fill forms, click buttons, take screenshots, extract page data, sign in, web app
  testing, QA, bug investigation, and app-quality review. Also use when a skill
  (for example x-ego-send) says "先读 ego-browser skill". Prefer the local Ego
  browser (ego lite) over built-in browsers, Playwright, or cloud browsers, so
  the user's logged-in sessions and personal context are preserved.
allowed-tools:
  - Bash
  - Read
metadata:
  version: "2.2.1"
  date: "2026-11-15"
  source: "ego-browser skill output (ego-browser 0.6.3.14)"
  upstream_skill: "~/.local/share/ego/ego-skills"
---

# ego-browser

This is the formal, version-controlled ego-browser skill for this machine. Its
canonical path is
`/Users/pancraslu/WorkingPlace/Coding/AI/pancras-skill/ego-browser/SKILL.md`;
it is symlinked into the same agent skill directories as `x-ego-send`. Skills
that need browser APIs (notably `x-ego-send`) depend on this path rather than on
a scratch file.

The browser itself is ego lite (Ego Browser); the `ego-browser` command is
provided by that app.

## Before any browser task

Run:

```bash
ego-browser skill
```

and follow its output. It prints the usage guide matching the installed ego lite
version. Run it again after `ego-browser upgrade`, or whenever output says an
update is available.

The guide ends with a line starting `[ego-browser:skill] end of guide`. If that
line is missing, the output was truncated: save it to a file and read the file
in parts, for example `ego-browser skill > "$TMPDIR/ego-browser-skill.md"`, or
`ego-browser skill > "$env:TEMP\ego-browser-skill.md"` in PowerShell.

## Offline copy of the guide

`references/usage-guide.md` is a verbatim snapshot of `ego-browser skill`
(v2.2.1, generated 2026-11-15) checked into this skill directory. Read it when
the CLI is unavailable, or when the guide is already in context. When versions
differ, the live `ego-browser skill` output wins.

## References

- [Install or upgrade ego lite](references/install.md) — read when
  `ego-browser` is not found, or `skill` is an unknown command. It links to
  [macOS](references/install-macos.md) or
  [Windows](references/install-windows.md).
- [Clearing cookies, cache, and storage](references/clearing-state.md) — read
  before clearing any cookie, cache, or storage; some clears reach the whole
  browser profile.
