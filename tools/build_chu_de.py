"""Build data/chu-de.json: vocabulary topics across every band (Novice → C) for the Từ vựng page.

Usage (from the repo root):
  python tools/build_chu_de.py "<path to du-lieu-tu-vung>" [--xem <topic id>]

Source: <src>/chu-de/chu-de.json  {"chu_de": [{id, vn, zh_ten, icon, kw[], zh[], them[], bo[]}]}
A word joins a topic when its Vietnamese meaning contains a keyword of kw (whole words),
or the word contains a morpheme of zh, or it is listed in them; words in bo are never added.
Candidates: every TOCFL word + the class-notebook decks + tu/rieng-*.json. Meanings come from data/vi/*.json,
the full explanations (data/rich-tu) and the decks. Words are ordered by band (Novice 1 → C), then by TOCFL order.
--xem <id> prints the words of one topic to review them.
"""
import json, os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SRC = sys.argv[1]
XEM = sys.argv[sys.argv.index("--xem") + 1] if "--xem" in sys.argv else None
BANDS = ["Novice 1", "Novice 2", "A1", "A2", "B1", "B2", "C", "Lớp học"]

tocfl = json.load(open(os.path.join(DATA, "tocfl.json"), encoding="utf-8"))["words"]
cands, meaning, band = [], {}, {}
for i, (w, py, b, *_) in enumerate(tocfl):
    if w not in band: cands.append(w); band[w] = (BANDS.index(b) if b in BANDS else 6, i)
vi = {}
for f in glob.glob(os.path.join(DATA, "vi", "*.json")):
    d = json.load(open(f, encoding="utf-8"))
    if isinstance(d, dict): vi.update(d)
for f in glob.glob(os.path.join(DATA, "rich-tu", "*.json")):
    d = json.load(open(f, encoding="utf-8"))
    if isinstance(d, dict):
        for w, e in d.items():
            if isinstance(e, dict): meaning[w] = e.get("vn", "")   # short main meaning only (long explanations add noise)
for deck in json.load(open(os.path.join(DATA, "decks.json"), encoding="utf-8")):
    if not deck["id"].startswith("lop-") or deck.get("kind") != "vocab": continue
    for it in deck.get("items", []):
        w = it.get("w")
        if not w: continue
        if w not in band: cands.append(w); band[w] = (BANDS.index("Lớp học"), 10**6 + len(band))
        meaning.setdefault(w, it.get("vn", ""))
for f in glob.glob(os.path.join(SRC, "tu", "rieng-*.json")):
    for w, e in json.load(open(f, encoding="utf-8")).get("tu", {}).items():
        if w not in band: cands.append(w); band[w] = (6, 2 * 10**6 + len(band))
        meaning.setdefault(w, e.get("vn", ""))

def mean(w):
    parts = [meaning.get(w, "")]
    for f in w.split("/"):
        f = re.sub(r"[()]", "", f)
        if f in vi: parts.append(vi[f].get("vn", ""))
    # only the first two senses of each source: later senses (often rare, from the dictionary) add noise
    return " ; ".join("; ".join(p.split(";")[:2]) for p in parts if p).lower()

def forms(w):
    return {re.sub(r"[()]", "", f) for f in w.split("/")} | {re.sub(r"\([^)]*\)", "", f) for f in w.split("/")}

topics = json.load(open(os.path.join(SRC, "chu-de", "chu-de.json"), encoding="utf-8"))["chu_de"]
out = []
for t in topics:
    kw = [re.compile(r"(?<!\w)" + re.escape(k.lower()) + r"(?!\w)") for k in t["kw"]]
    bo = set(t.get("bo", [])); them = set(t.get("them", []))
    words = []
    for w in cands:
        fs = forms(w)
        if fs & bo or w in bo: continue
        hit = w in them or bool(fs & them)
        if not hit: hit = any(z in f for z in t["zh"] for f in fs)
        if not hit:
            m = mean(w)
            hit = bool(m) and any(k.search(m) for k in kw)
        if hit: words.append(w)
    words.sort(key=lambda w: band[w])
    out.append({"id": "cd-" + t["id"], "vn": t["vn"], "zh": t["zh_ten"], "icon": t.get("icon", ""), "words": words})
    if XEM == t["id"]:
        for w in words: print(BANDS[band[w][0]], w, "—", mean(w)[:70])

json.dump(out, open(os.path.join(DATA, "chu-de.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(out)} chủ đề:", ", ".join(f"{t['vn']} {len(t['words'])}" for t in out))
