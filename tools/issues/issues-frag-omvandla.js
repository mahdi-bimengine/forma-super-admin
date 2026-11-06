// issues-frag-omvandla.js — Web Worker (modul) som gör om en IFC till That
// Opens Fragments (.frag). Körs i bakgrunden så att sidan inte fryser medan
// stora filer görs om (issues-lattmodell.js startar den).
//
// Import map:en i index.html gäller inte i workers, så biblioteket hämtas med
// full adress. ?deps låser three och web-ifc till samma versioner som sidan;
// web-ifc:s .wasm måste vara exakt samma version som dess JS.
//
// In:  { bytes: ArrayBuffer }   (överförs, kopieras inte)
// Ut:  { typ: 'framsteg', andel 0–1 } … och till sist
//      { typ: 'klar', frag: ArrayBuffer } eller { typ: 'fel', text }

import * as FRAGS from 'https://esm.sh/@thatopen/fragments@3.6.0?deps=three@0.182.0,web-ifc@0.0.77';
import * as WEBIFC from 'https://esm.sh/web-ifc@0.0.77';

// Klasser med geometri som importören hoppar över som standard. IfcSpatialZone
// saknades i R&D:s Building-Architecture, och ett ärende satt just på en sådan
// (#19, 2026-11-06). De övriga är IFC4.3-klasser för infra. Ändras listan ska
// ILM_FORMAT i issues-lattmodell.js räknas upp, så att modellerna görs om.
const EXTRA_KLASSER = [
  'IFCSPATIALZONE', 'IFCEXTERNALSPATIALELEMENT', 'IFCFACILITY', 'IFCFACILITYPART', 'IFCRAILWAY', 'IFCRAILWAYPART',
  'IFCROADPART', 'IFCBRIDGEPART', 'IFCMARINEFACILITY', 'IFCMARINEPART', 'IFCSIGNAL', 'IFCKERB', 'IFCMOORINGDEVICE',
  'IFCNAVIGATIONELEMENT', 'IFCLIQUIDTERMINAL', 'IFCDEEPFOUNDATION', 'IFCCAISSONFOUNDATION', 'IFCIMPACTPROTECTIONDEVICE',
  'IFCREINFORCEDSOIL', 'IFCMOBILETELECOMMUNICATIONSAPPLIANCE', 'IFCCONVEYORSEGMENT', 'IFCDISTRIBUTIONBOARD',
  'IFCBOREHOLE', 'IFCGEOTECHNICALSTRATUM', 'IFCGEOSLICE', 'IFCVEHICLE', 'IFCELEMENTASSEMBLY',
];

self.onmessage = async e => {
  try {
    const importer = new FRAGS.IfcImporter();
    importer.wasm = { absolute: true, path: 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/' };
    for (const namn of EXTRA_KLASSER) if (typeof WEBIFC[namn] === 'number') importer.classes.elements.add(WEBIFC[namn]);
    // En genomläsning i stället för två: mindre minne, samma resultat.
    importer.parseOnce = true;
    let senast = 0;
    const frag = await importer.process({
      bytes: new Uint8Array(e.data.bytes),
      raw: false,
      progressCallback: p => {
        const nu = Date.now();
        if (nu - senast < 250) return;
        senast = nu;
        const andel = Number(p) > 1 ? Number(p) / 100 : Number(p);
        if (Number.isFinite(andel)) self.postMessage({ typ: 'framsteg', andel });
      },
    });
    const ut = frag.buffer.byteLength === frag.byteLength ? frag.buffer : frag.slice().buffer;
    self.postMessage({ typ: 'klar', frag: ut }, [ut]);
  } catch (err) {
    self.postMessage({ typ: 'fel', text: String(err?.message || err) });
  }
};
