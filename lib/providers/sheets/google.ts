import type { ProviderResult, SheetsExportRow, SheetsProvider } from "@/lib/providers/types";
import type { ProviderStatus } from "@/types/database";

const HEADER = [
  "Brand",
  "Amazon Product",
  "ASIN",
  "Amazon URL",
  "Private Label Classification",
  "Confidence",
  "Audit Score",
  "Major Issues",
  "Company",
  "Decision Maker",
  "Job Title",
  "LinkedIn URL",
  "Email",
  "Email Status",
  "Research Date",
];

/** Google Sheets API is free to use, but requires an OAuth app + refresh
 * token the user must obtain themselves. We never fail the whole request
 * when it's missing — callers should treat GOOGLE_SHEETS_NOT_CONFIGURED as
 * a normal, expected outcome.
 *
 * Talks to the Sheets/OAuth REST APIs directly instead of depending on the
 * `googleapis` SDK — that package is enormous (it bundles types/clients
 * for every Google API, not just Sheets) and, since this provider used to
 * be imported transitively by the registry that almost every page reaches
 * through the orchestrator, it was inflating dev-server compile times and
 * the production bundle for routes that never touch Sheets at all. */
export class GoogleSheetsProvider implements SheetsProvider {
  readonly name = "google-sheets";

  private get configured(): boolean {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN,
    );
  }

  status(): ProviderStatus {
    return this.configured ? "CONFIGURED" : "NOT_CONFIGURED";
  }

  private async getAccessToken(): Promise<string> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN as string,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Google OAuth token refresh failed: HTTP ${res.status}`);
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error("Google OAuth token refresh returned no access_token");
    return json.access_token;
  }

  async exportRows(title: string, rows: SheetsExportRow[]): Promise<ProviderResult<{ spreadsheetUrl: string }>> {
    const start = Date.now();
    if (!this.configured) {
      return {
        status: "SKIPPED_DISABLED",
        data: null,
        durationMs: Date.now() - start,
        errorMessage: "GOOGLE_SHEETS_NOT_CONFIGURED",
      };
    }

    try {
      const accessToken = await this.getAccessToken();
      const authHeader = { Authorization: `Bearer ${accessToken}` };

      const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { title } }),
      });
      if (!createRes.ok) {
        return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: `Sheets create HTTP ${createRes.status}` };
      }
      const created = (await createRes.json()) as { spreadsheetId?: string };
      const spreadsheetId = created.spreadsheetId;
      if (!spreadsheetId) {
        return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: "No spreadsheetId returned" };
      }

      const values = [HEADER, ...rows.map(rowToArray)];
      const updateRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1?valueInputOption=RAW`,
        {
          method: "PUT",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ values }),
        },
      );
      if (!updateRes.ok) {
        return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: `Sheets values update HTTP ${updateRes.status}` };
      }

      return {
        status: "SUCCESS",
        data: { spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` },
        durationMs: Date.now() - start,
        requestIdentifier: `google-sheets:${spreadsheetId}`,
      };
    } catch (err) {
      return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: err instanceof Error ? err.message : "unknown error" };
    }
  }
}

function rowToArray(row: SheetsExportRow): string[] {
  return [
    row.brand,
    row.amazonProduct,
    row.asin,
    row.amazonUrl,
    row.classification,
    String(row.confidence),
    String(row.auditScore),
    row.majorIssues,
    row.company,
    row.decisionMaker,
    row.jobTitle,
    row.linkedinUrl,
    row.email,
    row.emailStatus,
    row.researchDate,
  ];
}
