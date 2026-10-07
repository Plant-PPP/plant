import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">No encontramos esta página</h1>
      <Link href="/" className="text-sm underline underline-offset-4">
        Volver al inicio
      </Link>
    </main>
  );
}
