import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Matos Systems | Roadside Operations & Dispatch System',
  description:
    'Operational dispatch and response management platform for roadside assistance and mobile recovery units.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased text-slate-900 bg-white selection:bg-slate-900 selection:text-white min-h-screen">
        {children}
      </body>
    </html>
  );
}
