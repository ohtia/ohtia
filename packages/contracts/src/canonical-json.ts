export function isUnicodeText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === "string" &&
        descriptor !== undefined &&
        descriptor.enumerable &&
        "value" in descriptor
      );
    })
  );
}
/** RFC 8785: ECMAScript primitives, UTF-16 key order, no normalization or invalid Unicode. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown): string {
    if (item === null || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (isUnicodeText(item)) return JSON.stringify(item);
    if (!item || typeof item !== "object" || ancestors.has(item))
      throw new Error("Invalid canonical JSON input.");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (
          Object.getPrototypeOf(item) !== Array.prototype ||
          Reflect.ownKeys(item).length !== item.length + 1
        )
          throw new Error("Invalid JSON array.");
        const elements: string[] = [];
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor?.enumerable || !("value" in descriptor))
            throw new Error("Invalid JSON array element.");
          elements.push(encode(descriptor.value));
        }
        return `[${elements.join(",")}]`;
      }
      if (!object(item)) throw new Error("Invalid JSON object.");
      return `{${Object.keys(item)
        .sort()
        .map((key) => {
          if (!isUnicodeText(key)) throw new Error("Invalid JSON property.");
          return `${JSON.stringify(key)}:${encode(item[key])}`;
        })
        .join(",")}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value);
}
