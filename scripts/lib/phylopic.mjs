// Animal silhouettes from PhyloPic (https://www.phylopic.org), found through GBIF ids.
// If the species itself has none, the closest group (genus, family, order) is used.
import { getJson } from './http.mjs';

const API = 'https://api.phylopic.org';

// Allowed licences only: CC0, Public Domain Mark, CC BY, CC BY-SA. Never NC or ND.
const LICENSES = [
  [/publicdomain\/zero\/1\.0/, 'CC0 1.0'],
  [/publicdomain\/mark\/1\.0/, 'Public domain'],
  [/licenses\/by\/(\d\.\d)/, v => `CC BY ${v}`],
  [/licenses\/by-sa\/(\d\.\d)/, v => `CC BY-SA ${v}`],
];
function license(url = '') {
  if (/-nc|-nd/.test(url)) return null;
  for (const [re, name] of LICENSES) {
    const m = url.match(re);
    if (m) return typeof name === 'function' ? name(m[1]) : name;
  }
  return null;
}

let build;
async function currentBuild() {
  build ??= (await getJson(`${API}/`)).build;
  return build;
}

export async function findSilhouette(gbifIds, scientificName) {
  if (!gbifIds?.length) return null;
  const b = await currentBuild();
  let node;
  try {
    node = await getJson(`${API}/resolve/gbif.org/species`, { build: b, objectIDs: gbifIds.join(',') });
  } catch {
    return null; // PhyloPic answers "could not resolve" with an error status
  }
  // The resolve endpoint redirects to the node; fetch follows it, so we get the node itself.
  const nodeId = node?.uuid ?? (node?.href ?? node?._links?.self?.href)?.match(/\/nodes\/([0-9a-f-]+)/)?.[1];
  if (!nodeId) return null;

  const json = await getJson(`${API}/images`, { build: b, filter_clade: nodeId, page: '0', embed_items: 'true' });
  const binomial = scientificName.split(/\s+/).slice(0, 2).join(' ').toLowerCase();
  const candidates = (json._embedded?.items ?? [])
    .map(img => ({ img, license: license(img._links?.license?.href) }))
    .filter(c => c.license && c.img._links?.vectorFile?.href);
  // Prefer a silhouette of this very species, then anything in the group.
  const pick = candidates.find(c => (c.img._links.specificNode?.title ?? '').toLowerCase().startsWith(binomial)) ?? candidates[0];
  if (!pick) return null;
  const { img } = pick;
  return {
    downloadUrl: img._links.vectorFile.href,
    author: img.attribution || 'Unknown',
    license: pick.license,
    licenseUrl: img._links.license.href,
    sourceUrl: `https://www.phylopic.org/images/${img.uuid}`,
    taxon: img._links.specificNode?.title ?? node.title ?? '',
  };
}
