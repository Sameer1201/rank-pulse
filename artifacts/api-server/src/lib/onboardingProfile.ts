/** Client onboarding fields only. Billing, entitlements and security metadata remain server-owned. */
export function mergeOnboardingProfile(existing: unknown, incoming: unknown): Record<string, unknown> {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const previous = object(existing);
  const input = object(incoming);
  const result = { ...previous };
  for (const key of ['dateOfBirth', 'whatsappNumber', 'hearAboutUs']) {
    if (typeof input[key] === 'string') result[key] = input[key].slice(0, 2000);
  }
  if (typeof input.whatsappOnSameNumber === 'boolean') result.whatsappOnSameNumber = input.whatsappOnSameNumber;
  const groups: Record<string, string[]> = {
    address: ['country', 'state', 'district', 'street', 'city', 'pincode'],
    preparation: ['classLevel', 'board', 'targetYear', 'targetExam', 'institutionName', 'collegeName', 'universityName'],
    learningMode: ['mode', 'provider'],
  };
  for (const [key, fields] of Object.entries(groups)) {
    if (!Object.hasOwn(input, key)) continue;
    const nested = object(input[key]);
    const merged = { ...object(previous[key]) };
    for (const field of fields) {
      if (typeof nested[field] === 'string') merged[field] = nested[field].slice(0, 2000);
      if (field === 'targetYear' && typeof nested[field] === 'number' && Number.isFinite(nested[field])) merged[field] = nested[field];
    }
    result[key] = merged;
  }
  return result;
}
