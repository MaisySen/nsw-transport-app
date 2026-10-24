// Builds Trip Planner (EFA rapidJSON) answers for tests: one journey per call, legs by train.
const STN = {
  burwood: { id: "213410", name: "Burwood Station" },
  strathfield: { id: "213510", name: "Strathfield Station" },
  central: { id: "200060", name: "Central Station" },
  redfern: { id: "201510", name: "Redfern Station" },
  homebush: { id: "214010", name: "Homebush Station" },
  kingscross: { id: "201110", name: "Kings Cross Station" },
  townhall: { id: "200070", name: "Town Hall Station" },
};
export { STN };

// leg: { from, to, line, dep (ms), min (ride minutes), delay (min, null = no live), plat, platPlanned, cancelled, infos, occupancy }
export function efaLeg(l) {
  const a = STN[l.from], b = STN[l.to];
  const dep = l.dep, arr = l.dep + (l.min || 6) * 60000;
  const live = l.delay != null;
  const props = { platformName: l.plat || "Platform 1" };
  if (l.platPlanned) props.plannedPlatformName = l.platPlanned;
  if (l.occupancy) props.occupancy = l.occupancy;
  return {
    transportation: { disassembledName: l.line || "T1", number: l.line || "T1", product: { class: l.cls || 1 }, destination: { name: "Hornsby", id: "1" }, properties: { RealtimeTripId: l.trip || ("trip-" + dep) } },
    origin: { id: a.id + "1", name: a.name + ", " + props.platformName, disassembledName: a.name.replace(/ Station$/, ""), parent: { id: a.id, name: a.name },
      departureTimePlanned: new Date(dep).toISOString(), ...(live ? { departureTimeEstimated: new Date(dep + l.delay * 60000).toISOString() } : {}), properties: props },
    destination: { id: b.id + "2", name: b.name + ", Platform 2", disassembledName: b.name.replace(/ Station$/, ""), parent: { id: b.id, name: b.name },
      arrivalTimePlanned: new Date(arr).toISOString(), ...(live ? { arrivalTimeEstimated: new Date(arr + l.delay * 60000).toISOString() } : {}), properties: { platformName: "Platform 2" } },
    isRealtimeControlled: live, isCancelled: !!l.cancelled, duration: (l.min || 6) * 60, stopSequence: [{}, {}, {}],
    infos: (l.infos || []).map((t, i) => ({ id: "i" + i, subtitle: t, priority: "normal" })),
  };
}
export function efaTrip(journeys) { return { journeys: journeys.map((legs) => ({ legs: legs.map(efaLeg) })) }; }
export function liftInfo(stopId, kind = "ELEVATOR", title = "Lift 2 is not available") {
  return { id: "lift-" + stopId + kind, subtitle: title, properties: { announcementType: "liftsEscalators" }, affected: { stops: [{ id: stopId }], Infrastructures: [{ type: kind }] } };
}
