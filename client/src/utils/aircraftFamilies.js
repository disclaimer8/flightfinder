let _families = null;
let _promise = null;

export function loadFamilies() {
  if (_families) return Promise.resolve(_families);
  if (_promise) return _promise;
  _promise = fetch('/content/aircraft-family-models.json')
    .then(r => r.ok ? r.json() : [])
    .then(data => { _families = Array.isArray(data) ? data : []; return _families; })
    .catch(() => { _families = []; return _families; });
  return _promise;
}

export function findFamilySlugForModel(model, families) {
  if (!model || !Array.isArray(families)) return null;
  const m = String(model).toLowerCase();
  for (const fam of families) {
    if (!Array.isArray(fam.modelPrefixes)) continue;
    for (const prefix of fam.modelPrefixes) {
      if (m.startsWith(String(prefix).toLowerCase())) return fam.slug;
    }
  }
  return null;
}

export function _resetForTests() {
  _families = null;
  _promise = null;
}
