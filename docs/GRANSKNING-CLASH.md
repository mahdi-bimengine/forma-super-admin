# Clash surface: pre-launch review (2026-11-09/10)

Three passes (one by Claude, two independent reviewers), findings checked against the code. R&D BIM ENGINE has
no completed clash issues, so nothing was tried on real clash data. Checked in R&D: the latest comment is fetched
correctly (`sortBy=-createdAt`), and a new comment bumps the issue's `updatedAt`, so the comment cache is reliable.

## Fixed 2026-11-10 (blockers 1–6)
1. "Stäng markerade" no longer touches an issue with a pending change (a send-back keeps its status and comment):
   `isKanMarkeraClash`, `isForeslaStatus` refuses when a comment is pending, send-back unticks the row.
2. Only ticked issues that are visible and closable are closed or counted; ticks hidden by a chip, search or model
   filter are dropped (`isGiltigaClashVal`, `isRensaClashVal`).
3. Saving skips an issue whose changed fields differ in ACC from when the change was made (e.g. the designer
   reopened it): status "ändrad i ACC", nothing written, the list shows ACC's state (`isSpara`). Applies to every
   surface.
4. After a 401 the retry is sent with the refreshed token (headers built per attempt in `apsFetch`). Whole app.
5. Uppdatera and a hub change reset the model filter, and the filter only applies while the model-check row shows.
6. The model check never shows "Löst" on missing data: an issue is "Löst" only when every clash group was
   compared; otherwise "Inte helt kontrollerad" (`ofull`). A response without a clash list is not counted as
   resolved. A project where a model set fails gets "Kunde inte kontrolleras" (`fel`) for all its issues instead
   of a partial result. A run started earlier never writes over a newer one (`_is.modellGen`). The meeting sheet
   fills "Clashar kvar" only for Löst/Delvis/Kvar.
Tested locally with made-up issues and a pretend ACC/Model Coordination, and on the live site on 2026-11-10 in R&D BIM ENGINE with three test clash issues (#25–#27, now closed). ACC does not let this account set "completed" (only the assignee's workflow can), so the test issues (status in_review) were counted as completed inside that browser tab only. Live results: 1 and 2 (send-back kept, hidden tick dropped), 3 (#26 closed, #27 changed in ACC between review and save was skipped as "ändrad i ACC"), 5 (filter reset after Uppdatera), and the model check ran without errors (no linked clash groups in R&D, so all "Ej kopplad"). 4 and the model-check rules in 6 were tested locally only.

## Still open (by severity)
- Bulk close does not warn about issues the model check shows as "Finns kvar"/"Delvis".
- "Skicka tillbaka": browser prompt, empty comment allowed, does not say which status or that the comment is
  permanent, and does not reassign to the designer.
- The review dialog says everything can be restored; comments cannot, and Historik is per browser and stops being
  saved silently when storage is full.
- "Avbryt" in the review does not undo the bulk close.
- Classification: "vi" matches substrings ("BIM Engine" ⊂ "BIM Engineering AB"); our own e-mail domain is not used
  for comments; settings are per browser; the rule is only in a tooltip.
- "Ej kopplad" also covers "no successful run in the last 5 versions" and "group missing from the answer".
- Unreadable comments stay "läses in…"; the Start card waits for comments it does not need and only counts after
  Clash has been opened.
- Uppdatera or a hub change while comments load leaves them unread (`_is.clashLaddar` not reset).
- When comment reading or the model check finishes after the user switched tool, `isRita` draws Issues over it.
- The list jumps to the top after every action; the first "Kontrollera mot clashkörningen" click shows nothing
  until the check is done.
- Meeting sheet: exports only the current filter without saying so, different order from the screen, blank
  comments while loading.
- A status change that succeeded but whose comment failed is reported as "fel".
- Performance: all projects checked at once (429 risk); a failed page restarts the whole group list; silent cap
  at 4,000 groups; full redraw on every search keystroke; the save dialog redraws the whole table per issue.
- Minor wording: "Ej markerade" vs the tick boxes, "Ej omkörd"/"Ingen ny körning", "förföll" for future dates,
  Start-card number vs the view it opens, chip counts ignore search, one empty-state text for every cause, raw API
  errors, hub change drops pending changes without asking.
