/**
 * Validates docs/data/community-workers.json (the Community workers page).
 * Returns a list of problems, empty when the file is valid.
 */
const KIND = /^[a-z0-9._-]{1,64}\/[a-z0-9._-]{1,64}$/;
const SPDX = /^[A-Za-z0-9.+-]+( (AND|OR) [A-Za-z0-9.+-]+)*$/;
const FIELDS = ['name', 'description', 'repository', 'kinds', 'contract', 'license', 'maintainer'];

export function validateWorkers(list) {
  const problems = [];
  if (!Array.isArray(list)) return ['the file must hold a JSON array'];
  const seen = new Set();
  list.forEach((w, i) => {
    const at = `entry ${i + 1}${w && typeof w.name === 'string' ? ` (${w.name})` : ''}`;
    if (!w || typeof w !== 'object' || Array.isArray(w)) {
      problems.push(`${at}: must be an object`);
      return;
    }
    for (const key of Object.keys(w)) if (!FIELDS.includes(key)) problems.push(`${at}: unknown field "${key}"`);
    if (typeof w.name !== 'string' || !w.name.trim() || w.name.length > 60) problems.push(`${at}: name must be 1 to 60 characters`);
    if (typeof w.description !== 'string' || !w.description.trim() || w.description.length > 160)
      problems.push(`${at}: description must be 1 to 160 characters`);
    let url = null;
    try {
      url = new URL(w.repository);
    } catch {
      /* reported below */
    }
    if (!url || url.protocol !== 'https:') problems.push(`${at}: repository must be an https:// URL`);
    else if (seen.has(url.href)) problems.push(`${at}: repository is listed twice`);
    else seen.add(url.href);
    if (!Array.isArray(w.kinds) || w.kinds.length < 1 || w.kinds.length > 32 || !w.kinds.every((k) => typeof k === 'string' && KIND.test(k)))
      problems.push(`${at}: kinds must be 1 to 32 names like "acme/transcript"`);
    else if (w.kinds.some((k) => k.startsWith('shotstash/'))) problems.push(`${at}: kinds must use your own namespace, not shotstash/`);
    if (!Number.isInteger(w.contract) || w.contract < 1) problems.push(`${at}: contract must be a contract major (1)`);
    if (typeof w.license !== 'string' || !SPDX.test(w.license)) problems.push(`${at}: license must be an SPDX identifier`);
    if (typeof w.maintainer !== 'string' || !/^@[A-Za-z0-9-]{1,39}$/.test(w.maintainer))
      problems.push(`${at}: maintainer must be a GitHub handle such as @name`);
  });
  return problems;
}
