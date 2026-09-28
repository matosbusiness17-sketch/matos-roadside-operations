import { CustomerHeader } from '@/components/customer/customer-header';

export const metadata = {
  title: 'Confirm Location | Matos Systems Roadside',
  description: 'Secure customer location confirmation surface.',
};

export default function CustomerLocationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-start">
      <div className="w-full max-w-lg mx-auto min-h-screen bg-white border-x border-slate-200 flex flex-col shadow-sm">
        <CustomerHeader />
        <main className="flex-1 p-5 sm:p-6 flex flex-col">
          {children}
        </main>
        <footer className="border-t border-slate-100 p-4 text-center text-xs text-slate-400">
          Matos Systems • Secure Temporary Interaction Link
        </footer>
      </div>
    </div>
  );
}
