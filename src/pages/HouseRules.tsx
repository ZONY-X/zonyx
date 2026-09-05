import { MainLayout } from "@/components/layout/MainLayout";
import { Seo } from "@/components/seo/Seo";

export default function HouseRules() {
  return (
    <MainLayout>
      <Seo
        title="ZONYX House Rules"
        description="Review ZONYX vehicle rental house rules, mileage terms, return requirements, and vehicle care policies."
        path="/house-rules"
      />
      <div className="min-h-screen pt-24 pb-20">
        <div className="container max-w-5xl">
          <div className="mb-12 text-center">
            <h1 className="font-display text-4xl font-bold tracking-wide md:text-5xl lg:text-6xl">ZONYX HOUSE RULES</h1>
            <p className="mt-4 font-display text-sm font-semibold tracking-wide text-primary">Please read carefully to ensure a smooth and enjoyable experience.</p>
          </div>

          <div className="glass space-y-10 rounded-lg p-6 text-sm leading-relaxed text-foreground/90 md:p-10">
            <div className="text-center">
              <h2 className="font-display text-2xl font-semibold tracking-wide">Welcome on board!</h2>
              <p className="mx-auto mt-3 max-w-4xl text-base">Thank you so much for choosing our vehicle. To make sure your trip is safe, comfortable, and damage-free for both you and future guests, please take a moment to review the following house rules:</p>
            </div>

            <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">1. No Smoking, Vaping, or Pets</h2>
                <p className="mt-2">To maintain a clean, allergen-free environment, smoking, vaping, and pets are strictly prohibited. Any evidence of smoke, odor, ashes, fur, or residues will result in a cleaning fee.</p>
              </section>
              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">8. Safe Driving</h2>
                <p className="mt-2">Please:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Follow all traffic laws</li>
                  <li>Avoid excessive speeding</li>
                  <li>Do not take the car off-road</li>
                  <li>Be cautious with curbs, driveways, and tight parking spaces</li>
                </ul>
                <p className="mt-2">Damages resulting from unsafe driving may incur repair fees.</p>
              </section>

              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">2. No Eating Inside the Vehicle</h2>
                <p className="mt-2">Food spills, stains, and crumbs damage the interior and attract insects. Eating inside the vehicle is not permitted. Any evidence of food spills, stains, or residues will incur a cleaning fee (no exceptions).</p>
              </section>
              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">9. Keep the Car Locked</h2>
                <p className="mt-2">For safety and insurance purposes, always lock the vehicle when leaving it unattended, especially overnight. If you get locked out, we can assist you instantly and remotely.</p>
              </section>

              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">3. No Sitting With Wet Clothing</h2>
                <p className="mt-2">This includes:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Swimsuits</li>
                  <li>Wet towels</li>
                  <li>Wet gym clothes</li>
                  <li>Entering after beach or pool activities</li>
                </ul>
                <p className="mt-2">Moisture damages the seats and leaves permanent water marks. Please ensure clothing is fully dry before sitting.</p>
              </section>
              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">10. No Unauthorized Modifications</h2>
                <p className="mt-2">This includes:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Removing parts or covers from mirrors/screens</li>
                  <li>Adding stickers</li>
                  <li>Applying scents or sprays</li>
                  <li>Changing Tesla safety settings</li>
                  <li>Altering Autopilot configurations</li>
                </ul>
              </section>

              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">4. Driver's License Verification</h2>
                <p className="mt-2">We may request a photo or verification of your driver's license before the start of the trip. This is required for identity and safety confirmation.</p>
              </section>
              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">11. Cleanliness &amp; Return Condition</h2>
                <p className="mt-2">Please return the car in the same clean condition in which it was received. Excessive dirt, sand, stains, or moisture may result in a cleaning fee.</p>
              </section>

              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">5. Luggage Policy</h2>
                <p className="mt-2">To protect the interior and ensure your safety:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>No luggage on seats</li>
                  <li>Please store all bags and suitcases in the trunk only</li>
                </ul>
                <p className="mt-2">Heavy luggage on seats can cause damage or become dangerous in the event of sudden braking.</p>
              </section>
              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">12. Self-Drive / Autopilot Usage (Request Required)</h2>
                <p className="mt-2">Self-Drive / Autopilot is available only upon request. There's a $75 fee for FSD activation. If you would like to use it, please notify us before your trip so we can enable it for you.</p>
                <p className="mt-4 font-semibold">When enabled, the driver must remain fully attentive and follow all Tesla safety requirements.</p>
                <p>Tesla issues progressive warnings when the system detects inattention (hands not detected on the wheel, looking at the phone, eyes off the road, etc.).</p>
                <h3 className="mt-4 font-display text-base font-semibold tracking-wide">VERY IMPORTANT - PLEASE READ</h3>
                <p className="mt-2">If the system detects inattention three times, Tesla permanently disables Autopilot for the entire duration of the trip. Once locked, we cannot re-enable it during your rental - it affects all future guests, not just you.</p>
                <p className="mt-4">Self-Drive is a paid premium feature, and <strong>permanent lockout caused by misuse results in a $150 fee</strong>, which covers:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Tesla's calibration/reset process</li>
                  <li>The loss of availability for future renters</li>
                  <li>The restoration of the feature on our end</li>
                </ul>
                <p className="mt-4 font-semibold">Please use Autopilot responsibly to avoid permanent deactivation and the related fee.</p>
              </section>

              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">6. Incidentals/Mile Allowance</h2>
                <p className="mt-2">You are responsible for:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Parking fees</li>
                  <li>Tickets</li>
                  <li>Tolls</li>
                  <li>Violations</li>
                  <li>Any damages during the rental period, including vehicle accessories</li>
                  <li>Mileage allowance: 75 miles per day. Not transferable.</li>
                  <li>Excess mileage: $1.40 per additional mile.</li>
                </ul>
                <p className="mt-3">Any parking citation must be reported immediately. Discarded or unreported tickets will result in a $100 administrative fee plus the full cost of the citation, charged to the card on file when identified. No exceptions.</p>
                <p className="mt-3">These may be charged after the trip if not settled.</p>
              </section>
              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">Return Timing &amp; Battery Level</h2>
                <p className="mt-2">We have a grace period of 15 minutes for returns. After that, a late fee will apply (no exceptions).</p>
                <p className="mt-2">Battery level at return must match pickup level or a fee may apply.</p>
              </section>

              <section>
                <h2 className="font-display text-lg font-semibold tracking-wide">7. Seat Belt Rules</h2>
                <p className="mt-2">Seat belts must be buckled only when a person is seated. Buckling empty seats can damage the mechanism and result in repair charges.</p>
              </section>
            </div>

            <div className="border-t border-border pt-8 text-center">
              <p className="font-display text-lg tracking-wide">Thank You for Treating Our Vehicle With Love</p>
              <p className="mx-auto mt-3 max-w-3xl">Every guest who treats the car with care helps us maintain fair pricing and offer a premium, sustainable experience for future riders. If you need anything at all, we're only a message away.</p>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
