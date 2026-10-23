"""Draws the 1024 px app icon (no transparency, as Apple requires).

Run: python3 Tools/make_icon.py   (needs Pillow: pip3 install pillow)
Writes Support/AppIcon.png and Support/Assets.xcassets/AppIcon.appiconset.
"""
import json
import os
from PIL import Image, ImageDraw, ImageFilter

S = 1024
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

img = Image.new("RGB", (S, S))
d = ImageDraw.Draw(img)
top, bottom = (10, 38, 84), (3, 16, 40)
for y in range(S):
    t = y / S
    d.line([(0, y), (S, y)], fill=tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3)))

route = Image.new("RGBA", (S, S), (0, 0, 0, 0))
rd = ImageDraw.Draw(route)
pts = [(170, 760), (360, 760), (512, 610), (512, 420), (660, 270), (860, 270)]
rd.line(pts, fill=(246, 137, 31, 255), width=64, joint="curve")
for (x, y) in (pts[0], pts[-1]):
    rd.ellipse([x - 62, y - 62, x + 62, y + 62], fill=(255, 255, 255, 255))
    rd.ellipse([x - 34, y - 34, x + 34, y + 34], fill=(246, 137, 31, 255))

glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
cx, cy = 512, 515
gd.ellipse([cx - 120, cy - 120, cx + 120, cy + 120], fill=(34, 197, 94, 140))
glow = glow.filter(ImageFilter.GaussianBlur(40))

img = Image.alpha_composite(img.convert("RGBA"), glow)
img = Image.alpha_composite(img, route)
d = ImageDraw.Draw(img)
d.ellipse([cx - 70, cy - 70, cx + 70, cy + 70], fill=(255, 255, 255, 255))
d.ellipse([cx - 44, cy - 44, cx + 44, cy + 44], fill=(34, 197, 94, 255))
img = img.convert("RGB")

support = os.path.join(ROOT, "Support")
img.save(os.path.join(support, "AppIcon.png"))
iconset = os.path.join(support, "Assets.xcassets", "AppIcon.appiconset")
os.makedirs(iconset, exist_ok=True)
img.save(os.path.join(iconset, "AppIcon.png"))
with open(os.path.join(iconset, "Contents.json"), "w") as f:
    json.dump({"images": [{"filename": "AppIcon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
               "info": {"author": "xcode", "version": 1}}, f, indent=2)
with open(os.path.join(support, "Assets.xcassets", "Contents.json"), "w") as f:
    json.dump({"info": {"author": "xcode", "version": 1}}, f, indent=2)
print("icon written")
