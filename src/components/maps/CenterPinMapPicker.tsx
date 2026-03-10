'use client';

import { useEffect, useRef } from 'react';

type LatLng = {
  lat: number;
  lng: number;
};

export function CenterPinMapPicker({
  center,
  onCenterChange,
  active = true,
  className,
}: {
  center: LatLng;
  onCenterChange: (next: LatLng) => void;
  active?: boolean;
  className?: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<unknown>(null);
  const onCenterChangeRef = useRef(onCenterChange);
  const initialCenterRef = useRef(center);

  useEffect(() => {
    onCenterChangeRef.current = onCenterChange;
  }, [onCenterChange]);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      if (!mapContainerRef.current || mapRef.current) return;
      const L = await import('leaflet');
      if (!mounted || !mapContainerRef.current) return;

      const initial = initialCenterRef.current;
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView([initial.lat, initial.lng], 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      map.on('moveend', () => {
        const next = map.getCenter();
        onCenterChangeRef.current({ lat: next.lat, lng: next.lng });
      });

      mapRef.current = map;
    };

    void init();

    return () => {
      mounted = false;
      if (mapRef.current) {
        (mapRef.current as { remove: () => void }).remove();
      }
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current as { getCenter: () => { lat: number; lng: number }; setView: (coords: [number, number], zoom?: number) => void };
    const current = map.getCenter();
    const hasMoved = Math.abs(current.lat - center.lat) > 0.000001 || Math.abs(current.lng - center.lng) > 0.000001;
    if (hasMoved) {
      map.setView([center.lat, center.lng], 14);
    }
  }, [center.lat, center.lng]);

  useEffect(() => {
    if (!active || !mapRef.current) return;
    const map = mapRef.current as { invalidateSize: (options?: { animate?: boolean }) => void };
    const timeout = window.setTimeout(() => {
      map.invalidateSize({ animate: false });
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [active]);

  return (
    <div className={`relative overflow-hidden rounded-xl border border-app-border ${className ?? 'h-72 w-full'}`}>
      <div ref={mapContainerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="text-2xl drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)]">📍</span>
      </div>
    </div>
  );
}
