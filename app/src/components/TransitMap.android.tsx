import { useMemo } from 'react';
import { View } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import { Icon, I } from './Icon';
import { TransitMapProps, boundsOf } from './TransitMap.types';

// Android: MapLibre with OpenFreeMap vector tiles (OpenStreetMap data). No Google key needed.
export default function TransitMap(p: TransitMapProps) {
  const b = boundsOf(p);
  const line = useMemo(() => ({
    type: 'Feature' as const, properties: {},
    geometry: { type: 'LineString' as const, coordinates: (p.path || []).map(([la, lo]) => [lo, la]) },
  }), [p.path]);
  const stops = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: (p.stops || []).filter((s) => s.lat != null && s.lon != null).map((s) => ({
      type: 'Feature' as const, id: s.id, properties: { passed: s.passed ? 1 : 0, mine: s.mine ? 1 : 0 },
      geometry: { type: 'Point' as const, coordinates: [s.lon!, s.lat!] },
    })),
  }), [p.stops]);
  return (
    <Map style={[{ flex: 1 }, p.style]} mapStyle={p.dark ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/positron'}
      logo={false} compass={false} attribution attributionPosition={{ bottom: (p.bottomInset || 0) + 8, right: 8 }}>
      <Camera initialViewState={b ? { bounds: b as any, padding: { top: 80, left: 40, right: 40, bottom: (p.bottomInset || 0) + 40 } } : { center: [151.2093, -33.8688], zoom: 11 }} />
      {line.geometry.coordinates.length > 1 ? (
        <GeoJSONSource id="route" data={line}>
          <Layer id="route-casing" type="line" paint={{ 'line-color': '#ffffff', 'line-width': 8 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
          <Layer id="route-line" type="line" paint={{ 'line-color': p.color, 'line-width': 5 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        </GeoJSONSource>
      ) : null}
      <GeoJSONSource id="stops" data={stops}>
        <Layer id="stops-c" type="circle" paint={{
          'circle-radius': ['case', ['==', ['get', 'mine'], 1], 7, 4.5],
          'circle-color': ['case', ['==', ['get', 'passed'], 1], '#C7C7CC', '#ffffff'],
          'circle-stroke-color': ['case', ['==', ['get', 'passed'], 1], '#9E9E9E', p.color],
          'circle-stroke-width': ['case', ['==', ['get', 'mine'], 1], 3.5, 2],
        }} />
      </GeoJSONSource>
      {p.vehicle ? (
        <Marker id="vehicle" lngLat={[p.vehicle.lon, p.vehicle.lat]} anchor="center">
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: p.color, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 4 }}>
            <Icon name={I.bus} size={16} color="#fff" />
          </View>
        </Marker>
      ) : null}
    </Map>
  );
}
