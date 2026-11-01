// Only Public Domain, CC0, CC BY and CC BY-SA are allowed. Anything with NC
// (non-commercial) or ND (no derivatives), and anything we can't identify, is rejected.

const CC_URL = (kind, ver) => `https://creativecommons.org/licenses/${kind}/${ver}/`;
const CC0 = { license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };
const PD = { license: 'Public domain', licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/' };

function hasRestriction(s) {
  return /(^|[\s_-])(nc|nd)([\s_-]|$)/i.test(s) || /non-?commercial|no ?deriv/i.test(s);
}

// Commons extmetadata: License (machine code, e.g. "cc-by-sa-4.0") and LicenseShortName.
export function commonsLicense(ext) {
  const code = (ext?.License?.value ?? '').toLowerCase().trim();
  const short = stripHtml(ext?.LicenseShortName?.value ?? '');
  if (hasRestriction(code) || hasRestriction(short)) return null;

  if (code === 'cc0' || code === 'cc-zero' || /^cc0\b/i.test(short)) return CC0;
  if (code === 'pd' || code.startsWith('pd-') || /^public domain/i.test(short)) return PD;

  let m = code.match(/^cc-(by|by-sa)-(\d\.\d)/);
  if (m) return { license: `CC ${m[1].toUpperCase()} ${m[2]}`, licenseUrl: CC_URL(m[1], m[2]) };
  m = short.match(/^CC[ -](BY|BY-SA)[ -](\d\.\d)/i);
  if (m) {
    const kind = m[1].toLowerCase();
    return { license: `CC ${kind.toUpperCase()} ${m[2]}`, licenseUrl: CC_URL(kind, m[2]) };
  }
  return null;
}

// iNaturalist photo.license_code: "cc0", "cc-by", "cc-by-sa" (iNat uses the 4.0 licences).
export function inatLicense(code) {
  switch ((code ?? '').toLowerCase()) {
    case 'cc0': return CC0;
    case 'cc-by': return { license: 'CC BY 4.0', licenseUrl: CC_URL('by', '4.0') };
    case 'cc-by-sa': return { license: 'CC BY-SA 4.0', licenseUrl: CC_URL('by-sa', '4.0') };
    default: return null;
  }
}

export function isAllowedLicenseName(name) {
  return /^(CC0|Public domain|CC BY( |-SA ))/i.test(name ?? '') && !hasRestriction(name);
}

export function stripHtml(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
