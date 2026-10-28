import argon2 from "argon2";
import { stdin, stdout } from "node:process";

if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
  throw new Error("Run this utility directly in a local interactive terminal.");
}

stdout.write("Enter the new Super Admin password (input hidden): ");
stdin.setRawMode(true);
stdin.resume();

const chunks = [];
const onData = async (chunk) => {
  const key = chunk.toString("utf8");
  if (key === "\u0003") {
    stdout.write("\nCancelled.\n");
    stdin.setRawMode(false);
    process.exit(1);
  }
  if (key === "\r" || key === "\n") {
    stdin.off("data", onData);
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write("\n");
    const password = Buffer.concat(chunks).toString("utf8");
    chunks.fill(Buffer.alloc(0));
    if (password.length < 12 || password.length > 1024) {
      throw new Error("Password must be between 12 and 1024 characters.");
    }
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    stdout.write(`${hash}\n`);
    process.exit(0);
  }
  if (key === "\u007f" || key === "\b") {
    chunks.pop();
  } else if (!key.startsWith("\u001b")) {
    chunks.push(Buffer.from(key));
  }
};
stdin.on("data", onData);
