"""Print the next N Band C words that still lack a full explanation. Usage: python tools/next_c.py [N]"""
import json, glob, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = 'G:/My Drive/Mandarine Chinese/10 Website học tiếng Hoa/du-lieu-tu-vung/tu'
N = int(sys.argv[1]) if len(sys.argv) > 1 else 50
have = set()
for f in glob.glob(SRC + '/*.json'):
    d = json.load(open(f, encoding='utf-8'))
    if 'tu' in d: have |= set(d['tu'])
for f in glob.glob(os.path.join(ROOT, 'data/rich-tu/*.json')):
    d = json.load(open(f, encoding='utf-8'))
    if isinstance(d, dict) and 'shards' not in d: have |= set(d)
t = json.load(open(os.path.join(ROOT, 'data/tocfl.json'), encoding='utf-8'))['words']
import re
def forms(k): return {re.sub(r'[()]', '', f) for f in k.split('/')} | {re.sub(r'\([^)]*\)', '', f) for f in k.split('/')}
have = set().union(*(forms(k) | {k} for k in have))
lower = {w[0] for w in t if w[2] != 'C'}
C = [w for w in t if w[2] == 'C' and w[0] not in have and w[0] not in lower]
print(len(C)); print(' '.join(w[0] + '(' + w[1] + ')' for w in C[:N]))
