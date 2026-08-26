import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

export async function hashLocalPassword(password: string): Promise<string> {
  const normalized = normalizePassword(password);
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(normalized, salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyLocalPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64url");
    expected = Buffer.from(parts[5]!, "base64url");
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) {
    return false;
  }
  let normalized: string;
  try {
    normalized = normalizePassword(password);
  } catch {
    return false;
  }
  const actual = await deriveKey(normalized, salt, { N, r, p });
  return timingSafeEqual(actual, expected);
}

function normalizePassword(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 12 ||
    value.length > 200 ||
    Buffer.byteLength(value, "utf8") > 512
  ) {
    throw new Error("INVALID_LOCAL_PASSWORD");
  }
  return value;
}

function deriveKey(
  password: string,
  salt: Buffer,
  parameters: { readonly N: number; readonly r: number; readonly p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { ...parameters, maxmem: SCRYPT_MAX_MEMORY },
      (error, derivedKey) => {
        if (error) {
          reject(error);
        } else {
          resolve(derivedKey);
        }
      },
    );
  });
}
