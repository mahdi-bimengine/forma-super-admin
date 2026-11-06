# Modellvy on light Fragments models (That Open)

Why: Modellvy (docs/PLAN-ARENDEVY.md) loads Model Coordination views through Autodesk's viewer, and real
views are too heavy. Mahdi's decision (2026-11-05/06): convert chosen IFC files (always available, every
project exports IFC) to That Open's Fragments (.frag), store them in ACC, and show issues on those, placed
BCF-style from the ACC issue itself. Full plan with risks: `C:\Users\MahdiElMahdi\.claude\plans\cozy-meandering-biscuit.md`
(parts 1–4). Fragments can only be made from IFC, not from .rvt.

Rules from Mahdi:
- Test only with the IFCs in R&D "Project Files / Sample files / Models"
  (Building-Architecture/Hvac/Landscaping/Structural, Infra-Bridge/Landscaping/Plumbing/Rail/Road). All are in
  the model set "Samordningsutrymme test 1" (which mixes rvt and ifc). Not EQU-LYO10.ifc.
- Real projects pin issues on both IFC and Revit models in Model Coordination.
- Alignment for Revit-pinned issues: lock BIM Engine's IFC export to shared coordinates, and use the Revit
  model's `refPointTransformation` (AEC data, read without geometry; R&D L1D1 model: rotated about 118°, SWEREF
  in feet) to go internal → shared. Check with the element's id. BCF from Forma was considered and rejected
  as the alignment source (manual, goes stale, Autodesk's own conversion). BCF stays an optional export.

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
