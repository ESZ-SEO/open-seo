import { env } from "cloudflare:workers";
import { AppError } from "@/server/lib/errors";

// Abuse bounds on agent-triggered report renders. A render is not metered
// against anybody's credit balance — see the METERING block at the top of
// `reports/keywords-report.ts` — so the DataForSEO fan-out behind one render
// lands on our own bill with nothing to stop it. An agent looping on a bad
// prompt or a bug is therefore a money leak, and these two fixed windows are
// the brake: the hourly one catches a runaway loop within minutes, the daily
// one caps what a slow leak can do while nobody is watching.
//
// Modelled on `auth/invitation-send-limit.ts`: KV is the only counter that
// holds across Workers isolates, and the fixed-window keys expire on their
// own. KV writes race under concurrency, so treat these as abuse bounds, not
// exact quotas — two simultaneous renders can both read the same count.
const PER_ORG_HOURLY_LIMIT = 20;
const PER_ORG_DAILY_LIMIT = 100;
const HOUR_TTL_SECONDS = 60 * 60;
const DAY_TTL_SECONDS = 60 * 60 * 24;

async function bumpCounter(key: string, limit: number, ttlSeconds: number) {
  const count = Number((await env.KV.get(key)) ?? "0");
  if (count >= limit) return false;
  await env.KV.put(key, String(count + 1), { expirationTtl: ttlSeconds });
  return true;
}

/**
 * Spend one render from the organization's budget, or refuse. Call it after
 * the caller is authorized and before anything is rendered: the whole point is
 * to stop the spend, and a check that runs after `renderReport` has already
 * paid for the data protects nothing.
 */
export async function consumeRenderBudget(
  organizationId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const day = now.slice(0, 10); // YYYY-MM-DD
  const hour = now.slice(0, 13); // YYYY-MM-DDTHH

  if (
    !(await bumpCounter(
      `render-budget:${organizationId}:${hour}`,
      PER_ORG_HOURLY_LIMIT,
      HOUR_TTL_SECONDS,
    ))
  ) {
    throw new AppError(
      "RATE_LIMITED",
      `This organization has rendered ${PER_ORG_HOURLY_LIMIT} report images in the past hour, which is the protection limit that stops a runaway loop from spending on report data. Rendering resumes at the top of the next hour; images already rendered are still available from their links.`,
    );
  }
  if (
    !(await bumpCounter(
      `render-budget:${organizationId}:${day}`,
      PER_ORG_DAILY_LIMIT,
      DAY_TTL_SECONDS,
    ))
  ) {
    throw new AppError(
      "RATE_LIMITED",
      `This organization has rendered ${PER_ORG_DAILY_LIMIT} report images today, which is the daily protection limit on report-image spend. Rendering resumes after 00:00 UTC; images already rendered are still available from their links.`,
    );
  }
}
