import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { test } from "node:test";
import { collectLocalNetworks, createLocalNetworkChecker, createMcpAccessGuard, normalizePeerAddress } from "./access.js";

/** 只保留判定需要的字段，避免在测试里伪造 mac / internal 等无关属性。 */
const dockerLikeInterfaces = {
  eth0: [{ address: "172.17.0.2", family: "IPv4", cidr: "172.17.0.2/16" }]
};

test("normalizePeerAddress strips the IPv4-mapped IPv6 prefix so both forms match the same rules", () => {
  assert.deepEqual(normalizePeerAddress("::ffff:172.17.0.1"), { address: "172.17.0.1", family: "ipv4" });
  assert.deepEqual(normalizePeerAddress("172.17.0.1"), { address: "172.17.0.1", family: "ipv4" });
  assert.deepEqual(normalizePeerAddress("::1"), { address: "::1", family: "ipv6" });
});

test("normalizePeerAddress ignores missing or unusable peer addresses", () => {
  for (const value of [undefined, "", "::ffff:", "not-an-address"]) {
    assert.equal(normalizePeerAddress(value), null, `value ${JSON.stringify(value)}`);
  }
});

test("collectLocalNetworks derives subnets from interface CIDRs and always allows loopback", () => {
  const ranges = collectLocalNetworks({});

  assert.ok(ranges.some((range) => range.address === "127.0.0.1" && range.prefix === 8));
  assert.ok(ranges.some((range) => range.family === "ipv6" && range.prefix === 128));
});

test("collectLocalNetworks keeps interface subnets and skips entries without a CIDR", () => {
  const ranges = collectLocalNetworks({
    eth0: [{ address: "172.17.0.2", family: "IPv4", cidr: "172.17.0.2/16" }],
    broken: [{ address: "10.0.0.5", family: "IPv4", cidr: null }]
  });

  assert.ok(ranges.some((range) => range.address === "172.17.0.2" && range.prefix === 16));
  assert.ok(!ranges.some((range) => range.address === "10.0.0.5"));
});

test("checker allows loopback and peers inside the container network", () => {
  const isLocal = createLocalNetworkChecker(collectLocalNetworks(dockerLikeInterfaces));

  for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "172.17.0.1", "172.17.0.9"]) {
    assert.equal(isLocal(peer), true, `peer ${peer}`);
  }
});

test("checker rejects LAN, public and unknown peers", () => {
  const isLocal = createLocalNetworkChecker(collectLocalNetworks(dockerLikeInterfaces));

  for (const peer of ["192.168.1.20", "::ffff:192.168.1.20", "8.8.8.8", "fd00::1", undefined, ""]) {
    assert.equal(isLocal(peer), false, `peer ${JSON.stringify(peer)}`);
  }
});

function fakeRequest(remoteAddress: string | undefined): Request {
  return { socket: { remoteAddress } } as unknown as Request;
}

function fakeResponse(): { response: Response; status?: number; body?: unknown } {
  const state: { response: Response; status?: number; body?: unknown } = { response: undefined as unknown as Response };
  state.response = {
    status(code: number) {
      state.status = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      return this;
    }
  } as unknown as Response;
  return state;
}

test("guard passes through when network access is allowed", () => {
  const guard = createMcpAccessGuard({ isLocal: () => false, isNetworkAccessAllowed: () => true });
  let calls = 0;

  guard(fakeRequest("8.8.8.8"), fakeResponse().response, (() => { calls += 1; }) as NextFunction);

  assert.equal(calls, 1);
});

test("guard passes local callers when only local access is allowed", () => {
  const guard = createMcpAccessGuard({ isLocal: () => true, isNetworkAccessAllowed: () => false });
  let calls = 0;

  guard(fakeRequest("127.0.0.1"), fakeResponse().response, (() => { calls += 1; }) as NextFunction);

  assert.equal(calls, 1);
});

test("guard rejects remote callers when only local access is allowed", () => {
  const guard = createMcpAccessGuard({ isLocal: () => false, isNetworkAccessAllowed: () => false });
  const state = fakeResponse();
  let calls = 0;

  guard(fakeRequest("192.168.1.20"), state.response, (() => { calls += 1; }) as NextFunction);

  assert.equal(calls, 0);
  assert.equal(state.status, 403);
  assert.deepEqual(state.body, { error: { code: "ACCESS_DENIED", message: "该 MCP 端点当前仅允许本机访问" } });
});
