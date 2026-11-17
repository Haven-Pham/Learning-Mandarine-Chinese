"""Build class-notebook decks ("Lớp học · Từ vựng đợt N") into data/decks.json.

Usage (from the repo root, after build_rich.py and build_rich_words.py):
  python tools/build_lop.py "<path to du-lieu-tu-vung>"

Source: <src>/lop/*.json, each
  {"deck": {"id": "lop-tu-vung-dot2", "name": "...", "order": 4.1, "kind": "vocab"},
   "tu": {word: {vn, pos, en, hv, ng, us, co[], sy[], an[], cf[], lt, mk, tw, mh, mi, img, src, vd: [{t, zh, vn}]}}}
Fields are the same as tu/*.json; pinyin of the word and of every example is generated here.
A deck with the same id in data/decks.json is replaced; the other decks are kept in place.
These decks show up in "Thư mục của tôi" on the study page.
"""
import json, os, sys, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_rich as B

SRC = sys.argv[1]
path = os.path.join(B.DATA, "decks.json")
decks = json.load(open(path, encoding="utf-8"))
toc = {}
for x in json.load(open(os.path.join(B.DATA, "tocfl.json"), encoding="utf-8"))["words"]:
    for f in x[0].replace("(", "/").replace(")", "").split("/"):
        if f: toc.setdefault(f, (x[1], x[2]))
problems, built = [], {}   # several files may share one deck id (one file per notebook page); items are appended in file order
for f in sorted(glob.glob(os.path.join(SRC, "lop", "*.json"))):
    d = json.load(open(f, encoding="utf-8"))
    meta = d["deck"]
    items = built.setdefault(meta["id"], (meta, []))[1]
    meta = built[meta["id"]][0] if "name" not in meta else meta
    for w, e in d["tu"].items():
        py, band = toc.get(w, (None, "Lớp học"))
        it = {"w": w, "py": e.get("py") or py or B.pinyin(w), "pos": e.get("pos", ""), "vn": e.get("vn", ""), "en": e.get("en", ""),
              "hv": e.get("hv", ""), "mi": e.get("mi", ""), "mh": e.get("mh", ""), "us": e.get("us", ""),
              "co": B.joined(e.get("co")), "sy": B.joined(e.get("sy")), "an": B.joined(e.get("an")), "cf": B.joined(e.get("cf")),
              "mk": e.get("mk", "") or e.get("lt", ""), "tw": e.get("tw", ""), "img": e.get("img", ""), "band": band,
              "src": e.get("src") or meta.get("src", "")}
        if e.get("ng"): it["ng"] = e["ng"]
        vd = e.get("vd", [])
        if not any(w in v["zh"] for v in vd): problems.append(f"{os.path.basename(f)}: {w} không có câu chứa từ")
        if len(vd) > 1 and w not in vd[1]["zh"]:   # e2 feeds the cloze card
            j = next((k for k, v in enumerate(vd) if w in v["zh"]), None)
            if j is not None: vd[1], vd[j] = vd[j], vd[1]
        for k, v in enumerate(vd[:3], 1):
            it[f"e{k}"], it[f"e{k}p"], it[f"e{k}v"] = v["zh"], v.get("py") or B.pinyin(v["zh"]), v["vn"]
        if any(x["w"] == w for x in items): problems.append(f"{os.path.basename(f)}: {w} trùng trong bộ"); continue
        items.append({k: v for k, v in it.items() if v not in ("", [], None)})
for did, (meta, items) in built.items():
    deck = dict(meta, items=items)
    i = next((k for k, x in enumerate(decks) if x.get("id") == did), None)
    if i is None: decks.append(deck)
    else: decks[i] = deck
    print(did, len(items), "từ")
json.dump(decks, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
for p in problems: print("  !", p)
