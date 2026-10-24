#!/usr/bin/env python3
"""Builds the station facility data the app shows on station screens, trip legs and the
top up finder, plus the Park and Ride car park list.

Sources (Transport for NSW open data):
  * Public Transport Location Facilities and Operators (CSV, no key needed):
    https://opendata.transport.nsw.gov.au/dataset/public-transport-location-facilities-and-operators
  * Car Park API (needs the TfNSW key in TFNSW_API_KEY or backend/.env):
    https://api.transport.nsw.gov.au/v1/carpark

Writes src/public/data/facilities.json and src/public/data/carparks.json.
Run from backend/:  python3 tools/build_facilities.py
"""
import csv, io, json, os, re, sys, urllib.request, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "public", "data")
CSV_URL = ("https://opendata.transport.nsw.gov.au/data/dataset/25f006fd-d0fb-4a8e-bfda-7ea4033c1aeb/"
           "resource/e9d94351-f22d-46ea-b64d-10e7e238368a/download/locationfacilitydata.csv")
API = "https://api.transport.nsw.gov.au/v1/carpark"

ACCESS = {
    "Lift": "lift", "Escalator": "esc", "Stairs": "stairs", "Stair lift": "stairlift",
    "Wheelchair ramp boarding assistance": "ramp", "Hearing loop": "loop",
    "Hearing loop (ticket counter)": "loop", "Hearing loop (concourse only)": "loop",
    "Platform edge tactiles": "tactile", "Wharf edge tactiles": "tactile",
    "PA system for announcements": "pa", "Level crossing": "levelx",
}
FAC = {
    "Toilets": "toilet", "Wheelchair accessible toilet": "atoilet", "Wheelchair accessible toilet (MLAK)": "mlak",
    "Baby change table": "baby", "Commuter car park": "carpark", "Wheelchair accessible car space": "accpark",
    "Transport Park&Ride": "parkride", "Bike racks": "bikerack", "Bike lockers": "bikelocker", "Bike shed": "bikeshed",
    "Kiss and ride stopping area": "kiss", "Taxi rank": "taxi", "Emergency help point": "help", "Payphone": "phone",
    "Wheelchair accessible payphone": "phone", "Information point": "info", "Next service display": "display",
    "Multi-modal next service display": "display", "Free mobile phone charging": "charge", "Luggage storage": "luggage",
}
TICKET = {  # best machine wins
    "Opal card top up or single trip ticket machine (Cash or Card Payment)": "cash",
    "Opal card top up or single trip ticket machine (Card Payment only)": "card",
    "Opal card top up machine (Card Payment only)": "topup",
    "No Opal card top up or single trip ticket sales": "none",
}
RANK = {"cash": 0, "card": 1, "topup": 2, "none": 3}


def key():
    k = os.environ.get("TFNSW_API_KEY", "")
    env = os.path.join(ROOT, ".env")
    if not k and os.path.exists(env):
        for line in open(env):
            m = re.match(r"^TFNSW_API_KEY=(.*)$", line.strip())
            if m:
                k = m.group(1).strip()
    return k


def get(url, k=None):
    req = urllib.request.Request(url, headers={"Authorization": "apikey " + k} if k else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def facilities():
    rows = csv.DictReader(io.StringIO(get(CSV_URL).decode("utf-8-sig")))
    out = {}
    for r in rows:
        tsn = (r.get("TSN") or "").strip()
        if not tsn:
            continue
        acc = [a.strip() for a in (r.get("ACCESSIBILITY") or "").split("|") if a.strip()]
        fac = [f.strip() for f in (r.get("FACILITIES") or "").split("|") if f.strip()]
        level = ""
        for a in acc:
            if "Independent Access" in a: level = "I"
            elif "Assisted Access" in a: level = "A"
            elif "Not Accessible" in a: level = "N"
        tickets = [TICKET[f] for f in fac if f in TICKET]
        e = {
            "n": r["LOCATION_NAME"].strip(),
            "lat": round(float(r["LATITUDE"]), 6), "lon": round(float(r["LONGITUDE"]), 6),
            "m": (r.get("TRANSPORT_MODE") or "").strip(),
            "a": level,
            "x": sorted({ACCESS[a] for a in acc if a in ACCESS}),
            "f": sorted({FAC[f] for f in fac if f in FAC}),
            "t": sorted(tickets, key=lambda t: RANK[t])[0] if tickets else "",
        }
        if "Opal card top up machine (Card Payment only)" in fac and e["t"] in ("cash", "card"):
            e["tu"] = 1  # a separate card only top up machine as well
        for col, k in (("MORNING_PEAK", "pk"), ("AFTERNOON_PEAK", "pp"), ("ADDRESS", "ad"), ("PHONE", "ph")):
            v = (r.get(col) or "").strip()
            if v:
                e[k] = v
        if (r.get("SHORT_PLATFORM") or "").strip().lower() == "true":
            e["sp"] = 1
        out[tsn] = e
    return out


def carparks(k):
    names = json.loads(get(API, k))
    out = []
    for fid, name in sorted(names.items(), key=lambda kv: int(kv[0])):
        if "historical only" in name.lower():
            continue
        try:
            d = json.loads(get(API + "?facility=" + fid, k))
        except Exception as e:  # keep going; one car park down should not stop the build
            print("car park", fid, "failed:", e, file=sys.stderr)
            continue
        loc = d.get("location") or {}
        out.append({
            "id": fid,
            "name": re.sub(r"^Park&Ride - ", "", name).strip(),
            "tsn": str(d.get("tsn") or ""),
            "spots": int(d.get("spots") or 0),
            "lat": round(float(loc.get("latitude") or 0), 6), "lon": round(float(loc.get("longitude") or 0), 6),
            "address": ", ".join(x for x in (loc.get("address"), loc.get("suburb")) if x),
        })
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    stamp = datetime.date.today().isoformat()
    f = facilities()
    json.dump({"source": "Transport for NSW open data, Public Transport Location Facilities and Operators", "read": stamp, "stations": f},
              open(os.path.join(OUT, "facilities.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    print("facilities:", len(f))
    k = key()
    if not k:
        print("No TFNSW_API_KEY; car parks skipped", file=sys.stderr)
        return
    c = carparks(k)
    json.dump({"source": "Transport for NSW open data, Car Park API", "read": stamp, "carparks": c},
              open(os.path.join(OUT, "carparks.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    print("car parks:", len(c))


if __name__ == "__main__":
    main()
