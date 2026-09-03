export type SlugVehicle = {
  id: string;
  vehicle_identifier: string;
  year: number;
  brand: string;
  name: string;
};

export function isVehicleUuid(value: string | undefined): boolean;
export function getVehicleBaseSlug(vehicle: Pick<SlugVehicle, "year" | "brand" | "name">): string;
export function getVehicleSlugMap<T extends SlugVehicle>(vehicles: T[]): Map<string, T>;
export function getVehicleSlug<T extends SlugVehicle>(vehicle: T, vehicles: T[]): string;
export function getVehicleCanonicalPath<T extends SlugVehicle>(vehicle: T, vehicles: T[]): string;
export function resolveVehicleReference<T extends SlugVehicle>(reference: string, vehicles: T[]): { vehicle: T; slug: string; isLegacyUuid: boolean } | null;
