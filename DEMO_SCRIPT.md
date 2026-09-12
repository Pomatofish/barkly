# Grammy — 2-minute demo script

Setup before recording: extension loaded, onboarding done with a working key and mic, persona set to **Casual**.
Open `https://www.instagram.com/lena.explores/` (or the fixture: `node tools/serve.js` → `http://localhost:8123/lena.explores/`)
then the post. Chat menu closed. Sound on.

## 0:00–0:10 — Problem (10 s)

**Say:** "When you see a post that works, you screenshot it, paste it into a chatbot, and describe it. The context is lost, and so is the moment. Grammy answers where you already are: inside Instagram, by voice."

**Screen:** the post page with the 🐶 mascot bottom-right and a green pill.

## 0:10–1:10 — Golden path (60 s)

1. **Say:** "Hold the mascot and ask." **Do:** press and hold 🐶. Pill shows "Listening…".
   **Speak:** "What's this post about?" Release.
   **Screen:** a speech bubble appears next to the mascot with a two-sentence answer, and the same text is spoken.
2. **Say:** "Tap the bubble and the full chat opens with the same answer in the log." **Do:** tap the bubble.
3. **Say:** "Switch to the influencer persona: same assistant, different lens." **Do:** click **Influencer** in the menu, then the chip **"How could this do better?"**
   **Screen:** an analytical reply citing the likes and comment count, ending with numbered recommendations.
4. **Say:** "Ask it to remember." **Do:** type `remember this post's style`, Enter.
   **Screen:** reply confirms; open the **Remembered** panel: one pinned "post_style" item with a delete button. Reload the page, reopen the menu: the pin is still there.
5. **Say:** "Now my own photo." **Do:** click **Attach my image**, pick a photo, then the chip **"Match this style"**.
   **Screen:** a text answer describing the post's light, colour and caption style, then numbered steps to match it. No image is generated.

## 1:10–1:30 — Failure case (20 s)

**Say:** "Grammy only reads public content." **Do:** open `https://www.instagram.com/quiet.club/` (fixture: `http://localhost:8123/quiet.club/`), a private profile.
**Screen:** the pill turns red: "Private account — not reading". Open one of that account's posts (`/p/DB1QuietZ9k/`): still red.
**Do:** hold 🐶 and ask "what's in this post?" **Screen/spoken:** Grammy declines to describe the content and offers to answer general questions instead.

## 1:30–1:50 — Architecture (20 s)

**Say:** "Six small modules behind one frozen contract. The content script reads the rendered DOM only. Voice records in an offscreen document. Every network call goes through the background worker to OpenAI with your own key. Memory never leaves the browser, and every pinned item has a delete button. Nineteen failure modes are mapped to one status pill."

**Screen:** `failure-modes.md` table, then the `src/` folder tree.

## 1:50–2:00 — Close (10 s)

**Say:** "Grammy: ask about the post in front of you, out loud, and keep scrolling." **Screen:** mascot bounce on the last reply.
