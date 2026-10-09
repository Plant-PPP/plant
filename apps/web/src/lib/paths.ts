// Whether pathname is base or below it, by whole segments: /assets covers
// /assets/1, never /assetsx.
export function isUnder(base: string, pathname: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}
