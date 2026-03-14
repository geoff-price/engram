import { neon } from "@neondatabase/serverless";
import type { Thought, ThoughtMetadata } from "./types";

function getSQL() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return neon(url);
}

export async function insertThought(
  content: string,
  embedding: number[],
  metadata: ThoughtMetadata,
  source: string,
): Promise<string> {
  const sql = getSQL();
  const embeddingStr = JSON.stringify(embedding);
  const metadataStr = JSON.stringify(metadata);
  const rows = await sql`
    INSERT INTO thoughts (content, embedding, metadata, source)
    VALUES (${content}, ${embeddingStr}::vector, ${metadataStr}::jsonb, ${source})
    RETURNING id
  `;
  return rows[0].id;
}

export async function searchThoughts(
  queryEmbedding: number[],
  options: {
    threshold?: number;
    limit?: number;
    filter?: Record<string, string>;
  } = {},
): Promise<Thought[]> {
  const sql = getSQL();
  const { threshold = 0.7, limit = 10, filter = {} } = options;
  const embeddingStr = JSON.stringify(queryEmbedding);
  const filterStr = JSON.stringify(filter);
  const rows = await sql`
    SELECT * FROM match_thoughts(
      ${embeddingStr}::vector, ${threshold}, ${limit}, ${filterStr}::jsonb
    )
  `;
  return rows as unknown as Thought[];
}

export async function listThoughts(
  options: {
    limit?: number;
    type?: string;
    topic?: string;
    since?: string;
  } = {},
): Promise<Thought[]> {
  const sql = getSQL();
  const { limit = 20, type, topic, since } = options;

  // Build dynamic query — each filter narrows results
  // Using tagged templates with conditional logic
  if (type && topic && since) {
    const rows = await sql`
      SELECT id, content, metadata, source, created_at FROM thoughts
      WHERE metadata->>'type' = ${type}
        AND metadata->'topics' ? ${topic}
        AND created_at >= ${since}::timestamptz
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows as unknown as Thought[];
  }
  if (type && topic) {
    const rows = await sql`
      SELECT id, content, metadata, source, created_at FROM thoughts
      WHERE metadata->>'type' = ${type}
        AND metadata->'topics' ? ${topic}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows as unknown as Thought[];
  }
  if (type && since) {
    const rows = await sql`
      SELECT id, content, metadata, source, created_at FROM thoughts
      WHERE metadata->>'type' = ${type}
        AND created_at >= ${since}::timestamptz
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows as unknown as Thought[];
  }
  if (topic && since) {
    const rows = await sql`
      SELECT id, content, metadata, source, created_at FROM thoughts
      WHERE metadata->'topics' ? ${topic}
        AND created_at >= ${since}::timestamptz
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows as unknown as Thought[];
  }
  if (type) {
    const rows = await sql`
      SELECT id, content, metadata, source, created_at FROM thoughts
      WHERE metadata->>'type' = ${type}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows as unknown as Thought[];
  }
  if (topic) {
    const rows = await sql`
      SELECT id, content, metadata, source, created_at FROM thoughts
      WHERE metadata->'topics' ? ${topic}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows as unknown as Thought[];
  }
  if (since) {
    const rows = await sql`
      SELECT id, content, metadata, source, created_at FROM thoughts
      WHERE created_at >= ${since}::timestamptz
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows as unknown as Thought[];
  }

  const rows = await sql`
    SELECT id, content, metadata, source, created_at FROM thoughts
    ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows as unknown as Thought[];
}
