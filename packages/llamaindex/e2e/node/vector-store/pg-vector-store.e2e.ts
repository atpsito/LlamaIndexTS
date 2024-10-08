/* eslint-disable turbo/no-undeclared-env-vars */
import { UUIDFromString } from "@llamaindex/core/utils";
import { config } from "dotenv";
import { Document, VectorStoreQueryMode } from "llamaindex";
import { PGVectorStore } from "llamaindex/vector-store/PGVectorStore";
import assert from "node:assert";
import { test } from "node:test";
import pg from "pg";
import { registerTypes } from "pgvector/pg";

config({ path: [".env.local", ".env", ".env.ci"] });

const pgConfig = {
  user: process.env.POSTGRES_USER ?? "user",
  password: process.env.POSTGRES_PASSWORD ?? "password",
  database: "llamaindex_node_test",
};

await test("init with client", async (t) => {
  const pgClient = new pg.Client(pgConfig);
  await pgClient.connect();
  await pgClient.query("CREATE EXTENSION IF NOT EXISTS vector");
  await registerTypes(pgClient);
  t.after(async () => {
    await pgClient.end();
  });
  const vectorStore = new PGVectorStore({
    client: pgClient,
    shouldConnect: false,
  });
  assert.notDeepStrictEqual(await vectorStore.client(), undefined);
});

await test("init with pool", async (t) => {
  const pgClient = new pg.Pool(pgConfig);
  await pgClient.query("CREATE EXTENSION IF NOT EXISTS vector");
  const client = await pgClient.connect();
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  await registerTypes(client);
  t.after(async () => {
    client.release();
    await pgClient.end();
  });
  const vectorStore = new PGVectorStore({
    shouldConnect: false,
    client,
  });
  assert.notDeepStrictEqual(await vectorStore.client(), undefined);
});

await test("init without client", async (t) => {
  const vectorStore = new PGVectorStore({ clientConfig: pgConfig });
  const db = await vectorStore.client();
  t.after(async () => {
    await db.close();
  });
  assert.notDeepStrictEqual(db, undefined);
});

await test("simple node", async (t) => {
  const dimensions = 3;
  const schemaName =
    "llamaindex_vector_store_test_" + Math.random().toString(36).substring(7);
  const nodeId = "document_id_1";
  const node = new Document({
    text: "hello world",
    id_: nodeId,
    embedding: [0.1, 0.2, 0.3],
  });
  const vectorStore = new PGVectorStore({
    clientConfig: pgConfig,
    dimensions,
    schemaName,
  });
  const db = await vectorStore.client();
  t.after(async () => {
    await db.close();
  });

  await vectorStore.add([node]);

  const insertedNodeId = UUIDFromString(nodeId);
  {
    const result = await vectorStore.query({
      mode: VectorStoreQueryMode.DEFAULT,
      similarityTopK: 1,
      queryEmbedding: [1, 2, 3],
    });
    const actualJSON = result.nodes![0]!.toJSON();

    assert.deepStrictEqual(actualJSON, {
      ...node.toJSON(),
      id_: insertedNodeId,
      hash: actualJSON.hash,
      metadata: actualJSON.metadata,
    });
    assert.deepStrictEqual(result.ids, [insertedNodeId]);
    assert.deepStrictEqual(result.similarities, [1]);
  }

  await vectorStore.delete(insertedNodeId);

  {
    const result = await vectorStore.query({
      mode: VectorStoreQueryMode.DEFAULT,
      similarityTopK: 1,
      queryEmbedding: [1, 2, 3],
    });
    assert.deepStrictEqual(result.nodes, []);
  }
});
