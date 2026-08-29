# Three-minute demo

The goal is a clear product story: show the problem, demonstrate the experience, and
finish with verifiable Mainnet evidence. Keep Limen on screen throughout. The full
narration is intentionally short enough to leave room for pauses and cursor movement.

## Recording setup

Preload these four tabs in this order:

1. **Home:** <https://limen.timjosh507.workers.dev>
2. **Cleared challenge:** <https://limen.timjosh507.workers.dev/challenge/0x78e0b30dc72343243712064487c9aeffc76441532f7b2f1cb4de09bedca9ecf>
3. **Evidence:** <https://limen.timjosh507.workers.dev/evidence>
4. **Voyager transaction:** <https://voyager.online/tx/0x2277d769273da51bcc30a5ac41d0bb3fc45906a0a59917202d22f83d383e566>
5. **npm package:** <https://www.npmjs.com/package/@limenlabs/sdk>

Record at 1920×1080 with the browser at 100% zoom. Hide bookmarks, close anything
with a notification badge, and load every tab before recording. Move the cursor slowly
and deliberately. Do not start the prover or attempt a new clearance during the video.

---

## 0:00–0:18 · The problem

**Say**

> Imagine an app asks you to prove you have enough capital. Today, that usually means
> connecting a wallet and revealing far more than the app needs. Limen changes that.

**Show**

Start on the homepage hero. Keep the cursor still and make sure **Prove enough. Keep the
rest private.** is visible.

---

## 0:18–0:38 · One answer, not a balance

**Say**

> The app asks for one threshold. Limen returns one answer. Here, the example
> requirement is 50 STRK. The user's actual shielded balance stays exactly where it
> should: not disclosed.

**Show**

Move the cursor to **≥ 50 STRK**, then slowly from **Your shielded balance** to **Not
disclosed**. Pause after saying “not disclosed.”

---

## 0:38–1:00 · How it works

**Say**

> The required amount moves from private funds. The application's action runs. Then the
> capital returns to a shielded note, all in one transaction. If the amount isn't there,
> nothing unlocks.

**Show**

Scroll smoothly to **One atomic transaction, four things happen.** Move across **Spend
→ Withdraw → Execute → Return**, matching each step to the narration.

---

## 1:00–1:15 · The privacy boundary

**Say**

> The application sees the requirement and the result. It does not receive your total
> balance, your notes, your address, or your unrelated activity.

**Show**

Scroll to the privacy-boundary section. Point to **Becomes public**, then **Stays
private**. Do not read every item.

---

## 1:15–1:42 · A real Mainnet clearance

**Say**

> And this is not a mockup. This challenge ran on Starknet Mainnet. The requirement was
> 4 STRK. The result is cleared. Limen unlocked the allocation action for the Capital
> Gate.

**Show**

Switch to the cleared-challenge tab. Keep **Prove ≥ 4 STRK** and the green **Cleared**
state visible. Point to **REGISTER_ALLOCATION**, then the target. Pause after saying
“cleared.”

---

## 1:42–2:00 · The product moment

**Say**

> Notice what is missing: no wallet address, no balance, and no list of holdings. Just a
> scoped subject and proof that the requirement was met. That is the product.

**Show**

Move to the product panel. Point from **Your shielded balance** to **Not disclosed**,
then trace **Proving → Accepted → Cleared**. End on **Capital returns to a shielded note.**
Pause after saying “That is the product.”

---

## 2:00–2:20 · Evidence anyone can verify

**Say**

> Here are the deployed contracts and three Mainnet clearances. Every link opens the
> transaction on Voyager, so nobody has to trust our dashboard or our word.

**Show**

Switch to the evidence page. Show the **STRK20 pool**, **Limen Anonymizer**, and
**Capital Gate**. Move down to the transaction rows and click the third transaction. If
the click is slow, switch directly to the preloaded Voyager tab.

---

## 2:20–2:34 · The transaction

**Say**

> This is the real transaction: successful, through the live STRK20 pool, with the
> application action executed and the capital returned privately.

**Show**

Show Voyager's successful status and the transaction hash. Do not scroll through raw
calldata. Hold the frame.

---

## 2:34–2:49 · Tested against failure

**Say**

> We also tried to break it a hundred different ways: too little capital, wrong token,
> expired challenges, and replay attempts. Zero false clearances. Zero successful
> replays. Zero stranded funds.

**Show**

Return to the evidence page and scroll to **100 deterministic cases**. Point to the
three zero counters as you say them.

---

## 2:49–2:58 · Anyone can build on it

**Say**

> And this is not just our app. The SDK is published, so any Starknet application can add
> a capital gate. They implement one function and install one package. Their only
> dependency on us is a contract with no owner and no upgrade path.

**Show**

Switch to the npm tab. Keep **@limenlabs/sdk** and the install command visible. Do not
scroll into the API list.

---

## 2:58–3:10 · Close

**Say**

> Private deals. Capital-gated allocations. Lending eligibility. Applications do not
> need your financial life. They need one answer. Limen: prove enough, keep the rest
> private.

**Show**

Return to the homepage hero. Move the cursor to the side and finish with the Limen
name, tagline, and product panel visible. Hold the final frame for two seconds.

## Delivery notes

- Speak conversationally, as if explaining Limen to one curious person.
- Pause after **not disclosed**, **cleared**, and **That is the product**.
- Let each screen settle before moving the cursor. Never rush to catch the narration.
- Say “this challenge ran on Mainnet,” not “I am running it now.”
- If Voyager does not load, remain on the evidence page. Do not switch to a terminal.

## Do not show or say

- Do not show `/console`, source code, or a terminal. The npm package page is the one
  developer-facing screen, and it is there to show the product is consumable, not to
  teach the API.
- Do not explain the prover image, protocol limitations, or Wallet API gap.
- Do not say “anonymous,” “untraceable,” “proof of solvency,” or “audited.”
- Do not imply that a judge can run a fresh clearance from a browser wallet.
- Do not claim that the displayed challenge is executing live during the recording.
- Never show `.env.local`, secrets, or private keys.

## After recording

Publish the video, then put its URL in `strk20.json` under `demo_video`. That is the
final submission-manifest step.
