#!/usr/bin/env python3
"""Builds the board engine's timetable from Transport for NSW GTFS schedule bundles (standard library only).

  python3 tools/build_timetable.py <gtfs dir, one zip per feed> <out dir> [first day YYYYMMDD] [days]

Each zip is named after the realtime feed it matches (buses.zip is the bus feed, sydneytrains.zip the train feed,
rb_northcoast.zip a regional bus feed, and so on, see FEED_OF_ZIP). Writes to <out>:
  meta.json          routes, headsigns, the start of each service day, route ids per feed, stops in use
  days.ndjson.gz     one line per stop and service day: {"s": stop id, "d": YYYYMMDD, "r": [[seconds after the
                     day start, trip id, route index, headsign index, stop sequence], ...]} sorted by time
  trips.ndjson.gz    for feeds whose live updates carry no stop sequence (Sydney Trains): {"t": trip id,
                     "s": [stop id, sequence, stop id, sequence, ...]} so a live delay can be carried down the line
If <gtfs dir>/stops_complete.txt exists (stops.txt from the complete NSW GTFS bundle), its parent stations are used:
the mode bundles leave bus stands at a station without a parent, the Trip Planner's station board includes them.
Rows where nobody can board (pickup_type 1, or the trip's last stop) are left out of a stop's rows, as on the Trip
Planner's boards. They go to their own line instead, with the stop id plus "~a" (ALIGHT_SUFFIX) and the arrival
time, so the outage trip planner (src/ttplan.js) can end a trip at a last stop or a set down only stop; no stop id a
phone can send has a "~", so a board never reads them, and an engine without this code never asks for them. A row
where nobody can get off (drop_off_type 1) carries a 6th value, 1, so the planner never ends a trip there.
First day defaults to yesterday in Sydney (a trip after midnight belongs to the day before), days to 3.
"""
import sys, os, io, csv, json, gzip, zipfile, datetime, collections
from zoneinfo import ZoneInfo

SYD = ZoneInfo("Australia/Sydney")
FEED_OF_ZIP = {"buses": "bus", "sydneytrains": "train", "metro": "metro", "ferry": "ferry", "ferry_mff": "ferry_mff",
               "lr_cse": "lr_cse", "lr_iw": "lr_iw", "lr_par": "lr_par", "lr_new": "lr_new", "nswtrains": "nswtrains"}
NO_SEQ_FEEDS = {"train"}
ALIGHT_SUFFIX = "~a"
WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def feed_key(name):
    if name in FEED_OF_ZIP: return FEED_OF_ZIP[name]
    return name if name.startswith("rb_") else None


def cls_of(route_type, feed):
    """Trip Planner product class: 1 train, 2 metro, 4 light rail, 5 bus, 7 coach, 9 ferry, 11 school bus."""
    t = int(route_type or 0)
    if feed == "metro" or t == 401: return 2
    if feed.startswith("lr_") or t in (0, 900): return 4
    if feed.startswith("ferry") or t in (4, 1000): return 9
    if t == 712: return 11
    if t in (2, 100, 101, 102, 106, 400): return 1
    if t in (200, 201, 202, 203, 204): return 7
    if feed == "nswtrains": return 7
    return 5


def day_start(d):
    # GTFS times count from noon minus 12 h on the service day (midnight, except on a clock change day).
    return int(datetime.datetime(d.year, d.month, d.day, 12, tzinfo=SYD).timestamp()) - 12 * 3600


def secs(s):
    h, m, x = s.split(":")
    return int(h) * 3600 + int(m) * 60 + int(x)


def rows(z, name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))


def main():
    src, out = sys.argv[1], sys.argv[2]
    first = datetime.datetime.strptime(sys.argv[3], "%Y%m%d").date() if len(sys.argv) > 3 else datetime.datetime.now(SYD).date() - datetime.timedelta(days=1)
    ndays = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    days = [first + datetime.timedelta(days=i) for i in range(ndays)]
    dkeys = [d.strftime("%Y%m%d") for d in days]
    os.makedirs(out, exist_ok=True)
    routes, route_idx, route_ids = [], {}, {}
    heads, head_idx = [], {}
    stops = {}
    per = collections.defaultdict(list)
    alight = collections.defaultdict(list)
    feeds_info = {}
    tf = gzip.open(os.path.join(out, "trips.ndjson.gz"), "wt", compresslevel=6)
    for fn in sorted(os.listdir(src)):
        if not fn.endswith(".zip"): continue
        name = fn[:-4]
        feed = feed_key(name)
        if not feed: continue
        z = zipfile.ZipFile(os.path.join(src, fn))
        names = set(z.namelist())
        run = collections.defaultdict(set)
        if "calendar.txt" in names:
            for c in rows(z, "calendar.txt"):
                for d, k in zip(days, dkeys):
                    if c["start_date"] <= k <= c["end_date"] and c[WEEK[d.weekday()]] == "1": run[k].add(c["service_id"])
        if "calendar_dates.txt" in names:
            for c in rows(z, "calendar_dates.txt"):
                if c["date"] in dkeys:
                    if c["exception_type"] == "1": run[c["date"]].add(c["service_id"])
                    elif c["exception_type"] == "2": run[c["date"]].discard(c["service_id"])
        svc_days = collections.defaultdict(list)
        for k in dkeys:
            for sv in run.get(k, ()): svc_days[sv].append(k)
        rmap = {}
        for x in rows(z, "routes.txt"):
            key = (feed, x.get("route_short_name", ""), x.get("route_type", ""), x.get("route_desc", ""), x.get("route_color", ""), x.get("route_long_name", ""))
            if key not in route_idx:
                route_idx[key] = len(routes)
                color = x.get("route_color", "")
                routes.append([x.get("route_short_name", ""), cls_of(x.get("route_type"), feed), ("#" + color) if color else "", feed, x.get("route_desc", ""), x.get("route_long_name", "")])
            rmap[x["route_id"]] = route_idx[key]
        route_ids.setdefault(feed, {}).update(rmap)
        trip = {}
        for x in rows(z, "trips.txt"):
            if x["service_id"] not in svc_days: continue
            h = x.get("trip_headsign", "")
            if h not in head_idx: head_idx[h] = len(heads); heads.append(h)
            trip[x["trip_id"]] = (rmap.get(x["route_id"], 0), head_idx[h], svc_days[x["service_id"]])
        if not trip: continue
        for x in rows(z, "stops.txt"):
            if x["stop_id"] not in stops:
                try: lat, lon = round(float(x.get("stop_lat") or 0), 6), round(float(x.get("stop_lon") or 0), 6)
                except ValueError: lat, lon = 0, 0
                stops[x["stop_id"]] = [x.get("stop_name", ""), x.get("parent_station", ""), x.get("platform_code", ""), lat, lon]
        by_trip = collections.defaultdict(list)
        for x in rows(z, "stop_times.txt"):
            if x["trip_id"] in trip:
                by_trip[x["trip_id"]].append((int(x["stop_sequence"]), x["stop_id"], x["departure_time"] or x["arrival_time"],
                                              x.get("pickup_type", ""), x["arrival_time"] or x["departure_time"], x.get("drop_off_type", "")))
        n = na = 0
        for tid, sts in by_trip.items():
            sts.sort()
            ri, hi, tdays = trip[tid]
            for i, (sq, sid, tt, pick, at, drop) in enumerate(sts):
                if i == len(sts) - 1 or pick == "1":
                    # Nobody boards here: an arrival only row for the outage planner, unless nobody gets off either.
                    if not at or drop == "1" or i == 0: continue
                    t = secs(at)
                    for k in tdays:
                        alight[(sid, k)].append([t, tid, ri, hi, sq]); na += 1
                    continue
                if not tt: continue
                t = secs(tt)
                row = [t, tid, ri, hi, sq] + ([1] if drop == "1" else [])
                for k in tdays:
                    per[(sid, k)].append(list(row)); n += 1
            if feed in NO_SEQ_FEEDS:
                flat = []
                for sq, sid, _, _, _, _ in sts: flat += [sid, sq]
                tf.write(json.dumps({"t": tid, "s": flat}, separators=(",", ":")) + "\n")
        feeds_info[name] = {"feed": feed, "trips": len(trip), "rows": n, "alight": na}
        print(name, feed, "trips", len(trip), "rows", n, "arrival only", na, flush=True)
    tf.close()
    with gzip.open(os.path.join(out, "days.ndjson.gz"), "wt", compresslevel=6) as f:
        for (sid, k), rs in per.items():
            rs.sort(key=lambda x: x[0])
            f.write(json.dumps({"s": sid, "d": k, "r": rs}, separators=(",", ":")) + "\n")
        for (sid, k), rs in alight.items():
            rs.sort(key=lambda x: x[0])
            f.write(json.dumps({"s": sid + ALIGHT_SUFFIX, "d": k, "r": rs}, separators=(",", ":")) + "\n")
    comp = os.path.join(src, "stops_complete.txt")
    if os.path.exists(comp):
        with open(comp, encoding="utf-8-sig", newline="") as f:
            for x in csv.DictReader(f):
                sid = x["stop_id"]
                if sid in stops:
                    if x.get("parent_station"): stops[sid][1] = x["parent_station"]
                else:
                    try: lat, lon = round(float(x.get("stop_lat") or 0), 6), round(float(x.get("stop_lon") or 0), 6)
                    except ValueError: lat, lon = 0, 0
                    stops[sid] = [x.get("stop_name", ""), x.get("parent_station", ""), x.get("platform_code", ""), lat, lon]
    keep = {}
    for sid, _ in list(per.keys()) + list(alight.keys()):
        if sid in keep: continue
        keep[sid] = stops.get(sid, ["", "", "", 0, 0])
        p = keep[sid][1]
        if p and p not in keep and p in stops: keep[p] = stops[p]
    meta = {"v": 1, "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "days": {k: day_start(d) for d, k in zip(days, dkeys)}, "routes": routes, "heads": heads,
            "routeIds": route_ids, "stops": keep, "feeds": feeds_info}
    with open(os.path.join(out, "meta.json"), "w") as f: json.dump(meta, f, separators=(",", ":"))
    print("stop days", len(per), "arrival only stop days", len(alight), "stops", len(keep), "routes", len(routes), "headsigns", len(heads))


if __name__ == "__main__":
    main()
