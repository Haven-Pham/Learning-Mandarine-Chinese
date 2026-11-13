"""Build data/rich/*.json from the lesson source folder (du-lieu-tu-vung).

Usage (from the repo root):
  python tools/build_rich.py "<path to du-lieu-tu-vung>"

Source layout:  <src>/<band>/chu-de.json (topic list) and <src>/<band>/<topic>-NN.json (lessons).
Each lesson has hoi_thoai, doan_van and tu {word: {vn, ng, us, co, sy, an, cf, mk, tw, mh, vd:[{t, zh, vn}]}}.
Pinyin is generated here: TOCFL readings (Taiwan) first, then CC-CEDICT. A sentence can override it with "py".
The source is also copied to source/tu-vung/ so it is kept in the repo.
"""
import json, os, re, shutil, sys

SRC = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

# ---------------- pinyin ----------------
def forms(word):
    out = []
    for f in word.split("/"):
        out += [re.sub(r"[()]", "", f), re.sub(r"\([^)]*\)", "", f)]
    return [f for f in dict.fromkeys(out) if f]

tocfl = json.load(open(os.path.join(DATA, "tocfl.json"), encoding="utf-8"))["words"]
PY, KEY = {}, {}          # form -> pinyin (syllables of a word joined), form -> TOCFL key
for w, py, band, *_ in tocfl:
    pys = py.split("/")
    for part_w, part_py in zip(w.split("/"), pys + [pys[-1]] * 9):
        part_py = part_py.strip()
        # "上(面)" / "shàng(miàn)": the long form reads shàngmiàn, the short form shàng
        long_f, short_f = re.sub(r"[()]", "", part_w), re.sub(r"\([^)]*\)", "", part_w)
        long_p, short_p = re.sub(r"[()]", "", part_py), re.sub(r"\([^)]*\)", "", part_py)
        if "(" not in part_w: long_p = short_p   # "瓶" paired with "píng(zi)" reads píng
        for f, fp in ((long_f, long_p), (short_f, short_p)):
            if f: KEY.setdefault(f, w); PY.setdefault(f, fp)
    for f in forms(w): KEY.setdefault(f, w)

VOWEL_START = set("aāáǎàoōóǒòeēéěè")
def join_syl(py):
    out = ""
    for syl in py.split():
        if out and syl[:1].lower() in VOWEL_START: out += "'"
        out += syl
    return out

CED = {}
for line in open(os.path.join(DATA, "cedict.tsv"), encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    if len(p) < 3: continue
    trad, py, defs = p[0], p[1], p[2]
    lower = not py[:1].isupper() and not defs.startswith("surname")
    if trad not in CED or (lower and not CED[trad][1]):
        CED[trad] = (join_syl(py), lower)

# particles and common single characters as read in running text (TOCFL writes no tone sandhi, so neither do we)
SINGLE = {"的": "de", "了": "le", "嗎": "ma", "呢": "ne", "吧": "ba", "啊": "a", "著": "zhe", "得": "de", "地": "de", "個": "ge",
          "都": "dōu", "還": "hái", "會": "huì", "要": "yào", "為": "wèi", "一": "yī", "不": "bù", "喔": "o", "哇": "wa", "唉": "āi",
          "假": "jiǎ", "率": "lǜ", "長": "cháng", "行": "xíng", "重": "zhòng", "好": "hǎo", "教": "jiāo", "只": "zhǐ", "給": "gěi", "說": "shuō"}
PUNCT = {"。": ".", "，": ",", "、": ",", "？": "?", "！": "!", "：": ":", "；": ";", "「": '"', "」": '"', "『": '"', "』": '"',
         "（": "(", "）": ")", "…": "…", "～": "~", "—": "—"}
HAN = re.compile(r"[㐀-鿿]")
NUM = set("一二兩三四五六七八九十幾這那每哪半")
# fixed phrases that a dictionary would join or read wrongly in running text
CUSTOM = {"要不要": "yào bù yào", "有沒有": "yǒu méi yǒu", "是不是": "shì bù shì", "會不會": "huì bù huì", "能不能": "néng bù néng",
          "從來沒": "cónglái méi", "都會": "dōu huì", "都是": "dōu shì", "下個月": "xià ge yuè", "上個月": "shàng ge yuè", "這個": "zhège",
          "一個": "yī ge", "那個": "nàge"}
CLOSE = set('.,?!:;)…~"')

def options(text, i):
    """Possible tokens starting at i: (length, pinyin, cost). TOCFL words are preferred over CC-CEDICT words."""
    out = []
    for L in range(min(6, len(text) - i), 0, -1):
        seg = text[i:i + L]
        if not all(HAN.match(x) for x in seg): continue
        if seg.startswith("個") and L > 1 and i > 0 and text[i - 1] in NUM: continue   # 兩個人 = liǎng ge rén
        if seg in CUSTOM:
            out.append((L, CUSTOM[seg], 0.9)); continue
        if L == 1:
            if seg == "得" and i > 0 and text[i - 1] in "我你他她們就還也都": out.append((1, "děi", 1.6)); continue
            out.append((1, SINGLE.get(seg) or PY.get(seg) or CED.get(seg, (seg, 0))[0], 1.6))
        elif seg in PY:
            out.append((L, PY[seg], 1.0))
        elif seg in CED and CED[seg][1]:
            out.append((L, CED[seg][0], 1.25))
    return out

def pinyin(text):
    n = len(text)
    best = [(0.0, [])] + [(1e9, None)] * n
    for i in range(n):
        cost, toks = best[i]
        if toks is None: continue
        c = text[i]
        if not HAN.match(c):
            tok = PUNCT.get(c, c)
            if cost < best[i + 1][0]: best[i + 1] = (cost, toks + [tok])
            continue
        for L, p, w in options(text, i):
            if cost + w < best[i + L][0]: best[i + L] = (cost + w, toks + [p])
    out = ""
    for t in best[n][1]:
        if t in CLOSE or not out or out.endswith("("): out += t
        else: out += " " + t
    out = re.sub(r"\s+", " ", out).strip()
    return re.sub(r"(^|[.?!]\s+)([a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü])", lambda m: m.group(1) + m.group(2).upper(), out)

# ---------------- build ----------------
def joined(items):
    return " · ".join(f"{x.split('|')[0]} ({x.split('|')[1]})" if "|" in x else x for x in items or [])

problems = []
def build_band(band_dir, band):
    topics = json.load(open(os.path.join(band_dir, "chu-de.json"), encoding="utf-8"))["topics"]
    order = {t["id"]: i for i, t in enumerate(topics)}
    files = sorted((f for f in os.listdir(band_dir) if re.match(r"^[a-z]+-\d+\.json$", f)),
                   key=lambda f: (order.get(f.split("-")[0], 99), f))
    lessons, words = [], {}
    for f in files:
        L = json.load(open(os.path.join(band_dir, f), encoding="utf-8"))
        keys = []
        for w, e in L["tu"].items():
            key = KEY.get(w, w)
            if w not in KEY: problems.append(f"{f}: {w} không có trong bảng TOCFL")
            vd = [dict(v, py=v.get("py") or pinyin(v["zh"])) for v in e.get("vd", [])]
            fs = forms(key)
            has = [v for v in vd if any(x in v["zh"] for x in fs)]
            if not has: problems.append(f"{f}: {w} không có câu ví dụ nào chứa từ")
            # e2 is the cloze sentence, so it must contain the word
            if len(vd) > 1 and has and not any(x in vd[1]["zh"] for x in fs):
                j = vd.index(has[-1]); vd[1], vd[j] = vd[j], vd[1]
            r = {"vn": e.get("vn", ""), "ng": e.get("ng", []), "vd": vd, "us": e.get("us", ""), "co": joined(e.get("co")),
                 "sy": joined(e.get("sy")), "an": joined(e.get("an")), "cf": joined(e.get("cf")), "mk": e.get("mk", ""),
                 "tw": e.get("tw", ""), "mh": e.get("mh", ""), "bai": L["id"]}
            for k, v in enumerate(vd[:3], 1):
                r[f"e{k}"], r[f"e{k}p"], r[f"e{k}v"], r[f"e{k}t"] = v["zh"], v["py"], v["vn"], v.get("t", "")
            words[key] = {k: v for k, v in r.items() if v not in ("", [], None)}
            keys.append(key)
        hd = [{"s": s, "zh": zh, "py": pinyin(zh), "vn": vn} for s, zh, vn in L.get("hoi_thoai", [])]
        dv = L.get("doan_van")
        if dv: dv = dict(dv, py=dv.get("py") or pinyin(dv["zh"]))
        lessons.append({"id": L["id"], "band": band, "chu_de": L["chu_de"], "ten": L["ten"], "tinh_huong": L.get("tinh_huong", ""),
                        "words": keys, "hoi_thoai": hd, "doan_van": dv})
    topic_names = {t["id"]: {"vn": t["vn"], "zh": t["zh"]} for t in topics}
    return {"band": band, "topics": topic_names, "lessons": lessons, "words": words}

if __name__ == "__main__":
    os.makedirs(os.path.join(DATA, "rich"), exist_ok=True)
    index = []
    for band in sorted(os.listdir(SRC)):
        d = os.path.join(SRC, band)
        if not os.path.isdir(d) or not os.path.exists(os.path.join(d, "chu-de.json")): continue
        out = build_band(d, band.upper())
        if not out["lessons"]: continue
        json.dump(out, open(os.path.join(DATA, "rich", band + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        index.append(band + ".json")
        print(f"{band}: {len(out['lessons'])} bài, {len(out['words'])} từ")
    json.dump({"files": index}, open(os.path.join(DATA, "rich", "index.json"), "w", encoding="utf-8"))
    dst = os.path.join(ROOT, "source", "tu-vung")
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(SRC, dst, ignore=shutil.ignore_patterns("*.tmp", "desktop.ini"))
    for p in problems: print("  !", p)
