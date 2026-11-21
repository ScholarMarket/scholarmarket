// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/api/auth", () => ({ getUserFromCookie: mocks.auth, sanitizeString: value => String(value || "").trim() }));
vi.mock("@/lib/api/audit", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/cache/redis", () => ({ invalidateMarketplaceCache: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendPurchaseReceiptEmail: vi.fn(), sendRefundNotificationEmail: vi.fn(), sendWelcomeEmail: vi.fn() }));
vi.mock("@/lib/webhooks/sender", () => ({ sendWebhookWithRetry: vi.fn() }));
import { setCreatorFollow, publishWithFollowers, fanoutCreatorPublication, deliverCreatorNotification } from "../creatorFollows";
import { leaseNextIntent } from "../outbox";
import { processSideEffectIntent } from "../sideEffectWorker";
import { POST as follow, DELETE as unfollow } from "@/app/api/creators/[address]/follow/route";
import { GET as feed } from "@/app/api/following/feed/route";
import { GET as profile } from "@/app/api/profile/route";
import { POST as publish } from "@/app/api/materials/[id]/publish/route";
import { resetRateLimits } from "@/lib/api/rateLimit";
let replica, client, db;
const creator = "0x" + "a".repeat(40);
const follower = "0x" + "b".repeat(40);
const publishedAt = new Date("2026-11-21T12:00:00Z");
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ binary: { version: "7.0.14" }, replSet: { count: 1, storageEngine: "wiredTiger" } });
  client = await MongoClient.connect(replica.getUri());
  const realDb = client.db("follows-tests");
  const collections = new Map();
  db = { client, collection: name => {
    if (!collections.has(name)) collections.set(name, realDb.collection(name));
    return collections.get(name);
  } };
  mocks.getDb.mockResolvedValue(db);
  await db.collection("follows").createIndex({ follower: 1, creator: 1 }, { unique: true, name: "follows_pair_idx" });
}, 600000);
afterEach(async () => {
  vi.restoreAllMocks();
  resetRateLimits();
  for (const name of ["materials", "follows", "users", "notifications", "side_effect_outbox"]) await db.collection(name).deleteMany({});
});
afterAll(async () => { await client?.close(); await replica?.stop(); });
async function seedMaterial(overrides = {}) {
  const material = { _id: new ObjectId(), userAddress: creator, title: "Calculus", visibility: "public", status: "draft", ...overrides };
  await db.collection("materials").insertOne(material);
  return material;
}
async function seedFollower(address = follower, preferences = {}) {
  await db.collection("users").insertOne({ walletAddress: address.toUpperCase(), notificationPreferences: preferences });
  await db.collection("follows").insertOne({ creator, follower: address, createdAt: new Date("2026-11-20") });
}
describe("creator follow persistence and publication", () => {
  it("makes repeated and concurrent follows idempotent using the unique pair index", async () => {
    await Promise.all(Array.from({ length: 5 }, () => setCreatorFollow(db, follower.toUpperCase(), creator, true)));
    expect(await db.collection("follows").countDocuments({})).toBe(1);
    expect(await setCreatorFollow(db, follower, creator, true)).toBe(1);
    expect(await setCreatorFollow(db, follower, creator, false)).toBe(0);
    expect(await setCreatorFollow(db, follower, creator, false)).toBe(0);
  });
  it("commits one publication job under concurrent publication requests", async () => {
    const material = await seedMaterial();
    const results = await Promise.all([publishWithFollowers(db, material, { status: "published", publishedAt }), publishWithFollowers(db, material, { status: "published", publishedAt })]);
    expect(results.sort()).toEqual([false, true]);
    expect(await db.collection("side_effect_outbox").countDocuments({ "intent.type": "creator_publication" })).toBe(1);
    const leased = await leaseNextIntent("test-worker");
    expect(leased.intent.type).toBe("creator_publication");
    expect(leased.status).toBe("leased");
  });
  it("rolls back publication when the outbox write fails", async () => {
    const material = await seedMaterial();
    vi.spyOn(db.collection("side_effect_outbox"), "updateOne").mockRejectedValue(new Error("outbox unavailable"));
    await expect(publishWithFollowers(db, material, { status: "published", publishedAt })).rejects.toThrow("outbox unavailable");
    expect((await db.collection("materials").findOne({ _id: material._id })).status).toBe("draft");
  });
  it("does not publish deleted materials or notify about private publications", async () => {
    const deleted = await seedMaterial({ deletedAt: new Date() });
    expect(await publishWithFollowers(db, deleted, { status: "published", publishedAt })).toBe(false);
    const privateMaterial = await seedMaterial({ visibility: "private" });
    expect(await publishWithFollowers(db, privateMaterial, { status: "published", publishedAt })).toBe(true);
    expect(await db.collection("side_effect_outbox").countDocuments({})).toBe(0);
  });
  it("queues and delivers exactly one notification per eligible follower across retries", async () => {
    await seedFollower();
    await seedFollower("0x" + "c".repeat(40), { productUpdates: false });
    await db.collection("follows").insertOne({ creator, follower: "late", createdAt: new Date("2026-11-22") });
    const material = await seedMaterial();
    await publishWithFollowers(db, material, { status: "published", publishedAt });
    const publication = await db.collection("side_effect_outbox").findOne({ "intent.type": "creator_publication" });
    await processSideEffectIntent(publication);
    await processSideEffectIntent(publication);
    const notifications = await db.collection("side_effect_outbox").find({ "intent.type": "creator_notification" }).toArray();
    expect(notifications).toHaveLength(1);
    await processSideEffectIntent(notifications[0]);
    await processSideEffectIntent(notifications[0]);
    const delivered = await db.collection("notifications").find({}).toArray();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ recipient: follower, metadata: { materialId: String(material._id), creator } });
  });
  it("honors preference changes made after enqueueing", async () => {
    await seedFollower(follower, { productUpdates: false });
    await deliverCreatorNotification(db, { follower, creator, materialId: "m1", title: "New" });
    expect(await db.collection("notifications").countDocuments({})).toBe(0);
  });
  it("fans out in bounded batches and resumes with a stable cursor", async () => {
    await db.collection("follows").insertMany(Array.from({ length: 101 }, (_, i) => ({ creator, follower: `0x${i.toString(16).padStart(40, "0")}`, createdAt: new Date("2026-11-20") })));
    const payload = { materialId: "m1", creator, publishedAt, title: "New" };
    await fanoutCreatorPublication(db, payload);
    expect(await db.collection("side_effect_outbox").countDocuments({ "intent.type": "creator_notification" })).toBe(100);
    const continuation = await db.collection("side_effect_outbox").findOne({ "intent.type": "creator_publication" });
    expect(continuation.intent.payload.after).toBeTruthy();
    await fanoutCreatorPublication(db, continuation.intent.payload);
    await fanoutCreatorPublication(db, continuation.intent.payload);
    expect(await db.collection("side_effect_outbox").countDocuments({ "intent.type": "creator_notification" })).toBe(101);
  });
});

const followContext = () => ({ params: Promise.resolve({ address: creator }) });
const req = (path, method = "GET") => new Request(`http://localhost${path}`, { method });
describe("creator follow API and feed", () => {
  it("authenticates, validates addresses, blocks self follows, and handles a missing creator", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await follow(req("/api/follow", "POST"), followContext())).status).toBe(401);
    mocks.auth.mockResolvedValue({ walletAddress: creator.toUpperCase() });
    expect((await follow(req("/api/follow", "POST"), followContext())).status).toBe(400);
    mocks.auth.mockResolvedValue({ walletAddress: follower });
    expect((await follow(req("/api/follow", "POST"), { params: Promise.resolve({ address: "invalid" }) })).status).toBe(400);
    expect((await follow(req("/api/follow", "POST"), followContext())).status).toBe(404);
  });
  it("follows twice with one record, exposes profile counts, and unfollows idempotently", async () => {
    mocks.auth.mockResolvedValue({ walletAddress: follower });
    await db.collection("users").insertOne({ walletAddress: creator });
    for (let i = 0; i < 2; i++) {
      const response = await follow(req("/api/follow", "POST"), followContext());
      expect(await response.json()).toEqual({ following: true, followerCount: 1 });
    }
    const profileResponse = await profile(req(`/api/profile?address=${creator}`));
    expect(await profileResponse.json()).toMatchObject({ followerCount: 1, user: { followerCount: 1 } });
    for (let i = 0; i < 2; i++) {
      expect(await (await unfollow(req("/api/follow", "DELETE"), followContext())).json()).toEqual({ following: false, followerCount: 0 });
    }
  });
  it.each([["POST", follow], ["DELETE", unfollow]])("rate limits %s", async (method, handler) => {
    mocks.auth.mockResolvedValue({ walletAddress: follower });
    await db.collection("users").insertOne({ walletAddress: creator });
    for (let i = 0; i < 30; i++) expect((await handler(req("/api/follow", method), followContext())).status).toBe(200);
    const response = await handler(req("/api/follow", method), followContext());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
  });
  it("paginates a following feed without duplicates at matching timestamps and hides deleted/private materials", async () => {
    mocks.auth.mockResolvedValue({ walletAddress: follower });
    await seedFollower();
    const docs = await Promise.all(Array.from({ length: 3 }, () => seedMaterial({ status: "published", publishedAt, userAddress: creator.toUpperCase(), storageKey: "secret" })));
    await seedMaterial({ status: "published", publishedAt, deletedAt: new Date() });
    await seedMaterial({ status: "published", publishedAt, visibility: "private" });
    await seedMaterial({ status: "draft", publishedAt });
    await seedMaterial({ status: "published", publishedAt, userAddress: "someone-else" });
    const first = await (await feed(req("/api/following/feed?limit=2"))).json();
    expect(first.items).toHaveLength(2);
    expect(first.items[0].storageKey).toBeUndefined();
    expect(first.nextCursor).toBeTruthy();
    const second = await (await feed(req(`/api/following/feed?limit=2&cursor=${first.nextCursor}`))).json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item._id))).toEqual(new Set(docs.map(doc => String(doc._id))));
  });
  it("requires authentication, rejects malformed cursors, and returns an empty feed without follows", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await feed(req("/api/following/feed"))).status).toBe(401);
    mocks.auth.mockResolvedValue({ walletAddress: follower });
    expect((await feed(req("/api/following/feed?cursor=bad"))).status).toBe(400);
    expect(await (await feed(req("/api/following/feed"))).json()).toEqual({ items: [], nextCursor: null });
  });
  it("publishes through the route using promised params and queues only one job on repeat", async () => {
    mocks.auth.mockResolvedValue({ walletAddress: creator });
    const material = await seedMaterial({ storageKey: "cid", quarantineState: "clean" });
    const context = { params: Promise.resolve({ id: String(material._id) }) };
    const first = await publish(req("/api/publish", "POST"), context);
    expect(first.status).toBe(200);
    expect(await (await publish(req("/api/publish", "POST"), context)).json()).toMatchObject({ alreadyPublished: true });
    expect(await db.collection("side_effect_outbox").countDocuments({})).toBe(1);
  });
});
