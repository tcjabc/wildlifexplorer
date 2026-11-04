# Credits · 資料來源

Card photos, illustrations and silhouettes are credited one by one on the app's
**Picture credits** page (More → Picture credits), from the `author`, `license` and
`sourceUrl` fields in `data/animals.json`. This file lists the datasets behind the maps.

All of them are public domain, CC0 or CC BY. Raw downloads are kept out of git
(`data-raw/`); only the processed files in `assets/` are committed.
`scripts/make-layers.mjs` re-creates them.

## Globe and maps

| What | Source | Licence | Used as |
|---|---|---|---|
| Land, coastlines (globe, small world map) | [Natural Earth](https://www.naturalearthdata.com/) 1:50m land | Public domain ([terms](https://www.naturalearthdata.com/about/terms-of-use/)) | `assets/globe.json`, `assets/world.svg` |
| Species ranges | [GBIF](https://www.gbif.org/) occurrence records, drawn on Natural Earth coastlines | Per dataset (CC0 / CC BY), see `data/ranges/` | `data/ranges/*.json` |
| Home outline (Taiwan) | [Natural Earth 1:10m Admin 0 countries](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/) | Public domain | `assets/home.json` |

## Globe map layers (`assets/layers/`)

| Layer | Source | Licence | Processing |
|---|---|---|---|
| 🏔️ Topography: colours | [Natural Earth I with Shaded Relief and Water, 1:50m](https://www.naturalearthdata.com/downloads/50m-raster-data/50m-natural-earth-1/) (Tom Patterson) | Public domain | Resized to 4096×2048 and 2048×1024 WebP, and to 8192×4096 cut into 128 zoom tiles of 512 px (`relief-tiles/`) |
| 🏔️ Topography: bumps | [NASA Earth Observatory topography](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/topography-bathymetry-maps) (Jesse Allen), from [GEBCO](https://www.gebco.net/data_and_products/gridded_bathymetry_data/) data by the British Oceanographic Data Centre | Public domain (NASA; "The GEBCO Grid is placed in the public domain") | Grey height map, 2048×1024 WebP |
| 🌳 Forests | [RESOLVE Ecoregions 2017](https://ecoregions.appspot.com/), Dinerstein, E. et al. (2017) *An Ecoregion-Based Approach to Protecting Half the Terrestrial Realm*, BioScience 67(6) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Forest biomes only (1–6, 14), grouped into tropical / temperate / boreal, dissolved and simplified with mapshaper to TopoJSON. Shows where forests grow naturally, not today's tree cover. |
| 🪸 Coral reefs | [Natural Earth 1:10m Reefs](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-reefs/) | Public domain | Shown as areas: everything within 8 km of a reef line (25 km for the whole-globe file), joined and simplified with mapshaper to TopoJSON |
| 🌙 Day & night: city lights | [NASA Earth Observatory, Black Marble 2016](https://visibleearth.nasa.gov/images/144898/earth-at-night-black-marble-2016-color-maps) (Joshua Stevens, Suomi NPP VIIRS data) | CC0 / public domain ([NASA data use policy](https://www.earthdata.nasa.gov/learn/use-data/data-use-policy)) | City lights as points: the brightest 6,000 cells of 0.21°, each at the middle of its lights with its brightness (`lights.json`). Day and night are worked out from the clock in the app. |
| 🌡️ Temperature | NASA EOSDIS [GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) / [Worldview](https://worldview.earthdata.nasa.gov/): MODIS Terra Land Surface Temperature (day, monthly) and MODIS Aqua Sea Surface Temperature (day, monthly), 2024 | CC0 / public domain (NASA data use policy) | GIBS colours turned back into °C with the GIBS colour maps, then repainted on one scale (`--c-temp-scale` in `css/tokens.css`); small cloud gaps filled. 12 months, 2048×1024 WebP. |
| 🌊 Ocean depth | [Natural Earth 1:10m Bathymetry](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-bathymetry/) | Public domain | 200, 1,000, 4,000 and 6,000 m levels (where the ocean's zones meet: NOAA / National Weather Service JetStream, [Layers of the Ocean](https://cimss.ssec.wisc.edu/sage/oceanography/lesson3/ocean/layers_ocean.htm)), simplified with mapshaper to TopoJSON |
| 🌋 Plates & volcanoes: plate boundaries | Peter Bird (2003), [PB2002](https://doi.org/10.1029/2001GC000252), "An updated digital model of plate boundaries", G³ 4(3):1027; GIS version by Hugo Ahlenius, [Nordpil](https://github.com/fraxen/tectonicplates) | [ODC-By 1.0](https://opendatacommons.org/licenses/by/1-0/) | Boundary steps joined into lines of one kind (pulling apart, crashing together, sliding past); which side the teeth go on from PB2002's names and plate shapes. Plate motion: Bird's poles (relative to the Pacific) turned into a no-net-rotation frame. |
| 🌋 Plates & volcanoes: volcanoes | [NOAA NCEI Volcano Locations Database](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.hazards%3AG02135) (obtained from the Smithsonian Global Volcanism Program); Chinese names from [Wikidata](https://www.wikidata.org/) | Public domain (US government work, "not subject to copyright protection within the United States"); Wikidata CC0 | Places, names and last-eruption periods; Chinese names (zh-tw, else zh-hant) by GVP volcano number. Taiwan's Tatun Volcanic Group and Kueishantao written by hand with their sources (`data/volcano-overrides.json`). |

The original plan used NASA NEO for temperature and UNEP-WCMC for coral reefs. NEO was
shut down in September 2026, so the same MODIS data now comes from GIBS. The UNEP-WCMC
reef data has its own licence (not CC), so Natural Earth's public domain reefs are used
instead.

The drawings in the Globe's info panel (`js/globe-art.js`) were drawn for WildFile: no
outside images.

## Tools

- [mapshaper](https://github.com/mbloch/mapshaper) (MPL 2.0) and [sharp](https://sharp.pixelplumbing.com/) (Apache 2.0): build-time only, nothing at runtime.
