"""Builds the stop name and location shards in src/public/stops/ from the
Transport for NSW GTFS static timetable (stops.txt).

Usage:
  curl -H "Authorization: apikey $TFNSW_API_KEY" -o gtfs.zip \
    https://api.transport.nsw.gov.au/v1/publictransport/timetables/complete/gtfs
  python3 tools/build_stops.py gtfs.zip

Each shard holds the stops whose id starts with the same three characters:
{"213516": ["Strathfield Station, Albert Rd, Stand G", -33.87191, 151.09363], ...}
"""
import csv, io, json, os, re, sys, zipfile

src = sys.argv[1] if len(sys.argv) > 1 else "gtfs.zip"
out = os.path.join(os.path.dirname(__file__), "..", "src", "public", "stops")
os.makedirs(out, exist_ok=True)
z = zipfile.ZipFile(src)
rows = csv.DictReader(io.TextIOWrapper(z.open("stops.txt"), "utf-8-sig"))
shards = {}
for r in rows:
    sid = r["stop_id"]
    if not (r["location_type"] in ("", "0") or (r["location_type"] == "1" and sid.isdigit())):
        continue
    key = re.sub(r"[^A-Za-z0-9]", "_", sid[:3])
    shards.setdefault(key, {})[sid] = [r["stop_name"], round(float(r["stop_lat"]), 5), round(float(r["stop_lon"]), 5)]
for key, data in shards.items():
    with open(os.path.join(out, key + ".json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
print("wrote", len(shards), "shards")
