const groupHeadings = new Set([
  "TRIP & FINANCIAL SUMMARY",
  "PRIMARY INSURANCE — FLORIDA RENTALS",
  "CHARGEBACK AND PAYMENT DISPUTE ADDENDUM",
  "ELECTRONIC ACCEPTANCE RECORD",
  "GUEST ELECTRONIC ACKNOWLEDGMENT",
]);

const floridaPrimaryInsuranceStatutoryText = "“The valid and collectible liability insurance and personal injury protection insurance of any authorized rental or leasing driver is primary for the limits of liability and personal injury protection coverage required by ss. 324.021(7) and 627.736, Florida Statutes.”";

const subsectionHeadings = new Set([
  "Unauthorized Drivers",
  "CLASS AND REPRESENTATIVE ACTION WAIVER",
  "Arbitration Opt-Out",
]);

type RentalAgreementDocumentProps = {
  text: string;
  showTitle?: boolean;
};

export function RentalAgreementDocument({ text, showTitle = true }: RentalAgreementDocumentProps) {
  const blocks = text.trim().split(/\n\n+/);

  return blocks.map((block, index) => {
    if (block === "⸻") return <hr key={index} className="border-border/60" />;

    if (showTitle && index === 0 && block === "ZONYX TRIP RENTAL AGREEMENT") {
      return <h1 key={index} className="font-display text-3xl font-bold tracking-wide md:text-4xl">{block}</h1>;
    }

    if (showTitle && index === 1 && /^Version \d+\.\d+/.test(block)) {
      return <p key={index} className="font-display text-sm font-semibold tracking-[0.2em] text-primary">{block}</p>;
    }

    if (/^(?:\d+|A\d+)\. [A-Z]/.test(block)) {
      return <h2 key={index} className="font-display text-xl font-semibold tracking-wide text-foreground md:text-2xl">{block}</h2>;
    }

    if (groupHeadings.has(block)) {
      const isFloridaPrimaryInsurance = block === "PRIMARY INSURANCE — FLORIDA RENTALS";
      return <h2 key={index} className={isFloridaPrimaryInsurance
        ? "rental-agreement-primary-insurance-heading font-display font-bold tracking-[0.12em] text-primary"
        : "font-display text-sm font-semibold tracking-[0.22em] text-primary md:text-base"}>{block}</h2>;
    }

    if (subsectionHeadings.has(block)) {
      return <h3 key={index} className="font-display text-lg font-semibold tracking-wide text-foreground md:text-xl">{block}</h3>;
    }

    if (block === floridaPrimaryInsuranceStatutoryText) {
      return <p key={index} className="rental-agreement-primary-insurance whitespace-pre-line font-semibold">{block}</p>;
    }

    return <p key={index} className="whitespace-pre-line">{block}</p>;
  });
}