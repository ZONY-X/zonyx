import { MainLayout } from "@/components/layout/MainLayout";
import { Seo } from "@/components/seo/Seo";

export default function Terms() {
  return (
    <MainLayout>
      <Seo
        title="ZONYX Terms of Service"
        description="Review the terms governing ZONYX vehicle rental services and platform access."
        path="/terms"
      />
      <div className="min-h-screen pt-24 pb-20">
        <div className="container max-w-3xl">
          <div className="text-center mb-12">
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold tracking-wide mb-4">
              Terms of Service
            </h1>
            <p className="font-display text-muted-foreground tracking-wide text-xs">
              Last Updated: February 17, 2026
            </p>
          </div>

          <div className="glass rounded-lg p-6 md:p-10 space-y-10 text-sm leading-relaxed text-foreground/90">
            <p>
              These Terms of Service ("Terms") govern your access to and use of the ZONYX platform, website, and
              services.
            </p>
            <p>
              By accessing the Platform, creating an account, or booking a vehicle, you acknowledge that you have
              read, understood, and agree to be legally bound by these Terms. If you do not agree to these Terms,
              you must not use the Platform or Services.
            </p>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">1. DEFINITIONS</h2>
              <p className="mb-2">
                <strong>Company / ZONYX:</strong> ZONYX.
              </p>
              <p className="mb-2">
                <strong>Platform:</strong> The website, applications, booking systems, and services operated by
                ZONYX.
              </p>
              <p className="mb-2">
                <strong>User:</strong> Any individual who visits, accesses, or uses the Platform.
              </p>
              <p className="mb-2">
                <strong>Renter:</strong> A User who books or intends to book a vehicle.
              </p>
              <p className="mb-2">
                <strong>Authorized Driver:</strong> An individual approved to operate a vehicle under a Rental
                Agreement.
              </p>
              <p className="mb-2">
                <strong>Fleet Partner / Host:</strong> A third party that owns or supplies a vehicle made available
                through ZONYX.
              </p>
              <p className="mb-2">
                <strong>Rental Agreement:</strong> The specific contract issued for each reservation governing that
                rental.
              </p>
              <p>
                <strong>House Rules:</strong> Operational policies published on a separate page or tab and
                incorporated into each rental by reference.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">2. ROLE OF ZONYX</h2>
              <p className="mb-2">ZONYX operates:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>a digital booking platform; and</li>
                <li>a vehicle rental service.</li>
              </ul>
              <p className="mb-2">
                For all reservations completed through the Platform, ZONYX acts as the rental operator and
                contracting party with the Renter, regardless of whether the vehicle is owned by ZONYX or supplied
                by a Fleet Partner.
              </p>
              <p>Fleet Partners supply vehicles but are not contracting rental providers to the Renter.</p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">3. CONTRACTUAL STRUCTURE</h2>
              <p className="mb-2">Use of the Platform and each reservation is governed by:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>
                  These Terms of Service (
                  <a
                    href="https://www.gozonyx.com/terms"
                    className="text-primary underline underline-offset-2"
                  >
                    https://www.gozonyx.com/terms
                  </a>
                  );
                </li>
                <li>The Rental Agreement issued for the specific booking;</li>
                <li>
                  The House Rules (
                  <a
                    href="/house-rules"
                    className="text-primary underline underline-offset-2"
                  >
                    https://www.gozonyx.com/house-rules
                  </a>
                  ), available on a separate page or tab; and
                </li>
                <li>Any pricing, disclosures, or policies presented during checkout.</li>
              </ul>
              <p className="mb-2">By completing a booking or using the Platform, you agree to be bound by all of the above.</p>
              <p className="mb-2">If any conflict exists:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>the Rental Agreement controls the specific rental;</li>
                <li>the House Rules govern operational conduct; and</li>
                <li>these Terms govern general Platform use.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">4. ACCOUNT RESPONSIBILITY</h2>
              <p className="mb-2">Users must:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>provide accurate information;</li>
                <li>maintain account security; and</li>
                <li>notify ZONYX of any unauthorized use.</li>
              </ul>
              <p className="mb-2">You are responsible for all activity under your account.</p>
              <p className="mb-2">
                ZONYX may suspend or terminate accounts or bookings at its sole discretion for:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>fraud or risk concerns;</li>
                <li>inaccurate information;</li>
                <li>unsafe conduct;</li>
                <li>non-payment; or</li>
                <li>violation of these Terms, the House Rules, or the Rental Agreement.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">
                5. BOOKINGS, PAYMENTS &amp; AUTHORIZATION
              </h2>
              <p className="mb-2">By making a reservation, you authorize ZONYX to:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>charge rental fees;</li>
                <li>hold and apply security deposits;</li>
                <li>charge your payment method for post-rental costs; and</li>
                <li>collect any applicable service fees or operational charges.</li>
              </ul>
              <p className="mb-2">This authorization:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>remains valid after the rental ends;</li>
                <li>applies to any unpaid verified charges; and</li>
                <li>survives account closure.</li>
              </ul>
              <p>
                Filing a payment dispute without first attempting resolution with ZONYX may constitute a breach of
                contract.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">6. SECURITY DEPOSIT</h2>
              <p className="mb-2">A security deposit may be required.</p>
              <p className="mb-2">ZONYX may:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>retain part or all of the deposit;</li>
                <li>delay release pending inspection or investigation; and</li>
                <li>apply the deposit toward any outstanding charges.</li>
              </ul>
              <p className="mb-2">Deposit retention may occur for, including but not limited to:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>vehicle damage;</li>
                <li>violation of House Rules;</li>
                <li>smoking or contamination;</li>
                <li>excessive cleaning;</li>
                <li>battery or fuel discrepancies;</li>
                <li>late return;</li>
                <li>tolls, tickets, or violations;</li>
                <li>missing accessories;</li>
                <li>misuse of vehicle systems; or</li>
                <li>administrative or recovery costs.</li>
              </ul>
              <p>Retention of a deposit does not limit ZONYX's right to charge additional amounts.</p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">7. POST-RENTAL CHARGES</h2>
              <p className="mb-2">You authorize ZONYX to charge your payment method for:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>repair costs;</li>
                <li>diminished value;</li>
                <li>loss of use;</li>
                <li>towing or recovery;</li>
                <li>roadside service;</li>
                <li>inspection or administrative costs;</li>
                <li>tolls, citations, or penalties;</li>
                <li>excess mileage;</li>
                <li>cleaning or restoration;</li>
                <li>battery recovery or charging; or</li>
                <li>late return fees.</li>
              </ul>
              <p>Charges may be processed after the rental once verified or invoiced.</p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">
                8. INSURANCE &amp; VEHICLE PROTECTION
              </h2>

              <h3 className="font-display text-base font-semibold tracking-wide mb-3 mt-4">8.1 Liability</h3>
              <p className="mb-2">Operation of a motor vehicle may create legal liability.</p>
              <p className="mb-2">
                ZONYX does not guarantee liability coverage beyond what is required by applicable law or expressly
                documented.
              </p>
              <p className="mb-2">Liability protection may originate from:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>the vehicle's insurance policy;</li>
                <li>the Renter's own insurance; or</li>
                <li>other legally valid sources.</li>
              </ul>
              <p>You remain responsible for any liability not covered.</p>

              <h3 className="font-display text-base font-semibold tracking-wide mb-3 mt-6">
                8.2 Physical Damage Protection
              </h3>
              <p className="mb-2">
                For certain rentals, ZONYX may facilitate or include third-party vehicle protection covering
                physical damage or theft.
              </p>
              <p className="mb-2">Such protection:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>is issued by an independent provider;</li>
                <li>is governed solely by that provider's terms; and</li>
                <li>may include exclusions, deductibles, or claim conditions.</li>
              </ul>
              <p className="mb-2">ZONYX:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>is not an insurer;</li>
                <li>does not guarantee claim approval; and</li>
                <li>is not liable for provider decisions.</li>
              </ul>
              <p>You remain responsible for uncovered losses.</p>

              <h3 className="font-display text-base font-semibold tracking-wide mb-3 mt-6">
                8.3 Claims Cooperation
              </h3>
              <p className="mb-2">
                In the event of any incident, damage, theft, or insurance claim, the Renter agrees to promptly and
                actively cooperate with ZONYX and any applicable protection or insurance provider, including
                providing statements, documentation, photographs, reports, and any requested information.
              </p>
              <p>
                Failure to cooperate may result in denial of coverage and the Renter remaining fully responsible for
                all losses, damages, and related costs.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">
                9. VEHICLE USE RESPONSIBILITY
              </h2>
              <p className="mb-2">When operating a rented vehicle, you:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>assume responsibility for lawful and safe operation;</li>
                <li>must ensure only Authorized Drivers operate the vehicle; and</li>
                <li>are liable for violations, damages, or misuse.</li>
              </ul>
              <p className="mb-2">
                Operational requirements, return conditions, and conduct rules are detailed in the Rental Agreement
                and the House Rules.
              </p>
              <p>Violation constitutes a material breach.</p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">10. THIRD-PARTY SERVICES</h2>
              <p className="mb-2">The Platform may rely on third-party providers including:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>payment processors;</li>
                <li>insurance or protection providers;</li>
                <li>Fleet Partners; and</li>
                <li>roadside assistance providers.</li>
              </ul>
              <p>ZONYX is not liable for acts, errors, or interruptions caused by third-party services.</p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">
                11. PLATFORM USE RESTRICTIONS
              </h2>
              <p className="mb-2">Users may not:</p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>use the Platform unlawfully;</li>
                <li>bypass payment systems;</li>
                <li>misrepresent identity or eligibility;</li>
                <li>interfere with Platform security; or</li>
                <li>copy, scrape, or exploit Platform data.</li>
              </ul>
              <p>Violation may result in account termination and legal action.</p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">12. ASSUMPTION OF RISK</h2>
              <p>
                Use of the Platform and operation of rented vehicles involve inherent risks. You voluntarily assume
                those risks to the fullest extent permitted by law.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">13. INDEMNIFICATION</h2>
              <p className="mb-2">
                You agree to indemnify, defend, and hold harmless ZONYX and its affiliates from any claim, loss,
                liability, or legal expense arising from:
              </p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>use of the Platform;</li>
                <li>vehicle operation;</li>
                <li>breach of agreements;</li>
                <li>violations of law; or</li>
                <li>unauthorized drivers,</li>
              </ul>
              <p>except where caused solely by ZONYX's gross negligence.</p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">14. LIMITATION OF LIABILITY</h2>
              <p className="mb-2">
                To the fullest extent permitted by law, ZONYX shall not be liable for:
              </p>
              <ul className="list-disc pl-6 space-y-1 mb-2">
                <li>indirect or consequential damages;</li>
                <li>lost income or travel disruption; or</li>
                <li>personal inconvenience.</li>
              </ul>
              <p>Total liability shall not exceed the amount paid for the service giving rise to the claim.</p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">15. DISPUTE RESOLUTION</h2>
              <p className="mb-2">
                All disputes shall be resolved through binding individual arbitration administered by the American
                Arbitration Association.
              </p>
              <p className="mb-2">No class actions permitted.</p>
              <p className="mb-2">
                <strong>Governing law:</strong> Florida.
              </p>
              <p className="mb-2">
                <strong>Venue:</strong> Florida.
              </p>
              <p>Small-claims court remains available where applicable.</p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">16. MODIFICATIONS</h2>
              <p>
                ZONYX may update these Terms at any time. Continued use of the Platform after updates constitutes
                acceptance.
              </p>
            </section>

            <section>
              <h2 className="font-display text-xl font-semibold tracking-wide mb-4">17. CONTACT</h2>
              <p className="mb-2">
                <strong>ZONYX</strong>
              </p>
              <p className="mb-2">
                601 Brickell Key Dr
                <br />
                Miami, Florida 33131
                <br />
                United States
              </p>
              <p>
                <strong>Email:</strong>{" "}
                <a href="mailto:support@gozonyx.com" className="text-primary underline underline-offset-2">
                  support@gozonyx.com
                </a>
              </p>
            </section>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
