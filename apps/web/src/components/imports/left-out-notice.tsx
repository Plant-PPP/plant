import { Notice } from "@/components/ui/notice";

// What a reading left out of the document, above the rows to review.
export function LeftOutNotice({ children }: { children: string }) {
  return <Notice variant="warning">{children}</Notice>;
}
