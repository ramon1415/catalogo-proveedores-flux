import { sha256Hex } from "./crypto.ts";
import {
  type IntakeConfig,
  IntakeError,
  type LinkResolution,
  type PreparedFile,
} from "./types.ts";

export type ValidatedFile = Omit<PreparedFile, "fileId" | "storagePath"> & {
  extension: string;
};

const fileKinds = new Set([
  "invoice_pdf",
  "invoice_xml",
  "bank_document",
  "support",
  "other",
]);
const extensions: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "application/xml": ["xml"],
  "text/xml": ["xml"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};
const forbiddenXmlDeclaration = /<\s*!\s*(?:DOCTYPE|ENTITY)\b/i;

function extensionOf(filename: string): string {
  const match = filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match?.[1] || "";
}

function safeFilename(filename: string): boolean {
  return Boolean(filename.trim()) &&
    filename.length <= 255 &&
    !filename.includes("/") &&
    !filename.includes("\\") &&
    !filename.includes("..") &&
    !/[\u0000-\u001f\u007f]/.test(filename);
}

function hasMagicBytes(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === "application/pdf") {
    return bytes.length >= 5 &&
      new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= png.length &&
      png.every((value, index) => bytes[index] === value);
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  }
  if (mimeType === "application/xml" || mimeType === "text/xml") {
    const sample = new TextDecoder().decode(
      bytes.slice(0, Math.min(bytes.length, 512)),
    ).replace(/^\uFEFF/, "").trimStart();
    return sample.startsWith("<?xml") ||
      /^<[A-Za-z_][A-Za-z0-9_.:-]*(?:\s|>)/.test(sample);
  }
  return false;
}

function hasForbiddenXmlContent(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType !== "application/xml" && mimeType !== "text/xml") return false;
  return forbiddenXmlDeclaration.test(new TextDecoder().decode(bytes));
}

export async function validateIncomingFiles(
  files: File[],
  rawKinds: unknown,
  link: LinkResolution,
  config: IntakeConfig,
): Promise<ValidatedFile[]> {
  if (!Array.isArray(rawKinds) || rawKinds.length !== files.length) {
    throw new IntakeError("invalid_request", 400, "file_kinds_invalid");
  }
  if (files.length > config.maxFiles) {
    throw new IntakeError("payload_too_large", 413, "too_many_files");
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > config.maxTotalBytes) {
    throw new IntakeError("payload_too_large", 413, "files_total_too_large");
  }

  const prepared: ValidatedFile[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const kind = typeof rawKinds[index] === "string"
      ? rawKinds[index].trim().toLowerCase()
      : "";
    const mimeType = file.type.trim().toLowerCase();
    const extension = extensionOf(file.name);

    if (!fileKinds.has(kind)) {
      throw new IntakeError("invalid_request", 400, "file_kind_invalid");
    }
    if (!safeFilename(file.name)) {
      throw new IntakeError("invalid_request", 400, "filename_invalid");
    }
    if (
      !link.allowed_file_types.includes(mimeType) ||
      !extensions[mimeType]?.includes(extension)
    ) {
      throw new IntakeError(
        "file_type_not_allowed",
        415,
        "file_type_not_allowed",
      );
    }
    if (file.size < 1 || file.size > link.max_file_mb * 1024 * 1024) {
      throw new IntakeError("payload_too_large", 413, "file_too_large");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasMagicBytes(mimeType, bytes)) {
      throw new IntakeError(
        "file_type_not_allowed",
        415,
        "file_signature_invalid",
      );
    }
    if (hasForbiddenXmlContent(mimeType, bytes)) {
      throw new IntakeError(
        "file_type_not_allowed",
        415,
        "xml_dtd_entity_not_allowed",
      );
    }

    prepared.push({
      originalFilename: file.name,
      mimeType,
      sizeBytes: file.size,
      fileKind: kind,
      sha256: await sha256Hex(bytes),
      bytes,
      extension,
    });
  }
  return prepared;
}

export function prepareStorageFiles(
  files: ValidatedFile[],
  intakeId: string,
): PreparedFile[] {
  return files.map((file) => {
    const fileId = crypto.randomUUID();
    return {
      fileId,
      storagePath: `${intakeId}/${fileId}.${file.extension}`,
      originalFilename: file.originalFilename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      fileKind: file.fileKind,
      sha256: file.sha256,
      bytes: file.bytes,
    };
  });
}
