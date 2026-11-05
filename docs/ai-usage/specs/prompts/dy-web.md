# Session: dy-web

Read `BRIEF.md` and `DECISIONS.md` first. Work in your own git worktree, on branch `pawan/web`.

**Goal:** the web app (React + Vite + Tailwind PWA in `web/`) has to carry the demo. It must be clear on a projector, show the hero moment end to end, and look polished: judges score UX and WOW.

**Om actively pushes to `web/`, so collisions are the main risk.** Keep commits small, `git fetch && git rebase origin/main` often, and before reworking a screen, ask the manager whether Om is on it.

**You own:** web polish and demo UX. `web/src/lib/arkiv.js` belongs to `dy-arkiv` and `web/src/lib/arc.js` to `dy-arc`; use them and don't rewrite them.

**Tasks:**
1. **Run it** (`npm install && npm run dev` in `web/`, which uses demo data with no Pi) and screenshot every screen (headless Chrome is fine). Write an honest UX review: what's confusing, inconsistent or broken. Known doc inconsistencies: 3 vs 4 flats (it's 3: A/B/C), and the escrow flow (who opens it, auto-release vs claim). Send the review to the manager **before** big changes.
2. **The hero-moment flow:** Panel Health shows output vs expected and a dust alert, then an escrow opens with an Arc tx link, the cleaner screen shows Accept → Mark done, the release fires automatically when the meter is > 90%, and paid shows with the tx and the 0G proof link. Every step should be legible from the back of a room.
3. **The "0G offline" honesty state:** a clear banner when Dyna is unreachable (flats on grid, pump on a timer, "no AI").
4. **A projector "demo mode"** that follows the 5 moments (morning plan, noon routing, dust, month-end settle, 0G offline), driven by the Pi's `POST /api/moment/<name>` if available, with large states.
5. **Mobile and desktop consistency,** no console errors, and a production build check.

**Milestone:** report to the manager after the UX review (1), then after (2).
