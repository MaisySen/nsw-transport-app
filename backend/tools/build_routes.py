"""Builds src/public/data/routes.json, the line name for each GTFS route id that the
Transport for NSW realtime feeds use (service alerts name routes by id, not by line).

Usage: TFNSW_API_KEY=... python3 tools/build_routes.py

Reads routes.txt from the small per network GTFS timetables (trains, NSW TrainLink, metro,
ferries, Manly Fast Ferry, light rail). Bus route ids need no table: the line is the part
after the first "_" (2507_540 is the 540), which the worker works out itself.
NSW TrainLink regional trains and coaches with numbers for names are left out (see below).
Writes {"built": "YYYY-MM-DD", "routes": {"NSN_1a": "T1", ...}}.
"""
import csv, datetime, io, json, os, sys, urllib.request, zipfile

KEY = os.environ.get("TFNSW_API_KEY")
if not KEY:
    sys.exit("set TFNSW_API_KEY")
FEEDS = [
    "/v1/gtfs/schedule/sydneytrains", "/v1/gtfs/schedule/nswtrains", "/v2/gtfs/schedule/metro",
    "/v1/gtfs/schedule/ferries/sydneyferries", "/v1/gtfs/schedule/ferries/MFF",
    "/v1/gtfs/schedule/lightrail/cbdandsoutheast", "/v1/gtfs/schedule/lightrail/innerwest",
    "/v1/gtfs/schedule/lightrail/parramatta", "/v1/gtfs/schedule/lightrail/newcastle",
]
routes = {}
for path in FEEDS:
    req = urllib.request.Request("https://api.transport.nsw.gov.au" + path, headers={"Authorization": "apikey " + KEY})
    with urllib.request.urlopen(req, timeout=300) as r:
        z = zipfile.ZipFile(io.BytesIO(r.read()))
    n = 0
    for row in csv.DictReader(io.TextIOWrapper(z.open("routes.txt"), "utf-8-sig")):
        name = (row.get("route_short_name") or "").strip()
        # NSW TrainLink numbers its regional trains and coaches (223, 445): the same numbers as
        # Sydney bus routes, so those stay out and their alerts match by stop instead.
        if "nswtrains" in path and name.isdigit():
            continue
        if name and row["route_id"] not in routes:
            routes[row["route_id"]] = name
            n += 1
    print(path, n, flush=True)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "public", "data", "routes.json")
with open(out, "w") as f:
    json.dump({"built": datetime.date.today().isoformat(), "routes": dict(sorted(routes.items()))}, f, separators=(",", ":"))
print("wrote", out, len(routes), "routes")
