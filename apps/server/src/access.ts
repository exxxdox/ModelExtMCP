import { BlockList, isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";

/**
 * MCP 端点的来源地址判定。
 *
 * 为什么不在“仅本机”时直接把监听地址改成 127.0.0.1：绑定地址只能在启动时决定，
 * 而且在容器里绑定回环会让端口映射整体失效（宿主机也连不上）。所以开关放在
 * HTTP 层按对端地址过滤，可以随时生效、不需要重启。
 *
 * 为什么“本机”包含本机网段：容器部署下，宿主机访问发布端口时对端地址是网桥网关
 * （如 172.17.0.1），而局域网上其他机器保留真实地址（如 192.168.1.20）。因此
 * “回环 + 与本进程接口同网段”在容器里恰好等于“宿主机与同一网络内的容器”，
 * 能挡住局域网访问。裸机部署时同网段即局域网，界面与文档已写明这一点。
 */

export type NetworkRange = { address: string; prefix: number; family: "ipv4" | "ipv6" };

type InterfaceEntry = { address: string; family: string; cidr: string | null };

// 无论接口枚举结果如何都必须放行回环地址，避免判定逻辑被平台差异带偏。
const LOOPBACK_RANGES: readonly NetworkRange[] = [
  { address: "127.0.0.1", prefix: 8, family: "ipv4" },
  { address: "::1", prefix: 128, family: "ipv6" }
];

/** 去掉 IPv4-mapped IPv6 前缀，否则同一个 IPv4 对端会有两种字符串形态，匹配会漏。 */
export function normalizePeerAddress(raw: string | undefined): { address: string; family: "ipv4" | "ipv6" } | null {
  if (!raw) return null;
  const mapped = raw.startsWith("::ffff:") ? raw.slice("::ffff:".length) : raw;
  const version = isIP(mapped);
  if (version === 4) return { address: mapped, family: "ipv4" };
  if (version === 6) return { address: mapped, family: "ipv6" };
  return null;
}

export function collectLocalNetworks(interfaces: Record<string, InterfaceEntry[] | undefined>): NetworkRange[] {
  const ranges: NetworkRange[] = [...LOOPBACK_RANGES];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry.cidr) continue;
      const [address, prefixText] = entry.cidr.split("/");
      const prefix = Number(prefixText);
      if (!address || !Number.isInteger(prefix)) continue;
      const version = isIP(address);
      if (version !== 4 && version !== 6) continue;
      ranges.push({ address, prefix, family: version === 4 ? "ipv4" : "ipv6" });
    }
  }

  return ranges;
}

export function createLocalNetworkChecker(ranges: readonly NetworkRange[]): (peerAddress: string | undefined) => boolean {
  const blockList = new BlockList();
  for (const range of ranges) {
    blockList.addSubnet(range.address, range.prefix, range.family === "ipv6" ? "ipv6" : "ipv4");
  }

  return (peerAddress) => {
    const peer = normalizePeerAddress(peerAddress);
    if (!peer) return false;
    return blockList.check(peer.address, peer.family === "ipv6" ? "ipv6" : "ipv4");
  };
}

export type AccessGuardOptions = {
  isLocal: (peerAddress: string | undefined) => boolean;
  isNetworkAccessAllowed: () => boolean;
};

export function createMcpAccessGuard({ isLocal, isNetworkAccessAllowed }: AccessGuardOptions) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (isNetworkAccessAllowed()) {
      next();
      return;
    }
    // 只读取 socket 对端地址，不读 X-Forwarded-For：该头可被客户端伪造，
    // 一旦据此判定，远程调用者就能把自己伪装成本机。
    if (isLocal(request.socket.remoteAddress)) {
      next();
      return;
    }
    response.status(403).json({ error: { code: "ACCESS_DENIED", message: "该 MCP 端点当前仅允许本机访问" } });
  };
}
