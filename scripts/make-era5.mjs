#!/usr/bin/env node
// A stub, not run yet: Temperature's months from ERA5, in place of the 2024 MODIS pictures.
//
// ERA5 monthly averaged 2 m air temperature, averaged over 1991–2020 for each calendar month: a
// real climatology, of the air and not the ground, with no gaps to fill. From the Copernicus Climate
// Data Store (CDS), dataset reanalysis-era5-single-levels-monthly-means. Attribution is required;
// the wording is in CREDITS.md.
//
// What it needs first, by hand (no account details ever go in this repo):
//   1. A free ECMWF account, signed in at https://cds.climate.copernicus.eu
//   2. The dataset's licence accepted, in "Terms of use" at the bottom of its Download tab
//   3. The API key from the account page, in the environment as CDSAPI_KEY, or in ~/.cdsapirc
//
// What it will do:
//   1. Request product_type monthly_averaged_reanalysis, variable 2m_temperature, years 1991–2020,
//      months 01–12, time 00:00, grid 0.5/0.5, format netcdf, into data-raw/ (git-ignored).
//   2. Average each calendar month over the years, in °C. ERA5's longitudes run 0–360 and its first
//      row is the north: move the map so it runs -180–180, as every other layer does.
//   3. Pack it as scripts/make-layers.mjs tempMonths does: toByte() from js/globe-months.js, one
//      month to a channel, four to a file, temp-months-1…3.webp, 720 × 360. js/ needs no change.
//   4. Bump LAYERS_VERSION in sw.js, since the files keep their names, and change the layer's
//      credit in js/layers.js and CREDITS.md and its year in the info panel.
console.error('ERA5 is not set up yet: see the steps at the top of scripts/make-era5.mjs.');
process.exit(1);
