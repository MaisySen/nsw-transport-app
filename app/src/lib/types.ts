export type Occupancy = { level: number; text: string } | null;
export type Vehicle = { lat: number; lon: number; bearing?: number | null; speedKmh?: number | null; ageS?: number; occupancy?: Occupancy; label?: string;
  /** Live carriage occupancy (new server): where the train is emptier, and how many carriages report. */
  quiet?: { where: 'front' | 'middle' | 'back' | 'ends'; text: string } | null; cars?: number } | null;
export type Alert = { id?: string; title: string; url?: string; priority?: string; body?: string; lines?: string[] };
export type Prediction = { delayMin: number; n: number; days: number; text: string; short: string; basis: string; kind: 'prediction' } | null;

export type Departure = {
  mode: string; modeName?: string; line: string; color?: string; dest: string; destId?: string; description?: string;
  platform?: string; platformChangedFrom?: string | null; stopId: string; stopName?: string; tripId?: string;
  /** Which non-Sydney realtime feed carries this service (regional, TrainLink, Manly Fast Ferry); passed back to /api/service. */
  feed?: string;
  planned: string; estimated?: string | null; realtime: boolean; delayMin?: number | null; cancelled?: boolean;
  wheelchair?: boolean; occupancy?: Occupancy; alerts?: (Alert | string)[]; vehicle?: Vehicle; stopsAway?: number | null;
  /** Buses: live delays (min) from the bus's next stop to this stop (new server), for busLiveCore.rowTraffic. */
  ahead?: (number | null)[] | null;
  status?: { key: string; text: string }; pred?: Prediction;
  /** A board for another time (/api/departures with time): true when it left over a minute ago. */
  departed?: boolean;
  /** When this phone received the answer (set by api.ts, liveLabelCore.stampSeen). */
  seenAt?: number;
};

export type DeparturesResp = {
  kind: 'departures'; stop: { id: string; name: string; fullName?: string; exactName?: string };
  items: Departure[]; modes?: any[]; alerts?: Alert[]; live?: { feedAt?: number; liveCount?: number; total?: number }; now: number; seenAt?: number;
  /** The moment a board for another time is from, echoed by a server that takes time (api.transportsydney.app). */
  at?: { date: string; time: string; clamped?: boolean };
  /** Set by the app when it asked for one mode (`mode` on /api/departures); the items are that mode only. */
  askedMode?: string;
};

export type Leg = {
  kind: 'transit' | 'walk'; mode?: string; modeName?: string; line?: string; color?: string; towards?: string; destId?: string; tripId?: string; feed?: string;
  /** An on demand service (planner product class 10): runs when booked, `booking` when it must be booked ahead, `operator` who runs it. */
  onDemand?: boolean; booking?: boolean; operator?: string;
  stopId?: string; toStopId?: string; from?: string; fromPlatform?: string; to?: string; toPlatform?: string;
  planned?: string; estimated?: string; arrPlanned?: string; arrEstimated?: string; realtime?: boolean; delayMin?: number | null;
  durationMin: number; stops?: number; cancelled?: boolean; occupancy?: Occupancy; platformChangedFrom?: string | null; alerts?: Alert[];
  path?: [number, number][]; distanceM?: number;
  /** The station ids around the platform or stand ids, from the planner. */
  fromParent?: string; toParent?: string;
  /** Step free access and live lift outages at each end of a transit leg. */
  access?: import('./access').LegAccess | null;
  /** Bus and coach legs: a Live Traffic incident on the route (new server only). */
  traffic?: { id?: string; kind?: string; text: string; major?: boolean } | null;
  /** Bus and coach legs: live delays (min) from the bus's next stop to this leg's stop (new server). */
  ahead?: (number | null)[] | null;
  /** When this phone received the answer (set by api.ts, liveLabelCore.stampSeen). */
  seenAt?: number;
};

export type Journey = {
  /** acc=1 only: every station on the trip is listed as step free. */
  stepFree?: boolean;
  /** acc=1 only: stations on this trip with a lift out of service now. */
  liftOutages?: { id: string; name: string; title?: string }[];
  leave: string; board: string; arrive: string; durationMin: number; changes: number; live: boolean; anyCancelled?: boolean;
  risk?: string; riskText?: string; legs: Leg[];
  /** Multi leg trips: a warning when a change is tight or missed because of a delay. */
  warn?: string | null; segs?: number[];
  /** Opal fare estimate for the fare type in Settings. */
  fare?: Fare | null;
  seenAt?: number;
};

export type FareLeg = { line?: string; mode?: string; km?: number; peak?: boolean; fare?: number | null; transferOff?: number; airportFee?: number; amount: number | null; joined?: boolean };
export type Fare = { type: string; typeName: string; total: number | null; peak: boolean; offPeak?: { from: string; save: number } | null; transfer?: number; airportFee?: number;
  capped?: boolean; unknown?: boolean; legs: FareLeg[]; estimate?: boolean };

export type TripResp = { kind: 'trip'; from: { id: string; name: string }; to: { id: string; name: string }; journeys: Journey[]; tomorrow?: boolean; now: number; error?: string; stops?: Place[]; fallback?: boolean[];
  /** True when Accessible trips (acc=1) was on. */
  accessible?: boolean;
  /** acc=1 with lift aware trips: trips left out for a lift outage, or allAffected when every trip meets one. */
  liftAware?: { avoided: number; allAffected: boolean; stations: string[] } | null;
  /** Car parks when the first leg starts at a Park and Ride station. */
  parking?: { station: Place; carparks: import('./access').CarPark[] } | null;
  /** Mode chips: 'server' when the planner was asked for those modes only, 'phone' when the phone filtered the usual answer. */
  modesBy?: 'server' | 'phone';
  /** The modes and day the server honoured (only the new server echoes them). */
  modes?: string[]; date?: string };

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
  planned: string; arrPlanned?: string | null; estimated?: string | null; fromPlatform?: string | null; toPlatform?: string | null; color?: string | null; towards?: string | null; destId?: string | null; walkBefore?: number;
  /** Station ids of the boarding and get off stops, used to plan the next option after a missed change. */
  fromParent?: string | null; toParent?: string | null;
  /** Which non-Sydney realtime feed carries the service (TrainLink, regional buses, Manly Fast Ferry). '' when checked and it is a Sydney feed. */
  feed?: string | null };
export type Watch = { id: string; kind: 'svc' | 'trip'; title: string; active: boolean; ended?: string | null; created: number; updated: number; expires: number;
  legs: WatchLeg[]; lead?: number | null; to?: Place | null; origin?: Place | null; snap?: any; replanned?: number };
export type Note = { id: number; watch_id?: string; at: number; title: string; body: string; url?: string; pushed?: number };
export type WatchesResp = { items: Watch[]; notes: Note[]; push: number; expo?: number; lastTick: number | null; now: number };

export type PushCount = { web: number; expo: number };
export type MorningMode = 'train' | 'metro' | 'bus' | 'coach' | 'ferry' | 'lightrail';
export type MorningInput = { id?: string; from: Place; to: Place; time: string; days: number[]; lead: number; mode?: MorningMode | null; name?: string | null; active?: boolean };
export type MorningCheck = {
  id: string; name: string | null; from: Place; to: Place; time: string; timeText?: string; days: number[]; mode: MorningMode | null; lead: number; active: boolean; created?: number;
  last?: { day: string; at?: number; result: string; issues?: string[]; alert?: { title: string; body: string } | null } | null;
};
export type MorningListResp = { items: MorningCheck[]; push: PushCount; enabled: boolean; max?: number };
export type MorningPreview = {
  item: MorningCheck; found: boolean; issues: { kind: string; text: string; minutes?: number }[];
  service?: { line?: string; mode?: string; planned?: string; estimated?: string | null; platform?: string | null; realtime?: boolean; leave?: string; arrive?: string; changes?: number } | null;
  alert: { title: string; body: string } | null; sent: false;
};
