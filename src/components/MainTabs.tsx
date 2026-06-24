import { Link } from "@tanstack/react-router";

const tabs = [
  { to: "/", label: "Overview" },
  { to: "/debrief", label: "Stint Analysis" },
] as const;

export function MainTabs() {
  return (
    <nav className="border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-1 px-6 py-2 font-mono text-xs uppercase tracking-[0.18em]">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            activeOptions={{ exact: true }}
            className="rounded-sm px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground data-[status=active]:bg-primary/10 data-[status=active]:text-primary"
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
