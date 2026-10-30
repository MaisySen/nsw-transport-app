"""Contact sheets for the native audit: one PNG per surface, a row per scenario, a column per device, text size
and appearance, each cell labelled, anything cut off marked in red. Usage: sheets.py SHOTS_DIR OUT_DIR"""
import glob, json, os, sys
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
recs = []
for m in glob.glob(os.path.join(src, 'manifest-*.jsonl')):
    for line in open(m):
        line = line.strip()
        if line:
            recs.append(json.loads(line))

def font(n):
    for f in ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, n)
            except Exception:
                pass
    try:
        return ImageFont.load_default(size=n)
    except TypeError:
        return ImageFont.load_default()

DEV = ['se', 'std', 'promax', '40mm', '45mm', '49mm']
NAMES = {'se': 'iPhone SE', 'std': 'iPhone 6.1"', 'promax': 'Pro Max', '40mm': '40 mm', '45mm': '45 mm', '49mm': '49 mm Ultra'}
f_title, f_lab, f_row = font(30), font(15), font(18)
summary = []
surfaces = sorted({r['surface'] for r in recs if r.get('file')})
for s in surfaces:
    rs = [r for r in recs if r['surface'] == s and r.get('file') and os.path.exists(os.path.join(src, r['file']))]
    if not rs:
        continue
    scen = list(dict.fromkeys(r['scenario'] for r in rs))
    cols = sorted({(r['device'], r['type'], r['scheme']) for r in rs},
                  key=lambda c: (DEV.index(c[0]) if c[0] in DEV else 9, c[1] != 'default', c[2] != 'light'))
    imgs = {}
    for r in rs:
        im = Image.open(os.path.join(src, r['file'])).convert('RGB')
        im = im.resize((max(1, im.width // 2), max(1, im.height // 2)))  # 2x renders back to points
        imgs[(r['scenario'], r['device'], r['type'], r['scheme'])] = (im, r)
    cw = max(i.width for i, _ in imgs.values()) + 16
    ch = max(i.height for i, _ in imgs.values()) + 44
    left, top = 150, 70
    W, H = left + cw * len(cols), top + ch * len(scen)
    sheet = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(sheet)
    bad = [r for r in rs if not r['fits']]
    d.text((16, 16), f"{s}   ({len(rs)} shots, {'all fit' if not bad else str(len(bad)) + ' cut off'})", fill='black' if not bad else (200, 0, 0), font=f_title)
    for j, sc in enumerate(scen):
        y = top + j * ch
        d.text((12, y + ch // 2 - 10), sc, fill='black', font=f_row)
        for i, c in enumerate(cols):
            k = (sc,) + c
            if k not in imgs:
                continue
            im, r = imgs[k]
            x = left + i * cw
            sheet.paste(im, (x + 8, y + 4))
            lab = f"{NAMES.get(c[0], c[0])} · {c[1]} · {c[2]}"
            ok = r['fits']
            o = r['overflow']
            if not ok:
                lab += "  CUT t%s l%s b%s r%s" % tuple(o)
                d.rectangle([x + 6, y + 2, x + 10 + im.width, y + 6 + im.height], outline=(220, 0, 0), width=3)
            d.text((x + 8, y + 8 + im.height), lab, fill=(0, 120, 0) if ok else (200, 0, 0), font=f_lab)
    sheet.save(os.path.join(out, s + '.png'), optimize=True)
    summary.append(f"{s}: {len(rs)} shots, {len(bad)} cut off")
extra = [r for r in recs if not r.get('file') and not r['fits']]
for r in extra:
    summary.append(f"{r['surface']} {r['scenario']} {r['device']} {r['type']}: region cut off {r['overflow']}")
open(os.path.join(out, 'summary.txt'), 'a').write('\n'.join(summary) + '\n')
print('\n'.join(summary))
