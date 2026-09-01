const PLATFORM_POWER_EMAILS = new Set([
  'carlos@quantta.mx',
  'ramon@quantta.mx',
])

export function hasPlatformPowerEmail(email: string | null | undefined): boolean {
  return PLATFORM_POWER_EMAILS.has(String(email ?? '').trim().toLowerCase())
}
