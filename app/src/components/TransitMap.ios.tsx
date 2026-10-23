import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Icon, modeIconName } from './Icon';
import { TransitMapProps, boundsOf } from './TransitMap.types';

// Apple Maps on iPhone: no key needed, native look, follows light and dark mode.
export default function TransitMap(p: TransitMapProps) {
  const ref = useRef<MapView>(null);
  const fitted = useRef(false);
  const coords = useMemo(() => (p.path || []).map(([latitude, longitude]) => ({ latitude, longitude })), [p.path]);
  useEffect(() => {
    const b = boundsOf(p);
    if (!b || fitted.current) return;
    fitted.current = true;
    const [w, s, e, n] = b;
    setTimeout(() => ref.current?.fitToCoordinates([{ latitude: s, longitude: w }, { latitude: n, longitude: e }], { edgePadding: { top: 80, left: 40, right: 40, bottom: (p.bottomInset || 0) + 40 }, animated: false }), 50);
  }, [p]);
  return (
    <MapView ref={ref} style={[{ flex: 1 }, p.style]} showsUserLocation showsPointsOfInterests={false} showsCompass={false} pitchEnabled={false}
      initialRegion={{ latitude: -33.8688, longitude: 151.2093, latitudeDelta: 0.2, longitudeDelta: 0.2 }}>
      {coords.length > 1 ? <Polyline coordinates={coords} strokeColor={p.color} strokeWidth={5} lineCap="round" lineJoin="round" /> : null}
      {(p.stops || []).filter((s) => s.lat != null && s.lon != null).map((s) => (
        <Marker key={s.id} coordinate={{ latitude: s.lat!, longitude: s.lon! }} title={s.name} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={{ width: s.mine ? 14 : 9, height: s.mine ? 14 : 9, borderRadius: 7, backgroundColor: s.passed ? '#C7C7CC' : '#fff', borderWidth: s.mine ? 3.5 : 2, borderColor: s.passed ? '#AEAEB2' : p.color }} />
        </Marker>
      ))}
      {p.vehicle ? (
        <Marker coordinate={{ latitude: p.vehicle.lat, longitude: p.vehicle.lon }} anchor={{ x: 0.5, y: 0.5 }} zIndex={10}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: p.color, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
            <Icon name={modeIconName(p.mode)} size={16} color="#fff" />
          </View>
        </Marker>
      ) : null}
    </MapView>
  );
}
