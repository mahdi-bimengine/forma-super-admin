# Spec: the model view when going to an issue

Decided by Mahdi in an interview on 2026-11-10. This replaces earlier one-line
requests about the section box and the plan section. Change the viewer only
against this list, one check at a time.

## What the view is for

When Mahdi clicks an issue he needs to see two things: **where in the building
it is**, and **which elements clash**. Closing issues and showing them in
meetings are not the goal of this view.

## Typical real project

- 10–30 IFC files in the light model.
- Issues are pinned on a mix of IFC and Revit models. Revit-pinned issues can
  only be placed approximately and have no reliable saved camera.

## Behaviour

1. **First view is the issue's saved camera**: the same position and angle the
   issue was created with in Model Coordination, not a recalculated distance.
2. **Cuts and hidden elements are exactly as saved in ACC** with the issue.
3. **No cut saved** (the common case): cut to a room-sized box, about 10–15 m
   around the issue, so walls and slabs in front do not block the view.
4. **Saved camera cannot be used** (for example a Revit-pinned issue): a
   standard view from above at an angle, room-sized box, with the note that the
   placement is approximate. The issue is not greyed out.
5. **Elements keep their model colours.** No highlight colour on the clashing
   elements and no fading of the surroundings by default. Only the marker shows
   the spot.
6. **Marker**: a circle with a white border, filled with the issue's ACC status
   colour, the same size on screen at any distance.
7. **Plan on a button**: one button switches to the plan section seen from
   above and back to the saved camera. The plan is never the first view.
8. **Stepping** (Nästa, Föregående, arrow keys): a short glide to the next
   issue's own view. Any cut, zoom or angle changed by hand is reset.

## Checks (yes or no, in a real project)

- [ ] Clicking an IFC-pinned issue shows the same picture as its thumbnail.
- [ ] An issue with a saved cut in ACC shows that cut and nothing more.
- [ ] An issue without a saved cut shows about 10–15 m around it, and I can
      tell which room or zone it is in.
- [ ] A Revit-pinned issue opens in an angled view with "approximate" shown.
- [ ] No element changes colour and nothing is faded when I click an issue.
- [ ] The marker has the status colour and a white border.
- [ ] The plan button goes to the view from above; pressing it again returns
      to the saved camera.
- [ ] Nästa glides to the next issue and resets what I changed by hand.
- [ ] Stepping between issues takes under a second once the model is loaded.

9. **The camera starts moving at the click** (added by Mahdi while building).
   The cut, marker and fading follow while it glides.

## Built 2026-11-10 (`isfGaTillArende` in `tools/issues/issues-frag.js`)

Tested signed in on the live site in R&D BIM ENGINE, with the new code loaded
into the page before publishing:

- #19 and #20 (IFC-pinned): the camera lands exactly on the saved position
  (0 m off) with the saved field of view, and the picture matches the issue's
  thumbnail. The camera starts moving 11–46 ms after the click.
- No element is highlighted, nothing is faded, and the marker shows.
- No saved cut: six planes form a 12 m box around the issue (`ISF_RUM_M`).
- Plan button: one horizontal cut 1.2 m above the issue, seen from straight
  above, about 15 m around it (`ISF_PLAN_RADIE_M`); zoom out for the storey.
  A new issue always opens in its own view again.
- "Tona ner omgivningen" still exists as a checkbox, now off from the start.

Tested only by faking the data in the page, because R&D has no such issue:

- A saved cut: a made-up horizontal cut on #19 was converted to the right
  place and cut the roof away. Which side Autodesk keeps is taken from how its
  viewer works, not from a real issue. If a converted cut would hide the
  issue's own point, the saved cuts are ignored and the room box is used.
- No usable camera: an angled view of the room box with the "approximate" note.

Not built:

- Hidden or isolated elements saved in ACC. They are stored as Autodesk's
  element numbers, which the light model does not have.
- A saved camera without perspective (one R&D issue, #17, has that) uses its
  direction only, at room distance.

## Test data needed in R&D BIM ENGINE before building

R&D today has three tiny sample models and four pinned issues, so "works in
R&D" says little. Needed: a multi-storey IFC set from several disciplines, and
about 20 pinned issues: some with a saved cut, some without, some on Revit.
