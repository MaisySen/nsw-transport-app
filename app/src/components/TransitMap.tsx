import { useMemo } from 'react';
import { View } from 'react-native';
import { TransitMapProps, boundsOf } from './TransitMap.types';

// Web preview only: a Leaflet map with OpenStreetMap tiles in an iframe. Phones use the .ios and .android files.
export default function TransitMap(p: TransitMapProps) {
  const html = useMemo(() => {
    const b = boundsOf(p);
    const data = JSON.stringify({ path: p.path || [], stops: (p.stops || []).filter((s) => s.lat != null), v: p.vehicle || null, color: p.color, b, bottom: p.bottomInset || 0, dark: p.dark });
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><style>html,body,#m{margin:0;height:100%;background:${p.dark ? '#1c1c1e' : '#f2f2f7'}}.leaflet-control-attribution{font-size:9px}.dk{filter:invert(1) hue-rotate(180deg) brightness(.9) contrast(.9)}</style></head><body><div id="m"></div><script>
var d=${data};var m=L.map('m',{zoomControl:false,attributionControl:true});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'OpenStreetMap',className:d.dark?'dk':''}).addTo(m);
if(d.path.length>1){L.polyline(d.path,{color:'#fff',weight:9,opacity:1}).addTo(m);L.polyline(d.path,{color:d.color,weight:5}).addTo(m);}
d.stops.forEach(function(s){L.circleMarker([s.lat,s.lon],{radius:s.mine?7:4.5,color:s.passed?'#9e9e9e':d.color,weight:s.mine?3.5:2,fillColor:s.passed?'#c7c7cc':'#fff',fillOpacity:1}).addTo(m)});
if(d.v){L.marker([d.v.lat,d.v.lon],{icon:L.divIcon({className:'',iconSize:[34,34],html:'<div style="width:28px;height:28px;border-radius:17px;background:'+d.color+';border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>'})}).addTo(m)}
if(d.b){m.fitBounds([[d.b[1],d.b[0]],[d.b[3],d.b[2]]],{paddingTopLeft:[30,70],paddingBottomRight:[30,d.bottom+30]})}else{m.setView([-33.8688,151.2093],11)}
</script></body></html>`;
  }, [p]);
  return (
    <View style={[{ flex: 1, overflow: 'hidden' }, p.style]}>
      <iframe srcDoc={html} style={{ border: 0, width: '100%', height: '100%' }} title="map" />
    </View>
  );
}
