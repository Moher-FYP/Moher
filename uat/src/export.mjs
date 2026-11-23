// Writes everything the run touched to the run's folder, for the report: the action log, the
// system's own records (MOHAR's store and the portal's), and the partner apps' customers. Secrets
// (password hashes, sealed authenticator secrets, session tokens, API key hashes, CNIC hashes)
// are left out; only ids, names, statuses, amounts and times go in.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config, REPO } from "./config.mjs";
import { UAT, portalDb, storeDb } from "./lib.mjs";

const rows = (db, sql) =>
  db
    .prepare(sql)
    .all()
    .map((r) => JSON.parse(r.data));

function csv(list, columns) {
  const cell = (v) => {
    if (v === undefined || v === null) return "";
    let s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // never a spreadsheet formula
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    [
      columns.join(","),
      ...list.map((r) =>
        columns.map((c) => cell(c.split(".").reduce((o, k) => o?.[k], r))).join(","),
      ),
    ].join("\n") + "\n"
  );
}

export async function exportRun(entities, meta) {
  const explorer = config.explorer;
  const link = (h) => (explorer && h ? `${explorer}/tx/${h}` : "");
  const write = (name, list, columns) => {
    writeFileSync(`${UAT}/${name}.json`, JSON.stringify(list, null, 2));
    writeFileSync(`${UAT}/${name}.csv`, csv(list, columns));
  };

  const actions = readFileSync(`${UAT}/actions.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  write("actions", actions, [
    "seq",
    "round",
    "at",
    "ms",
    "app",
    "actor",
    "role",
    "feature",
    "action",
    "input",
    "expected",
    "actual",
    "result",
    "ids.customerId",
    "ids.walletId",
    "ids.quoteId",
    "ids.txnId",
    "ids.txHash",
    "ids.portalUserId",
    "ids.freezeRequestId",
    "ids.apiKeyId",
    "ids.deliveryId",
    "link",
  ]);

  const sdb = storeDb();
  const wallets = rows(sdb, "SELECT data FROM wallets ORDER BY rowid").map((w) => ({
    id: w.id,
    partner: w.partnerSlug,
    customer: w.externalCustomerId,
    address: w.address,
    kycLevel: w.kycLevel,
    createdAt: w.createdAt,
    simulated: w.simulated ?? false,
    explorer: explorer ? `${explorer}/address/${w.address}` : "",
  }));
  write("mohar-wallets", wallets, [
    "id",
    "partner",
    "customer",
    "address",
    "kycLevel",
    "createdAt",
    "simulated",
    "explorer",
  ]);
  const txns = rows(sdb, "SELECT data FROM transactions ORDER BY created_at").map((t) => ({
    id: t.id,
    partner: t.partnerSlug,
    type: t.type,
    status: t.status,
    walletId: t.walletId,
    toWalletId: t.counterpartyWalletId,
    grams: t.grams,
    netPaisa: t.netPaisa,
    valuePaisa: t.valuePaisa,
    quoteId: t.quoteId,
    failureCode: t.failureCode,
    createdAt: t.createdAt,
    confirmedAt: t.confirmedAt,
    txHash: t.txHash,
    simulated: t.simulated ?? false,
    link: link(t.txHash),
  }));
  write("mohar-transactions", txns, [
    "id",
    "partner",
    "type",
    "status",
    "walletId",
    "toWalletId",
    "grams",
    "netPaisa",
    "valuePaisa",
    "quoteId",
    "failureCode",
    "createdAt",
    "confirmedAt",
    "txHash",
    "simulated",
    "link",
  ]);
  const quotes = rows(sdb, "SELECT data FROM quotes ORDER BY created_at")
    .filter((q) => !q.simulated)
    .map((q) => ({
      id: q.id,
      partner: q.partnerSlug,
      walletId: q.walletId,
      side: q.side,
      grams: q.grams,
      grossPaisa: q.grossPaisa,
      netPaisa: q.netPaisa,
      createdAt: q.createdAt,
      expiresAt: q.expiresAt,
    }));
  write("mohar-quotes", quotes, [
    "id",
    "partner",
    "walletId",
    "side",
    "grams",
    "grossPaisa",
    "netPaisa",
    "createdAt",
    "expiresAt",
  ]);

  const pdb = portalDb();
  const users = rows(pdb, "SELECT data FROM users ORDER BY rowid").map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    partner: u.partnerSlug,
    status: u.status,
    failedAttempts: u.failedAttempts,
    lastFailedAt: u.lastFailedAt,
    createdAt: u.createdAt,
  }));
  write("portal-users", users, [
    "id",
    "email",
    "role",
    "partner",
    "status",
    "failedAttempts",
    "lastFailedAt",
    "createdAt",
  ]);
  for (const log of ["audit", "security"]) {
    const entries = pdb
      .prepare("SELECT data FROM log_entries WHERE log = ? ORDER BY seq")
      .all(log)
      .map((r) => JSON.parse(r.data));
    write(`portal-${log}-log`, entries, [
      "seq",
      "at",
      "userId",
      "email",
      "partner",
      "action",
      "target",
      "result",
      "detail",
      "ip",
      "hash",
      "prevHash",
    ]);
  }
  const deliveries = rows(pdb, "SELECT data FROM deliveries ORDER BY ord").map((d) => ({
    id: d.id,
    eventId: d.eventId,
    partner: d.partnerSlug,
    transactionId: d.transactionId,
    event: d.event,
    url: d.url,
    status: d.status,
    attempts: d.attempts?.length ?? 0,
    lastStatusCode: d.attempts?.at(-1)?.statusCode,
    lastError: d.attempts?.at(-1)?.error,
    lastMs: d.attempts?.at(-1)?.ms,
    createdAt: d.createdAt,
    nextAttemptAt: d.nextAttemptAt,
  }));
  write("webhook-deliveries", deliveries, [
    "id",
    "eventId",
    "partner",
    "transactionId",
    "event",
    "url",
    "status",
    "attempts",
    "lastStatusCode",
    "lastError",
    "lastMs",
    "createdAt",
    "nextAttemptAt",
  ]);
  const freezes = rows(pdb, "SELECT data FROM freeze_requests ORDER BY requested_at").map((f) => ({
    ...f,
    link: link(f.txHash),
  }));
  write("freeze-requests", freezes, [
    "id",
    "partnerSlug",
    "walletId",
    "action",
    "reason",
    "status",
    "requestedBy",
    "requestedAt",
    "decidedBy",
    "decidedAt",
    "txHash",
    "failure",
    "link",
  ]);
  const keys = rows(pdb, "SELECT data FROM api_keys ORDER BY created_at").map((k) => ({
    id: k.id,
    partner: k.partnerSlug,
    name: k.name,
    prefix: k.prefix,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
  }));
  write("api-keys", keys, [
    "id",
    "partner",
    "name",
    "prefix",
    "createdAt",
    "lastUsedAt",
    "revokedAt",
  ]);
  const anchors = rows(pdb, "SELECT data FROM anchors ORDER BY ord").map((a) => ({
    ...a,
    link: link(a.txHash),
  }));
  write("audit-anchors", anchors, [
    "at",
    "txHash",
    "audit.seq",
    "audit.hash",
    "security.seq",
    "security.hash",
    "link",
  ]);

  // The demo personas (Hassan, Aliya, …) live in the app's code, not its data file.
  const customers = Object.values(config.apps).map((a) => ({
    partner: a.slug,
    id: a.persona.id,
    name: a.persona.name,
    kycLevel: a.level,
    outcome: "demo persona",
    moharWalletId: storeDb()
      .prepare("SELECT id FROM wallets WHERE external_customer_id = ?")
      .get(`${a.slug}-${a.persona.id}`)?.id,
  }));
  for (const slug of ["demo-bank", "moher-wallet"]) {
    const file = `${REPO}/demo-bank/.data/customers-${slug}.json`;
    if (!existsSync(file)) continue;
    for (const c of JSON.parse(readFileSync(file, "utf8"))) {
      customers.push({
        partner: slug,
        id: c.id,
        name: c.name,
        kycLevel: c.kycLevel,
        outcome: c.onboarding?.outcome,
        riskBand: c.onboarding?.riskBand,
        cnicMasked: c.onboarding?.cnicMasked,
        phoneMasked: c.onboarding?.phoneMasked,
        screening: c.onboarding?.aml,
        openedAt: c.onboarding?.openedAt,
        moharWalletId: storeDb()
          .prepare("SELECT id FROM wallets WHERE external_customer_id = ?")
          .get(`${slug}-${c.id}`)?.id,
      });
    }
  }
  write("partner-customers", customers, [
    "partner",
    "id",
    "name",
    "kycLevel",
    "outcome",
    "riskBand",
    "cnicMasked",
    "phoneMasked",
    "screening",
    "openedAt",
    "moharWalletId",
  ]);

  writeFileSync(`${UAT}/entities.json`, JSON.stringify(entities, null, 2));
  const summary = {
    target: config.target,
    profile: config.profile,
    chainId: config.chainId,
    roundsPlanned: config.rounds,
    roundsFinished: meta.finished,
    actions: actions.length,
    passed: actions.filter((a) => a.result === "pass").length,
    failed: actions.filter((a) => a.result !== "pass").length,
    startedAt: actions[0]?.at,
    endedAt: actions.at(-1)?.at,
  };
  writeFileSync(`${UAT}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
}
