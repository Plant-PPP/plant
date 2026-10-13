// The functions a server page hands a client component. React sends a client
// component only data and server actions, so every one must be an export of a
// "use server" module.
export function functionsIn(
  value: unknown,
  seen = new Set<unknown>(),
): unknown[] {
  if (typeof value === "function") return [value];
  if (typeof value !== "object" || value === null || seen.has(value)) return [];
  seen.add(value);
  const children =
    value instanceof Map
      ? [...value.keys(), ...value.values()]
      : value instanceof Set
        ? [...value]
        : Object.values(value);
  return children.flatMap((child) => functionsIn(child, seen));
}

// The functions in `props` that are none of the server actions in `modules`.
export function nonActionFunctions(
  props: unknown,
  modules: readonly Record<string, unknown>[],
): unknown[] {
  const actions = new Set(modules.flatMap((module) => Object.values(module)));
  return functionsIn(props).filter((each) => !actions.has(each));
}
