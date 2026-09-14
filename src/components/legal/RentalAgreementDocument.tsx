const groupHeadings = new Set([
  "TRIP & FINANCIAL SUMMARY",
  "CHARGEBACK AND PAYMENT DISPUTE ADDENDUM",
  "ELECTRONIC ACCEPTANCE RECORD",
  "GUEST ELECTRONIC ACKNOWLEDGMENT",
]);

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

    if (showTitle && index === 1 && block.startsWith("Version 1.2")) {
      return <p key={index} className="font-display text-sm font-semibold tracking-[0.2em] text-primary">{block}</p>;
    }

    if (/^(?:\d+|A\d+)\. [A-Z]/.test(block)) {
      return <h2 key={index} className="font-display text-xl font-semibold tracking-wide text-foreground md:text-2xl">{block}</h2>;
    }

    if (groupHeadings.has(block)) {
      return <h2 key={index} className="font-display text-sm font-semibold tracking-[0.22em] text-primary md:text-base">{block}</h2>;
    }

    if (subsectionHeadings.has(block)) {
      return <h3 key={index} className="font-display text-lg font-semibold tracking-wide text-foreground md:text-xl">{block}</h3>;
    }

    return <p key={index} className="whitespace-pre-line">{block}</p>;
  });
}