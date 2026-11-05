export function resolveReceiptLookup(
  reference: string | null | undefined,
  token: string | null | undefined,
  isAdmin: boolean,
): { key: string; allowed: boolean } {
  const secureToken = String(token ?? '').trim();
  if (secureToken) return { key: secureToken, allowed: true };
  const ref = String(reference ?? '').trim();
  if (isAdmin && ref) return { key: ref, allowed: true };
  return { key: '', allowed: false };
}
