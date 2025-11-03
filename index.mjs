import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import animeSearch from "anime-search";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// App setup 
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const DB_API_BASE = "https://dragonball-api.com/api";

// Utility functions
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${await res.text()}`);
  return res.json();
}

const normalize = (v) =>
  (v ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// extract possible origin names
const originNames = (c) => {
  const bag = new Set();
  if (c?.originPlanet?.name) bag.add(c.originPlanet.name);
  if (c?.planet) bag.add(c.planet);
  if (c?.origin) bag.add(c.origin);
  if (c?.originPlanetName) bag.add(c.originPlanetName);
  Object.values(c || {}).forEach((v) => {
    if (typeof v === "string" && /planet/i.test(v)) bag.add(v);
  });
  return Array.from(bag).filter(Boolean);
};

// parse numeric and worded power levels
const parsePower = (val) => {
  if (val == null) return -Infinity;
  const raw = String(val).trim();
  if (/^\s*(inf(inity)?|∞)\s*$/i.test(raw)) return Infinity;
  const WORD_SCALE = {
    thousand: 1e3,
    million: 1e6,
    billion: 1e9,
    trillion: 1e12,
    quadrillion: 1e15,
    quintillion: 1e18,
    sextillion: 1e21,
    septillion: 1e24,
    octillion: 1e27,
    nonillion: 1e30,
    decillion: 1e33,
    googol: 1e100,
    googolplex: Infinity,
  };
  const nrm = normalize(raw);
  if (WORD_SCALE[nrm] != null) return WORD_SCALE[nrm];
  const wordMatch = raw.match(/([\d.,]+)\s*([a-zA-Z]+)/);
  if (wordMatch) {
    const base = Number(wordMatch[1].replace(/,/g, ""));
    const word = normalize(wordMatch[2]);
    if (!Number.isNaN(base) && WORD_SCALE[word] != null)
      return base * WORD_SCALE[word];
  }
  const num = Number(raw.replace(/,/g, ""));
  if (Number.isFinite(num)) return num;
  if (/\bgoogolplex\b/i.test(raw)) return Infinity;
  if (/\bgoogol\b/i.test(raw)) return 1e100;
  return -Infinity;
};

// Routes

// Home Route
app.get("/", (req, res) => {
  res.render("home", { title: "Dragon Ball Hall of Fame" });
});

// Characters (popular list)
const POPULAR_NAMES = ["Goku","Vegeta","Gohan","Piccolo","Frieza","Trunks","Bulma","Krillin"];
app.get("/characters", async (req, res) => {
  try {
    const results = await Promise.all(
      POPULAR_NAMES.map(async (name) => {
        const url = `${DB_API_BASE}/characters?name=${encodeURIComponent(name)}`;
        const data = await getJSON(url);
        const arr = Array.isArray(data) ? data : data.items || [];
        return arr[0];
      })
    );
    res.render("characters", { title: "Most Popular Characters", characters: results.filter(Boolean) });
  } catch (err) {
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// Character details
app.get("/character/:id", async (req, res) => {
  try {
    const url = `${DB_API_BASE}/characters/${encodeURIComponent(req.params.id)}`;
    const character = await getJSON(url);
    res.render("character", { title: character?.name || "Character", character });
  } catch (err) {
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});

// Search
app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const race = (req.query.race || "").trim();
  const gender = (req.query.gender || "").trim();
  const affiliation = (req.query.affiliation || "").trim();
  const originPlanetQuery = (req.query.originPlanet || "").trim();
  const sort = (req.query.sort || "name_asc").trim();

  try {
    const url = `${DB_API_BASE}/characters?limit=200`;
    const raw = await getJSON(url);
    const all = Array.isArray(raw) ? raw : raw.items || [];

    const nQ = normalize(q);
    const nRace = normalize(race);
    const nGender = normalize(gender);
    const nAff = normalize(affiliation);
    const nOrigin = normalize(originPlanetQuery);

    let results = all.filter((c) => {
      if (nQ && !normalize(c.name).includes(nQ)) return false;
      if (nRace && normalize(c.race) !== nRace) return false;
      if (nGender && normalize(c.gender) !== nGender) return false;
      if (nAff && !normalize(c.affiliation).includes(nAff)) return false;
      if (nOrigin) {
        const origins = originNames(c).map(normalize);
        if (!origins.some((o) => o.includes(nOrigin))) return false;
      }
      return true;
    });

    const s = (v) => normalize(v);
    const originOf = (c) => originNames(c)[0] || "";

    const sorters = {
      name_asc: (a, b) => s(a.name).localeCompare(s(b.name)),
      name_desc: (a, b) => s(b.name).localeCompare(s(a.name)),
      power_desc: (a, b) =>
        parsePower(b.ki ?? b.powerLevel) - parsePower(a.ki ?? a.powerLevel),
      origin_asc: (a, b) => s(originOf(a)).localeCompare(s(originOf(b))),
      race_asc: (a, b) => s(a.race).localeCompare(s(b.race)),
      affiliation_asc: (a, b) => s(a.affiliation).localeCompare(s(b.affiliation)),
      gender_asc: (a, b) => s(a.gender).localeCompare(s(b.gender)),
    };

    results = results.sort(sorters[sort] || sorters.name_asc);

    res.render("search", {
      title: "Search",
      q,
      results,
      filters: { race, gender, affiliation, originPlanet: originPlanetQuery, sort },
    });
  } catch (err) {
    res.status(500).render("error", { title: "Error", message: err.message });
  }
});


// Anime route (Cruncyroll)
app.get("/anime", (req, res) => {
  const animes = [
    {
      title: "Dragon Ball",
      image: "https://cdn.noitatnemucod.net/thumbnail/300x400/100/cbe9999ab6606992fb000566ebf5d99b.jpg",
      url: "https://www.crunchyroll.com/series/G8DHV7W21/dragon-ball",
    },
    {
      title: "Dragon Ball Z",
      image: "https://cdn.noitatnemucod.net/thumbnail/300x400/100/2ac32c050b4dff7747fcc7f64c01edbd.jpg",
      url: "https://www.crunchyroll.com/series/G9VHN9PPW/dragon-ball-z",
    },
    {
      title: "Dragon Ball GT",
      image: "https://cdn.noitatnemucod.net/thumbnail/300x400/100/aa150fd93887a7cbdc4be0882584dc53.jpg",
      url: "https://www.crunchyroll.com/series/G4PH0WXXM/dragon-ball-gt",
    },
    {
      title: "Dragon Ball Super",
      image: "https://cdn.noitatnemucod.net/thumbnail/300x400/100/6908f85a069414d40530042f2cdd8c8a.jpg",
      url: "https://www.crunchyroll.com/series/GR19V7816/dragon-ball-super",
    },
    {
      title: "Dragon Ball Movies",
      image: "https://cdn.noitatnemucod.net/thumbnail/300x400/100/e3a0c29bf713cc99e35de227eb9c93d8.jpg",
      url: "https://www.crunchyroll.com/series/GQWH0M1GG/dragon-ball-movies",
    },
    {
      title: "Dragon Ball Daima",
      image: "https://cdn.noitatnemucod.net/thumbnail/300x400/100/2cbe94bcbf18f0f3c205325d4e234d16.jpg",
      url: "https://www.crunchyroll.com/series/GG5H5XQ35/dragon-ball-daima",
    },
  ];

  res.render("anime", {
    title: "Dragon Ball Anime Collection",
    animes,
  });
});

// 404
app.use((req, res) => {
  res.status(404).render("error", { title: "Not Found", message: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`✅ DBZ app listening on http://localhost:${PORT}`);
});