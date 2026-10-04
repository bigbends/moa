import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
export class BrowserStorage {
  constructor(directory, proxy = "") {
    this.directory = directory;
    this.file = join(
      directory,
      "browser-" + createHash("sha256").update(proxy).digest("hex") + ".enc",
    );
  }
  async key() {
    const path = join(this.directory, "browser.key");
    try {
      await writeFile(path, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const key = await readFile(path);
    if (key.length !== 32) throw Error("source_session_invalid");
    return key;
  }
  async read() {
    let bytes;
    try {
      bytes = await readFile(this.file);
    } catch (e) {
      if (e.code === "ENOENT") return { cookies: [], origins: [] };
      throw e;
    }
    if (bytes.length < 29 || bytes.length > 1024 * 1024 || bytes[0] !== 1)
      throw Error("source_session_invalid");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await this.key(),
      bytes.subarray(1, 13),
    );
    decipher.setAuthTag(bytes.subarray(-16));
    const data = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(13, -16)),
        decipher.final(),
      ]).toString(),
    );
    if (!Array.isArray(data.cookies) || !Array.isArray(data.origins))
      throw Error("source_session_invalid");
    return data;
  }
  async save(data) {
    const body = Buffer.from(JSON.stringify(data));
    if (body.length > 1024 * 1024 - 29) throw Error("source_body_limit");
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", await this.key(), iv);
    const bytes = Buffer.concat([
      Buffer.from([1]),
      iv,
      cipher.update(body),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const temp = this.file + "." + randomBytes(8).toString("hex") + ".tmp";
    try {
      await writeFile(temp, bytes, { mode: 0o600 });
      await rename(temp, this.file);
    } finally {
      await rm(temp, { force: true });
    }
  }
}
