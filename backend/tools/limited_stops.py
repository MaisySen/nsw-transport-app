#!/usr/bin/env python3
"""Limited Stops from the timetable (standard library only), used by build_planner.py.

A service is marked limited when it runs past stations or stops that its own line normally serves on that stretch.
Nothing is hard coded per line: the line's own trips for the day are the reference.

  * A line is the trips that share a route short name, a mode and an operator (T1, 333, F3, ...). Direction ids are
    not used: through running trains change route id mid line, so order along the trip is what counts.
  * Stops are compared at station level (a platform counts as its station). Rows where nobody may board or get off
    are passing points, not stops.
  * For each pair of stops a trip serves one after the other (a then b), every trip of the line that serves a and
    later b is looked at. A stop x between them counts as normally served when at least NORMAL_SHARE of those trips
    stop there (and at least MIN_TRIPS trips do). A trip that goes from a straight to b skips x.
  * Trains, metro, light rail and ferries: one skipped stop makes the trip limited. Buses and coaches can take a
    different street for part of a trip (a detour variant), so they need skips on at least BUS_MIN_GAPS separate
    stretches, BUS_MIN_SKIPPED stops in all, and at least BUS_MIN_SHARE of the stops they would otherwise make.
  * A route or trip whose own timetable name says "Limited stops" or "Express" is limited as well.
"""
import re, collections

NORMAL_SHARE = 1 / 3
MIN_TRIPS = 2          # trips that stop at x, at least
MIN_THROUGH = 4        # trips that serve a then b, at least (a few one off trips set no "normal")
BUS_MIN_GAPS = 3
BUS_MIN_SKIPPED = 4
BUS_MIN_SHARE = 0.25   # of the stops the trip would make if it stopped at all of them
RAIL_CLASSES = {1, 2, 4, 9}          # train, metro, light rail, ferry (Trip Planner product classes)
NAME_WORDS = re.compile(r"\blimited stops?\b|\bexpress\b", re.I)


def name_says_limited(*texts):
    return any(t and NAME_WORDS.search(t) for t in texts)


def _occurrences(seq):
    occ = collections.defaultdict(list)
    for i, s in enumerate(seq):
        occ[s].append(i)
    return occ


def limited_patterns(patterns, min_trips=MIN_TRIPS, share=NORMAL_SHARE):
    """patterns: list of (line key, product class, [station ids in order], trip count).
    Returns {pattern index: (skipped stop count, gaps with skips, stops served)} for the patterns that skip a
    normally served stop."""
    by_line = collections.defaultdict(list)
    for i, (lk, cls, seq, n) in enumerate(patterns):
        by_line[lk].append(i)
    out = {}
    for lk, idxs in by_line.items():
        if len(idxs) < 2:
            continue
        occ = {i: _occurrences(patterns[i][2]) for i in idxs}
        memo = {}

        def normal_between(a, b):
            if (a, b) in memo:
                return memo[(a, b)]
            through = 0
            served = collections.Counter()
            for r in idxs:
                o = occ[r]
                if a not in o or b not in o:
                    continue
                seq, n = patterns[r][2], patterns[r][3]
                best = None
                for ia in o[a]:
                    nb = [ib for ib in o[b] if ib > ia]
                    if nb and (best is None or nb[0] - ia < best[1] - best[0]):
                        best = (ia, nb[0])
                if best is None:
                    continue
                through += n
                for x in set(seq[best[0] + 1:best[1]]):
                    if x != a and x != b:
                        served[x] += n
            res = {x for x, w in served.items() if through >= MIN_THROUGH and w >= min_trips and w >= share * through}
            memo[(a, b)] = res
            return res

        for p in idxs:
            seq = patterns[p][2]
            mine = set(seq)
            skipped, gaps = 0, 0
            for k in range(len(seq) - 1):
                a, b = seq[k], seq[k + 1]
                if a == b:
                    continue
                miss = [x for x in normal_between(a, b) if x not in mine]
                if miss:
                    skipped += len(miss)
                    gaps += 1
            if skipped:
                out[p] = (skipped, gaps, len(mine))
    return out


def is_limited(cls, skipped, gaps, served):
    if cls in RAIL_CLASSES:
        return skipped >= 1
    return gaps >= BUS_MIN_GAPS and skipped >= BUS_MIN_SKIPPED and skipped >= BUS_MIN_SHARE * (served + skipped)
