import { ObjectId } from "mongodb";
import { enqueueSideEffect } from "./outbox.js";

const BATCH_SIZE = 100;
export const canonicalAddress = address => String(address || "").trim().toLowerCase();

export async function setCreatorFollow(db, follower, creator, following) {
  const pair = { follower: canonicalAddress(follower), creator: canonicalAddress(creator) };
  if (following) {
    await db.collection("follows").createIndex({ follower: 1, creator: 1 }, { unique: true, name: "follows_pair_idx" });
    try {
      await db.collection("follows").updateOne(pair, { $setOnInsert: { ...pair, createdAt: new Date() } }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  } else await db.collection("follows").deleteOne(pair);
  return db.collection("follows").countDocuments({ creator: pair.creator });
}

/** Commit publication and its durable notification intent together. */
export async function publishWithFollowers(db, material, updates) {
  const session = db.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const result = await db.collection("materials").updateOne(
        { _id: material._id, deletedAt: null, status: { $ne: "published" } },
        { $set: updates }, { session }
      );
      if (!result.modifiedCount) return false;
      if (material.visibility !== "public") return true;
      await enqueueSideEffect({ db, session, sourceAggregate: "material", sourceId: String(material._id),
        dedupeKey: `creator-publication:${material._id}`,
        intent: { type: "creator_publication", payload: {
          materialId: String(material._id), creator: canonicalAddress(material.userAddress || material.ownerAddress),
          title: material.title, publishedAt: updates.publishedAt,
        } },
      });
      return true;
    });
  } finally { await session.endSession(); }
}

async function wantsPublications(db, follower) {
  const user = await db.collection("users").findOne({ $or: [
    { walletAddressLower: follower },
    { walletAddress: { $regex: `^${follower}$`, $options: "i" } },
  ] });
  return user?.notificationPreferences?.productUpdates !== false;
}

/** A bounded fanout job; retries reuse stable per-recipient outbox IDs. */
export async function fanoutCreatorPublication(db, payload) {
  const { materialId, creator, publishedAt, after } = payload;
  const query = { creator, createdAt: { $lte: new Date(publishedAt) } };
  if (after) query._id = { $gt: new ObjectId(after) };
  const followers = await db.collection("follows").find(query).sort({ _id: 1 }).limit(BATCH_SIZE).toArray();
  for (const { follower } of followers) {
    if (!await wantsPublications(db, follower)) continue;
    await enqueueSideEffect({ db, sourceAggregate: "material", sourceId: materialId,
      dedupeKey: `creator-publication:${materialId}:${follower}`,
      intent: { type: "creator_notification", payload: { ...payload, follower } },
    });
  }
  if (followers.length === BATCH_SIZE) {
    const cursor = String(followers.at(-1)._id);
    await enqueueSideEffect({ db, sourceAggregate: "material", sourceId: materialId,
      dedupeKey: `creator-publication:${materialId}:batch:${cursor}`,
      intent: { type: "creator_publication", payload: { ...payload, after: cursor } },
    });
  }
}

export async function deliverCreatorNotification(db, payload) {
  const { follower, creator, materialId, title } = payload;
  if (!await wantsPublications(db, follower)) return;
  await db.collection("notifications").updateOne(
    { _id: `creator-publication:${materialId}:${follower}` },
    { $setOnInsert: { userId: follower, recipient: follower, type: "creator_publication",
      title: "A creator you follow published a material", message: title,
      metadata: { materialId, creator }, read: false, createdAt: new Date() } },
    { upsert: true }
  );
}
