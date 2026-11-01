import { getJson } from './http.mjs';
import { inatLicense } from './licenses.mjs';

const API = 'https://api.inaturalist.org/v1';

// Most-faved research-grade observation photos with an allowed licence.
export async function findPhotos(scientificName, inatTaxonId) {
  const params = {
    photo_license: 'cc0,cc-by,cc-by-sa',
    quality_grade: 'research',
    photos: 'true',
    order_by: 'votes',
    per_page: '10',
  };
  if (inatTaxonId) params.taxon_id = String(inatTaxonId);
  else params.taxon_name = scientificName;

  const json = await getJson(`${API}/observations`, params);
  const out = [];
  for (const obs of json.results ?? []) {
    for (const photo of obs.photos ?? []) {
      // The filter matches observations; check each photo's own licence too.
      const lic = inatLicense(photo.license_code);
      if (!lic || photo.hidden) continue;
      out.push({
        source: 'inaturalist',
        width: photo.original_dimensions?.width ?? 0,
        height: photo.original_dimensions?.height ?? 0,
        downloadUrl: photo.url.replace('/square.', '/original.'),
        author: obs.user?.name || obs.user?.login || 'iNaturalist user',
        license: lic.license,
        licenseUrl: lic.licenseUrl,
        sourceUrl: `https://www.inaturalist.org/photos/${photo.id}`,
      });
      break; // one photo per observation keeps some variety
    }
  }
  return out;
}
