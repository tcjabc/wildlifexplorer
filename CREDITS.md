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
| Home outline | [Natural Earth 1:50m Admin 0 countries](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/) | Public domain | Every country in one file, simplified with mapshaper to TopoJSON, keyed by ISO code (`assets/layers/home.topo.json`). |

## Globe map layers (`assets/layers/`)

| Layer | Source | Licence | Processing |
|---|---|---|---|
| 🏔️ Topography: colours | [Natural Earth I with Shaded Relief and Water, 1:50m](https://www.naturalearthdata.com/downloads/50m-raster-data/50m-natural-earth-1/) (Tom Patterson) | Public domain | Resized to 4096×2048 and 2048×1024 WebP, and to 8192×4096 cut into 128 zoom tiles of 512 px (`relief-tiles/`) |
| 🏔️ Topography: bumps | [NASA Earth Observatory topography](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/topography-bathymetry-maps) (Jesse Allen), from [GEBCO](https://www.gebco.net/data_and_products/gridded_bathymetry_data/) data by the British Oceanographic Data Centre | Public domain (NASA; "The GEBCO Grid is placed in the public domain") | Grey height map, 2048×1024 WebP |
| 🏔️ Topography: the Ice Age sea | NOAA National Centers for Environmental Information (NCEI), [ETOPO 2022 Global Relief Model](https://www.ncei.noaa.gov/products/etopo-global-relief-model), 60 arc-second bedrock elevation ([doi:10.25921/fd45-gt74](https://doi.org/10.25921/fd45-gt74)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Read through NCEI's OPeNDAP server every 5 arc-minutes (never the whole file), averaged to 2048×1024: how deep the sea is today, a metre a step to 254 m, as one grey lossless WebP (`elevation-2k.webp`). Seas not joined to the oceans (the Black Sea, the Caspian) are left out. The sea in the Ice Age, about 120 m lower some 20,000 years ago, is worked out in the app. |
| 🏔️ Topography: the sea floor | The same ETOPO 2022 bedrock samples | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | A hillshade of the sea floor, lit from the north-west, drawn 20 times taller (150 times for the broad shapes) with local contrast, as one grey WebP (`seafloor-2k.webp`, 2048×1024) |
| 🏔️ Topography: the Ice Age ice sheets | Evan J. Gowan et al. (2021), [PaleoMIST 1.0: global ice sheet reconstruction for the past 80,000 years](https://doi.org/10.1594/PANGAEA.905800) (PANGAEA; *Nature Communications* 12, 1199); its Eurasian margins after DATED-1 (Hughes et al. 2016) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Its ice margins every 2,500 years from 20,000 to 7,500 years ago (read out of the archive with byte ranges), each placed at the sea level its own ice volumes give, scaled so 20,000 years ago is −120 m; today's ice left out. One grey lossless WebP (`icesheets-2k.webp`, 2048×1024): how far the sea must have gone down for ice there. |
| 🌳 Forests | [RESOLVE Ecoregions 2017](https://ecoregions.appspot.com/), Dinerstein, E. et al. (2017) *An Ecoregion-Based Approach to Protecting Half the Terrestrial Realm*, BioScience 67(6) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Forest biomes only (1–6, 14), grouped into tropical / temperate / boreal, dissolved and simplified with mapshaper to TopoJSON. Shows where forests grow naturally, not today's tree cover; drawn as the three kinds' outlines over the green by month. |
| 🪸 Coral reefs | [Natural Earth 1:10m Reefs](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-reefs/) | Public domain | Shown as areas: everything within 8 km of a reef line (25 km for the whole-globe file), joined and simplified with mapshaper to TopoJSON |
| 🪸 Coral reefs: warm water | [NOAA OISST v2.1](https://psl.noaa.gov/data/gridded/data.noaa.oisst.v2.highres.html) (NOAA/NCEI), 1991–2020 monthly climatology of sea surface temperature; data provided by the NOAA PSL, Boulder, Colorado, USA, from their website at https://psl.noaa.gov | Public domain (US government work; "no restrictions are placed upon their use", [NCEI](https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ncdc:C01606/html)) | Read through PSL's OPeNDAP server every 0.5° (about 1 MB a month). The months as numbers at 720×360 (`warm-months-1…3.webp`), and as 2048×1024 pictures of the warm water only (`warm-01…12.webp`, the fallback). |
| 🌙 Day & night: city lights | [NASA Earth Observatory, Black Marble 2016](https://visibleearth.nasa.gov/images/144898/earth-at-night-black-marble-2016-color-maps) (Joshua Stevens, Suomi NPP VIIRS data) | CC0 / public domain ([NASA data use policy](https://www.earthdata.nasa.gov/learn/use-data/data-use-policy)) | City lights as points: the brightest 6,000 cells of 0.21°, each at the middle of its lights with its brightness (`lights.json`). Day and night are worked out from the clock in the app. |
| 🌡️ Temperature | NASA EOSDIS [GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) / [Worldview](https://worldview.earthdata.nasa.gov/): MODIS Terra Land Surface Temperature (day, monthly) and MODIS Aqua Sea Surface Temperature (day, monthly), 2024 | CC0 / public domain (NASA data use policy) | GIBS colours turned back into °C with the GIBS colour maps, then repainted on one scale (`--c-temp-scale` in `css/tokens.css`); small cloud gaps filled. 12 months, 2048×1024 WebP (`temp-01…12.webp`, the fallback). `temp-months-1…3.webp`: the same months read back to °C at 720×360 and stored as numbers, gaps filled from the nearest reading. |
| 🌧️ Rain | NASA GMAO, [MERRA-2](https://disc.gsfc.nasa.gov/datasets/M2TMNXFLX_5.12.4/summary) bias-corrected monthly precipitation (M2TMNXFLX, doi:10.5067/0JRLVL8YV2Y4), from NASA EOSDIS [GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) | CC0 ([NASA data use guidance](https://earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance)) | GIBS's ready-made tiles (0.5625°) for every month of 1991–2020, turned back into mm a day with the GIBS colour map and averaged month by month: a 1991–2020 climatology. The months as numbers at 720×360 (`rain-months-1…3.webp`), and as 2048×1024 pictures on `--c-rain-scale`, see-through where dry (`rain-01…12.webp`, the fallback). |
| 🌳 Forests: green by month | NASA EOSDIS [GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) / [Worldview](https://worldview.earthdata.nasa.gov/): MODIS Terra NDVI (monthly), 2024 | CC0 / public domain (NASA data use policy) | GIBS colours turned back into NDVI with the GIBS colour map (`MODIS_L3_NDVI`), then repainted on one scale (`--c-plant-scale`); small cloud gaps filled, land with no reading (snow, polar night) counted bare. 12 months, 2048×1024 WebP (`plants-01…12.webp`, the fallback). `plants-months-1…3.webp`: the same months as numbers at 720×360. |
| 🌊 Ocean depth | [Natural Earth 1:10m Bathymetry](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-bathymetry/) | Public domain | 200, 1,000, 4,000 and 6,000 m levels (where the ocean's zones meet: NOAA / National Weather Service JetStream, [Layers of the Ocean](https://cimss.ssec.wisc.edu/sage/oceanography/lesson3/ocean/layers_ocean.htm)), simplified with mapshaper to TopoJSON |
| 🌊 Ocean depth: currents | Traced by hand for WildFile from general textbook knowledge of the major surface currents (our own work) | — | 17 simplified lines with their direction and warm or cold (`currents.json`), smoothed in the app; checked to stay off the land (`tests/globe-currents.test.mjs`) |
| 🌋 Plates & volcanoes: plate boundaries | Peter Bird (2003), [PB2002](https://doi.org/10.1029/2001GC000252), "An updated digital model of plate boundaries", G³ 4(3):1027; GIS version by Hugo Ahlenius, [Nordpil](https://github.com/fraxen/tectonicplates) | [ODC-By 1.0](https://opendatacommons.org/licenses/by/1-0/) | Boundary steps joined into lines of one kind (pulling apart, crashing together, sliding past); which side the teeth go on from PB2002's names and plate shapes. Plate motion: Bird's poles (relative to the Pacific) turned into a no-net-rotation frame. |
| 🌋 Plates & volcanoes: volcanoes | [NOAA NCEI Volcano Locations Database](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.hazards%3AG02135) (obtained from the Smithsonian Global Volcanism Program); Chinese names from [Wikidata](https://www.wikidata.org/) | Public domain (US government work, "not subject to copyright protection within the United States"); Wikidata CC0 | Places, names and last-eruption periods; Chinese names (zh-tw, else zh-hant) by GVP volcano number. Taiwan's Tatun Volcanic Group and Kueishantao written by hand with their sources (`data/volcano-overrides.json`). |

Planned, not in use yet: Temperature from ERA5 monthly averaged 2 m air temperature, a 1991–2020
climatology (`scripts/make-era5.mjs`), from the [Copernicus Climate Data Store](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels-monthly-means).
Attribution required: "Generated using Copernicus Climate Change Service information", and Hersbach, H. et al.,
*ERA5 monthly averaged data on single levels from 1940 to present*, Copernicus Climate Change Service (C3S)
Climate Data Store (CDS), doi:10.24381/cds.f17050d7.

The original plan used NASA NEO for temperature and UNEP-WCMC for coral reefs. NEO was
shut down in September 2026, so the same MODIS data now comes from GIBS. The UNEP-WCMC
reef data has its own licence (not CC), so Natural Earth's public domain reefs are used
instead.

The drawings in the Globe's info panel (`js/globe-art.js`) were drawn for WildFile: no
outside images.

## Facts in the Plates & volcanoes panel

- Plates move about as fast as fingernails grow: USGS, [How fast do tectonic plates move?](https://www.usgs.gov/faqs/how-fast-do-tectonic-plates-move); fingernails about 3.6 cm a year: USGS, [How fast is the hotspot moving under Yellowstone?](https://www.usgs.gov/faqs/how-fast-hotspot-moving-under-yellowstone).
- More than half of the active volcanoes above sea level circle the Pacific (the Ring of Fire): USGS, [What is the Ring of Fire?](https://www.usgs.gov/media/audio/what-ring-fire).
- Taiwan: the Philippine Sea Plate converges with Eurasia at about 81.5 ± 1.3 mm a year toward N309° (Yu, Chen and Kuo 1997, GPS), as cited in [an NCU thesis](https://www.gep.ncu.edu.tw/storage/thesis/2016/thesis_1474441282.pdf) and [GSA 2009](https://gsa.confex.com/gsa/2009NE/webprogram/Paper155888.html); the Luzon arc's collision with the Eurasian margin builds Taiwan's mountains. Tatun Volcano Group: [Geoscience Letters 2024](https://geoscienceletters.springeropen.com/articles/10.1186/s40562-024-00358-2) (dating, hot springs and fumaroles; watched by the Taiwan Volcano Observatory at Tatun). The Yangtze and Sunda plates: PB2002.
- The school terms 張裂性 / 聚合性 / 錯動性板塊邊界, as used in Taiwan's junior-high Earth science (for example [a Taipei 9th-grade test](https://www.htjh.tp.edu.tw/wp-content/uploads/doc/t210/113-1%20%E7%AC%AC%E4%BA%8C%E6%AE%B5%E8%80%83%E4%B9%9D%E5%B9%B4%E7%B4%9A%E5%9C%B0%E7%A7%91.pdf) and [NTU high-school teaching material](https://case.ntu.edu.tw/highscope/wp-content/uploads/2011/08/earth_t02_2.pdf)).

The drawings in this panel (plates as puzzle pieces, the three cross-sections) were drawn for WildFile.

## Tools

- [mapshaper](https://github.com/mbloch/mapshaper) (MPL 2.0) and [sharp](https://sharp.pixelplumbing.com/) (Apache 2.0): build-time only, nothing at runtime.
