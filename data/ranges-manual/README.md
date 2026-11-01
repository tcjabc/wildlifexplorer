# Hand-made range shapes

Put a GeoJSON file here named after the card id, e.g. `formosan-black-bear.json`, to replace
the range shape the build makes from GBIF records. The build uses your file and never changes it.

The file can be a `Feature` (or a `FeatureCollection` whose first feature is used) with a
`Polygon` or `MultiPolygon` geometry in longitude/latitude. Keep it simple: a few dozen points
per outline is plenty. Tools like geojson.io let you draw one. Don't trace IUCN range maps —
their licence doesn't allow it.

Re-run the build for that card afterwards so the map zooms to your shape:

    node scripts/build-cards.mjs --only formosan-black-bear
