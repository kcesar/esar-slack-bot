export function equalsInsensitive(a?: string, b?: string) {
  if (a == null) {
    return b == null;
  } else if (b == null) {
    return a == null;
  }
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

export function asLookup<T,K extends string|number>(list: T[], getKey: (item: T) => K): Record<K, T> {
  const lookup: Record<K, T> = {} as Record<K, T>;
  for (const item of list) {
    lookup[getKey(item)] = item;
  }
  return lookup;
}