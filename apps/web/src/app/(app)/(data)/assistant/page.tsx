import { referenceUnit } from "@plant/core";
import { buenosAiresDate } from "@plant/shared";
import type { Metadata } from "next";

import { pinChart } from "@/app/(app)/(data)/assistant/actions";
import { AssistantChat } from "@/components/assistant/assistant-chat";
import { SourcePinProvider } from "@/components/assistant/pin-context";
import { PrototypeChat } from "@/components/prototype/prototype-chat";
import {
  listConversations,
  questionsThisMonth,
} from "@/lib/assistant/conversations";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { isProductionDeployment } from "@/lib/deployment";
import { readReferenceDollar } from "@/lib/holdings/read";
import { navTitle } from "@/lib/navigation";
import { currentRequestId } from "@/lib/request-id-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: navTitle("/assistant") };

// Outside production it answers from the made-up data.
export default async function AssistantPage() {
  if (!isProductionDeployment()) return <PrototypeChat />;
  const claims = await getSessionClaims();
  const client = await createClient();
  const today = buenosAiresDate(new Date());
  const [conversations, used, referenceDollar] = await Promise.all([
    listConversations(client, claims.sub),
    questionsThisMonth(client, claims.sub, today),
    readReferenceDollar(client, {
      userId: claims.sub,
      requestId: await currentRequestId(),
      page: "/assistant",
      params: {},
    }),
  ]);
  return (
    <SourcePinProvider action={pinChart}>
      <AssistantChat
        conversations={conversations}
        used={used}
        defaultUnit={referenceUnit(referenceDollar)}
      />
    </SourcePinProvider>
  );
}
