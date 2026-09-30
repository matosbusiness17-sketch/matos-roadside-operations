'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import {
  OperationsIncident,
  OperationsVehicle,
  OperationsSelection,
  IncidentPriority,
} from '@/types';

interface OperationsMapProps {
  incidents: OperationsIncident[];
  vehicles: OperationsVehicle[];
  selection: OperationsSelection;
  onSelectIncident: (id: string) => void;
  onSelectVehicle: (id: string) => void;
  onClearSelection: () => void;
  mapboxToken: string;
  isMapboxConfigured: boolean;
  fitTrigger: number;
  highlightedDispatchVehicleId?: string | null;
}

function hasValidCoordinates<T extends { longitude: number | null; latitude: number | null }>(
  item: T
): item is T & { longitude: number; latitude: number } {
  return (
    item.longitude !== null &&
    item.latitude !== null &&
    Number.isFinite(item.longitude) &&
    Number.isFinite(item.latitude) &&
    item.longitude >= -180 &&
    item.longitude <= 180 &&
    item.latitude >= -90 &&
    item.latitude <= 90
  );
}

function getPriorityColor(priority: IncidentPriority): { bg: string; border: string; text: string } {
  switch (priority) {
    case 'critical':
      return { bg: '#dc2626', border: '#991b1b', text: '#ffffff' }; // Red
    case 'high':
      return { bg: '#ea580c', border: '#c2410c', text: '#ffffff' }; // Orange/Amber
    case 'standard':
      return { bg: '#2563eb', border: '#1d4ed8', text: '#ffffff' }; // Blue
    case 'low':
      return { bg: '#475569', border: '#334155', text: '#ffffff' }; // Slate
    default:
      return { bg: '#475569', border: '#334155', text: '#ffffff' };
  }
}

export function OperationsMap({
  incidents,
  vehicles,
  selection,
  onSelectIncident,
  onSelectVehicle,
  onClearSelection,
  mapboxToken,
  isMapboxConfigured,
  fitTrigger,
  highlightedDispatchVehicleId,
}: OperationsMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const hasFittedInitialRef = useRef(false);

  const [mapError, setMapError] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // Helper to fit map to all valid points (filtered incidents + active vehicles)
  const fitOperationalArea = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const bounds = new mapboxgl.LngLatBounds();
    let pointCount = 0;
    let singlePoint: [number, number] | null = null;

    // Collect valid incident points
    for (const inc of incidents) {
      if (hasValidCoordinates(inc)) {
        bounds.extend([inc.longitude, inc.latitude]);
        pointCount++;
        singlePoint = [inc.longitude, inc.latitude];
      }
    }

    // Collect valid vehicle points
    for (const veh of vehicles) {
      if (hasValidCoordinates(veh)) {
        bounds.extend([veh.longitude, veh.latitude]);
        pointCount++;
        singlePoint = [veh.longitude, veh.latitude];
      }
    }

    if (pointCount > 1) {
      map.fitBounds(bounds, {
        padding: { top: 60, bottom: 60, left: 60, right: 60 },
        maxZoom: 15,
        duration: 900,
      });
    } else if (pointCount === 1 && singlePoint) {
      map.flyTo({
        center: singlePoint,
        zoom: 14,
        duration: 800,
      });
    }
  }, [incidents, vehicles]);

  // Handle external fit trigger (Fit operational area action)
  useEffect(() => {
    if (fitTrigger > 0 && isMapReady) {
      fitOperationalArea();
    }
  }, [fitTrigger, isMapReady, fitOperationalArea]);

  // Mapbox instance initialization effect (runs ONCE or upon retry)
  useEffect(() => {
    if (!isMapboxConfigured || !mapboxToken) {
      return;
    }

    const container = mapContainerRef.current;
    if (!container) return;

    setMapError(null);
    setIsMapReady(false);
    hasFittedInitialRef.current = false;

    let mapInstance: mapboxgl.Map | null = null;

    try {
      mapboxgl.accessToken = mapboxToken;

      mapInstance = new mapboxgl.Map({
        container,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [-0.1276, 51.5072], // Neutral fallback center
        zoom: 10,
        attributionControl: true,
      });

      mapInstance.addControl(
        new mapboxgl.NavigationControl({ showCompass: false }),
        'top-right'
      );

      mapInstance.on('load', () => {
        setIsMapReady(true);
      });

      mapInstance.on('error', (e) => {
        // Only surface fatal errors that prevent map rendering
        if (e.error && !mapRef.current?.loaded()) {
          console.error('Mapbox runtime error:', e.error);
          setMapError('The map could not be loaded.');
        }
      });

      // Clear selection on background click
      mapInstance.on('click', () => {
        onClearSelection();
      });

      mapRef.current = mapInstance;
    } catch (err) {
      console.error('Failed to initialize Mapbox GL:', err);
      queueMicrotask(() => {
        setMapError('The map could not be loaded.');
      });
    }

    return () => {
      // Cleanup all markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      if (mapInstance) {
        mapInstance.remove();
        mapRef.current = null;
      }
      setIsMapReady(false);
    };
  }, [mapboxToken, isMapboxConfigured, retryNonce, onClearSelection]);

  // Markers update effect (updates when incidents, vehicles, or selection change)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;

    // Clear previous markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const newMarkers: mapboxgl.Marker[] = [];

    // Render active response vehicles
    for (const veh of vehicles) {
      if (!hasValidCoordinates(veh)) {
        continue;
      }

      const isSelected = selection?.type === 'vehicle' && selection.id === veh.id;
      const isHighlighted = highlightedDispatchVehicleId === veh.id;

      const el = document.createElement('button');
      el.type = 'button';
      el.className = `group relative flex items-center justify-center cursor-pointer transition-transform duration-150 focus:outline-hidden ${
        isSelected || isHighlighted ? 'z-30 scale-125' : 'z-10 hover:scale-110'
      }`;
      el.setAttribute('aria-label', `Unit ${veh.callsign}`);

      const borderColor = isSelected ? '#f59e0b' : isHighlighted ? '#06b6d4' : '#94a3b8';
      const outline = isSelected
        ? '3px solid rgba(245, 158, 11, 0.5)'
        : isHighlighted
        ? '3px solid rgba(6, 182, 212, 0.6)'
        : 'none';
      const bg = isSelected ? '#0f172a' : isHighlighted ? '#082f49' : '#1e293b';

      // Vehicle Marker Graphic: High-contrast slate unit badge with antenna icon
      el.innerHTML = `
        <div style="
          display: flex;
          align-items: center;
          gap: 4px;
          background: ${bg};
          color: #f8fafc;
          padding: 3px 6px;
          border-radius: 9999px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11px;
          font-weight: 700;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -2px rgba(0, 0, 0, 0.2);
          border: 2px solid ${borderColor};
          outline: ${outline};
        ">
          <span style="font-size: 12px; line-height: 1;">⛟</span>
          <span>${veh.callsign}</span>
        </div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectVehicle(veh.id);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([veh.longitude, veh.latitude])
        .addTo(map);

      newMarkers.push(marker);
    }

    // Render active incidents (visually stronger than vehicles)
    for (const inc of incidents) {
      if (!hasValidCoordinates(inc)) {
        continue;
      }

      const isSelected = selection?.type === 'incident' && selection.id === inc.id;
      const colors = getPriorityColor(inc.priority);

      const el = document.createElement('button');
      el.type = 'button';
      el.className = `group relative flex items-center justify-center cursor-pointer transition-transform duration-150 focus:outline-hidden ${
        isSelected ? 'z-40 scale-125' : 'z-20 hover:scale-110'
      }`;
      el.setAttribute(
        'aria-label',
        `Incident ${inc.reference_number} — ${inc.priority} priority, ${inc.service_type}`
      );

      // Incident Marker Graphic: Distinct circular badge with prominent priority outline and pin pointer
      el.innerHTML = `
        <div style="
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
        ">
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 28px;
            height: 28px;
            padding: 0 5px;
            border-radius: 9999px;
            background: ${colors.bg};
            color: ${colors.text};
            font-size: 10px;
            font-weight: 800;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            border: 2px solid #ffffff;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
            outline: ${isSelected ? '3px solid #2563eb' : 'none'};
          ">
            <span>${inc.reference_number.replace(/^INC-\d{4}-/, '#')}</span>
          </div>
          <div style="
            width: 0;
            height: 0;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 6px solid ${colors.bg};
            margin-top: -1px;
          "></div>
        </div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectIncident(inc.id);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([inc.longitude, inc.latitude])
        .addTo(map);

      newMarkers.push(marker);
    }

    markersRef.current = newMarkers;

    // Initial bounding box fit on first load only
    if (!hasFittedInitialRef.current && (incidents.length > 0 || vehicles.length > 0)) {
      fitOperationalArea();
      hasFittedInitialRef.current = true;
    }
  }, [incidents, vehicles, selection, highlightedDispatchVehicleId, isMapReady, onSelectIncident, onSelectVehicle, fitOperationalArea]);

  // Focus on selected incident when selected and coordinates exist
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady || !selection || selection.type !== 'incident') {
      return;
    }

    const selectedInc = incidents.find((i) => i.id === selection.id);
    if (selectedInc && hasValidCoordinates(selectedInc)) {
      map.flyTo({
        center: [selectedInc.longitude, selectedInc.latitude],
        zoom: Math.max(map.getZoom(), 14),
        duration: 800,
      });
    }
  }, [selection, incidents, isMapReady]);

  // Missing Mapbox configuration fallback
  if (!isMapboxConfigured || !mapboxToken) {
    return (
      <div
        aria-label="Mapbox Configuration Notice"
        className="flex flex-col items-center justify-center h-full min-h-[420px] bg-slate-100 border border-slate-200 rounded-lg p-6 text-center"
      >
        <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 mb-3">
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
            />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          Operational map unavailable
        </h3>
        <p className="text-xs text-slate-500 max-w-sm">
          Mapbox access token is not configured. Queue, filters, and context panels remain operational.
        </p>
      </div>
    );
  }

  // Runtime Map initialization error fallback
  if (mapError) {
    return (
      <div
        aria-label="Map Initialization Error"
        className="flex flex-col items-center justify-center h-full min-h-[420px] bg-slate-100 border border-slate-200 rounded-lg p-6 text-center"
      >
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-3">
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-slate-900 mb-1">
          Operational map unavailable
        </h3>
        <p className="text-xs text-slate-500 max-w-sm mb-4">
          {mapError}
        </p>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          Retry Map
        </button>
      </div>
    );
  }

  const hasMappableIncidents = incidents.some(hasValidCoordinates);
  const hasMappableVehicles = vehicles.some(hasValidCoordinates);
  const hasNoMappableLocations = !hasMappableIncidents && !hasMappableVehicles;

  return (
    <div className="relative w-full h-full min-h-[420px] rounded-lg overflow-hidden border border-slate-200 shadow-xs bg-slate-100">
      <div ref={mapContainerRef} className="w-full h-full min-h-[420px]" />

      {/* Unobtrusive notification when zero operational locations exist */}
      {isMapReady && hasNoMappableLocations && (
        <div className="absolute top-3 left-3 z-10 bg-white/95 backdrop-blur-xs border border-slate-200 px-3 py-2 rounded-md shadow-xs text-xs text-slate-600">
          No mappable operational locations
        </div>
      )}

      {/* Map legend */}
      <div className="absolute bottom-3 left-3 z-10 bg-white/90 backdrop-blur-xs border border-slate-200 px-2.5 py-1.5 rounded shadow-xs flex items-center gap-3 text-[10px] text-slate-600">
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 border border-white" />
          <span>Incident</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-800 border border-white" />
          <span>Response Unit</span>
        </div>
      </div>
    </div>
  );
}
