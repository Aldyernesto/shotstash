export function bigIntToNumber<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (_key: string, value: unknown) =>
    typeof value === 'bigint' ? Number(value) : value
  ));
}
