/**
 * reddit-mention-monitor
 *
 * Read-only keyword monitor for public Reddit posts. It authenticates with
 * application-only OAuth (grant_type=client_credentials), which carries no
 * user identity and no write scopes, and calls exactly two kinds of endpoint:
 *
 *   GET /search            (site-wide search, newest first)
 *   GET /r/{sub}/new       (a subreddit's public listing)
 *
 * It never posts, comments, votes, messages, or touches any account.
 */

export interface MonitorConfig {
  clientId: string;
  clientSecret: string;
  /** Reddit requires a unique, descriptive User-Agent: "<app>/<version> (by /u/<username>)" */
  userAgent: string;
  /** Optional token cache so a token is reused until it expires. */
  cache?: TokenCache;
}

export interface TokenCache {
  get(): Promise<AppToken | null>;
  set(token: AppToken, ttlSeconds: number): Promise<void>;
}

export interface AppToken {
  access_token: string;
  expires_at: number;
}

export interface Mention {
  url: string;
  title: string;
  excerpt: string;
  author: string;
  subreddit: string;
  created: Date;
  commentCount: number;
  matchedQuery: string;
}

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API = "https://oauth.reddit.com";
/** Reddit allows 60 requests per minute for OAuth clients; stay well under it. */
const REQUEST_GAP_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Application-only OAuth. No user is involved, so there are no user scopes to grant. */
export async function getAppToken(cfg: MonitorConfig): Promise<string> {
  const cached = await cfg.cache?.get();
  if (cached && cached.expires_at > Date.now() + 60_000) return cached.access_token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": cfg.userAgent,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`reddit token error: ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  const token: AppToken = { access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 };
  await cfg.cache?.set(token, Math.max(60, j.expires_in - 60));
  return token.access_token;
}

interface Listing {
  data?: { children?: Array<{ data: Record<string, unknown> }> };
}

function toMentions(listing: Listing, matchedQuery: string): Mention[] {
  return (listing.data?.children ?? []).map(({ data: d }) => ({
    url: `https://www.reddit.com${d.permalink as string}`,
    title: (d.title as string) ?? "",
    excerpt: `${(d.title as string) ?? ""} ${(d.selftext as string) ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 300),
    author: (d.author as string) ?? "",
    subreddit: (d.subreddit as string) ?? "",
    created: new Date(((d.created_utc as number) ?? 0) * 1000),
    commentCount: (d.num_comments as number) ?? 0,
    matchedQuery,
  }));
}

async function get(cfg: MonitorConfig, token: string, path: string, params: Record<string, string>): Promise<Listing> {
  const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}`, "user-agent": cfg.userAgent },
  });
  if (res.status === 429) throw new Error("rate limited by reddit; back off and retry on the next scheduled run");
  if (!res.ok) return {};
  return (await res.json()) as Listing;
}

/** GET /search: public posts from the last week matching one query, newest first. */
export async function search(cfg: MonitorConfig, token: string, query: string, limit = 25): Promise<Mention[]> {
  return toMentions(await get(cfg, token, "/search", { q: query, sort: "new", t: "week", type: "link", limit: String(limit), raw_json: "1" }), query);
}

/** GET /r/{subreddit}/new: a subreddit's newest public posts. */
export async function listNew(cfg: MonitorConfig, token: string, subreddit: string, limit = 25): Promise<Mention[]> {
  const name = subreddit.replace(/^\/?r\//i, "").replace(/[^A-Za-z0-9_]/g, "");
  return toMentions(await get(cfg, token, `/r/${name}/new`, { limit: String(limit), raw_json: "1" }), `r/${name}`);
}

/**
 * One polling pass: run every query, drop anything matching a negative
 * pattern, deduplicate by URL. Requests are serialized with a gap between
 * them so a pass never bursts.
 */
export async function poll(cfg: MonitorConfig, queries: string[], negativePatterns: string[] = []): Promise<Mention[]> {
  const token = await getAppToken(cfg);
  const neg = negativePatterns.length ? new RegExp(negativePatterns.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i") : null;
  const seen = new Set<string>();
  const out: Mention[] = [];
  for (const q of queries) {
    let found: Mention[] = [];
    try {
      found = await search(cfg, token, q);
    } catch {
      break; // rate limited: stop this pass, the next scheduled run picks up
    }
    for (const m of found) {
      if (seen.has(m.url)) continue;
      seen.add(m.url);
      if (neg && neg.test(`${m.title} ${m.excerpt}`)) continue;
      out.push(m);
    }
    await sleep(REQUEST_GAP_MS);
  }
  return out;
}
