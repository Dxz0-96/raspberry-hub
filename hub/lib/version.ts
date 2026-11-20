// Release versions (Semantic Versioning, without pre-releases): the notice of a new version and its major part.

/** "2.1.0" or "v2.1.0" -> [2, 1, 0]; null for anything else */
export function parseVersion(text: string | null | undefined): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** true when a is a later release than b (false when either is not a version) */
export function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** true when a is a new major version compared with b: something on the Raspberry Pi is converted */
export function isNewMajor(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = parseVersion(a);
  const y = parseVersion(b);
  return Boolean(x && y && x[0] > y[0]);
}
