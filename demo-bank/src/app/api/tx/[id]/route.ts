import { MoharApiError } from "@mohar/sdk";
import { cookies } from "next/headers";
import { findCustomer } from "@/lib/customers";
import { getMoharQuiet } from "@/lib/mohar";
import { SESSION_COOKIE } from "@/lib/session";

/** Status polling for the transaction screen. The browser never talks to MOHAR directly. */
export async function GET(_request: Request, { params }: RouteContext<"/api/tx/[id]">) {
  if (!findCustomer((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Sign in first" }, { status: 401 });
  }
  const { id } = await params;
  try {
    return Response.json(await getMoharQuiet().getTransaction(id));
  } catch (error) {
    const status = error instanceof MoharApiError ? error.status : 502;
    return Response.json({ error: "Transaction not available" }, { status });
  }
}
