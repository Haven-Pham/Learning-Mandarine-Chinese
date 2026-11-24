"""Build data/dictation_topics.json (Chép chính tả) from the source folder.

Usage (from the repo root):
  python tools/build_chinh_ta.py "<path to du-lieu-tu-vung>"

Source: <src>/chinh-ta/
  00-goc.json        {"bai_goc": [...]}  the original topics, already in the app format, kept as is
  <band>-NN.json     {"bai": [ {"id", "loai": dialogue|story|tocfl|news, "ten", "band": "TOCFL A2 · Chủ đề",
                                "mo_ta", "tu": [["từ", "nghĩa"], ...], "cau": [["người nói", "câu", "nghĩa"], ...]} ]}
Người nói decides the voice: 小姐/女/林經理/房東/顧客/同學 → female, 先生/男/小陳/傑克/記者/經理 → male, otherwise narrator.
Pinyin of every sentence and word is generated here. Sentence length (Han characters) is checked per band:
  Band A 5–12, B1 8–18, B2 12–24, C 14–30. Longer sentences are reported so they can be split.
"""
import json, os, re, sys, glob, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_rich as B
from _json_io import load_json

SRC = sys.argv[1]
CAT = {"dialogue": "Đoạn hội thoại thực tế", "story": "Câu chuyện ngắn", "tocfl": "TOCFL Listening", "news": "Tin tức"}
LIMIT = {"A": (5, 12), "B1": (8, 18), "B2": (12, 24), "C": (14, 30)}
HAN = re.compile(r"[㐀-鿿]")
toc = {w: (py, band) for w, py, band, *_ in load_json(os.path.join(B.DATA, "tocfl.json"))["words"]}

def wpy(w):
    if w in toc: return toc[w][0]
    if w in B.CED: return B.CED[w][0]
    p = B.pinyin(w).rstrip(".").replace(" ", "")
    return p[:1].lower() + p[1:]

def level(band):
    if "A1" in band or "A2" in band or "Band A" in band: return "A"
    if "B2" in band: return "B2"
    if "B1" in band: return "B1"
    return "C"

base = load_json(os.path.join(SRC, "chinh-ta", "00-goc.json"))["bai_goc"]
new, warn = {}, []
for f in sorted(glob.glob(os.path.join(SRC, "chinh-ta", "*.json"))):
    if os.path.basename(f) == "00-goc.json": continue
    for t in load_json(f)["bai"]:
        if t["id"] in new: sys.exit(f"Trùng id {t['id']} ({os.path.basename(f)})")
        lo, hi = LIMIT[level(t["band"])]
        for _, zh, _ in t["cau"]:
            n = len(HAN.findall(zh))
            if not lo <= n <= hi: warn.append(f"{t['id']}: {n} chữ — {zh}")
        new[t["id"]] = {
            "id": t["id"], "category": t["loai"], "categoryName": CAT[t["loai"]], "title": t["ten"], "band": t["band"],
            "duration": f"{len(t['cau'])} câu", "desc": t["mo_ta"],
            "vocab": [{"w": w, "py": wpy(w), "vn": vn, "band": toc.get(w, (0, ""))[1]} for w, vn in t["tu"]],
            "sentences": [{"speaker": sp, "zh": zh, "py": B.pinyin(zh), "vn": vn} for sp, zh, vn in t["cau"]],
        }
# a lesson in a new-format file with the same id as an original one replaces it (01-goc-tach-cau.json: the originals split into short sentences)
out = [new.pop(t["id"], t) for t in base] + list(new.values())

json.dump(out, open(os.path.join(B.DATA, "dictation_topics.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
cnt = {}
for t in out: cnt[level(t["band"])] = cnt.get(level(t["band"]), 0) + 1
print(f"{len(out)} bài chép chính tả:", cnt, f"· {sum(len(t['sentences']) for t in out)} câu")
for w in warn: print("  độ dài:", w)

dst = os.path.join(B.ROOT, "source", "tu-vung")
if os.path.isdir(dst): shutil.rmtree(dst)
shutil.copytree(SRC, dst, ignore=shutil.ignore_patterns("*.tmp", "desktop.ini"))
