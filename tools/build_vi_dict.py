"""Vietnamese meaning + Hán Việt for every CVDICT word that is not in data/vi (words the learner adds
themselves, dictionary lookups). Output: data/vi-dict/NN.json, NN = first character code point % 64,
each {word: [vn, hv]}. The page loads a shard only when it needs a word from it.
Run from the repo root: python tools/build_vi_dict.py <CVDICT.u8>
CVDICT: CC BY-SA 4.0 (see licenses/)."""
import json, re, sys, os, glob, unicodedata, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _json_io import load_json

CVD = sys.argv[1]
def numless(s): return re.sub(r"[0-9]", "", s.lower()).replace("u:", "u")

vi = {}
for f in glob.glob("data/vi/*.json"):
    if f.endswith(("index.json",)): continue
    vi.update(load_json(f))

# Hán Việt reading per character: majority reading in data/vi, then readings that depend on pinyin
use = collections.defaultdict(collections.Counter)
for w, v in vi.items():
    hv = [h for h in re.split(r"\s+", (v.get("hv") or "").strip()) if h]
    if len(hv) == len(w):
        for c, h in zip(w, hv):
            h = re.sub(r"[/(].*$", "", h.lower())
            if h and re.match(r"^[a-zà-ỹđ]+$", h): use[c][h] += 1
DEFAULT = {c: cnt.most_common(1)[0][0] for c, cnt in use.items()}
POLY = {("長", "zhang"): "trưởng", ("長", "chang"): "trường", ("樂", "yue"): "nhạc", ("樂", "le"): "lạc", ("重", "chong"): "trùng",
        ("行", "hang"): "hàng", ("好", "hao4"): "hiếu", ("為", "wei4"): "vị", ("中", "zhong4"): "trúng", ("少", "shao4"): "thiếu",
        ("傳", "zhuan"): "truyện", ("處", "chu4"): "xứ", ("數", "shu3"): "sổ", ("相", "xiang4"): "tướng", ("將", "jiang4"): "tướng",
        ("降", "jiang"): "giáng", ("降", "xiang"): "hàng", ("難", "nan4"): "nạn", ("興", "xing4"): "hứng", ("惡", "wu"): "ố",
        ("著", "zhu"): "trứ", ("乾", "qian"): "càn", ("朝", "chao"): "triều", ("會", "kuai"): "cối", ("省", "xing"): "tỉnh",
        ("差", "chai"): "sai", ("給", "ji"): "cấp", ("覺", "jiao"): "giác", ("調", "tiao"): "điều", ("調", "diao"): "điệu"}
def hv_char(c, syl):
    base, tone = numless(syl), re.sub(r"\D", "", syl)
    return POLY.get((c, base + tone)) or POLY.get((c, base)) or DEFAULT.get(c, "")

def clean(defs):
    out = []
    for d in defs:
        d = d.strip()
        if not d or d.startswith("LT:") or re.match(r"^(biến thể|dạng cổ|xem |viết tắt cho [A-Za-z])", d): continue
        d = re.sub(r"\[[a-z0-9 :]+\]", "", d).replace("|", "/")
        out += [x.strip() for x in d.split(";") if x.strip()]
    return "; ".join(list(dict.fromkeys(out))[:5])

entries = collections.defaultdict(list)
for line in open(CVD, encoding="utf-8"):
    if line.startswith("#"): continue
    m = re.match(r"(\S+) (\S+) \[([^\]]*)\] /(.*)/", line.strip())
    if m: entries[m.group(1)].append((m.group(3), m.group(4).split("/")))

shards = collections.defaultdict(dict)
for w, es in entries.items():
    if (vi.get(w) or {}).get("vn") or not re.match(r"^[㐀-鿿豈-﫿]+$", w): continue
    # common entries before surnames, places and names
    es = sorted(es, key=lambda e: (e[0][:1].isupper(), bool(e[1]) and e[1][0].startswith("họ ")))
    vn = clean(es[0][1])
    if len(es) > 1 and not es[1][0][:1].isupper():
        more = clean(es[1][1])
        if more and more not in vn: vn = (vn + " | " + more) if vn else more
    if not vn: continue
    syls = es[0][0].split()
    hv = [hv_char(c, s) for c, s in zip(w, syls)] if len(syls) == len(w) else [DEFAULT.get(c, "") for c in w]
    hvs = " ".join(hv) if all(hv) else ""
    shards[ord(w[0]) % 64][w] = [vn, hvs[:1].upper() + hvs[1:]]

os.makedirs("data/vi-dict", exist_ok=True)
total = 0
for k, d in shards.items():
    json.dump(d, open(f"data/vi-dict/{k:02d}.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    total += len(d)
print(total, "words in", len(shards), "shards")
