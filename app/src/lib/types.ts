export type Occupancy = { level: number; text: string } | null;
export type Vehicle = { lat: number; lon: number; bearing?: number | null; speedKmh?: number | null; ageS?: number; occupancy?: Occupancy; label?: string } | null;
export type Alert = { id?: string; title: string; url?: string; priority?: string; body?: string; lines?: string[] };
export type Prediction = { delayMin: number; n: number; days: number; text: string; short: string; basis: string; kind: 'prediction' } | null;

export type Departure = {
  mode: string; modeName?: string; line: string; color?: string; dest: string; destId?: string; description?: string;
  platform?: string; platformChangedFrom?: string | null; stopId: string; stopName?: string; tripId?: string;
  planned: string; estimated?: string | null; realtime: boolean; delayMin?: number | null; cancelled?: boolean;
  wheelchair?: boolean; occupancy?: Occupancy; alerts?: (Alert | string)[]; vehicle?: Vehicle; stopsAway?: number | null;
  status?: { key: string; text: string }; pred?: Prediction;
};

export type DeparturesResp = {
  kind: 'departures'; stop: { id: string; name: string; fullName?: string; exactName?: string };
  items: Departure[]; modes?: any[]; alerts?: Alert[]; live?: { feedAt?: number; liveCount?: number; total?: number }; now: number;
};

export type Leg = {
  kind: 'transit' | 'walk'; mode?: string; modeName?: string; line?: string; color?: string; towards?: string; destId?: string; tripId?: string;
  stopId?: string; toStopId?: string; from?: string; fromPlatform?: string; to?: string; toPlatform?: string;
  planned?: string; estimated?: string; arrPlanned?: string; arrEstimated?: string; realtime?: boolean; delayMin?: number | null;
  durationMin: number; stops?: number; cancelled?: boolean; occupancy?: Occupancy; platformChangedFrom?: string | null; alerts?: Alert[];
  path?: [number, number][]; distanceM?: number;
  /** Step free access and live lift outages at each end of a transit leg. */
  access?: import('./access').LegAccess | null;
};

export type Journey = {
  leave: string; board: string; arrive: string; durationMin: number; changes: number; live: boolean; anyCancelled?: boolean;
  risk?: string; riskText?: string; legs: Leg[];
  /** Multi leg trips: a warning when a change is tight or missed because of a delay. */
  warn?: string | null; segs?: number[];
  /** Opal fare estimate for the fare type in Settings. */
  fare?: Fare | null;
};

export type FareLeg = { line?: string; mode?: string; km?: number; peak?: boolean; fare?: number | null; transferOff?: number; airportFee?: number; amount: number | null; joined?: boolean };
export type Fare = { type: string; typeName: string; total: number | null; peak: boolean; offPeak?: { from: string; save: number } | null; transfer?: number; airportFee?: number;
  capped?: boolean; unknown?: boolean; legs: FareLeg[]; estimate?: boolean };

export type TripResp = { kind: 'trip'; from: { id: string; name: string }; to: { id: string; name: string }; journeys: Journey[]; tomorrow?: boolean; now: number; error?: string; stops?: Place[]; fallback?: boolean[];
  /** True when Accessible trips (acc=1) was on. */
  accessible?: boolean;
  /** Car parks when the first leg starts at a Park and Ride station. */
  parking?: { station: Place; carparks: import('./access').CarPark[] } | null };

export type ServiceStop = { id: string; name: string; lat?: number; lon?: number; planned?: string; estimated?: string; passed?: boolean; mine?: boolean; alight?: boolean; skipped?: boolean; platform?: string };
export type ServiceResp = {
  kind: 'service'; tripId?: string; mode?: string; line?: string; color?: string; dest?: string; live?: boolean; delayMin?: number | null; cancelled?: boolean;
  vehicle?: Vehicle; where?: { text?: string; near?: string; next?: string } | null; nextIndex?: number; mineIndex?: number; alightIndex?: number; stopsAway?: number | null;
  mine?: { name: string; planned?: string; estimated?: string; passed?: boolean } | null; stops: ServiceStop[]; path?: [number, number][]; alerts?: Alert[]; pred?: Prediction; error?: string;
};

export type SearchItem = { id: string; name: string; modes?: number[] };
export type Place = { id: string; name: string };

export type Commute = { id: string; name: string; from: Place; to: Place; tod: number; todText: string; days: string; active: boolean };
export type Saved = { name: string; from: Place; to: Place };

export type WatchLeg = { mode: string; line: string; tripId?: string | null; stopId: string; toStopId?: string | null; from?: string | null; to?: string | null;
  planned: string; arrPlanned?: string | null; estimated?: string | null; fromPlatform?: string | null; toPlatform?: string | null; color?: string | null; towards?: string | null; destId?: string | null; walkBefore?: number };
export type Watch = { id: string; kind: 'svc' | 'trip'; title: string; active: boolean; ended?: string | null; created: number; updated: number; expires: number;
  legs: WatchLeg[]; lead?: number | null; to?: Place | null; origin?: Place | null; snap?: any; replanned?: number };
export type Note = { id: number; watch_id?: string; at: number; title: string; body: string; url?: string; pushed?: number };
export type WatchesResp = { items: Watch[]; notes: Note[]; push: number; expo?: number; lastTick: number | null; now: number };
