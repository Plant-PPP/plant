import type { WriteResultCode } from "./write-result";

export const WRITE_MESSAGES: Record<WriteResultCode, string> = {
  last_active_portfolio: "Necesitás al menos una cartera activa.",
  duplicate_name: "Ya tenés una cartera con ese nombre.",
  not_found: "No encontramos esa cartera. Recargá la página.",
  invalid: "Revisá el nombre.",
  failed: "No pudimos guardar. Probá de nuevo.",
};
