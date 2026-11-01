import { getJson } from './http.mjs';
import { commonsLicense, stripHtml } from './licenses.mjs';

const API = 'https://commons.wikimedia.org/w/api.php';

const ILLUSTRATION_WORDS = /illustration|drawing|painting|plate|restoration|reconstruction|lithograph|engraving|watercolou?r|sketch|life[ _-]?restoration|\bart\b|print/i;
const UNWANTED_WORDS = /\b(skulls?|skeletons?|stamps?|maps?|range|distribution|coins?|logo|banknote|taxiderm\w*|specimens?|cladogram|diagram|size comparison)\b/i;

const ILLUSTRATION_CATEGORIES = /lithograph|illustration|drawing|painting|engraving|\bplates?\b|watercolou?r|paleoart|PD-Art|PD[- ]old|PD US expired/i;

export const looksLikeIllustration = title => ILLUSTRATION_WORDS.test(title) || /\.svg$/i.test(title);
export const looksUnwanted = title => UNWANTED_WORDS.test(title);

// Old natural-history plates often have plain titles, so also look at categories and date.
function isIllustration(title, ext) {
  const year = Number(String(ext.DateTimeOriginal?.value ?? '').match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1]);
  return looksLikeIllustration(title) || ILLUSTRATION_CATEGORIES.test(ext.Categories?.value ?? '') || (year > 0 && year < 1950);
}

// "user:Someone" -> "Someone"; "Unknown author Unknown author" -> "Unknown author".
function cleanAuthor(s) {
  s = s.replace(/^user:/i, '').trim();
  const words = s.split(' ');
  const half = words.length / 2;
  if (Number.isInteger(half) && words.slice(0, half).join(' ') === words.slice(half).join(' ')) s = words.slice(0, half).join(' ');
  return s || 'Unknown';
}

// Artist field, else a "Photographs by X" category, else Unknown.
function authorOf(ext) {
  const artist = cleanAuthor(stripHtml(ext.Artist?.value ?? ''));
  if (artist !== 'Unknown') return artist;
  const byCat = (ext.Categories?.value ?? '').split('|').map(c => c.match(/^(?:Photographs|Photos|Images) by (.+)$/i)?.[1]).find(Boolean);
  return byCat ?? 'Unknown';
}

// Image info + licence for up to 50 File: titles. Returns candidates in the same order,
// dropping anything without an allowed licence.
export async function fileInfo(titles, width) {
  if (!titles.length) return [];
  const json = await getJson(API, {
    action: 'query', format: 'json', formatversion: '2',
    titles: titles.map(t => (t.startsWith('File:') ? t : `File:${t}`)).join('|'),
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(width),
    iiextmetadatafilter: 'LicenseShortName|License|LicenseUrl|Artist|Categories|DateTimeOriginal',
  });
  const pages = json.query?.pages ?? [];
  const norm = new Map((json.query?.normalized ?? []).map(n => [n.from, n.to]));
  const byTitle = new Map(pages.map(p => [p.title, p]));

  const out = [];
  for (const raw of titles) {
    const t = raw.startsWith('File:') ? raw : `File:${raw}`;
    const page = byTitle.get(norm.get(t) ?? t);
    const info = page?.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|webp|tiff|gif)/.test(info.mime)) continue;
    const ext = info.extmetadata ?? {};
    const lic = commonsLicense(ext);
    if (!lic) continue;
    out.push({
      source: 'commons',
      title: page.title,
      width: info.width,
      height: info.height,
      downloadUrl: info.thumburl ?? info.url,
      isIllustration: isIllustration(page.title, ext),
      author: authorOf(ext),
      license: lic.license,
      licenseUrl: lic.licenseUrl,
      sourceUrl: info.descriptionurl,
    });
  }
  return out;
}

// Search Commons for illustrations whose file title names the species.
export async function searchIllustrations(scientificName, width) {
  const binomial = scientificName.split(/\s+/).slice(0, 2).join(' ');
  const json = await getJson(API, {
    action: 'query', format: 'json', list: 'search', srnamespace: '6', srlimit: '20',
    srsearch: `"${binomial}" illustration filetype:bitmap`,
  });
  const lower = binomial.toLowerCase();
  const titles = (json.query?.search ?? [])
    .map(s => s.title)
    .filter(t => t.toLowerCase().replace(/_/g, ' ').includes(lower) && !looksUnwanted(t));
  return fileInfo(titles.slice(0, 10), width);
}
