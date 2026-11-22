"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, whenSignedOut, type Me, type Role } from "@/lib/api";
import { when } from "@/lib/format";
import { Wordmark } from "./Brand";

const MeContext = createContext<Me | undefined>(undefined);

/** The signed-in user. Only inside the portal's pages, after sign-in. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside the portal shell");
  return me;
}

interface NavItem {
  href: string;
  label: string;
  roles: Role[];
}

const PARTNER: Role[] = ["viewer", "developer", "compliance"];

const NAV: NavItem[] = [
  { href: "/", label: "Overview", roles: PARTNER },
  { href: "/customers", label: "Customers", roles: PARTNER },
  { href: "/trading", label: "Trading", roles: PARTNER },
  { href: "/transactions", label: "Transactions", roles: PARTNER },
  { href: "/limits", label: "Limits and reserve", roles: PARTNER },
  { href: "/developers", label: "API keys and webhooks", roles: ["developer"] },
  { href: "/compliance", label: "Compliance", roles: ["compliance"] },
  { href: "/operator", label: "Partners, people and freezes", roles: ["operator"] },
  { href: "/compliance", label: "Audit log", roles: ["operator"] },
];

const ROLE_NAMES: Record<Role, string> = {
  viewer: "Viewer",
  developer: "Developer",
  compliance: "Compliance",
  operator: "MOHAR operator",
};

/**
 * The frame around every signed-in page: sidebar by role, who is signed in, sign-out. Loads
 * /me first; a 401 anywhere (session ended after 15 idle minutes or 8 hours) goes to sign-in.
 */
export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    whenSignedOut(() => router.replace(`/login?next=${encodeURIComponent(pathname)}`));
    api<Me>("/me").then(setMe, () => setMe(null));
  }, [router, pathname]);

  if (me === undefined) return null;
  if (me === null) return null; // whenSignedOut is redirecting

  const items = NAV.filter((item) => item.roles.includes(me.user.role));
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  async function signOut() {
    await api("/session", { method: "DELETE" }).catch(() => undefined);
    router.replace("/login");
  }

  return (
    <MeContext.Provider value={me}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-surface">
          <div className="px-5 py-6">
            <Wordmark />
          </div>
          <nav className="flex-1 space-y-0.5 px-3">
            {items.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active(item.href) ? "page" : undefined}
                className={`block rounded-full px-3.5 py-2 text-sm ${
                  active(item.href)
                    ? "bg-ink font-semibold text-white"
                    : "text-ink-soft hover:bg-sunken hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-line p-4">
            <p className="truncate text-sm font-medium text-ink" title={me.user.email}>
              {me.user.email}
            </p>
            <p className="text-xs text-ink-soft">
              {ROLE_NAMES[me.user.role]}
              {me.user.partner ? ` · ${me.user.partner}` : ""}
            </p>
            <p className="mt-1 text-xs text-ink-faint">Session ends {when(me.sessionExpiresAt)}</p>
            <button
              onClick={() => void signOut()}
              className="mt-3 text-xs font-semibold text-ink underline underline-offset-2"
            >
              Sign out
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-8 py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </MeContext.Provider>
  );
}
