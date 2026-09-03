import { getVehicleCanonicalPath, getVehicleSlug, getVehicleSlugMap, isVehicleUuid, resolveVehicleReference } from "./vehicleSlug.mjs";

const assertEqual = (actual, expected, description) => {
  if (actual !== expected) throw new Error(`${description}: expected ${expected}, received ${actual}`);
  console.log(`PASS: ${description}`);
};

const cybertruck = { id: "3b8770f4-f2a5-4c24-846f-d5b856742065", vehicle_identifier: "ZONYX-CT-AWD-001", year: 2025, brand: "Tesla", name: "Cybertruck AWD" };
const model3 = { id: "1e68456d-d5ee-4f26-8ed2-0ff6ae74b069", vehicle_identifier: "ZONYX-TESLA-M3-001", year: 2025, brand: "Tesla", name: "Model 3" };
const duplicateModel3 = { ...model3, id: "f4e3d2c1-b0a9-4f8e-8123-456789abcdef", vehicle_identifier: "ZONYX-TESLA-M3-002" };

assertEqual(getVehicleSlug(cybertruck, [cybertruck]), "2025-tesla-cybertruck-awd-miami", "normal slug generation");
assertEqual(getVehicleSlug({ ...cybertruck, brand: "Mercedes-Benz", name: "EQE SUV & Coupe" }, [{ ...cybertruck, brand: "Mercedes-Benz", name: "EQE SUV & Coupe" }]), "2025-mercedes-benz-eqe-suv-and-coupe-miami", "punctuation and spacing normalization");
assertEqual(getVehicleSlugMap([model3, duplicateModel3]).has("2025-tesla-model-3-miami-zonyx-tesla-m3-001"), true, "duplicate collision suffix is deterministic");
assertEqual(isVehicleUuid(cybertruck.id), true, "UUID detection");
assertEqual(resolveVehicleReference("2025-tesla-model-3-miami", [model3])?.vehicle.id, model3.id, "slug resolves to existing UUID");
assertEqual(resolveVehicleReference(cybertruck.id, [cybertruck])?.slug, "2025-tesla-cybertruck-awd-miami", "legacy UUID resolves to canonical slug");
assertEqual(`https://www.gozonyx.com${getVehicleCanonicalPath(cybertruck, [cybertruck])}`, "https://www.gozonyx.com/vehicle/2025-tesla-cybertruck-awd-miami", "sitemap URL matches canonical vehicle URL");
