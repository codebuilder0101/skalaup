import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { mkdirSync } from "fs";

// Where uploaded files (profile photos, etc.) live on the server filesystem.
// Served statically at /api/uploads and overridable via env for other deploys.
const here = dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = process.env.UPLOAD_DIR || resolve(here, "../../uploads");

// Ensure the directory exists at startup (no-op if already present).
mkdirSync(UPLOAD_DIR, { recursive: true });
