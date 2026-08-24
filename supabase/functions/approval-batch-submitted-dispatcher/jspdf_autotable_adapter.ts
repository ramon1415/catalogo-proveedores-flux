import * as packageModule from "jspdf-autotable-package";

const candidate =
  packageModule.autoTable ||
  packageModule.default?.autoTable ||
  packageModule.default?.default ||
  packageModule.default;

if (typeof candidate !== "function") {
  throw new Error("jspdf_autotable_export_not_available");
}

export const autoTable = candidate;
export default candidate;
