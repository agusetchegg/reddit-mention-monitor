# reddit-mention-monitor

A small, read-only keyword monitor for public Reddit posts. It tells a solo developer when someone publicly asks for the kind of tool they build, so a human can decide whether to reply from their own account.

## What it does, exactly

- **Read-only.** Every Reddit API call is an HTTP `GET`. The only `POST` is the OAuth token request.
- **Search and listing endpoints only.** It calls `GET /search` and `GET /r/{subreddit}/new`. Nothing else.
- **No write scopes anywhere.** It authenticates with application-only OAuth (`grant_type=client_credentials`). No user logs in, no user scopes are requested, and the token cannot post, comment, vote, message, subscribe, or edit anything.
- **Polls a few times daily.** The default schedule is one pass every 6 hours (4 per day). A pass runs a short list of search queries, one request at a time with a 1.1 second gap, far under Reddit's 60 requests per minute limit. On a 429 it stops the pass and waits for the next scheduled run.
- **Public data only.** It reads public posts from the last week. It does not read private subreddits, direct messages, user profiles, or anything behind a login.
- **No automation of replies.** It produces a list of matching posts. It never posts, comments, votes, or sends messages. Any reply is written and sent by a person.

## What it stores

Per matching post: URL, title, a 300 character excerpt, author name, subreddit, created time, comment count, and the query that matched. No content is republished, used to train models, or sold. The OAuth token is cached until it expires.

## Use

```ts
import { poll } from "./src/index";

const mentions = await poll(
  {
    clientId: process.env.REDDIT_CLIENT_ID!,
    clientSecret: process.env.REDDIT_CLIENT_SECRET!,
    userAgent: process.env.REDDIT_USER_AGENT!, // "<app>/<version> (by /u/<your-username>)"
  },
  ["self-destructing file link", "temporary file sharing link"], // queries
  ["hiring", "homework"], // negative patterns, matched against title + excerpt
);
```

`examples/worker.ts` shows the same thing as a Cloudflare Worker on a `0 */6 * * *` cron with the token cached in KV.

## Configuration

| Variable | Purpose |
|---|---|
| `REDDIT_CLIENT_ID` | Client id of your own Reddit app |
| `REDDIT_CLIENT_SECRET` | Client secret of your own Reddit app |
| `REDDIT_USER_AGENT` | Unique descriptive User-Agent, as Reddit's API rules require |

No dependencies. Runs anywhere `fetch` exists: Node 18+, Cloudflare Workers, Deno, Bun.

## License

MIT
