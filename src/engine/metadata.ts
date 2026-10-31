// Reads camera data from JPEG EXIF and carries it into exports. The exported pixels
// are already upright and edited, so the copy needs patching: Orientation becomes 1,
// the dimensions change, and the embedded thumbnail (which shows the unedited photo)
// is erased. GPS can be erased on request; erased bytes are zeroed, not just unlinked.

export interface ExifSummary {
  camera?: string;
  lens?: string;
  iso?: number;
  shutter?: string;
  aperture?: string;
  focal?: string;
  date?: string;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0];

const TAG = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  exposure: 0x829a,
  fNumber: 0x829d,
  iso: 0x8827,
  date: 0x9003,
  focal: 0x920a,
  pixelX: 0xa002,
  pixelY: 0xa003,
  lens: 0xa434,
  thumbOffset: 0x0201,
  thumbLength: 0x0202,
};

/** Returns the EXIF APP1 payload (starting "Exif\0\0"), or null. */
export function findExif(jpeg: Uint8Array): Uint8Array | null {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (jpeg[i + 2] << 8) | jpeg[i + 3];
    if (marker === 0xe1 && EXIF_HEADER.every((b, k) => jpeg[i + 4 + k] === b)) {
      return jpeg.slice(i + 4, i + 2 + length);
    }
    i += 2 + length;
  }
  return null;
}

class Tiff {
  readonly view: DataView;
  readonly little: boolean;
  constructor(readonly bytes: Uint8Array) {
    // Offsets inside EXIF count from the TIFF header, just after "Exif\0\0".
    this.view = new DataView(bytes.buffer, bytes.byteOffset + 6, bytes.byteLength - 6);
    const order = this.view.getUint16(0, false);
    if (order !== 0x4949 && order !== 0x4d4d) throw new Error('Bad TIFF header.');
    this.little = order === 0x4949;
  }
  u16(at: number) {
    return this.view.getUint16(at, this.little);
  }
  u32(at: number) {
    return this.view.getUint32(at, this.little);
  }
  get firstIfd() {
    return this.u32(4);
  }
  /** Offset of each entry in an IFD. */
  entries(ifd: number): number[] {
    const count = this.u16(ifd);
    return Array.from({ length: count }, (_, i) => ifd + 2 + i * 12);
  }
  find(ifd: number, tag: number): number | null {
    for (const e of this.entries(ifd)) if (this.u16(e) === tag) return e;
    return null;
  }
  byteLength(entry: number): number {
    return (TYPE_SIZE[this.u16(entry + 2)] ?? 1) * this.u32(entry + 4);
  }
  /** Where an entry's value is stored: inline if it fits in 4 bytes. */
  valueAt(entry: number): number {
    return this.byteLength(entry) > 4 ? this.u32(entry + 8) : entry + 8;
  }
  text(entry: number): string {
    const at = this.valueAt(entry);
    const n = this.byteLength(entry);
    let out = '';
    for (let i = 0; i < n; i++) {
      const c = this.view.getUint8(at + i);
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    return out.trim();
  }
  number(entry: number): number {
    const at = this.valueAt(entry);
    switch (this.u16(entry + 2)) {
      case 3:
        return this.u16(at);
      case 4:
        return this.u32(at);
      case 5:
        return this.u32(at) / (this.u32(at + 4) || 1);
      default:
        return 0;
    }
  }
  zero(at: number, length: number) {
    for (let i = 0; i < length; i++) this.view.setUint8(at + i, 0);
  }
}

export function parseExif(payload: Uint8Array | null): ExifSummary {
  if (!payload) return {};
  try {
    const t = new Tiff(payload);
    const out: ExifSummary = {};
    const ifd0 = t.firstIfd;
    const make = t.find(ifd0, TAG.make);
    const model = t.find(ifd0, TAG.model);
    const makeText = make !== null ? t.text(make) : '';
    const modelText = model !== null ? t.text(model) : '';
    const camera = modelText.toLowerCase().startsWith(makeText.toLowerCase())
      ? modelText
      : `${makeText} ${modelText}`.trim();
    if (camera) out.camera = camera;

    const pointer = t.find(ifd0, TAG.exifIfd);
    if (pointer !== null) {
      const ifd = t.u32(pointer + 8);
      const read = (tag: number, fn: (entry: number) => void) => {
        const e = t.find(ifd, tag);
        if (e !== null) fn(e);
      };
      read(TAG.iso, (e) => (out.iso = t.number(e)));
      read(TAG.exposure, (e) => {
        const v = t.number(e);
        if (v > 0) out.shutter = v >= 1 ? `${v.toFixed(1)} s` : `1/${Math.round(1 / v)} s`;
      });
      read(TAG.fNumber, (e) => (out.aperture = `f/${t.number(e).toFixed(1)}`));
      read(TAG.focal, (e) => (out.focal = `${Math.round(t.number(e))} mm`));
      read(TAG.lens, (e) => (out.lens = t.text(e)));
      read(TAG.date, (e) => (out.date = t.text(e)));
    }
    return out;
  } catch {
    return {};
  }
}

/** The tag that says how to rotate the stored pixels; 1 if absent or unreadable. */
export function readOrientation(payload: Uint8Array | null): number {
  if (!payload) return 1;
  try {
    const t = new Tiff(payload);
    const e = t.find(t.firstIfd, TAG.orientation);
    return e === null ? 1 : t.u16(e + 8);
  } catch {
    return 1;
  }
}

export interface ExifPatch {
  width: number;
  height: number;
  keepLocation: boolean;
}

/** A copy of the payload that is true of the exported file. Null if it cannot be parsed. */
export function patchExif(payload: Uint8Array, patch: ExifPatch): Uint8Array | null {
  try {
    const copy = payload.slice();
    const t = new Tiff(copy);
    const ifd0 = t.firstIfd;

    const orientation = t.find(ifd0, TAG.orientation);
    if (orientation !== null) t.view.setUint16(orientation + 8, 1, t.little);

    const pointer = t.find(ifd0, TAG.exifIfd);
    if (pointer !== null) {
      const ifd = t.u32(pointer + 8);
      const setDimension = (tag: number, value: number) => {
        const e = t.find(ifd, tag);
        if (e === null) return;
        if (t.u16(e + 2) === 3) t.view.setUint16(e + 8, Math.min(value, 65535), t.little);
        else if (t.u16(e + 2) === 4) t.view.setUint32(e + 8, value, t.little);
      };
      setDimension(TAG.pixelX, patch.width);
      setDimension(TAG.pixelY, patch.height);
    }

    // Embedded thumbnail: erase its entries and image data, then unlink the IFD.
    const nextAt = ifd0 + 2 + t.u16(ifd0) * 12;
    const ifd1 = t.u32(nextAt);
    if (ifd1) {
      const offset = t.find(ifd1, TAG.thumbOffset);
      const length = t.find(ifd1, TAG.thumbLength);
      if (offset !== null && length !== null) t.zero(t.number(offset), t.number(length));
      for (const e of t.entries(ifd1)) if (t.byteLength(e) > 4) t.zero(t.valueAt(e), t.byteLength(e));
      t.zero(ifd1, 2 + t.u16(ifd1) * 12 + 4);
      t.view.setUint32(nextAt, 0, t.little);
    }

    if (!patch.keepLocation) {
      const gps = t.find(ifd0, TAG.gpsIfd);
      if (gps !== null) {
        const ifd = t.u32(gps + 8);
        for (const e of t.entries(ifd)) if (t.byteLength(e) > 4) t.zero(t.valueAt(e), t.byteLength(e));
        t.zero(ifd, 2 + t.u16(ifd) * 12 + 4);
      }
    }
    return copy;
  } catch {
    return null;
  }
}

/** Inserts an EXIF payload as an APP1 segment straight after the JPEG's SOI. */
export function insertExif(jpeg: Uint8Array, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  if (length > 0xffff) return jpeg;
  const out = new Uint8Array(jpeg.length + 2 + length);
  out.set(jpeg.subarray(0, 2), 0);
  out[2] = 0xff;
  out[3] = 0xe1;
  out[4] = length >> 8;
  out[5] = length & 0xff;
  out.set(payload, 6);
  out.set(jpeg.subarray(2), 6 + payload.length);
  return out;
}
