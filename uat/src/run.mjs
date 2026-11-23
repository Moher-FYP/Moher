// MOHAR acceptance run: every feature, as real users in a real browser, over several rounds,
// with every action logged. See uat/README.md.
//   pnpm uat                      local Anvil stack, full profile, headless
//   pnpm uat:amoy                 the Amoy deployment on this laptop, light profile, visible browser
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { config, REPO } from "./config.mjs";
import { exportRun } from "./export.mjs";
import {
  API,
  APPS,
  PortalSession,
  UAT,
  chromium,
  context,
  customersOf,
  deployment,
  devPrice,
  gramsUnits,
  note,
  onchain,
  partnerCall,
  sdk,
  sleep,
  step,
  storeDb,
  txnRecord,
  uid,
  viem,
  walletFor,
} from "./lib.mjs";
import * as ui from "./ui.mjs";

const ROUNDS = config.rounds;
const FULL = config.profile === "full";
const AMOY = config.target === "amoy";
console.log(
  `MOHAR acceptance run · ${config.target} · ${config.profile} profile · ${ROUNDS} rounds · log in ${UAT}`,
);

const browser = await chromium.launch({ headless: !config.headed, slowMo: config.slowMo });
const entities = {
  customers: [],
  portalUsers: [],
  apiKeys: [],
  freezeRequests: [],
  transactions: [],
};
const remember = (kind, item) => {
  entities[kind].push({ round: context.round, ...item });
};

// ---------------------------------------------------------------- people

const FIRST = [
  "Ayesha",
  "Bilal",
  "Fatima",
  "Hamza",
  "Iqra",
  "Junaid",
  "Mahnoor",
  "Omar",
  "Sana",
  "Usman",
  "Zara",
  "Danish",
  "Hira",
  "Kashif",
  "Noor",
  "Saad",
];
const LAST = [
  "Khan",
  "Malik",
  "Qureshi",
  "Siddiqui",
  "Sheikh",
  "Butt",
  "Chaudhry",
  "Raza",
  "Abbasi",
  "Mirza",
];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
function person(overrides = {}) {
  return {
    name: `${pick(FIRST)} ${pick(LAST)}`,
    cnic: `3520${1 + Math.floor(Math.random() * 8)}-${digits(7)}-${1 + Math.floor(Math.random() * 9)}`,
    expiry: "2032-06-30",
    dob: `19${70 + Math.floor(Math.random() * 30)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`,
    phone: `03${String(10 + Math.floor(Math.random() * 40))} ${digits(7)}`,
    occupation: "salaried",
    source: "salary",
    monthly: "25k_100k",
    ...overrides,
  };
}

// ---------------------------------------------------------------- partner app scenarios

async function onboarding(page, app) {
  const A = APPS[app];
  const made = {};
  const base = {
    app: A.name,
    actor: "new applicant",
    role: "customer",
    feature: "Open an account",
  };

  // A normal, low-risk applicant: account opens.
  const normal = person();
  made.normal = await step(
    {
      ...base,
      action: "Apply, low risk",
      input: `${normal.name}, salaried, salary, Rs 25k–100k a month`,
      expected: "Account opens; welcome screen",
    },
    async () => {
      const r = await ui.openAccount(page, app, normal);
      const customer = customersOf(app)
        .filter((c) => c.name === normal.name && c.onboarding?.outcome === "opened")
        .at(-1);
      if (customer)
        remember("customers", {
          app,
          id: customer.id,
          name: normal.name,
          outcome: "opened",
          risk: customer.onboarding.riskBand,
        });
      return {
        pass: r.where === "welcome" && /Welcome/.test(r.title ?? "") && !!customer,
        actual:
          r.where === "welcome"
            ? `${r.title?.trim()} (risk ${customer?.onboarding?.riskBand})`
            : `${r.where}: ${r.message}`,
        ids: { customerId: customer?.id },
        customer,
      };
    },
  );

  // Medium risk (occupation and source not stated): still opens.
  const medium = person({ occupation: "other", source: "other" });
  made.medium = await step(
    {
      ...base,
      action: "Apply, medium risk",
      input: `${medium.name}, occupation and source 'Other'`,
      expected: "Account opens at medium risk",
    },
    async () => {
      const r = await ui.openAccount(page, app, medium);
      const customer = customersOf(app)
        .filter((c) => c.name === medium.name && c.onboarding?.outcome === "opened")
        .at(-1);
      if (customer)
        remember("customers", {
          app,
          id: customer.id,
          name: medium.name,
          outcome: "opened",
          risk: customer.onboarding.riskBand,
        });
      return {
        pass: r.where === "welcome" && customer?.onboarding?.riskBand === "medium",
        actual:
          r.where === "welcome"
            ? `opened, risk ${customer?.onboarding?.riskBand}`
            : `${r.where}: ${r.message}`,
        ids: { customerId: customer?.id },
        customer,
      };
    },
  );

  // Politically exposed: referred for review, no account.
  const pep = person({ pep: true });
  await step(
    {
      ...base,
      action: "Apply, politically exposed",
      input: `${pep.name}, PEP box ticked`,
      expected: "Referred for review; no Gold Savings",
    },
    async () => {
      const r = await ui.openAccount(page, app, pep);
      const customer = customersOf(app)
        .filter((c) => c.name === pep.name)
        .at(-1);
      if (customer)
        remember("customers", {
          app,
          id: customer.id,
          name: pep.name,
          outcome: customer.onboarding?.outcome,
          risk: customer.onboarding?.riskBand,
        });
      const wallet = customer ? walletFor(A.slug, customer.id) : undefined;
      return {
        pass: r.where === "welcome" && customer?.onboarding?.outcome === "referred" && !wallet,
        actual: `${r.where}: ${r.title?.trim() ?? r.message}; outcome ${customer?.onboarding?.outcome}; MOHAR wallet ${wallet ? "CREATED" : "none"}`,
        ids: { customerId: customer?.id },
      };
    },
  );

  // Screening match: refused.
  await step(
    {
      ...base,
      action: "Apply, sanctions match",
      input: "Test Blocked Person",
      expected: "Refused: 'visit a branch'",
    },
    async () => {
      const r = await ui.openAccount(page, app, person({ name: "Test Blocked Person" }));
      return {
        pass: r.where === "error" && /branch/i.test(r.message ?? ""),
        actual: `${r.where}: ${r.message}`,
      };
    },
  );

  // Under 18, expired CNIC, and the same CNIC again.
  await step(
    {
      ...base,
      action: "Apply, under 18",
      input: "date of birth 2012-01-01",
      expected: "Refused: aged 18 and over",
    },
    async () => {
      const r = await ui.openAccount(page, app, person({ dob: "2012-01-01" }));
      return {
        pass: r.where === "error" && /18/.test(r.message ?? ""),
        actual: `${r.where}: ${r.message}`,
      };
    },
  );
  await step(
    {
      ...base,
      action: "Apply, expired CNIC",
      input: "CNIC expiry 2020-01-01",
      expected: "Refused: CNIC has expired",
    },
    async () => {
      const r = await ui.openAccount(page, app, person({ expiry: "2020-01-01" }));
      return {
        pass: r.where === "error" && /expired/i.test(r.message ?? ""),
        actual: `${r.where}: ${r.message}`,
      };
    },
  );
  await step(
    {
      ...base,
      action: "Apply again with an open account's CNIC",
      input: `CNIC of ${normal.name}`,
      expected: "Refused: account already open",
    },
    async () => {
      const r = await ui.openAccount(page, app, person({ cnic: normal.cnic }));
      return {
        pass: r.where === "error" && /already/i.test(r.message ?? ""),
        actual: `${r.where}: ${r.message}`,
      };
    },
  );
  await step(
    {
      ...base,
      action: "Apply with a bad CNIC",
      input: "CNIC 12345",
      expected: "Refused: 13 digits",
    },
    async () => {
      const r = await ui.openAccount(page, app, person({ cnic: "12345" }));
      return {
        pass: r.where === "error" && /13 digits/.test(r.message ?? ""),
        actual: `${r.where}: ${r.message}`,
      };
    },
  );
  return { normal: made.normal.customer, medium: made.medium.customer };
}

/** Checks a settled trade against MOHAR's record and the chain. */
async function confirmOnChain(txnId) {
  const record = txnRecord(txnId);
  if (!record) return { ok: false, why: "not in MOHAR's store" };
  if (record.status !== "confirmed") return { ok: false, why: `status ${record.status}`, record };
  const receipt = record.txHash ? await onchain.receipt(record.txHash) : undefined;
  return {
    ok: receipt?.status === "success",
    why: receipt ? `block ${receipt.blockNumber}, gas ${receipt.gasUsed}` : "no tx hash",
    record,
    receipt,
  };
}

async function trading(page, app, n1, n2, persona) {
  const A = APPS[app];
  const r = context.round;
  const odd = r % 2 === 1;
  const big = app === "bank" ? (FULL ? 5000 : 2000) : FULL ? 1000 : 500;
  const overLimit = app === "bank" ? 250000 : 30000;
  const limitName = app === "bank" ? "standard per-trade Rs 200,000" : "asaan per-trade Rs 25,000";
  const actor = (c) => `${c.name} (${c.id})`;
  const base = (c, feature) => ({ app: A.name, actor: actor(c), role: "customer", feature });

  const tradeStep = async (c, feature, action, input, expected, run, check) =>
    step({ ...base(c, feature), action, input, expected }, async () => {
      const res = await run();
      const chainCheck = res.txnId ? await confirmOnChain(res.txnId) : undefined;
      const wallet = walletFor(A.slug, c.id);
      if (res.txnId)
        remember("transactions", {
          app,
          customer: c.id,
          walletId: wallet?.id,
          txnId: res.txnId,
          quoteId: res.quoteId,
          type: chainCheck?.record?.type,
          status: chainCheck?.record?.status,
          grams: chainCheck?.record?.grams,
          txHash: chainCheck?.record?.txHash,
          feature,
          action,
        });
      const verdict = check(res, chainCheck);
      return {
        pass: verdict.pass,
        actual: verdict.actual,
        ids: {
          customerId: c.id,
          walletId: wallet?.id,
          quoteId: res.quoteId,
          txnId: res.txnId,
          txHash: chainCheck?.record?.txHash,
        },
      };
    });
  const settled = (title) => (res, c) => ({
    pass: res.title === title && c?.ok,
    actual: `${res.title ?? res.error}${res.grams ? `; ${res.grams} g for ${res.total}` : ""}; chain: ${c?.why}`,
  });
  const refused = (pattern, where) => (res) => ({
    pass: (!where || res.stage === where) && !!res.error && pattern.test(res.error),
    actual: `${res.stage}: ${res.error ?? res.title}`,
  });

  // ---- first customer: buy, refusals, price band, send, sell
  await ui.signIn(page, app, n1.id);
  const first = await tradeStep(
    n1,
    "Buy gold",
    `Buy Rs ${big.toLocaleString()} from own account`,
    `Rs ${big}`,
    "Settles; grams credited on chain",
    () => ui.buy(page, app, big),
    settled("Purchase complete"),
  );
  await step(
    {
      ...base(n1, "Receipt"),
      action: "Open the receipt",
      input: first.entry.ids.txnId,
      expected: "Gold purchase receipt with ledger reference",
    },
    async () => {
      const rec = await ui.receipt(page, app, first.entry.ids.txnId);
      return {
        pass:
          /Gold purchase/.test(rec.title) &&
          /Ledger reference/.test(rec.text) &&
          /Paid from/.test(rec.text),
        actual: rec.title,
        ids: { txnId: first.entry.ids.txnId },
      };
    },
  );
  await tradeStep(
    n1,
    "Buy gold",
    "Buy below the minimum",
    "Rs 50",
    "Refused: at least Rs 100",
    () => ui.buy(page, app, 50),
    refused(/100/, "buy"),
  );
  await tradeStep(
    n1,
    "KYC limits",
    "Buy over the per-trade limit",
    `Rs ${overLimit.toLocaleString()} (${limitName})`,
    "Refused with the limit named",
    () => ui.buy(page, app, overLimit),
    refused(/limit/i),
  );

  await tradeStep(
    n1,
    "Price band (0.5%)",
    "Pay after gold moves 1%",
    "Rs 1,500, price +1% before paying",
    "Cancelled; nothing charged; no gold",
    async () => {
      let moved;
      const res = await ui.buy(page, app, 1500, {
        beforePay: async () => {
          moved = await devPrice("up");
        },
      });
      await devPrice("reset");
      if (moved?.status !== 200)
        return { ...res, skipped: `price controls answered ${moved?.status}` };
      return res;
    },
    (res, c) =>
      res.skipped
        ? { pass: false, actual: `NOT RUN: ${res.skipped}` }
        : {
            pass:
              res.title === "Trade cancelled" &&
              c?.record?.status === "failed" &&
              c?.record?.failureCode === "price_moved",
            actual: `${res.title ?? res.error}; MOHAR status ${c?.record?.status} (${c?.record?.failureCode})`,
          },
  );

  const sendTo = FULL ? n2 : persona;
  await tradeStep(
    n1,
    "Send gold",
    `Send 0.005 g to ${sendTo.name}`,
    `to ${sendTo.id}`,
    "Settles; free; gold moves to the recipient",
    () => ui.send(page, app, sendTo.id, "0.005"),
    settled("Gold sent"),
  );
  await tradeStep(
    n1,
    "Send gold",
    "Send more than the balance",
    "500 g",
    "Refused: not enough gold",
    () => ui.send(page, app, sendTo.id, "500"),
    refused(/enough|balance/i),
  );
  await tradeStep(
    n1,
    "Sell gold",
    "Sell more than the balance",
    "999 g",
    "Refused: not enough gold",
    () => ui.sell(page, app, { grams: "999" }),
    refused(/enough|balance/i),
  );

  if (FULL) {
    await tradeStep(
      n1,
      "Sell gold",
      "Sell 0.01 g",
      "0.01 g",
      "Settles; rupees paid out",
      () => ui.sell(page, app, { grams: "0.01" }),
      settled("Sale complete"),
    );
  } else if (odd) {
    await tradeStep(
      n1,
      "Sell gold",
      "Sell all",
      "Sell all button",
      "Settles; balance exactly 0",
      () => ui.sell(page, app, { all: true }),
      settled("Sale complete"),
    );
    await step(
      {
        ...base(n1, "Home"),
        action: "Balance after selling all",
        input: "",
        expected: "0.0000 g on home and on chain",
      },
      async () => {
        const w = walletFor(A.slug, n1.id);
        const onChain = await onchain.balanceOf(w.address);
        const h = await ui.home(page, app);
        return {
          pass: onChain === 0n && Number(h.grams) === 0,
          actual: `home ${h.grams} g, chain ${onChain}`,
          ids: { walletId: w.id },
        };
      },
    );
  } else {
    await tradeStep(
      n1,
      "Sell gold",
      "Sell Rs 200 (in rupees)",
      "Rs 200",
      "Settles; about Rs 200 paid out",
      () => ui.sell(page, app, { pkr: "200" }),
      settled("Sale complete"),
    );
  }

  // ---- second customer (full profile): gold received, Raast, sell in rupees, sell all
  if (FULL) {
    await ui.signIn(page, app, n2.id);
    await step(
      {
        ...base(n2, "Home"),
        action: "See gold received",
        input: "",
        expected: "Home shows the gold sent to them",
      },
      async () => {
        const h = await ui.home(page, app);
        return {
          pass: h.ok && Number(h.grams) >= 0.005,
          actual: `balance ${h.grams} g, ${h.activity} activity rows`,
          ids: { customerId: n2.id },
        };
      },
    );
    await tradeStep(
      n2,
      "Buy gold",
      "Buy Rs 2,000 by Raast",
      "Raast ID 0300 1234567",
      "Settles; receipt says Raast",
      () => ui.buy(page, app, 2000, { raast: "0300 1234567" }),
      settled("Purchase complete"),
    );
    const raastTxn = entities.transactions.at(-1)?.txnId;
    await step(
      {
        ...base(n2, "Receipt"),
        action: "Receipt names Raast",
        input: raastTxn,
        expected: "Paid from: another bank by Raast",
      },
      async () => {
        const rec = await ui.receipt(page, app, raastTxn);
        return {
          pass: /Raast/.test(rec.text),
          actual: rec.text.match(/Paid from.{0,60}/)?.[0] ?? rec.text.slice(0, 120),
          ids: { txnId: raastTxn },
        };
      },
    );
    await tradeStep(
      n2,
      "Sell gold",
      "Sell Rs 300 (in rupees)",
      "Rs 300",
      "Settles; about Rs 300 paid out",
      () => ui.sell(page, app, { pkr: "300" }),
      settled("Sale complete"),
    );
    await tradeStep(
      n2,
      "Sell gold",
      "Sell all",
      "Sell all button",
      "Settles; balance exactly 0",
      () => ui.sell(page, app, { all: true }),
      settled("Sale complete"),
    );
    await step(
      {
        ...base(n2, "Home"),
        action: "Balance after selling all",
        input: "",
        expected: "0.0000 g on home and on chain",
      },
      async () => {
        const w = walletFor(A.slug, n2.id);
        const onChain = await onchain.balanceOf(w.address);
        const h = await ui.home(page, app);
        return {
          pass: onChain === 0n && Number(h.grams) === 0,
          actual: `home ${h.grams} g, chain ${onChain}`,
          ids: { walletId: w.id },
        };
      },
    );
  }

  // ---- the demo persona (Hassan / Aliya): a buy every round, by Raast on even rounds
  await ui.signIn(page, app, persona.id);
  const byRaast = !FULL && !odd;
  const pbuy = await tradeStep(
    persona,
    "Buy gold",
    byRaast ? "Buy Rs 1,000 by Raast" : "Buy Rs 1,000",
    byRaast ? "Raast ID 0300 1234567" : "Rs 1,000",
    byRaast ? "Settles; receipt says Raast" : "Settles",
    () => ui.buy(page, app, 1000, byRaast ? { raast: "0300 1234567" } : {}),
    settled("Purchase complete"),
  );
  await step(
    {
      ...base(persona, "Receipt"),
      action: byRaast ? "Receipt names Raast" : "Open the receipt",
      input: pbuy.entry.ids.txnId,
      expected: byRaast ? "Paid from: another bank by Raast" : "Gold purchase receipt",
    },
    async () => {
      const rec = await ui.receipt(page, app, pbuy.entry.ids.txnId);
      return {
        pass: byRaast ? /Raast/.test(rec.text) : /Gold purchase/.test(rec.title),
        actual: byRaast ? (rec.text.match(/Paid from.{0,60}/)?.[0] ?? rec.title) : rec.title,
        ids: { txnId: pbuy.entry.ids.txnId },
      };
    },
  );
  await step(
    {
      ...base(persona, "Home"),
      action: "See recent activity",
      input: "",
      expected: "Gold card and activity list",
    },
    async () => {
      const h = await ui.home(page, app);
      return {
        pass: h.ok && h.activity > 0,
        actual: `balance ${h.grams} g, ${h.activity} activity rows`,
      };
    },
  );
  await step(
    {
      ...base(persona, "Gold in the vault"),
      action: "Open the vault check",
      input: "",
      expected: "Accounted for, or waiting for the next statement",
    },
    async () => {
      const v = await ui.vault(page, app);
      return { pass: /accounted for|Not yet verified/.test(v.title), actual: v.title };
    },
  );

  // ---- the held price runs out (free: nothing is sent)
  await step(
    {
      ...base(persona, "Held price (60 s)"),
      action: "Wait out the held price",
      input: "Rs 1,000, wait 62 s",
      expected: "Pay button replaced by 'Get a new price'",
    },
    async () => {
      const res = await ui.buy(page, app, 1000, {
        beforePay: async () => {
          await sleep(62000);
        },
      });
      return {
        pass: res.expired === true && /new price/i.test(res.button ?? ""),
        actual: res.expired ? `expired: '${res.button?.trim()}'` : `${res.title ?? res.error}`,
        ids: { quoteId: res.quoteId },
      };
    },
  );
}

// ---------------------------------------------------------------- API (partner keys)

async function apiChecks() {
  const base = { app: "MOHAR API", role: "partner server", feature: "API" };
  await step(
    {
      ...base,
      actor: "no key",
      action: "Call without a key",
      input: "GET /v1/price",
      expected: "401 unauthorized",
    },
    async () => {
      const r = await fetch(`${API}/v1/price`);
      return { pass: r.status === 401, actual: String(r.status) };
    },
  );
  await step(
    {
      ...base,
      actor: "wrong key",
      action: "Call with a wrong key",
      input: "GET /v1/price",
      expected: "401 unauthorized",
    },
    async () => {
      const r = await partnerCall("mk_test_wrong", "GET", "/v1/price");
      return { pass: r.status === 401, actual: `${r.status} ${r.body?.error?.code}` };
    },
  );
  const walletCustomer = entities.customers.find(
    (c) => c.app === "wallet" && c.outcome === "opened",
  );
  const otherWallet = walletCustomer && walletFor("moher-wallet", walletCustomer.id);
  await step(
    {
      ...base,
      actor: "demo-bank",
      action: "Read another partner's wallet",
      input: otherWallet?.id,
      expected: "404 not found",
    },
    async () => {
      const r = await partnerCall("bank", "GET", `/v1/wallets/${otherWallet.id}`);
      return {
        pass: r.status === 404,
        actual: `${r.status} ${r.body?.error?.code}`,
        ids: { walletId: otherWallet.id },
      };
    },
  );
  const ext = `UAT-API-${context.round}-${uid().slice(0, 6)}`;
  const body = {
    externalCustomerId: ext,
    kyc: { reference: `UAT-KYC-${ext}`, level: "standard", verifiedAt: new Date().toISOString() },
  };
  const key = uid();
  const first = await step(
    {
      ...base,
      actor: "demo-bank",
      action: "Register a wallet",
      input: ext,
      expected: "201 with a wallet id",
    },
    async () => {
      const r = await partnerCall("bank", "POST", "/v1/wallets", body, { "Idempotency-Key": key });
      return {
        pass: r.status === 201,
        actual: `${r.status} ${r.body?.id ?? r.body?.error?.code}`,
        ids: { walletId: r.body?.id },
        id: r.body?.id,
      };
    },
  );
  await step(
    {
      ...base,
      actor: "demo-bank",
      action: "Repeat with the same Idempotency-Key",
      input: key,
      expected: "Same wallet, not a second one",
    },
    async () => {
      const r = await partnerCall("bank", "POST", "/v1/wallets", body, { "Idempotency-Key": key });
      return {
        pass: r.body?.id === first.id,
        actual: `${r.status} ${r.body?.id}`,
        ids: { walletId: r.body?.id },
      };
    },
  );
  await step(
    {
      ...base,
      actor: "demo-bank",
      action: "Same key, different body",
      input: key,
      expected: "409 idempotency_conflict",
    },
    async () => {
      const r = await partnerCall(
        "bank",
        "POST",
        "/v1/wallets",
        { ...body, externalCustomerId: `${ext}-x` },
        { "Idempotency-Key": key },
      );
      return { pass: r.status === 409, actual: `${r.status} ${r.body?.error?.code}` };
    },
  );
  await step(
    {
      ...base,
      actor: "demo-bank",
      action: "Money POST without Idempotency-Key",
      input: "POST /v1/mints",
      expected: "400 invalid_request",
    },
    async () => {
      const r = await partnerCall("bank", "POST", "/v1/mints", { quoteId: "qt_x" });
      return { pass: r.status === 400, actual: `${r.status} ${r.body?.error?.code}` };
    },
  );
  await step(
    {
      ...base,
      actor: "demo-bank",
      action: "Quote with a negative amount",
      input: "amountPkr -5",
      expected: "400 invalid_request",
    },
    async () => {
      const r = await partnerCall("bank", "POST", "/v1/quotes", {
        walletId: first.id,
        side: "buy",
        amountPkr: "-5",
      });
      return { pass: r.status === 400, actual: `${r.status} ${r.body?.error?.code}` };
    },
  );
  await step(
    {
      ...base,
      actor: "demo-bank",
      action: "Mint an unknown quote",
      input: "qt_0000000000000000000000",
      expected: "404 not_found",
    },
    async () => {
      const r = await partnerCall(
        "bank",
        "POST",
        "/v1/mints",
        { quoteId: "qt_0000000000000000000000" },
        { "Idempotency-Key": uid() },
      );
      return { pass: r.status === 404, actual: `${r.status} ${r.body?.error?.code}` };
    },
  );
  await step(
    {
      ...base,
      actor: "demo-bank",
      action: "Page through transactions",
      input: "limit 2, then cursor",
      expected: "No row twice; newest first",
    },
    async () => {
      const p1 = await partnerCall("bank", "GET", "/v1/transactions?limit=2");
      const p2 = await partnerCall(
        "bank",
        "GET",
        `/v1/transactions?limit=2&cursor=${p1.body.nextCursor}`,
      );
      const ids = [...p1.body.data, ...p2.body.data].map((t) => t.id);
      const sorted = [...p1.body.data, ...p2.body.data].every(
        (t, i, a) => i === 0 || a[i - 1].createdAt >= t.createdAt,
      );
      return {
        pass: new Set(ids).size === 4 && sorted,
        actual: `${ids.length} rows, ${new Set(ids).size} distinct, ordered ${sorted}`,
      };
    },
  );
  await step(
    {
      ...base,
      actor: "public",
      action: "Reserve",
      input: "GET /v1/reserve",
      expected: "Fully backed",
    },
    async () => {
      const r = await sdk.bank.getReserve();
      return {
        pass: r.fullyBacked === true,
        actual: `vault ${r.totalGramsInVault} g, customers ${r.tokenSupplyGrams} g, nonce ${r.nonce}`,
      };
    },
  );
}

// ---------------------------------------------------------------- portal

let operator;
/** A MOHAR operator for this run, made with the same CLI a person uses. Its password stays in memory. */
function bootstrapOperator() {
  const email = `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${digits(3)}@mohar.test`;
  const out = execFileSync(
    "pnpm",
    ["--filter", "@mohar/api", "portal:user", "add", "--email", email, "--role", "operator"],
    {
      cwd: REPO,
      env: { ...process.env, ...config.cliEnv },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return {
    email,
    role: "operator",
    password: out.match(/Password:\s+(\S+)/)[1],
    setupKey: out.match(/Setup key:\s+([A-Z2-7]+)/)[1],
  };
}

const MATRIX = [
  ["GET", "/portal/v1/me", ["viewer", "developer", "compliance", "operator"]],
  ["GET", "/portal/v1/overview", ["viewer", "developer", "compliance"]],
  ["GET", "/portal/v1/analytics?days=7", ["viewer", "developer", "compliance"]],
  ["GET", "/portal/v1/wallets", ["viewer", "developer", "compliance"]],
  ["GET", "/portal/v1/transactions", ["viewer", "developer", "compliance"]],
  ["GET", "/portal/v1/limits", ["viewer", "developer", "compliance"]],
  ["GET", "/portal/v1/transactions.csv", ["compliance"]],
  ["GET", "/portal/v1/audit", ["compliance", "operator"]],
  ["GET", "/portal/v1/audit/verify", ["compliance", "operator"]],
  ["GET", "/portal/v1/freeze-requests", ["compliance", "operator"]],
  ["GET", "/portal/v1/api-keys", ["developer"]],
  ["GET", "/portal/v1/webhook", ["developer"]],
  ["GET", "/portal/v1/webhook/deliveries", ["developer"]],
  ["GET", "/portal/v1/admin/partners", ["operator"]],
  ["GET", "/portal/v1/admin/users", ["operator"]],
];

let ops;
async function portal(page, customersByApp) {
  const base = (who, feature) => ({
    app: "Partner portal",
    actor: who.email,
    role: who.role,
    feature,
  });
  // One operator session for the whole run, signed in again only when it has ended (15 min idle).
  if (!ops || (await ops.call("GET", "/portal/v1/me")).status !== 200) {
    ops = new PortalSession(operator);
    await step(
      {
        ...base(operator, "Sign in"),
        action: "Operator signs in (API)",
        input: operator.email,
        expected: "200",
      },
      async () => {
        const r = await ops.signIn();
        return { pass: r.status === 200, actual: String(r.status) };
      },
    );
  }

  const users = {};
  for (const app of ["bank", "wallet"]) {
    for (const role of ["viewer", "developer", "compliance"]) {
      const email = `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${digits(3)}@${APPS[app].slug}.test`;
      const r = await step(
        {
          ...base(operator, "People"),
          action: `Create a ${role}`,
          input: `${email} for ${APPS[app].slug}`,
          expected: "201; password and setup key shown once",
        },
        async () => {
          const res = await ops.call("POST", "/portal/v1/admin/users", {
            email,
            role,
            partner: APPS[app].slug,
          });
          return {
            pass: res.status === 201 && !!res.body.password && !!res.body.setupKey,
            actual: `${res.status} ${res.body?.user?.id ?? res.body?.error?.message}`,
            ids: { portalUserId: res.body?.user?.id },
            res,
          };
        },
      );
      const user = {
        email,
        role,
        partner: APPS[app].slug,
        id: r.res?.body?.user?.id,
        password: r.res?.body?.password,
        setupKey: r.res?.body?.setupKey,
      };
      users[`${app}.${role}`] = user;
      remember("portalUsers", { email, role, partner: user.partner, id: user.id });
    }
  }
  await step(
    {
      ...base(operator, "People"),
      action: "Refuse a second account for one email",
      input: users["bank.viewer"].email,
      expected: "409",
    },
    async () => {
      const res = await ops.call("POST", "/portal/v1/admin/users", {
        email: users["bank.viewer"].email,
        role: "viewer",
        partner: "demo-bank",
      });
      return { pass: res.status === 409, actual: `${res.status} ${res.body?.error?.message}` };
    },
  );

  // Every role signs in through the real sign-in page once; its session is reused below.
  const sessions = { operator: ops };
  for (const key of ["bank.viewer", "bank.developer", "wallet.compliance"]) {
    const u = users[key];
    await step(
      {
        ...base(u, "Sign in"),
        action: "Sign in on the portal page",
        input: u.email,
        expected: "Lands on the portal",
      },
      async () => {
        const r = await ui.portalSignIn(page, u);
        if (r.cookie) {
          sessions[key] = new PortalSession(u);
          sessions[key].cookie = r.cookie;
        }
        return {
          pass: r.ok,
          actual: r.ok ? `at ${r.path}` : r.message,
          ids: { portalUserId: u.id },
        };
      },
    );
    const pages =
      u.role === "developer"
        ? ["/", "/trading", "/developers"]
        : u.role === "compliance"
          ? ["/", "/compliance", "/transactions"]
          : ["/", "/trading", "/customers", "/transactions", "/limits"];
    for (const path of pages) {
      await step(
        {
          ...base(u, "Portal pages"),
          action: `Open ${path}`,
          input: path,
          expected: "Page loads without an error",
        },
        async () => {
          const r = await ui.portalPage(page, path);
          return {
            pass: !!r.heading && !r.alert && page.errors.length === 0,
            actual: `${r.heading}${r.alert ? ` · ALERT ${r.alert}` : ""}${page.errors.length ? ` · console: ${page.errors.join(" | ")}` : ""}`,
          };
        },
      );
      page.errors.length = 0;
    }
  }

  // API sign-ins for the users the checks below need and the page did not sign in.
  for (const [key, u] of Object.entries(users).filter(([k]) =>
    ["bank.compliance", "wallet.developer"].includes(k),
  )) {
    const s = new PortalSession(u);
    const r = await s.signIn();
    if (r.status !== 200)
      await step(
        { ...base(u, "Sign in"), action: "Sign in (API)", input: u.email, expected: "200" },
        async () => ({ pass: false, actual: `${r.status} ${r.body?.error?.message}` }),
      );
    sessions[key] = s;
  }
  for (const [method, path, allowed] of MATRIX) {
    for (const key of ["operator", "bank.viewer", "bank.developer", "bank.compliance"]) {
      const s = sessions[key];
      const role = key === "operator" ? "operator" : key.split(".")[1];
      const ok = allowed.includes(role);
      await step(
        {
          ...base(s.user, "Access control"),
          action: `${method} ${path.split("?")[0]}`,
          input: role,
          expected: ok ? "200" : "403",
        },
        async () => {
          const r = await s.call(method, path);
          return { pass: ok ? r.status === 200 : r.status === 403, actual: String(r.status) };
        },
      );
    }
  }
  await step(
    {
      ...base(users["bank.viewer"], "Access control"),
      action: "See only own partner's wallets",
      input: "demo-bank viewer",
      expected: "No moher-wallet wallet in the list",
    },
    async () => {
      const r = await sessions["bank.viewer"].call("GET", "/portal/v1/wallets?limit=100");
      const leaked = (r.body.data ?? []).filter(
        (w) =>
          storeDb().prepare("SELECT partner_slug FROM wallets WHERE id = ?").get(w.id)
            ?.partner_slug !== "demo-bank",
      );
      return {
        pass: r.status === 200 && leaked.length === 0,
        actual: `${r.body.data?.length} wallets, other partner's: ${leaked.length}`,
      };
    },
  );

  // Developer: API keys and webhooks.
  const dev = sessions["bank.developer"];
  const created = await step(
    {
      ...base(dev.user, "API keys"),
      action: "Create an API key",
      input: `uat-r${context.round}`,
      expected: "201; key shown once",
    },
    async () => {
      const r = await dev.call("POST", "/portal/v1/api-keys", { name: `uat-r${context.round}` });
      if (r.body?.apiKey)
        remember("apiKeys", {
          id: r.body.apiKey.id,
          partner: "demo-bank",
          prefix: r.body.apiKey.prefix,
        });
      return {
        pass: r.status === 201 && !!r.body.key,
        actual: `${r.status} ${r.body?.apiKey?.id} (${r.body?.apiKey?.prefix}…)`,
        ids: { apiKeyId: r.body?.apiKey?.id },
        r,
      };
    },
  );
  const newKey = created.r?.body?.key;
  await step(
    {
      ...base(dev.user, "API keys"),
      action: "Use the new key",
      input: "GET /v1/price",
      expected: "200",
    },
    async () => {
      const r = await partnerCall(newKey, "GET", "/v1/price");
      return { pass: r.status === 200, actual: `${r.status} XAU/USD ${r.body?.xauUsd}` };
    },
  );
  await step(
    {
      ...base(dev.user, "API keys"),
      action: "Revoke the key",
      input: created.r?.body?.apiKey?.id,
      expected: "200",
    },
    async () => {
      const r = await dev.call(
        "POST",
        `/portal/v1/api-keys/${created.r.body.apiKey.id}/revoke`,
        {},
      );
      return {
        pass: r.status === 204 || r.status === 200,
        actual: String(r.status),
        ids: { apiKeyId: created.r.body.apiKey.id },
      };
    },
  );
  await step(
    {
      ...base(dev.user, "API keys"),
      action: "Use the revoked key",
      input: "GET /v1/price",
      expected: "401",
    },
    async () => {
      const r = await partnerCall(newKey, "GET", "/v1/price");
      return { pass: r.status === 401, actual: String(r.status) };
    },
  );
  await step(
    {
      ...base(dev.user, "Webhooks"),
      action: "Deliveries reached the bank",
      input: "GET /webhook/deliveries",
      expected: "Deliveries present, none failed",
    },
    async () => {
      const r = await dev.call("GET", "/portal/v1/webhook/deliveries?limit=100");
      const rows = r.body.data ?? [];
      const counts = rows.reduce((m, d) => ((m[d.status] = (m[d.status] ?? 0) + 1), m), {});
      return {
        pass: rows.length > 0 && !counts.failed,
        actual: JSON.stringify(counts),
        ids: { deliveryId: rows[0]?.id },
        rows,
      };
    },
  ).then(async (d) => {
    const one = d.rows?.[0];
    if (!one) return;
    await step(
      {
        ...base(dev.user, "Webhooks"),
        action: "Resend a delivery",
        input: one.id,
        expected: "Accepted (2xx)",
      },
      async () => {
        const r = await dev.call("POST", `/portal/v1/webhook/deliveries/${one.id}/resend`, {});
        return {
          pass: r.status >= 200 && r.status < 300,
          actual: `${r.status} ${r.body?.status ?? r.body?.error?.message ?? ""}`,
          ids: { deliveryId: one.id },
        };
      },
    );
  });

  // Compliance and operator: freeze, check it bites, unfreeze; and a rejected request. On the
  // light profile the freeze itself (two transactions from the compliance key) runs in round 1.
  for (const app of ["bank", "wallet"]) {
    const comp = sessions[`${app}.compliance`];
    const target = customersByApp[app].n1;
    const wallet = walletFor(APPS[app].slug, target.id);
    if (FULL || context.round === 1) {
      const freeze = await step(
        {
          ...base(comp.user, "Freeze"),
          action: "Request a freeze",
          input: `${wallet.id} (${target.name})`,
          expected: "201 pending",
        },
        async () => {
          const r = await comp.call("POST", `/portal/v1/wallets/${wallet.id}/freeze-requests`, {
            action: "freeze",
            reason: `UAT round ${context.round}: suspicious activity check`,
          });
          if (r.body?.id)
            remember("freezeRequests", { id: r.body.id, walletId: wallet.id, action: "freeze" });
          return {
            pass: r.status === 201 && r.body.status === "pending",
            actual: `${r.status} ${r.body?.id} ${r.body?.status}`,
            ids: { walletId: wallet.id, freezeRequestId: r.body?.id },
            r,
          };
        },
      );
      await step(
        {
          ...base(operator, "Freeze"),
          action: "Approve the freeze",
          input: freeze.r?.body?.id,
          expected: "Done; wallet frozen on chain",
        },
        async () => {
          const r = await ops.call(
            "POST",
            `/portal/v1/admin/freeze-requests/${freeze.r.body.id}/approve`,
            {},
          );
          const status = await onchain.walletStatus(wallet.address);
          return {
            pass: r.status === 200 && r.body.status === "done" && status === 2,
            actual: `${r.status} ${r.body?.status}, chain status ${status}, tx ${r.body?.txHash?.slice(0, 12)}…`,
            ids: { freezeRequestId: freeze.r.body.id, txHash: r.body?.txHash },
          };
        },
      );
      await ui.signIn(page, app, target.id);
      await step(
        {
          app: APPS[app].name,
          actor: `${target.name} (${target.id})`,
          role: "customer",
          feature: "Freeze",
          action: "Try to buy while frozen",
          input: "Rs 1,000",
          expected: "Refused; nothing charged",
        },
        async () => {
          const r = await ui.buy(page, app, 1000);
          if (r.txnId)
            remember("transactions", {
              app,
              customer: target.id,
              txnId: r.txnId,
              type: "mint",
              status: txnRecord(r.txnId)?.status,
              feature: "Freeze",
              action: "buy while frozen",
            });
          const refused =
            (r.error && /frozen|hold/i.test(r.error)) || r.title === "Trade cancelled";
          return {
            pass: !!refused && r.title !== "Purchase complete",
            actual: `${r.stage}: ${r.error ?? r.title}`,
            ids: { txnId: r.txnId, quoteId: r.quoteId },
          };
        },
      );
      const unfreeze = await step(
        {
          ...base(comp.user, "Freeze"),
          action: "Request an unfreeze",
          input: wallet.id,
          expected: "201 pending",
        },
        async () => {
          const r = await comp.call("POST", `/portal/v1/wallets/${wallet.id}/freeze-requests`, {
            action: "unfreeze",
            reason: `UAT round ${context.round}: check cleared`,
          });
          if (r.body?.id)
            remember("freezeRequests", { id: r.body.id, walletId: wallet.id, action: "unfreeze" });
          return {
            pass: r.status === 201,
            actual: `${r.status} ${r.body?.id}`,
            ids: { freezeRequestId: r.body?.id },
            r,
          };
        },
      );
      await step(
        {
          ...base(operator, "Freeze"),
          action: "Approve the unfreeze",
          input: unfreeze.r?.body?.id,
          expected: "Done; wallet active on chain",
        },
        async () => {
          const r = await ops.call(
            "POST",
            `/portal/v1/admin/freeze-requests/${unfreeze.r.body.id}/approve`,
            {},
          );
          const status = await onchain.walletStatus(wallet.address);
          return {
            pass: r.status === 200 && status === 1,
            actual: `${r.status} ${r.body?.status}, chain status ${status}`,
            ids: { freezeRequestId: unfreeze.r.body.id, txHash: r.body?.txHash },
          };
        },
      );
      await step(
        {
          app: APPS[app].name,
          actor: `${target.name} (${target.id})`,
          role: "customer",
          feature: "Freeze",
          action: "Buy again after unfreeze",
          input: "Rs 1,000",
          expected: "Settles",
        },
        async () => {
          const r = await ui.buy(page, app, 1000);
          if (r.txnId)
            remember("transactions", {
              app,
              customer: target.id,
              txnId: r.txnId,
              type: "mint",
              status: txnRecord(r.txnId)?.status,
              txHash: txnRecord(r.txnId)?.txHash,
              feature: "Freeze",
              action: "buy after unfreeze",
            });
          return {
            pass: r.title === "Purchase complete",
            actual: r.title ?? r.error,
            ids: { txnId: r.txnId },
          };
        },
      );
    }
    const other = customersByApp[app].n2;
    const otherWallet = walletFor(APPS[app].slug, other.id);
    const rejectReq = await step(
      {
        ...base(comp.user, "Freeze"),
        action: "Request a freeze (to be rejected)",
        input: otherWallet.id,
        expected: "201",
      },
      async () => {
        const r = await comp.call("POST", `/portal/v1/wallets/${otherWallet.id}/freeze-requests`, {
          action: "freeze",
          reason: `UAT round ${context.round}: false alarm test`,
        });
        if (r.body?.id)
          remember("freezeRequests", {
            id: r.body.id,
            walletId: otherWallet.id,
            action: "freeze (rejected)",
          });
        return {
          pass: r.status === 201,
          actual: `${r.status} ${r.body?.id}`,
          ids: { freezeRequestId: r.body?.id },
          r,
        };
      },
    );
    await step(
      {
        ...base(operator, "Freeze"),
        action: "Reject it",
        input: rejectReq.r?.body?.id,
        expected: "Rejected; wallet stays active",
      },
      async () => {
        const r = await ops.call(
          "POST",
          `/portal/v1/admin/freeze-requests/${rejectReq.r.body.id}/reject`,
          { note: "Not enough evidence" },
        );
        const status = await onchain.walletStatus(otherWallet.address);
        return {
          pass: r.status === 200 && r.body.status === "rejected" && status === 1,
          actual: `${r.status} ${r.body?.status}, chain status ${status}`,
          ids: { freezeRequestId: rejectReq.r.body.id },
        };
      },
    );
    await step(
      {
        ...base(comp.user, "Freeze"),
        action: "Freeze another partner's wallet",
        input: `a ${app === "bank" ? "moher-wallet" : "demo-bank"} wallet`,
        expected: "404",
      },
      async () => {
        const foreign = walletFor(
          app === "bank" ? "moher-wallet" : "demo-bank",
          customersByApp[app === "bank" ? "wallet" : "bank"].n1.id,
        );
        const r = await comp.call("POST", `/portal/v1/wallets/${foreign.id}/freeze-requests`, {
          action: "freeze",
          reason: "should not be allowed at all",
        });
        return { pass: r.status === 404, actual: String(r.status) };
      },
    );
  }

  // Compliance exports and the audit log.
  const comp = sessions["bank.compliance"];
  await step(
    {
      ...base(comp.user, "Export"),
      action: "Download transactions CSV",
      input: "/transactions.csv",
      expected: "CSV includes this round's trades",
    },
    async () => {
      const r = await comp.call("GET", "/portal/v1/transactions.csv");
      const mine = entities.transactions.filter(
        (t) => t.app === "bank" && t.round === context.round && t.status === "confirmed",
      );
      const missing = mine.filter((t) => !String(r.body).includes(t.txnId));
      return {
        pass: r.status === 200 && missing.length === 0,
        actual: `${String(r.body).split("\n").length - 1} rows; this round's confirmed bank trades missing: ${missing.length}`,
      };
    },
  );
  for (const log of ["audit", "security"]) {
    await step(
      {
        ...base(comp.user, "Audit log"),
        action: `Verify the ${log} chain`,
        input: `/audit/verify`,
        expected: "Intact",
      },
      async () => {
        const r = await comp.call("GET", "/portal/v1/audit/verify");
        const v = r.body?.[log] ?? r.body;
        return {
          pass: r.status === 200 && v?.intact === true,
          actual: JSON.stringify(v).slice(0, 120),
        };
      },
    );
  }
  if (FULL || context.round === 1 || context.round === ROUNDS)
    await step(
      {
        ...base(operator, "Audit log"),
        action: "Anchor the audit log on chain",
        input: "POST /admin/audit/anchor",
        expected: "200 with a transaction hash",
      },
      async () => {
        const r = await ops.call("POST", "/portal/v1/admin/audit/anchor", {});
        return {
          pass: r.status === 200 || r.status === 201,
          actual: `${r.status} ${r.body?.txHash?.slice(0, 14) ?? r.body?.error?.message ?? ""}`,
          ids: { txHash: r.body?.txHash },
        };
      },
    );

  // Security: wrong password, disable, enable, reset.
  const victim = users["wallet.viewer"];
  const vs = new PortalSession(victim);
  await step(
    {
      ...base(victim, "Security"),
      action: "Sign in with a wrong password",
      input: victim.email,
      expected: "401 'Email, password or code is wrong'",
    },
    async () => {
      const s = new PortalSession({ ...victim, password: "definitely wrong password" });
      const r = await s.signIn();
      return { pass: r.status === 401, actual: `${r.status} ${r.body?.error?.message}` };
    },
  );
  await step(
    {
      ...base(operator, "Security"),
      action: "Disable a user",
      input: victim.id,
      expected: "200; their sign-in then refused",
    },
    async () => {
      const r = await ops.call("POST", `/portal/v1/admin/users/${victim.id}/disable`, {});
      const after = await vs.signIn();
      return {
        pass: r.status === 200 && after.status === 403,
        actual: `disable ${r.status}; sign-in ${after.status} ${after.body?.error?.message}`,
        ids: { portalUserId: victim.id },
      };
    },
  );
  await step(
    {
      ...base(operator, "Security"),
      action: "Enable the user again",
      input: victim.id,
      expected: "200; sign-in works",
    },
    async () => {
      const r = await ops.call("POST", `/portal/v1/admin/users/${victim.id}/enable`, {});
      const after = await vs.signIn();
      return {
        pass: r.status === 200 && after.status === 200,
        actual: `enable ${r.status}; sign-in ${after.status}`,
        ids: { portalUserId: victim.id },
      };
    },
  );
  await step(
    {
      ...base(operator, "Security"),
      action: "Reset the user",
      input: victim.id,
      expected: "New password works, old one fails",
    },
    async () => {
      const r = await ops.call("POST", `/portal/v1/admin/users/${victim.id}/reset`, {});
      const old = await new PortalSession(victim).signIn();
      const renewed = await new PortalSession({
        ...victim,
        password: r.body.password,
        setupKey: r.body.setupKey,
      }).signIn();
      return {
        pass: r.status === 200 && old.status === 401 && renewed.status === 200,
        actual: `reset ${r.status}; old ${old.status}; new ${renewed.status}`,
        ids: { portalUserId: victim.id },
      };
    },
  );

  return sessions;
}

// ---------------------------------------------------------------- invariants

async function invariants(sessions) {
  const base = { app: "Whole system", actor: "checker", role: "auditor", feature: "Invariants" };
  const wallets = storeDb()
    .prepare("SELECT data FROM wallets")
    .all()
    .map((r) => JSON.parse(r.data));
  const supply = await onchain.totalSupply();
  let sum = 0n;
  let mismatched = 0;
  for (const w of wallets) {
    const onChain = await onchain.balanceOf(w.address);
    sum += onChain;
    const api = await sdk[w.partnerSlug === "demo-bank" ? "bank" : "wallet"].getBalance(w.id);
    if (gramsUnits(api.grams) !== onChain) mismatched += 1;
  }
  await step(
    {
      ...base,
      action: "Token supply = sum of balances",
      input: `${wallets.length} wallets`,
      expected: "Equal",
    },
    async () => ({ pass: sum === supply, actual: `supply ${supply}, sum ${sum}` }),
  );
  await step(
    {
      ...base,
      action: "Every API balance = its on-chain balance",
      input: `${wallets.length} wallets`,
      expected: "0 mismatches",
    },
    async () => ({ pass: mismatched === 0, actual: `${mismatched} mismatches` }),
  );
  await step(
    {
      ...base,
      action: "Reserve covers the supply",
      input: "ReserveRegistry.latest()",
      expected: "Vault grams ≥ supply at publish; minting not paused",
    },
    async () => {
      const latest = await onchain.latestReserve();
      const paused = await onchain.mintingPaused();
      return {
        pass: latest.attestation.totalGrams >= latest.tokenSupplyAtPublish && !paused,
        actual: `vault ${latest.attestation.totalGrams}, supply at publish ${latest.tokenSupplyAtPublish}, nonce ${latest.attestation.nonce}, paused ${paused}`,
      };
    },
  );
  const txns = storeDb()
    .prepare("SELECT data FROM transactions")
    .all()
    .map((r) => JSON.parse(r.data));
  const stuck = txns.filter((t) => t.status === "pending" || t.status === "submitted");
  await step(
    {
      ...base,
      action: "No trade left unfinished",
      input: `${txns.length} transactions`,
      expected: "0 pending or submitted",
    },
    async () => ({ pass: stuck.length === 0, actual: `${stuck.length} unfinished` }),
  );
  let badReceipts = 0;
  for (const t of txns.filter((t) => t.status === "confirmed")) {
    const receipt = await onchain.receipt(t.txHash).catch(() => undefined);
    if (receipt?.status !== "success") badReceipts += 1;
  }
  await step(
    {
      ...base,
      action: "Every confirmed trade has a successful chain receipt",
      input: `${txns.filter((t) => t.status === "confirmed").length} confirmed`,
      expected: "0 missing",
    },
    async () => ({ pass: badReceipts === 0, actual: `${badReceipts} missing or failed` }),
  );
  const failedWithHash = txns.filter((t) => t.status === "failed" && t.txHash);
  await step(
    {
      ...base,
      action: "Cancelled trades moved no gold",
      input: `${txns.filter((t) => t.status === "failed").length} failed`,
      expected: "None sent to the chain",
    },
    async () => ({
      pass: failedWithHash.length === 0,
      actual: `${failedWithHash.length} failed trades with a chain transaction`,
    }),
  );

  // Analytics agree with what was done.
  for (const app of ["bank", "wallet"]) {
    // The wallet's viewer was reset in the security checks (which ends their sessions).
    const s = sessions[`${app}.developer`];
    await step(
      {
        ...base,
        app: "Partner portal",
        action: `${APPS[app].slug}: analytics match the records`,
        input: "/analytics?days=7",
        expected: "Custody = on-chain total; trades = confirmed buys and sales",
      },
      async () => {
        const r = await s.call("GET", "/portal/v1/analytics?days=7");
        const mine = wallets.filter((w) => w.partnerSlug === APPS[app].slug);
        let custody = 0n;
        for (const w of mine) custody += await onchain.balanceOf(w.address);
        // The tile counts the period the API reports (Pakistan calendar days), so the records
        // are counted over the same window: from the start of period.from in PKT (UTC+5).
        const since = Date.parse(`${r.body.period?.from}T00:00:00Z`) - 5 * 3600 * 1000;
        const trades = txns.filter(
          (t) =>
            t.partnerSlug === APPS[app].slug &&
            t.status === "confirmed" &&
            (t.type === "mint" || t.type === "burn") &&
            Date.parse(t.createdAt) >= since,
        ).length;
        const custodyOk = gramsUnits(r.body.tiles.custodyGrams.value) === custody;
        const tradesOk = r.body.tiles.trades.value === trades;
        return {
          pass: r.status === 200 && custodyOk && tradesOk,
          actual: `custody ${r.body.tiles?.custodyGrams?.value} g vs chain ${viem.formatUnits(custody, 8)} g; trades in 7 days ${r.body.tiles?.trades?.value} vs ${trades}`,
        };
      },
    );
  }
  const customers = { bank: customersOf("bank"), wallet: customersOf("wallet") };
  let orphans = 0;
  for (const w of wallets) {
    const app = w.partnerSlug === "demo-bank" ? "bank" : "wallet";
    if (
      !w.externalCustomerId.startsWith("UAT-API") &&
      !customers[app].some((c) => `${w.partnerSlug}-${c.id}` === w.externalCustomerId) &&
      !["hassan", "bushra", "aliya", "kamran"].some((p) => w.externalCustomerId.endsWith(`-${p}`))
    )
      orphans += 1;
  }
  await step(
    {
      ...base,
      action: "Every MOHAR wallet belongs to a partner customer",
      input: `${wallets.length} wallets`,
      expected: "0 orphans (API-test wallets excepted)",
    },
    async () => ({ pass: orphans === 0, actual: `${orphans} orphans` }),
  );
  note("snapshots", {
    wallets: wallets.length,
    transactions: txns.length,
    supply: String(supply),
    confirmed: txns.filter((t) => t.status === "confirmed").length,
    failed: txns.filter((t) => t.status === "failed").length,
  });
}

// ---------------------------------------------------------------- gas (Amoy)

const POL = (wei) => Number(viem.formatEther(wei)).toFixed(4);
/** Logs the relayer's and compliance key's test POL; on Amoy, stops before a round it can't pay for. */
// What the last round cost the relayer. Amoy's gas price moves (30 gwei on 14 Nov, 57 on
// 23 Nov), so the next round needs what the last one cost plus a margin, not a fixed guess.
let lastBalance;
let lastRoundCost = 0n;

async function gasCheck({ final = false } = {}) {
  const relayer = await onchain.balance(deployment.relayer);
  if (lastBalance !== undefined && lastBalance > relayer) lastRoundCost = lastBalance - relayer;
  lastBalance = relayer;
  const compliance = config.complianceAddress
    ? await onchain.balance(config.complianceAddress)
    : undefined;
  note("gas", {
    relayer: POL(relayer),
    compliance: compliance !== undefined ? POL(compliance) : null,
    lastRoundCost: POL(lastRoundCost),
  });
  if (final) return true; // the end-of-run reading is for the record, not a check
  // Before the first round there is no last-round cost to go by, so the floor is what a round
  // was measured to cost on Amoy (light: 0.22 POL at 57 gwei, 23 Nov 2026) plus a margin.
  // A lower floor would let a run start a round it cannot finish.
  const floor = viem.parseEther(FULL ? "0.5" : "0.28");
  const margin = (lastRoundCost * 5n) / 4n;
  const need = margin > floor ? margin : floor;
  await step(
    {
      app: "Whole system",
      actor: "checker",
      role: "auditor",
      feature: "Gas",
      action: "Relayer has POL for a round",
      input: deployment.relayer,
      expected: `≥ ${viem.formatEther(need)} POL`,
    },
    async () => ({
      pass: !AMOY || relayer >= need,
      actual: `relayer ${POL(relayer)} POL${compliance !== undefined ? `, compliance ${POL(compliance)} POL` : ""}`,
    }),
  );
  return !AMOY || relayer >= need;
}

// ---------------------------------------------------------------- main

const health = await (await fetch(`${API}/v1/health`)).json().catch(() => ({}));
if (health.chainId !== config.chainId) {
  console.error(
    `The MOHAR API at ${API} is on chain ${health.chainId}, not ${config.chainId}. Start it for ${config.target} first.`,
  );
  process.exit(1);
}
operator = bootstrapOperator();
remember("portalUsers", { email: operator.email, role: "operator", id: "created by the CLI" });
const page = await ui.newPage(browser);
const portalPage = await ui.newPage(browser, { mobile: false });
const personas = { bank: APPS.bank.persona, wallet: APPS.wallet.persona };

let finished = 0;
for (let r = 1; r <= ROUNDS; r++) {
  context.round = r;
  console.log(`\n========== round ${r} of ${ROUNDS} ==========`);
  if (!(await gasCheck())) {
    console.log(
      "!! Not enough test POL for another round: stopping. Top up the relayer and run again.",
    );
    break;
  }
  const customersByApp = {};
  for (const app of ["bank", "wallet"]) {
    const { normal, medium } = await onboarding(page, app);
    if (!normal || !medium) {
      console.log(`!! ${app}: onboarding failed, skipping trading this round`);
      continue;
    }
    customersByApp[app] = { n1: normal, n2: medium };
    await trading(page, app, normal, medium, personas[app]);
  }
  await apiChecks();
  if (customersByApp.bank && customersByApp.wallet) {
    const sessions = await portal(portalPage, customersByApp);
    await invariants(sessions);
  }
  writeFileSync(`${UAT}/entities.json`, JSON.stringify(entities, null, 2));
  finished = r;
}

// Tidy up: the portal accounts this run made are disabled, so nobody can sign in with them later.
context.round = finished;
if (ops) {
  for (const u of entities.portalUsers.filter((u) => u.id?.startsWith("usr_"))) {
    await ops.call("POST", `/portal/v1/admin/users/${u.id}/disable`, {});
  }
}
try {
  execFileSync(
    "pnpm",
    ["--filter", "@mohar/api", "portal:user", "disable", "--email", operator.email],
    {
      cwd: REPO,
      env: { ...process.env, ...config.cliEnv },
      stdio: "ignore",
    },
  );
} catch {
  console.log(
    `!! Could not disable the run's operator ${operator.email}; disable it with portal:user.`,
  );
}
await gasCheck({ final: true });
await browser.close();
await exportRun(entities, { finished });
console.log(`\nDone: ${finished} round(s). Everything is in ${UAT}`);
process.exit(0);
