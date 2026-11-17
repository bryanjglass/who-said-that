/**
 * End-to-end: one host controller, one TV display (opened from the host),
 * four phones (2× iOS Safari, 2× Android Chrome emulation) playing five full
 * rounds against the real Worker + Durable Object (wrangler dev), including
 * automatic timer transitions, partial guesses, a missed submission, exact
 * score assertions, final results and a rematch.
 */
import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test";

const NAMES = ["Abby", "Owen", "Mom", "Dad"] as const;
type Name = (typeof NAMES)[number];
const ROUNDS = 5;
const TIMER = 15; // seconds, for both answering and guessing

const answerText = (name: Name, round: number) => `${name}'s answer for round ${round} 🎈`;

/**
 * Deterministic guess plan: who does `guesser` say wrote `author`'s answer?
 * Returns null for "no guess". Only names players who actually answered.
 */
function plannedGuess(round: number, guesser: Name, author: Name, authors: Name[]): Name | null {
  if (guesser === author) return null;
  switch (guesser) {
    case "Abby":
      return author; // always right
    case "Owen":
      return author !== "Abby" ? "Abby" : "Mom";
    case "Mom":
      if (round === 3 && author !== "Abby") return null; // partial guesses, never locks
      return authors.includes("Dad") ? "Dad" : "Owen";
    case "Dad":
      return round % 2 === 0 ? author : "Owen";
  }
}

/** Independent re-implementation of the scoring rules, used to predict totals. */
function expectedRoundPoints(round: number, authors: Name[]): Record<Name, number> {
  const pts = { Abby: 0, Owen: 0, Mom: 0, Dad: 0 } as Record<Name, number>;
  for (const author of authors) {
    for (const guesser of NAMES) {
      const g = plannedGuess(round, guesser, author, authors);
      if (!g) continue;
      if (g === author) pts[guesser] += 500;
      else pts[author] += 250;
    }
  }
  return pts;
}

async function readStandings(page: Page, testId: string): Promise<Record<string, number>> {
  const rows = page.getByTestId(testId);
  const out: Record<string, number> = {};
  for (const row of await rows.all()) out[(await row.getAttribute("data-name"))!] = Number(await row.getAttribute("data-score"));
  return out;
}

test("four players play a full five-round game, then a rematch", async ({ browser }) => {
  // ---- Host + TV -----------------------------------------------------------
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const host = await hostCtx.newPage();
  await host.goto("/");
  await host.getByTestId("create-room").click();
  const code = (await host.getByTestId("room-code").textContent())!.trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  const [tv] = await Promise.all([hostCtx.waitForEvent("page"), host.getByTestId("open-tv").click()]);
  await tv.setViewportSize({ width: 1920, height: 1080 });
  await tv.emulateMedia({ reducedMotion: "reduce" });
  await expect(tv.getByTestId("tv-room-code")).toHaveText(code);
  await expect(host.getByTestId("tv-status")).toContainText("TV connected");

  // ---- Players join ----------------------------------------------------------
  const phoneDevices = [devices["iPhone 13"], devices["Pixel 7"], devices["iPhone 13"], devices["Pixel 7"]];
  const phones = {} as Record<Name, Page>;
  const contexts: BrowserContext[] = [];
  for (const [i, name] of NAMES.entries()) {
    const { defaultBrowserType: _ignored, ...device } = phoneDevices[i]!;
    const ctx = await browser.newContext({ ...device, reducedMotion: "reduce" });
    contexts.push(ctx);
    const page = await ctx.newPage();
    if (i === 0) {
      // First player types the room code on the home screen; others use the QR link.
      await page.goto("/");
      await page.getByTestId("join-code").fill(code.toLowerCase());
      await page.getByTestId("join-go").click();
    } else {
      await page.goto(`/#/play/${code}`);
    }
    await page.getByTestId("name-input").fill(name);
    await page.getByTestId(`avatar-${i * 2}`).click();
    await page.getByTestId("join-submit").click();
    await expect(page.getByTestId("lobby-wait")).toBeVisible();
    phones[name] = page;
  }
  await expect(tv.getByTestId("tv-lobby-players")).toContainText("Dad");
  await expect(host.getByTestId("player-count")).toHaveText("4 / 10");

  // Duplicate names (case-insensitive) are rejected.
  const dupCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const dup = await dupCtx.newPage();
  await dup.goto(`/#/play/${code}`);
  await dup.getByTestId("name-input").fill("aBBy");
  await dup.getByTestId("join-submit").click();
  await expect(dup.getByTestId("join-error")).toContainText("already taken");
  await dupCtx.close();

  // ---- Configure + start ----------------------------------------------------------
  await host.getByTestId("rounds-5").click();
  await host.getByTestId("submission-timer").selectOption(String(TIMER));
  await host.getByTestId("guessing-timer").selectOption(String(TIMER));
  await expect(host.getByTestId("submission-timer")).toHaveValue(String(TIMER));
  await host.getByTestId("host-primary").click(); // Start Game

  const totals = { Abby: 0, Owen: 0, Mom: 0, Dad: 0 } as Record<Name, number>;

  for (let round = 1; round <= ROUNDS; round++) {
    // ---- Prompt ----
    await expect(tv.getByTestId("tv-round")).toContainText(`Round ${round}`);
    if (round === 1) {
      // Automatic timer transition: prompt → submission after the countdown.
      await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "submission", { timeout: 15_000 });
    } else {
      await expect(host.getByTestId("host-app")).toHaveAttribute("data-phase", "prompt");
      await expect(host.getByTestId("host-app")).toHaveAttribute("data-round", String(round));
      await host.getByTestId("host-primary").click(); // Start answering now
    }

    // ---- Submission ----
    const authors: Name[] = round === 2 ? ["Abby", "Owen", "Mom"] : [...NAMES]; // Dad misses round 2
    for (const name of authors) {
      const p = phones[name];
      await p.getByTestId("answer-input").fill(name === "Abby" && round === 1 ? "first draft" : answerText(name, round));
      await p.getByTestId("answer-submit").click();
      const last = name === authors[authors.length - 1] && round !== 2;
      // The final answer moves everyone straight to guessing.
      if (!last) await expect(p.getByTestId("answer-status")).toContainText("Answer submitted");
      if (name === "Abby" && round === 1) {
        // Editing before the deadline replaces the answer.
        await p.getByTestId("answer-input").fill(answerText(name, round));
        await p.getByTestId("answer-submit").click();
        await expect(p.getByTestId("answer-status")).toContainText("Answer submitted");
      }
      if (name !== authors[authors.length - 1]) {
        // Secret until submission closes: the TV and host never see answer text.
        await expect(tv.getByTestId("tv-app")).not.toContainText(answerText(name, round));
        await expect(host.getByTestId("host-app")).not.toContainText(answerText(name, round));
      }
    }
    if (round === 2) {
      await expect(tv.getByTestId("tv-submitted-count")).toContainText("3");
      // Dad never answers → the server timer closes submission automatically.
      await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "guessing", { timeout: (TIMER + 10) * 1000 });
    }

    // ---- Guessing ----
    for (const name of NAMES) await expect(phones[name].getByTestId("guess-board")).toBeVisible();
    await expect(tv.getByTestId("tv-answer-card")).toHaveCount(authors.length);
    if (round === 2) await expect(phones.Dad.getByText("You didn't answer this round")).toBeVisible();

    for (const guesser of NAMES) {
      const p = phones[guesser];
      for (const author of authors) {
        const card = p.getByTestId("guess-card").filter({ hasText: answerText(author, round) });
        if (author === guesser) {
          await expect(card.getByTestId("your-answer")).toBeVisible();
          continue;
        }
        const target = plannedGuess(round, guesser, author, authors);
        if (!target) continue;
        await card.locator(`[data-testid=guess-option][data-player-name="${target}"]`).click();
        await expect(card.getByTestId("guess-sync")).toHaveText("✓ Saved");
      }
      if (round === 3 && guesser === "Mom") continue; // never locks → timer expiry
      const lockable = authors.filter((a) => a !== guesser).every((a) => plannedGuess(round, guesser, a, authors));
      await p.getByTestId("lock-in").click();
      if (!lockable) await p.getByTestId("lock-in").click(); // confirm partial lock
      // The last player to lock in moves everyone straight to the reveal.
      if (guesser !== "Dad" || round === 3) await expect(p.getByTestId("locked-in")).toBeVisible();
    }
    if (round === 3) {
      await expect(tv.getByTestId("tv-locked-count")).toContainText("3");
    }
    await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "reveal", { timeout: (TIMER + 10) * 1000 });

    // ---- Reveal ----
    for (let i = 0; i < authors.length; i++) {
      const reveal = tv.getByTestId("tv-reveal");
      await expect(reveal).toHaveAttribute("data-stage", "suspects");
      await expect(reveal).toHaveAttribute("data-index", String(i));
      await expect(tv.getByTestId("tv-reveal-author")).toHaveCount(0); // author hidden
      const text = (await tv.getByTestId("tv-reveal-text").textContent())!;
      const author = NAMES.find((n) => text === answerText(n, round))!;
      expect(author).toBeTruthy();
      await expect(host.getByTestId("host-app")).toHaveAttribute("data-reveal", `${i}:suspects`);
      await host.getByTestId("host-primary").click(); // Reveal author
      await expect(reveal).toHaveAttribute("data-stage", "author");
      await expect(tv.getByTestId("tv-reveal-author")).toContainText(`It was ${author}!`);
      await expect(phones[author].getByTestId("reveal-outcome")).toContainText("That's yours!");
      await expect(host.getByTestId("host-app")).toHaveAttribute("data-reveal", `${i}:author`);
      await host.getByTestId("host-primary").click(); // Next answer / Show scores
    }

    // ---- Scoreboard ----
    await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "scoreboard");
    const pts = expectedRoundPoints(round, authors);
    for (const n of NAMES) totals[n] += pts[n];
    await expect.poll(() => readStandings(host, "standing-row")).toEqual(totals);
    await expect.poll(() => readStandings(tv, "tv-standing-row")).toEqual(totals);
    for (const n of NAMES) {
      await expect(phones[n].getByTestId("score-total")).toHaveText(`${totals[n].toLocaleString("en-US")} pts`);
    }
    await expect(host.getByTestId("host-app")).toHaveAttribute("data-phase", "scoreboard");
    await host.getByTestId("host-primary").click(); // Next round / Final results
  }

  // ---- Final results ----
  // Hand-checked totals for this plan (see plannedGuess):
  expect(totals).toEqual({ Abby: 10250, Owen: 750, Mom: 4000, Dad: 5500 });
  await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "gameOver");
  await expect(tv.getByTestId("tv-winners")).toContainText("Abby");
  await expect.poll(() => readStandings(tv, "tv-standing-row")).toEqual(totals);
  // Polls until the outgoing scoreboard screen has finished animating away.
  await expect
    .poll(() =>
      tv.getByTestId("tv-standing-row").evaluateAll((rows) =>
        rows.map((r) => `${r.getAttribute("data-rank")}:${r.getAttribute("data-name")}`),
      ),
    )
    .toEqual(["1:Abby", "2:Dad", "3:Mom", "4:Owen"]);
  await expect(phones.Abby.getByTestId("final-phone")).toContainText("You won!");
  await expect(phones.Owen.getByTestId("final-score")).toHaveText("750 pts");

  // ---- Rematch: same roster, fresh scores ----
  await expect(host.getByTestId("host-app")).toHaveAttribute("data-phase", "gameOver");
  await host.getByTestId("host-primary").click(); // Rematch
  await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", "prompt");
  await expect(tv.getByTestId("tv-round")).toContainText("Round 1");
  for (const n of NAMES) {
    await expect(phones[n].getByTestId("me-name")).toHaveText(n);
    await expect(phones[n].getByTestId("me-score")).toHaveText("0");
  }

  // ---- Refresh recovery (phone + TV + host) mid-game ----
  await phones.Owen.reload();
  await expect(phones.Owen.getByTestId("me-name")).toHaveText("Owen");
  await tv.reload();
  await expect(tv.getByTestId("tv-app")).toHaveAttribute("data-phase", /prompt|submission/);
  await host.reload();
  await expect(host.getByTestId("host-app")).toHaveAttribute("data-phase", /prompt|submission/);

  for (const c of contexts) await c.close();
  await hostCtx.close();
});
