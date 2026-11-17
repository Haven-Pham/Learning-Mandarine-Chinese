"""Build data/rich-tu/NN.json: full explanations for single words (no lesson needed).

Usage (from the repo root, after build_rich.py):
  python tools/build_rich_words.py "<path to du-lieu-tu-vung>"

Source: <src>/tu/*.json, each {"tu": {word: {vn, ng, us, co, sy, an, cf, lt, mk, tw, mh, vd: [{t, zh, vn}]}}}.
Words outside the TOCFL list (words you add yourself) are allowed.
Output shard NN = code point of the word's first character % 64; the page loads a shard only when it needs it.
Pinyin is generated the same way as in build_rich.py.
"""
import json, os, sys, glob, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_rich as B   # reads sys.argv[1] too; only its helpers are used here

SRC = sys.argv[1]
OUT = os.path.join(B.DATA, "rich-tu")
problems, shards, seen = [], {}, {}
for f in sorted(glob.glob(os.path.join(SRC, "tu", "*.json"))):
    name = os.path.basename(f)
    for w, e in json.load(open(f, encoding="utf-8"))["tu"].items():
        key = B.KEY.get(w, w)
        if key in seen: problems.append(f"{name}: {w} đã có trong {seen[key]}"); continue
        seen[key] = name
        vd = [dict(v, py=v.get("py") or B.pinyin(v["zh"])) for v in e.get("vd", [])]
        fs = B.forms(key)
        has = [v for v in vd if any(x in v["zh"] for x in fs)]
        if not has: problems.append(f"{name}: {w} không có câu ví dụ nào chứa từ")
        if len(vd) > 1 and has and not any(x in vd[1]["zh"] for x in fs):   # e2 feeds the cloze card
            j = vd.index(has[-1]); vd[1], vd[j] = vd[j], vd[1]
        r = {"vn": e.get("vn", ""), "ng": e.get("ng", []), "vd": vd, "us": e.get("us", ""), "co": B.joined(e.get("co")),
             "sy": B.joined(e.get("sy")), "an": B.joined(e.get("an")), "cf": B.joined(e.get("cf")), "lt": e.get("lt", ""),
             "mk": e.get("mk", ""), "tw": e.get("tw", ""), "mh": e.get("mh", "")}
        for k, v in enumerate(vd[:3], 1):
            r[f"e{k}"], r[f"e{k}p"], r[f"e{k}v"], r[f"e{k}t"] = v["zh"], v["py"], v["vn"], v.get("t", "")
        shards.setdefault(ord(key[0]) % 64, {})[key] = {k: v for k, v in r.items() if v not in ("", [], None)}

if os.path.exists(OUT): shutil.rmtree(OUT)
os.makedirs(OUT)
for k, d in shards.items():
    json.dump(d, open(os.path.join(OUT, f"{k:02d}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump({"shards": sorted(shards), "words": len(seen)}, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"))
# Progress file in the source folder (copied to the repo below): which topic words already have a full explanation.
lesson = set()
for f in glob.glob(os.path.join(B.DATA, "rich", "*.json")):
    d = json.load(open(f, encoding="utf-8"))
    if isinstance(d, dict) and isinstance(d.get("words"), dict): lesson |= set(d["words"])
decks = set()   # the 291 rich items of the built-in decks (explained there already)
try:
    for deck in json.load(open(os.path.join(B.DATA, "decks.json"), encoding="utf-8")):
        decks |= {it["w"] for it in deck.get("items", []) if it.get("w")}
except Exception: pass
have = set(seen) | lesson | decks
lines = ["# Tiến độ soạn giải thích đầy đủ", "", "Tự tạo khi chạy `tools/build_rich_words.py`. Đừng sửa tay.", "",
         f"Từ lẻ đã soạn (thư mục `tu/`): **{len(seen)}**", ""]
cdf = os.path.join(SRC, "b1", "chu-de.json")
if os.path.exists(cdf):
    cd = json.load(open(cdf, encoding="utf-8"))
    lines += ["## B1 theo chủ đề", "", "| Chủ đề | Đã có | Tổng | Còn thiếu |", "| --- | --- | --- | --- |"]
    tot = got = 0
    for t in cd["topics"]:
        miss = [w for w in t["words"] if B.KEY.get(w, w) not in have and w not in have and w.split("/")[0] not in have]
        tot += len(t["words"]); got += len(t["words"]) - len(miss)
        lines.append(f"| {t['id']} {t['vn']} | {len(t['words']) - len(miss)} | {len(t['words'])} | {' '.join(miss) if miss else '—'} |")
    lines += ["", f"**B1: {got}/{tot}**", ""]
try:   # whole TOCFL list by band (order = data/tocfl.json, B2/C are in pinyin order)
    toc = json.load(open(os.path.join(B.DATA, "tocfl.json"), encoding="utf-8"))
    lines += ["## Toàn bộ TOCFL theo cấp", "", "| Cấp | Đã có | Tổng | Từ đầu tiên còn thiếu |", "| --- | --- | --- | --- |"]
    for band in toc["bands"]:
        ws = [x[0] for x in toc["words"] if x[2] == band]
        miss = [w for w in ws if w not in have and B.KEY.get(w, w) not in have and w.split("/")[0] not in have]
        lines.append(f"| {band} | {len(ws) - len(miss)} | {len(ws)} | {' '.join(miss[:8]) if miss else '—'} |")
    lines.append("")
except Exception: pass
rieng = sorted(k for k, v in seen.items() if v.startswith("rieng"))
if rieng: lines += ["## Từ riêng (rieng-*.json)", "", " ".join(rieng), ""]
open(os.path.join(SRC, "TIEN-DO.md"), "w", encoding="utf-8").write("\n".join(lines))

dst = os.path.join(B.ROOT, "source", "tu-vung")
if os.path.exists(dst): shutil.rmtree(dst)
shutil.copytree(SRC, dst, ignore=shutil.ignore_patterns("*.tmp", "desktop.ini"))
print(len(seen), "từ trong", len(shards), "shard")
for p in problems: print("  !", p)
