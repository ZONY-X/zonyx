import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type MotionRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  stagger?: number;
  threshold?: number;
  variant?: "rise" | "fade" | "scale";
};

export function MotionReveal({ children, className, delay = 0, stagger = 0, threshold = 0.18, variant = "rise" }: MotionRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }

    setMotionEnabled(true);
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { threshold, rootMargin: "0px 0px -8% 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div
      ref={ref}
      className={cn("motion-reveal", `motion-reveal--${variant}`, motionEnabled && "motion-reveal--enabled", visible && "motion-reveal--visible", stagger > 0 && "motion-reveal--stagger", className)}
      style={{ "--motion-delay": `${delay}ms`, "--motion-stagger": `${stagger}ms` } as CSSProperties}
    >
      {stagger > 0 ? Children.map(children, (child, index) => isValidElement(child)
        ? cloneElement(child as ReactElement<{ style?: CSSProperties }>, { style: { ...(child.props.style ?? {}), "--motion-item-delay": `${delay + index * stagger}ms` } as CSSProperties })
        : child) : children}
    </div>
  );
}