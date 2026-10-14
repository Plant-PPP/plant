import { isValidElement, type ReactNode } from "react";

type Props = Record<string, unknown>;

// The props of the first element in a rendered tree that matches, looking
// through children only: a nested component is not rendered.
export function findProps(
  node: ReactNode,
  matches: (props: Props) => boolean,
): Props | undefined {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) {
      const found = findProps(child, matches);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const props = node.props as Props;
  if (matches(props)) return props;
  return findProps(props.children as ReactNode, matches);
}
