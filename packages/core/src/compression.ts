const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const GZ_PREFIX = "gz:";
const RAW_PREFIX = "raw:";

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof globalThis.btoa === "function") {
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return globalThis.btoa(binary);
  }
  // Node.js fallback
  const B = (globalThis as Record<string, unknown>).Buffer as
    | { from(data: Uint8Array): { toString(enc: string): string } }
    | undefined;
  if (B) return B.from(bytes).toString("base64");
  throw new Error("No base64 encoder available (neither btoa nor Buffer)");
}

function fromBase64(base64: string): ArrayBuffer {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  // Node.js fallback
  const B = (globalThis as Record<string, unknown>).Buffer as
    | {
        from(
          data: string,
          enc: string,
        ): { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
      }
    | undefined;
  if (B) {
    const buf = B.from(base64, "base64");
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  throw new Error("No base64 decoder available (neither atob nor Buffer)");
}

export async function compressSnapshotString(input: string): Promise<string> {
  if (typeof CompressionStream === "undefined") {
    return RAW_PREFIX + toBase64(textEncoder.encode(input));
  }
  const stream = new Response(input).body;
  if (!stream) throw new Error("Could not create stream from input");
  const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
  const response = new Response(compressedStream);
  const arrayBuffer = await response.arrayBuffer();
  return GZ_PREFIX + toBase64(arrayBuffer);
}

export async function decompressSnapshotString(b64: string): Promise<string> {
  // Self-describing format: check prefix to determine encoding
  if (b64.startsWith(RAW_PREFIX)) {
    return textDecoder.decode(fromBase64(b64.slice(RAW_PREFIX.length)));
  }

  const payload = b64.startsWith(GZ_PREFIX) ? b64.slice(GZ_PREFIX.length) : b64;
  const compressedBuffer = fromBase64(payload);

  if (typeof DecompressionStream === "undefined") {
    // Fallback: try to decode as UTF-8 (legacy uncompressed data without prefix)
    return textDecoder.decode(compressedBuffer);
  }
  const stream = new Response(compressedBuffer).body;
  if (!stream) throw new Error("Could not create stream from compacted buffer");
  const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"));
  const response = new Response(decompressedStream);
  return await response.text();
}
