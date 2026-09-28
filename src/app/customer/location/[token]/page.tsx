import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function CustomerLocationPage({ params }: PageProps) {
  const { token } = await params;

  return (
    <div className="space-y-5">
      <div className="border-b border-slate-200 pb-3">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">
          Location Confirmation
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Temporary motorist interaction link for pinpointing breakdown coordinates.
        </p>
      </div>

      <Card className="border-slate-200 bg-slate-50/50">
        <CardHeader className="p-4">
          <CardTitle className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
            Interaction Session Token
          </CardTitle>
          <CardDescription className="text-xs">
            Cryptographic token received from dispatch SMS
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="flex items-center justify-between rounded border border-slate-200 bg-white p-3 font-mono text-xs">
            <span className="text-slate-500">Token Parameter:</span>
            <span className="font-semibold text-slate-900 truncate max-w-[200px]">
              {token}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              Status: Structural Shell Ready
            </Badge>
            <Badge variant="default" className="text-[10px] bg-slate-200 text-slate-700">
              Phase 1 Standby
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="p-4">
          <CardTitle className="text-xs font-semibold text-slate-800">
            Future Interaction Workflow
          </CardTitle>
          <CardDescription className="text-xs">
            Capabilities authorized for subsequent implementation phases:
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <ol className="space-y-2 text-xs text-slate-600 list-decimal list-inside">
            <li>Customer receives short-link SMS following phone or automated intake</li>
            <li>Single-use cryptographic token is validated against active incident record</li>
            <li>Browser requests high-accuracy HTML5 Geolocation permission</li>
            <li>Pin is verified on simplified Mapbox confirmation view</li>
            <li>Coordinates and landmark notes are written directly to incident record</li>
          </ol>

          <div className="mt-4 rounded border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
            <span className="font-semibold">Security & Scope Notice: </span>
            In Phase 1, token validation, backend lookup, and browser GPS permission prompts are intentionally omitted. No operational controls or dispatcher navigation are exposed here.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
