// =====================================================================
//  Marcialonga 2027 – konfiguration
//  Fyll i dina egna värden nedan. Se README.md för steg-för-steg-guide.
// =====================================================================
window.APP_CONFIG = {
  // --- Supabase (krävs för delad lagring, bilder och redigering) ---
  // Hämtas i Supabase: Settings -> API Keys
  SUPABASE_URL: "https://xunkuomfkgjrnkawuqwf.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_DJ4IBXXHTkIamxDc17ZkJw_xWm22hrF",

  // --- Vinterlägen (VALFRITT) ---
  // Baskartan är alltid gratis satellit + terräng. Nedan tänder extra vinterlägen.
  //
  // MapTiler-vinterkarta (tecknad vinterstil): lägg in en gratis MapTiler-nyckel.
  // Hämtas på https://cloud.maptiler.com/account/keys/
  MAPTILER_KEY: "CTSNwIm79royRVW3drD7",
  //
  // Äkta vintersatellit (Sentinel-2): en WMS-URL-mall med {bbox-epsg-3857}.
  // Skapas via ett gratis Copernicus-konto (Sentinel Hub WMS-instans).
  // Ex: "https://sh.dataspace.copernicus.eu/ogc/wms/DIN_INSTANS?SERVICE=WMS&REQUEST=GetMap&LAYERS=TRUE-COLOR&FORMAT=image/jpeg&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&TIME=2026-02-01/2026-02-28&MAXCC=20"
  SENTINEL_WMS: "https://sh.dataspace.copernicus.eu/ogc/wms/0bf49875-3f5d-4d66-a389-2daa974250ca?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=TRUE-COLOR&FORMAT=image/jpeg&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&TIME=2026-02-01/2026-03-15&MAXCC=40&PRIORITY=leastCC",

  // --- Startvy ---
  START: { lng: 11.58, lat: 46.38, zoom: 10.5, pitch: 62, bearing: 20 },

  // Höjdöverdrift (1 = verklig, >1 = mer dramatiska berg)
  TERRAIN_EXAGGERATION: 1.4,
};
