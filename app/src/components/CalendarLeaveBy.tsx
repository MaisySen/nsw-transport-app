// Calendar leave by on Home (More > Calendar leave by, off by default; docs/CALENDAR-LEAVE-BY.md): for events in
// the next 6 hours with a place, "Leave by 8:12am for Team meeting (Barangaroo)" from your usual start, planned live.
// The calendar is read on the phone, only while Home is on view, at most once per 5 minutes (useScreenPoll).
// Only the event's place (as a place search) and the trip query reach the server, with no install id or profile, so
// neither is kept in trip history; never the event's name, notes or people.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { usePalette, radius } from '@/lib/theme';
import { useScreenPoll } from '@/lib/activity';
import { searchPlaces, tripForCalendar } from '@/lib/api';
import { store, useStore } from '@/lib/store';
import { useFlag } from '@/lib/config';
import { calendarReadSupported, readEvents } from '@/lib/calendarLeaveBy';
import { CAL, cachedPlace, chooseResolved, leaveBy, leaveSub, leaveTitle, pickEvents, tripParams, tripQuery, type CalEvent, type CalPlace } from '@/lib/calendarLeaveByCore';
import type { Place } from '@/lib/types';
import { Icon, I } from './Icon';
import { T } from './ui';

type Row = { key: string; title: string; to: CalPlace; from: Place; start: number; leave: number; arrive: number; sub: string };

export function CalendarLeaveByCard({ origin, now }: { origin: Place | null; now: number }) {
  const c = usePalette();
  const st = useStore();
  const supported = useMemo(() => calendarReadSupported(), []);
  const on = useFlag('calendarLeaveBy') && supported && !!st.calLeaveBy;
  const [rows, setRows] = useState<Row[]>([]);
  const originRef = useRef(origin);
  originRef.current = origin;
  // The last calendar read, so a change of start (the commute card flips at 12) plans again without reading again.
  const lastRead = useRef<{ at: number; events: (CalEvent & { place: string })[] } | null>(null);

  const plan = useCallback(async (readCalendar: boolean) => {
    const o = originRef.current;
    const t = Date.now();
    if (readCalendar || !lastRead.current) lastRead.current = { at: t, events: pickEvents(await readEvents(t, t + CAL.windowMs), t) };
    if (!o) { setRows([]); return true; }
    const out: Row[] = [];
    let failed = false;
    for (const e of lastRead.current.events) {
      if (out.length >= CAL.maxShown) break;
      if (e.start <= t) continue;
      let p = cachedPlace(store.calPlaces(), e.place, t);
      if (p === undefined) {
        try {
          const r = await searchPlaces(e.place);
          p = chooseResolved(r.items, e.place);
          store.rememberCalPlace(e.place, p);
        } catch { failed = true; continue; }
      }
      // A place that can't be found, or that is where the trip starts, shows nothing.
      if (!p || p.id === o.id) continue;
      try {
        const r = await tripForCalendar(o.id, p.id, tripQuery(e.start, t));
        const lb = leaveBy(r.journeys, e.start, t);
        if (!lb) continue;
        out.push({ key: `${e.id}|${e.start}`, title: e.title, to: p, from: o, start: e.start, leave: lb.leave, arrive: lb.arrive, sub: leaveSub(lb.j, lb.arrive, e.start) });
      } catch { failed = true; }
    }
    setRows(out);
    return !failed;
  }, []);

  const refresh = useScreenPoll(() => (on ? plan(true) : true), CAL.everyMs, { enabled: on, runAtStart: true, staleMs: CAL.everyMs });
  useEffect(() => { if (!on) { setRows([]); lastRead.current = null; } }, [on]);
  // A new start place (Home and work set, the commute card flipping at 12) plans again from the last read.
  const originId = origin?.id || '';
  const seenOrigin = useRef(originId);
  useEffect(() => {
    if (!on || seenOrigin.current === originId) return;
    seenOrigin.current = originId;
    if (lastRead.current) plan(false); else refresh();
  }, [on, originId, plan, refresh]);

  const shown = rows.filter((r) => r.leave >= now - 60000 && r.start > now);
  if (!on || !shown.length) return null;
  return (
    <View style={[s.card, { backgroundColor: c.card, borderLeftColor: c.tint }]}>
      {shown.map((r, i) => {
        const title = leaveTitle(r.title, r.to.name, r.leave, now);
        return (
          <Pressable key={r.key} onPress={() => router.push({ pathname: '/trip', params: tripParams(r.from, r.to, r.start, Date.now()) })}
            accessibilityRole="button" accessibilityLabel={`${title}. ${r.sub}. From your calendar.`} accessibilityHint="Opens the trip, arriving by the start time"
            android_ripple={{ color: c.fill }}
            style={({ pressed }) => [s.row, i ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.sep } : null, { opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 }]}>
            <Icon name={I.calendar} size={16} color={c.tint} style={{ marginRight: 10, marginTop: 2, alignSelf: 'flex-start' }} />
            <View style={{ flex: 1 }}>
              <T kind="body" style={{ fontWeight: '600' }} numberOfLines={2}>{title}</T>
              <T kind="sub" tone="text2" style={{ marginTop: 2 }} numberOfLines={2}>{r.sub}</T>
            </View>
            <Icon name={I.chevron} size={13} color={c.text3} style={{ marginLeft: 8 }} />
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: radius, paddingHorizontal: 14, paddingVertical: 4, borderLeftWidth: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, minHeight: 44 },
});
