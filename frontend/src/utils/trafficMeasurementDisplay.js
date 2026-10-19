export function formatMeasurementSource(source) {
  if (source === "SIMULATOR") return "Simulator";
  if (source === "API") return "API submitted";
  return "Unknown source";
}
