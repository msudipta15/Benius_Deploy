const argon2 = require("argon2");
const { Pool } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not loaded");
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const result = await pool.query(
      "SELECT password_hash FROM super_admin_accounts WHERE email = $1 LIMIT 1",
      ["techtv70@gmail.com"]
    );

    const hash = result.rows[0]?.password_hash;

    console.log("Hash found:", typeof hash === "string");
    console.log("Hash length:", hash?.length);
    console.log("Argon2id format:", typeof hash === "string" && /^\$argon2id\$/.test(hash));

    if (typeof hash !== "string") return;

    try {
      const matches = await argon2.verify(hash, "intentionally-wrong-test-password");
      console.log("Dummy password matches:", matches);
    } catch (error) {
      console.log("Argon2 verification error:", error.message);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Test failed:", error.message);
  process.exitCode = 1;
});
