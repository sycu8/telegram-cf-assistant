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
    { title: "Cloudflare Workers docs", url: "https://developers.cloudflare.com/workers/", product: "Workers" },
    { title: "Workers best practices", url: "https://developers.cloudflare.com/workers/best-practices/workers-best-practices/", product: "Workers" }
  ],
  Pages: [{ title: "Cloudflare Pages docs", url: "https://developers.cloudflare.com/pages/", product: "Pages" }],
  DNS: [{ title: "Cloudflare DNS docs", url: "https://developers.cloudflare.com/dns/", product: "DNS" }],
  "SSL/TLS": [{ title: "Cloudflare SSL/TLS docs", url: "https://developers.cloudflare.com/ssl/", product: "SSL/TLS" }],
  WAF: [{ title: "Cloudflare WAF docs", url: "https://developers.cloudflare.com/waf/", product: "WAF" }],
  Cache: [{ title: "Cloudflare Cache docs", url: "https://developers.cloudflare.com/cache/", product: "Cache" }],
  R2: [{ title: "Cloudflare R2 docs", url: "https://developers.cloudflare.com/r2/", product: "R2" }],
  D1: [{ title: "Cloudflare D1 docs", url: "https://developers.cloudflare.com/d1/", product: "D1" }],
  KV: [{ title: "Cloudflare KV docs", url: "https://developers.cloudflare.com/kv/", product: "KV" }],
  Queues: [{ title: "Cloudflare Queues docs", url: "https://developers.cloudflare.com/queues/", product: "Queues" }],
  "Zero Trust": [{ title: "Cloudflare Zero Trust docs", url: "https://developers.cloudflare.com/cloudflare-one/", product: "Zero Trust" }],
  "Load Balancing": [{ title: "Cloudflare Load Balancing docs", url: "https://developers.cloudflare.com/load-balancing/", product: "Load Balancing" }],
  "Email Routing": [{ title: "Cloudflare Email Routing docs", url: "https://developers.cloudflare.com/email-routing/", product: "Email Routing" }],
  "Durable Objects": [{ title: "Cloudflare Durable Objects docs", url: "https://developers.cloudflare.com/durable-objects/", product: "Durable Objects" }],
  Vectorize: [{ title: "Cloudflare Vectorize docs", url: "https://developers.cloudflare.com/vectorize/", product: "Vectorize" }],
  "Workers AI": [{ title: "Cloudflare Workers AI docs", url: "https://developers.cloudflare.com/workers-ai/", product: "Workers AI" }],
  "AI Gateway": [{ title: "Cloudflare AI Gateway docs", url: "https://developers.cloudflare.com/ai-gateway/", product: "AI Gateway" }],
  Wrangler: [{ title: "Wrangler configuration docs", url: "https://developers.cloudflare.com/workers/wrangler/configuration/", product: "Wrangler" }]
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
