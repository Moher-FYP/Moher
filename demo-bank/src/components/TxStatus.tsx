"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const FINAL = new Set(["confirmed", "failed"]);

/**
 * Watches a trade that is still settling, through the bank's own route handler (the browser
 * never talks to MOHAR), and re-renders the page from the server when its status changes: the
 * settling screen becomes the done or cancelled screen.
 */
export function TxWatcher({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  useEffect(() => {
    if (FINAL.has(status)) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/tx/${id}`, { cache: "no-store" });
        if (!response.ok || stopped) return;
        const txn = (await response.json()) as { status: string };
        if (txn.status !== status) {
          stopped = true;
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // the bank's server is restarting; try again on the next tick
      }
    }, 800);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id, status, router]);
  return null;
}
