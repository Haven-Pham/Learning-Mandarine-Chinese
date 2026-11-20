#!/bin/sh
# Build everything from the source folder, commit and push, then mirror the repo to Drive. Usage: sh tools/push_all.sh "message"
set -e
cd "$(dirname "$0")/.."
SRC="G:/My Drive/Mandarine Chinese/10 Website học tiếng Hoa/du-lieu-tu-vung"
python tools/build_rich.py "$SRC" >/dev/null
python tools/build_rich_words.py "$SRC" | tail -2
python tools/build_lop.py "$SRC" >/dev/null
python tools/build_chu_de.py "$SRC" >/dev/null
python tools/build_ngu_phap.py "$SRC" >/dev/null
python tools/build_chinh_ta.py "$SRC" >/dev/null
grep "^| C " "$SRC/TIEN-DO.md"
git stash -q 2>/dev/null; git pull --rebase -q; git stash pop -q 2>/dev/null || true
n=$(grep -o 'shtv-[0-9]*' sw.js | head -1 | cut -d- -f2); sed -i "s/shtv-$n/shtv-$((n+1))/" sw.js
git add -A 2>/dev/null
git commit -q -m "$1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" 2>/dev/null
git push -q 2>/dev/null
git log --oneline -1 | cat
robocopy . "/g/My Drive/Mandarine Chinese/10 Website học tiếng Hoa/website" //MIR //XD .git //NJH //NJS //NFL //NDL >/dev/null || true
