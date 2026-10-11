// A YYYY-MM-DD date as es-AR writes it: 09/10/2026.
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}
