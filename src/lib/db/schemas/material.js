/**
 * MongoDB validator for marketplace materials.
 *
 * The shapes below reflect what the application actually writes. `category`
 * may be null when a creator supplies neither a category nor a subject, and
 * some legacy documents store timestamps as ISO strings.
 */
export const MaterialSchema = {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["title", "price", "createdAt"],
      properties: {
        title: {
          bsonType: "string",
          description: "Must be a non-empty string representing the material title",
        },
        description: {
          bsonType: "string",
          description: "Detailed information regarding educational content",
        },
        shortSummary: {
          bsonType: "string",
          description: "Optional short summary of the material",
        },
        category: {
          bsonType: ["string", "null"],
          description: "Broad grouping categorizing the listing framework",
        },
        subject: {
          bsonType: ["string", "null"],
          description: "Normalized subject identifier",
        },
        level: {
          bsonType: ["string", "null"],
          description: "Normalized level identifier",
        },
        price: {
          bsonType: "number",
          description: "Decimal asset valuation matching listing limits",
        },
        cid: {
          bsonType: ["string", "null"],
          description: "IPFS Content Identifier pointing to the raw file asset",
        },
        storageKey: {
          bsonType: "string",
          description: "Primary storage key/content hash for the uploaded asset",
        },
        visibility: {
          bsonType: "string",
          description: "Listing visibility",
        },
        quarantineState: {
          bsonType: "string",
          description: "Quarantine scan state for the associated content hash",
        },
        quarantineExpiresAt: {
          bsonType: ["date", "string"],
          description: "When the quarantine record expires",
        },
        deletedAt: { bsonType: ["date", "null"] },
        deletedBy: { bsonType: ["string", "null"] },
        createdAt: {
          bsonType: ["date", "string"],
          description: "Timestamp tracing entity entry operations",
        },
        revisions: {
          bsonType: "array",
          description: "Version history of the material file. The last entry mirrors the canonical top-level file.",
          items: {
            bsonType: "object",
            required: ["id", "cid", "createdAt"],
            properties: {
              id: { bsonType: "string" },
              index: { bsonType: "int" },
              cid: { bsonType: "string" },
              size: { bsonType: "number" },
              changelog: { bsonType: "string" },
              contentType: { bsonType: "string" },
              fileName: { bsonType: "string" },
              createdAt: { bsonType: "string" },
            },
          },
        },
      },
    },
  },
};
