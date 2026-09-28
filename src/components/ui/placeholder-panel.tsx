import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface PlaceholderPanelProps {
  title: string;
  surface: string;
  plannedCapabilities: string[];
  notes?: string;
  children?: React.ReactNode;
}

export function PlaceholderPanel({
  title,
  surface,
  plannedCapabilities,
  notes,
  children,
}: PlaceholderPanelProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h1>
            <Badge variant="outline" className="font-mono text-[10px]">
              {surface}
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Structural route shell — Phase 1 Application Foundation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default" className="text-[11px] bg-slate-100 text-slate-700">
            Phase 1: Foundation Ready
          </Badge>
        </div>
      </div>

      {children}

      <Card className="border-slate-200 bg-slate-50/50">
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-slate-800">
            Approved Future Architecture & Capabilities
          </CardTitle>
          <CardDescription>
            The following functionality is designed for this operational surface and will be introduced in subsequent authorized implementation phases:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs text-slate-600">
            {plannedCapabilities.map((capability, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
                <span>{capability}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Phase 1 Architecture Boundary: </span>
            {notes ||
              'Fabricated operational records, mock telemetry, and synthetic data are omitted in Phase 1 to prevent false implementation patterns before backend schemas and RLS are authorized.'}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
