import AccountButton from "./AccountButton.jsx";
import { ConnectionPill } from "./Connection.jsx";

export default function PageHeader({ kicker, title, right }) {
  return (
    <header className="mb-4 flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        {kicker && <span className="truncate text-[12.5px] text-muted">{kicker}</span>}
        <h1 className="h-title m-0 truncate">{title}</h1>
      </div>
      <div className="flex flex-none items-center gap-2">
        <ConnectionPill />
        {right}
        <AccountButton />
      </div>
    </header>
  );
}
