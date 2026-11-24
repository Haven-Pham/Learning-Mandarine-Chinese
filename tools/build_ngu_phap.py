"""Build data/ngu-phap.json (grammar points shown on the Ngữ pháp page) from the source folder.

Usage (from the repo root):
  python tools/build_ngu_phap.py "<path to du-lieu-tu-vung>"

Source: <src>/ngu-phap/*.json, each {"mau": [ ...grammar points... ]}. One grammar point:
  {"id": "shi_de", "nhom": "A1/A2" | "B1" | "B2" | "C" | "Khẩu ngữ", "band": "TOCFL A2",
   "ten": "Tên tiếng Việt (chữ Hán)", "zh": "是…的", "cong_thuc": "S + 是 + … + V + 的",
   "tom_tat": "...", "dk1": ["tiêu đề", "giải thích"], "dk2": ["tiêu đề", "giải thích"],
   "sai": ["câu sai", "vì sao sai"], "dung": ["câu đúng", "vì sao đúng"],
   "vd": [["tình huống", "câu", "nghĩa"], ... 3 câu],
   "bai_tap": {"q": "câu có ___", "dap": [["đáp án", true, "giải thích"], ["...", false, "..."]]},
   "nguon": "TBCL / Vở ghi lớp học 03/11/2026 / ..."}
Pinyin of every sentence is generated here (Taiwan readings first). An id may appear only once.
The app merges these points after the built-in ones (an id already built in is skipped).
"""
import json, os, sys, glob, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_rich as B
from _json_io import load_json

SRC = sys.argv[1]
TAGS = [("cinnabar-subtle", "text-primary"), ("jade-subtle", "text-secondary"), ("amber-subtle", "text-tertiary")]
ORDER = {"A1/A2": 0, "B1": 1, "B2": 2, "C": 3, "Khẩu ngữ": 4}

out, seen = [], set()
for f in sorted(glob.glob(os.path.join(SRC, "ngu-phap", "*.json"))):
    for m in load_json(f)["mau"]:
        if m["id"] in seen: sys.exit(f"Trùng id {m['id']} ({os.path.basename(f)})")
        seen.add(m["id"])
        assert m["nhom"] in ORDER, (m["id"], m["nhom"])
        assert len(m["vd"]) >= 2, m["id"]
        item = {
            "id": m["id"], "name": m["ten"], "zh": m["zh"], "formula": m["cong_thuc"],
            "band": m["band"], "levelGroup": m["nhom"], "summary": m["tom_tat"],
            "cond1": {"title": m["dk1"][0], "desc": m["dk1"][1]},
            "cond2": {"title": m["dk2"][0], "desc": m["dk2"][1]},
            "examples": [{"zh": zh, "py": B.pinyin(zh), "vn": vn, "tag": t,
                          "tagColor": TAGS[i % 3][0], "tagText": TAGS[i % 3][1]} for i, (t, zh, vn) in enumerate(m["vd"])],
            "src": m.get("nguon", ""),
        }
        if m.get("sai"): item["wrong"] = {"zh": m["sai"][0], "py": B.pinyin(m["sai"][0]), "reason": m["sai"][1]}
        item["correct"] = {"zh": m["dung"][0], "py": B.pinyin(m["dung"][0]), "reason": m["dung"][1]}
        if m.get("bai_tap"):
            q = m["bai_tap"]
            assert sum(1 for d in q["dap"] if d[1]) == 1, m["id"]
            item["quiz"] = {"q": q["q"], "opts": [{"key": f"o{i}", "label": d[0], "correct": d[1],
                            "explain": ("<strong>Chính xác!</strong> " if d[1] else "<strong>Chưa đúng.</strong> ") + d[2]}
                            for i, d in enumerate(q["dap"])]}
        out.append(item)

out.sort(key=lambda x: ORDER[x["levelGroup"]])   # stable: keeps file order inside a group
json.dump(out, open(os.path.join(B.DATA, "ngu-phap.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
cnt = {}
for x in out: cnt[x["levelGroup"]] = cnt.get(x["levelGroup"], 0) + 1
print(f"{len(out)} mẫu ngữ pháp:", cnt)

dst = os.path.join(B.ROOT, "source", "tu-vung")
if os.path.isdir(dst): shutil.rmtree(dst)
shutil.copytree(SRC, dst, ignore=shutil.ignore_patterns("*.tmp", "desktop.ini"))
