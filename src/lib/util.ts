export function equalsInsensitive(a?: string, b?: string) {
  if (a == null) {
    return b == null;
  } else if (b == null) {
    return a == null;
  }
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

export function asLookup<T, K extends string | number>(list: T[], getKey: (item: T) => K): Record<K, T> {
  const lookup: Record<K, T> = {} as Record<K, T>;
  for (const item of list) {
    lookup[getKey(item)] = item;
  }
  return lookup;
}

export function buildInsensitiveCompare<T>(getter?: (item: T) => string) {
  return (a: T, b: T) => {
    if (a == null) {
      return b == null ? 0 : 1;
    } else if (b == null) {
      return a == null ? 1 : 0;
    }
    const l = getter ? getter(a) : `${a}`;
    const r = getter ? getter(b) : `${b}`;
    if (l == null) {
      return r == null ? 0 : 1;
    } else if (r == null) {
      return a == null ? 1 : 0;
    }
    return l.localeCompare(r, undefined, { sensitivity: 'accent' });
  }
}

export function split(str: string, sep: RegExp, n: number) {
  var out: string[] = [];

  while(--n) out.push(str.slice(sep.lastIndex, sep.exec(str)?.index));
  if (sep.lastIndex > 0) out.push(str.slice(sep.lastIndex));
  return out;
}