// Bound packed-object expansion before the native indexer sees untrusted object data.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { fileURLToPath, URL } from "node:url";

function requirePack(condition, code = "policy_refused") {
  if (!condition) throw Object.assign(new Error(code), { code });
}
function variable(bytes, position, maximum) {
  let value = 0,
    shift = 0,
    byte;
  do {
    requirePack(position.value < bytes.length && shift <= 49);
    byte = bytes[position.value++];
    value += (byte & 127) * 2 ** shift;
    requirePack(Number.isSafeInteger(value) && value <= maximum, "size_refused");
    shift += 7;
  } while (byte & 128);
  return value;
}
function deltaSize(bytes, maximum) {
  const position = { value: 0 };
  const base = variable(bytes, position, maximum);
  const result = variable(bytes, position, maximum);
  let written = 0;
  while (position.value < bytes.length) {
    const instruction = bytes[position.value++];
    if (instruction & 128) {
      let offset = 0,
        length = 0;
      for (let bit = 0; bit < 7; bit++) {
        if (!(instruction & (1 << bit))) continue;
        requirePack(position.value < bytes.length);
        const byte = bytes[position.value++];
        if (bit < 4) offset += byte * 2 ** (8 * bit);
        else length += byte * 2 ** (8 * (bit - 4));
      }
      if (!length) length = 65536;
      requirePack(offset + length <= base);
      written += length;
    } else {
      requirePack(instruction > 0 && position.value + instruction <= bytes.length);
      position.value += instruction;
      written += instruction;
    }
    requirePack(written <= result);
  }
  requirePack(written === result);
  return result;
}

export function validateSourcePack(bytes, { maximumBytes, maximumObjects }) {
  requirePack(Buffer.isBuffer(bytes) && bytes.length >= 32);
  requirePack(bytes.length <= maximumBytes, "size_refused");
  requirePack(bytes.subarray(0, 4).toString("ascii") === "PACK");
  requirePack([2, 3].includes(bytes.readUInt32BE(4)));
  const count = bytes.readUInt32BE(8),
    end = bytes.length - 20;
  requirePack(count > 0 && count <= maximumObjects, "size_refused");
  const checksum = createHash("sha1").update(bytes.subarray(0, end)).digest();
  requirePack(checksum.equals(bytes.subarray(end)));
  const offsets = new Set();
  let cursor = 12,
    inflated = 0,
    reconstructed = 0;
  for (let object = 0; object < count; object++) {
    const start = cursor;
    requirePack(cursor < end);
    let byte = bytes[cursor++],
      size = byte & 15,
      shift = 4;
    const type = (byte >> 4) & 7;
    requirePack([1, 2, 3, 4, 6, 7].includes(type));
    while (byte & 128) {
      requirePack(cursor < end && shift <= 49);
      byte = bytes[cursor++];
      size += (byte & 127) * 2 ** shift;
      requirePack(Number.isSafeInteger(size) && size <= maximumBytes, "size_refused");
      shift += 7;
    }
    // Count delta instructions too, independently of their reconstructed object sizes.
    requirePack(inflated + size <= maximumBytes, "size_refused");
    if (type === 6) {
      requirePack(cursor < end);
      byte = bytes[cursor++];
      let distance = byte & 127;
      while (byte & 128) {
        requirePack(cursor < end && Number.isSafeInteger(distance));
        byte = bytes[cursor++];
        distance = (distance + 1) * 128 + (byte & 127);
      }
      requirePack(distance > 0 && offsets.has(start - distance));
    } else if (type === 7) {
      requirePack(cursor + 20 < end);
      cursor += 20;
    }
    let decoded;
    try {
      decoded = inflateSync(bytes.subarray(cursor, end), {
        info: true,
        maxOutputLength: Math.max(1, size + 1),
      });
    } catch (error) {
      requirePack(false, error.code === "ERR_BUFFER_TOO_LARGE" ? "size_refused" : "policy_refused");
    }
    requirePack(decoded.buffer.length === size);
    const consumed = decoded.engine.bytesWritten;
    requirePack(Number.isSafeInteger(consumed) && consumed > 0 && cursor + consumed <= end);
    cursor += consumed;
    inflated += size;
    reconstructed += type === 6 || type === 7 ? deltaSize(decoded.buffer, maximumBytes) : size;
    requirePack(reconstructed <= maximumBytes, "size_refused");
    offsets.add(start);
  }
  requirePack(cursor === end);
  return {
    objects: count,
    inflated_bytes: inflated,
    reconstructed_bytes: reconstructed,
    pack_sha1: checksum.toString("hex"),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    requirePack(process.argv.length === 3 && path.isAbsolute(process.argv[2]));
    const budgets = JSON.parse(
      fs.readFileSync(new URL("../config/desktop/resource-policy.json", import.meta.url)),
    ).budgets;
    const file = process.argv[2],
      stat = fs.lstatSync(file);
    requirePack(
      stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && !(stat.mode & 0o077),
    );
    requirePack(stat.size <= budgets.signing_source_acquisition_bytes.value, "size_refused");
    result = {
      ok: true,
      code: null,
      ...validateSourcePack(fs.readFileSync(file), {
        maximumBytes: budgets.signing_source_acquisition_bytes.value,
        maximumObjects: budgets.signing_source_acquisition_objects.value,
      }),
    };
  } catch (error) {
    result = {
      ok: false,
      code: ["size_refused", "policy_refused"].includes(error.code)
        ? error.code
        : "authority_unavailable",
    };
  }
  process.stdout.write(JSON.stringify(result) + "\n");
}
