"""Builds the New Trip station lists in src/public/stations/ from the
Transport for NSW GTFS static timetable.

Usage: python3 tools/build_stations.py gtfs.zip

Writes:
  stations/train.json, metro.json, ferry.json, lightrail.json
    [[id, name, lat, lon], ...] sorted A to Z, id is the parent stop id the trip planner takes
  stations/bus-routes.json
    {"461X": "Burwood to The Domain", ...}
  stations/bus/<shard>.json, shard = first two characters of the route
    {"461X": [{"to": "The Domain", "stops": [[id, name, lat, lon], ...]}, ...]}
"""
import csv, io, json, os, re, sys, zipfile, collections

src = sys.argv[1] if len(sys.argv) > 1 else "gtfs.zip"
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "public", "stations")
os.makedirs(os.path.join(out, "bus"), exist_ok=True)
z = zipfile.ZipFile(src)

def rows(name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), "utf-8-sig"))

MODE = {"2": "train", "106": "train", "401": "metro", "4": "ferry", "900": "lightrail", "700": "bus", "714": "bus"}
routes = {}
for r in rows("routes.txt"):
    m = MODE.get(r["route_type"])
    if m:
        routes[r["route_id"]] = (m, r["route_short_name"], r["route_long_name"])
trips = {}
for t in rows("trips.txt"):
    if t["route_id"] in routes:
        trips[t["trip_id"]] = (t["route_id"], t.get("direction_id", ""), t.get("trip_headsign", ""))
print("trips", len(trips), flush=True)

stops = {}
for s in rows("stops.txt"):
    stops[s["stop_id"]] = (s["stop_name"], s["parent_station"], s["location_type"], round(float(s["stop_lat"] or 0), 5), round(float(s["stop_lon"] or 0), 5))

def parent(sid):
    s = stops.get(sid)
    if s and s[1] and s[1] in stops and s[1].isdigit():
        return s[1]
    return sid

stop_modes = collections.defaultdict(set)
bus_count = collections.Counter()
for r in rows("stop_times.txt"):
    t = trips.get(r["trip_id"])
    if not t:
        continue
    m = routes[t[0]][0]
    if m == "bus":
        bus_count[r["trip_id"]] += 1
    else:
        stop_modes[parent(r["stop_id"])].add(m)
print("stop_times pass 1 done", flush=True)

best = {}
for tid, n in bus_count.items():
    rid, d, head = trips[tid]
    key = (routes[rid][1], d)
    if key not in best or n > best[key][1]:
        best[key] = (tid, n)
chosen = {v[0] for v in best.values()}
seqs = collections.defaultdict(list)
for r in rows("stop_times.txt"):
    if r["trip_id"] in chosen:
        seqs[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))
print("stop_times pass 2 done", flush=True)

def clean(name):
    return re.sub(r"\s+", " ", name).strip()

for m in ("train", "metro", "ferry", "lightrail"):
    lst = []
    for sid, ms in stop_modes.items():
        if m in ms and sid in stops:
            n, _, _, la, lo = stops[sid]
            lst.append([sid, clean(n), la, lo])
    lst.sort(key=lambda x: x[1].lower())
    with open(os.path.join(out, m + ".json"), "w") as f:
        json.dump(lst, f, separators=(",", ":"))
    print(m, len(lst))

index, shards = {}, collections.defaultdict(dict)
for (short, d), (tid, n) in sorted(best.items()):
    rid, _, head = trips[tid]
    index.setdefault(short, routes[rid][2])
    st = []
    for _, sid in sorted(seqs[tid]):
        if sid in stops:
            nm, _, _, la, lo = stops[sid]
            st.append([sid, clean(nm), la, lo])
    to = head or (st[-1][1] if st else "")
    shards[re.sub(r"[^A-Za-z0-9]", "_", short[:2])].setdefault(short, []).append({"to": to, "stops": st})
with open(os.path.join(out, "bus-routes.json"), "w") as f:
    json.dump(dict(sorted(index.items(), key=lambda kv: (len(re.match(r"\D*", kv[0]).group(0)) > 0, kv[0]))), f, separators=(",", ":"))
for k, v in shards.items():
    with open(os.path.join(out, "bus", k + ".json"), "w") as f:
        json.dump(v, f, separators=(",", ":"))
print("bus routes", len(index), "shards", len(shards))
