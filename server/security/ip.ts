import { isIP } from 'node:net';

/**
 * Returns true when an address must never be contacted by the server:
 * loopback, private, link-local, CGNAT, multicast, reserved, documentation,
 * benchmarking, unspecified, and IPv4-mapped/compatible/NAT64 forms of those.
 */
export function isBlockedIp(address: string): boolean {
  const ip = address
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%')[0]!;
  const family = isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true; // Anything unparseable is unsafe.
}

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

function isBlockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  // Embedded IPv4 tail (e.g. ::ffff:10.0.0.1)
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const n = v4ToInt(v4[1]!);
    s = s.slice(0, -v4[1]!.length) + `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g || '0', 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  const allZeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  const embeddedV4 = () => `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`;

  if (allZeroUntil(8)) return true; // ::
  if (allZeroUntil(7) && g[7] === 1) return true; // ::1
  if (allZeroUntil(5) && g[5] === 0xffff) return isBlockedV4(embeddedV4()); // ::ffff:a.b.c.d
  if (allZeroUntil(6)) return isBlockedV4(embeddedV4()); // ::a.b.c.d (deprecated compat)
  if (g[0] === 0x64 && g[1] === 0xff9b) return isBlockedV4(embeddedV4()); // NAT64
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2002) return true; // 6to4 can embed private v4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 discard
  return false;
}
