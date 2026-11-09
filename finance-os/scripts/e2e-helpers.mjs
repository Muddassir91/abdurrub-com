// Shared helpers for the browser tests.

/**
 * Walk through the setup questionnaire. Answers are deterministic so the
 * suggested split is known: with income and no costs or home budget the split
 * is 10/20/15/22/22/11 (running costs / pay / tax / profit / cushion / growth).
 */
export async function runOnboarding(page, o = {}) {
  const opts = { name: "Muddassir", business: "Retention Rules", currency: "USD", home: "USD", fx: "280", country: "Pakistan", income: "4000", ...o };
  await page.locator("[data-onboarding]").waitFor({ timeout: 30000 });
  const seen = [];
  for (let k = 0; k < 60; k++) {
    const stepEl = page.locator("[data-step]");
    if ((await stepEl.count()) === 0) break;
    const id = await stepEl.first().getAttribute("data-step");
    seen.push(id);
    const cont = page.getByRole("button", { name: "Continue" });
    const skip = page.getByRole("button", { name: "Skip for now" });
    switch (id) {
      case "name":
        await page.getByPlaceholder("Your name").fill(opts.name);
        await cont.click();
        break;
      case "persona":
        await page.getByRole("radio", { name: /Agency owner/ }).click();
        break;
      case "business":
        await page.getByPlaceholder(/Ayesha Design/).fill(opts.business);
        await cont.click();
        break;
      case "currency":
        await page.getByRole("radio", { name: new RegExp(`\\b${opts.currency}\\b`) }).click();
        break;
      case "homeCurrency":
        await page.getByRole("radio", { name: new RegExp(`\\b${opts.home}\\b`) }).click();
        break;
      case "fx":
        await page.getByPlaceholder("e.g. 280").fill(opts.fx);
        await cont.click();
        break;
      case "country":
        await page.getByPlaceholder(/Pakistan/).fill(opts.country);
        await cont.click();
        break;
      case "income":
        await page.getByLabel("Amount").fill(opts.income);
        await cont.click();
        break;
      case "steadiness":
        await page.getByRole("radio", { name: /moves around/ }).click();
        break;
      case "payments":
        await page.getByRole("button", { name: "Whop" }).click();
        await cont.click();
        break;
      case "clients":
        await page.getByRole("radio", { name: /Just one/ }).click();
        break;
      case "cadence":
        await page.getByRole("radio", { name: /Once a month/ }).click();
        break;
      case "goals":
        await page.getByRole("button", { name: /Pay myself consistently/ }).click();
        await cont.click();
        break;
      case "tax":
        await page.getByRole("radio", { name: /About 15%/ }).click();
        break;
      case "reserve":
        await page.getByRole("radio", { name: /^3 months/ }).click();
        break;
      case "split":
        await page.getByRole("button", { name: /Build my dashboard/ }).click();
        break;
      default:
        // Optional money / list questions.
        await skip.click();
    }
    await page.waitForTimeout(420);
  }
  await page.locator("[data-onboarding]").waitFor({ state: "detached", timeout: 30000 });
  await page.locator("aside").first().waitFor({ state: "attached", timeout: 30000 });
  return seen;
}

/** Add a transaction through the quick-add sheet. */
export async function quickAdd(page, { tab = "out", side, amount, what, currency, category, household }) {
  await page.getByRole("button", { name: "Add money in or out" }).first().click();
  const sheet = page.locator("[data-quickadd]");
  await sheet.waitFor();
  await sheet.getByRole("tab", { name: tab === "in" ? "Money in" : "Money out" }).click();
  if (side) await sheet.getByRole("button", { name: side, exact: true }).click();
  if (currency) await sheet.getByRole("button", { name: currency, exact: true }).click();
  await sheet.getByLabel("Amount").fill(String(amount));
  if (what) await sheet.getByPlaceholder(/What was it/).fill(what);
  if (category) await sheet.getByRole("button", { name: category, exact: true }).click();
  if (household !== undefined) {
    const box = sheet.getByRole("checkbox").first();
    if ((await box.isChecked()) !== household) await box.click();
  }
  await page.getByTestId("quickadd-save").click();
  await page.getByText(/added$/).last().waitFor();
}
