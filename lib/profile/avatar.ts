export const AVATAR_BUCKET = "profile-avatars";
export const AVATAR_SIZE = 512;
export const AVATAR_SOURCE_BYTES = 10 * 1024 * 1024;
export const AVATAR_UPLOAD_BYTES = 768 * 1024;
export const AVATAR_IMAGE = /^\/api\/avatars\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const isImageAvatar = (value: string | null | undefined) => Boolean(value && AVATAR_IMAGE.test(value));
/** Plain text contexts (select options, activity notices) never print image URLs. */
export const avatarText = (value: string | null | undefined) => value && !isImageAvatar(value) && value.length <= 16 ? value : "";

export type Crop = { zoom: number; x: number; y: number; rotation: number; fit: boolean };
export const INITIAL_CROP: Crop = { zoom: 1, x: 0, y: 0, rotation: 0, fit: false };
/** Same geometry for the preview and exported image; normalized offsets survive resizing. */
export function avatarGeometry(width: number, height: number, crop: Crop, size: number) {
  const rotated = crop.rotation % 180 !== 0;
  const w = rotated ? height : width; const h = rotated ? width : height;
  // Inscribe the entire image in the circle for logos, including its corners.
  const scale = (crop.fit ? size / Math.hypot(w, h) : size / Math.min(w, h)) * crop.zoom;
  const maxX = Math.max(0, (w * scale - size) / 2); const maxY = Math.max(0, (h * scale - size) / 2);
  const x = Math.max(-1, Math.min(1, crop.x)) * maxX; const y = Math.max(-1, Math.min(1, crop.y)) * maxY;
  return { scale, x, y, maxX, maxY };
}
