#!/usr/bin/env python3
"""Builds src/public/data/lineorder.json: the stations of every train, metro, light rail and ferry line in running
order, from a Transport for NSW complete GTFS bundle (standard library only).

  python3 tools/build_lineorder.py <complete GTFS zip> [out file]

Used by saved trip alerts (src/tripalerts.js) to tell which stations a trip passes between where it boards and where
it gets off, so planned work in the middle of a trip counts and work elsewhere on the same line does not.
Writes {"built": "YYYY-MM-DD", "lines": {"T1": [[station id, ...], ...]}, "parent": {platform id: station id}}.
A line keeps each distinct station order its trips run, minus orders that are a stretch of a longer one.
Run it again when lines change (a new timetable with new stations); it makes no Transport for NSW call.
"""
import sys, os, io, csv, json, zipfile, datetime, collections

RAIL_TYPES = {"0", "1", "2", "4", "100", "101", "102", "106", "400", "401", "900", "1000"}


def rows(z, name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, "utf-8-sig"))


def contains(big, small):
    n = len(small)
    if n > len(big): return False
    first = small[0]
    for i, x in enumerate(big):
        if x == first and big[i:i + n] == small: return True
    return False


def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "public", "data", "lineorder.json")
    z = zipfile.ZipFile(src)
    line_of_route = {}
    for r in rows(z, "routes.txt"):
        if r.get("route_type", "") in RAIL_TYPES and r.get("route_short_name"):
            line_of_route[r["route_id"]] = r["route_short_name"].strip()
    line_of_trip = {}
    for t in rows(z, "trips.txt"):
        ln = line_of_route.get(t["route_id"])
        if ln and (t.get("trip_headsign", "").strip().lower() not in ("empty train", "not in service")):
            line_of_trip[t["trip_id"]] = ln
    parent = {}
    for s in rows(z, "stops.txt"):
        if s.get("parent_station"): parent[s["stop_id"]] = s["parent_station"]
    seqs = collections.defaultdict(list)
    for x in rows(z, "stop_times.txt"):
        if x["trip_id"] in line_of_trip:
            seqs[x["trip_id"]].append((int(x["stop_sequence"]), x["stop_id"], x.get("pickup_type") == "1" and x.get("drop_off_type") == "1"))
    lines = collections.defaultdict(set)
    used_platforms = {}
    for tid, rs in seqs.items():
        rs.sort()
        order = []
        for _, sid, passing in rs:
            if passing: continue
            st = parent.get(sid, sid)
            if sid != st: used_platforms[sid] = st
            if not order or order[-1] != st: order.append(st)
        if len(order) >= 2: lines[line_of_trip[tid]].add(tuple(order))
    out_lines = {}
    for ln, ss in sorted(lines.items()):
        keep = []
        for s in sorted(ss, key=len, reverse=True):
            if not any(contains(k, s) for k in keep): keep.append(s)
        out_lines[ln] = [list(s) for s in keep]
    doc = {"built": datetime.date.today().isoformat(), "lines": out_lines, "parent": dict(sorted(used_platforms.items()))}
    with open(out, "w") as f: json.dump(doc, f, separators=(",", ":"))
    print("lines", len(out_lines), "orders", sum(len(v) for v in out_lines.values()), "platforms", len(used_platforms), "bytes", os.path.getsize(out))


if __name__ == "__main__":
    main()
