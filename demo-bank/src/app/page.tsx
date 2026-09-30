import { connection } from "next/server";
import { getMohar } from "@/lib/mohar";

async function checkMohar() {
  try {
    const health = await getMohar().getHealth();
    return {
      ok: health.status === "ok",
      detail: `chain ${health.chainId}, block ${health.blockNumber}`,
    };
  } catch {
    return {
      ok: false,
      detail: "MOHAR API not reachable — is `pnpm --filter @mohar/api dev` running?",
    };
  }
}

const plannedScreens = [
  "Bank login (mock)",
  "Gold Savings home — grams, PKR value, live price",
  "Buy gold",
  "Sell gold",
  "Send gold to another customer",
  "Verify backing (Proof of Reserve)",
];

export default async function Home() {
  await connection(); // render at request time so the status is live
  const status = await checkMohar();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-16">
      <p className="text-sm uppercase tracking-wide text-neutral-500">Demo Bank</p>
      <h1 className="mt-1 text-3xl font-semibold">Gold Savings</h1>
      <p className="mt-3 text-neutral-600 dark:text-neutral-400">
        Placeholder for the partner-bank demo. Screens are built against the MOHAR SDK once the
        designs are ready.
      </p>

      <section className="mt-8 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-medium">MOHAR integration</h2>
        <p className="mt-2 flex items-center gap-2 text-sm">
          <span
            className={`inline-block h-2 w-2 rounded-full ${status.ok ? "bg-green-500" : "bg-amber-500"}`}
            aria-hidden
          />
          {status.ok ? "Connected" : "Not connected"} · {status.detail}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium">Planned screens</h2>
        <ul className="mt-2 list-disc pl-5 text-sm text-neutral-600 dark:text-neutral-400">
          {plannedScreens.map((screen) => (
            <li key={screen}>{screen}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
