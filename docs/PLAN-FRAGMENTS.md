# Modellvy on light Fragments models (That Open)

Why: Modellvy (docs/PLAN-ARENDEVY.md) loads Model Coordination views through Autodesk's viewer, and real
views are too heavy. Mahdi's decision (2026-11-05/06): convert chosen IFC files (always available, every
project exports IFC) to That Open's Fragments (.frag), store them in ACC, and show issues on those, placed
BCF-style from the ACC issue itself. Full plan with risks: `C:\Users\MahdiElMahdi\.claude\plans\cozy-meandering-biscuit.md`
(parts 1–4). Fragments can only be made from IFC, not from .rvt.

## New brief (Mahdi, 2026-11-06, Instruktioner.docx) — this replaces the plan's parts 2–4
- Drop Model Coordination views and the Autodesk viewer entirely (too slow). The viewer under the issue list is
  Fragments only.
- Two buttons: "Visa modell" (toggle) and "Modellinställningar" (popup with an animation). In the popup the user
  picks the IFC files that make up the model (from Data Management, from the computer, or drag and drop) and
  updates the model. The choices are remembered per project. A red bubble on the button shows that an IFC has a
  newer version. The Fragments model is stored in ACC so everyone in the project can use it.
- IFC files picked from the computer are uploaded to ACC (Mahdi's OK 2026-11-06), so everyone can update the
  model and the red bubble works for them.
- The viewer has cut and measure (and properties, asked for earlier the same day) and shows the issues.
- Parts: **1** remove Autodesk, two buttons, popup shell, empty Fragments viewer (built 2026-11-06, tested
  locally with made-up issues: libraries incl. components-front load, viewer survives redraws and reopening,
  popup animates, Esc closes, arrow keys step; not yet tested signed in on R&D). **2** settings: pick IFC,
  convert in the background, store .frag + index in an ACC folder chosen once per project, version check
  (built 2026-11-06, tested signed in on R&D, test folder "Project Files / Modellvy (test)": folder picked in
  the popup; Building-Architecture/Structural added from ACC and converted in the worker (17/18 kB); a copy of
  Building-Hvac.ifc dropped as "from the computer" was uploaded to the folder and converted; a new IFC version
  made outside the app gave the red bubble after reload, "Uppdatera modellen" converted V2 and the bubble went;
  removing and re-adding reused the same .frag file as version 2; the index is found by search without the
  browser's memory (1.9 s); upload in parts tested with 5 MB parts (3 parts, identical download). Not tested:
  a real file over 50 MB, a user without write permission, two users saving at the same time. A 12 MB
  "TEST multipart.bin" is left in the test folder (the API delete was refused); delete it by hand.)
  Index `arenden-lattmodell.json` format is at the top of `issues-lattmodell.js`. Conversion runs in
  `issues-frag-omvandla.js` (module worker, esm.sh with `?deps=three@0.182.0,web-ifc@0.0.77`).
  New .frag files are put in the browser cache (IndexedDB `forma-lattmodell`, keyed by the .frag version id).
  **3** viewer (built 2026-11-06, tested signed in on R&D with Building-Architecture/Structural/Hvac): the three
  models load in 2 s the first time and 0.4 s from the browser cache (no downloads); a model updated in the
  settings is swapped by itself (Hvac .frag V2 → V3). Models are loaded with the IFC lineage as model id, and
  Fragments' `autoCoordinate` shifts each to line up with the first (Structural moved 7 m and matched).
  Tools: ⌂ whole model; Snitt = section box of six `OBC.Clipper` planes (normal pointing inwards keeps the
  inside; three.js clips the negative side) or free planes by double-click; Mät = `LengthMeasurement` from
  components-front (double-click two points, snaps to corners/edges, mm; its labels need a CSS2DRenderer,
  added on first use; Delete removes the one under the mouse); Egenskaper = click selects (highlight) and a
  side panel shows attributes, type, storey and property/quantity sets from `getItemsData` (IsDefinedBy).
  The small box 30 m left of the house is part of the sample IFC, which is why "whole model" is off-centre.
  **4** issues in the model (built 2026-11-06, tested on R&D #19 and #20, both pinned in MC on IFC models):
  - The coordinate rule, measured, not assumed: Autodesk shows an IFC with its IfcMapConversion applied
    (#19's zone corners in Autodesk's viewer = web-ifc corners through the map, to 0.2 mm). The .frag is
    web-ifc's coordinates (m, Y up) + `getCoordinates()` (the shift COORDINATE_TO_ORIGIN made, which changes
    between conversions), and the viewer adds each model's autoCoordinate offset (`matrixWorld`).
    `getMergedBox`/`getBoxes` already return viewer coordinates. Result: #19 0.36 m from its zone (the pin
    really sits there in MC), #20 0.04 m from its wall in the shifted Structural model.
  - The converter skipped IfcSpatialZone (#19 sat on one); it and IFC4.3 infra classes are added, and
    `ILM_FORMAT` 2 makes older .frag files show as "Behöver göras om" with the red bubble.
  - Revit-pinned issues: UniqueId → GlobalId by Revit's export rule, pin at the element's centre, marked
    "Ungefärlig placering". Only tested with made-up ids. #17/#18 (Revit model, no IFC export in the light
    model) are greyed "Finns inte i den lätta modellen".
  - R&D test data: #20 "TEST - nål på IFC (Building-Structural)".

## After publishing (Mahdi, 2026-11-06)
- **File picker** ("Lägg till från ACC") rebuilt because finding IFCs was tedious and the list jumped on every
  click (the whole window was redrawn). Now: tab "Sök i projektet" lists every IFC in the project via the DM
  search `filter[fileType]=ifc` per top folder (R&D: 11 files in 1.3 s, folder paths filled in by 1.9 s,
  cached per folder), newest first, filtered as you type on name and folder; tab "Bläddra i mappar" keeps the
  tree. Click anywhere on a row, Shift-click for a range, "Markera alla som syns", chosen files as tags with ×.
  The window is built once and only the changed parts are updated; scroll position is kept (tested: 40 → 40
  after clicks and Shift-click; tree 60 → 60), and the main settings list keeps its scroll during conversions.
- **Storage folder is a setting**: "Sparas i ACC: … Ändra". Changing it copies every .frag and writes the index
  in the new folder, then overwrites the old index with `{ flyttadTill }`, which `ilmLasIndexfil` follows, so
  everyone finds the new place. Tested: moved R&D's test model from "Modellvy (test)" to "Modellvy (test 2)";
  a fresh search found the new index with no duplicate warning, and the viewer loaded the copied files.
  The old files stay (the app cannot delete in ACC).
- **Mouse like Model Coordination**: left drag orbits, right/middle drag pans, wheel zooms towards the cursor
  (and on past it), double-click zooms to the element and makes it the orbit centre, click selects. Orbit
  and zoom speeds halved/0.6 of That Open's default, no drag smoothing. OrbitMode's 300 m max distance raised.
  **3** viewer loads the models, cut/measure/properties. **4** issues in the model (pin, camera, box), greying.
- One .frag per IFC (only a changed IFC is reconverted). Issues find their element by IFC GlobalId (IFC-pinned:
  stored directly; Revit-pinned: Revit UniqueId → GlobalId by Revit's rule, tested only with made-up data).
- Files: `tools/issues/issues-visare.js` (panel, list hooks, detail row), `issues-frag.js` (viewer, `isf`),
  `issues-lattmodell.js` (settings, `ilm`), import map in `index.html` (incl. `potree-core` and
  `@thatopen/components-front` for measuring).

Rules from Mahdi:
- Test only with the IFCs in R&D "Project Files / Sample files / Models"
  (Building-Architecture/Hvac/Landscaping/Structural, Infra-Bridge/Landscaping/Plumbing/Rail/Road). All are in
  the model set "Samordningsutrymme test 1" (which mixes rvt and ifc). Not EQU-LYO10.ifc.
- Real projects pin issues on both IFC and Revit models in Model Coordination.
- Alignment for Revit-pinned issues: lock BIM Engine's IFC export to shared coordinates, and use the Revit
  model's `refPointTransformation` (AEC data, read without geometry; R&D L1D1 model: rotated about 118°, SWEREF
  in feet) to go internal → shared. Check with the element's id. BCF from Forma was considered and rejected
  as the alignment source (manual, goes stale, Autodesk's own conversion). BCF stays an optional export.

## Viewer tools (Mahdi, 2026-11-06): cut, properties, measure
Part 3 (Modellvy on Fragments) must include these, as toolbar buttons in the model bar:
- **Cut:** the issue's section box (six `OBC.Clipper` planes) can be dragged bigger or smaller, plus free cut
  planes (double-click a face to add one, drag to move, delete). "Återställ" returns to the issue's box.
- **Properties:** click an element → a side panel with name, IFC class, GlobalId, property sets and
  quantities, read from the .frag itself (`model.getItemsData`, with relations `IsDefinedBy`), so no ACC calls.
  Check in part 1 that the converter keeps the property sets (it should; test on Building-Architecture).
- **Measure:** distance between two points with snapping to edges and corners, shown in mm/m; area if cheap.
  That Open's measuring tools are in `@thatopen/components-front` 3.6.0, a library not yet loaded: add it to the
  import map (`?external=three,web-ifc,camera-controls,@thatopen/fragments,@thatopen/components`) and test
  that it loads in part 1a, like the others.
- The Autodesk fallback has the same three as built-in extensions (`Autodesk.Section`, `Autodesk.Measure`,
  the property panel), if they are wanted there too.

## Part 1a results (2026-11-06, R&D, Building-Architecture.ifc)
- **Libraries load on the live site** through an import map, dynamically imported from the classic scripts,
  in 0.6 s. The import map MUST include `"three/": "https://esm.sh/three@0.182.0/"`, because components imports
  `three/examples/jsm/...`. A failed module load is remembered for the page, so the map has to be complete
  before the first import.
  ```
  three → https://esm.sh/three@0.182.0          three/ → https://esm.sh/three@0.182.0/
  web-ifc → https://esm.sh/web-ifc@0.0.77        camera-controls → https://esm.sh/camera-controls@3.1.2?external=three
  @thatopen/fragments → https://esm.sh/@thatopen/fragments@3.6.0?external=three,web-ifc
  @thatopen/components → https://esm.sh/@thatopen/components@3.6.0?external=three,web-ifc,camera-controls,@thatopen/fragments
  IfcImporter.wasm = { absolute: true, path: 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/' }
  FragmentsManager.init(await OBC.FragmentsManager.getWorker())   (worker as Blob URL; works)
  ```
- **Conversion** (main thread, parseOnce): 216 kB IFC → 16 kB .frag in 0.47 s. The default importer classes
  are 149 element + 176 abstract classes. The .frag had 13 elements with geometry, while Autodesk shows 14
  leaf objects with an IfcGUID: one element is missing or is a non-geometry leaf. Check this per class in the
  next step.
- **Loading** the .frag: 0.76 s including the worker. `getCoordinates()` returned [-1,0,1, 1,0,0, 0,1,0].
- **Element ids:** in Autodesk's viewer, IFC models use running numbers ("0", "1"…) as `externalId`, NOT the
  GlobalId. The GlobalId is the property `IfcGUID` (getBulkProperties propFilter ['IfcGUID']). So an ACC issue
  on an IFC model will carry a running number as `externalId`, and the element's GlobalId must be read from
  the properties (or matched another way). Still to confirm with a real pinned issue.
- **Precision bug in today's Modellvy:** this IFC sits at about 729 km / 9 064 km (in mm) in Autodesk's
  coordinates. Loaded with `globalOffset: {0,0,0}` (as `isvLaddaModeller` does), geometry loses precision:
  sizes off by up to 0.6 m. With the viewer's own offset (default options) it is correct. The issue's
  `viewerState.globalOffset` says which offset Model Coordination used. Fix in the Autodesk path if it is kept.
- **Alignment, Autodesk (pin coordinates) → Fragments, exact for all 13 elements (0.000 m error):**
  `[x, y, z]` in mm (viewer + globalOffset) → metres → `(x, -y)` mirror → rotate 60° in plan → shift; height:
  `fragY = z/1000 − 1.3`. Autodesk keeps the IFC's site placement and rotation, while the .frag
  (COORDINATE_TO_ORIGIN) drops it. A 2D fit (rotation + shift, with the mirror) from matching GlobalIds
  reproduces it exactly, so the transform can be computed automatically per model and stored.

- **A real issue on an IFC model (R&D #19, "TEST - nål på IFC (Building-Architecture)", made 2026-11-06 in MC
  on the model set "Samordningsutrymme test 1"):** MC stores `externalId` = the element's IFC GlobalId
  (`1yP7NInQz5uQzbiOpVFFJr`, "house - gross volume"), `position` and the camera in full model coordinates in
  mm (729 008 825 / 9 063 998 349 / 2 767), and `viewerState.globalOffset` = 0. MC's own viewer works in metres
  with offset {729011.05, 9063982.46, 3.5}, but the issue is saved without it. `objectId` (39) is MC's own
  number and points to another element in our viewer, so never use it for IFC. For Fragments this is the easy
  case: `getLocalIdsByGuids([externalId])` finds the element directly, and the pin goes through the transform
  above. The Autodesk Modellvy was fixed the same day for both the precision bug and the element lookup
  (docs/PLAN-ARENDEVY.md, Viewer findings).

## Next
1. Check that the transform above puts #19's pin on "house - gross volume" in the .frag (expected, since the
   transform was fitted on the same model). Pin one on Building-Structural too.
2. Decide where the transform comes from without loading Autodesk's model. Candidates: compute it at conversion
   time from the IFC's own placement (IfcSite / IfcMapConversion read with web-ifc), or by a one-time fit
   during conversion. Test on 2–3 sample IFCs (Building and Infra, which have different placements).
3. Then report part 1a to Mahdi and continue with part 2 of the plan.

## Modellinställningar rebuilt (Mahdi, 2026-11-09)
Mahdi found picking IFCs too fiddly and could not see where the model was stored. Decisions: one IFC folder per
project (shared), its tree shown without folders that hold no IFC and without folders with "arkiv" in the name;
search and filters (in model / not / new version, date older or newer than 14 days, discipline code); the IFC
date shown on every file, yellow after 14 days; the discipline code is suggested from the file names and set per
project; the storage folder is always chosen, never automatic; upload from the computer removed; colours per model
from his palette (stored for the whole project).
- Parts 1+2 (one window: IFC folder, tree, tick and save, filters, dates, discipline code, files outside the IFC
  folder) built 2026-11-09 and tested locally with made-up folders (stub injected in the console): Arkiv folders,
  hidden folders and folders without IFC were left out, a 403 folder was counted, ticks/folder tri-state/shift,
  save with add + remove, a failed conversion with "Försök igen", the IFC folder chosen before the storage folder
  was written into the index, changing the IFC folder moved model files to the "outside" group, and the tree came
  back from IndexedDB on reopening. Tested signed in on R&D the same day: IFC folder "Project Files" read in 11 s
  (238 folders, 11 IFC, folders without IFC left out), saved in the index; "Öppna i ACC" opened the storage folder;
  Infra-Rail.ifc added (converted in 8 s) and removed again. Its .frag stays in "Modellvy (test 2)".
- Part 3 (colours) not built. Palette, measured from Mahdi's image (4 × 10 + "no colour"):
  `#000000 #3C3C3C #4D4D4D #666666 #808080 #999999 #BBBBBB #CCCCCC #DCDCDC #FFFFFF`
  `#A61A1A #916010 #5D822C #12437F #006EAF #268D82 #8558C5 #C72877 #A84A39 #523609`
  `#EC4A41 #FAA21B #87B340 #4679B9 #0696D7 #32BCAD #A76EF5 #E84396 #F26A52 #7D510E`
  `#F1A7A7 #FDDAA4 #B7D78C #A3BCDC #9BD5EF #84D7CE #C9A7F9 #FF9DCE #FFB3A6 #BB7A14`
  Known traps (checked in @thatopen/fragments 3.6.0): setColor, setOpacity and highlight share one highlight slot
  per element and merge, but `resetHighlight([id])` after a selection clears the model colour too, so re-apply it;
  `#0696D7` is also `ISF_VALD_FARG`, so pick another selection colour on such a model; `ilmUppdateraVyer` →
  `isfLaddaProjekt` ends with `isfGaTillArende`, so a colour save would move the camera back to the issue.
