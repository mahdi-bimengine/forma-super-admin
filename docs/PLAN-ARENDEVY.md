# Ärendevy: issues above, live model below

Goal: in the Issues tab, show the issue list on top and a light APS viewer below that jumps to the
selected issue's spot. Only issues placed in Model Coordination are in scope (Mahdi, 2026-11-05).

## Status
- Part 1 (what ACC stores, does our viewer load it): done 2026-11-05, tested on R&D issues #17 and #18.
- Part 2 (bare viewer under the list, jump on row click): built 2026-11-05 in `tools/issues/issues-visare.js`,
  "Modellvy" button on the Clash and Alla ärenden surfaces. Tested on R&D #17/#18/#1 by loading the file into
  the live page (not yet published). The issue is fetched per click (one GET); rapid clicking can hit ACC's
  rate limit (429), which `bhMedOmforsok` waits out. Clicking rows on the Clash surface is not tested yet
  (the button and panel show there; the row hook is the same as in Alla ärenden).
- Part 3 (section box, ghosting, room for the list): built 2026-11-05, not yet published. Section box =
  pin ± 3 m plus the clicked element (capped at 8 m), camera zoomed to it in the saved direction. Fading =
  isolate + ghosting of every element whose box comes within 0.3 m of the pin, in all models. Both are
  checkboxes saved per browser, and are skipped for issues that already have their own cut or hidden
  elements in ACC. The dashboard cards hide while Modellvy is on; the split can be dragged (20–85 %, saved).
  Tested on R&D #17: in that clash only one of the two models had elements within 0.3 m of the pin, so the
  other model is shown unfaded.
  Parts 2 and 3 were published 2026-11-05.
- Fix 2026-11-05 (which models load): loading every model in the issue's `viewerState.objectSet` loaded a
  whole model set in a real project (5 GB and climbing). Now, per Mahdi's rule:
  - The issue's ACC location (`a.platsVag`) is matched against the view names of the model set that holds
    the pinned model, deepest location level first, ignoring case, punctuation and "block"/"blk". An exact
    name is chosen; a single "contains" match is preselected but marked as a guess (amber dropdown); several
    or none means no view.
  - With no view, only the pinned model loads. The "Vy" dropdown is always shown and overrides the match;
    the choice is saved per project, model set and block in localStorage (`isv-vy:…`).
  - Models are loaded in the model set's latest version (`getModelSetVersion` → `documentVersions`:
    `versionUrn` + `viewableGuid`, matched to the view's `lineageUrn` + `viewableName`). The element is
    found again by Revit's `externalId`, since its internal id changes between versions (R&D #17: 5525 → 5208).
  - Views with more than 8 models ask before loading. Models not in the new list are unloaded first.
  - The camera always zooms to the issue's spot; "Hela modellen" is gone.
  Tested on R&D #17/#18 with the private "View 1" picked by hand: 1 model without a view, 2 with it, no
  reload between #17 and #18 (about 0.05 s). The location matching was dropped the same day: the browser
  can never read the location tree (Locations API has no CORS), so `a.platsVag` is always empty in practice.

## New design (Mahdi, 2026-11-05)
1. **A: the view is the backdrop** (built 2026-11-05). A "Vy" dropdown at the left of the bar lists every
   view in the project's model sets (grouped per model set) plus "Bara ärendets modell". The choice is saved
   per project (`isv-vy:<projekt-id>`, value `msId|viewId` or `arende`) and loaded as soon as Modellvy opens.
   Its models load once, latest version, and stay. Clicking an issue only moves the camera; if its pinned
   model isn't in the view the panel says so. Clicking an issue from another project switches to that
   project's saved view. "Bara ärendets modell" loads the clicked issue's model and swaps it only when the
   next issue sits in another model. The whole-view zoom must be immediate (`fitToView(.., .., true)`):
   an animated one finished after the next issue's camera and left the camera far out.
2. **B: the list follows the view** (built 2026-11-05). When the panel opens, every issue's pin is read
   with one paged list call per project (`fields=displayId,linkedDocuments`, same statuses as the tab) into
   `_isv.arenden`, so clicks no longer fetch the issue. `isvRitaRadlagen` (run from `isvRitaRad`, which
   `isRitaRader` also calls) fades rows to 45 % and adds a line under the title: "Syns inte i vald vy" when
   the pin's lineage isn't in `_isv.vy.lineages`, "Inte placerat i någon modell" when there is no pin.
   "Bara ärendets modell" greys only unplaced issues. Föregående/Nästa and the up/down arrow keys step
   through the visible rows in table order (not while typing in a field or with a dialog open). Tested on
   R&D: View 1 → #17/#18 visible, 15 unplaced; Samlingsfil → #17/#18 "Syns inte i vald vy".
3. **C: the selected issue opens up** (built 2026-11-05). `isvRitaDetaljrad` (run after every row redraw)
   puts a detail row under the selected row: the snapshot (`snapshotUrn` → `/oss/v2/buckets/{bucket}/objects/
   {obj}/signeds3download` → blob URL; click for full size, Esc or click closes), the description and every
   comment oldest first with name (project name register) and time, in boxes that scroll. Read once per issue
   (`_isv.detaljer`). ✕ closes it; clicking the issue again reopens it. Works for greyed issues too. Tested on
   R&D #17 (picture only), #18 (test description + 3 test comments) and #3 (no pin, no picture).
- R&D test data made 2026-11-05: locations "Test - Block A" and "Test - Block B" under Projekt (not used any
  more); on issue #18 a description and three comments starting with "TEST".

## What a Model Coordination issue carries (Issues API v1, tested)
Issues placed in MC have one `linkedDocuments` entry, `type: "TwoDVectorPushpin"` (also for 3D):
- `urn`: lineage URN of the pinned model, `createdAtVersion`: its version number.
- `details.viewable`: `guid` (use it to find the 3D view node), `name`, `is3D`.
- `details.position`: pin point, in the model's internal coordinates (feet for Revit).
- `details.objectId`: dbId of the clicked element, `details.externalId`: Revit UniqueId.
- `details.viewerState`: full viewer state.
  - `objectSet[]`: one entry per model that was open, each with `seedUrn` (base64 version URN, ready for
    `Document.load('urn:' + seedUrn)`) and `hidden`/`isolated`/`id` lists (dbIds, `idType: "lmv"`).
    This is how we know which other model(s) were in the clash view.
  - `viewport` (camera, numbers stored as strings), `cutplanes`, `globalOffset` (was 0,0,0), `renderOptions`,
    plus floor fields (`floorGuid` etc.) that were empty.
- `placements[0]`: newer field, `lineageUrn`, `createdAtVersion`, `viewable`, `originContext`
  (`product: "model"`, `tool: "models"`). Not needed so far.
- `snapshotUrn`: a picture of the view exists.
No clash group or clash test id is stored on the issue.

## Viewer findings
- Load each `objectSet[].seedUrn` with `loadDocumentNode(doc, node, { keepCurrentModels: true,
  globalOffset: {0,0,0}, applyRefPoint: false })`. With `applyRefPoint: true` the models move to survey
  coordinates and the saved camera points at empty space.
- Call `restoreState(viewerState)` after geometry has loaded, otherwise the viewer's own fit-to-view
  overrides it. Then `select([objectId], pinnedModel)`.
- Timing: two R&D models loaded and positioned in about 2 to 4 s. Switching to another issue in the same
  models took 1 ms (camera only).
- `derivativeV2` / `AutodeskProduction` worked for these EU (`wipemea`) models.

## Not yet checked
- Larger client-sized models (speed).
- Issues pinned in an older version than the latest: load the issue's version (exact) or latest (pin may be off).
- Whether the view matches ACC's exactly: compared only by eye in a screenshot.
