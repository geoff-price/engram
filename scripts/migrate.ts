import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  const sqlDir = join(process.cwd(), "sql");
  const files = readdirSync(sqlDir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    console.log(`Running ${file}...`);
    const content = readFileSync(join(sqlDir, file), "utf-8");
    // neon() is a tagged template function — wrap raw SQL string
    await sql(content as unknown as TemplateStringsArray);
    console.log(`  ✓ ${file}`);
  }

  console.log("Migration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
