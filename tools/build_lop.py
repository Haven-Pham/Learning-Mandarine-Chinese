"""Build class-notebook decks ("Lớp học · Từ vựng đợt N") into data/decks.json.

Usage (from the repo root, after build_rich.py and build_rich_words.py):
  python tools/build_lop.py "<path to du-lieu-tu-vung>"

Source: <src>/lop/*.json, each
  {"deck": {"id": "lop-tu-vung-dot2", "name": "...", "order": 4.1, "kind": "vocab"},
   "tu": {word: {vn, pos, en, hv, ng, us, co[], sy[], an[], cf[], lt, mk, tw, mh, mi, img, src, vd: [{t, zh, vn}]}}}
Fields are the same as tu/*.json; pinyin of the word and of every example is generated here.
A deck with the same id in data/decks.json is replaced; the other decks are kept in place.
These decks show up in "Thư mục của tôi" on the study page.
Personal decks (interview, autobiography...) live in <src>/ca-nhan/*.json with the same format.
An entry without "vd" (e.g. {} or {"src": "..."}) is filled from the word's full explanation in data/rich-tu,
so a word that is already explained only needs to be listed.
"""
import json, os, sys, glob, re, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_rich as B
from _json_io import load_json

SRC = sys.argv[1]
path = os.path.join(B.DATA, "decks.json")
decks = load_json(path)
toc = {}
for x in load_json(os.path.join(B.DATA, "tocfl.json"))["words"]:
    for f in x[0].replace("(", "/").replace(")", "").split("/"):
        if f: toc.setdefault(f, (x[1], x[2]))

# English meanings from CC-CEDICT (with Taiwan-variant normalization) and Hán Việt from data/vi/
TW_VAR = str.maketrans("台汙菸帳扣搜祕溼艶裡", "臺污煙賬釦蒐秘濕豔裏")
ced_en = {}
with open(os.path.join(B.DATA, "cedict.tsv"), encoding="utf-8") as fh:
    for line in fh:
        p = line.rstrip("\n").split("\t")
        if len(p) < 3: continue
        trad, py_c, defs = p[0], p[1], p[2]
        cleaned = [d.strip() for d in defs.split("/") if d.strip() and not re.match(r"^(variant of|old variant|see |CL:|surname )", d.strip())]
        if not cleaned: continue
        en_s = "; ".join(cleaned[:3])
        is_common = not py_c[:1].isupper() and not defs.startswith("surname")
        if trad not in ced_en or (is_common and not ced_en[trad][1]):
            ced_en[trad] = (en_s, is_common)

EN_EXTRA = {
    "行銷部": "marketing department", "微風細雨": "gentle breeze and fine drizzle",
    "E人": "extrovert (MBTI E-type)", "活到老學到老": "never too old to learn; lifelong learning",
    "計畫": "plan; project; program; to plan", "工作許可證": "work permit",
    "週年慶": "anniversary sale; anniversary celebration", "生活圈": "living circle; daily living area",
    "新住民": "new immigrants; new residents (Taiwan)", "身分證": "national ID card",
    "租屋": "to rent a house or apartment; rental housing", "極簡": "minimalist; minimalism",
    "增肌": "to build muscle; muscle gain", "痘疤": "acne scar",
    "多汗症": "hyperhidrosis; excessive sweating",
}

def lookup_en(w):
    if w in EN_EXTRA: return EN_EXTRA[w]
    for cand in (w, w.translate(TW_VAR)):
        if cand in ced_en: return ced_en[cand][0]
    return ""

vi_hv, hv_char_cnt = {}, collections.defaultdict(collections.Counter)
for f in glob.glob(os.path.join(B.DATA, "vi", "*.json")):
    if f.endswith("index.json"): continue
    for vw, vv in load_json(f).items():
        if not isinstance(vv, dict): continue
        h = (vv.get("hv") or "").strip()
        if not h: continue
        for k in [vw] + vw.replace("(", "/").replace(")", "").split("/"):
            if k: vi_hv.setdefault(k, h)
        cw = re.sub(r"[()]", "", vw.split("/")[0])
        hs = [x for x in re.split(r"\s+", h) if x]
        if len(hs) == len(cw):
            for c, x in zip(cw, hs):
                x = re.sub(r"[/(,.;].*$", "", x.lower())
                if x: hv_char_cnt[c][x] += 1
HV_CHAR = {c: cnt.most_common(1)[0][0] for c, cnt in hv_char_cnt.items()}

def lookup_hv(w):
    if w in vi_hv: return vi_hv[w]
    w2 = w.translate(TW_VAR)
    if w2 in vi_hv: return vi_hv[w2]
    hans = [c for c in w if "\u3400" <= c <= "\u9fff" or "\uf900" <= c <= "\ufaff"]
    if hans and all(c in HV_CHAR for c in hans):
        s = " ".join(HV_CHAR[c] for c in hans)
        return s[:1].upper() + s[1:]
    return ""
rich = {}
for f in glob.glob(os.path.join(B.DATA, "rich-tu", "*.json")):
    if os.path.basename(f) == "index.json": continue
    for w, e in load_json(f).items():
        for k in [w] + w.replace("(", "/").replace(")", "").split("/"):
            if k: rich.setdefault(k, e)
for f in glob.glob(os.path.join(SRC, "lop", "*.json")):   # words explained in a class deck count too
    for w, e in load_json(f)["tu"].items():
        if e.get("vd"): rich.setdefault(w, e)
for dk in decks:   # older decks kept only in data/decks.json (e.g. class notes batch 1)
    if dk.get("kind") != "vocab" or str(dk.get("id", "")).startswith("ca-nhan"): continue
    for it in dk.get("items", []):
        vd = [{"t": it.get(f"e{k}t", ""), "zh": it[f"e{k}"], "vn": it.get(f"e{k}v", ""), "py": it.get(f"e{k}p", "")} for k in (1, 2, 3) if it.get(f"e{k}")]
        if vd and it.get("w"): rich.setdefault(it["w"], dict({k: it[k] for k in ("vn", "pos", "hv", "ng", "us", "co", "sy", "an", "cf", "mk", "tw", "mh") if it.get(k)}, vd=vd))
J = lambda v: v if isinstance(v, str) else B.joined(v)
problems, built = [], {}   # several files may share one deck id (one file per notebook page); items are appended in file order
for f in sorted(glob.glob(os.path.join(SRC, "lop", "*.json"))) + sorted(glob.glob(os.path.join(SRC, "ca-nhan", "*.json"))):
    d = load_json(f)
    meta = d["deck"]
    items = built.setdefault(meta["id"], (meta, []))[1]
    meta = built[meta["id"]][0] if "name" not in meta else meta
    for w, e in d["tu"].items():
        if not e.get("vd"):
            if w not in rich: problems.append(f"{os.path.basename(f)}: {w} chưa có giải thích (cần soạn)"); continue
            e = dict({k: v for k, v in rich[w].items() if k in ("vn", "pos", "hv", "ng", "us", "co", "sy", "an", "cf", "mk", "lt", "tw", "mh", "vd")}, **e)
        py, band = toc.get(w, (None, "Cá nhân" if meta["id"].startswith("ca-nhan") else "Lớp học"))
        it = {"w": w, "py": e.get("py") or py or B.pinyin(w), "pos": e.get("pos", ""), "vn": e.get("vn", ""), "en": e.get("en", "") or lookup_en(w),
              "hv": e.get("hv", "") or lookup_hv(w), "mi": e.get("mi", ""), "mh": e.get("mh", ""), "us": e.get("us", ""),
              "co": J(e.get("co")), "sy": J(e.get("sy")), "an": J(e.get("an")), "cf": J(e.get("cf")),
              "mk": e.get("mk", "") or e.get("lt", ""), "tw": e.get("tw", ""), "img": e.get("img", ""), "band": band,
              "src": e.get("src") or built[meta["id"]][0].get("src", "")}
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
