# Polish log — PRD and addendum (2026-11-24)

Review: `bmad-review` with lenses structure, then prose. Reader: humans. Model: Strategic/Context (Pyramid). No requirement, consequence, decision, or target was added, removed, or changed in meaning. All 29 inline `[ASSUMPTION]` tags are kept. FR, NFR, SM, and UJ numbers are unchanged.

## Structure

PRD:
- §5: moved NFR-10 so NFRs read 1–12 in order. Numbers unchanged.
- §9: moved "Decisions delegated to architecture" from between items 5 and 6 to the end, as item 8. Items now read 1..8. The existing references (OQ-5 in §10, OQ-6 in item 8) still point to the same items.
- §10 Assumptions Index: removed the FR-40 entry, because FR-40 has no inline tag. Merged the two FR-12 entries into one. Reworded the §4.8 NFRs entry to match the current tag ("In Connected mode…"). Reordered the entries to follow document order. Each inline tag now has exactly one entry.
- UJ-2: aligned with the FRs that changed after the journey was written:
  - "within minutes" now reads "within the discovery interval (30 minutes by default)", per FR-28, SM-3, and §10.
  - Added that review-requested PRs get a pending review only Arjun can see, per FR-20a.
  - "re-reviews only what changed" now reads "comments only on what is new or changed". FR-19 re-evaluates the whole PR.
  - The SSO edge case now reports through an issue in the automation repository plus the run summary, per FR-29. It used to say "run log/summary".
- UJ-4: the edge case assumed a backend was required. It now offers Standalone setup (own AI API key and GitHub sign-in) or connecting a backend, per FR-37.
- FR-10: "The one exception to 'never stores'" pointed at a "never stores" clause that no longer exists. It now reads "One exception applies, to the Auto-Review opt-in below". The exception itself is unchanged.
- §4.6 Notes: "this is an optimisation, not a requirement" read as if it contradicted FR-28, which lets the user enable immediate review. The note now says the event-driven trigger is a mechanism choice, not a requirement, and points to addendum B3.
- §4.1 Notes: "see §6" now reads "see §6.1", where the validator set is listed.
- FR-19: split one long sentence into a three-item list (what a run on a new Head Commit does), followed by the human-comment and hidden-marker sentences.

Addendum:
- B3: "Watch Scope (d)" pointed at lettered items that FR-27 doesn't have. It now names the scope item in words. "(FR-28 note)" now reads "(FR-28)". The FR-29 bullet now names the issue-plus-run-summary channel.
- B5: the "Backends" bullet now reads "Modes (FR-37)". It covers Standalone (no backend) and Connected (Web App or local CLI companion).
- D1: "§6 cuts v1" now reads "§6.1 slices v1 into four releases".

## Prose

- Glossary terms are now used verbatim:
  - Web App: UJ-3, UJ-4.
  - AI Provider: UJ-3, FR-32, NFR-10, addendum B2 heading.
  - Finding/Findings: UJ-1, UJ-3, UJ-4, FR-6, FR-17, FR-29a, addendum B2.
  - Layer Status ("each layer's Layer Status"): Glossary Report, FR-17, FR-32.
  - Overall Status: Glossary Report, UJ-1.
  - Report: UJ-1.
  - Auto-Review: UJ-2.
  - Quality Gate: addendum A.
  - Sandbox: addendum D2.
  - "repository configuration" instead of "repo configuration": FR-13.
- FR-39: changed `SKIPPED (no sandbox available)` to `SKIPPED (no Sandbox)` to match §4.9. One status string now appears everywhere.
- §0: split the opening sentence into two. "review engine … four channels" now reads "Review Engine … four Channels".
- FR-13: split the "with later layers winning — except that…" sentence into two.
- FR-29: split one long sentence into three: the rule, the list of failure causes, and where they are reported.
- §6.1: "Every provider the user asked for" now reads "Every provider requested for v1". "User" is a product role in this PRD, so the old wording was ambiguous.
- Addendum B2: "read-only sandbox" now reads "Codex's own read-only sandbox", so it isn't confused with the glossary Sandbox.
- Addendum B6: small grammar fix ("a container runtime").
- PRD frontmatter: kept `status: draft` and `updated: 2026-11-24`.

## Findings not applied

- FR-29 says it reports "once per cause". Its consequence says "exactly one notice per day". This may be a tension, unless the daily notice means a daily update on the same issue. I left it as written, because resolving it would change a testable target. The PM should confirm.
- The FR-37 assumption says both backend kinds are in "the extension's first release". §6.1 says Release 4 ships "Standalone mode first, then Connected mode". It is unclear whether Connected mode is part of Release 4. I left it for the PM.
- OQ-2 (free-account CI limits) is now partly answered by FR-28 and FR-29a. I kept it open, because closing it is a decision.
- Spelling is mixed: "Realizes" is a template label, and the body uses British spelling. I did not normalise it, so the template keyword stays recognisable.
- Several sections were kept on purpose. The Glossary uses conceptual order, not alphabetical. §7 Non-Goals repeats FR-18 and FR-10, and NFR-2 repeats FR-15. The §4.8 Description overlaps FR-37. These repetitions orient human readers.
- The wording inside the §6.1 assumption tag ("revised after review") was left as is, because tag text is not edited.
- Addendum B6 lists no Web App Sandbox option, although FR-39 covers the Web App. I did not add one, because that would be new content.
