# Three-minute demo

This version is designed to be followed literally while recording. Every section says
which numbered tab to open, what must be visible, where to move the cursor, and where to
leave the screen.

## What the product is

Limen has two users:

1. An application installs `@limenlabs/sdk`, chooses a capital threshold, and decides
   what should unlock when that threshold is met.
2. A person receives that challenge and clears it using shielded STRK20 capital. Limen
   calls the application's action and returns the capital to a shielded note in the same
   transaction.

The application receives the answer it needs. It does not receive the person's total
balance, notes, address, or unrelated activity.

## Set up the exact screens

Use one browser window at 1920×1080 and 100% zoom. Hide the bookmarks bar and close all
notifications. Open these **seven tabs in this exact order**:

1. **Home, opening:** <https://limen.timjosh507.workers.dev>
2. **Home, mechanism:** <https://limen.timjosh507.workers.dev>
3. **Home, privacy:** <https://limen.timjosh507.workers.dev>
4. **Cleared challenge:** <https://limen.timjosh507.workers.dev/challenge/0x78e0b30dc72343243712064487c9aeffc76441532f7b2f1cb4de09bedca9ecf>
5. **Evidence:** <https://limen.timjosh507.workers.dev/evidence>
6. **SDK:** <https://github.com/winsznx/limen/tree/main/packages/limen-sdk#readme>
7. **Home, closing:** <https://limen.timjosh507.workers.dev>

Now prepare each tab before recording:

- **Tab 1:** press `Home`. The hero, the 50 STRK product panel, the three statistics, and
  the **Live now** row must all be visible.
- **Tab 2:** scroll until **The mechanism** and **One atomic transaction, four things
  happen** sit directly below the sticky navigation. The animated **Challenge → Prove →
  Pool → Execute → Return** diagram must be completely visible. The four detail cards
  may begin below it; they are not the focus of this shot.
- **Tab 3:** scroll until **Privacy boundary** and **Stated precisely, because vague
  claims are worse than none** sit near the upper-left corner. Both **Becomes public**
  and **Stays private** cards must be visible together.
- **Tab 4:** press `Home`. The green **Cleared** badge above **Prove ≥ 4 STRK**, the
  **What happened** timeline on the left, and the cleared product panel on the right
  must all be visible.
- **Tab 5:** scroll until **Contracts and transactions** sits directly below the sticky
  navigation. All three contract addresses, all three transaction rows, **100
  deterministic cases**, and both rows of result counters must be visible together.
- **Tab 6:** scroll until the README heading **@limenlabs/sdk**, its one-sentence promise,
  and `npm install @limenlabs/sdk` are visible together. Leave **What it does** visible
  directly below if it fits.
- **Tab 7:** press `Home`. Match Tab 1's opening frame.

Test `⌘+1` through `⌘+7` once. These shortcuts are the only navigation used during the
recording. Put the cursor in empty space before you begin.

Do not use npm or Voyager as required screens. Both can show a Cloudflare security page
during recording. The SDK is genuinely published as `@limenlabs/sdk` version `0.1.2`,
and the evidence page already exposes every Mainnet transaction link.

---

## 0:00–0:17 · The problem

**Say**

> Imagine an app asks you to prove you have enough capital. Today, that usually means
> connecting a wallet and revealing far more than the app needs. Limen changes that.

**Exact screen actions**

1. Press `⌘+1`.
2. Confirm the large **Prove enough. Keep the rest private.** headline is on the left
   and the 50 STRK capital-challenge panel is on the right.
3. Keep the cursor still in empty space below the headline.
4. End on this same frame.

---

## 0:17–0:35 · One answer, not a balance

**Say**

> The app asks for one threshold. Limen returns one answer. Here, the requirement is 50
> STRK. The user's actual shielded balance stays exactly where it should: not disclosed.

**Exact screen actions**

1. Stay on **Tab 1**. Do not scroll.
2. Move to **Requirement, ≥ 50 STRK** in the upper-left cell of the right-hand panel.
3. Move horizontally to **Your shielded balance, Not disclosed** in the upper-right
   cell.
4. Pause there after saying “not disclosed.”

---

## 0:35–0:55 · What happens

**Say**

> The challenge is published first. Then, in one transaction, exactly the threshold
> moves from private notes, the application's action runs, and the capital returns to a
> shielded note. If the amount is not there, nothing unlocks.

**Exact screen actions**

1. Press `⌘+2`. Do not scroll after switching.
2. Confirm **One atomic transaction, four things happen** is above the animated diagram.
3. Begin on **Challenge** as you start speaking, then follow the animation across
   **Prove**, **Pool**, **Execute**, and **Return**.
4. End on the diagram's **Return, Capital back to a shielded note** node. Do not move
   down into the four detail cards.

---

## 0:55–1:10 · What stays private

**Say**

> The application sees the requirement and the result. It does not receive your total
> balance, your notes, your address, or your unrelated activity.

**Exact screen actions**

1. Press `⌘+3`. Do not scroll after switching.
2. Confirm the orange **Becomes public** card is on the left and the green **Stays
   private** card is on the right.
3. Point briefly to **Becomes public**, then move to **Stays private** as you say what the
   application does not receive.
4. End on the **Stays private** heading. Do not read every bullet.

---

## 1:10–1:35 · The product working on Mainnet

**Say**

> This is not a mockup. This challenge ran on Starknet Mainnet. It required 4 STRK, it
> cleared, and Limen unlocked the allocation action for the Capital Gate.

**Exact screen actions**

1. Press `⌘+4`. Do not scroll after switching.
2. Point to **Prove ≥ 4 STRK** while saying “It required 4 STRK.”
3. Move to the green **Cleared** badge beside the small **Capital challenge** label as
   you say “it cleared,” then pause there.
4. Follow the completed **What happened** timeline down the left: **Challenge**,
   **Prove**, **Pool**, **Execute**, **Return**.
5. Move right to **Target action, REGISTER_ALLOCATION** in the product panel as you say
   “allocation action,” and end there.

---

## 1:35–1:55 · The privacy result

**Say**

> Notice what is missing: no wallet address, no balance, and no list of holdings. Just a
> scoped subject and proof that the requirement was met. That is the product.

**Exact screen actions**

1. Stay on **Tab 4**. Do not scroll.
2. Move to **Your shielded balance, Not disclosed** in the upper-right product panel.
3. Move along the completed row **Proving**, **Accepted**, **Cleared**.
4. End on **Capital returns to a shielded note in the same transaction** at the bottom
   of that panel.
5. Hold for one second after saying “That is the product.”

---

## 1:55–2:18 · Evidence, not promises

**Say**

> Here are the deployed contracts and three Mainnet clearances. Every transaction links
> to Voyager, so nobody has to trust our dashboard or our word.

**Exact screen actions**

1. Press `⌘+5`. Do not scroll after switching.
2. Confirm **Contracts and transactions** is directly below the navigation and three
   transaction rows are directly below the contract addresses.
3. Move across **STRK20 pool**, **Limen Anonymizer**, and **Capital Gate**.
4. Move down the three transaction rows and stop on the third row's **View →** link.
5. Do **not** click it. Clicking can open a Cloudflare verification screen and change
   the tab order.

---

## 2:18–2:34 · Tested against failure

**Say**

> We tried to break it a hundred different ways: too little capital, wrong tokens,
> expired challenges, and replays. Zero false clearances. Zero successful replays. Zero
> stranded funds.

**Exact screen actions**

1. Stay on **Tab 5**. The **100 deterministic cases** grid is already visible below the
   transactions. Do not scroll.
2. Move to **Total cases, 100**.
3. Point in order to **False clearances, 0**, **Successful replays, 0**, and **Funds
   stranded, 0** as you say each result.
4. End on the green **All cases as specified** badge.

---

## 2:34–2:49 · How applications use Limen

**Say**

> Now any Starknet application can build on it. Install the SDK, set the threshold, and
> decide what a successful clearance unlocks. Limen handles the challenge and lets the
> app verify the result from chain.

**Exact screen actions**

1. Press `⌘+6`. Do not scroll after switching.
2. Confirm **@limenlabs/sdk** and `npm install @limenlabs/sdk` are both visible.
3. Point to the package name, then the install command.
4. Move to the sentence explaining that the package derives challenges and subjects,
   plans a clearance, and verifies a published clearance from chain.
5. End on the install command.

---

## 2:49–3:00 · Close

**Say**

> Private deals. Capital-gated allocations. Lending eligibility. Applications do not
> need your financial life. They need one answer. Limen: prove enough, keep the rest
> private.

**Exact screen actions**

1. Press `⌘+7` as you say “Applications do not need your financial life.”
2. Confirm the homepage hero and the 50 STRK product panel are visible.
3. Move the cursor into empty space at the far right.
4. Hold the final frame for two seconds after the last word.

## Delivery notes

- Speak conversationally, as if explaining Limen to one curious person.
- Pause after **not disclosed**, **cleared**, and **That is the product**.
- Press each tab shortcut during the final word of the previous section so the next
  screen has settled before its narration begins.
- If any prepared tab is wrong, stop and restart the take. Do not search or improvise
  while recording.
- Say “this challenge ran on Mainnet,” not “I am running it now.”

## Do not show or say

- Do not show `/console`, npmjs.com, Voyager, source code, or a terminal in the main take.
- Do not explain the prover image, protocol limitations, or Wallet API gap.
- Do not say “anonymous,” “untraceable,” “proof of solvency,” or “audited.”
- Do not imply that a judge can run a fresh clearance from a browser wallet.
- Do not claim that the displayed challenge is executing live during the recording.
- Never show `.env.local`, secrets, or private keys.

## Recorded

<https://youtu.be/K8y9212NLWk>

Recorded in `strk20.json` under `demo_video`, which completes the submission manifest.
This script stays as the record of what the video claims, so any statement in it can be
checked against the repository later.
