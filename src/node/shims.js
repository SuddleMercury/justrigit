// Gives Node the browser APIs three.js needs to read and write textured GLB/FBX files:
// image decoding (createImageBitmap), canvas encoding (OffscreenCanvas), FileReader.
// If the native image library can't load, everything still works except textures.
let createCanvas, loadImage, Image;
try {
  ({ createCanvas, loadImage, Image } = await import('@napi-rs/canvas'));
} catch (e) {
  process.stderr.write(`JustRigIt: image library unavailable (${e.message.split('\n')[0]}) — textures will be skipped.\n`);
  Image = class Image {};
  loadImage = async () => { throw new Error('Textures are not available (image library missing).'); };
  createCanvas = () => { throw new Error('Textures are not available (image library missing).'); };
}

globalThis.self ??= globalThis;
if (typeof globalThis.ImageBitmap === 'undefined') globalThis.ImageBitmap = Image;
if (!Image.prototype.close) Image.prototype.close = function close() {};
globalThis.createImageBitmap ??= async (src) => {
  const buf = src instanceof Blob ? Buffer.from(await src.arrayBuffer()) : Buffer.from(src);
  return loadImage(buf);
};
globalThis.OffscreenCanvas ??= class OffscreenCanvas {
  constructor(w, h) { this._c = createCanvas(Math.max(1, w), Math.max(1, h)); }
  get width() { return this._c.width; } set width(v) { this._c.width = Math.max(1, v); }
  get height() { return this._c.height; } set height(v) { this._c.height = Math.max(1, v); }
  getContext(t, o) { return this._c.getContext(t, o); }
  async convertToBlob({ type = 'image/png', quality } = {}) {
    const fmt = /jpe?g/.test(type) ? 'jpeg' : /webp/.test(type) ? 'webp' : 'png';
    const buf = await this._c.encode(fmt, quality !== undefined ? Math.round(quality * 100) : undefined);
    return new Blob([buf], { type: `image/${fmt}` });
  }
};
globalThis.FileReader ??= class FileReader {
  readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }); }
  readAsDataURL(b) { b.arrayBuffer().then((r) => { this.result = `data:${b.type || 'application/octet-stream'};base64,` + Buffer.from(r).toString('base64'); this.onload?.({ target: this }); this.onloadend?.({ target: this }); }); }
};
