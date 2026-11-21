import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { queryKeys } from "../../src/lib/query/queryKeys.js";
import { buildPurchaseHistoryRecords } from "../../src/lib/transactions/historyFeed.js";

describe("Transactions History Query Keys & Records", () => {
  test("queryKeys.transactions exports canonical structure", () => {
    assert.deepEqual(queryKeys.transactions.all, ["transactions"]);
    assert.deepEqual(queryKeys.transactions.history(), ["transactions", "history"]);
    assert.deepEqual(
      queryKeys.transactions.history({ type: "purchase" }),
      ["transactions", "history", { type: "purchase" }]
    );
    assert.deepEqual(
      queryKeys.transactions.history({ type: "onchain", cursor: "c1" }),
      ["transactions", "history", { type: "onchain", cursor: "c1" }]
    );
  });

  test("buildPurchaseHistoryRecords maps purchases to transaction records", () => {
    const rawPurchases = [
      {
        _id: "650000000000000000000001",
        transactionHash: "0x1234567890abcdef1234567890abcdef12345678",
        materialId: "mat_101",
        status: "confirmed",
        amount: 25,
        asset: "USDC",
        purchasedAt: new Date("2026-11-20T10:00:00Z"),
      },
      {
        _id: "650000000000000000000002",
        chainTxHash: "stellar_hash_xyz",
        materialId: "mat_102",
        status: "settled",
        amount: 50,
        asset: "XLM",
        createdAt: new Date("2026-11-21T12:00:00Z"),
      },
    ];

    const records = buildPurchaseHistoryRecords(rawPurchases);
    assert.equal(records.length, 2);

    assert.equal(records[0].id, "650000000000000000000001");
    assert.equal(records[0].hash, "0x1234567890abcdef1234567890abcdef12345678");
    assert.equal(records[0].materialId, "mat_101");
    assert.equal(records[0].status, "confirmed");
    assert.equal(records[0].amount, 25);
    assert.equal(records[0].asset, "USDC");
    assert.equal(records[0].type, "purchase_record");

    assert.equal(records[1].id, "650000000000000000000002");
    assert.equal(records[1].hash, "stellar_hash_xyz");
    assert.equal(records[1].materialId, "mat_102");
    assert.equal(records[1].status, "settled");
    assert.equal(records[1].amount, 50);
    assert.equal(records[1].asset, "XLM");
    assert.equal(records[1].type, "purchase_record");
  });

  test("explorer URL construction adheres to testnet and public network settings", () => {
    const explorerBaseTestnet = "https://stellar.expert/explorer/testnet";
    const explorerBasePublic = "https://stellar.expert/explorer/public";
    const sampleHash = "b2c3d4e5f67890";

    const testnetUrl = `${explorerBaseTestnet}/tx/${sampleHash}`;
    const publicUrl = `${explorerBasePublic}/tx/${sampleHash}`;

    assert.equal(testnetUrl, "https://stellar.expert/explorer/testnet/tx/b2c3d4e5f67890");
    assert.equal(publicUrl, "https://stellar.expert/explorer/public/tx/b2c3d4e5f67890");
  });
});
