# Parameterkontroll – rebuild plan

Status: **being built.** Revision 2, 2026-11-02.
The new tool replaces today's Modellkontroll tab once it has been verified. Until then the two run side by side, with the new one marked "beta".

### Build status

| Part | State |
|---|---|
| 0 Verify | **Mostly answered** (2026-11-02) with Autodesk's public sample models in R&D BIM ENGINE; see the answers in section 10. Still needs the test model for the cases the samples don't contain (unset numbers and Yes/No, non-shared nested families, phases and design options, unplaced rooms, a Swedish Revit file). |
| 1 Engine and calculation | **Done and verified on real data.** `parameterkontroll-berakna.js` (the calculation) has 24 tests with made-up data in `parameterkontroll-test.html`, all passing; it calculates 2 million values in about 0.2 s. `parameterkontroll-data.js` (fetching from ACC) was run in the live app against the sample models. Every number (140 category counts, 35 Revit and 16 IFC category/parameter combinations) equals an independent count from a full download of the same models, and the self-check is clean. One model takes about 10 s. Running several models at once, cancelling and the cache move to part 2, where they are first needed. |
| 2 Workspace and Modeller | **Done, tested locally** with made-up models (`parameterkontroll-stub.js`): Docs folder tree with whole-folder ticking, Model Coordination sets, preparation in the background, versions, discipline suggestions from file names, undo, draft in the browser. Not yet tested against real ACC data in the tab. |
| 3 Kategorier, Undantag and saving | **Done, tested locally**: category grid in three groups, project-wide rows (also ticked in models added later), copying between models, "Ny" markers, exemption rules, saving and opening in `parameterkontroll.json`, conflict choice when someone else saved in between. Change from the plan: exemption counts show after a run, because family/type names and values are only fetched then. The "nested components" switch is hidden until the test model shows such objects exist in ACC's data. |
| 4 Parametrar | **Done, tested locally**: shared parameter file (upload or ACC, UTF-16), wildcard rules, pasted list, catalogue feedback (found in X of Y models, near-miss names, data type, not found anywhere), which categories each requirement applies to, threshold, "räknas som tomt", requirement sets saved in the project and exported/imported as files. Change: cross-project reuse goes through export/import of a file, not by reading another project. |
| 5 Resultat | **Done, tested locally**: key figures, per model › category › parameter, element lists with ElementId (type gaps one row per type), per parameter and per discipline views, coverage panel with one-click "add category", out-of-date banner that fetches only what is new, quick add of category/parameter from the results. |
| 6 Excel | **Done, tested locally**: all sheets in 7.1, export dialog with size estimate, Swedish/English word list (`parameterkontroll-ord.js`, both languages checked to have the same keys), values written as text (`=A1-WA0` stays text), percentages rounded down, saving to ACC as a new version of a fixed file. ExcelJS 4.4.0 is loaded from jsDelivr when first used. |
| 7 History and PDF | **Done, tested locally**: measurement points in `parameterkontroll-historik-<id>.json` (manual, and automatic with the PDF or reports saved to ACC), trend with break markers and per-model change text, infographic preview in both languages, real PDF via jsPDF 2.5.2 + svg2pdf 2.2.4 (checked by rendering the produced PDF with pdf.js), 40 models flow onto a second page. Changes from the plan: Helvetica instead of Inter (built into every PDF reader, handles å ä ö, no font file to load); reopening an old measurement point and recalculating it is not built (needs fetching specific old versions instead of the latest). |
| 8 Finish | **Waiting on purpose.** The old Modellkontroll (and its GitHub saving) stays until the new tab has been tested with real data. The 3D view is not built. |
| 9 ACC issues | **Done, tested locally** with stubbed Issues calls: preview, one issue per model or discipline, type, assignee (person) and due date, issue IDs stored in the measurement point, a comment instead of a duplicate next time, closed issues reported, retry of only the failed ones. Assigning to a role or company is not offered here. Not yet tested against real ACC. |
| 10 Veckokontroll | **Not built.** It needs the run engine split from the tab's own state, so that Veckokontroll can run several saved setups by itself. Best done after the tab is verified with real data. |

**Still not verified against real data:** the tab itself. The calculation and the data layer were verified in the live app (part 1), but everything from part 2 on has only been run locally with made-up data (`parameterkontroll-stub.js`), because the live site only runs code that has been published.

### What changed in revision 2

- **Blind spots are shown.** A coverage panel lists everything the check does *not* cover (4.7, 5.5).
- **Nothing new slips through unnoticed.** When a saved setup is reopened, new categories, new models in a linked model set, new parameters caught by a rule and a new version of the parameter file are all highlighted (5.2–5.4).
- **Forgotten categories are pointed out.** A category outside the check whose elements already carry required parameters is flagged as "Kanske glömd".
- **Requirements that apply nowhere are reported** (a parameter that applies to no chosen category in a model) instead of passing silently.
- **The PDF is now made directly by the app.** One click, and it can be saved into ACC. The print dialog used in revision 1 cannot hand the file to the app, so it could never have been saved into ACC.
- **A third key figure: "klara element"** (elements with every required value).
- **The trend explains itself:** "modellen växte med 800 element, 2 340 fler värden ifyllda".
- **The name filter uses wildcards** (`RDS*`) instead of free patterns, which could freeze the page.
- **A run uses the choices as they were at the start.** Edits during a run mark the result as out of date.
- **Undo, a warning before unsaved changes are lost, and runs that continue when you switch tab.**
- **Excel** gets a sheet per model listing each element and its values, an export dialog, and a rounding fix so Excel never shows 100 % for 99.96 %.
- **A plan B data source** in case part 0 shows the property index cannot deliver type values.
- Part 0 has three more checks, and section 9 has 14 more risks.
- **Four extras you chose are now part of the plan:** exemption rules (4.8, part 3), ACC issues from gaps (7.3, part 9), Veckokontroll running a saved setup (7.4, part 10), and reports in English too (7.1, 7.2).

---

## 1. What the tool does

You pick Revit or IFC models in an ACC project, choose which categories in each model to check, and choose which parameters are required. The tool then counts, element by element, whether each required parameter **has a value**. It does not judge whether the value is correct.

From one check you get:

1. **A results view** showing model › category › parameter, for example "11 av 51 parametrar kompletta, 64 % av värdena ifyllda", plus a clear verdict per model and a list of what was not covered.
2. **An infographic PDF** for management: progress per discipline and per model, and the trend since earlier checks.
3. **An Excel audit report** that shows in detail what is filled in, what is missing and where, down to the element ID you can select in Revit.

Nothing in the tool is tied to RDS/IEC 81346 or to one project. A requirement set is just a named list of parameters and the categories they apply to, so the same tool works for RDS, CoClass, BSAB, an MMI level, or a client's own list.

---

## 2. Problems found in today's Modellkontroll

Found by reading `modellkontroll.js`, `modellkontroll-rapport.js` and `api.js`. The new tool must not repeat any of them.

| # | Problem today | Effect | New tool |
|---|---|---|---|
| 1 | Saved checks are written to `saved-checks.json` in this GitHub repo, which is **public**. | Project names, model names and element data can be read by anyone. | Everything is saved in the ACC project. No GitHub saving at all. |
| 2 | The check asks for an Autodesk app **Client ID and Client Secret** and keeps them in the browser. | An app secret that grants access to data ends up in a browser. | Uses your own sign-in only. It already works for the 3D viewer and the property catalogue. |
| 3 | A parameter counts as "OK" for the whole model if **a single element anywhere** has a value. | Nearly every gap is hidden. 1 filled door out of 4,000 elements shows green. | Counted per element, per category. |
| 4 | Element counts include the "folders" in the model tree (category, family and type nodes, the model root). | Totals are too high and percentages are wrong. | A strict definition of an element (4.1). |
| 5 | Only the first 3D view is read. | Elements outside that view are never checked. | Reads the whole model through ACC's property index, not one view. |
| 6 | For large models Autodesk refuses the property download (over 20 MB) or answers "still processing". The code then crashes on missing data. | Big models fail with an unclear error. | Only the needed columns are asked for, every Autodesk answer is checked, and each status has its own message. |
| 7 | Type parameters are probably not seen on the instances. | A parameter filled in on the type is reported as missing. | The value is read from the instance first, then from its type (to verify in part 0). |
| 8 | Starting a new run, re-running one model or switching project while a check runs writes into the same results list. | Results from two runs get mixed. | Every run has its own ID, can be cancelled, and late answers from an old run are ignored. |
| 9 | Ticking a folder only takes files from subfolders that were already opened. | Models in unopened subfolders are silently left out. | The whole subfolder tree is read first, then "Lägg till 14 modeller?" is shown. |
| 10 | File names are put into the page without escaping. | An odd file name can break the page. | All text from ACC is escaped. |
| 11 | The "report" is a print page. There is no Excel, no history and no disciplines. | Not useful for follow-up. | Excel, PDF and history (section 7). |
| 12 | The 3D viewer greys out every element that was not checked, and is not set up for ACC EU. | Misleading colours, and it may fail to load. | Optional part 8, fixed if it is rebuilt. |

**Separate from the rebuild:** a requirement spreadsheet that was used as a preset in the old tool is checked into this public repo. If it comes from a client, it should be removed from the repo and from its history.

---

## 3. Key decisions

| Decision | Why |
|---|---|
| **Revit (RVT, including cloud models) and IFC only.** DWG and NWD are dropped. | Only these two have reliable categories and parameters. NWD files mix many sources. |
| **Data source: ACC's Model Properties index** (the same service the data type check already uses), not the per-view property download. A plan B is defined (section 8). | It covers the whole model and is built once per file version. It can answer "only these categories, only these columns" on the server, so large models work. |
| **Never start translations.** If a version has no 3D data the tool says so and links to the file in ACC. | It only reads. It never changes anything in ACC except its own save files and the reports you choose to save there. |
| **Latest version by default.** If a model set holds an older version, that is shown and can be picked instead. | A parameter audit is normally about the current state. |
| **A check is pinned to exact versions.** Every result, Excel file and PDF states the version number and date of each model. | Results can be reproduced and compared. |
| **Requirements and setup are separate things** (section 6). | The requirement list can be reused across projects. The model and category choices belong to one project. |
| **One calculation feeds everything.** Screen, Excel, PDF and history all come from the same result. | The numbers can never differ between outputs. |
| **The engine is separate from the screen.** | Another tab, for example Veckokontroll, can later run a saved setup without the user interface. |
| **Data type mismatch is a warning, not a fail.** | You asked for an existence check. A wrong data type is still worth showing, because it usually means a parameter with the same name but a different GUID. |
| **Saved only in ACC**, in a folder you pick once per project (same pattern as Veckokontroll and Granskningar). | Client data stays in the client's project. |
| **Excel with colours via ExcelJS**, loaded only when you export. | The free SheetJS version already in the app cannot write colours. |
| **PDF generated by the app as vector graphics** (jsPDF with svg2pdf, loaded only when used). The page is drawn as one graphic, shown on screen as a preview, then turned into the PDF. | One-click download, sharp at any zoom, identical on every computer, and the same file can be saved into ACC. |
| **Wildcards (`RDS*`, `*kod`), not free text patterns,** in all name filters. | Easy to understand, and a badly written pattern cannot freeze the browser. |

---

## 4. How the numbers are defined

This is what makes the tool trustworthy. The definitions are shown in the app and printed in both reports under "Så räknas siffrorna".

### 4.1 What counts as an element

- **Counted:** a placed object in the model with its own ID, belonging to a category.
- **Never counted:** the tree "folders" (category, family and type nodes), and the model root.
- **Nested components inside a family** (non-shared nested families, for example a handle inside a door) are not counted by default, because you cannot fill in their parameters from the project. A switch, "Räkna med inbäddade komponenter", turns them on.
- **Shared nested families, curtain panels and mullions, stair parts and railings** are real elements in Revit and are counted under their own category.
- **Linked models are not part of the host file.** Add the linked file itself if it should be audited.
- **Phases, demolished elements and design options:** the rule is decided in part 0. Every element ACC includes is counted, and the run log says how many each rule left out.
- **Elements exempted on purpose** by an exemption rule (4.8) are not counted, but they are always counted and listed separately.

### 4.2 When a parameter "has a value"

- **Text:** not empty after trimming spaces, including non-breaking spaces. `" "` is empty.
- **Number, length, area, integer:** has a value when Revit holds a value. **0 is a value**: ACC stores it (confirmed). ACC leaves empty values out entirely, so an unset number has no value. The test model confirms that Revit does not export an unset number as 0.
- **Yes/No:** "Nej" is a value: ACC stores it as false (confirmed). Unset is empty. The test model confirms that an unset Yes/No is not exported as Nej.
- **Instance before type:** if the instance has the parameter, its value is used. Otherwise its type's value is used. The report shows which (Instans/Typ).
- **Same name in several property groups** (common in IFC property sets): the element has a value if any one of them has one.
- **Optional "räknas som tomt" list** per requirement set, for example `-`, `?`, `TBD`, `xxx`. Empty by default. This is not value validation, only a way to stop placeholders from counting as filled. The Excel "Värden" sheet shows the most common values either way, so placeholders are easy to spot.

### 4.3 Name matching

- A parameter is found by its **exact name**. Before comparing, Swedish letters are normalised (å typed in two different ways is treated as the same å) and spaces at the ends are trimmed.
- **Near misses are flagged, not counted.** `RDS kod`, `rds-kod` and `RDS_Kod` against the required `RDS-kod` gives "Liknande namn finns i modellen: RDS kod". This catches the most common real-world error.
- **A required name found in no model at all** gets a hint: if it is a built-in Revit parameter, ACC may list it under its English name ("Comments", not "Kommentarer"). Part 0 confirms the language.
- GUIDs cannot be checked. No Autodesk API exposes a shared parameter's GUID. The data type check is the closest substitute.

### 4.4 Status per model › category › parameter

| Status | Meaning |
|---|---|
| **Komplett** | Every element in the category has a value. |
| **Delvis** | Some elements have a value (e.g. 312 of 540). This also proves the parameter has been added to the category, so the rest are empty. |
| **Inget värde** | The parameter exists in the model, but no element in the category has a value. It is either empty everywhere, or not added to this category. |
| **Finns inte i modellen** | The parameter is not in the model at all. It has not been added to any category. |
| **Ej krav** | The parameter is not required for this category (5.4). |

*Changed after part 0.* Revision 2 split "Tom" (added but empty) from "Saknas" (not added). ACC leaves empty values out of its data entirely, so the two can't be told apart within a category. What can be known is whether the parameter exists in the model at all, because ACC's field list includes parameters without any value. So "Finns inte i modellen" is a certain model-setup job for the BIM coordinator. "Inget värde" is a data-entry job, or a setup job for that one category. The report says so in those words.

### 4.5 Key figures

- **Ifyllnadsgrad (fill rate)** = filled values ÷ required values. Required values = each element × each parameter required for its category. This is the progress figure in the PDF and the trend.
- **Kompletta krav** = category/parameter pairs with status Komplett ÷ all required pairs. At category level this is "11 av 51 parametrar kompletta".
- **Klara element** = elements with every required value ÷ all elements checked. This is the figure modellers relate to: "1 240 av 1 400 element är klara".
- **Verdict per model:**
  - *Uppfyller kraven*: every required pair is complete. The threshold is 100 % by default and can be lowered per requirement set, e.g. 95 %.
  - *Uppfyller inte*: at least one pair is below the threshold.
  - *Ej bedömd*: nothing to assess (no chosen category has any elements). This is never shown as "passed", so 0 of 0 cannot become 100 %.
  - *Kunde inte läsas*: no 3D data, index failed, no access, and so on, with the reason.
- **Rounding:** percentages are rounded down to one decimal, so **100 % is only shown when it really is complete**. Above 0 but below 0.1 shows as "<0,1 %". Numbers use Swedish format (64,3 %, 12 450). Excel gets the rounded-down number too, because Excel's own display would round 99.96 % up to 100.0 %.

### 4.6 Built-in self checks

Every run checks its own arithmetic. If a check fails, the app shows "Räknefel – kontakta Mahdi" instead of wrong numbers:

- filled + empty + missing + excluded = number of elements, for every model/category/parameter;
- the categories' element counts add up to the model total;
- the element count from the category step equals the element count from the check itself (two separate reads).

Every number on screen can be clicked to show the list of elements behind it.

### 4.7 Coverage – what the check does *not* cover

A check is only as good as its scope, so the blind spots are always listed, on screen, in Excel ("Om kontrollen") and on the PDF:

- **Täckning** = elements checked ÷ elements in the model, for example "Kontrollen omfattar 82 % av modellens element". Only chosen categories and categories with 3D geometry count, so sketch lines, reference planes and materials don't drown the figure.
- Categories with elements that were not chosen, with counts.
- **"Kanske glömd":** a category that was not chosen but whose elements already carry required parameters ("Cable Trays: 34 element har RDS-kod men kategorin ingår inte").
- Elements left out by a rule (nested components, phases, design options), with counts.
- Elements exempted by your own exemption rules, per rule, with counts.
- Models that could not be read, and why.
- Required parameters that apply to no chosen category in a model.
- Wildcard rules that matched nothing.

### 4.8 Exemption rules (Undantag)

Some elements should legitimately not be checked: existing buildings, reference objects, temporary objects. Without a way to exempt them, some models could never reach 100 %.

- **A rule leaves out elements on purpose.** It can match on:
  - family name or type name, with wildcards (`*Ref*`, `Befintlig*`);
  - a parameter value: *är*, *innehåller*, *börjar med*, *är tom*, *är inte tom* (e.g. `Status är Befintlig`);
  - phase, if part 0 shows phases are in ACC's data.
- **Each rule applies to** all models, or chosen models and/or categories, and has a short reason that is printed in the reports ("Befintliga byggnadsdelar ingår inte i uppdraget").
- **Exempted elements are never hidden.** They are counted per rule and model, shown under coverage, listed in Excel (sheet "Undantag"), and the PDF footer says "312 element undantagna enligt 2 regler".
- **A rule that matches nothing** in a model is reported ("Regeln matchade inga element i K-modellen"), because it usually means a misspelt name.
- **A rule that exempts a large share** of a category (over 25 % by default) gets a warning, because it may be hiding real gaps.
- Rules belong to the setup, because naming conventions differ between projects. They are copied when a setup is copied.

---

## 5. The workspace and the four steps

### 5.1 Layout: a workspace, not a wizard

- A **left rail** with the four steps, each always clickable, with a live summary:
  `1 Modeller · 6 valda` / `2 Kategorier · 38 val i 6 modeller` / `3 Parametrar · 51 krav` / `4 Resultat · kört 10:42`.
- A **top bar** with the setup name, "Spara" (marked when there are unsaved changes), "Öppna sparad", "Ångra", and the **"Kör kontroll"** button. The button is always visible. When it cannot run yet, it says why ("Välj minst en kategori").
- A **scope counter** that updates as you click, before anything is run: "6 modeller · 14 820 element · 51 parametrar ⇒ 311 400 värden att kontrollera".
- **Nothing ever resets when you move between steps.** Removing a model only removes that model's choices.
- The first time, "Nästa" buttons guide you 1→4. Later you can jump freely.
- **Opening a saved setup** shows what changed since last time before anything else: "Senast körd 2026-10-26 · 3 modeller har nya versioner · 1 ny modell i model set · 2 nya kategorier" and a **"Kör med senaste versionerna"** button. The weekly re-check is one click.

### 5.2 Step 1 – Modeller

- Two sources, as today: **Docs folders** and **Model Coordination model sets**. Only RVT and IFC are shown.
- Ticking a folder reads its whole subtree first, then asks "Lägg till 14 modeller från mappen?". A model set can be added whole or per model.
- **A setup can be linked to a model set.** When it is reopened, models added to or removed from the set are shown ("2 nya modeller i model set – lägg till / ignorera"). Nothing is added without your click.
- **List of chosen models:** name, RVT/IFC badge, version (v12 · 2026-10-29), source, **discipline**, and preparation status. Two files with the same name in different folders also show their folder. The same model added as both RVT and IFC gets a warning, because it would be counted twice in the discipline totals.
- **Disciplines are free labels** that you set per model (A, K, VS, EL, Mark …). Suggestions come from parts of the file name, the folder name, and labels already used in the project. You can set several models at once. No list is hard-coded. Models without a label are grouped as "Ej angiven" in the PDF.
- **Preparation starts as soon as a model is added**, in the background: latest version → 3D data present? → property index ready (built if needed) → list of categories with element counts. By the time you open step 2, the counts are usually ready.
- Clear status per model: "Förbereder…", "Klar · 42 kategorier", "Saknar 3D-data – öppna i ACC", "Indexering misslyckades – försök igen", "Ingen behörighet till filen", "Nyare version finns (v13)".

### 5.3 Step 2 – Kategorier

- **One matrix:** rows = categories, columns = models. Each cell shows a tick box and the element count ("Walls · 1 234"). A cell is empty where the model has no such elements. **Only categories that actually have elements are listed.** The header row and the category column stay in place while scrolling. With many models, the columns are grouped by discipline and can be folded.
- **Project-wide choices**, two ways:
  - ticking a row selects that category in every model that has it. A switch decides whether it also applies to models added later;
  - non-physical categories that apply to the whole project are listed when ACC includes them: for Revit e.g. Project Information, Levels, Rooms/Spaces, MEP systems; for IFC e.g. IfcProject, IfcSite, IfcBuilding, IfcBuildingStorey. Part 0 confirms which ones ACC includes. If Project Information is not in ACC's data, the app says so ("Saknar du en kategori?") instead of silently leaving it out.
- Revit and IFC models are shown in separate groups, because their category names differ (Walls vs IfcWall). Category names are shown as ACC gives them, without the "Revit " prefix.
- **Three groups of categories** (decided after part 0, because Revit also counts internal objects as elements; the sample model has 140 categories, including 3,210 sketch lines and 1,037 reference planes):
  - *Modellkategorier*: categories with 3D geometry. Open by default.
  - *Projektgemensamma*: Project Information, levels, grids, rooms, spaces, areas, zones, systems. Open by default.
  - *Övriga*: annotations, views, sheets, sketches, materials and other internal objects. Folded by default.
- **Tools:** search, "visa bara valda", sorting by name or count, "kopiera kategorival från modell A till B, C". Every change can be undone.
- **New since last time:** when a saved setup is reopened, categories that have appeared in a model since the last run are marked "Ny" so you decide about them, rather than them silently staying outside the check.
- **A category saved in a setup but now empty in a newer version** is kept and shown as "0 element i v13". It is never silently dropped.
- **Undantag** (4.8): a panel under the matrix where exemption rules are added. It shows live how many elements each rule takes out, per model, before anything is run.

### 5.4 Step 3 – Parametrar

Three ways to build the requirement list. They can be combined, and duplicates are merged:

1. **Shared parameter file** (.txt from Revit, upload or from ACC; the current reader is reused because it handles UTF-16 correctly). Afterwards you filter by group, data type or name and tick what applies. "Spara i ACC" for the file stays. **If the file in ACC gets a new version**, reopening the setup says "Parameterfilen har en ny version: 3 nya, 1 borttagen parameter – uppdatera kravprofilen?".
2. **Filter on parameter names found in the models** ("blindly by filter"), with wildcards: `RDS*`, `*kod`, `RDS*kod`. You see live which names match and in how many models each one occurs. The filter is saved as a **rule**, so a parameter added to the models later is included automatically and marked "Ny".
   *Built-in warning:* a filter can only find parameters that exist in at least one chosen model. A parameter missing from every model can never show up as missing this way. To catch that, use a file or a pasted list.
3. **Paste a list of names**, one per line (from a requirement document or an Excel column). A line with a wildcard becomes a rule.

**Which categories each parameter applies to:**

- Default: **every required parameter applies to every chosen category.**
- Refine per parameter or in a parameters × categories grid with bulk actions, e.g. "Brandklass gäller bara Doors och Walls".
- Helper button, never automatic: "Föreslå utifrån modellerna", which ticks the categories where the parameter is already added in at least one model. The app warns that this hides categories where the parameter was forgotten.
- **After the first run**, if many parameters show "Saknas" in many categories, the results page asks: "33 parametrar saknas helt i vissa kategorier. Gäller de inte där?" and links to the grid. A first run full of red because of a too-wide scope is a known trap.
- **A required parameter that ends up applying to no chosen category in a model** is reported as a coverage gap (4.7).

**Instant feedback before running**, from the property catalogue: per parameter "finns i 4 av 6 modeller", data type mismatches ("filen: TEXT, modellen: NUMBER"), near-miss names, and names found nowhere.

### 5.5 Step 4 – Resultat

- **Top:** overall fill rate, klara element, "4 av 6 modeller uppfyller kraven", models that could not be read, coverage, run time, versions, and the change since the last saved check ("+6,2 procentenheter sedan 2026-10-19").
- **Per model** (expandable card): verdict, fill rate, klara element, discipline, version, then a **category table**: elements, "11 av 51 parametrar kompletta · 7 delvis · 33 saknas", fill-rate bar.
- **Per category** (expand): one row per parameter with status, "312 av 540 element", Instans/Typ, warnings (data type, near-miss name), and **"Visa element"**. That lists the elements without a value, with family, type and Revit ElementId (copy button, for Revit's *Select by ID*). Long lists load 200 rows at a time, so the page stays fast.
- **Coverage panel** ("Utanför kontrollen") with everything in 4.7. Each item has a one-click fix where one exists ("Lägg till kategorin").
- **Pivot switch:** *Per modell* / *Per parameter* (which requirements are weakest across all models) / *Per disciplin*.
- **Filters:** "visa bara avvikelser", search.
- **Changing scope from here:** "+ Kategori" and "+ Parameter" open a side panel. You don't have to go back to an earlier step.
- **Out-of-date banner:** if anything changed after the run (including edits made while it was running), "2 kategorier och 1 parameter har ändrats sedan körningen – Uppdatera". Only the missing data is fetched. Usually a few seconds, often instant.
- **Actions:** Exportera Excel · Skapa PDF · Spara mätpunkt · Spara rapporterna i ACC · Skapa ärenden (7.3). If the run is not in the history: "Körningen är inte sparad som mätpunkt".
- **A model that fails never stops the others.** Each model has its own "Försök igen".

### 5.6 Moving back and forth

The tool keeps three things apart:

1. **Model data** fetched from ACC, kept per model version.
2. **Your choices**: models, categories, parameters, disciplines.
3. **The calculation**, which turns 1 + 2 into results.

Because of that, changing a choice only recalculates. It never refetches what is already there and never loses other choices. Adding a parameter later only fetches that one parameter's data. A new model version is detected and offered, but never swapped in silently.

- **A run uses the choices as they were when you pressed "Kör"**, so editing during a run is safe. Afterwards the result is marked out of date.
- **A run continues if you switch to another tab** in the app. A message appears when it is done. Switching project stops it, after a warning.
- **Ångra** undoes the last change to your choices (several steps back).
- **Draft autosave:** your choices (not model data) are kept in the browser per project. After a reload or an accidental click away, you get "Fortsätt där du slutade?".
- **Unsaved changes** to a saved setup trigger a warning before switching project or opening another setup.

### 5.7 Feel and finish

These are rules for every screen, so the tool feels premium:

- Every click gets a visible response at once. Slow work shows progress per model. The screen is never blank and never jumps around while data arrives.
- Every error message says what happened **and what to do next** ("Saknar 3D-data. Öppna filen i ACC en gång och försök igen").
- Anything that removes choices can be undone. Anything that writes to ACC is confirmed.
- One visual language: ACC colours in the app, BIM Engine colours (charcoal and green) in the reports. Each status has a colour, a symbol and a word, so it reads for colour-blind users and in grey print.
- Short Swedish texts in plain words. A folded "Så fungerar det" box on each step for first-time users.

---

## 6. Saving

Two kinds of saved objects:

| Object | Contains | Reusable |
|---|---|---|
| **Kravprofil** (requirement set) | name, description, parameters (from file, wildcard rules, pasted names), which categories each applies to, pass threshold, "räknas som tomt" list, link to the parameter file in ACC | **Across projects**: export and import as a file, or import directly from another project you have access to |
| **Uppsättning** (check setup) | name, which requirement set, models (by ACC file ID, not version, so a renamed file is still found), linked model set, discipline per model, categories per model, the "nested components" switch, exemption rules, report language | Within the project |

- Stored as `parameterkontroll.json` in an ACC folder you pick the first time. Later it is found automatically with ACC's folder search, and if there are several copies the newest wins and the others are reported. This is the same pattern as Granskningar.
- The file is **read again right before every save**, so a teammate's changes in the meantime are kept. Each setup and requirement set is saved as its own entry. If someone else changed the same entry after you opened it: "Ändrad av Anna 14:02 – skriv över / spara som kopia".
- **History:** `parameterkontroll-historik-<uppsättning>.json`, one entry per measurement point. Each entry holds:
  - the summary numbers (per model × category and per model × parameter: elements, required values, filled values);
  - versions, date, who ran it, and whether it was run from Parameterkontroll or Veckokontroll;
  - a copy of the setup and requirement set as they were (a few kB);
  - the IDs of any ACC issues created from it (7.3).

  That is about 30–40 kB per point, with no element data. Because the choices and the exact versions are stored, **any old point can be reopened and recalculated with identical numbers.**
- **When a point is saved:** when you click "Spara mätpunkt", and automatically when you create the PDF or save the reports to ACC, so a report given to management always matches the trend. If there are several points on the same day, the trend uses the latest. A point can be hidden from the trend ("Dölj i trend") without being deleted.
- **Reports in ACC:** "Spara rapporterna i ACC" saves the Excel file and the PDF into a folder you choose, under a fixed name per setup. Every save becomes a new version of the same file, so ACC's version history becomes the archive.
- **Missing write permission** on the folder: clear message, and you can still run and download. Only saving is disabled.
- **A model in a setup that no longer exists** (deleted or moved): "Modellen hittas inte" with *ta bort* / *byt mot annan modell*. **A teammate without access to one model** sees "Ingen behörighet" for that model only. The rest runs.
- Old checks saved on GitHub are **not** migrated. They should be deleted from the repo.

---

## 7. Outputs

### 7.1 Excel audit report

File name `Parameterkontroll_<projekt>_<ÅÅÅÅ-MM-DD_HHmm>.xlsx`. On every sheet the header row is frozen and filtering is on. Statuses are colour-coded with the status word also written. Percentages are real numbers with % format, and dates are real dates.

| Sheet | Content |
|---|---|
| **Sammanfattning** | Project, date, who ran it, requirement set, threshold, the "Så räknas siffrorna" definitions; one row per model with version, discipline, elements, required values, filled values, fill rate, klara element, coverage, verdict. |
| **Modell–kategori** | One row per model × category: elements, "11 av 51 kompletta", delvis, tom, saknas, fill rate, klara element. |
| **Parametrar** | One row per model × category × parameter: status, with value / without value / total, %, Instans/Typ, data type found, warnings (near-miss name, data type). |
| **Åtgärdslista** | One row per **gap**, made for handing out work: model, category, family, type, Revit ElementId, IFC GlobalId / external ID, element name, parameter, problem ("Tomt värde" / "Parametern saknas på elementet"). Gaps on a type parameter get **one row per type** ("Typen X saknar värde – påverkar 240 element") instead of 240 rows. |
| **Element – \<modell\>** | One sheet per model, made for the modeller fixing it: one row per element, one column per required parameter. A filled cell shows the value, a missing value is a highlighted empty cell, and a parameter that is not required is grey. By default only elements with at least one gap are included. |
| **Undantag** | Each exemption rule with its reason and counts per model and category, then one row per exempted element (model, category, family, type, ElementId, the rule that took it out). |
| **Värden** | The most common filled values per model × category × parameter, with counts (up to 50 per parameter, then "+ 1 830 andra unika värden"). Shows placeholders and odd formats without the tool judging them. |
| **Krav** | The requirement set: parameter, data type, GUID and group (from file), applies to which categories, description. |
| **Om kontrollen** | Data source and versions, element rules, coverage and everything outside the check (4.7), skipped models and why. |

**Export dialog:** "Bara element med brister / Alla element" (default: bara brister), "Ta med värdeförteckning" (default: on), "Spara även i ACC", and **Språk: svenska / English** (default: the setup's report language). It shows the estimated size and warns about very large files before they are made.

**Two languages:** all report texts (sheet names, headings, status words, the "Så räknas siffrorna" definitions, the explanations) live in one Swedish/English word list from the start, used by both Excel and PDF. Number format follows the language (64,3 % / 64.3 %). Dates are always written 2026-11-02. Model, category and parameter names are never translated. The app's own screens stay in Swedish.

Safeguards:

- **Model values are always written as text.** RDS codes begin with `=`, `-`, `+` or `++`, which Excel would otherwise read as formulas or numbers.
- Excel allows about 1 million rows per sheet. A sheet that would exceed that is split, with a note.
- Sheet names are kept under 31 characters and made unique (two models with similar names). File names are cleaned of characters Windows does not allow. Names are sorted in Swedish order (å, ä, ö last).

### 7.2 Infographic PDF (management)

One A4 landscape page, plus a second page when there is history to show. You see a preview on screen first, then "Ladda ner PDF" or "Spara i ACC".

- **Header:** project, date, requirement set ("Kravprofil: RDS IEC 81346"), the big overall fill rate, klara element, "4 av 6 modeller uppfyller kraven", coverage.
- **One card per discipline:** fill rate as a ring, then each model as a bar with its percentage, verdict symbol and change since last time (▲ +6,2). A model that could not be read is listed in the card as "kunde inte läsas" and left out of the discipline figure, never silently dropped.
- **Top 5 gaps:** "RDS-kod saknas på 1 240 element (32 %)". These are the actions for management.
- **Trend (page 2):** fill rate per discipline and per model over saved points, with a one-line explanation of each change ("K-modellen: 2 340 fler värden ifyllda, modellen växte med 800 element"). A point where a model could not be read is drawn hollow. **A break marker with its reason** is drawn when the requirement set, the categories or the models changed between two points, so a jump is never mistaken for progress. With no history yet: "Trend visas från nästa sparade kontroll."
- **Footer:** one sentence of method ("Mäter om värden finns, inte om de är korrekta"), coverage, exempted elements, model versions, date.
- **Language:** svenska or English, from the same word list as the Excel file.
- **Layout safety:** there is a compact layout for many models. Above about 30 models the cards show discipline totals plus the five weakest models, with "se Excel för alla". It is tested with 1, 6, 30 and 60 models.
- **Graphics kept simple** (flat shapes, no shadows or effects), because that is what converts reliably to vector PDF. Inter is embedded as the font (its licence allows it), so Swedish letters and the look are identical everywhere. BIM Engine logo and colours.

### 7.3 ACC issues from gaps

From the results page, "Skapa ärenden" turns the gaps into ACC issues, so the follow-up happens where the project team already works.

- **One issue per model or per discipline** (you choose). The title is "Parameterkontroll: 1 240 värden saknas – K-modell". The description holds the fill rate, klara element, the top gaps, the requirement set, the model version, and a link to the Excel report.
- **The Excel report is saved in ACC first**, so the issue can point to it. Whether the file can be attached to the issue itself, or only linked, is checked in part 9.
- Issue type, assignee (person, role or company), watchers and due date are picked with the Issues tab's existing helpers.
- **A preview lists every issue before anything is created.** Nothing is written until you confirm. This is the same pattern as Vyhantering.
- **No duplicates on the next run.** The created issue IDs are stored in the measurement point. Next time, the tool offers "Uppdatera befintliga ärenden" (a comment with the new numbers, e.g. "1 240 → 610 värden saknas") instead of creating new ones. Closed issues are reported, and a new one is only created if you ask.
- **If creating fails halfway**, the result lists what was created and what was not. "Försök igen" only does the missing ones.
- Tested only in R&D BIM ENGINE.

### 7.4 Veckokontroll runs a saved setup

- In Veckokontroll's settings you pick one or more Parameterkontroll setups. When the weekly check is run, it runs those setups with the latest versions, saves a measurement point automatically, and writes the fill rate and verdicts into the weekly log.
- **Nothing runs by itself.** The app has no server, so the trend grows when someone runs Veckokontroll, not on a timer. The log says so.
- If a setup cannot run (a model could not be read, or the setup was deleted), the weekly log says so for that setup and the rest of Veckokontroll continues.
- Points from Veckokontroll are marked as such in the history, so the trend shows where each point came from.

---

## 8. Engine notes (technical, for the build)

- **Per model, during preparation:** resolve version → check 3D data (manifest) → request the index for **all models in one call**, then wait with growing intervals (up to about 10 minutes, can be cancelled) → read the field catalogue → one query that only returns category, type link and parent link, to count elements per category. If part 0 shows the index can count on the server, that query returns totals instead of rows.
- **When running the check:** one query per model, limited to the chosen categories and to the columns of the chosen parameters (every field key whose name matches, across all property groups), plus the columns that exemption rules look at, plus the type objects needed for type values. A light extra query looks for required parameters in categories that were *not* chosen, for the "Kanske glömd" hint.
- **Cache per version (index ID).** An index never changes for a given version, so data fetched once can be reused for the whole session. Adding a parameter fetches only its columns.
- **At most 3 models fetched at the same time.** On 429 (too many requests), wait as Autodesk says and retry.
- **Large answers** are read line by line as they arrive, not as one big text, and only the needed values are kept. If part 0 shows very large payloads, the reading and the calculation move to a background worker so the page never freezes. Target: recalculating after a click under 0.2 s for 1 million values.
- **Signed download links** (if the answers come via S3) must not carry the login header, the same rule as the S3 upload in `api.js`.
- **Every run has an ID, a cancel signal and a frozen copy of the choices.** A project switch, "Avbryt", or a new run stops the old one, and anything that arrives late is thrown away.
- **Token expiry** is already handled by `apsFetch` (refresh on 401).
- **Revit ElementId** is taken from the last part of the element's UniqueId (the external ID), read as a hexadecimal number. Part 0 checks this against Revit.
- **The calculation is one pure function:** model data + choices → results, with no fetching inside it. It can be tested in a local copy with made-up data containing every tricky case.
- **One entry point for other tabs:** "run this saved setup with the latest versions and return the result". Veckokontroll uses it. It has no user interface of its own and reports progress through a callback, the same way `listReviews` reports pages today.
- **Report texts in one Swedish/English word list.** No report text is written directly into the Excel or PDF code.
- **Plan B**, if part 0 shows the index lacks type links or misses elements: Model Derivative's paged property query (up to 1,000 objects per page) per 3D view, merged and de-duplicated by external ID, with the object tree used for type links. Slower, but the rest of the tool is unchanged because only the data layer differs.
- **Suggested files** (prefix `pk`, state in `_pk`):
  - `parameterkontroll.js`: tab, rail and steps;
  - `parameterkontroll-data.js`: fetching, cache, run engine;
  - `parameterkontroll-berakna.js`: the calculation and its test data;
  - `parameterkontroll-spara.js`: ACC saving, history, draft, undo;
  - `parameterkontroll-excel.js`;
  - `parameterkontroll-pdf.js`;
  - plus index query helpers in `api.js`.

  ExcelJS, jsPDF and svg2pdf are loaded from a CDN with pinned versions, only when first used (same approach as pdf.js in Ritningsgranskning).

---

## 9. Risks, edge cases and how they are handled

| Situation | Handling |
|---|---|
| Model has no 3D data, translation failed or is still running | Status per model with the reason and a link to the file in ACC. Never counted as passed or failed. |
| Index takes long or fails | Progress shown; cancel; "Försök igen". The other models continue. |
| Newer version uploaded while you work | Badge "Nyare version finns (v13)"; you decide. Results always state the versions used. |
| Model set holds an older version than Docs | Shown, and the version can be chosen. Latest is the default. |
| New model added to a linked model set | Shown on reopening, added only on your click. |
| New category appears in a model | Marked "Ny" on reopening; listed under coverage until you decide. |
| Category in a saved setup has no elements in the new version | Kept, shown as "0 element", left out of the verdict, listed in the report. |
| Category not chosen, but its elements carry required parameters | "Kanske glömd" hint with one-click add. |
| Requirement file has the same name twice (two GUIDs) | Warning on loading. The tool matches by name and cannot tell them apart. |
| Parameter file in ACC gets a new version | Offered as an update of the requirement set, with what changed. |
| Same name, different data type in the model | Warning "troligen annan parameter med samma namn". Numbers unchanged. |
| Near-miss names (case, space, dash, underscore, letters typed differently) | Flagged as "Liknande namn finns". Not counted as found. |
| Required built-in parameter written in Swedish | Hint that ACC may use the English name. Language confirmed in part 0. |
| Wildcard rule matches nothing | Coverage warning "RDS* matchar inga parametrar". |
| Parameter scoped so it applies to no chosen category in a model (e.g. only Revit categories, model is IFC) | Coverage warning per model; never a silent pass. |
| First run all red because every parameter applies to every category | The results page points to the scope grid and the "Föreslå" helper. |
| Parameter only on the type | Value taken from the type. Report says "Typ". Excel groups the gap per type. |
| Unset number or Yes/No looks like 0/No | Decided by part 0. If ACC cannot tell them apart, the app states it openly for those data types instead of guessing. |
| Nested non-shared components | Excluded by default, with a switch. The count of excluded objects is shown. |
| Linked Revit models | Not included in the host. Stated in "Om kontrollen". Add the linked file itself. |
| Phases, demolished elements, design options | Rule fixed in part 0. The number left out is shown per model. |
| Project Information or Rooms not in ACC's data | Not listed (only real categories are), with a "Saknar du en kategori?" note explaining why. |
| Same model added as both RVT and IFC | Warning: it would be counted twice in discipline totals. |
| Two files with the same name in different folders | Folder shown in lists. Excel sheet names made unique. |
| Mixed Revit and IFC in one check | Separate category groups. Fill rate and the PDF still compare them, because the measure is the same. |
| Very large models (100 000+ elements) | Only the needed columns, line-by-line reading, limited parallel work, background worker if needed, element lists loaded 200 rows at a time. |
| Excel row limit, or a very large Excel file | Size estimate and warning in the export dialog. Default "bara brister". Sheets split if needed, with a note. |
| Values beginning with `=`, `+`, `-` (RDS codes) | Always written as text in Excel. |
| 99.96 % filled | Shown as 99,9 % on screen, in the PDF and in Excel. 100 % only when complete. |
| 0 required values ("0 of 0") | "Ej bedömd", never "Uppfyller kraven". |
| Editing choices while a run is going | The run uses the choices from its start; the result is then marked out of date. |
| Project switch or new run during a run | The old run is cancelled and its late answers are ignored. A warning first if there are unsaved changes. |
| Two people edit the same saved setup | Re-read before save, merge per entry, explicit conflict choice. |
| No write permission in the ACC folder | Run and download still work. Saving shows why it is disabled. |
| Teammate lacks access to one of the models | "Ingen behörighet" for that model only. The rest runs. |
| A model could not be read in one point of the history | Hollow point in the trend; the discipline card says so. |
| Requirement set, categories or models changed between points | Break marker in the trend with the reason. |
| Model grew a lot between points (fill rate drops although work was done) | Trend text separates "fler värden ifyllda" from "fler element". |
| A badly written filter pattern | Not possible: wildcards only. |
| An exemption rule matches nothing (misspelt name) | Reported per model. |
| An exemption rule is so broad it hides real gaps | Warning when it exempts over 25 % of a category; exempted counts on screen, in Excel and on the PDF. |
| Running "Skapa ärenden" twice | Created issue IDs are remembered; the second time offers to update the existing issues. |
| Creating issues fails halfway | List of created and not created; retry only the missing ones. |
| Someone expects Veckokontroll to run by itself | The log and the settings say it runs when Veckokontroll is run. |
| A report text missing in one language | The word list is checked: every text must exist in both languages, otherwise the build part is not done. |
| Model removed or moved in ACC | "Modellen hittas inte" with remove/replace. |

---

## 10. Part 0 – verify the unknowns first

Some facts can only be confirmed with real ACC data. They must be settled **before** the calculation is built, and **only in R&D BIM ENGINE**.

**To verify:**

1. How an **unset** text, number, length, integer and Yes/No parameter appears in ACC's data, compared with `""`, `" "`, `0` and `Nej`.
2. Whether type parameters sit on a separate type object, with a link from each instance, or are copied onto the instances.
3. How the model tree is built: which objects are category, family and type nodes, and how nested components, groups, curtain walls and stairs appear.
4. Which project-wide categories exist in the data (Project Information, Levels, Grids, Rooms, Spaces, MEP systems), and whether Project Information's parameters are there.
5. Whether elements in all phases, demolished elements and secondary design options are included.
6. **Language** of category names and built-in parameter names: English ("Revit Walls", "Comments") or the language of the Revit installation.
7. IFC: what the category field holds (IFC class or Revit category), whether IFC types are separate objects, what the external ID is (GlobalId?), and how property sets appear.
8. Index queries: how the waiting works, size limits, paging, whether answers are compressed, whether downloads go through signed links, rate limits, and how long indexing takes for a large model.
9. **Whether the index can count elements per category on the server**, or whether every row must be fetched to count.
10. That ElementId derived from the UniqueId matches Revit's *Select by ID*.
11. The format of a link that opens the model version in ACC.
12. **Unplaced and not-enclosed rooms:** whether they are in ACC's data. A Revit schedule lists them, so any difference from Revit must be explained, not ignored.
13. That jsPDF with svg2pdf draws a test infographic correctly (Swedish letters, embedded font, rings and bars), before the real PDF is designed.

**Answers so far** (2026-11-02, Autodesk's public sample models "Snowdon Towers Sample Architectural.rvt" and "Building-Architecture.ifc" in R&D BIM ENGINE):

1. **Empty values are left out entirely**: no `""`, no null, in the full data or in query answers. "Mark" exists on every Revit element but is present on only 1,111 of 15,623 elements. 0 and false are stored. The field list includes parameters with no value anywhere (109 of 1,574 in the sample). Consequence: the new statuses in 4.4.
2. **Both.** Each element links to a separate type object (`instanceof_objid`), and type values are also copied onto the elements: 173,088 values identical, 1,797 only on the type, 122 different, where an instance parameter has the same name as a type parameter. Element first, then type, is right.
3. **Tree**: category node → family node → type node → element. The links (`parent`, `instanceof_objid`) use the object's `lmvId`; `compositeId` uses `svf2Id`. Curtain panels and mullions, and shared nested families, are children of their host element but real elements with their own ElementId. No non-shared nested component appeared as an object (the test model confirms).
4. **Project Information exists** as its own object, with its parameters. Levels (no ElementId in the data, but derivable), Grids, Rooms (54, no 3D geometry), Areas, HVAC Zones, Phases and Design Options are also there.
5. Every element has "Phase Created", "Phase Demolished" and "Design Option" as parameters, so exemption rules can use them. Whether demolished elements and secondary options are included: test model.
6. Category and built-in parameter names are English ("Revit Walls", "Comments") **in this English sample**. Each element also has a language-independent category number (`CategoryId`). A Swedish Revit file in the test model settles the language question.
7. **IFC**: no category field. The class is in `Element/IfcClass`, the GlobalId in `Element/IfcGUID`, and `externalId` is a tree path, not a GUID. The tree's class level ("IfcWall") and type level carry copies of the storey's values, and are skipped by `Item/Type` = Category/Family. Type property sets are copied onto the element as their own groups ("Pset_SlabCommon (IFC Type)"). There is no type link.
8. **Index**: one call starts or checks the index for several versions at once. Both samples were done within 30 s, and the answer says when to ask again (`retryAt`). Downloads are plain JSON lines on the same host, with the normal login header. **Queries work**: filter plus chosen columns. `$in`, `$eq`, `$and`, `$or` and `$notnull` were used; `s.props.<field>`, `s.propsIgnored.<field>`, `s.lmvId` and `s.geomHash` all work as columns. Each query takes about 3 s, and empty columns are left out of the row.
9. Counting per category with one small query over all elements works: 25,824 rows, 0.7 MB, 3 s. No server-side counting was needed.
10. **ElementId is in the data** (`__revit__/ElementId`) for most elements. Working it out from the UniqueId gives the same number (door 678093).
11. Not checked yet.
12. Test model.
13. Not checked yet (part 7).

**Also found:**
- ACC moves some values out of the normal list into `propsIgnored`: GUIDs (including IfcGUID), file paths, ElementId, the links, and the occasional ordinary parameter ("Coefficient of Utilization"). The data layer reads values from both places. Without that, a requirement like "IfcGUID" would wrongly show 0 of 142.
- Some values are lists (a door "Width" stored as `[3, 3]`). They are handled.

**Test model to set up in R&D BIM ENGINE (your action):**

A small Revit file, for example `PK-TEST-A.rvt`, with a test shared parameter file containing:
`PK_Text_Instans` (Text, instance), `PK_Text_Typ` (Text, type), `PK_Tal` (Number), `PK_Langd` (Length), `PK_Heltal` (Integer), `PK_JaNej` (Yes/No), bound to Walls, Doors, Rooms, Generic Models and Project Information.

- **10 walls:** 4 with text filled in, 2 cleared after typing, 1 with a single space, 1 with `-`, 2 never touched. `PK_Tal`: 3 set to 0, 3 set to 5, the rest never touched. `PK_JaNej`: 3 Ja, 3 Nej, the rest never touched. Fill in the built-in **Comments** on 3 walls.
- **Doors:** two types. Type A has `PK_Text_Typ` filled in, type B is empty. 3 instances of each.
- **One of each:** curtain wall, model group with 2 walls, a family with a shared nested family, a family with a non-shared nested family, a wall in phase Existing, a demolished wall, an element in a secondary design option, a linked Revit model.
- **Rooms:** 3 placed rooms, 1 unplaced room and 1 not-enclosed room.
- **One category with elements but no test parameters** (e.g. Floors), to test coverage and the "Kanske glömd" hint. Put `PK_Text_Instans` on one Cable Tray or Pipe, and leave that category out of the check.
- **Project Information:** `PK_Text_Instans = "Testprojekt"`.
- **For exemption rules:** a family whose name contains `Ref` with 2 placed instances, and 2 walls with `Comments = Befintlig`.
- **Traps:** a project parameter named `PK Text Instans` (near-miss name) on Generic Models, and a *Text* parameter named `PK_Tal` on Doors (same name, other data type).
- **Ground truth:** one Revit schedule per category with the element count and the parameters, so every number the tool shows can be checked against Revit.
- Upload to R&D BIM ENGINE. Also export the same model as **IFC** (IFC4 with shared parameters / user-defined property sets) and upload it. Put both in a model set.

**Done when:** each point above has a written answer in this file, and the element and value rules in section 4 are confirmed or adjusted.

---

## 11. Build parts

One part at a time, each verified before the next. Real data is tested on the live site in R&D BIM ENGINE only. The new tab is visible as "Parameterkontroll (beta)" until part 8.

| Part | Content | Done when |
|---|---|---|
| **0 Verify** | Section 10. | All answers written down; plan A or plan B chosen. |
| **1 Engine and calculation** | Preparation, index queries, cache, cancellation, frozen choices per run, the calculation with self checks and coverage, a minimal table of results. | Every number for the test model matches the Revit schedules **exactly**, or the difference is explained; the made-up test data with every tricky case passes; cancel and project switch leave no mixed results. |
| **2 Workspace and Modeller** | Tab, rail, top bar, scope counter, Docs and Model Coordination sources, linked model set, disciplines, background preparation, draft autosave, undo, unsaved-changes warning. | Choosing models in R&D BIM ENGINE shows correct versions and statuses; a page reload restores the choices; undo restores a removed model with its choices. |
| **3 Kategorier, Undantag and saving** | Matrix, project-wide row ticks, copy between models, "Ny" markers, exemption rules with live counts, saving setups to ACC (folder choice, search, re-read before save, conflicts), "Kör med senaste versionerna". | A saved setup reopens with every choice in place; a second browser's change is not overwritten; a new category in a new version is marked; the `Ref` family and the `Befintlig` walls are exempted with correct counts, and a misspelt rule is reported. |
| **4 Parametrar** | File (with new-version detection), wildcard rules, pasted list, which categories each applies to, catalogue feedback, near-miss, data type and coverage warnings, requirement sets with export and import. | All three sources give the same result for the same names; every trap in the test model is flagged. |
| **5 Resultat** | Cards, category and parameter tables, element lists, coverage panel with "Kanske glömd", pivots, filters, side panel for adding categories and parameters, out-of-date banner, retry per model, runs continuing across tabs. | Adding a parameter after a run updates in place without losing anything; every number opens its elements; the Floors and Cable Tray traps show under coverage. |
| **6 Excel** | All sheets in 7.1, the export dialog, the Swedish/English word list. | Opens without repair warnings in Excel; totals match the screen; RDS-like values stay text; 99.96 % shows as 99,9 %; colours and filters work; the English file has no Swedish text left except names from the models. |
| **7 History and PDF** | Measurement points (manual and automatic), reopening old points, trend with explanations and break markers, infographic preview in both languages, PDF download, saving reports to ACC. | The PDF looks identical on two computers; 1, 6, 30 and 60 models lay out correctly; a reopened point gives identical numbers; a break shows after the requirement set changes. |
| **8 Finish** | Optional 3D view with colours (only checked elements coloured, ACC EU set up), remove the old Modellkontroll and GitHub saving, update `CLAUDE.md`. | The old tab is gone; nothing in the app writes to GitHub any more. |
| **9 ACC issues** | 7.3: preview, create per model or discipline, link or attach the Excel, update instead of duplicate, partial-failure retry. | In R&D BIM ENGINE: issues are created as previewed; a second run offers updates and creates no duplicates. |
| **10 Veckokontroll** | 7.4: choose setups in Veckokontroll's settings, run them with the weekly check, automatic points, log lines. Done when Veckokontroll's own build has reached its run-and-log stage. | A weekly run in R&D BIM ENGINE adds one point per setup and a log line; a broken setup does not stop the weekly check. |

---

## 12. Not in the first version

- Checking whether values are correct (formats, allowed lists, RDS syntax). The engine already has the values, so it can be added later as an optional layer.
- Requirements that depend on another value ("required only if X is filled in").
- Requirement levels ("krav" vs "önskvärt").
- A discipline per category inside one model (for a combined installation model). In version 1 a model has one discipline.
- Weighting each category equally in the fill rate. In version 1 every value counts the same, and the per-category view and "Top 5 gaps" show where a small but important category lags.
- Remembering fetched model data between sessions in the browser, for faster reopening.
- Mapping Revit categories to IFC classes as one row.
- DWG and NWD.
- Writing values back to models, or starting translations.
- Comparing values across models (e.g. the same system code in two disciplines).

---

## 13. Decisions made on your behalf (say if any is wrong)

1. New tab name **Parameterkontroll**, beside the old tool until part 8.
2. RVT and IFC only.
3. **Fill rate** is the progress figure. **100 % of each requirement** is the pass rule, with an adjustable threshold. Klara element and coverage are shown next to it.
4. A data type mismatch warns but does not change the numbers.
5. Type values count for their instances. Nested non-shared components are excluded unless switched on.
6. Latest version by default.
7. **PDF generated directly by the app** (changed from revision 1). Excel via ExcelJS.
8. History is saved when you click "Spara mätpunkt", and automatically when a PDF is created or reports are saved to ACC (changed from revision 1).
9. Wildcards, not free patterns, in name filters.
10. A linked model set suggests new models but never adds them by itself.
11. Exemption rules belong to the setup, not to the requirement set, and warn above 25 % of a category.
12. ACC issues are created one per model or per discipline, never one per element.
13. The app's own screens stay Swedish; only the reports get the English option.
