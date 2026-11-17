import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { avatarGeometry, avatarText, INITIAL_CROP, isImageAvatar } from "@/lib/profile/avatar";
import { decodeAvatar } from "@/lib/profile/avatar-server";

describe("custom avatar geometry and safe image encoding", () => {
  it("covers the circle, clamps movement, and swaps axes when rotated", () => {
    expect(avatarGeometry(1000, 500, INITIAL_CROP, 500)).toMatchObject({ scale: 1, maxX: 250, maxY: 0 });
    expect(avatarGeometry(1000, 500, { ...INITIAL_CROP, x: 8 }, 500).x).toBe(250);
    expect(avatarGeometry(1000, 500, { ...INITIAL_CROP, rotation: 90 }, 500)).toMatchObject({ scale: 1, maxX: 0, maxY: 250 });
    const fit = avatarGeometry(1000, 500, { ...INITIAL_CROP, fit: true }, 500);
    expect(Math.hypot(1000 * fit.scale, 500 * fit.scale)).toBeCloseTo(500); expect(fit.maxX).toBe(0);
  });
  it("accepts only internal avatar images and keeps URLs out of plain text", () => {
    const url = `/api/avatars/${crypto.randomUUID()}`;
    expect(isImageAvatar(url)).toBe(true); expect(isImageAvatar("https://attacker.example/avatar.webp")).toBe(false);
    expect(avatarText(url)).toBe(""); expect(avatarText("🦊")).toBe("🦊"); expect(avatarText("https://evil.example")).toBe("");
  });
  it("re-encodes images to 512px WebP without embedded metadata", async () => {
    const original = await sharp({ create: { width: 800, height: 500, channels: 4, background: "red" } }).jpeg().withMetadata({ exif: { IFD0: { Artist: "Private owner" } } }).toBuffer();
    const result = await decodeAvatar(new File([original], "photo.jpg", { type: "image/jpeg" }));
    expect(await sharp(result).metadata()).toMatchObject({ width: 512, height: 512, format: "webp" });
    expect((await sharp(result).metadata()).exif).toBeUndefined(); expect(result.length).toBeLessThan(100_000);
  });
  it("rejects active formats, corrupt files and oversized or animated uploads", async () => {
    await expect(decodeAvatar(new File(["<svg onload='alert(1)'/>"], "image.webp", { type: "image/webp" }))).rejects.toThrow("JPG, PNG or WebP");
    await expect(decodeAvatar(new File([new Uint8Array(800_000)], "large.png"))).rejects.toThrow("smaller image");
    const animation = await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).webp({ delay: [100, 100] }).toBuffer();
    await expect(decodeAvatar(new File([animation], "animation.webp", { type: "image/webp" }))).rejects.toThrow("still image");
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).gif().toBuffer();
    await expect(decodeAvatar(new File([gif], "fake.jpg", { type: "image/jpeg" }))).rejects.toThrow("JPG, PNG or WebP");
  });
});
