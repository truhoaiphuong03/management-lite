import sharp from 'sharp';

// Dedicated process: no inherited credentials, files, network or logging.
sharp.cache(false);
sharp.concurrency(1);
const MAX = 4 * 1024 * 1024;
try {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of process.stdin) {
    const b = Buffer.from(part);
    size += b.length;
    if (size > MAX) throw new Error();
    chunks.push(b);
  }
  const bytes = Buffer.concat(chunks);
  const mime = process.argv[2];
  const expected =
    mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpeg' : null;
  if (!expected || !size) throw new Error();
  if (expected === 'png') {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) throw new Error();
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL')
        throw new Error();
      offset += length + 12;
    }
  }
  const options = {
    failOn: 'warning' as const,
    limitInputPixels: 16_000_000,
    limitInputChannels: 4,
  };
  const metadata = await sharp(bytes, options).metadata();
  if (
    metadata.format !== expected ||
    (metadata.pages ?? 1) !== 1 ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > 8192 ||
    metadata.height > 8192 ||
    metadata.width * metadata.height > 16_000_000
  )
    throw new Error();
  // Force complete pixel decoding. A second image from raw pixels cannot retain EXIF,
  // XMP, ICC, comments or other source metadata. Orientation is applied first.
  const { data, info } = await sharp(bytes, options)
    .autoOrient()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    data.length > 64_000_000 ||
    info.width > 8192 ||
    info.height > 8192 ||
    info.width * info.height > 16_000_000 ||
    info.channels > 4
  )
    throw new Error();
  const normalized = sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  });
  const output = await (
    expected === 'png' ? normalized.png() : normalized.jpeg({ quality: 90 })
  ).toBuffer();
  if (output.length > MAX) throw new Error();
  process.stdout.end(output);
} catch {
  // Exit status only: never emit decoder diagnostics or image data on stderr.
  process.exitCode = 2;
}
