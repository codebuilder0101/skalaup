import { Router } from "express";
import { randomUUID } from "crypto";
import { writeFile } from "fs/promises";
import { requireAuth } from "../auth.js";
import { UPLOAD_DIR } from "../uploads.js";

// Profile photo uploads (R20 item A3). The client sends a downscaled image as a
// base64 data URL; we decode it, store the file on disk (served statically at
// /api/uploads/<file>), and return its public URL to save into photo_url. Files
// live on the server filesystem — never in the database.
const router = Router();
router.use(requireAuth);

const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB decoded

// POST /api/uploads/photo { dataUrl } -> { url }
router.post("/photo", async (req, res) => {
  try {
    const dataUrl = String((req.body || {}).dataUrl || "");
    const m = dataUrl.match(/^data:([a-z/+-]+);base64,(.+)$/i);
    if (!m || !EXT_BY_MIME[m[1].toLowerCase()]) {
      return res.status(400).json({ error: "invalid_image", message: "Envie uma imagem JPG, PNG ou WebP." });
    }
    const buf = Buffer.from(m[2], "base64");
    if (buf.length === 0) return res.status(400).json({ error: "invalid_image", message: "Imagem vazia." });
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: "too_large", message: "Imagem muito grande (máx. 5 MB)." });
    }
    const name = `${randomUUID()}.${EXT_BY_MIME[m[1].toLowerCase()]}`;
    await writeFile(`${UPLOAD_DIR}/${name}`, buf);
    res.status(201).json({ url: `/api/uploads/${name}` });
  } catch (e) {
    console.error("photo upload error:", e.message);
    res.status(500).json({ error: "Falha ao enviar a foto." });
  }
});

export default router;
