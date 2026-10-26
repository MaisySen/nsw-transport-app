#!/usr/bin/env python3
"""Builds our own trip planner's timetable pack (RAPTOR) from a Transport for NSW GTFS bundle (standard library only).

  python3 tools/build_planner.py <complete GTFS zip, a dir of mode zips, or a dir of GTFS txt files> <out file> [service day YYYYMMDD]

The pack holds one Sydney service day as times in seconds after that day's start (noon minus 12 h, as the board
engine counts), plus the trips of the day before that run past midnight and the next morning's trips up to 08:00
(next day times are 86,400 s later), so a search late at night still finds the first services.

Layout (all numbers little endian, read by backend/src/raptor.js):
  "RPK1", uint32 header length, header JSON, zero padding to 8 bytes, then the arrays the header lists
  ({name, type, offset, length}). Trips are grouped into patterns (same route, same stops in the same order); the
  trips of a pattern are sorted so no trip overtakes another (a pattern where one would is split), which is what
  RAPTOR needs; trips also share their boarding rules within a pattern (see below), so the earliest trip is the
  one to take. Footpaths: between the stops of one station, and between stops up to WALK_MAX_M apart (at most
  WALK_MAX_N per stop), at WALK_MPS with a detour factor, plus a fixed time to find the stop.
tripDays and tripOff (27 Oct): tripOff is each trip instance's day (0 the day before, 1 the pack's day, 2 the next
morning); tripDays has bit k+1 set when the instance's trip runs on day k (k from -1 to 7) by the calendar. The
header's daysHeld lists the days every trip of which is in the pack as a trip of the pack's own day (that day's services
are all among the pack day's), with each day's start: the trip list a day at a time (backend/src/daylist.js) reads
those days from the pack without a bigger pack or another load.
tripNext: for each trip, the trip that carries on the same vehicle's run (same block, same day, from the station
where it ends, within RUN_GAP_S), or -1; the service screen's stop list follows it (raptor.js rpRun).
Rows where nobody may board (pickup_type 1) or get off (drop_off_type 1) carry a flag, so the planner never boards or
leaves a service where the timetable says it cannot.
"""
import sys, os, io, csv, json, zipfile, datetime, collections, struct, math, array
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from limited_stops import limited_patterns, is_limited, name_says_limited

SYD = ZoneInfo("Australia/Sydney")
WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WALK_MAX_M = 400       # longest walk between two stops of different stations
WALK_MAX_N = 12        # nearest stops kept per stop
WALK_MPS = 1.2         # walking speed, metres a second
DETOUR = 1.3           # streets are not straight lines
FIND_S = 60            # time to find the next stop or platform
STATION_MIN_S = 120    # least time between two platforms or stands of one station
NEXT_MORNING_S = 8 * 3600
RUN_GAP_S = 30 * 60     # a run that carries on under another trip id leaves within this long of arriving
NOT_IN_SERVICE = ("empty train", "not in service")


def day_start(d):
    return int(datetime.datetime(d.year, d.month, d.day, 12, tzinfo=SYD).timestamp()) - 12 * 3600


def secs(s):
    h, m, x = s.split(":")
    return int(h) * 3600 + int(m) * 60 + int(x)


def cls_of(route_type, agency=""):
    """Trip Planner product class: 1 train, 2 metro, 4 light rail, 5 bus, 7 coach, 9 ferry, 11 school bus."""
    t = int(route_type or 0)
    if t == 401: return 2
    if t in (0, 900): return 4
    if t in (4, 1000): return 9
    if t == 712: return 11
    if t in (2, 100, 101, 102, 106, 400): return 1
    if t in (200, 201, 202, 203, 204): return 7
    return 5


class Folder:
    """The few zipfile.ZipFile calls Source makes, over a folder of GTFS txt files."""
    def __init__(self, path): self.path = path
    def namelist(self): return os.listdir(self.path)
    def open(self, name): return open(os.path.join(self.path, name), "rb")


class Source:
    """One complete bundle zip, or a dir of zips (the engine's mode bundles); ids are prefixed per zip in a dir."""
    def __init__(self, path):
        self.zips = []
        if os.path.isdir(path) and os.path.exists(os.path.join(path, "stops.txt")):
            self.zips.append(("", Folder(path)))  # an unzipped bundle (the test fixtures)
        elif os.path.isdir(path):
            for fn in sorted(os.listdir(path)):
                if fn.endswith(".zip"): self.zips.append((fn[:-4], zipfile.ZipFile(os.path.join(path, fn))))
        else:
            self.zips.append(("", zipfile.ZipFile(path)))

    def rows(self, name):
        for tag, z in self.zips:
            if name not in z.namelist(): continue
            with z.open(name) as f:
                for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline="")):
                    yield tag, r


def km(a, b, c, d):
    r = math.pi / 180
    x = (d - b) * r * math.cos(((a + c) / 2) * r)
    y = (c - a) * r
    return math.sqrt(x * x + y * y) * 6371.0


def main():
    src = Source(sys.argv[1])
    out = sys.argv[2]
    day = datetime.datetime.strptime(sys.argv[3], "%Y%m%d").date() if len(sys.argv) > 3 else datetime.datetime.now(SYD).date()
    days = {-1: day - datetime.timedelta(days=1), 0: day, 1: day + datetime.timedelta(days=1)}
    dkey = {k: d.strftime("%Y%m%d") for k, d in days.items()}
    # Services running on each of the three days.
    run = {k: set() for k in days}
    for tag, c in src.rows("calendar.txt"):
        for k, d in days.items():
            if c["start_date"] <= dkey[k] <= c["end_date"] and c[WEEK[d.weekday()]] == "1": run[k].add(tag + c["service_id"])
    for tag, c in src.rows("calendar_dates.txt"):
        for k in days:
            if c["date"] == dkey[k]:
                if c["exception_type"] == "1": run[k].add(tag + c["service_id"])
                elif c["exception_type"] == "2": run[k].discard(tag + c["service_id"])
    # The week ahead (and the day before) for the trip list a day at a time: which of those days each trip runs on.
    wide = {k: set() for k in range(-1, 8)}
    wdays = {k: day + datetime.timedelta(days=k) for k in wide}
    wkey = {k: d.strftime("%Y%m%d") for k, d in wdays.items()}
    for tag, c in src.rows("calendar.txt"):
        for k, d in wdays.items():
            if c["start_date"] <= wkey[k] <= c["end_date"] and c[WEEK[d.weekday()]] == "1": wide[k].add(tag + c["service_id"])
    for tag, c in src.rows("calendar_dates.txt"):
        for k in wide:
            if c["date"] == wkey[k]:
                if c["exception_type"] == "1": wide[k].add(tag + c["service_id"])
                elif c["exception_type"] == "2": wide[k].discard(tag + c["service_id"])
    lacking = set()   # days with a service in service that the pack's day does not run
    agency = {tag + a.get("agency_id", ""): a.get("agency_name", "") for tag, a in src.rows("agency.txt")}
    routes, route_idx, rmap = [], {}, {}
    for tag, x in src.rows("routes.txt"):
        key = (x.get("route_short_name", ""), x.get("route_type", ""), x.get("route_color", ""), x.get("route_long_name", ""), x.get("agency_id", ""))
        if key not in route_idx:
            route_idx[key] = len(routes)
            color = x.get("route_color", "")
            routes.append([x.get("route_short_name", ""), cls_of(x.get("route_type")), ("#" + color) if color else "", x.get("route_long_name", ""), agency.get(tag + x.get("agency_id", ""), "")])
        rmap[tag + x["route_id"]] = route_idx[key]
    heads, head_idx = [], {}
    trips = {}   # trip id -> (route idx, head idx, [day offsets])
    named_lim = set()   # trips whose own timetable name says Limited stops or Express (limited_stops.py)
    block_of = {}  # trip id -> block id (one vehicle's run, split into several trips at some stations)
    mask_of = {}   # trip id -> bit k+1 for each day k from -1 to 7 it runs on
    for tag, x in src.rows("trips.txt"):
        sv = tag + x["service_id"]
        h = x.get("trip_headsign", "")
        if h.strip().lower() in NOT_IN_SERVICE: continue
        if sv not in run[0]:
            for k in wide:
                if sv in wide[k]: lacking.add(k)
        offs = [k for k in days if sv in run[k]]
        if not offs: continue
        if h not in head_idx: head_idx[h] = len(heads); heads.append(h)
        trips[tag + x["trip_id"]] = (rmap.get(tag + x["route_id"], 0), head_idx[h], offs)
        mask_of[tag + x["trip_id"]] = sum(1 << (k + 1) for k in wide if sv in wide[k])
        if name_says_limited(x.get("route_direction", ""), routes[trips[tag + x["trip_id"]][0]][3] if routes else ""):
            named_lim.add(tag + x["trip_id"])
        if x.get("block_id"): block_of[tag + x["trip_id"]] = tag + x["block_id"]
    print("trips active", len(trips), flush=True)
    st = collections.defaultdict(list)
    for tag, x in src.rows("stop_times.txt"):
        tid = tag + x["trip_id"]
        if tid not in trips: continue
        a = x["arrival_time"] or x["departure_time"]
        d = x["departure_time"] or x["arrival_time"]
        if not a: continue
        fl = (1 if x.get("pickup_type") == "1" else 0) | (2 if x.get("drop_off_type") == "1" else 0)
        st[tid].append((int(x["stop_sequence"]), tag + x["stop_id"], secs(a), secs(d), fl))
    print("trips with times", len(st), flush=True)
    stops_all = {}
    for tag, x in src.rows("stops.txt"):
        lt = x.get("location_type", "") or "0"
        if lt not in ("0", "1"): continue
        try: lat, lon = float(x.get("stop_lat") or 0), float(x.get("stop_lon") or 0)
        except ValueError: lat, lon = 0.0, 0.0
        p = x.get("parent_station", "")
        stops_all[tag + x["stop_id"]] = (x.get("stop_name", ""), (tag + p) if p else "", x.get("platform_code", ""), lat, lon)
    # Patterns: route + stop list. Each trip instance is a (trip, day offset) whose times are shifted to the pack's day.
    pats = collections.defaultdict(list)
    for tid, rows_ in st.items():
        rows_.sort()
        if len(rows_) < 2: continue
        ri, hi, offs = trips[tid]
        # Same stops and the same boarding rules: within a pattern the earliest trip is always the one to take.
        key = (ri, tuple(r[1] for r in rows_), tuple(r[4] for r in rows_))
        for k in offs:
            sh = k * 86400
            ts = [(r[2] + sh, r[3] + sh, r[4]) for r in rows_]
            if k == -1 and ts[-1][0] < 0: continue
            if k == 1 and ts[0][1] > 86400 + NEXT_MORNING_S: continue
            pats[key].append((ts[0][1], tid, hi, ts, k))
    used = set()
    for (ri, sids, _) in pats: used.update(sids)
    sid_list = sorted(used)
    parents = sorted({stops_all[s][1] for s in sid_list if s in stops_all and stops_all[s][1]} - used)
    sid_list += parents
    sidx = {s: i for i, s in enumerate(sid_list)}
    S = len(sid_list)
    # Limited Stops (limited_stops.py): patterns that run past stations their own line normally serves.
    station = lambda s: (stops_all.get(s) or ("", ""))[1] or s
    lim_in, lim_keys = [], list(pats.keys())
    for (ri, sids, fls) in lim_keys:
        seq = []
        for s_, fl in zip(sids, fls):
            if fl == 3: continue   # nobody boards or gets off: a passing point, not a stop
            st_ = station(s_)
            if not seq or seq[-1] != st_: seq.append(st_)
        r = routes[ri]
        lim_in.append(((r[0], r[1], r[4]), r[1], seq, len({t[1] for t in pats[(ri, sids, fls)]})))
    skips = limited_patterns(lim_in)
    lim_set = {lim_keys[i] for i, (n, g, sv) in skips.items() if is_limited(lim_in[i][1], n, g, sv)}
    rep = os.environ.get("LIMITED_REPORT")
    if rep:
        byline = collections.defaultdict(lambda: {"patterns": 0, "limited": 0, "trips": 0, "limitedTrips": 0, "examples": []})
        for i, k in enumerate(lim_keys):
            lk, cls, seq, n = lim_in[i]
            b = byline["%s|%s|%s" % lk]
            b["patterns"] += 1; b["trips"] += n
            if k in lim_set:
                b["limited"] += 1; b["limitedTrips"] += n
                if len(b["examples"]) < 3:
                    b["examples"].append({"stops": [stops_all.get(x, ("",))[0] for x in seq], "skipped": skips[i][0], "gaps": skips[i][1], "trips": n})
        with open(rep, "w") as f: json.dump(byline, f, indent=1, ensure_ascii=False)
    print("limited patterns", len(lim_set), "of", len(lim_keys), "named trips", len(named_lim), flush=True)
    # Split patterns so trips never overtake.
    P_stops, P_trips, P_lim = [], [], []
    for (ri, sids, _), tl in pats.items():
        pat_lim = (ri, sids, _) in lim_set
        tl.sort(key=lambda t: (t[0], t[3][-1][0]))
        groups = []
        for t in tl:
            placed = False
            for g in groups:
                last = g[-1][3]
                if all(t[3][i][0] >= last[i][0] and t[3][i][1] >= last[i][1] for i in range(len(sids))):
                    g.append(t); placed = True; break
            if not placed: groups.append([t])
        for g in groups:
            P_stops.append([sidx[s] for s in sids])
            P_trips.append((ri, g))
            P_lim.append(pat_lim)
    P = len(P_stops)
    patStopOff = array.array("i", [0]); patStops = array.array("i")
    patTripOff = array.array("i", [0]); patEvOff = array.array("i", [0])
    tripRoute = array.array("i"); tripHead = array.array("i"); tripPat = array.array("i"); trip_ids = []
    tripLim = array.array("B")
    tripDays = array.array("i"); tripOff = array.array("B")
    arr = array.array("i"); dep = array.array("i"); flags = array.array("B")
    inst = []    # per trip instance: (trip id, day offset, first stop index, last stop index, first departure, last arrival)
    for p in range(P):
        ri, g = P_trips[p]
        patStops.extend(P_stops[p]); patStopOff.append(len(patStops))
        for (_, tid, hi, ts, k) in g:
            inst.append((tid, k, P_stops[p][0], P_stops[p][-1], ts[0][1], ts[-1][0]))
            trip_ids.append(tid); tripRoute.append(ri); tripHead.append(hi); tripPat.append(p)
            tripLim.append(1 if (P_lim[p] or tid in named_lim) else 0)
            tripDays.append(mask_of.get(tid, 0)); tripOff.append(k + 1)
            for (a, d, fl) in ts: arr.append(a); dep.append(d); flags.append(fl)
        patTripOff.append(len(trip_ids)); patEvOff.append(len(arr))
    # Stop -> patterns serving it (with the position in the pattern).
    sp = [[] for _ in range(S)]
    for p in range(P):
        for i, s in enumerate(P_stops[p]): sp[s].append((p, i))
    stopPatOff = array.array("i", [0]); stopPat = array.array("i"); stopPatIdx = array.array("i")
    for s in range(S):
        for p, i in sp[s]: stopPat.append(p); stopPatIdx.append(i)
        stopPatOff.append(len(stopPat))
    lat = array.array("f"); lon = array.array("f"); parent = array.array("i"); names = []; plats = []
    for s in sid_list:
        n, p, pc, la, lo = stops_all.get(s, ("", "", "", 0.0, 0.0))
        lat.append(la); lon.append(lo); parent.append(sidx.get(p, -1)); names.append(n); plats.append(pc)
    # The trip that carries on a trip's run (tripNext, -1 for none). Sydney Trains splits one train's run into several
    # trips (a T1 from Penrith to Hornsby via Gordon is one trip to Central and another from Central), so a stop list
    # taken from one trip id stops short. The next trip of the same block, on the same day, that starts at the station
    # where this one ends within RUN_GAP_S of its arrival continues it.
    station = lambda i: parent[i] if parent[i] >= 0 else i
    tripNext = array.array("i", [-1]) * len(inst)
    by_block = collections.defaultdict(list)
    for n, (tid, k, _, _, d0, _) in enumerate(inst):
        b = block_of.get(tid)
        if b: by_block[(b, k)].append((d0, n))
    for runs in by_block.values():
        runs.sort()
        for (_, a), (_, b) in zip(runs, runs[1:]):
            ta, tb = inst[a], inst[b]
            if station(ta[3]) == station(tb[2]) and 0 <= tb[4] - ta[5] <= RUN_GAP_S: tripNext[a] = b
    # Footpaths.
    xf = [dict() for _ in range(S)]
    kids = collections.defaultdict(list)
    for i in range(S):
        if parent[i] >= 0: kids[parent[i]].append(i)
    def walk_s(m): return int(FIND_S + m * DETOUR / WALK_MPS)
    for p, ks in kids.items():
        for a in ks:
            for b in ks:
                if a == b: continue
                m = km(lat[a], lon[a], lat[b], lon[b]) * 1000
                xf[a][b] = max(STATION_MIN_S, walk_s(m))
    cell = 0.004
    grid = collections.defaultdict(list)
    serving = [i for i in range(S) if stopPatOff[i + 1] > stopPatOff[i] and (lat[i] or lon[i])]
    for i in serving: grid[(int(lat[i] / cell), int(lon[i] / cell))].append(i)
    for i in serving:
        gy, gx = int(lat[i] / cell), int(lon[i] / cell)
        near = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for j in grid.get((gy + dy, gx + dx), ()):
                    if j == i or (parent[i] >= 0 and parent[i] == parent[j]): continue
                    m = km(lat[i], lon[i], lat[j], lon[j]) * 1000
                    if m <= WALK_MAX_M: near.append((m, j))
        near.sort()
        for m, j in near[:WALK_MAX_N]:
            t = walk_s(m)
            if t < xf[i].get(j, 1 << 30): xf[i][j] = t
            if t < xf[j].get(i, 1 << 30): xf[j][i] = t
    xferOff = array.array("i", [0]); xferTo = array.array("i"); xferSec = array.array("i")
    for i in range(S):
        for j, t in sorted(xf[i].items()): xferTo.append(j); xferSec.append(t)
        xferOff.append(len(xferTo))
    arrays = [("lat", "f32", lat), ("lon", "f32", lon), ("parent", "i32", parent),
              ("patStopOff", "i32", patStopOff), ("patStops", "i32", patStops), ("patTripOff", "i32", patTripOff),
              ("patEvOff", "i32", patEvOff), ("tripRoute", "i32", tripRoute), ("tripHead", "i32", tripHead),
              ("tripPat", "i32", tripPat), ("arr", "i32", arr), ("dep", "i32", dep), ("flags", "u8", flags),
              ("stopPatOff", "i32", stopPatOff), ("stopPat", "i32", stopPat), ("stopPatIdx", "i32", stopPatIdx),
              ("xferOff", "i32", xferOff), ("xferTo", "i32", xferTo), ("xferSec", "i32", xferSec),
              ("tripLim", "u8", tripLim),
              ("tripNext", "i32", tripNext),
              ("tripDays", "i32", tripDays), ("tripOff", "u8", tripOff)]
    days_held = [{"day": wkey[k], "off": k, "dayStart": day_start(wdays[k])} for k in sorted(wide) if k == 0 or k not in lacking]
    print("days held", [d["day"] for d in days_held], flush=True)
    head = {"v": 1, "day": dkey[0], "dayStart": day_start(day), "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "counts": {"stops": S, "patterns": P, "trips": len(trip_ids), "events": len(arr), "footpaths": len(xferTo), "limited": sum(tripLim)},
            "walk": {"mps": WALK_MPS, "detour": DETOUR, "findS": FIND_S, "stationMinS": STATION_MIN_S, "maxM": WALK_MAX_M},
            "routes": routes, "heads": heads, "arrays": [], "daysHeld": days_held,
            # Long lists as one string each, one entry a line (fewer objects for the reader to hold).
            "stopIds": "\n".join(sid_list), "names": "\n".join(n.replace("\n", " ") for n in names),
            "plats": "\n".join(plats), "tripIds": "\n".join(trip_ids)}
    off = 0
    for name, ty, a in arrays:
        n = len(a); size = n * (1 if ty == "u8" else 4)
        head["arrays"].append({"name": name, "type": ty, "offset": off, "length": n})
        off += (size + 7) // 8 * 8
    hb = json.dumps(head, separators=(",", ":"), ensure_ascii=False).encode()
    pad = (-(8 + len(hb))) % 8
    with open(out, "wb") as f:
        f.write(b"RPK1"); f.write(struct.pack("<I", len(hb) + pad)); f.write(hb); f.write(b" " * pad)
        for name, ty, a in arrays:
            b = a.tobytes()
            if sys.byteorder != "little": raise SystemExit("big endian host")
            f.write(b); f.write(b"\0" * ((-len(b)) % 8))
    print(json.dumps(head["counts"]), "bytes", os.path.getsize(out), "header", len(hb))


if __name__ == "__main__":
    main()
