import AccountButton from "./AccountButton.jsx";
import { ConnectionPill } from "./Connection.jsx";

export default function PageHeader({ kicker, title, right }) {
  return (
    <header className="mb-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        {kicker && <span className="text-[13px] text-muted">{kicker}</span>}
        <h1 className="h-title m-0">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        <ConnectionPill />
        {right}
        <AccountButton />
      </div>
    </header>
  );
}
