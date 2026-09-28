// Stable normalized keys used to prevent duplicate records when a job is
// retried. Each function is pure and side-effect free so it can be unit
// tested independently of the database.

export function normalizeBrandName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function brandKey(clientId: string, name: string, marketplace: string): string {
  return `${clientId}:${normalizeBrandName(name)}:${marketplace.toLowerCase()}`;
}

export function productKey(brandId: string, asin: string): string {
  return `${brandId}:${asin.toUpperCase()}`;
}

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export function companyKey(brandId: string, domain: string | null): string {
  return `${brandId}:${domain ? normalizeDomain(domain) : "no-domain"}`;
}

export function decisionMakerKey(companyId: string, name: string, jobTitle: string): string {
  return `${companyId}:${name.trim().toLowerCase()}:${jobTitle.trim().toLowerCase()}`;
}

export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}
