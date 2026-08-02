export interface AuthorizationHoldRule {
  maxDays: number;
  amount: number;
}

const authorizationHoldRules: Record<string, AuthorizationHoldRule[]> = {
  "tesla-model-3": [
    { maxDays: 10, amount: 500 },
    { maxDays: 20, amount: 750 },
    { maxDays: 30, amount: 1000 },
  ],
  "lucid-air-touring": [
    { maxDays: 10, amount: 750 },
    { maxDays: 20, amount: 1000 },
    { maxDays: 30, amount: 1500 },
  ],
  "mercedes-benz-g580-eq": [
    { maxDays: 10, amount: 750 },
    { maxDays: 20, amount: 1000 },
    { maxDays: 30, amount: 1500 },
  ],
  "rivian-r1s": [
    { maxDays: 10, amount: 750 },
    { maxDays: 20, amount: 1000 },
    { maxDays: 30, amount: 1500 },
  ],
  "tesla-cybertruck-awd": [
    { maxDays: 3, amount: 750 },
    { maxDays: 10, amount: 1000 },
    { maxDays: 20, amount: 1500 },
    { maxDays: 30, amount: 2000 },
  ],
};

const authorizationHoldAliases: Record<string, string> = {
  cybertruck: "tesla-cybertruck-awd",
  "cybertruck-awd": "tesla-cybertruck-awd",
  model3: "tesla-model-3",
  "model 3": "tesla-model-3",
  "tesla model 3": "tesla-model-3",
  "tesla-model-3": "tesla-model-3",
  "tesla-model-y": "tesla-model-3",
  r1s: "rivian-r1s",
  "rivian r1s": "rivian-r1s",
  rivian: "rivian-r1s",
  rivianr1s: "rivian-r1s",
  lucid: "lucid-air-touring",
  "lucid air": "lucid-air-touring",
  "lucid-air": "lucid-air-touring",
  mercedes: "mercedes-benz-g580-eq",
  "mercedes-benz": "mercedes-benz-g580-eq",
};

function normalizeVehicleType(vehicleType: string): string {
  return authorizationHoldAliases[vehicleType.trim().toLowerCase()] ?? vehicleType.trim().toLowerCase();
}

export function calculateAuthorizationHold(vehicleType: string, rentalDays: number): number {
  const normalizedVehicleType = normalizeVehicleType(vehicleType);
  const rules = authorizationHoldRules[normalizedVehicleType];
  const safeDays = Math.max(1, Math.round(rentalDays));

  if (!rules) {
    return 0;
  }

  const matchingRule = rules.find((rule) => safeDays <= rule.maxDays);
  return matchingRule?.amount ?? rules[rules.length - 1].amount;
}
