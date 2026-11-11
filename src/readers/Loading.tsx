/** 通用加载占位 */
export function Loading({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-transparent dark:border-slate-600" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
