'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createIncidentAction } from '@/lib/incidents/actions';
import { ServiceCapability, ServiceType, IncidentPriority } from '@/types';

interface IncidentIntakeFormProps {
  capabilities: ServiceCapability[];
}

export function IncidentIntakeForm({ capabilities }: IncidentIntakeFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  // Form field states for client validation
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType>('towing');
  const [priority, setPriority] = useState<IncidentPriority>('standard');
  const [requiredCapabilityId, setRequiredCapabilityId] = useState('');
  const [notes, setNotes] = useState('');

  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  const [vehicleReg, setVehicleReg] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);

    // Client-side validation
    if (!customerName.trim()) {
      setFormError('Customer name is required.');
      return;
    }
    if (!customerPhone.trim()) {
      setFormError('Customer phone number is required.');
      return;
    }
    if (!locationAddress.trim()) {
      setFormError('Location address is required.');
      return;
    }

    // Coordinate validation
    const hasLat = latitude.trim().length > 0;
    const hasLon = longitude.trim().length > 0;
    if (hasLat !== hasLon) {
      setFormError('Both latitude and longitude must be provided when entering coordinates (cannot be half-empty).');
      return;
    }

    if (hasLat && hasLon) {
      const latNum = Number(latitude);
      const lonNum = Number(longitude);

      if (Number.isNaN(latNum) || !Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
        setFormError('Latitude must be a valid number between -90 and 90 degrees.');
        return;
      }
      if (Number.isNaN(lonNum) || !Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
        setFormError('Longitude must be a valid number between -180 and 180 degrees.');
        return;
      }
    }

    if (vehicleYear.trim()) {
      const yearNum = Number.parseInt(vehicleYear, 10);
      if (Number.isNaN(yearNum) || yearNum < 1900 || yearNum > 2100) {
        setFormError('Vehicle year must be between 1900 and 2100.');
        return;
      }
    }

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await createIncidentAction(formData);

      if (!result.success) {
        setFormError(result.error || 'Failed to create incident.');
      } else if (result.incidentId) {
        router.push(`/incidents/${result.incidentId}`);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Error Notice */}
      {formError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 flex items-start gap-2">
          <span className="font-bold">Error:</span>
          <span>{formError}</span>
        </div>
      )}

      {/* 1. Customer Information Panel */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            1. Customer Contact Details
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Identify the stranded motorist and primary callback contact number.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label htmlFor="customer_name" className="block font-semibold text-slate-700 mb-1">
              Customer Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="customer_name"
              name="customer_name"
              type="text"
              required
              disabled={isPending}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Liam O'Connor"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label htmlFor="customer_phone" className="block font-semibold text-slate-700 mb-1">
              Customer Phone Number <span className="text-rose-500">*</span>
            </label>
            <input
              id="customer_phone"
              name="customer_phone"
              type="tel"
              required
              disabled={isPending}
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="e.g. +353 87 555 0192"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
            />
          </div>
        </div>
      </div>

      {/* 2. Incident & Service Requirement */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            2. Service Classification & Required Capabilities
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Define roadside assistance nature, operational urgency, and required vehicle equipment.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label htmlFor="service_type" className="block font-semibold text-slate-700 mb-1">
              Service Type <span className="text-rose-500">*</span>
            </label>
            <select
              id="service_type"
              name="service_type"
              disabled={isPending}
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value as ServiceType)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
            >
              <option value="towing">Towing (Standard)</option>
              <option value="jump_start">Battery Jump Start</option>
              <option value="lockout">Lockout & Key Recovery</option>
              <option value="tire_change">Tire Change / Inflation</option>
              <option value="fuel_delivery">Emergency Fuel Delivery</option>
              <option value="winch_recovery">Winch-Out / Off-Road Extraction</option>
              <option value="general_assistance">General Roadside Mechanical</option>
            </select>
          </div>

          <div>
            <label htmlFor="required_capability_id" className="block font-semibold text-slate-700 mb-1">
              Required Capability (Catalogue)
            </label>
            <select
              id="required_capability_id"
              name="required_capability_id"
              disabled={isPending}
              value={requiredCapabilityId}
              onChange={(e) => setRequiredCapabilityId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
            >
              <option value="">-- None / Standard Fleet Capability --</option>
              {capabilities.map((cap) => (
                <option key={cap.id} value={cap.id}>
                  {cap.name} ({cap.category})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="priority" className="block font-semibold text-slate-700 mb-1">
              Dispatch Priority <span className="text-rose-500">*</span>
            </label>
            <select
              id="priority"
              name="priority"
              disabled={isPending}
              value={priority}
              onChange={(e) => setPriority(e.target.value as IncidentPriority)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
            >
              <option value="low">Low (Standard Non-Urgent)</option>
              <option value="standard">Standard (Standard SLA)</option>
              <option value="high">High (Hazardous Location)</option>
              <option value="critical">Critical (Highway / Lane Blockage)</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="notes" className="block font-semibold text-slate-700 mb-1">
            Operational Problem Notes & Safety Hazard Context
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            disabled={isPending}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Engine stall, smoke from radiator, car stranded on hard shoulder of M50. Customer waiting behind safety barrier."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
          />
        </div>
      </div>

      {/* 3. Customer Vehicle Information */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            3. Customer Vehicle Information
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Vehicle registration plate, make, model, year, and appearance identifiers.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
          <div>
            <label htmlFor="vehicle_registration" className="block font-semibold text-slate-700 mb-1">
              Registration Plate
            </label>
            <input
              id="vehicle_registration"
              name="vehicle_registration"
              type="text"
              disabled={isPending}
              value={vehicleReg}
              onChange={(e) => setVehicleReg(e.target.value)}
              placeholder="e.g. 211-D-12345"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono uppercase text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label htmlFor="vehicle_make" className="block font-semibold text-slate-700 mb-1">
              Vehicle Make
            </label>
            <input
              id="vehicle_make"
              name="vehicle_make"
              type="text"
              disabled={isPending}
              value={vehicleMake}
              onChange={(e) => setVehicleMake(e.target.value)}
              placeholder="e.g. Volkswagen"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label htmlFor="vehicle_model" className="block font-semibold text-slate-700 mb-1">
              Vehicle Model
            </label>
            <input
              id="vehicle_model"
              name="vehicle_model"
              type="text"
              disabled={isPending}
              value={vehicleModel}
              onChange={(e) => setVehicleModel(e.target.value)}
              placeholder="e.g. Golf"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label htmlFor="vehicle_year" className="block font-semibold text-slate-700 mb-1">
              Model Year
            </label>
            <input
              id="vehicle_year"
              name="vehicle_year"
              type="number"
              min="1900"
              max="2100"
              disabled={isPending}
              value={vehicleYear}
              onChange={(e) => setVehicleYear(e.target.value)}
              placeholder="e.g. 2021"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label htmlFor="vehicle_color" className="block font-semibold text-slate-700 mb-1">
              Vehicle Color
            </label>
            <input
              id="vehicle_color"
              name="vehicle_color"
              type="text"
              disabled={isPending}
              value={vehicleColor}
              onChange={(e) => setVehicleColor(e.target.value)}
              placeholder="e.g. Silver Metallic"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
            />
          </div>
        </div>
      </div>

      {/* 4. Incident Location & Spatial Coordinates */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            4. Location & Geographic Coordinates
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Authoritative physical address and optional PostGIS geographic coordinates (WGS84).
          </p>
        </div>

        <div className="space-y-4 text-xs">
          <div>
            <label htmlFor="location_address" className="block font-semibold text-slate-700 mb-1">
              Incident Breakdown Address / Landmark <span className="text-rose-500">*</span>
            </label>
            <input
              id="location_address"
              name="location_address"
              type="text"
              required
              disabled={isPending}
              value={locationAddress}
              onChange={(e) => setLocationAddress(e.target.value)}
              placeholder="e.g. M50 Northbound, Junction 7 Lucan off-ramp, Dublin"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="latitude" className="block font-semibold text-slate-700 mb-1">
                Latitude (Optional, -90 to 90)
              </label>
              <input
                id="latitude"
                name="latitude"
                type="number"
                step="any"
                disabled={isPending}
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="e.g. 53.3498"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label htmlFor="longitude" className="block font-semibold text-slate-700 mb-1">
                Longitude (Optional, -180 to 180)
              </label>
              <input
                id="longitude"
                name="longitude"
                type="number"
                step="any"
                disabled={isPending}
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="e.g. -6.2603"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
              />
            </div>

            <div>
              <span className="block font-semibold text-slate-700 mb-1">
                Provenance Origin
              </span>
              <div className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-600">
                operator_manual (Intake)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Submission Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Link
          href="/incidents"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {isPending ? 'Creating Incident...' : 'Create Roadside Incident →'}
        </button>
      </div>
    </form>
  );
}
