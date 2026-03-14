import { randomBytes } from "crypto";

const key = randomBytes(32).toString("hex");
console.log("Generated access key:");
console.log(key);
console.log("\nAdd to .env.local:");
console.log(`ENGRAM_ACCESS_KEY=${key}`);
