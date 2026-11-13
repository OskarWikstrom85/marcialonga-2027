// =====================================================================
//  Marcialonga 2027 – konfiguration
//  Fyll i dina egna värden nedan. Se README.md för steg-för-steg-guide.
// =====================================================================
window.APP_CONFIG = {
  // --- Supabase (krävs för delad lagring, bilder och redigering) ---
  // Hämtas i Supabase: Project Settings -> API
  SUPABASE_URL: "",       // t.ex. "https://abcd1234.supabase.co"
  SUPABASE_ANON_KEY: "",  // den publika "anon"-nyckeln (lång sträng)

  // --- MapTiler (VALFRITT) ---
  // Lämna tomt så används gratis, nyckelfria kartlager (satellit + terräng).
  // Lägg in en gratis MapTiler-nyckel för snyggare karta med ortnamn.
  // Hämtas på https://www.maptiler.com/ -> Account -> API keys
  MAPTILER_KEY: "",

  // --- Startvy ---
  START: { lng: 11.58, lat: 46.38, zoom: 10.5, pitch: 62, bearing: 20 },

  // Höjdöverdrift (1 = verklig, >1 = mer dramatiska berg)
  TERRAIN_EXAGGERATION: 1.4,
};
