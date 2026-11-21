// Resolves: Configure efficient MongoDB connection pooling in the Next.js API routes to handle concurrent requests.
import { cpus } from "node:os";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

// Scale pool size to active CPU count so connection limits grow with the host.
// Allow env overrides for environments where auto-detection is insufficient.
const CPU_COUNT = cpus().length;
const maxPoolSize = parseInt(
  process.env.MONGODB_MAX_POOL_SIZE || String(CPU_COUNT * 5),
  10,
);
const minPoolSize = parseInt(
  process.env.MONGODB_MIN_POOL_SIZE || String(CPU_COUNT),
  10,
);
const serverSelectionTimeoutMS = parseInt(
  process.env.MONGODB_TIMEOUT_MS || "5000",
  10,
); // Fail fast
const socketTimeoutMS = parseInt(
  process.env.MONGODB_SOCKET_TIMEOUT_MS || "30000",
  10,
); // Timeout for socket operations
// How often the driver pings each server to confirm connectivity.
const heartbeatFrequencyMS = parseInt(
  process.env.MONGODB_HEARTBEAT_MS || "10000",
  10,
);

const globalForMongo = globalThis;

function getClientPromise() {
  // Reuse the client across hot reloads in dev, or when pre-configured in tests.
  if (globalForMongo._mongoClientPromise) {
    return globalForMongo._mongoClientPromise;
  }

  const connectionUri = uri || process.env.MONGODB_URI;
  if (!connectionUri) {
    const errorMsg = "MONGODB_URI is not set in environment variables";
    console.error(`[Database Error]: ${errorMsg}`);
    throw new Error(errorMsg);
  }

  try {
    const client = new MongoClient(connectionUri, {
        maxPoolSize,
        minPoolSize,
        serverSelectionTimeoutMS,
        socketTimeoutMS,
        heartbeatFrequencyMS,
        maxIdleTimeMS: 30000,
      });

      globalForMongo._mongoClientPromise = client.connect().catch((error) => {
        console.error(
          "[Database Connection Error]: Failed to connect to MongoDB cluster:",
          error,
        );
        // Reset global cache so subsequent requests can try connecting again
        globalForMongo._mongoClientPromise = null;
        throw error;
      });
    } catch (error) {
      console.error(
        "[Database Initialization Error]: Failed to initialize MongoClient:",
        error,
      );
      throw error;
    }

  return globalForMongo._mongoClientPromise;
}

let indexesCreated = false;

async function ensureIndexes(db) {
  try {
    await db.collection("follows").createIndex({ follower: 1, creator: 1 }, { unique: true, name: "follows_pair_idx" });
    await db.collection("follows").createIndex({ creator: 1, _id: 1 }, { name: "follows_creator_idx" });
    const materials = db.collection("materials");
    await materials.createIndex({ status: 1, deletedAt: 1, publishedAt: -1, _id: -1 }, { name: "materials_following_feed_idx" });
    const purchases = db.collection("purchases");
    const users = db.collection("users");
    const outbox = db.collection("side_effect_outbox");
    const auditLogs = db.collection("audit_logs");
    const idempotencyKeys = db.collection("idempotency_keys");
    const featureFlags = db.collection("feature_flags");

    await featureFlags.createIndex({ key: 1 }, { name: "feature_flags_key_idx", unique: true, background: true });

    await materials.createIndex({ deletedAt: 1 }, { name: "materials_deletedAt_idx", background: true });

    await materials.createIndex(
      { category: 1, price: 1 },
      { name: "materials_category_price_idx", background: true },
    );
    await materials.createIndex(
      { title: "text", description: "text" },
      { name: "materials_text_idx", background: true },
    );
    await materials.createIndex(
      { category: 1, price: 1, title: 1, description: 1 },
      { name: "materials_search_compound_idx", background: true },
    );

    await purchases.createIndex(
      { userId: 1, createdAt: -1 },
      { name: "purchases_userId_createdAt_idx", background: true },
    );
    await purchases.createIndex(
      { status: 1, updatedAt: -1 },
      { name: "purchases_status_updatedAt_idx", background: true },
    );

    await users.createIndex(
      { email: 1 },
      { name: "users_email_idx", unique: true, background: true },
    );
    await users.createIndex(
      { createdAt: -1 },
      { name: "users_createdAt_idx", background: true },
    );

    await outbox.createIndex(
      { status: 1, nextAttemptAt: 1, createdAt: 1 },
      { name: "outbox_poll_idx", background: true },
    );
    await outbox.createIndex(
      { deliveryId: 1 },
      { name: "outbox_delivery_id_idx", unique: true, background: true },
    );
    await outbox.createIndex(
      { sourceAggregate: 1, sourceId: 1 },
      { name: "outbox_source_idx", background: true },
    );
    await outbox.createIndex(
      { status: 1, leaseExpiresAt: 1 },
      { name: "outbox_lease_idx", background: true, sparse: true },
    );

    await auditLogs.createIndex(
      { actor: 1 },
      { name: "audit_actor_idx", background: true },
    );
    await auditLogs.createIndex(
      { action: 1 },
      { name: "audit_action_idx", background: true },
    );
    await auditLogs.createIndex(
      { createdAt: -1 },
      { name: "audit_createdAt_idx", background: true },
    );

    await idempotencyKeys.createIndex(
      { key: 1 },
      { name: "idempotency_key_unique_idx", unique: true, background: true },
    );
    await idempotencyKeys.createIndex(
      { createdAt: 1 },
      { name: "idempotency_createdAt_ttl_idx", expireAfterSeconds: 86400, background: true },
    );

    console.log("MongoDB indexes ensured successfully.");
  } catch (error) {
    console.error(
      "[Database Index Error]: Failed to create MongoDB indexes:",
      error,
    );
  }
}

export async function getDb() {
  try {
    const client = await getClientPromise();
    // When DB name is in connection string, driver selects it automatically.
    // Otherwise, fallback to "scholarmarket".
    const dbName = process.env.MONGODB_DB || "scholarmarket";
    const db = client.db(dbName);

    return db;
  } catch (error) {
    console.error(
      "[Database Retrieval Error]: Could not acquire database instance:",
      error,
    );
    throw error;
  }
}
