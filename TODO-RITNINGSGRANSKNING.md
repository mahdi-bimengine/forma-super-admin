# Ritningsgranskning, status och nästa steg

Fliken granskar ett ritningspaket mot Riktlinjer BIM för granskning av
bygghandlingar, avsnitten Dokument och Ritning. Modellpunkterna ingår inte, de
hör hemma i Modellkontroll.

Allt körs i webbläsaren. Ritningarna laddas aldrig upp någonstans.

## Vad som är byggt

| Fil | Ansvar |
| --- | --- |
| `ritningsgranskning.js` | Fliken, state i `_gr`, tre steg, filväljaren |
| `ritningsgranskning-las.js` | pdfjs från CDN, textlager, sidformat, förteckning, kompass |
| `ritningsgranskning-regler.js` | Mallhärledning och samtliga kontroller |
| `ritningsgranskning-rapport.js` | Resultatvy, utskriftsrapport, CSV |

Utöver det: `getItemDownload` i `api.js`, fyra rader i `app.js` och fyra
script-taggar i `index.html`.

Steg 1 väljer ritningar, från projektets Data Management filtrerat på PDF eller
genom att släppa en zip. Steg 2 låter dig kryssa av kontrollpunkter. Steg 3 kör
granskningen och visar resultatet.

## Hur reglerna vet vad som är rätt

Ingen inbyggd bild av hur en ritningsmall ska se ut. Bladen delas i grupper efter
sidformat, och positioner som har exakt samma text på nästan alla blad i gruppen
är mallens fasta text. Deras utbredning nere till höger är ritningshuvudet.
Etikett skiljs från värde på teckenstorleken. Sedan är paketet sitt eget facit:
ett fält ifyllt på 46 av 48 blad och tomt på två är en anmärkning.

Därför fungerar granskningen även på projekt med en annan ritningsmall och en
annan namnstandard, utan konfiguration. Priset är att en grupp med färre än tre
blad inte kan jämföras med sig själv, och att ett fel som finns på samtliga blad
ser ut som mallen. Sådant syns i stället en gång, när mallen granskas.

## Testat

Mot Granskning nr 133, 113 blad i två formatgrupper:

* 6 fel, 20 varningar, 91 blad utan anmärkning, identiskt med Node-verktyget
* 6,1 sekunder i webbläsaren, fyra blad läses parallellt
* Trasig PDF ger en anmärkning i stället för att välta granskningen
* Kryssa av en kontrollpunkt och kör om tar 25 ms, bladen läses inte om
* CSV och utskriftsrapport innehåller rätt data

## Kvar att göra

1. **Prova ACC-vägen.** Nedladdning från Data Management är byggd men aldrig
   körd skarpt, den kräver inloggning. `getItemDownload` i `api.js` hämtar
   lagrings-id från filens senaste version och begär en signerad länk från OSS.
   Går något fel syns det som ett felmeddelande i steg 3.

2. **Bestäm om resultat ska sparas i repot.** Modellkontroll sparar sina
   kontroller via GitHub-PAT. Ritningsgranskningen exporterar i stället rapport
   och CSV. Vill du ha historik är det samma mönster att lägga till.

3. **Handlingsförteckning som egen fil.** Idag jämförs paketet mot de
   ritningsnummer som står på bladen. Att kunna ladda upp den riktiga
   förteckningen skulle göra D2 skarpare. Fältet finns i `_gr.forteckning`,
   det saknas bara ett filval i steg 2.
