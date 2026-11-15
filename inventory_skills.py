#!/usr/bin/env python3
"""
inventory_skills.py v2 — 盘点本机所有 agent skill 与 MCP server，并做去重/分类分析。

改进点（相对 v1）：
  - 显式枚举各 AI 工具的「聚合 skill 目录」里的 symlink，补全 fan-out 映射
    （哪个 canonical 技能被哪些工具目录软链暴露）。
  - 对每个 SKILL.md 计算内容 sha256，按内容去重，识别缓存/派生副本。
  - 给每个技能分组打分类标签：user / package / cache / project / builtin。
输出：
  - 控制台：汇总 + 分析（去重后真实数量、用户自写、缓存副本、失效链、MCP）
  - 文件 SKILL_INVENTORY.md：全量清单 + 分析报告
"""
import os, re, json, hashlib
from collections import defaultdict, OrderedDict

HOME = os.path.expanduser("~")
PANCRAS = "/Users/pancraslu/WorkingPlace/Coding/AI/pancras-skill"

# 扫描根（含各 AI 工具真实技能目录 + 个人/项目目录）
SCAN_ROOTS = [
    "/Users/pancraslu/WorkingPlace",
    os.path.join(HOME, ".agents"),
    os.path.join(HOME, ".codex"),
    os.path.join(HOME, ".claude"),
    os.path.join(HOME, ".opencode"),
    os.path.join(HOME, ".trae"),
    os.path.join(HOME, ".trae-cn"),
    os.path.join(HOME, ".workbuddy"),
    os.path.join(HOME, ".cursor"),
    os.path.join(HOME, ".gemini"),
    os.path.join(HOME, ".config"),
    PANCRAS,
]
# 聚合目录（里面多为 symlink，需要显式枚举以补全 fan-out）
TOOL_DIRS = [
    "/Users/pancraslu/WorkingPlace/Joto/xiao-e/.codebuddy/skills",
    "/Users/pancraslu/WorkingPlace/Joto/xiao-e/.agent/skills",
    os.path.join(HOME, ".agents/skills"),
    os.path.join(HOME, ".codex/skills"),
    os.path.join(HOME, ".claude/skills"),
    os.path.join(HOME, ".opencode/skills"),
    os.path.join(HOME, ".trae/skills"),
    os.path.join(HOME, ".trae-cn/skills"),
    os.path.join(HOME, ".workbuddy/skills"),
    os.path.join(HOME, ".cursor/skills"),
    os.path.join(HOME, ".gemini/skills"),
    os.path.join(HOME, ".gemini/config/skills"),
    os.path.join(HOME, ".config/opencode/superpowers/skills"),
]
EXCLUDE = {".git", "node_modules", "site-packages", "Library", "Movies",
           "Downloads", "Pictures", "Music", ".npm", ".cache", ".Trash",
           "vendor", "dist", "build", "target", ".venv", "__pycache__"}

def sha(path):
    try:
        return hashlib.sha256(open(path, "rb").read()).hexdigest()[:12]
    except Exception:
        return "?"

def walk_skill_md(root):
    out = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in EXCLUDE]
        if "SKILL.md" in fn:
            out.append(os.path.join(dp, "SKILL.md"))
    return out

def parse_fm(path):
    try:
        head = open(path, encoding="utf-8", errors="ignore").read(4000)
    except Exception:
        return {}, ""
    if not head.startswith("---"):
        return {}, head[:160].replace("\n", " ")
    m = re.match(r"^---\s*\n(.*?)\n---", head, re.S)
    if not m:
        return {}, ""
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip().strip('"').strip("'")
    return fm, head

def owner_of(d):
    for fn in ("_meta.json", "_skillhub_meta.json"):
        p = os.path.join(d, fn)
        if os.path.isfile(p):
            try:
                j = json.load(open(p, encoding="utf-8"))
                return str(j.get("ownerId", "")), str(j.get("source", ""))
            except Exception:
                pass
    return "", ""

def classify(real, name, ownerId="", source=""):
    r = os.path.normpath(real)
    # 真正「自写」：有 local 元数据，或位于个人库 pancras-skill
    if ownerId.startswith("local") or source == "local":
        return "user"
    if r.startswith(PANCRAS):
        return "user"
    if "plugins/cache" in r or "vendor_imports" in r or "/.cache/" in r:
        return "cache"
    if "/.trae-cn/builtin/" in r:
        return "builtin"
    # 标准包安装目录（市场/plugin 安装的 curated skills）
    if any(k in r for k in ["/.agents/skills", "/.codex/skills", "/.claude/skills",
                            "/.opencode/skills", "/.workbuddy/skills", "/.cursor/skills",
                            "/.trae/skills", "/.trae-cn/skills",
                            "/.gemini", "/superpowers/skills"]):
        return "package"
    # 各工具自带的插件/市场技能商店（非标准 skills/ 目录的部分）
    eco = {
        "/.codex/": "codex-eco",
        "/.workbuddy/": "workbuddy-eco",
        "/.gstack/": "gstack-eco",
        "/.codebuddy/": "codebuddy-eco",
        "/.hermes/": "hermes-eco",
        "/.grok/": "grok-eco",
        "/.omx/": "omx-eco",
        "/.bun/": "bun-eco",
        "/.config/": "config-eco",
        "/.omc/": "omc-eco",
        "/.trae/": "trae-eco",
        "/.trae-cn/": "trae-cn-eco",
    }
    for pfx, lbl in eco.items():
        if pfx in r:
            return lbl
    if r.startswith("/Users/pancraslu/WorkingPlace"):
        return "project"
    return "other"

# —— 收集 SKILL.md ——
records = []
for root in SCAN_ROOTS:
    if not os.path.isdir(root):
        continue
    for sp in walk_skill_md(root):
        sd = os.path.dirname(sp)
        fm, _ = parse_fm(sp)
        oid, src = owner_of(sd)
        real = os.path.realpath(sd)
        broken = os.path.islink(sd) and not os.path.exists(sd)
        name = fm.get("name", os.path.basename(sd))
        records.append({
            "path": sp, "name": name,
            "desc": fm.get("description", "")[:160],
            "ownerId": oid, "source": src,
            "is_link": os.path.islink(sd), "real": real,
            "broken": broken, "sha": sha(sp),
            "cls": classify(real, name, oid, src),
            "prefix": name.split("-")[0] if "-" in name else name,
        })

# —— fan-out：聚合目录里的 symlink -> canonical ——
fanout = defaultdict(list)   # real -> [tool dir link paths]
for td in TOOL_DIRS:
    if not os.path.isdir(td):
        continue
    for ent in os.listdir(td):
        lp = os.path.join(td, ent)
        if os.path.islink(lp):
            tgt = os.path.realpath(lp)
            sk = os.path.join(lp, "SKILL.md")
            fanout[tgt].append(lp)

# —— 按 canonical(real) 归并 ——
groups = OrderedDict()
for r in records:
    groups.setdefault(r["real"], []).append(r)

# —— 内容去重：同 sha 视为同一技能（跨缓存副本）——
by_hash = defaultdict(set)
for g in groups.values():
    by_hash[g[0]["sha"]].add(g[0]["real"])
distinct_by_hash = len(by_hash)

# —— MCP ——
def jservers(p, k="mcpServers"):
    try: return list((json.load(open(p)).get(k) or {}).keys())
    except Exception: return []
def toml_srv(p):
    try: return re.findall(r"^\[mcp_servers\.([^\]]+)\]", open(p).read(), re.M)
    except Exception: return []
def yaml_mcp(p):
    try:
        m = re.search(r"mcp_servers:\s*\n((?:\s+[^\n]+\n?)*)", open(p).read())
        return re.findall(r"^\s{2}([a-zA-Z0-9_-]+):", m.group(1), re.M) if m else []
    except Exception: return []

MCP = [
    (os.path.join(HOME, ".claude.json"), "Claude", jservers),
    (os.path.join(HOME, ".codebuddy.json"), "CodeBuddy", jservers),
    (os.path.join(HOME, ".cursor/mcp.json"), "Cursor", jservers),
    (os.path.join(HOME, ".gemini/config/mcp_config.json"), "agy/Gemini", jservers),
    ("/Users/pancraslu/WorkingPlace/Joto/xiao-e/.mcp.json", "xiao-e(prj)", jservers),
    ("/Users/pancraslu/WorkingPlace/Joto/xiao-e/.trae/mcp.json", "Trae(prj)", jservers),
    ("/Users/pancraslu/WorkingPlace/Joto/xiao-e/.agents/mcp_config.json", "agy(prj)", jservers),
    (os.path.join(HOME, ".trae/mcp.json"), "Trae", jservers),
    (os.path.join(HOME, ".trae-cn/mcp.json"), "Trae-CN", jservers),
    (os.path.join(HOME, ".codex/config.toml"), "Codex", toml_srv),
    (os.path.join(HOME, ".config/opencode/opencode.json"), "OpenCode",
     lambda p: list((json.load(open(p)).get("mcp") or {}).keys()) if os.path.isfile(p) else []),
    (os.path.join(HOME, ".hermes/config.yaml"), "Hermes", yaml_mcp),
]
mcp_results = [(t, p, fn(p)) for (p, t, fn) in MCP if os.path.isfile(p) and fn(p)]

# —— 统计 ——
total_entries = len(records)
total_real = len(groups)
broken = [r for r in records if r["broken"]]
user_groups = [g for g in groups.values()
               if any(r["ownerId"].startswith("local") or r["source"] == "local" for r in g)
               or g[0]["cls"] == "user"]
cls_counts = defaultdict(int)
for g in groups.values():
    cls_counts[g[0]["cls"]] += 1
# 缓存副本数（cls==cache 的分组数）
cache_groups = [g for g in groups.values() if g[0]["cls"] == "cache"]

# —— 写报告 ——
out_md = os.path.join(os.path.dirname(os.path.abspath(__file__)), "SKILL_INVENTORY.md")
L = []
L.append("# 本机 Skill & MCP 盘点报告（v2，含去重/分类）\n")
L.append(f"- 报告路径：`{out_md}`")
L.append(f"- 扫描根：{len(SCAN_ROOTS)} 个；聚合目录（symlink 枚举）：{len(TOOL_DIRS)} 个\n")
L.append("## 汇总\n")
L.append(f"- **全部条目（SKILL.md 文件，含 symlink）：{total_entries}**")
L.append(f"- **唯一 canonical 目录（realpath 去重）：{total_real}**")
L.append(f"- **按内容去重后的真实技能数（同 sha 合并）：{distinct_by_hash}**")
L.append(f"- 用户自写（local 归属或位于个人库）：{len(user_groups)}")
L.append(f"- 缓存/派生副本分组：{len(cache_groups)}")
L.append(f"- 失效 symlink：{len(broken)}\n")

L.append("## 分类分布（按 canonical 目录计数）\n")
L.append("| 类别 | 数量 | 说明 |")
L.append("|---|---|---|")
cls_desc = {
    "user":"个人自写(pancras-skill 或 local 元数据)",
    "package":"市场/包安装(.agents/.codex/.claude/.trae/.gemini/superpowers)",
    "cache":"工具缓存副本(.codex/plugins/cache, vendor_imports)",
    "builtin":"Trae-CN 内置",
    "project":"WorkingPlace 其他项目内嵌(含 xiao-e openspec 包)",
    "codex-eco":".codex 自带技能商店", "workbuddy-eco":".workbuddy/plugins 市场",
    "gstack-eco":".gstack 生态", "codebuddy-eco":".codebuddy 技能商店",
    "hermes-eco":".hermes 生态", "grok-eco":".grok 生态",
    "omx-eco":".omx 生态", "bun-eco":".bun 生态",
    "config-eco":".config 内嵌", "omc-eco":".omc 生态",
    "trae-eco":".trae 生态", "trae-cn-eco":".trae-cn 非内置生态",
    "other":"其他",
}
for c in ["user", "package", "cache", "builtin", "project",
          "codex-eco", "workbuddy-eco", "gstack-eco", "codebuddy-eco",
          "hermes-eco", "grok-eco", "omx-eco", "bun-eco", "config-eco",
          "omc-eco", "trae-eco", "trae-cn-eco", "other"]:
    if cls_counts.get(c):
        L.append(f"| {c} | {cls_counts[c]} | {cls_desc[c]} |")
L.append("")

L.append("## 用户自写 skill（应纳入 pancras-skill 统一管理）\n")
for g in user_groups:
    e = g[0]
    links = fanout.get(e["real"], [])
    L.append(f"- **{e['name']}**  cls={e['cls']} ownerId={e['ownerId'] or '-'} source={e['source'] or '-'}")
    L.append(f"  - 真身：`{e['real']}`")
    if links:
        L.append(f"  - 被 {len(links)} 处工具目录软链暴露")
L.append("")

L.append("## 失效 symlink\n")
L.append("（无）\n" if not broken else "\n".join(f"- `{r['path']}` -> `{r['real']}`" for r in broken))
L.append("")

L.append("## MCP server 分布\n")
for t, p, srv in mcp_results:
    L.append(f"- **{t}** (`{p}`)：{', '.join(srv)}")
L.append("")

L.append("## 全量清单（按分类分组）\n")
by_cls = defaultdict(list)
for g in groups.values():
    by_cls[g[0]["cls"]].append(g)
for c in ["user", "package", "cache", "builtin", "project",
          "codex-eco", "workbuddy-eco", "gstack-eco", "codebuddy-eco",
          "hermes-eco", "grok-eco", "omx-eco", "bun-eco", "config-eco",
          "omc-eco", "trae-eco", "trae-cn-eco", "other"]:
    if not by_cls.get(c):
        continue
    L.append(f"### {c}（{len(by_cls[c])}）\n")
    for g in sorted(by_cls[c], key=lambda x: x[0]["name"].lower()):
        e = g[0]
        links = fanout.get(e["real"], [])
        note = f"  ⟂软链×{len(links)}" if links else ""
        L.append(f"- **{e['name']}** [sha:{e['sha']}]{note}")
        if e["desc"]:
            L.append(f"  - {e['desc']}")
        L.append(f"  - `{e['real']}`")
    L.append("")

open(out_md, "w", encoding="utf-8").write("\n".join(L))

# —— 控制台摘要 ——
print(f"全部条目：{total_entries} | 唯一canonical：{total_real} | 内容去重后：{distinct_by_hash}")
print(f"用户自写：{len(user_groups)} | 缓存副本分组：{len(cache_groups)} | 失效链：{len(broken)}")
print("\n分类分布：")
for c in ["user", "package", "cache", "builtin", "project",
          "codex-eco", "workbuddy-eco", "gstack-eco", "codebuddy-eco",
          "hermes-eco", "grok-eco", "omx-eco", "bun-eco", "config-eco",
          "omc-eco", "trae-eco", "trae-cn-eco", "other"]:
    if cls_counts.get(c):
        print(f"  {c:14s} {cls_counts[c]}")
print("\n用户自写 skill：")
for g in user_groups:
    print(f"  - {g[0]['name']}  ({g[0]['cls']})  {g[0]['real']}")
print("\nMCP / 工具：")
for t, p, srv in mcp_results:
    print(f"  {t:12s} {', '.join(srv)}")
print(f"\n报告：{out_md}")
