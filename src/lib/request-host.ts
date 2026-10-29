function validHost(value: string | null): string | null {
  const host = value?.split(",")[0].trim().toLowerCase();
  if (!host || !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d{1,5})?$/.test(host)) return null;
  try { new URL(`https://${host}`); return host; } catch { return null; }
}

/** لا نثق في X-Forwarded-Host المختلف عن Host إلا لو كان مسموحًا صراحةً. */
export function requestHost(headers: Headers, environment: string | undefined, extraOrigins = ""): string | null {
  const host = validHost(headers.get("host"));
  const forwarded = validHost(headers.get("x-forwarded-host"));
  if (!forwarded || forwarded === host) return host ?? forwarded;
  const trusted = extraOrigins.split(",").map((value) => validHost(value)).filter(Boolean);
  if (trusted.includes(forwarded)) return forwarded;
  if (environment === "development" && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.e2b\.app(?::\d+)?$/.test(forwarded)) return forwarded;
  return host;
}
