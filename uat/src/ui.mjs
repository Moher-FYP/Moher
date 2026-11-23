// Drives MOHAR Bank / MOHAR Wallet and the partner portal in a real browser, as a person would.
import { config } from "./config.mjs";
import { APPS, PORTAL_ORIGIN, signInBudget, totp } from "./lib.mjs";

const SETTLING = new Set(["Buying gold", "Selling gold", "Sending gold"]);

export async function newPage(browser, { mobile = true } = {}) {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 } } : { viewport: { width: 1360, height: 900 } },
  );
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text().slice(0, 200)));
  page.setDefaultTimeout(config.target === "amoy" ? 90000 : 30000);
  return page;
}

const h1 = async (page) =>
  (await page.locator("h1").first().textContent({ timeout: 15000 }))?.trim();

/** The error banner a server action redirected back with, if any. */
async function formError(page) {
  const alert = page.locator('[role="alert"]').first();
  return (await alert.count()) ? (await alert.textContent())?.trim() : undefined;
}

// ---------------------------------------------------------------- partner app

export async function signIn(page, app, customerId) {
  await page.goto(`${APPS[app].base}/login`);
  await page.click(`button[name="customer"][value="${customerId}"]`);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 120000 });
  return new URL(page.url()).pathname;
}

export async function signOut(page, app) {
  await page.goto(`${APPS[app].base}/`);
  const button = page.locator('button[aria-label$="sign out"]');
  if (await button.count()) {
    await button.click();
    await page.waitForURL(/\/login/);
  }
}

/** Fills both steps of Open an account. Returns where it ended and what it said. */
export async function openAccount(page, app, person) {
  await page.context().clearCookies();
  await page.goto(`${APPS[app].base}/signup`);
  await page.waitForTimeout(800);
  await page.fill("#fullName", person.name);
  await page.fill("#cnic", person.cnic);
  if (person.expiry) await page.fill("#cnicExpiry", person.expiry);
  else await page.check('input[name="cnicLifetime"]');
  await page.fill("#dateOfBirth", person.dob);
  await page.fill("#phone", person.phone);
  await page.setInputFiles("#cnicFront", {
    name: "cnic.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
      "hex",
    ),
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForTimeout(300);
  if (!(await page.getByText("Step 2 of 2").isVisible())) {
    return { where: "step1", message: "browser validation kept step 1 open" };
  }
  await page.selectOption("#occupation", person.occupation);
  await page.selectOption("#sourceOfFunds", person.source);
  await page.selectOption("#monthlyAmount", person.monthly);
  if (person.pep) await page.check('input[name="politicallyExposed"]');
  await page.check('input[name="consent"]');
  await page.getByRole("button", { name: "Verify and open" }).click();
  await page.waitForURL(/\/welcome|\/signup\?error/, { timeout: 120000 });
  const url = new URL(page.url());
  if (url.pathname === "/welcome") {
    return { where: "welcome", title: await page.locator("h2").first().textContent() };
  }
  return { where: "error", message: url.searchParams.get("error") ?? (await formError(page)) };
}

/** Types an amount on the app's own pad (keyboard), after the page is ready. */
async function typeAmount(page, amount) {
  await page.waitForTimeout(900);
  for (let i = 0; i < 12; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type(String(amount));
}

async function readQuote(page) {
  const quoteId = new URL(page.url()).pathname.split("/").pop();
  const grams = (
    await page.locator("section").first().locator("p").nth(1).getAttribute("title")
  )?.replace(" g", "");
  const totalRow = page.locator("dl > div").last();
  const total = (await totalRow.locator("dd").textContent())?.trim();
  return { quoteId, grams, total };
}

/** Waits until the transaction screen settles; returns its final heading. */
async function settle(page, maxMs = config.target === "amoy" ? 120000 : 45000) {
  const end = Date.now() + maxMs;
  let title = await h1(page);
  while (SETTLING.has(title) && Date.now() < end) {
    await page.waitForTimeout(600);
    title = await h1(page);
  }
  return title;
}

/**
 * Buy: amount on the pad → Review price → (Raast?) → Pay → settles.
 * Stops early and reports when the buy screen refuses the amount.
 */
export async function buy(page, app, amount, { raast, beforePay } = {}) {
  await page.goto(`${APPS[app].base}/buy`);
  await typeAmount(page, amount);
  await page.getByRole("button", { name: "Review price" }).click();
  await page.waitForURL(/\/quote\/|\/buy\?error/, { timeout: 120000 });
  if (page.url().includes("/buy?error")) {
    return { stage: "buy", error: new URL(page.url()).searchParams.get("error") };
  }
  const quote = await readQuote(page);
  if (raast) {
    await page.check('input[name="payWith"][value="raast"]');
    await page.fill('input[name="raastId"]', raast);
  }
  if (beforePay) await beforePay(page, quote);
  const pay = page.getByRole("button", { name: /^Pay / });
  if (!(await pay.count()))
    return {
      stage: "quote",
      ...quote,
      expired: true,
      button: await page.locator("form a").first().textContent(),
    };
  await pay.click();
  await page.waitForURL(/\/tx\/|\/quote\/.*\?error/, { timeout: 120000 });
  if (page.url().includes("?error")) {
    return { stage: "quote", ...quote, error: new URL(page.url()).searchParams.get("error") };
  }
  const txnId = new URL(page.url()).pathname.split("/").pop();
  const title = await settle(page);
  return {
    stage: "tx",
    ...quote,
    txnId,
    title,
    body: (await page.locator("main").textContent()).slice(0, 400),
  };
}

/** Sell: "grams" or "pkr" on the pad, or everything. */
export async function sell(page, app, { grams, pkr, all }) {
  await page.goto(`${APPS[app].base}/sell`);
  await page.waitForTimeout(900);
  if (all) {
    await page.getByRole("button", { name: "Sell all" }).click();
  } else {
    if (pkr) await page.getByRole("button", { name: "Rupees" }).click();
    await typeAmount(page, grams ?? pkr);
    await page.getByRole("button", { name: "Review price" }).click();
  }
  await page.waitForURL(/\/quote\/|\/sell\?error/, { timeout: 120000 });
  if (page.url().includes("/sell?error")) {
    return { stage: "sell", error: new URL(page.url()).searchParams.get("error") };
  }
  const quote = await readQuote(page);
  await page.getByRole("button", { name: /^Sell for/ }).click();
  await page.waitForURL(/\/tx\/|\?error/, { timeout: 120000 });
  if (page.url().includes("?error"))
    return { stage: "quote", ...quote, error: new URL(page.url()).searchParams.get("error") };
  const txnId = new URL(page.url()).pathname.split("/").pop();
  return { stage: "tx", ...quote, txnId, title: await settle(page) };
}

export async function send(page, app, recipientId, grams) {
  await page.goto(`${APPS[app].base}/send`);
  await page.waitForTimeout(600);
  const radio = page.locator(`input[name="recipient"][value="${recipientId}"]`);
  if (!(await radio.count())) return { stage: "send", error: "recipient not listed" };
  await radio.check({ force: true });
  await page.fill("#grams", String(grams));
  await page.getByRole("button", { name: "Send gold" }).click();
  await page.waitForURL(/\/tx\/|\/send\?error/, { timeout: 120000 });
  if (page.url().includes("?error"))
    return { stage: "send", error: new URL(page.url()).searchParams.get("error") };
  const txnId = new URL(page.url()).pathname.split("/").pop();
  return { stage: "tx", txnId, title: await settle(page) };
}

export async function home(page, app) {
  await page.goto(`${APPS[app].base}/`);
  const card = page.locator('section[aria-label="Gold savings"]');
  if (!(await card.count())) return { ok: false, title: await h1(page).catch(() => "") };
  return {
    ok: true,
    grams: (await card.locator("p").nth(1).getAttribute("title"))?.replace(" g", ""),
    activity: await page.locator('a[href^="/tx/"]').count(),
  };
}

export async function receipt(page, app, txnId) {
  await page.goto(`${APPS[app].base}/tx/${txnId}/receipt`);
  const title = (await page.locator("#receipt-title").textContent({ timeout: 15000 }))?.trim();
  return { title, text: (await page.locator("article").textContent()).replace(/\s+/g, " ") };
}

export async function vault(page, app) {
  await page.goto(`${APPS[app].base}/verify`);
  return { title: (await page.locator("main h2").first().textContent())?.trim() };
}

// ---------------------------------------------------------------- portal

export async function portalSignIn(page, user) {
  await signInBudget();
  await page.context().clearCookies();
  await page.goto(`${PORTAL_ORIGIN}/login`);
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await page.fill('input[name="code"]', await totp(user.setupKey, user.email));
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
    // The session cookie the page got, so API checks can reuse it instead of signing in again.
    const cookie = (await page.context().cookies()).find((c) => c.name === "mohar_portal");
    return {
      ok: true,
      path: new URL(page.url()).pathname,
      cookie: cookie ? `${cookie.name}=${cookie.value}` : undefined,
    };
  } catch {
    return {
      ok: false,
      message: (
        await page
          .locator('[role="alert"]')
          .first()
          .textContent()
          .catch(() => "")
      )?.trim(),
    };
  }
}

/** Opens a portal page and reports its heading, or the error it shows. */
export async function portalPage(page, path) {
  await page.goto(`${PORTAL_ORIGIN}${path}`);
  await page.waitForTimeout(2200);
  const heading = (
    await page
      .locator("main h1")
      .first()
      .textContent({ timeout: 10000 })
      .catch(() => "")
  )?.trim();
  const alert = (
    await page
      .locator('main [role="alert"]')
      .first()
      .textContent({ timeout: 500 })
      .catch(() => "")
  )?.trim();
  return { heading, alert, path: new URL(page.url()).pathname };
}
