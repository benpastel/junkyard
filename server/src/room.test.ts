import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { REPLACED, type RoomView } from "@ja/shared";
import { Room } from "./room.js";

function fakeSocket() {
  const sock = { readyState: 1, OPEN: 1, sent: [] as unknown[], closedWith: null as number | null, send: (d: string) => sock.sent.push(JSON.parse(d)), close: (code?: number) => (sock.closedWith = code ?? 1000) };
  return sock;
}
const asWs = (s: ReturnType<typeof fakeSocket>) => s as unknown as WebSocket;
/** Everyone seated, as the latest room view sent to `to` lists them (offline players included). */
function names(to: ReturnType<typeof fakeSocket>) {
  const views = to.sent.filter((m): m is { t: "room"; room: RoomView } => (m as { t: string }).t === "room");
  return views.at(-1)!.room.players.map((p) => p.name);
}

describe("seats", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps a dropped seat for two minutes between rounds, then lets it go", () => {
    const room = new Room("ABCD");
    const a = fakeSocket();
    const b = fakeSocket();
    room.join(asWs(a), "Ingrid", "id-1");
    room.join(asWs(b), "Ada", "id-2");
    room.leave("id-1", asWs(a));
    room.reap();
    expect(names(b)).toEqual(["Ingrid", "Ada"]);
    vi.advanceTimersByTime(121_000);
    room.reap();
    expect(names(b)).toEqual(["Ada"]);
  });

  it("a reload in the grace period is the same player", () => {
    const room = new Room("ABCD");
    const a = fakeSocket();
    const again = fakeSocket();
    room.join(asWs(a), "Ingrid", "id-1");
    room.leave("id-1", asWs(a));
    vi.advanceTimersByTime(60_000);
    expect(room.join(asWs(again), "Ingrid", "id-1")).toBe("id-1");
    vi.advanceTimersByTime(120_000);
    room.reap();
    expect(names(again)).toEqual(["Ingrid"]);
  });

  it("a second tab takes the seat and closes the first with REPLACED", () => {
    const room = new Room("ABCD");
    const a = fakeSocket();
    const b = fakeSocket();
    room.join(asWs(a), "Ingrid", "id-1");
    room.join(asWs(b), "Ingrid", "id-1");
    expect(a.closedWith).toBe(REPLACED);
    expect(names(b)).toEqual(["Ingrid"]);
  });

  it("evicting (quit, or sat down elsewhere) frees the seat at once", () => {
    const room = new Room("ABCD");
    const b = fakeSocket();
    room.join(asWs(fakeSocket()), "Ingrid", "id-1");
    room.join(asWs(b), "Ada", "id-2");
    room.evict("id-1");
    expect(names(b)).toEqual(["Ada"]);
  });
});
