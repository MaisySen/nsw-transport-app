"""Builds src/public/stations/places.json: every NSW suburb and locality with its centre,
used by the Ask chatbot to know that a word is a place (not a business), to fix typos and to
offer "Did you mean" choices. Source: the open Australian postcodes list (delivery areas).

Usage: python3 tools/build_places.py
"""
import csv, io, json, os, re, urllib.request

SRC = "https://raw.githubusercontent.com/matthewproctor/australianpostcodes/master/australian_postcodes.csv"
out = os.path.join(os.path.dirname(__file__), "..", "src", "public", "stations", "places.json")
text = urllib.request.urlopen(SRC, timeout=60).read().decode("utf-8")

def title(s):
    t = " ".join(w.capitalize() for w in s.lower().split())
    t = re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), t)
    return re.sub(r"\b(Nsw|Unsw|Uts)\b", lambda m: m.group(1).upper(), t)

seen = {}
for r in csv.DictReader(io.StringIO(text)):
    if r["state"] != "NSW" or r["type"] != "Delivery Area":
        continue
    try:
        lat = float(r["Lat_precise"] or r["lat"]); lon = float(r["Long_precise"] or r["long"])
    except ValueError:
        continue
    if not lat or not lon:
        continue
    name = title(r["locality"])
    if name not in seen:
        seen[name] = [name, round(lat, 5), round(lon, 5)]
rows = sorted(seen.values())
with open(out, "w") as f:
    json.dump(rows, f, separators=(",", ":"))
print("wrote", len(rows), "places")
