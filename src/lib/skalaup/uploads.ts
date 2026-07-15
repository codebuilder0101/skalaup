import { api } from "@/lib/api";

const MAX_DIM = 512; // px — profile photos are shown small; downscale before upload.
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export type PhotoUploadResult = { url?: string; error?: "invalid" | "too_large" | "failed" };

// Downscale an image file to a JPEG data URL (longest side <= MAX_DIM).
function downscale(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("no-canvas")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}

// Validate, downscale and upload a profile photo; returns the stored URL.
export async function uploadProfilePhoto(file: File): Promise<PhotoUploadResult> {
  if (!ALLOWED.includes(file.type)) return { error: "invalid" };
  if (file.size > MAX_BYTES) return { error: "too_large" };
  try {
    const dataUrl = await downscale(file);
    const { url } = await api.post<{ url: string }>("/uploads/photo", { dataUrl });
    return { url };
  } catch {
    return { error: "failed" };
  }
}
