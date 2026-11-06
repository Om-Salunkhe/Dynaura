export default function Legend() {
  return (
    <span className="flex gap-3 text-[11.5px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-[2px] bg-sun" />
        Solar
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-[2px] bg-grid" />
        Grid
      </span>
    </span>
  );
}
