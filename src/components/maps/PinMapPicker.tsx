'use client';

import { useEffect, useRef } from 'react';

type LatLng = {
  lat: number;
  lng: number;
};

export function PinMapPicker({
  value,
  onChange,
  className,
}: {
  value: LatLng | null;
  onChange: (next: LatLng) => void;
  className?: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<unknown>(null);
  const markerRef = useRef<unknown>(null);

  useEffect(() => {
    let mounted = true;
    const setup = async () => {
      if (!mapContainerRef.current || mapRef.current) return;

      const L = await import('leaflet');
      if (!mounted || !mapContainerRef.current) return;

      const initial = value ?? { lat: 37.0902, lng: -95.7129 };
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView([initial.lat, initial.lng], value ? 14 : 4);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      const pinIcon = L.divIcon({
        className: 'pin-map-marker',
        html: '<div style="width:16px;height:16px;border-radius:9999px;background:#1f3d2b;border:2px solid #ffffff;box-shadow:0 1px 8px rgba(0,0,0,0.35)"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      const setMarker = (point: LatLng) => {
        if (!markerRef.current) {
          markerRef.current = L.marker([point.lat, point.lng], { icon: pinIcon, draggable: true }).addTo(map);
          (markerRef.current as { on: (event: string, cb: () => void) => void; getLatLng: () => { lat: number; lng: number } }).on('dragend', () => {
            const next = (
              markerRef.current as { getLatLng: () => { lat: number; lng: number } }
            ).getLatLng();
            onChange({ lat: next.lat, lng: next.lng });
          });
        } else {
          (markerRef.current as { setLatLng: (coords: [number, number]) => void }).setLatLng([point.lat, point.lng]);
        }
      };

      if (value) {
        setMarker(value);
      }

      map.on('click', (event: { latlng: { lat: number; lng: number } }) => {
        const next = { lat: event.latlng.lat, lng: event.latlng.lng };
        setMarker(next);
        onChange(next);
      });

      mapRef.current = map;
    };

    void setup();

    return () => {
      mounted = false;
      if (mapRef.current) {
        (mapRef.current as { remove: () => void }).remove();
      }
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [onChange, value]);

  useEffect(() => {
    if (!mapRef.current || !value) return;
    const map = mapRef.current as { setView: (latlng: [number, number], zoom?: number) => void };
    map.setView([value.lat, value.lng], 14);
  }, [value]);

  return <div ref={mapContainerRef} className={className ?? 'h-56 w-full rounded-xl border border-app-border'} />;
}
