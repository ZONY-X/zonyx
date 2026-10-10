import { expect, test } from "@playwright/test";

const vehicleId = "3b8770f4-f2a5-4c24-846f-d5b856742065";
const userId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";

const user = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "test@example.com",
  created_at: "2038-01-01T00:00:00.000Z",
  app_metadata: {},
  user_metadata: {},
};

const vehicle = {
  id: vehicleId,
  host_profile_id: "33333333-3333-4333-8333-333333333333",
  vehicle_identifier: "ZONYX-CT-AWD-001",
  brand: "Tesla",
  name: "Cybertruck AWD",
  model: "Cybertruck AWD",
  category: "Electric Pickup",
  color: "Silver",
  year: 2025,
  base_daily_rate_cents: 16600,
  minimum_rental_hours: 25,
  image_url: "/placeholder.svg",
  images: ["/placeholder.svg"],
  seats: 5,
  transmission: "automatic",
  fuel_type: "Electric",
  is_active: true,
  availability_status: "active",
  vin: "FIXTUREVIN",
  plate: "FIXTURE",
  description: null,
};


test.beforeEach(async ({page}) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 3600;
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, exp: expiresAt, role: "authenticated", email: user.email })}.signature`;
      const session = { access_token: token, refresh_token: "fixture-refresh", expires_in: 3600, expires_at: expiresAt, token_type: "bearer", user };

      await page.setViewportSize({width:1200,height:1000});
      await page.addInitScript((fixtureSession) => {
        window.localStorage.setItem("sb-fazzuetfwwfiqehpnjky-auth-token", JSON.stringify(fixtureSession));
      }, session);

      await page.route("**fazzuetfwwfiqehpnjky.supabase.co/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        let body: unknown;
        let status = 200;

        if (path === "/auth/v1/user") body = user;
        else if (path.includes("/rest/v1/vehicles")) body = vehicle;
        else if (path.includes("/rest/v1/profiles")) body = { id: profileId, is_admin: false, is_internal_tester: false };
        else if (path.endsWith("/rpc/get_my_account_capabilities")) body = [{ profile_id: profileId, can_guest: true, can_host: false, can_admin: false }];
        else if (path.endsWith("/rpc/get_my_platform_capabilities")) body = [];
        else if (path.endsWith("/rpc/calculate_rental_days")) { const input=route.request().postDataJSON(); body=Math.ceil((Date.parse(`${input._end_date}T${input._dropoff_time}:00Z`)-Date.parse(`${input._start_date}T${input._pickup_time}:00Z`))/86400000); }
        else if (path.endsWith("/rpc/validate_promo_code")) body=[{code:"ZONYX47",discount_type:"fixed",discount_value_cents:4700,discount_percent:null}];
        else if (path.endsWith("/rpc/check_vehicle_availability")) body = true;
        else if (path.endsWith("/rpc/get_my_driver_eligibility")) body = [{ legal_name: "Test Guest", status: "eligible_self_attested" }];
        else if (path.endsWith("/functions/v1/rental-agreement")) {
          body = {
            agreementId: "44444444-4444-4444-8444-444444444444",
            proposedBookingId: "55555555-5555-4555-8555-555555555555",
            masterVersion: "1.2",
            documentHash: "a".repeat(64),
            renderedText: Array.from({ length: 90 }, (_, index) => `Agreement line ${index + 1}: existing legal terms remain unchanged.`).join("\n"),
            summary: {
              final_total_cents: 58080,
              currency: "usd",
              authorization_hold_amount_cents: 75000,
              mileage_calculation_method: "per_day_non_cumulative",
              included_mileage_allowance: 75,
              additional_mile_rate_cents: 140,
              authorized_drivers: [],
              additional_booking_specific_terms: null,
            },
          };
        } else {
          status = 404;
          body = { error: `Unhandled fixture route ${path}` };
        }

        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      });


});
const path = (dropoff: string) => `/booking/${vehicleId}?start=2038-10-10&end=2038-10-11&pickupTime=17%3A00&dropoffTime=${dropoff}&pickupLocation=Brickell&promo=ZONYX47`;
test('24 hours is blocked, changing to 25 hours recalculates two-day promo total',async({page})=>{
 await page.goto(path('17%3A00'));
 await expect(page.getByRole('button',{name:'Minimum rental: 25 hours'})).toBeDisabled();
 await page.getByLabel('Drop-off time',{exact:true}).fill('18:00');
 await expect(page.getByText('$351.40',{exact:true})).toBeVisible();
 await expect(page.getByText('Minimum rental: 25 hours. Each started 24-hour period', {exact:false})).toBeVisible();
 await page.getByLabel('Drop-off time',{exact:true}).fill('17:00');
 await expect(page.getByRole('button',{name:'Minimum rental: 25 hours'})).toBeDisabled();
});
test('complimentary delivery adds no fee or second introductory discount',async({page})=>{
 await page.goto(path('18%3A00')+'&addons=airportDelivery');
 await expect(page.getByText('$351.40',{exact:true})).toBeVisible();
 await expect(page.getByText('Complimentary',{exact:true})).toHaveCount(2);
 await expect(page.getByText('-$47.00',{exact:true})).toBeVisible();
});
