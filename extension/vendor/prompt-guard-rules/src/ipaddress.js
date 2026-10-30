// Python 3.13 ipaddress 모듈의 파싱·is_private 판단을 옮긴 것.
// 서버(Python)와 같은 IP 를 같은 유형(internal_ip, ip_address ...)으로 분류하기 위해 필요하다.

const V4_PRIVATE = [
  "0.0.0.0/8", "10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24",
  "192.0.0.170/31", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24",
  "203.0.113.0/24", "240.0.0.0/4", "255.255.255.255/32",
];
const V4_PRIVATE_EXCEPTIONS = ["192.0.0.9/32", "192.0.0.10/32"];
const V6_PRIVATE = [
  "::1/128", "::/128", "::ffff:0:0/96", "64:ff9b:1::/48", "100::/64", "2001::/23", "2001:db8::/32",
  "2002::/16", "3fff::/20", "fc00::/7", "fe80::/10",
];
const V6_PRIVATE_EXCEPTIONS = [
  "2001:1::1/128", "2001:1::2/128", "2001:3::/32", "2001:4:112::/48", "2001:20::/28", "2001:30::/28",
];

function parseOctet(s) {
  if (!s || !/^[0-9]+$/.test(s) || s.length > 3) return null;
  if (s !== "0" && s[0] === "0") return null; // 앞자리 0 금지(bpo-36384)
  const n = Number(s);
  return n > 255 ? null : BigInt(n);
}

function parseV4(s) {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    const o = parseOctet(p);
    if (o === null) return null;
    v = (v << 8n) | o;
  }
  return v;
}

function parseHextet(s) {
  if (!/^[0-9A-Fa-f]{1,4}$/.test(s)) return null;
  return BigInt(parseInt(s, 16));
}

function parseV6(s) {
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length < 3) return null;
  if (parts[parts.length - 1].includes(".")) {
    const v4 = parseV4(parts.pop());
    if (v4 === null) return null;
    parts.push(((v4 >> 16n) & 0xffffn).toString(16), (v4 & 0xffffn).toString(16));
  }
  if (parts.length > 9) return null;
  let skip = null;
  for (let i = 1; i < parts.length - 1; i++) {
    if (!parts[i]) {
      if (skip !== null) return null;
      skip = i;
    }
  }
  let hi, lo, skipped;
  if (skip !== null) {
    hi = skip;
    lo = parts.length - skip - 1;
    if (!parts[0]) { hi -= 1; if (hi) return null; }
    if (!parts[parts.length - 1]) { lo -= 1; if (lo) return null; }
    skipped = 8 - (hi + lo);
    if (skipped < 1) return null;
  } else {
    if (parts.length !== 8 || !parts[0] || !parts[parts.length - 1]) return null;
    hi = parts.length; lo = 0; skipped = 0;
  }
  let v = 0n;
  for (let i = 0; i < hi; i++) {
    const h = parseHextet(parts[i]);
    if (h === null) return null;
    v = (v << 16n) | h;
  }
  v <<= 16n * BigInt(skipped);
  for (let i = -lo; i < 0; i++) {
    const h = parseHextet(parts[parts.length + i]);
    if (h === null) return null;
    v = (v << 16n) | h;
  }
  return v;
}

function parseAddress(s) {
  const v4 = parseV4(s);
  if (v4 !== null) return { version: 4, value: v4 };
  const v6 = parseV6(s);
  if (v6 !== null) return { version: 6, value: v6 };
  return null;
}

const bits = (version) => (version === 4 ? 32n : 128n);

function parseNetwork(s) {
  const [addr, prefix, extra] = s.split("/");
  if (extra !== undefined) return null;
  const a = parseAddress(addr);
  if (!a) return null;
  const max = bits(a.version);
  let len = max;
  if (prefix !== undefined) {
    if (!/^[0-9]+$/.test(prefix)) return null;
    len = BigInt(Number(prefix));
    if (len > max) return null;
  }
  const hostBits = max - len;
  const mask = ((1n << max) - 1n) ^ ((1n << hostBits) - 1n);
  const network = a.value & mask;
  return { version: a.version, network, broadcast: network | ((1n << hostBits) - 1n) };
}

const compiled = new Map();
function nets(list) {
  if (!compiled.has(list)) compiled.set(list, list.map(parseNetwork));
  return compiled.get(list);
}
const contains = (net, v) => v >= net.network && v <= net.broadcast;

function privateTables(version) {
  return version === 4
    ? [nets(V4_PRIVATE), nets(V4_PRIVATE_EXCEPTIONS)]
    : [nets(V6_PRIVATE), nets(V6_PRIVATE_EXCEPTIONS)];
}

function ipv4Mapped(a) {
  return a.version === 6 && a.value >> 32n === 0xffffn ? { version: 4, value: a.value & 0xffffffffn } : null;
}

function addressIsPrivate(a) {
  const mapped = ipv4Mapped(a);
  if (mapped) return addressIsPrivate(mapped);
  const [priv, exc] = privateTables(a.version);
  return priv.some((n) => contains(n, a.value)) && exc.every((n) => !contains(n, a.value));
}

/** Python ip_address(value) 결과 요약. 파싱 실패 시 null */
export function ipAddress(value) {
  const a = parseAddress(value);
  if (!a) return null;
  const mapped = ipv4Mapped(a);
  const base = mapped || a;
  return {
    isPrivate: addressIsPrivate(a),
    isLoopback: base.version === 4 ? (base.value >> 24n) === 127n : base.value === 1n,
    isUnspecified: base.value === 0n,
  };
}

/** Python ip_network(value, strict=False) 결과 요약. 파싱 실패 시 null */
export function ipNetwork(value) {
  const n = parseNetwork(value);
  if (!n) return null;
  const [priv, exc] = privateTables(n.version);
  const isPrivate =
    priv.some((p) => contains(p, n.network) && contains(p, n.broadcast)) &&
    exc.every((e) => !contains(e, n.network) && !contains(e, n.broadcast));
  return { isPrivate };
}
