import { NAME_LIMITS } from "./limits";
import type { WriteResultCode } from "./write-result";

export const WRITE_MESSAGES: Record<WriteResultCode, string> = {
  last_active_portfolio: "Necesitás al menos una cartera activa.",
  duplicate_name: "Ya tenés una cartera con ese nombre.",
  not_found: "Esa cartera ya no está en tu lista.",
  invalid: `Usá entre 1 y ${NAME_LIMITS.portfolios.name} letras, números o signos.`,
  failed: "No pudimos guardar. Probá de nuevo.",
};
