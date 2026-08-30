/**
 * Optional Durable Object for atomic rate-limit counters.
 * Bind in wrangler.toml and set RATE_LIMITER_DO. Counters stored here are
 * strongly consistent and atomic (per key), preferable to KV for burst accuracy.
 *
 * Usage wrangler.toml:
 *   [durable_objects]
 *   bindings = [{ name = "RATE_LIMITER_DO", class_name = "RateLimiterDO" }]
 *   [[migrations]]
 *   new_classes = ["RateLimiterDO"]
 *
 * Then `checkRateLimit` will prefer DO over KV automatically.
 */

export class RateLimiterDO implements DurableObject {
  private counts = new Map<string, { count: number; expiresAt: number }>();

  constructor(
    private state: DurableObjectState,
    private env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    try {
      const { key, ttlSec } = (await request.json()) as { key: string; ttlSec: number };
      if (!key || typeof ttlSec !== 'number') {
        return new Response(JSON.stringify({ error: 'missing key/ttlSec' }), { status: 400 });
      }
      const now = Date.now();
      const entry = this.counts.get(key);
      let count: number;
      if (!entry || entry.expiresAt <= now) {
        count = 1;
        this.counts.set(key, { count, expiresAt: now + ttlSec * 1000 });
      } else {
        count = entry.count + 1;
        entry.count = count;
        this.counts.set(key, entry);
      }
      // Cleanup expired keys occasionally to bound memory
      if (this.counts.size > 10000) {
        for (const [k, v] of this.counts) {
          if (v.expiresAt <= now) this.counts.delete(k);
        }
      }
      return new Response(JSON.stringify({ count }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
    }
  }
}
