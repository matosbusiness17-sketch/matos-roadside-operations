export default function Loading() {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 space-y-3">
      <div className="h-6 w-6 rounded-full border-2 border-slate-300 border-t-slate-900 animate-spin" />
      <span className="text-xs font-medium text-slate-500">
        Loading operational interface...
      </span>
    </div>
  );
}
