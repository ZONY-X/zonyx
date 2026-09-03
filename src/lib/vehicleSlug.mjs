const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isVehicleUuid = (value) => Boolean(value && UUID_PATTERN.test(value));

const slugify = (value) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

export const getVehicleBaseSlug = (vehicle) => slugify(`${vehicle.year} ${vehicle.brand} ${vehicle.name} miami`);

export const getVehicleSlugMap = (vehicles) => {
  const counts = new Map();
  for (const vehicle of vehicles) {
    const baseSlug = getVehicleBaseSlug(vehicle);
    counts.set(baseSlug, (counts.get(baseSlug) ?? 0) + 1);
  }

  return new Map(vehicles.map((vehicle) => {
    const baseSlug = getVehicleBaseSlug(vehicle);
    const slug = counts.get(baseSlug) === 1 ? baseSlug : `${baseSlug}-${slugify(vehicle.vehicle_identifier)}`;
    return [slug, vehicle];
  }));
};

export const getVehicleSlug = (vehicle, vehicles) => {
  for (const [slug, mappedVehicle] of getVehicleSlugMap(vehicles)) {
    if (mappedVehicle.id === vehicle.id) return slug;
  }
  return getVehicleBaseSlug(vehicle);
};

export const getVehicleCanonicalPath = (vehicle, vehicles) => `/vehicle/${getVehicleSlug(vehicle, vehicles)}`;

export const resolveVehicleReference = (reference, vehicles) => {
  if (isVehicleUuid(reference)) {
    const vehicle = vehicles.find((candidate) => candidate.id === reference) ?? null;
    return vehicle ? { vehicle, slug: getVehicleSlug(vehicle, vehicles), isLegacyUuid: true } : null;
  }

  const vehicle = getVehicleSlugMap(vehicles).get(reference) ?? null;
  return vehicle ? { vehicle, slug: reference, isLegacyUuid: false } : null;
};
