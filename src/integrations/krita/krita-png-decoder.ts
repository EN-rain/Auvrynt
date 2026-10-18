import { inflateSync } from "node:zlib";
import type { RgbaImage } from "./krita-canvas-detector.js";

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_DIMENSION = 32_768;
const MAX_PIXELS = 100_000_000;

/** Decode the 8-bit non-interlaced PNGs produced by the local window capture. */
export function decodePngRgba(input: Uint8Array): RgbaImage {
  if (input.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((value, index) => input[index] === value)) {
    throw new Error("Krita canvas calibration requires a PNG window capture.");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawHeader = false;
  let sawEnd = false;
  const idat: Buffer[] = [];

  while (offset + 12 <= input.length) {
    const length = readUInt32(input, offset);
    offset += 4;
    const type = ascii(input, offset, 4);
    offset += 4;
    if (length > input.length - offset - 4) throw new Error("Krita canvas capture contains a truncated PNG chunk.");
    const payload = input.slice(offset, offset + length);
    offset += length;
    offset += 4; // CRC; the capture is local and the chunk boundaries are validated above.

    if (type === "IHDR") {
      if (sawHeader || length !== 13) throw new Error("Krita canvas capture contains an invalid PNG header.");
      width = readUInt32(payload, 0);
      height = readUInt32(payload, 4);
      bitDepth = payload[8] ?? 0;
      colorType = payload[9] ?? 0;
      interlace = payload[12] ?? 0;
      sawHeader = true;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(payload));
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }

  if (!sawHeader || !sawEnd || idat.length === 0) throw new Error("Krita canvas capture contains an incomplete PNG.");
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new Error("Krita canvas capture exceeds the supported image size.");
  }
  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error("Krita canvas calibration supports only 8-bit non-interlaced PNG captures.");
  }

  const channels = channelsForColorType(colorType);
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const expectedBytes = (rowBytes + 1) * height;
  if (inflated.length < expectedBytes) throw new Error("Krita canvas capture contains incomplete pixel data.");

  const rgba = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(rowBytes);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[inputOffset++];
    if (filter === undefined || filter > 4) throw new Error("Krita canvas capture uses an unsupported PNG filter.");
    const filtered = inflated.subarray(inputOffset, inputOffset + rowBytes);
    inputOffset += rowBytes;
    const current = unfilter(filtered, previous, channels, filter);
    for (let column = 0; column < width; column += 1) {
      const source = column * channels;
      const destination = ((row * width) + column) * 4;
      if (colorType === 0) {
        const gray = current[source]!;
        rgba[destination] = gray;
        rgba[destination + 1] = gray;
        rgba[destination + 2] = gray;
        rgba[destination + 3] = 255;
      } else if (colorType === 2) {
        rgba[destination] = current[source]!;
        rgba[destination + 1] = current[source + 1]!;
        rgba[destination + 2] = current[source + 2]!;
        rgba[destination + 3] = 255;
      } else if (colorType === 4) {
        const gray = current[source]!;
        rgba[destination] = gray;
        rgba[destination + 1] = gray;
        rgba[destination + 2] = gray;
        rgba[destination + 3] = current[source + 1]!;
      } else {
        rgba[destination] = current[source]!;
        rgba[destination + 1] = current[source + 1]!;
        rgba[destination + 2] = current[source + 2]!;
        rgba[destination + 3] = current[source + 3]!;
      }
    }
    previous.set(current);
  }
  return { width, height, data: rgba };
}

function channelsForColorType(colorType: number): 1 | 2 | 3 | 4 {
  switch (colorType) {
    case 0: return 1;
    case 2: return 3;
    case 4: return 2;
    case 6: return 4;
    default: throw new Error(`Krita canvas capture uses unsupported PNG color type ${colorType}.`);
  }
}

function unfilter(filtered: Uint8Array, previous: Uint8Array, bytesPerPixel: number, filter: number): Uint8Array {
  const current = new Uint8Array(filtered.length);
  for (let index = 0; index < filtered.length; index += 1) {
    const left = index >= bytesPerPixel ? current[index - bytesPerPixel]! : 0;
    const up = previous[index] ?? 0;
    const upperLeft = index >= bytesPerPixel ? (previous[index - bytesPerPixel] ?? 0) : 0;
    const value = filtered[index]!;
    switch (filter) {
      case 0:
        current[index] = value;
        break;
      case 1:
        current[index] = (value + left) & 0xff;
        break;
      case 2:
        current[index] = (value + up) & 0xff;
        break;
      case 3:
        current[index] = (value + Math.floor((left + up) / 2)) & 0xff;
        break;
      case 4:
        current[index] = (value + paeth(left, up, upperLeft)) & 0xff;
        break;
      default:
        throw new Error("Krita canvas capture uses an unsupported PNG filter.");
    }
  }
  return current;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function readUInt32(input: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > input.length) throw new Error("Krita canvas capture contains a truncated PNG integer.");
  return ((input[offset]! * 0x1000000)
    + (input[offset + 1]! << 16)
    + (input[offset + 2]! << 8)
    + input[offset + 3]!);
}

function ascii(input: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...input.slice(offset, offset + length));
}
