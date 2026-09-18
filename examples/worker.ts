// Example: Cloudflare Worker on a cron trigger, four passes a day.
//
// wrangler.jsonc:
//   "triggers": { "crons": ["0 */6 * * *"] }
// secrets: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT
import { poll, type AppToken } from "../src/index";

interface Env {
  REDDIT_CLIENT_ID: string;
  REDDIT_CLIENT_SECRET: string;
  REDDIT_USER_AGENT: string;
  KV: { get(key: string, type: "json"): Promise<AppToken | null>; put(key: string, value: string, opts: { expirationTtl: number }): Promise<void> };
}

export default {
  async scheduled(_e: unknown, env: Env) {
    const mentions = await poll(
      {
        clientId: env.REDDIT_CLIENT_ID,
        clientSecret: env.REDDIT_CLIENT_SECRET,
        userAgent: env.REDDIT_USER_AGENT,
        cache: { get: () => env.KV.get("reddit-app-token", "json"), set: (t, ttl) => env.KV.put("reddit-app-token", JSON.stringify(t), { expirationTtl: ttl }) },
      },
      ["self-destructing file link", "temporary file sharing link"],
      ["hiring", "homework"],
    );
    console.log(`${mentions.length} new public posts matched`);
  },
};
