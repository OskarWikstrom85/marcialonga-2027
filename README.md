# Marcialonga 2027 – 3D-karta

En fristående webbsida med en 3D-karta över loppsträckan (Fiemme- och Fassadalen).
Klickbara hållpunkter med text och bild. Du kan logga in och redigera direkt i sidan;
ändringarna syns för alla som har länken – ingen inloggning krävs för besökare.

Teknik: **MapLibre GL JS** (3D-terräng + satellit) och **Supabase** (delad databas,
bildlagring och inloggning för redigering). Allt du behöver betala för: ingenting –
både Supabase och Netlify har gratisnivåer som räcker gott för det här.

---

## Snabböversikt (ca 15 min)

1. Skapa ett gratis Supabase-projekt och kör `schema.sql`.
2. Klistra in Supabase-URL och nyckel i `config.js`.
3. Ladda upp mappen till Netlify (dra och släpp).
4. Lägg till din Netlify-adress i Supabase (för inloggningslänken).
5. Klart – dela länken. Logga in för att redigera.

---

## 1. Supabase

1. Skapa konto och nytt projekt på https://supabase.com (välj region **Europe**, t.ex. Frankfurt).
2. Öppna **SQL Editor → New query**, klistra in hela innehållet i `schema.sql` och tryck **Run**.
   Det skapar tabellen, säkerhetsregler, bildlagring och sex exempelpunkter.
3. Öppna **Project Settings → API** och kopiera:
   - **Project URL** (ser ut som `https://xxxx.supabase.co`)
   - **anon public**-nyckeln (en lång sträng)
4. (Inloggning är redan på.) Gå till **Authentication → Providers** och kontrollera att
   **Email** är aktiverat. Magic link fungerar direkt.

## 2. Fyll i `config.js`

Öppna `config.js` och klistra in dina värden:

```js
SUPABASE_URL: "https://xxxx.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
```

> Den här "anon"-nyckeln är avsedd att ligga publikt i webbläsaren – det är ok.
> Säkerheten ligger i reglerna från `schema.sql`: alla kan läsa, bara inloggade kan ändra.

**Valfritt – snyggare karta med ortnamn:** skaffa en gratis nyckel på
https://www.maptiler.com (Account → API keys) och lägg i `MAPTILER_KEY`.
Lämnar du den tom används gratis, nyckelfria lager (satellit + terräng).

## 3. Testa lokalt (valfritt)

Öppna en terminal i mappen och kör något av:

```bash
npx serve .
# eller
python3 -m http.server 8000
```

Öppna sedan adressen som visas (t.ex. http://localhost:8000).
Öppna **inte** `index.html` direkt via `file://` – kartans arbetstrådar kräver en webbserver.

## 4. Lägg upp på nätet (Netlify)

Enklast:

1. Gå till https://app.netlify.com/drop
2. Dra hela projektmappen dit.
3. Du får direkt en adress, t.ex. `https://marcialonga-2027.netlify.app`.
   (Du kan byta namn under **Site settings → Change site name**.)

## 5. Koppla ihop inloggningen med adressen

För att inloggningslänken (magic link) ska leda tillbaka till din sida:

1. I Supabase: **Authentication → URL Configuration**.
2. Sätt **Site URL** till din Netlify-adress.
3. Lägg samma adress under **Redirect URLs**.

Klart! Dela länken med vem du vill.

---

## Så redigerar du

1. Klicka **✎ Redigera** uppe till höger → ange din e-post → klicka på länken i mejlet.
   Du kommer tillbaka inloggad.
2. Klicka **✎ Redigera** igen för att slå på redigeringsläget.
3. Lägg till punkt: öppna listan (☰) → **+ Lägg till punkt** → klicka på kartan.
4. Flytta punkt: dra markören på kartan.
5. Redigera/ta bort: klicka på en markör → ändra rubrik, text, typ, ladda upp bild → **Spara**.

Besökare ser allt direkt, utan att logga in.

---

## Byta ut rutten mot en exakt GPX

Rutten i `route.js` är en **approximation**. Har du en GPX-fil för banan:

1. Konvertera GPX → GeoJSON (t.ex. på https://mapbox.github.io/togeojson/ eller `tokml`/`togeojson`-verktyg).
2. Ersätt `coordinates`-listan i `route.js` med din `LineString` (format `[longitud, latitud]`).

Eller skicka GPX:en till mig så lägger jag in den åt dig.

---

## Filer

| Fil | Innehåll |
|-----|----------|
| `index.html` | Sidans struktur |
| `styles.css` | Utseende |
| `config.js` | Dina nycklar och startvy |
| `route.js` | Loppsträckan + exempelpunkter |
| `app.js` | Kart- och redigeringslogik |
| `schema.sql` | Databas + lagring för Supabase |
