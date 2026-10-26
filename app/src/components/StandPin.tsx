// Exact stand pin above a ride leg in a trip: where you board ("Stand G"), on a small map when tapped, with the stand's
// own point from the trip planner and a hint when it is across the road from where your walk starts
// (lib/standPinCore.ts). Draws nothing when the leg has no point. The map loads only when opened.
import { useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { Icon, I } from './Icon';
import { MapCard } from './MapCard';
import TransitMap from './LazyTransitMap';
import { T } from './ui';
import { haptic } from '@/lib/haptic';
import { radius, usePalette } from '@/lib/theme';
import { acrossRoad, mapsUrl, metres, standName, standPoint, walkStart } from '@/lib/standPinCore';
import type { Leg } from '@/lib/types';

/** The bus's road near the stand: its path while within this many metres, drawn on the stand map. */
const ROAD_M = 350;

export function StandPin({ leg, prev, onScrollChange }: { leg: Leg; prev?: Leg; onScrollChange?: (on: boolean) => void }) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  const pt = standPoint(leg);
  if (!pt) return null;
  const name = standName(leg);
  const place = String(leg.from || '').split(',')[0].trim();
  const across = acrossRoad(leg, walkStart(prev));
  const title = name ? `${name} on the map` : 'Where to board, on the map';
  const hint = across ? `${name || 'The stop'} is across the road from where your walk starts` : '';
  const road = (leg.path || []).filter((p) => metres(pt, [p[0], p[1]]) <= ROAD_M) as [number, number][];
  const d = 0.0011;
  const color = leg.color || c.tint;
  const label = [place, name].filter(Boolean).join(', ') || 'Stand';
  return (
    <View style={{ marginLeft: 36, marginBottom: 6 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}${hint ? `. ${hint}` : ''}`}
        onPress={() => { haptic.select(); setOpen(!open); }} hitSlop={6}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1 })}>
        <Icon name={I.pin} size={14} color={c.tint} />
        <T kind="foot" tone="tint" style={{ fontWeight: '600', flexShrink: 1 }}>{title}</T>
        <Icon name={I.chevron} size={11} color={c.tint} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </Pressable>
      {hint ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <Icon name={I.warn} size={12} color={c.orange} />
          <T kind="foot" style={{ color: c.lateText, flexShrink: 1 }}>{hint}</T>
        </View>
      ) : null}
      {open ? (
        <View style={{ marginTop: 6, marginRight: 4 }}>
          <MapCard onScrollChange={onScrollChange || (() => {})} label={`Map of ${label}`}
            style={{ height: 180, borderRadius: radius, overflow: 'hidden', backgroundColor: c.card }}>
            <TransitMap embedded color={color} mode={leg.mode} dark={c.dark} path={road.length > 1 ? road : undefined}
              stops={[{ id: leg.stopId || 'stand', name: label, lat: pt[0], lon: pt[1], color }]}
              fit={[[pt[0] - d, pt[1] - d], [pt[0] + d, pt[1] + d]]} />
          </MapCard>
          <Pressable accessibilityRole="link" accessibilityLabel={`Open ${label} in Maps`} hitSlop={6}
            onPress={() => { Linking.openURL(mapsUrl(pt, label, Platform.OS)).catch(() => {}); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, alignSelf: 'flex-start' }}>
            <Icon name={I.walk} size={13} color={c.tint} />
            <T kind="foot" tone="tint" style={{ fontWeight: '600' }}>Walk there in Maps</T>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
