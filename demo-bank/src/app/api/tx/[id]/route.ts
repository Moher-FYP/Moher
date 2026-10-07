import { MoharApiError } from "@mohar/sdk";
import { cookies } from "next/headers";
import { findCustomer } from "@/lib/customers";
import { getMoharQuiet } from "@/lib/mohar";
import { SESSION_COOKIE, canView } from "@/lib/session";

/** Status polling for the transaction screen. The browser never talks to MOHAR directly. */
export async function GET(_request: Request, { params }: RouteContext<"/api/tx/[id]">) {
  const customer = findCustomer((await cookies()).get(SESSION_COOKIE)?.value);
  if (!customer) {
    return Response.json({ error: "Sign in first" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const txn = await getMoharQuiet().getTransaction(id);
    if (!(await canView(customer, txn))) {
      return Response.json({ error: "Transaction not available" }, { status: 404 });
    }
    return Response.json(txn);
  } catch (error) {
    const status = error instanceof MoharApiError ? error.status : 502;
    return Response.json({ error: "Transaction not available" }, { status });
  }
}
