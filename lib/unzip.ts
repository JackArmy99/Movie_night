// Reads the text files out of a .zip in the browser, so a Letterboxd export
// can be picked straight from the phone's Downloads without unzipping it.
// Handles "stored" and "deflate" entries — all Letterboxd uses.
export async function unzipText(buf: ArrayBuffer, wanted: (name: string) => boolean): Promise<{ name: string; text: string }[]> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // The end-of-central-directory record sits in the last 64 KB.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out: { name: string; text: string }[] = [];
  const dec = new TextDecoder();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;

    const lNameLen = view.getUint16(local + 26, true);
    const lExtraLen = view.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = bytes.slice(start, start + compSize);
    let raw: Uint8Array;
    if (method === 0) raw = data;
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    } else continue;
    out.push({ name, text: dec.decode(raw) });
  }
  return out;
}
