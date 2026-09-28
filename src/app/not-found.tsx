import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const metadata = {
  title: '404 - Surface Not Found | Matos Systems',
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <Badge variant="outline" className="font-mono text-xs text-slate-500 mb-2">
            HTTP 404
          </Badge>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Operational Route Not Found
          </h1>
        </div>

        <Card className="border-slate-200 bg-white">
          <CardHeader className="p-5">
            <CardTitle className="text-sm font-semibold text-slate-900">
              Unrecognized Resource Path
            </CardTitle>
            <CardDescription className="text-xs">
              The requested address is not mapped to an active or approved operational route shell.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
              <span className="font-semibold text-slate-700">Approved Application Routes:</span>
              <ul className="list-disc list-inside space-y-1 pt-1 text-slate-600">
                <li><Link href="/operations" className="text-slate-900 underline">/operations</Link> — Operational Workspace</li>
                <li><Link href="/incidents" className="text-slate-900 underline">/incidents</Link> — Incident Queues</li>
                <li><Link href="/fleet" className="text-slate-900 underline">/fleet</Link> — Response Units</li>
                <li><Link href="/worker" className="text-slate-900 underline">/worker</Link> — Mobile Worker Portal</li>
                <li><Link href="/login" className="text-slate-900 underline">/login</Link> — Authentication Portal</li>
              </ul>
            </div>

            <div className="flex gap-2">
              <Link href="/operations" className="flex-1">
                <Button className="w-full text-xs" variant="default">
                  Return to Operations
                </Button>
              </Link>
              <Link href="/" className="flex-1">
                <Button className="w-full text-xs" variant="outline">
                  System Index
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
