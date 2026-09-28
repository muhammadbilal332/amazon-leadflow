import type { DiscoveredCompany, DiscoveredDecisionMaker, LeadProvider, ProviderResult } from "@/lib/providers/types";
import type { ProviderStatus } from "@/types/database";

type PlaywrightModule = typeof import("playwright");
type Page = import("playwright").Page;

const NAV_TIMEOUT_MS = 15_000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ABOUT_LINK_RE = /\babout\b/i;
const CONTACT_LINK_RE = /\bcontact\b/i;
const TEAM_LINK_RE = /\b(team|leadership|management|our-team|our team|about-us|about us)\b/i;

/** Roles the business cares about for lead-gen. Matched against page text —
 * never invented. Kept in one place so findDecisionMakers' regex and its
 * roleCategory mapping can't drift apart. */
const ROLE_PATTERNS: Array<{ re: RegExp; role: string }> = [
  { re: /\bco-?founders?\b/i, role: "FOUNDER" },
  { re: /\bfounders?\s*(&|and)\s*ceo\b/i, role: "FOUNDER" },
  { re: /\bfounders?\b/i, role: "FOUNDER" },
  { re: /\bceo\b|chief executive officer/i, role: "EXECUTIVE" },
  { re: /\bowners?\b/i, role: "FOUNDER" },
  { re: /\bpresidents?\b/i, role: "EXECUTIVE" },
  { re: /managing directors?/i, role: "EXECUTIVE" },
  { re: /general managers?/i, role: "EXECUTIVE" },
  { re: /head of e-?commerce/i, role: "ECOMMERCE" },
  { re: /e-?commerce directors?/i, role: "ECOMMERCE" },
  { re: /marketing directors?/i, role: "MARKETING" },
  { re: /head of marketing/i, role: "MARKETING" },
  { re: /brand managers?/i, role: "MARKETING" },
];

/** Common sentence-leading words that can accidentally satisfy the
 * capitalized-word shape the name pattern looks for (e.g. "I'm Jason
 * Fried, one of the co-founders" on a narrative About page) but are never
 * themselves part of a person's name. Stripped from the front of a
 * captured name rather than discarding the whole match, so real names in
 * prose text (not just structured team-page listings) still come through
 * cleanly. */
const NAME_LEADING_FILLER_WORDS = new Set(["im", "i", "were", "we", "this", "that", "our", "my", "the", "a", "an", "its"]);

/** Matches "Firstname Lastname, Title" / "Firstname Lastname - Title" /
 * "Firstname Lastname | Title" style patterns commonly found on team pages,
 * with the title clause capturing up to the next line break or separator,
 * and an optional trailing ", short headline" clause (e.g. "Jane Doe -
 * Marketing Director, obsessed with brand storytelling"). */
const NAME_TITLE_RE =
  /([A-Z][a-zA-Z'’-]+(?:\s[A-Z][a-zA-Z'’-]+){1,2})\s*[,\-|–]\s*([A-Za-z][A-Za-z &/'-]{2,60})(?:,\s*([^\n]{3,120}))?/g;

/** A whole line that looks like a person's name — 2-3 title-case words,
 * nothing else. Used for the "stacked" team-page layout (name, then title,
 * then location, each on its own line/paragraph — no inline separator —
 * e.g. Buffer's real /about page). Rejects ALL-CAPS lines (section
 * headings like "ABOUT US") since real names aren't written that way. */
const NAME_LINE_RE = /^[A-Z][a-zA-Z'’.À-ſ-]+(?:\s[A-Z][a-zA-Z'’.À-ſ-]+){1,2}$/;

/** A whole line that looks like "City, ST"/"City, Country" — used to
 * recognize a location line immediately following a stacked name+title. */
const LOCATION_LINE_RE = /^[A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?,\s?[A-Za-z.]+$/;

interface CandidateMatch {
  name: string;
  title: string;
  role: string;
  linkedinUrl: string | null;
  headline: string | null;
  /** Person-specific location, when the layout itself provided one (the
   * "stacked" team-listing case) — takes priority over company.location. */
  location: string | null;
  evidence: string;
  matchKind: "inline" | "stacked";
}

interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  linkedinLinks: Array<{ href: string; nearbyText: string }>;
  internalLinks: Array<{ href: string; text: string }>;
  /** Business contact info published directly on this page — mailto:/tel:
   * links only, never a guessed address. */
  mailtoEmails: string[];
  telPhones: string[];
  /** Best-effort: an `industry`-like field from this page's
   * application/ld+json Organization markup, if the site publishes one.
   * schema.org has no universally-used "industry" property on
   * Organization, so this is genuinely absent on most sites — null, never
   * guessed from prose. */
  jsonLdIndustry: string | null;
}

/** Real, browser-based company + decision-maker research: no API key, no
 * LinkedIn automation (LinkedIn's Terms of Service prohibit automated
 * scraping, and public access to search/profile pages is gated behind a
 * login wall in practice — see docs/PROVIDERS.md). Sourced entirely from
 * the company's own public website (homepage, About, Contact, Team/
 * Leadership pages). Never fabricates a company, person, or title —
 * returns SUCCESS with null/[] when nothing verifiable is found. */
export class PlaywrightLeadProvider implements LeadProvider {
  readonly name = "playwright-lead";

  status(): ProviderStatus {
    return "CONFIGURED";
  }

  /** Corporate-entity suffixes people often search with (the exact legal
   * name, not the consumer-facing brand — e.g. "Revlon Consumer Products
   * Corp." instead of "Revlon"). Stripped from the end, longest phrase
   * first, so guessDomainCandidates() can also try the real, much shorter
   * brand name a domain is actually registered under. Purely a smarter
   * guess, not a data source — the result is still verified against the
   * live page before being trusted (see pageMentionsBrand). */
  private static readonly CORPORATE_SUFFIX_PHRASES = [
    "consumer products corporation",
    "consumer products corp.",
    "consumer products corp",
    "consumer products llc",
    "consumer products inc.",
    "consumer products inc",
    "consumer products",
    "incorporated",
    "corporation",
    "l.l.c.",
    "llc",
    "corp.",
    "corp",
    "ltd.",
    "ltd",
    "limited",
    "company",
    "co.",
    "group",
    "holdings",
    "enterprises",
    "international",
    "worldwide",
    "plc",
    "inc.",
    "inc",
  ];

  private coreBrandName(brand: string): string {
    let name = brand.trim();
    let changed = true;
    while (changed) {
      changed = false;
      for (const suffix of PlaywrightLeadProvider.CORPORATE_SUFFIX_PHRASES) {
        const re = new RegExp(`\\s+${suffix.replace(/\./g, "\\.")}$`, "i");
        if (re.test(name)) {
          name = name.replace(re, "").trim();
          changed = true;
          break;
        }
      }
    }
    return name || brand.trim();
  }

  private compactDomain(s: string): string {
    return `${s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`;
  }

  /** Ordered, deduped domain guesses — most-likely-correct first. For a
   * simple one-word brand these all collapse to the same single guess
   * (existing behavior, unchanged). For a verbose legal-entity name like
   * "Revlon Consumer Products Corp.", the core/first-word candidates try
   * "revlon.com" before the old always-wrong
   * "revlonconsumerproductscorp.com" guess. Every candidate is still
   * navigated to and verified for real — this never assumes a guess is
   * correct just because it's first in the list. */
  private guessDomainCandidates(brand: string): string[] {
    const core = this.coreBrandName(brand);
    const firstWordOfCore = core.split(/\s+/)[0] ?? core;
    const firstWordOfOriginal = brand.trim().split(/\s+/)[0] ?? brand;
    const candidates = [firstWordOfCore, core, firstWordOfOriginal, brand].map((c) => this.compactDomain(c));
    return Array.from(new Set(candidates));
  }

  private async loadPlaywright(): Promise<{ ok: true; mod: PlaywrightModule } | { ok: false; errorMessage: string }> {
    try {
      const mod = await import("playwright");
      return { ok: true, mod };
    } catch (err) {
      return {
        ok: false,
        errorMessage:
          "playwright package not installed. Run: npm install, then: npm run playwright:install " +
          `(${err instanceof Error ? err.message : "unknown error"})`,
      };
    }
  }

  async findCompany(brand: string, website: string | null): Promise<ProviderResult<DiscoveredCompany | null>> {
    const start = Date.now();
    const loaded = await this.loadPlaywright();
    if (!loaded.ok) {
      return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: loaded.errorMessage };
    }

    let browser: Awaited<ReturnType<PlaywrightModule["chromium"]["launch"]>> | null = null;
    try {
      browser = await loaded.mod.chromium.launch({ headless: true });
      const context = await browser.newContext({ userAgent: USER_AGENT });
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

      const core = this.coreBrandName(brand);
      const candidateUrls = website ? [website] : this.guessDomainCandidates(brand).map((d) => `https://www.${d}`);

      let home: PageSnapshot | null = null;
      for (const candidateUrl of candidateUrls) {
        const snap = await this.snapshot(page, candidateUrl).catch(() => null);
        // Verified against the core brand name (legal-entity suffixes
        // stripped), not the raw input — a real company's own site says
        // "Revlon", not "Revlon Consumer Products Corp." A domain that
        // merely resolves is never trusted without this check.
        if (snap && this.pageMentionsBrand(snap, core)) {
          home = snap;
          break;
        }
      }
      if (!home) {
        // Every candidate either failed to navigate (no such site, DNS
        // failure, timeout) or didn't verify — honestly nothing found, not
        // an error worth surfacing as a bug.
        return { status: "SUCCESS", data: null, durationMs: Date.now() - start, requestIdentifier: `playwright-lead:${candidateUrls.join(",")}` };
      }

      const sources = [home.url];
      const finalUrl = new URL(home.url);
      const domain = finalUrl.hostname.replace(/^www\./, "");

      let description: string | null = null;
      let location: string | null = null;
      let foundedYear: string | null = null;
      let industry: string | null = home.jsonLdIndustry;
      let contactUrl: string | null = null;
      let publicBusinessEmail: string | null = null;
      let publicBusinessPhone: string | null = null;

      const aboutHref = this.findLink(home, ABOUT_LINK_RE);
      if (aboutHref) {
        const about = await this.snapshot(page, aboutHref).catch(() => null);
        if (about) {
          sources.push(about.url);
          description = this.firstParagraph(about.text);
          foundedYear = this.extractFoundedYear(about.text);
          location = location ?? this.extractLocation(about.text);
          industry = industry ?? about.jsonLdIndustry;
        }
      }

      const contactHref = this.findLink(home, CONTACT_LINK_RE);
      if (contactHref) {
        const contact = await this.snapshot(page, contactHref).catch(() => null);
        if (contact) {
          sources.push(contact.url);
          contactUrl = contact.url;
          location = location ?? this.extractLocation(contact.text);
          // Only ever a mailto:/tel: link the site itself published — never
          // a plain-text regex guess, and never a specific person's
          // address (that stays WF_07/EmailProvider's job).
          publicBusinessEmail = contact.mailtoEmails[0] ?? null;
          publicBusinessPhone = contact.telPhones[0] ?? null;
        }
      }

      description = description ?? this.firstParagraph(home.text);
      location = location ?? this.extractLocation(home.text);
      publicBusinessEmail = publicBusinessEmail ?? home.mailtoEmails[0] ?? null;
      publicBusinessPhone = publicBusinessPhone ?? home.telPhones[0] ?? null;

      const company: DiscoveredCompany = {
        name: this.extractCompanyName(home, core) ?? core,
        domain,
        website: `${finalUrl.protocol}//${finalUrl.hostname}`,
        description,
        // Not reliably derivable from a public marketing site — never
        // fabricated.
        employeeRange: null,
        location,
        // Never populated here — no LinkedIn automation (see class doc).
        linkedinUrl: null,
        industry,
        foundedYear,
        contactUrl,
        publicBusinessEmail,
        publicBusinessPhone,
        sources,
      };

      return { status: "SUCCESS", data: company, durationMs: Date.now() - start, requestIdentifier: `playwright-lead:${domain}` };
    } catch (err) {
      return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: err instanceof Error ? err.message : "unknown error" };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  async findDecisionMakers(company: DiscoveredCompany): Promise<ProviderResult<DiscoveredDecisionMaker[]>> {
    const start = Date.now();
    if (!company.website) {
      return { status: "SUCCESS", data: [], durationMs: Date.now() - start };
    }

    const loaded = await this.loadPlaywright();
    if (!loaded.ok) {
      return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: loaded.errorMessage };
    }

    let browser: Awaited<ReturnType<PlaywrightModule["chromium"]["launch"]>> | null = null;
    try {
      browser = await loaded.mod.chromium.launch({ headless: true });
      const context = await browser.newContext({ userAgent: USER_AGENT });
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

      const home = await this.snapshot(page, company.website).catch(() => null);
      if (!home) {
        return { status: "SUCCESS", data: [], durationMs: Date.now() - start };
      }

      const candidatePages: PageSnapshot[] = [home];
      const teamHref = this.findLink(home, TEAM_LINK_RE);
      if (teamHref) {
        const team = await this.snapshot(page, teamHref).catch(() => null);
        if (team) candidatePages.push(team);
      }
      const aboutHref = this.findLink(home, ABOUT_LINK_RE);
      if (aboutHref && aboutHref !== teamHref) {
        const about = await this.snapshot(page, aboutHref).catch(() => null);
        if (about) candidatePages.push(about);
      }

      const found = new Map<string, DiscoveredDecisionMaker>();
      for (const snap of candidatePages) {
        const candidates = [...this.extractNameTitlePairs(snap), ...this.extractStackedNameTitleBlocks(snap)];
        for (const match of candidates) {
          const key = match.name.toLowerCase();
          const existing = found.get(key);
          // Confidence reflects two independent, documented signals: a
          // dedicated Team/Leadership page is stronger evidence than a
          // mention buried in general About-page prose, and a structured
          // "Name / Title / Location" team-listing block (matchKind
          // "stacked") is stronger evidence than a name/title mention
          // inline in a sentence (matchKind "inline") — never a guessed
          // number, always one of these four fixed, documented values.
          const isDedicatedPage = snap !== home;
          const confidence = isDedicatedPage ? (match.matchKind === "stacked" ? 0.9 : 0.85) : match.matchKind === "stacked" ? 0.75 : 0.6;
          if (!existing || confidence > existing.confidence) {
            found.set(key, {
              name: match.name,
              jobTitle: match.title,
              roleCategory: match.role,
              linkedinUrl: match.linkedinUrl,
              linkedinStatus: match.linkedinUrl ? "FOUND" : "NOT_FOUND",
              location: match.location ?? company.location,
              confidence,
              headline: match.headline,
              sources: [snap.url],
              evidence: [match.evidence],
            });
          }
        }
      }

      const people = Array.from(found.values())
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 8);

      return { status: "SUCCESS", data: people, durationMs: Date.now() - start, requestIdentifier: `playwright-lead:${company.domain ?? company.website}` };
    } catch (err) {
      return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: err instanceof Error ? err.message : "unknown error" };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  private async snapshot(page: Page, url: string): Promise<PageSnapshot> {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const title = (await page.title()) || "";
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    const linkedinLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="linkedin.com/in/"]'));
      return anchors.map((a) => ({
        href: a.href,
        nearbyText: (a.closest("li,article,div,section")?.textContent ?? a.textContent ?? "").trim().slice(0, 300),
      }));
    });
    const internalLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
      return anchors
        .map((a) => ({ href: a.href, text: (a.textContent ?? "").trim() }))
        .filter((l) => l.href.startsWith(window.location.origin));
    });
    const { mailtoEmails, telPhones } = await page.evaluate(() => {
      const mailtos = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]'))
        .map((a) => (a.getAttribute("href") ?? "").replace(/^mailto:/i, "").split("?")[0].trim())
        .filter(Boolean);
      const tels = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"]'))
        .map((a) => (a.getAttribute("href") ?? "").replace(/^tel:/i, "").trim())
        .filter(Boolean);
      return { mailtoEmails: mailtos, telPhones: tels };
    });
    const jsonLdIndustry = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const script of scripts) {
        try {
          const parsed = JSON.parse(script.textContent ?? "");
          const items = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of items) {
            const type = (item as Record<string, unknown>)?.["@type"];
            const isOrg = type === "Organization" || type === "Corporation" || (Array.isArray(type) && type.includes("Organization"));
            const industry = (item as Record<string, unknown>)?.industry;
            if (isOrg && typeof industry === "string" && industry.trim()) return industry.trim();
          }
        } catch {
          continue;
        }
      }
      return null;
    });
    return { url: page.url(), title, text, linkedinLinks, internalLinks, mailtoEmails, telPhones, jsonLdIndustry };
  }

  private pageMentionsBrand(snap: PageSnapshot, brand: string): boolean {
    // Deliberately does NOT check snap.url: when the candidate URL came from
    // guessDomain(brand), the URL trivially "contains" the brand by
    // construction and would verify nothing. Content is the only honest
    // signal that the guessed domain is actually this brand's site.
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const needle = normalize(brand);
    if (!needle) return false;
    return normalize(snap.title).includes(needle) || normalize(snap.text.slice(0, 2000)).includes(needle);
  }

  /** Picks the first line that reads like real prose, not a run-together
   * nav menu (real sites' `innerText` sometimes concatenates nav items
   * with no separators, e.g. "NEWFACELIPSEYESBEAUTY TOOLSHAIRNAILS..." —
   * observed on a real site during testing, not hypothetical). Rejects
   * ALL-CAPS lines (nav/heading convention, not prose) and lines whose
   * average "word" is implausibly long for English prose (a real sentence
   * has a space roughly every 5-6 characters; concatenated menu items
   * don't). */
  private firstParagraph(text: string): string | null {
    const cleaned = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => {
        if (l.length <= 40 || !/[a-z]/i.test(l)) return false;
        if (l === l.toUpperCase()) return false;
        const wordCount = l.split(/\s+/).filter(Boolean).length;
        return wordCount >= l.length / 12;
      });
    return cleaned.length > 0 ? cleaned[0].slice(0, 500) : null;
  }

  private extractFoundedYear(text: string): string | null {
    const match = text.match(/\b(?:founded|established|since)\s+(?:in\s+)?((?:19|20)\d{2})\b/i);
    return match ? match[1] : null;
  }

  private extractLocation(text: string): string | null {
    const match = text.match(/\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?),\s([A-Z]{2})\b/);
    return match ? `${match[1]}, ${match[2]}` : null;
  }

  /** Titles aren't always "Brand | Tagline" — plenty of real sites are
   * "Tagline | Brand" instead (e.g. Revlon's real title is "Makeup, Hair
   * Color, Nails, Beauty Products & Tools | Revlon – Revlon US"). When a
   * verified core brand name is available, prefer whichever segment
   * actually contains it over blindly assuming the first segment is the
   * name. Falls back to the first segment when no segment matches (or no
   * hint was given) — still real text from the page, never invented. */
  private extractCompanyName(snap: PageSnapshot, preferredMatch?: string): string | null {
    if (!snap.title) return null;
    const segments = snap.title
      .split(/[|–-]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) return null;

    if (preferredMatch) {
      const needle = preferredMatch.toLowerCase();
      const match = segments.find((s) => s.toLowerCase() === needle) ?? segments.find((s) => s.toLowerCase().includes(needle));
      if (match) return match;
    }
    return segments[0];
  }

  private findLink(snap: PageSnapshot, re: RegExp): string | null {
    const match = snap.internalLinks.find((l) => re.test(l.text) || re.test(l.href));
    return match ? match.href : null;
  }

  private extractNameTitlePairs(snap: PageSnapshot): CandidateMatch[] {
    const results: CandidateMatch[] = [];
    const text = snap.text;
    let match: RegExpExecArray | null;
    NAME_TITLE_RE.lastIndex = 0;
    while ((match = NAME_TITLE_RE.exec(text)) !== null) {
      const name = this.stripLeadingFillerWords(match[1].trim());
      if (!name) continue;
      const titleCandidate = match[2].trim();
      const rolePattern = ROLE_PATTERNS.find((p) => p.re.test(titleCandidate));
      if (!rolePattern) continue;

      const linkedin = snap.linkedinLinks.find((l) => l.nearbyText.toLowerCase().includes(name.toLowerCase()));
      const headline = match[3]?.trim() || null;
      results.push({
        name,
        title: titleCandidate,
        role: rolePattern.role,
        linkedinUrl: linkedin?.href ?? null,
        headline,
        location: null,
        evidence: match[0].trim(),
        matchKind: "inline",
      });
    }
    return results;
  }

  /** Handles the "stacked" team-page layout — name, title, and location each
   * on their own line/paragraph with no inline separator (e.g. Buffer's
   * real /about page: "Joel Gascoigne" / "CEO & Co-Founder" / "Chicago,
   * USA"). See NAME_LINE_RE/LOCATION_LINE_RE. The ROLE_PATTERNS check on
   * the line immediately after a name-shaped line is what keeps this from
   * matching arbitrary two/three-word capitalized headings — a title-case
   * heading is never followed by a line that itself reads as one of the
   * fixed business-role phrases. */
  private extractStackedNameTitleBlocks(snap: PageSnapshot): CandidateMatch[] {
    const results: CandidateMatch[] = [];
    const lines = snap.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (let i = 0; i < lines.length - 1; i++) {
      const nameLine = lines[i];
      if (nameLine === nameLine.toUpperCase() || !NAME_LINE_RE.test(nameLine)) continue;
      const name = this.stripLeadingFillerWords(nameLine);
      if (!name || name.split(/\s+/).length < 2) continue;

      const titleLine = lines[i + 1];
      const rolePattern = ROLE_PATTERNS.find((p) => p.re.test(titleLine));
      if (!rolePattern) continue;

      const maybeLocation = lines[i + 2];
      const location = maybeLocation && LOCATION_LINE_RE.test(maybeLocation) ? maybeLocation : null;
      const linkedin = snap.linkedinLinks.find((l) => l.nearbyText.toLowerCase().includes(name.toLowerCase()));
      results.push({
        name,
        title: titleLine,
        role: rolePattern.role,
        linkedinUrl: linkedin?.href ?? null,
        headline: null,
        location,
        evidence: [nameLine, titleLine, location].filter(Boolean).join(" / "),
        matchKind: "stacked",
      });
    }
    return results;
  }

  /** Drops leading words like "I'm"/"We" from a captured name — see
   * NAME_LEADING_FILLER_WORDS. Only strips from the front, and only when at
   * least one word remains, so real multi-word names are untouched. */
  private stripLeadingFillerWords(name: string): string {
    const words = name.split(/\s+/);
    while (words.length > 1 && NAME_LEADING_FILLER_WORDS.has(words[0].toLowerCase().replace(/[^a-z]/g, ""))) {
      words.shift();
    }
    return words.join(" ");
  }
}
