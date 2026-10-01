import { entries } from "@/lib/devlog";

/** Feeds the "Behind the scenes" panel. */
export function GET() {
  return Response.json(entries(), { headers: { "Cache-Control": "no-store" } });
}
