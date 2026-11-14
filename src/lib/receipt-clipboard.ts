interface PasteItem {
  kind: string;
  type: string;
  getAsFile(): File | null;
}
interface PasteData {
  items: ArrayLike<PasteItem>;
  files: ArrayLike<File>;
}
/** Read only image files from a user paste event. Text/HTML/URLs are left alone. */
export function pastedImages(data: PasteData | null): File[] {
  if (!data) return [];
  const images = Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  // Some hosts populate files without image items; don't add both representations twice.
  return images.length
    ? images
    : Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}
export interface ReadableClipboardItem {
  types: readonly string[];
  getType(type: string): Promise<Blob>;
}
/** Pick one supported image representation per item, never HTML or remote image URLs. */
export async function readClipboardImages(
  items: readonly ReadableClipboardItem[],
): Promise<Blob[]> {
  const images: Blob[] = [];
  for (const item of items) {
    const type = ['image/png', 'image/jpeg'].find((type) => item.types.includes(type));
    if (type) images.push(await item.getType(type));
    else if (item.types.some((type) => type.startsWith('image/')))
      throw new Error(
        'Clipboard image format is unsupported. Copy a PNG/JPEG or use a screenshot.',
      );
  }
  return images;
}
