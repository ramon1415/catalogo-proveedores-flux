import { jsPDF as CoreJsPDF } from "jspdf-core";
import { addEmbeddedSystemPdfLogo } from "./pdf_logo_embed.ts";

// Deno/Edge shim: jsPDF's WebP path rendered the Flux wordmark as a blank rectangle.
// Inject the exact PNG wordmark at construction time and suppress the legacy WebP logo call.
export function jsPDF(...args) {
  const doc = new CoreJsPDF(...args);
  addEmbeddedSystemPdfLogo(doc);

  const originalAddImage = doc.addImage.bind(doc);
  doc.addImage = (imageData, format, ...rest) => {
    if (String(format || "").toUpperCase() === "WEBP") return doc;
    return originalAddImage(imageData, format, ...rest);
  };

  return doc;
}

jsPDF.API = CoreJsPDF.API;

