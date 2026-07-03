import type { CloudflareProduct, KnowledgeSource } from "./types";

type ProductRule = {
  product: CloudflareProduct;
  keywords: string[];
};

export const PRODUCT_RULES: ProductRule[] = [
  { product: "Workers", keywords: ["worker", "workers", "fetch handler", "compatibility_date", "service binding"] },
  { product: "Pages", keywords: ["pages", "pages build", "pages function", "preview deployment"] },
  { product: "DNS", keywords: ["dns", "nameserver", "nxdomain", "cname", "a record", "txt record", "proxied"] },
  { product: "SSL/TLS", keywords: ["ssl", "tls", "certificate", "too many redirects", "525", "526", "full strict"] },
  { product: "WAF", keywords: ["waf", "firewall", "managed rule", "blocked", "security event", "403"] },
  { product: "Cache", keywords: ["cache", "cached", "purge", "cache rule", "stale"] },
  { product: "R2", keywords: ["r2", "bucket", "object storage", "s3 compatible", "cors"] },
  { product: "D1", keywords: ["d1", "sqlite", "database_id", "env.db", "binding db"] },
  { product: "KV", keywords: ["kv", "namespace", "eventual consistency", "key-value"] },
  { product: "Queues", keywords: ["queue", "queues", "consumer", "producer", "dead letter"] },
  { product: "Zero Trust", keywords: ["zero trust", "access", "warp", "gateway policy", "tunnel"] },
  { product: "Load Balancing", keywords: ["load balancer", "origin pool", "health check", "steering"] },
  { product: "Email Routing", keywords: ["email routing", "mx record", "forward email"] },
  { product: "Durable Objects", keywords: ["durable object", "durable objects", "do namespace", "sqlite storage"] },
  { product: "Vectorize", keywords: ["vectorize", "embedding", "vector index", "rag"] },
  { product: "Workers AI", keywords: ["workers ai", "env.ai", "ai.run", "@cf/"] },
  { product: "AI Gateway", keywords: ["ai gateway", "gateway id", "model fallback", "llm cache"] },
  { product: "Wrangler", keywords: ["wrangler", "wrangler deploy", "wrangler dev", "wrangler types"] }
];

const PRODUCT_SOURCES: Record<CloudflareProduct, KnowledgeSource[]> = {
  Workers: [
    {
      title: "Cloudflare Workers docs",
      url: "https://developers.cloudflare.com/workers/",
      product: "Workers",
      summary: "Workers runtime, request handling, bindings, deploys, logs, and routing.",
      checklist: ["Check Worker logs/tail output", "Validate bindings in wrangler config", "Run wrangler deploy --dry-run"]
    },
    {
      title: "Workers best practices",
      url: "https://developers.cloudflare.com/workers/best-practices/workers-best-practices/",
      product: "Workers",
      summary: "Production guidance for Workers correctness, performance, secrets, and observability.",
      checklist: ["Avoid request state in globals", "Use waitUntil for background work", "Keep secrets in bindings/secrets"]
    }
  ],
  Pages: [{ title: "Cloudflare Pages docs", url: "https://developers.cloudflare.com/pages/", product: "Pages", summary: "Pages build, preview, deployment, and Functions troubleshooting.", checklist: ["Check build logs", "Confirm env vars per environment", "Compare preview vs production"] }],
  DNS: [{ title: "Cloudflare DNS docs", url: "https://developers.cloudflare.com/dns/", product: "DNS", summary: "DNS records, nameservers, proxy status, and resolver behavior.", checklist: ["Confirm authoritative nameservers", "Check record type/value", "Check proxied vs DNS-only"] }],
  "SSL/TLS": [{ title: "Cloudflare SSL/TLS docs", url: "https://developers.cloudflare.com/ssl/", product: "SSL/TLS", summary: "SSL modes, certificates, redirect loops, and origin TLS errors.", checklist: ["Check SSL mode", "Inspect origin certificate", "Look for conflicting redirects"] }],
  WAF: [{ title: "Cloudflare WAF docs", url: "https://developers.cloudflare.com/waf/", product: "WAF", summary: "WAF managed/custom rules and Security Events analysis.", checklist: ["Find Ray ID in Security Events", "Identify matching rule", "Adjust skip/exception rule if valid"] }],
  Cache: [{ title: "Cloudflare Cache docs", url: "https://developers.cloudflare.com/cache/", product: "Cache", summary: "Cache Rules, purge behavior, stale content, and response headers.", checklist: ["Inspect cf-cache-status", "Check Cache Rules/Page Rules", "Purge exact URL after changes"] }],
  R2: [{ title: "Cloudflare R2 docs", url: "https://developers.cloudflare.com/r2/", product: "R2", summary: "Object storage, S3 compatibility, CORS, and bucket access.", checklist: ["Check bucket/CORS policy", "Validate S3 credentials/bindings", "Confirm object key/path"] }],
  D1: [{ title: "Cloudflare D1 docs", url: "https://developers.cloudflare.com/d1/", product: "D1", summary: "SQLite database bindings, migrations, queries, and local/remote behavior.", checklist: ["Verify binding name", "Run migrations", "Regenerate types after config changes"] }],
  KV: [{ title: "Cloudflare KV docs", url: "https://developers.cloudflare.com/kv/", product: "KV", summary: "Key-value namespaces, eventual consistency, and binding access.", checklist: ["Verify namespace binding", "Account for eventual consistency", "Check key prefixes/TTL"] }],
  Queues: [{ title: "Cloudflare Queues docs", url: "https://developers.cloudflare.com/queues/", product: "Queues", summary: "Queue producers, consumers, retries, and dead-letter handling.", checklist: ["Verify producer/consumer bindings", "Inspect retry/dead-letter config", "Check batch handler logs"] }],
  "Zero Trust": [{ title: "Cloudflare Zero Trust docs", url: "https://developers.cloudflare.com/cloudflare-one/", product: "Zero Trust", summary: "Access, Gateway, WARP, tunnels, and policy troubleshooting.", checklist: ["Check Access/Gateway policies", "Verify identity posture", "Inspect tunnel health"] }],
  "Load Balancing": [{ title: "Cloudflare Load Balancing docs", url: "https://developers.cloudflare.com/load-balancing/", product: "Load Balancing", summary: "Pools, origins, monitors, health checks, and steering.", checklist: ["Check monitor status", "Verify origin pool health", "Review steering policy"] }],
  "Email Routing": [{ title: "Cloudflare Email Routing docs", url: "https://developers.cloudflare.com/email-routing/", product: "Email Routing", summary: "MX records, routing rules, and destination verification.", checklist: ["Check MX records", "Verify destination address", "Review routing rules"] }],
  "Durable Objects": [{ title: "Cloudflare Durable Objects docs", url: "https://developers.cloudflare.com/durable-objects/", product: "Durable Objects", summary: "Stateful objects, SQLite storage, migrations, and RPC.", checklist: ["Confirm migration class", "Use deterministic object name", "Inspect storage/RPC errors"] }],
  Vectorize: [{ title: "Cloudflare Vectorize docs", url: "https://developers.cloudflare.com/vectorize/", product: "Vectorize", summary: "Vector indexes, embeddings, and retrieval workflows.", checklist: ["Check index dimensions", "Verify embedding model", "Inspect top-k retrieval quality"] }],
  "Workers AI": [{ title: "Cloudflare Workers AI docs", url: "https://developers.cloudflare.com/workers-ai/", product: "Workers AI", summary: "Model inference, bindings, supported parameters, and AI Gateway usage.", checklist: ["Check model name", "Validate binding env.AI", "Review model input shape"] }],
  "AI Gateway": [{ title: "Cloudflare AI Gateway docs", url: "https://developers.cloudflare.com/ai-gateway/", product: "AI Gateway", summary: "AI observability, caching, retries, and provider routing.", checklist: ["Check gateway id", "Inspect logs/cache", "Review retry/fallback settings"] }],
  Wrangler: [{ title: "Wrangler configuration docs", url: "https://developers.cloudflare.com/workers/wrangler/configuration/", product: "Wrangler", summary: "Worker config, bindings, secrets, deploys, and generated types.", checklist: ["Run wrangler deploy --dry-run", "Run wrangler types", "Check secret vs vars usage"] }]
};

const DEFAULT_SOURCES: KnowledgeSource[] = [
  { title: "Cloudflare docs", url: "https://developers.cloudflare.com/" },
  { title: "Cloudflare Workers docs", url: "https://developers.cloudflare.com/workers/", product: "Workers" }
];

export function detectCloudflareProducts(text: string): CloudflareProduct[] {
  const normalized = text.toLowerCase();
  return PRODUCT_RULES.filter(({ keywords }) => keywords.some((keyword) => normalized.includes(keyword))).map(
    ({ product }) => product
  );
}

export function getKnowledgeSources(products: CloudflareProduct[]): KnowledgeSource[] {
  const sources = products.flatMap((product) => PRODUCT_SOURCES[product] ?? []);
  return uniqueSources(sources.length > 0 ? sources : DEFAULT_SOURCES).slice(0, 6);
}

export function formatKnowledgeContext(sources: KnowledgeSource[]): string {
  return sources
    .map((source) => {
      const checklist = source.checklist?.length ? `\n  Checklist: ${source.checklist.join("; ")}` : "";
      const summary = source.summary ? `\n  Summary: ${source.summary}` : "";
      return `- ${source.title}: ${source.url}${summary}${checklist}`;
    })
    .join("\n");
}

export function uniqueProducts(products: CloudflareProduct[]): CloudflareProduct[] {
  return Array.from(new Set(products));
}

export function uniqueStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }

  return result;
}

export function uniqueSources(sources: KnowledgeSource[]): KnowledgeSource[] {
  const seen = new Set<string>();
  const result: KnowledgeSource[] = [];

  for (const source of sources) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    result.push(source);
  }

  return result;
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/(authorization:\s*bearer\s+)[a-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/(cf_[a-z0-9_]*token\s*[:=]\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(api(?:[_\-\s]?key)\s*[:=]\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(secret\s*[:=]\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/-----BEGIN [^-]+-----[\s\S]+?-----END [^-]+-----/g, "[REDACTED_PRIVATE_KEY]");
}

export function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(0.99, Math.max(0.05, Math.round(value * 100) / 100));
}
