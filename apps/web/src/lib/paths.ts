// Whether pathname is base or below it, by whole segments: /assets covers
// /assets/1, never /assetsx, and / covers only itself.
export function isUnder(base: string, pathname: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}
