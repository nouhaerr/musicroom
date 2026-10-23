import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { Position } from '../api/parties';

// The small web page shown inside the map: Leaflet, loaded from a CDN (nothing committed, checked by its
// fingerprint), with free OpenStreetMap tiles. It tells the app where the user tapped; the app tells it
// where the pin and the voting circle go.
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<style>html,body,#map{margin:0;height:100%;background:#111722;color:#B4BDCE;font:15px sans-serif}#map{display:grid;place-items:center}</style>
</head><body><div id="map"></div><script>
if (!window.L) {
  document.getElementById('map').textContent = 'The map could not load. Check your connection.';
} else {
  var map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  var pin = null, circle = null;
  map.on('click', function (e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ latitude: e.latlng.lat, longitude: e.latlng.lng }));
  });
  window.place = function (latitude, longitude, radius) {
    var at = [latitude, longitude];
    if (!pin) { pin = L.marker(at).addTo(map); circle = L.circle(at, { radius: radius, color: '#B7F576' }).addTo(map); map.setView(at, 16); }
    else { pin.setLatLng(at); circle.setLatLng(at).setRadius(radius); map.panTo(at); }
  };
}
</script></body></html>`;

// The venue on a map: tap to put the pin, the circle shows who will be close enough to vote
export function VenueMap({ pin, radius, onPin }: { pin: Position | null; radius: number; onPin: (pin: Position) => void }) {
  const view = useRef<WebView>(null);
  const [loaded, setLoaded] = useState(false);

  // Draw the pin and its circle each time they change, once the page is there to receive them
  useEffect(() => {
    if (loaded && pin) view.current?.injectJavaScript(`window.place && window.place(${pin.latitude}, ${pin.longitude}, ${radius}); true;`);
  }, [loaded, pin, radius]);

  function received(event: WebViewMessageEvent) {
    const tapped: unknown = JSON.parse(event.nativeEvent.data);
    if (typeof tapped === 'object' && tapped !== null && 'latitude' in tapped && 'longitude' in tapped
      && Number.isFinite(tapped.latitude) && Number.isFinite(tapped.longitude)) {
      onPin({ latitude: Number(tapped.latitude), longitude: Number(tapped.longitude) });
    }
  }

  return <View style={m.frame}>
    <WebView ref={view} source={{ html: PAGE }} originWhitelist={['*']} onLoadEnd={() => setLoaded(true)} onMessage={received}
      nestedScrollEnabled style={m.map} />
  </View>;
}

const m = StyleSheet.create({
  frame: { height: 260, borderRadius: 14, overflow: 'hidden', borderColor: '#3B4355', borderWidth: 1 },
  map: { backgroundColor: '#111722' },
});
