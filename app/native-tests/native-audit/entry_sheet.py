"""Contact sheet for the entry UI test (app/native-tests/entry-ui): every landed screen and the screen after its Back,
cold and warm, labelled. Usage: entry_sheet.py SHOTS_DIR OUT_PNG"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
recs = [{'name': f[:-4]} for f in sorted(os.listdir(src)) if f.endswith('.png')]
def font(n):
    for f in ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']:
        if os.path.exists(f):
            try: return ImageFont.truetype(f, n)
            except Exception: pass
    return ImageFont.load_default()
W = 330
cells = []
for r in recs:
    p = os.path.join(src, r['name'] + '.png')
    if not os.path.exists(p): continue
    im = Image.open(p).convert('RGB'); h = int(im.height * W / im.width)
    cells.append((r['name'], im.resize((W, h))))
if not cells: sys.exit(0)
cols = 4; H = max(c[1].height for c in cells) + 40
rows = (len(cells) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (W + 16) + 16, rows * (H + 16) + 16), 'white')
d = ImageDraw.Draw(sheet); f = font(20)
for i, (name, im) in enumerate(cells):
    x = 16 + (i % cols) * (W + 16); y = 16 + (i // cols) * (H + 16)
    d.text((x, y), name, fill='black', font=f); sheet.paste(im, (x, y + 34))
sheet.save(out)
print('sheet', out, len(cells))
