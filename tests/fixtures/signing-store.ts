import { Readable } from "node:stream";

function error(name: string, code: number) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: code } });
}
export class MockS3 {
  objects = new Map<string, Buffer>();
  calls: { name: string; input: Record<string, unknown> }[] = [];
  afterPut = false;
  async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
    const { input } = command,
      name = command.constructor.name;
    this.calls.push({ name, input });
    const key = `${input.Bucket}/${input.Key}`;
    if (name === "PutObjectCommand") {
      if (this.objects.has(key) && input.IfNoneMatch === "*")
        throw error("PreconditionFailed", 412);
      let bytes: Buffer;
      if (Buffer.isBuffer(input.Body)) bytes = Buffer.from(input.Body);
      else {
        const parts: Buffer[] = [];
        for await (const p of input.Body as AsyncIterable<Buffer>) parts.push(Buffer.from(p));
        bytes = Buffer.concat(parts);
      }
      this.objects.set(key, bytes);
      if (this.afterPut) {
        this.afterPut = false;
        throw new Error("response lost");
      }
      return {};
    }
    const value = this.objects.get(key);
    if (!value) throw error("NoSuchKey", 404);
    return { ContentLength: value.length, Body: Readable.from([value]) };
  }
}
