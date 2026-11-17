import QR from "qrcode";
import { useEffect, useState } from "react";

export function QRCode({ value, size = 280, className = "" }: { value: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState<string>("");
  useEffect(() => {
    let alive = true;
    QR.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#120C2B", light: "#FFFFFF" } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(""));
    return () => {
      alive = false;
    };
  }, [value]);
  return (
    <div
      className={`overflow-hidden rounded-2xl bg-white p-2 ${className}`}
      style={{ width: size, height: size }}
      aria-label={`QR code for ${value}`}
      role="img"
      data-testid="join-qr"
      // qrcode generates a static SVG from our own string — no user HTML involved.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
