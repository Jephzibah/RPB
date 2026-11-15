var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// site.config.js
var site_config_default = {
  name: "Rock Paper Branding",
  url: "https://rockpaperbranding.com",
  // origin the site is served from, no path or trailing slash
  // 'cloudflare' | 'github-pages' | 'static'. Only Cloudflare runs the Worker, so contact & shop switch off elsewhere.
  hosting: "cloudflare",
  base: "",
  // empty = automatic ('/<repo>/' on GitHub Pages, else '/'). Set '/' for a GitHub Pages custom domain.
  // Cloudflare only: every URL shows /coming-soon until the SITE_PASSWORD secret is entered. Crawlers are blocked.
  comingSoon: true,
  lang: "en",
  description: "Rock Paper Branding is a full-service brand & website design studio for small businesses.",
  ogImage: "/og-image.jpg",
  twitterHandle: "",
  themeColor: "#323232",
  iconCredit: false,
  // Font Awesome Free (CC BY 4.0) credit in the footer; set false if no icons are used
  nav: [
    { label: "Brand Design", href: "/brand-design" },
    { label: "About", href: "/about" },
    { label: "Shop", href: "/shop", feature: "shop" },
    { label: "Contact", href: "/contact", feature: "contact" },
    { label: "Log in", href: "/login", feature: "shop" }
  ],
  features: {
    contact: true,
    shop: true,
    stripe: true,
    // requires features.shop
    paypal: false
    // requires features.shop
  },
  analytics: {
    cloudflareToken: "",
    gtm: ""
    // 'GTM-XXXXXXX'. Needs a consent banner in the EU/UK; tags beyond GA4 need `csp` entries.
  },
  turnstile: {
    siteKey: "0x4AAAAAAGCF0PkXOZoI5jrg"
  },
  paypal: {
    clientId: "sb"
    // public client id; 'sb' = PayPal sandbox placeholder. Currency comes from catalog/products.json
  }
};

// worker/lib/http.js
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  // `internal` is shown to signed-in admins only (in error details), never to the public
  constructor(status, message, internal) {
    super(message);
    this.status = status;
    this.internal = internal;
  }
};
var json = /* @__PURE__ */ __name((body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
}), "json");
function isSameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  if (origin) return origin === url.origin;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin";
}
__name(isSameOrigin, "isSameOrigin");
function requireFeature(name) {
  const f = site_config_default.features || {};
  const enabled = name === "stripe" || name === "paypal" ? f.shop && f[name] : f[name];
  if (!enabled) throw new HttpError(404, "Not found");
}
__name(requireFeature, "requireFeature");
function requireEnv(env, ...names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    console.error(`Missing configuration: ${missing.join(", ")}`);
    throw new HttpError(503, "This feature is not configured yet.", `Missing configuration: ${missing.join(", ")}`);
  }
}
__name(requireEnv, "requireEnv");
async function readJson(request, maxBytes = 16384) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
__name(readJson, "readJson");
var clean = /* @__PURE__ */ __name((value, max) => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max), "clean");
var isEmail = /* @__PURE__ */ __name((value) => /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(value) && value.length <= 200, "isEmail");
var emailList = /* @__PURE__ */ __name((value) => String(value || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean), "emailList");

// worker/lib/turnstile.js
var MAX_TOKEN_LENGTH = 2048;
var host = new URL(site_config_default.url).hostname;
var HOSTNAMES = [host, host.startsWith("www.") ? host.slice(4) : `www.${host}`];
var isTestSecret = /* @__PURE__ */ __name((secret) => /^[123]x0{30,}AA$/.test(secret), "isTestSecret");
async function verifyTurnstile(token2, ip, secret, action) {
  if (!token2 || typeof token2 !== "string" || token2.length > MAX_TOKEN_LENGTH) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token2);
  if (ip) body.append("remoteip", ip);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(1e4) });
    if (!response.ok) return false;
    const result = await response.json();
    if (result.success !== true) return false;
    if (isTestSecret(secret)) return true;
    return result.action === action && HOSTNAMES.includes(result.hostname);
  } catch (error) {
    console.error("Turnstile verification failed", error);
    return false;
  }
}
__name(verifyTurnstile, "verifyTurnstile");

// worker/lib/email.js
import { EmailMessage } from "cloudflare:email";
async function sendEmail(env, { to, subject, text, replyTo }) {
  const from = env.EMAIL_FROM;
  const fromName = env.EMAIL_FROM_NAME || "Website";
  if (env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, text, reply_to: replyTo || void 0 })
    });
    if (!response.ok) throw new Error(`Resend failed: ${response.status} ${await response.text()}`);
    return;
  }
  if (env.SEND_EMAIL) {
    const raw = buildMime({ from, fromName, to, subject, text, replyTo });
    await env.SEND_EMAIL.send(new EmailMessage(from, to, raw));
    return;
  }
  if (env.EMAIL_DEV_LOG) {
    console.log(`--- email (dev log) ---
To: ${to}
Reply-To: ${replyTo || ""}
Subject: ${subject}

${text}
---`);
    return;
  }
  throw new Error("No email transport configured (set RESEND_API_KEY or the SEND_EMAIL binding)");
}
__name(sendEmail, "sendEmail");
var oneLine = /* @__PURE__ */ __name((value) => String(value).replace(/[\r\n]+/g, " ").trim(), "oneLine");
function base64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
__name(base64, "base64");
var encodeHeader = /* @__PURE__ */ __name((value) => /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64(value)}?=`, "encodeHeader");
function buildMime({ from, fromName, to, subject, text, replyTo }) {
  const domain = from.split("@")[1];
  return [
    `From: ${encodeHeader(oneLine(fromName))} <${from}>`,
    `To: <${to}>`,
    replyTo ? `Reply-To: <${oneLine(replyTo)}>` : null,
    `Subject: ${encodeHeader(oneLine(subject))}`,
    `Date: ${(/* @__PURE__ */ new Date()).toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(text).replace(/.{76}/g, "$&\r\n")
  ].filter((line) => line !== null).join("\r\n");
}
__name(buildMime, "buildMime");

// worker/lib/contact.js
async function handleContact(request, env) {
  requireFeature("contact");
  requireEnv(env, "TURNSTILE_SECRET", "CONTACT_TO", "EMAIL_FROM");
  if (Number(request.headers.get("Content-Length")) > 65536) throw new HttpError(413, "Message too large.");
  const form = await request.formData();
  if (form.get("company_website")) return json({ message: "Thanks! Your message has been sent." });
  const human = await verifyTurnstile(form.get("cf-turnstile-response"), request.headers.get("CF-Connecting-IP"), env.TURNSTILE_SECRET, "contact");
  if (!human) throw new HttpError(403, "Spam check failed.");
  const name = clean(form.get("name"), 100);
  const email = clean(form.get("email"), 200);
  const phone = clean(form.get("phone"), 40);
  const subject = clean(form.get("subject"), 150);
  const message = clean(form.get("message"), 5e3);
  if (!name || !subject || !message || !isEmail(email)) throw new HttpError(400, "Please complete all required fields.");
  await sendEmail(env, {
    to: env.CONTACT_TO,
    replyTo: email,
    subject: `Website contact: ${subject}`,
    text: `Name: ${name}
Email: ${email}
Phone: ${phone || "-"}
Subject: ${subject}

${message}
`
  });
  return json({ message: "Thanks! Your message has been sent." });
}
__name(handleContact, "handleContact");

// catalog/products.json
var products_default = {
  currency: "usd",
  shippingCountries: [],
  products: [
    {
      id: "business-branding",
      name: "Business Branding",
      description: "A complete brand identity: main logo, two alternate logos, color palette, typography and brand guidelines.",
      price: 15e4,
      image: "/assets/images/product-business-branding.jpg",
      stripePriceId: ""
    },
    {
      id: "website-design",
      name: "Website Design",
      description: "A custom, strategy-driven website designed and built around your brand.",
      price: 25e4,
      image: "/assets/images/product-website-design.jpg",
      stripePriceId: ""
    },
    {
      id: "business-email",
      name: "Business Email",
      description: "Professional email on your own domain, set up for you.",
      price: 1500,
      image: "/assets/images/product-business-email.jpg",
      stripePriceId: ""
    }
  ]
};

// worker/lib/catalog.js
var currency = products_default.currency.toLowerCase();
function resolveCart(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw new HttpError(400, "Your cart is empty.");
  const quantities = /* @__PURE__ */ new Map();
  for (const item of items) {
    const qty = Number.parseInt(item?.qty, 10);
    if (typeof item?.id !== "string" || !(qty >= 1 && qty <= 99)) throw new HttpError(400, "Invalid cart item.");
    quantities.set(item.id, Math.min((quantities.get(item.id) || 0) + qty, 99));
  }
  const lines = [...quantities].map(([id, qty]) => {
    const product = products_default.products.find((p) => p.id === id && p.active !== false);
    if (!product) throw new HttpError(400, "An item in your cart is no longer available.");
    return { product, qty };
  });
  return {
    currency,
    lines,
    total: lines.reduce((sum, { product, qty }) => sum + product.price * qty, 0),
    shippingCountries: products_default.shippingCountries || []
  };
}
__name(resolveCart, "resolveCart");

// worker/lib/crypto.js
var encoder = new TextEncoder();
var toHex = /* @__PURE__ */ __name((buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join(""), "toHex");
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(base64url, "base64url");
function fromBase64url(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
__name(fromBase64url, "fromBase64url");
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}
__name(hmacHex, "hmacHex");
var sha256Hex = /* @__PURE__ */ __name(async (value) => toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value))), "sha256Hex");
function safeEqual(a, b) {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  return left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right);
}
__name(safeEqual, "safeEqual");
var randomToken = /* @__PURE__ */ __name((bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes))), "randomToken");
function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}
__name(readCookie, "readCookie");

// worker/lib/access.js
var CERTS_TTL = 60 * 60 * 1e3;
var CERTS_MIN_REFRESH = 60 * 1e3;
var certs = { keys: /* @__PURE__ */ new Map(), fetchedAt: 0 };
async function loadKeys(teamDomain) {
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs request failed: ${response.status}`);
  const keys = /* @__PURE__ */ new Map();
  for (const jwk of (await response.json()).keys || []) {
    keys.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  certs = { keys, fetchedAt: Date.now() };
}
__name(loadKeys, "loadKeys");
async function signingKey(teamDomain, kid) {
  const age = Date.now() - certs.fetchedAt;
  if (age > CERTS_TTL || !certs.keys.has(kid) && age > CERTS_MIN_REFRESH) await loadKeys(teamDomain);
  return certs.keys.get(kid);
}
__name(signingKey, "signingKey");
var decodeJson = /* @__PURE__ */ __name((part) => JSON.parse(new TextDecoder().decode(fromBase64url(part))), "decodeJson");
function identity(env, email) {
  const normalized = email.toLowerCase();
  return { email: normalized, role: emailList(env.PROVIDER_EMAILS).includes(normalized) ? "provider" : "owner" };
}
__name(identity, "identity");
async function requireAdmin(request, env) {
  const { hostname } = new URL(request.url);
  if (env.ACCESS_DEV_EMAIL && (hostname === "localhost" || hostname === "127.0.0.1")) return identity(env, env.ACCESS_DEV_EMAIL);
  requireEnv(env, "ACCESS_TEAM_DOMAIN", "ACCESS_AUD");
  const unauthorized = new HttpError(401, "Not signed in.");
  const [header, payload, signature] = (request.headers.get("Cf-Access-Jwt-Assertion") || "").split(".");
  if (!signature) throw unauthorized;
  let claims;
  try {
    const { alg, kid } = decodeJson(header);
    const key = alg === "RS256" && await signingKey(env.ACCESS_TEAM_DOMAIN, kid);
    const valid = key && await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(signature), new TextEncoder().encode(`${header}.${payload}`));
    if (!valid) throw unauthorized;
    claims = decodeJson(payload);
  } catch (error) {
    if (error !== unauthorized) console.error("Access JWT check failed", error);
    throw unauthorized;
  }
  const audiences = [].concat(claims.aud || []);
  const now = Date.now() / 1e3;
  if (!audiences.includes(env.ACCESS_AUD) || claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}` || !(claims.exp > now) || !claims.email) {
    throw unauthorized;
  }
  return identity(env, claims.email);
}
__name(requireAdmin, "requireAdmin");

// worker/lib/admin-users.js
var WRITABLE = ["name", "decision", "include", "exclude", "require", "session_duration", "approval_required", "approval_groups", "isolation_required", "purpose_justification_required", "purpose_justification_prompt", "mfa_config", "connection_rules"];
var CACHE_MS = 5 * 60 * 1e3;
var cache = { emails: null, at: 0 };
var normalizeEmail = /* @__PURE__ */ __name((value) => clean(value, 200).toLowerCase(), "normalizeEmail");
var configured = /* @__PURE__ */ __name((env) => Boolean(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.ACCESS_POLICY_ID), "configured");
async function accessApi(env, method, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/access/policies/${env.ACCESS_POLICY_ID}`, {
    method,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : void 0,
    signal: AbortSignal.timeout(1e4)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    console.error("Access policy API error", response.status, JSON.stringify(data.errors || data));
    throw new HttpError(502, "Cloudflare Access could not be updated right now.");
  }
  return data.result;
}
__name(accessApi, "accessApi");
var policyEmails = /* @__PURE__ */ __name((policy) => (policy.include || []).filter((rule) => rule.email?.email).map((rule) => rule.email.email.toLowerCase()), "policyEmails");
async function adminEmails(env) {
  const fallback = [...emailList(env.PROVIDER_EMAILS), ...emailList(env.OWNER_EMAILS)];
  if (!configured(env)) return fallback;
  if (cache.emails && Date.now() - cache.at < CACHE_MS) return cache.emails;
  try {
    cache = { emails: policyEmails(await accessApi(env, "GET")), at: Date.now() };
    return cache.emails;
  } catch {
    return fallback;
  }
}
__name(adminEmails, "adminEmails");
async function adminUser(request, env) {
  requireFeature("shop");
  requireEnv(env, "DB");
  const actor = await requireAdmin(request, env);
  if (!configured(env)) throw new HttpError(503, "Admin user management isn\u2019t set up yet (see README \u2192 Admin users).");
  return actor;
}
__name(adminUser, "adminUser");
var audit = /* @__PURE__ */ __name((env, actor, action, detail) => env.DB.prepare("INSERT INTO audit_log (actor, action, order_id, detail, created_at) VALUES (?, ?, NULL, ?, ?)").bind(`${actor.email} (${actor.role})`, action, JSON.stringify(detail), Date.now()).run(), "audit");
function describe(env, policy) {
  const providers = emailList(env.PROVIDER_EMAILS);
  return policyEmails(policy).map((email) => ({ email, role: providers.includes(email) ? "provider" : "owner" }));
}
__name(describe, "describe");
async function savePolicy(env, policy, include) {
  const body = Object.fromEntries(WRITABLE.filter((key) => policy[key] !== void 0).map((key) => [key, policy[key]]));
  const updated = await accessApi(env, "PUT", { ...body, include });
  cache = { emails: policyEmails(updated), at: Date.now() };
  return updated;
}
__name(savePolicy, "savePolicy");
async function adminListUsers(request, env) {
  const actor = await adminUser(request, env);
  return json({ users: describe(env, await accessApi(env, "GET")), you: actor });
}
__name(adminListUsers, "adminListUsers");
async function adminAddUser(request, env, ctx) {
  const actor = await adminUser(request, env);
  const email = normalizeEmail((await readJson(request)).email);
  if (!isEmail(email)) throw new HttpError(400, "Please enter a valid email address.");
  const policy = await accessApi(env, "GET");
  if (policyEmails(policy).includes(email)) throw new HttpError(409, "That email can already sign in.");
  const updated = await savePolicy(env, policy, [...policy.include || [], { email: { email } }]);
  await audit(env, actor, "add-admin", { email });
  ctx.waitUntil(
    sendEmail(env, {
      to: email,
      replyTo: env.CONTACT_TO,
      subject: `You've been added to the ${site_config_default.name} admin`,
      text: `${actor.email} gave you access to the ${site_config_default.name} orders admin.

Sign in at ${site_config_default.url}/login with this email address. You'll get a one-time code by email; there's no password.
`
    }).catch((error) => console.error("Admin invite email failed", error))
  );
  return json({ users: describe(env, updated) });
}
__name(adminAddUser, "adminAddUser");
async function adminRemoveUser(request, env) {
  const actor = await adminUser(request, env);
  const email = normalizeEmail((await readJson(request)).email);
  if (email === actor.email) throw new HttpError(400, "You can\u2019t remove yourself. Ask another admin to do it.");
  if (emailList(env.PROVIDER_EMAILS).includes(email) && actor.role !== "provider") throw new HttpError(403, "Only the provider can remove a provider.");
  const policy = await accessApi(env, "GET");
  const include = (policy.include || []).filter((rule) => rule.email?.email?.toLowerCase() !== email);
  if (include.length === (policy.include || []).length) throw new HttpError(404, "That email isn\u2019t an admin.");
  if (!include.length) throw new HttpError(400, "At least one admin has to remain.");
  const updated = await savePolicy(env, policy, include);
  await audit(env, actor, "remove-admin", { email });
  return json({ users: describe(env, updated) });
}
__name(adminRemoveUser, "adminRemoveUser");

// worker/lib/orders.js
var NUMBER_OFFSET = 1e3;
var SESSION_COOKIE = "__Host-orders";
var SESSION_SECONDS = 60 * 60;
var LINK_MINUTES = 15;
var MAX_LINKS = 3;
var MAX_CUSTOMER_MESSAGES_PER_HOUR = 10;
var STATUSES = ["paid", "processing", "shipped", "complete", "refunded", "cancelled"];
var orderNumber = /* @__PURE__ */ __name((id) => id + NUMBER_OFFSET, "orderNumber");
var orderIdFrom = /* @__PURE__ */ __name((number) => Number(number) - NUMBER_OFFSET, "orderIdFrom");
var normalizeEmail2 = /* @__PURE__ */ __name((value) => clean(value, 200).toLowerCase(), "normalizeEmail");
var formatMoney = /* @__PURE__ */ __name((cents, currency2) => new Intl.NumberFormat(site_config_default.lang, { style: "currency", currency: currency2.toUpperCase() }).format(cents / 100), "formatMoney");
function toOrder(row) {
  return {
    number: orderNumber(row.id),
    status: row.status,
    currency: row.currency,
    total: row.total,
    items: JSON.parse(row.items),
    shipping: row.shipping ? JSON.parse(row.shipping) : null,
    tracking: row.tracking,
    createdAt: row.created_at
  };
}
__name(toOrder, "toOrder");
function normalizeShipping(raw) {
  if (!raw || typeof raw !== "object") return null;
  const a = raw.address || raw;
  const shipping = {
    name: clean(raw.name?.full_name ?? raw.name, 200),
    line1: clean(a.line1 ?? a.address_line_1, 200),
    line2: clean(a.line2 ?? a.address_line_2, 200),
    city: clean(a.city ?? a.admin_area_2, 100),
    state: clean(a.state ?? a.admin_area_1, 100),
    postal_code: clean(a.postal_code, 20),
    country: clean(a.country ?? a.country_code, 2).toUpperCase()
  };
  return Object.values(shipping).some(Boolean) ? shipping : null;
}
__name(normalizeShipping, "normalizeShipping");
async function loadMessages(env, orderIds) {
  if (!orderIds.length) return /* @__PURE__ */ new Map();
  const { results } = await env.DB.prepare(
    `SELECT order_id, author_role, author_email, body, created_at FROM order_messages WHERE order_id IN (${orderIds.map(() => "?").join(",")}) ORDER BY id`
  ).bind(...orderIds).all();
  const byOrder = new Map(orderIds.map((id) => [id, []]));
  for (const m of results) byOrder.get(m.order_id).push({ role: m.author_role, author: m.author_email, body: m.body, createdAt: m.created_at });
  return byOrder;
}
__name(loadMessages, "loadMessages");
var itemLines = /* @__PURE__ */ __name((order) => order.items.map((item) => `  ${item.qty} \xD7 ${item.name}  ${formatMoney(item.price * item.qty, order.currency)}`).join("\n"), "itemLines");
async function recordOrder(env, { provider, ref, email, name = "", currency: currency2, total, items, shipping = null }) {
  if (!env.DB) {
    console.error(`DB binding missing: ${provider} order ${ref} was not stored`);
    return { number: null, created: true };
  }
  const now = Date.now();
  const address = normalizeShipping(shipping);
  const row = await env.DB.prepare(
    `INSERT INTO orders (provider, provider_ref, email, name, currency, total, items, shipping, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (provider, provider_ref) DO NOTHING RETURNING id`
  ).bind(provider, ref, normalizeEmail2(email), clean(name, 200), currency2.toLowerCase(), total, JSON.stringify(items), address ? JSON.stringify(address) : null, now, now).first();
  return row ? { number: orderNumber(row.id), created: true } : { number: null, created: false };
}
__name(recordOrder, "recordOrder");
async function notifyNewOrder(env, { number, provider, email, currency: currency2, total, items }) {
  const order = { currency: currency2, items };
  const label = number ? `#${number}` : `(${provider}, not stored)`;
  const sends = [
    sendEmail(env, {
      to: env.CONTACT_TO,
      subject: `New order ${label}: ${formatMoney(total, currency2)}`,
      text: `New ${provider} order ${label} from ${email || "unknown email"}.

${itemLines(order)}

Total: ${formatMoney(total, currency2)}

Manage it at ${site_config_default.url}/admin
`
    })
  ];
  if (email && isEmail(email)) {
    sends.push(
      sendEmail(env, {
        to: email,
        replyTo: env.CONTACT_TO,
        subject: `Thanks for your order${number ? ` #${number}` : ""} from ${site_config_default.name}`,
        text: `Thanks for your order!

${itemLines(order)}

Total: ${formatMoney(total, currency2)}

You can check on it any time at ${site_config_default.url}/orders using this email address.

${site_config_default.name}
`
      })
    );
  }
  const results = await Promise.allSettled(sends);
  results.filter((r) => r.status === "rejected").forEach((r) => console.error("Order email failed", r.reason));
}
__name(notifyNewOrder, "notifyNewOrder");
async function sessionCookie(env, email) {
  const value = `${Date.now() + SESSION_SECONDS * 1e3}.${base64url(new TextEncoder().encode(email))}`;
  return `${SESSION_COOKIE}=${value}.${await hmacHex(env.ORDERS_SECRET, value)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}
__name(sessionCookie, "sessionCookie");
async function sessionEmail(request, env) {
  const [expires, encoded, signature] = readCookie(request, SESSION_COOKIE).split(".");
  if (!signature || !(Number(expires) > Date.now())) return null;
  if (!safeEqual(signature, await hmacHex(env.ORDERS_SECRET, `${expires}.${encoded}`))) return null;
  return new TextDecoder().decode(fromBase64url(encoded));
}
__name(sessionEmail, "sessionEmail");
async function login(request, env, ctx) {
  requireFeature("shop");
  requireEnv(env, "DB", "TURNSTILE_SECRET", "EMAIL_FROM");
  const form = await request.formData();
  const human = await verifyTurnstile(form.get("cf-turnstile-response"), request.headers.get("CF-Connecting-IP"), env.TURNSTILE_SECRET, "login");
  if (!human) throw new HttpError(403, "Spam check failed.");
  const email = normalizeEmail2(form.get("email"));
  if (!isEmail(email)) throw new HttpError(400, "Please enter a valid email address.");
  if ((await adminEmails(env)).includes(email)) return json({ redirect: "/admin" });
  const reply = json({ message: `If we have orders for that email, a sign-in link is on its way. It works once and expires in ${LINK_MINUTES} minutes.` });
  const now = Date.now();
  ctx.waitUntil(env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(now - 864e5).run());
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND expires_at > ?").bind(email, now).first("n");
  if (recent >= MAX_LINKS) return reply;
  if (!await env.DB.prepare("SELECT 1 FROM orders WHERE email = ? LIMIT 1").bind(email).first()) return reply;
  const token2 = randomToken();
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(token2), email, now + LINK_MINUTES * 6e4).run();
  ctx.waitUntil(
    sendEmail(env, {
      to: email,
      subject: `Your ${site_config_default.name} orders`,
      text: `Use this link to see your orders. It works once and expires in ${LINK_MINUTES} minutes:

${site_config_default.url}/orders/verify#token=${token2}

If you didn't ask for this, you can ignore this email.
`
    }).catch((error) => console.error("Order link email failed", error))
  );
  return reply;
}
__name(login, "login");
async function createOrderSession(request, env) {
  requireFeature("shop");
  requireEnv(env, "DB", "ORDERS_SECRET");
  const { token: token2 } = await readJson(request, 1024);
  if (typeof token2 !== "string" || !token2) throw new HttpError(400, "This link is incomplete. Please request a new one.");
  const now = Date.now();
  const row = await env.DB.prepare("UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email").bind(now, await sha256Hex(token2), now).first();
  if (!row) throw new HttpError(400, "This link has expired or was already used. Please request a new one.");
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env, row.email) });
}
__name(createOrderSession, "createOrderSession");
async function listMyOrders(request, env) {
  requireFeature("shop");
  requireEnv(env, "DB", "ORDERS_SECRET");
  const email = await sessionEmail(request, env);
  if (!email) throw new HttpError(401, "Please sign in to see your orders.");
  const { results } = await env.DB.prepare("SELECT * FROM orders WHERE email = ? ORDER BY id DESC LIMIT 100").bind(email).all();
  const messages = await loadMessages(env, results.map((row) => row.id));
  const forCustomer = /* @__PURE__ */ __name((m) => ({ role: m.role, body: m.body, createdAt: m.createdAt }), "forCustomer");
  return json({ email, siteName: site_config_default.name, orders: results.map((row) => ({ ...toOrder(row), messages: messages.get(row.id).map(forCustomer) })) });
}
__name(listMyOrders, "listMyOrders");
async function postCustomerMessage(request, env, ctx, [number]) {
  requireFeature("shop");
  requireEnv(env, "DB", "ORDERS_SECRET");
  const email = await sessionEmail(request, env);
  if (!email) throw new HttpError(401, "Please sign in again to send a message.");
  const row = await env.DB.prepare("SELECT id, email FROM orders WHERE id = ?").bind(orderIdFrom(number)).first();
  if (!row || row.email !== email) throw new HttpError(404, "Order not found.");
  const body = clean((await readJson(request)).body, 2e3);
  if (!body) throw new HttpError(400, "The message is empty.");
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM order_messages WHERE order_id = ? AND author_role = 'customer' AND created_at > ?").bind(row.id, now - 36e5).first("n");
  if (recent >= MAX_CUSTOMER_MESSAGES_PER_HOUR) throw new HttpError(429, "You\u2019ve sent a lot of messages in the last hour. Please wait a bit, or reply to one of our emails.");
  await env.DB.prepare("INSERT INTO order_messages (order_id, author_role, author_email, body, created_at) VALUES (?, 'customer', ?, ?, ?)").bind(row.id, email, body, now).run();
  ctx.waitUntil(
    sendEmail(env, {
      to: env.CONTACT_TO,
      replyTo: email,
      subject: `Customer message on order #${number}`,
      text: `${email} wrote about order #${number}:

${body}

Reply in the admin: ${site_config_default.url}/admin#order-${number}
`
    }).catch((error) => console.error("Message email failed", error))
  );
  return json({ ok: true });
}
__name(postCustomerMessage, "postCustomerMessage");
async function endOrderSession() {
  return json({ ok: true }, 200, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
}
__name(endOrderSession, "endOrderSession");

// worker/lib/stripe.js
var API = "https://api.stripe.com/v1";
function formEncode(value, prefix = "", params = new URLSearchParams()) {
  if (value === void 0 || value === null) return params;
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) formEncode(child, prefix ? `${prefix}[${key}]` : key, params);
  } else {
    params.append(prefix, String(value));
  }
  return params;
}
__name(formEncode, "formEncode");
async function stripe(env, path, params) {
  const response = await fetch(`${API}${path}`, {
    method: params ? "POST" : "GET",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params ? formEncode(params) : void 0
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("Stripe API error", data.error);
    throw new HttpError(502, "Checkout is unavailable right now.");
  }
  return data;
}
__name(stripe, "stripe");
async function createStripeCheckout(request, env) {
  requireFeature("stripe");
  requireEnv(env, "STRIPE_SECRET_KEY");
  const { items } = await readJson(request);
  const { currency: currency2, lines, shippingCountries } = resolveCart(items);
  const origin = new URL(request.url).origin;
  const session = await stripe(env, "/checkout/sessions", {
    mode: "payment",
    success_url: `${origin}/thanks?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/cart`,
    line_items: lines.map(
      ({ product, qty }) => product.stripePriceId ? { price: product.stripePriceId, quantity: qty } : { quantity: qty, price_data: { currency: currency2, unit_amount: product.price, product_data: { name: product.name } } }
    ),
    ...shippingCountries.length && { shipping_address_collection: { allowed_countries: shippingCountries } }
  });
  return json({ url: session.url });
}
__name(createStripeCheckout, "createStripeCheckout");
async function handleStripeWebhook(request, env, ctx) {
  requireFeature("stripe");
  requireEnv(env, "STRIPE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY");
  const payload = await request.text();
  const valid = await verifyStripeSignature(payload, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!valid) throw new HttpError(400, "Invalid signature");
  const event = JSON.parse(payload);
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.payment_status !== "paid") break;
      const lineItems = await stripe(env, `/checkout/sessions/${encodeURIComponent(session.id)}/line_items?limit=100`);
      const order = {
        provider: "stripe",
        ref: session.id,
        email: session.customer_details?.email || "",
        name: session.customer_details?.name || "",
        currency: session.currency,
        total: session.amount_total,
        items: lineItems.data.map((line) => ({ name: line.description, qty: line.quantity, price: line.price?.unit_amount ?? Math.round(line.amount_total / line.quantity) })),
        shipping: session.collected_information?.shipping_details || session.shipping_details || null
      };
      const { number, created } = await recordOrder(env, order);
      if (created) ctx.waitUntil(notifyNewOrder(env, { ...order, number }));
      break;
    }
    default:
      break;
  }
  return json({ received: true });
}
__name(handleStripeWebhook, "handleStripeWebhook");
async function verifyStripeSignature(payload, header, secret, toleranceSeconds = 300) {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.split("="));
  const timestamp = Number(parts.find(([key2]) => key2 === "t")?.[1]);
  const signatures = parts.filter(([key2]) => key2 === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(Date.now() / 1e3 - timestamp) > toleranceSeconds) return false;
  const encoder2 = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder2.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder2.encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}
__name(verifyStripeSignature, "verifyStripeSignature");
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");

// worker/lib/paypal.js
var apiBase = /* @__PURE__ */ __name((env) => env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com", "apiBase");
var toValue = /* @__PURE__ */ __name((cents) => (cents / 100).toFixed(2), "toValue");
async function accessToken(env) {
  const response = await fetch(`${apiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) {
    console.error("PayPal auth failed", response.status, await response.text());
    throw new HttpError(502, "PayPal is unavailable right now.");
  }
  return (await response.json()).access_token;
}
__name(accessToken, "accessToken");
async function paypal(env, path, body, method = "POST") {
  const response = await fetch(`${apiBase(env)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(env)}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : void 0
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("PayPal API error", response.status, JSON.stringify(data));
    throw new HttpError(502, "PayPal could not process the order.");
  }
  return data;
}
__name(paypal, "paypal");
async function createPayPalOrder(request, env) {
  requireFeature("paypal");
  requireEnv(env, "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET");
  const { items } = await readJson(request);
  const { currency: currency2, lines, total } = resolveCart(items);
  const currency_code = currency2.toUpperCase();
  const order = await paypal(env, "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: { currency_code, value: toValue(total), breakdown: { item_total: { currency_code, value: toValue(total) } } },
        items: lines.map(({ product, qty }) => ({
          name: product.name.slice(0, 127),
          sku: product.id,
          quantity: String(qty),
          unit_amount: { currency_code, value: toValue(product.price) }
        }))
      }
    ]
  });
  return json({ id: order.id });
}
__name(createPayPalOrder, "createPayPalOrder");
async function capturePayPalOrder(request, env, ctx, [orderId]) {
  requireFeature("paypal");
  requireEnv(env, "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET");
  const result = await paypal(env, `/v2/checkout/orders/${orderId}/capture`);
  if (result.status === "COMPLETED") {
    const details = await paypal(env, `/v2/checkout/orders/${orderId}`, void 0, "GET");
    const unit = details.purchase_units?.[0] || {};
    const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
    const toCents = /* @__PURE__ */ __name((value) => Math.round(Number.parseFloat(value) * 100), "toCents");
    const order = {
      provider: "paypal",
      ref: result.id,
      email: details.payer?.email_address || "",
      name: [details.payer?.name?.given_name, details.payer?.name?.surname].filter(Boolean).join(" "),
      currency: capture?.amount?.currency_code || unit.amount?.currency_code,
      total: toCents(capture?.amount?.value ?? unit.amount?.value),
      items: (unit.items || []).map((item) => ({ id: item.sku, name: item.name, qty: Number(item.quantity), price: toCents(item.unit_amount?.value) })),
      shipping: unit.shipping || null
    };
    const { number, created } = await recordOrder(env, order);
    if (created) ctx.waitUntil(notifyNewOrder(env, { ...order, number }));
    return json({ id: result.id, status: result.status, number });
  }
  return json({ id: result.id, status: result.status });
}
__name(capturePayPalOrder, "capturePayPalOrder");

// worker/lib/coming-soon.js
var PAGE = "/coming-soon";
var COOKIE = "site_preview";
var MAX_AGE = 60 * 60 * 24 * 30;
var PUBLIC = [
  /^\/robots\.txt$/,
  /^\/favicon\.svg$/,
  /^\/apple-touch-icon\.png$/,
  /^\/assets\/[^/]+\.(css|js|woff2)$/,
  /^\/assets\/rpb-logo-[^/]+$/
];
var token = /* @__PURE__ */ __name((password) => hmacHex(password, "coming-soon-preview"), "token");
var safeNext = /* @__PURE__ */ __name((value) => typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/", "safeNext");
async function page(request, env, { next, error = false } = {}) {
  const asset = await env.ASSETS.fetch(new Request(new URL(PAGE, request.url), { headers: request.headers }));
  let rewriter = new HTMLRewriter().on('input[name="next"]', {
    element: /* @__PURE__ */ __name((el) => el.setAttribute("value", next), "element")
  });
  if (error) {
    rewriter = rewriter.on("[data-unlock-error]", { element: /* @__PURE__ */ __name((el) => el.setInnerContent("That password didn\u2019t work. Please try again."), "element") }).on('input[name="password"]', {
      element: /* @__PURE__ */ __name((el) => {
        el.setAttribute("aria-invalid", "true");
        el.setAttribute("autofocus", "");
      }, "element")
    });
  }
  const response = rewriter.transform(asset);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, { status: error ? 401 : 503, headers });
}
__name(page, "page");
async function unlock(request, env, url) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  if (!isSameOrigin(request, url)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const next = safeNext(form.get("next"));
  const password = String(form.get("password") || "");
  if (!env.SITE_PASSWORD || !password || !safeEqual(await token(password), await token(env.SITE_PASSWORD))) {
    return page(request, env, { next, error: true });
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: next,
      "Cache-Control": "no-store",
      "Set-Cookie": `${COOKIE}=${await token(env.SITE_PASSWORD)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`
    }
  });
}
__name(unlock, "unlock");
async function comingSoon(request, env) {
  if (!site_config_default.comingSoon) return null;
  const url = new URL(request.url);
  if (url.pathname === "/api/unlock") return unlock(request, env, url);
  if (url.pathname.startsWith("/api/webhooks/")) return null;
  if (/^\/(api\/)?admin(\/|\.html$|$)/.test(url.pathname)) return null;
  const cookie = readCookie(request, COOKIE);
  if (env.SITE_PASSWORD && cookie && safeEqual(cookie, await token(env.SITE_PASSWORD))) return null;
  if (PUBLIC.some((pattern) => pattern.test(url.pathname))) return env.ASSETS.fetch(request);
  return page(request, env, { next: url.pathname + url.search });
}
__name(comingSoon, "comingSoon");

// worker/lib/admin.js
var PAGE_SIZE = 25;
async function admin(request, env) {
  requireFeature("shop");
  requireEnv(env, "DB");
  return requireAdmin(request, env);
}
__name(admin, "admin");
var adminOrder = /* @__PURE__ */ __name((row) => ({ ...toOrder(row), email: row.email, name: row.name, provider: row.provider, providerRef: row.provider_ref, updatedAt: row.updated_at }), "adminOrder");
var audit2 = /* @__PURE__ */ __name((env, actor, action, orderId, detail) => env.DB.prepare("INSERT INTO audit_log (actor, action, order_id, detail, created_at) VALUES (?, ?, ?, ?, ?)").bind(
  `${actor.email} (${actor.role})`,
  action,
  orderId,
  JSON.stringify(detail),
  Date.now()
), "audit");
async function findOrder(env, number) {
  const row = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderIdFrom(number)).first();
  if (!row) throw new HttpError(404, "Order not found.");
  return row;
}
__name(findOrder, "findOrder");
async function adminMe(request, env) {
  return json(await admin(request, env));
}
__name(adminMe, "adminMe");
async function adminListOrders(request, env) {
  await admin(request, env);
  const params = new URL(request.url).searchParams;
  const where = [];
  const binds = [];
  const status = params.get("status");
  if (STATUSES.includes(status)) {
    where.push("status = ?");
    binds.push(status);
  }
  const email = normalizeEmail2(params.get("email"));
  if (email) {
    where.push("email = ?");
    binds.push(email);
  }
  const q = clean(params.get("q"), 200).toLowerCase();
  if (/^#?\d+$/.test(q)) {
    where.push("id = ?");
    binds.push(orderIdFrom(q.replace("#", "")));
  } else if (q) {
    where.push("(email LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    binds.push(like, like);
  }
  const before = Number.parseInt(params.get("before"), 10);
  if (before > 0) {
    where.push("id < ?");
    binds.push(orderIdFrom(before));
  }
  const sql = `SELECT * FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ${PAGE_SIZE + 1}`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  const orders = results.slice(0, PAGE_SIZE).map(adminOrder);
  return json({ orders, next: results.length > PAGE_SIZE ? orders.at(-1).number : null });
}
__name(adminListOrders, "adminListOrders");
async function adminGetOrder(request, env, ctx, [number]) {
  await admin(request, env);
  const row = await findOrder(env, number);
  const [[notes, history], messages] = await Promise.all([
    env.DB.batch([
      env.DB.prepare("SELECT author, body, created_at FROM order_notes WHERE order_id = ? ORDER BY id").bind(row.id),
      env.DB.prepare("SELECT actor, action, detail, created_at FROM audit_log WHERE order_id = ? ORDER BY id").bind(row.id)
    ]),
    loadMessages(env, [row.id])
  ]);
  return json({
    order: adminOrder(row),
    messages: messages.get(row.id),
    notes: notes.results.map((n) => ({ author: n.author, body: n.body, createdAt: n.created_at })),
    history: history.results.map((h) => ({ actor: h.actor, action: h.action, detail: JSON.parse(h.detail), createdAt: h.created_at }))
  });
}
__name(adminGetOrder, "adminGetOrder");
async function adminUpdateOrder(request, env, ctx, [number]) {
  const actor = await admin(request, env);
  const row = await findOrder(env, number);
  const body = await readJson(request);
  const status = body.status ?? row.status;
  if (!STATUSES.includes(status)) throw new HttpError(400, "Unknown status.");
  const tracking = body.tracking === void 0 ? row.tracking : clean(body.tracking, 200);
  if (status === row.status && tracking === row.tracking) return json({ order: adminOrder(row) });
  const [updated] = await env.DB.batch([
    env.DB.prepare("UPDATE orders SET status = ?, tracking = ?, updated_at = ? WHERE id = ? RETURNING *").bind(status, tracking, Date.now(), row.id),
    audit2(env, actor, "update", row.id, { from: { status: row.status, tracking: row.tracking }, to: { status, tracking }, notified: Boolean(body.notify) })
  ]);
  if (body.notify) {
    ctx.waitUntil(
      sendEmail(env, {
        to: row.email,
        replyTo: env.CONTACT_TO,
        subject: `Order #${orderNumber(row.id)} is ${status}`,
        text: `Your ${site_config_default.name} order #${orderNumber(row.id)} is now: ${status}.${tracking ? `
Tracking: ${tracking}` : ""}

See your orders at ${site_config_default.url}/orders
`
      }).catch((error) => console.error("Status email failed", error))
    );
  }
  return json({ order: adminOrder(updated.results[0]) });
}
__name(adminUpdateOrder, "adminUpdateOrder");
async function adminAddNote(request, env, ctx, [number]) {
  const actor = await admin(request, env);
  const row = await findOrder(env, number);
  const note = clean((await readJson(request)).body, 2e3);
  if (!note) throw new HttpError(400, "The note is empty.");
  await env.DB.prepare("INSERT INTO order_notes (order_id, author, body, created_at) VALUES (?, ?, ?, ?)").bind(row.id, actor.email, note, Date.now()).run();
  return json({ ok: true });
}
__name(adminAddNote, "adminAddNote");
async function adminPostMessage(request, env, ctx, [number]) {
  const actor = await admin(request, env);
  const row = await findOrder(env, number);
  const body = clean((await readJson(request)).body, 2e3);
  if (!body) throw new HttpError(400, "The message is empty.");
  await env.DB.prepare("INSERT INTO order_messages (order_id, author_role, author_email, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(row.id, actor.role, actor.email, body, Date.now()).run();
  ctx.waitUntil(
    sendEmail(env, {
      to: row.email,
      replyTo: env.CONTACT_TO,
      subject: `New message about your ${site_config_default.name} order #${orderNumber(row.id)}`,
      text: `${body}

To reply or see your order, sign in at ${site_config_default.url}/login

${site_config_default.name}
`
    }).catch((error) => console.error("Message email failed", error))
  );
  return json({ ok: true });
}
__name(adminPostMessage, "adminPostMessage");
var maskEmail = /* @__PURE__ */ __name((email) => email.replace(/^(.)[^@]*(@.).*(\.[^.]+)$/, "$1\u2022\u2022\u2022$2\u2022\u2022\u2022$3"), "maskEmail");
var moveEmailStatements = /* @__PURE__ */ __name((env, from, to, now) => [
  env.DB.prepare("UPDATE orders SET email = ?, updated_at = ? WHERE email = ?").bind(to, now, from),
  env.DB.prepare("DELETE FROM login_tokens WHERE email = ?").bind(from)
], "moveEmailStatements");
var notifyEmailMove = /* @__PURE__ */ __name((env, ctx, from, to, count) => ctx.waitUntil(
  Promise.allSettled([
    sendEmail(env, {
      to: from,
      replyTo: env.CONTACT_TO,
      subject: `The email on your ${site_config_default.name} orders was changed`,
      text: `Your ${site_config_default.name} orders now use ${maskEmail(to)}. If you didn't ask for this, reply to this email right away.
`
    }),
    sendEmail(env, {
      to,
      replyTo: env.CONTACT_TO,
      subject: `Your ${site_config_default.name} orders now use this email`,
      text: `${count} order${count === 1 ? "" : "s"} moved to this address. Sign in to see them at ${site_config_default.url}/login
`
    })
  ])
), "notifyEmailMove");
var countOrders = /* @__PURE__ */ __name((env, email) => env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE email = ?").bind(email).first("n"), "countOrders");
var parseShipping = /* @__PURE__ */ __name((json2) => normalizeShipping(json2 ? JSON.parse(json2) : null), "parseShipping");
async function adminEditCustomer(request, env, ctx, [number]) {
  const actor = await admin(request, env);
  const row = await findOrder(env, number);
  const body = await readJson(request);
  const name = body.name === void 0 ? row.name : clean(body.name, 200);
  const oldShipping = parseShipping(row.shipping);
  const shipping = body.shipping === void 0 ? oldShipping : normalizeShipping(body.shipping);
  const email = body.email === void 0 ? row.email : normalizeEmail2(body.email);
  if (!isEmail(email)) throw new HttpError(400, "Please enter a valid email address.");
  const emailChanged = email !== row.email;
  if (emailChanged && body.confirmed !== true) throw new HttpError(400, "Confirm you\u2019ve verified this person before changing their email.");
  const changes = {};
  if (name !== row.name) changes.name = { from: row.name, to: name };
  if (JSON.stringify(shipping) !== JSON.stringify(oldShipping)) changes.shipping = { from: oldShipping, to: shipping };
  if (emailChanged) {
    changes.email = { from: row.email, to: email, orders: await countOrders(env, row.email) };
  }
  if (!Object.keys(changes).length) return json({ order: adminOrder(row) });
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET name = ?, shipping = ?, updated_at = ? WHERE id = ?").bind(name, shipping ? JSON.stringify(shipping) : null, now, row.id),
    ...emailChanged ? moveEmailStatements(env, row.email, email, now) : [],
    audit2(env, actor, "edit-customer", row.id, changes)
  ]);
  if (emailChanged) notifyEmailMove(env, ctx, row.email, email, changes.email.orders);
  return json({ order: adminOrder(await findOrder(env, number)) });
}
__name(adminEditCustomer, "adminEditCustomer");
async function adminListCustomers(request, env) {
  await admin(request, env);
  const params = new URL(request.url).searchParams;
  const q = clean(params.get("q"), 200).toLowerCase();
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const { results } = await env.DB.prepare(
    `SELECT email, MAX(name) AS name, COUNT(*) AS orders, SUM(total) AS spent, MAX(currency) AS currency, MAX(created_at) AS last_order
		 FROM orders ${q ? "WHERE email LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\'" : ""}
		 GROUP BY email ORDER BY last_order DESC LIMIT 500`
  ).bind(...q ? [like, like] : []).all();
  return json({
    customers: results.map((c) => ({ email: c.email, name: c.name, orders: c.orders, spent: c.spent, currency: c.currency, lastOrder: c.last_order }))
  });
}
__name(adminListCustomers, "adminListCustomers");
async function adminChangeCustomerEmail(request, env, ctx) {
  const actor = await admin(request, env);
  const body = await readJson(request);
  const from = normalizeEmail2(body.from);
  const to = normalizeEmail2(body.to);
  if (!isEmail(from) || !isEmail(to)) throw new HttpError(400, "Please enter a valid email address.");
  if (from === to) throw new HttpError(400, "The new email is the same as the old one.");
  if (body.confirmed !== true) throw new HttpError(400, "Confirm you\u2019ve verified this person before changing their email.");
  const count = await countOrders(env, from);
  if (!count) throw new HttpError(404, "No orders use that email.");
  await env.DB.batch([...moveEmailStatements(env, from, to, Date.now()), audit2(env, actor, "change-email", null, { from, to, orders: count })]);
  notifyEmailMove(env, ctx, from, to, count);
  return json({ moved: count });
}
__name(adminChangeCustomerEmail, "adminChangeCustomerEmail");
var csvCell = /* @__PURE__ */ __name((value) => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}, "csvCell");
async function adminExportCsv(request, env) {
  await admin(request, env);
  const { results } = await env.DB.prepare("SELECT * FROM orders ORDER BY id").all();
  const header = ["Order", "Date", "Status", "Email", "Name", "Items", "Total", "Currency", "Tracking", "Provider", "Provider reference"];
  const rows = results.map((row) => {
    const items = JSON.parse(row.items).map((item) => `${item.qty} x ${item.name}`).join("; ");
    return [orderNumber(row.id), new Date(row.created_at).toISOString(), row.status, row.email, row.name, items, (row.total / 100).toFixed(2), row.currency.toUpperCase(), row.tracking, row.provider, row.provider_ref];
  });
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new Response(`${csv}\r
`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
__name(adminExportCsv, "adminExportCsv");

// worker/lib/admin-report.js
async function adminReportError(request, env) {
  const actor = await requireAdmin(request, env);
  const body = await readJson(request);
  const details = clean(typeof body.details === "string" ? body.details : JSON.stringify(body.details, null, 2), 8e3);
  if (!details) throw new HttpError(400, "Nothing to report.");
  const note = clean(body.note, 2e3);
  const page2 = clean(body.page, 500);
  const to = env.SUPPORT_EMAIL || emailList(env.PROVIDER_EMAILS)[0] || env.CONTACT_TO;
  await sendEmail(env, {
    to,
    replyTo: actor.email,
    subject: `[${site_config_default.name} admin] Error report from ${actor.email}`,
    text: `${actor.email} (${actor.role}) reported an error in the ${site_config_default.name} admin.

Page: ${page2 || "-"}
${note ? `Note: ${note}
` : ""}
${details}
`
  });
  return json({ ok: true, to });
}
__name(adminReportError, "adminReportError");

// worker/index.js
var routes = [
  ["POST", /^\/api\/contact$/, handleContact],
  ["POST", /^\/api\/checkout\/stripe$/, createStripeCheckout],
  ["POST", /^\/api\/webhooks\/stripe$/, handleStripeWebhook, { crossOrigin: true }],
  ["POST", /^\/api\/paypal\/orders$/, createPayPalOrder],
  ["POST", /^\/api\/paypal\/orders\/([A-Z0-9]+)\/capture$/, capturePayPalOrder],
  ["POST", /^\/api\/login$/, login],
  ["POST", /^\/api\/orders\/session$/, createOrderSession],
  ["POST", /^\/api\/orders\/logout$/, endOrderSession],
  ["GET", /^\/api\/orders$/, listMyOrders],
  ["POST", /^\/api\/orders\/(\d+)\/messages$/, postCustomerMessage],
  ["GET", /^\/api\/admin\/me$/, adminMe],
  ["GET", /^\/api\/admin\/orders$/, adminListOrders],
  ["GET", /^\/api\/admin\/orders\.csv$/, adminExportCsv],
  ["GET", /^\/api\/admin\/orders\/(\d+)$/, adminGetOrder],
  ["PATCH", /^\/api\/admin\/orders\/(\d+)$/, adminUpdateOrder],
  ["POST", /^\/api\/admin\/orders\/(\d+)\/notes$/, adminAddNote],
  ["POST", /^\/api\/admin\/orders\/(\d+)\/messages$/, adminPostMessage],
  ["PATCH", /^\/api\/admin\/orders\/(\d+)\/customer$/, adminEditCustomer],
  ["GET", /^\/api\/admin\/customers$/, adminListCustomers],
  ["POST", /^\/api\/admin\/customers\/email$/, adminChangeCustomerEmail],
  ["GET", /^\/api\/admin\/users$/, adminListUsers],
  ["POST", /^\/api\/admin\/users$/, adminAddUser],
  ["DELETE", /^\/api\/admin\/users$/, adminRemoveUser],
  ["POST", /^\/api\/admin\/report$/, adminReportError]
];
var index_default = {
  async fetch(request, env, ctx) {
    const gated = await comingSoon(request, env);
    if (gated) return gated;
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const allowed = [];
    for (const [method, pattern, handler, options = {}] of routes) {
      const match = url.pathname.match(pattern);
      if (!match) continue;
      if (request.method !== method) {
        allowed.push(method);
        continue;
      }
      if (!options.crossOrigin && !isSameOrigin(request, url)) return json({ error: "Forbidden" }, 403);
      try {
        return await handler(request, env, ctx, match.slice(1));
      } catch (error) {
        const known = error instanceof HttpError;
        if (known && error.status < 500) return json({ error: error.message }, error.status);
        const id = crypto.randomUUID().slice(0, 8);
        console.error(`[${id}] ${method} ${url.pathname} failed`, error);
        const status = known ? error.status : 500;
        const body = { error: known ? error.message : "Something went wrong. Please try again.", errorId: id };
        if (url.pathname.startsWith("/api/admin/")) {
          body.detail = {
            id,
            time: (/* @__PURE__ */ new Date()).toISOString(),
            request: `${method} ${url.pathname}${url.search}`,
            status,
            cause: known && error.internal || String(error?.message || error),
            stack: known ? void 0 : String(error?.stack || "").split("\n").slice(0, 6).join("\n")
          };
        }
        return json(body, status);
      }
    }
    if (allowed.length) return json({ error: "Method not allowed" }, 405, { Allow: allowed.join(", ") });
    return json({ error: "Not found" }, 404);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
