export default function Legend() {
  return (
    <span className="flex gap-3 text-[11px] text-ink-2">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-sm bg-sun" />
        Solar
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-sm bg-grid" />
        Grid
      </span>
    </span>
  );
}
