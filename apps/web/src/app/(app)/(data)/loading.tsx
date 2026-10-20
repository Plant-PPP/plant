import { PageSkeleton } from "@/components/layout/page-skeleton";

// Shown at once on a navigation, and kept while the page's data is read.
export default function Loading() {
  return <PageSkeleton />;
}
