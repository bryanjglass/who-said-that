/**
 * Original cartoon "blob buddy" avatars, drawn as inline SVG so they look
 * identical on every TV and phone (no emoji font differences).
 */
import { memo } from "react";

type Shape = "round" | "box" | "ghost" | "egg";
type Topper = "ears" | "antenna" | "horns" | "tuft" | "sprout" | "bow";
type Eyes = "dots" | "big" | "happy" | "cyclops" | "wink";
type Mouth = "smile" | "grin" | "o" | "tongue" | "fang";

interface AvatarSpec {
  name: string;
  color: string;
  shade: string;
  shape: Shape;
  topper: Topper;
  eyes: Eyes;
  mouth: Mouth;
}

export const AVATARS: AvatarSpec[] = [
  { name: "Blaze", color: "#FF5A5F", shade: "#D63A43", shape: "round", topper: "ears", eyes: "big", mouth: "smile" },
  { name: "Tango", color: "#FF9F1C", shade: "#D67E00", shape: "box", topper: "antenna", eyes: "dots", mouth: "grin" },
  { name: "Sunny", color: "#FFD23F", shade: "#E0AE10", shape: "ghost", topper: "tuft", eyes: "happy", mouth: "o" },
  { name: "Kiwi", color: "#8BD346", shade: "#62A82A", shape: "egg", topper: "sprout", eyes: "cyclops", mouth: "smile" },
  { name: "Minty", color: "#2EC4B6", shade: "#1A9A8E", shape: "round", topper: "horns", eyes: "dots", mouth: "tongue" },
  { name: "Skye", color: "#3ABEFF", shade: "#1495D6", shape: "ghost", topper: "antenna", eyes: "big", mouth: "fang" },
  { name: "Bluey", color: "#4D7CFE", shade: "#2F5AD6", shape: "egg", topper: "ears", eyes: "happy", mouth: "grin" },
  { name: "Grape", color: "#9B6BFF", shade: "#7646E0", shape: "box", topper: "horns", eyes: "cyclops", mouth: "o" },
  { name: "Bubbles", color: "#FF6FB5", shade: "#E04892", shape: "egg", topper: "bow", eyes: "big", mouth: "smile" },
  { name: "Peach", color: "#FF8A65", shade: "#E0663F", shape: "round", topper: "tuft", eyes: "wink", mouth: "grin" },
  { name: "Ziggy", color: "#1FAB89", shade: "#11876A", shape: "box", topper: "sprout", eyes: "big", mouth: "tongue" },
  { name: "Lilac", color: "#C3A6FF", shade: "#9C7BE6", shape: "ghost", topper: "ears", eyes: "dots", mouth: "smile" },
  { name: "Mocha", color: "#B07D5B", shade: "#8A5B3C", shape: "round", topper: "antenna", eyes: "happy", mouth: "fang" },
  { name: "Pebble", color: "#8A9BB5", shade: "#66778F", shape: "egg", topper: "horns", eyes: "wink", mouth: "smile" },
  { name: "Ruby", color: "#F72585", shade: "#C70D63", shape: "box", topper: "bow", eyes: "happy", mouth: "tongue" },
  { name: "Snowy", color: "#EEF1F6", shade: "#C3CAD6", shape: "ghost", topper: "tuft", eyes: "big", mouth: "grin" },
];

const INK = "#1B1236";

function Body({ shape, color, shade }: { shape: Shape; color: string; shade: string }) {
  const common = { fill: color, stroke: INK, strokeWidth: 4 };
  switch (shape) {
    case "round":
      return (
        <>
          <circle cx="50" cy="57" r="35" {...common} />
          <path d="M22 70 a35 35 0 0 0 56 0" fill="none" stroke={shade} strokeWidth="6" opacity="0.5" />
        </>
      );
    case "box":
      return (
        <>
          <rect x="16" y="24" width="68" height="66" rx="22" {...common} />
          <path d="M24 78 q26 10 52 0" fill="none" stroke={shade} strokeWidth="6" opacity="0.5" />
        </>
      );
    case "ghost":
      return (
        <path
          d="M17 58 a33 33 0 0 1 66 0 v28 q-5.5 7 -11 0 q-5.5 7 -11 0 q-5.5 7 -11 0 q-5.5 7 -11 0 q-5.5 7 -11 0 q-5.5 7 -11 0 z"
          {...common}
          strokeLinejoin="round"
        />
      );
    case "egg":
      return (
        <>
          <ellipse cx="50" cy="59" rx="32" ry="34" {...common} />
          <ellipse cx="38" cy="44" rx="6" ry="9" fill="#fff" opacity="0.35" />
        </>
      );
  }
}

function TopperBack({ topper, color }: { topper: Topper; color: string }) {
  if (topper === "ears")
    return (
      <>
        <path d="M22 40 L26 10 L46 28 Z" fill={color} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <path d="M78 40 L74 10 L54 28 Z" fill={color} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <path d="M29 30 L30 18 L39 27 Z" fill="#FF9EC4" />
        <path d="M71 30 L70 18 L61 27 Z" fill="#FF9EC4" />
      </>
    );
  if (topper === "horns")
    return (
      <>
        <path d="M30 32 Q22 14 32 6 Q34 20 42 26 Z" fill="#FFF3D6" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        <path d="M70 32 Q78 14 68 6 Q66 20 58 26 Z" fill="#FFF3D6" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      </>
    );
  return null;
}

function TopperFront({ topper }: { topper: Topper }) {
  switch (topper) {
    case "antenna":
      return (
        <>
          <path d="M50 24 Q48 12 54 6" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
          <circle cx="55" cy="6" r="5.5" fill="#FFD23F" stroke={INK} strokeWidth="3.5" />
        </>
      );
    case "tuft":
      return (
        <path
          d="M38 26 Q40 10 46 20 Q50 4 54 20 Q60 10 62 26"
          fill="none"
          stroke={INK}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "sprout":
      return (
        <>
          <path d="M50 24 V12" stroke={INK} strokeWidth="4" strokeLinecap="round" />
          <path d="M50 14 Q38 2 30 10 Q40 20 50 14 Z" fill="#7BE07B" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
          <path d="M50 14 Q62 4 70 12 Q60 20 50 14 Z" fill="#7BE07B" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        </>
      );
    case "bow":
      return (
        <>
          <path d="M50 22 L34 12 L34 32 Z" fill="#FFD23F" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
          <path d="M50 22 L66 12 L66 32 Z" fill="#FFD23F" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
          <circle cx="50" cy="22" r="5" fill="#FFD23F" stroke={INK} strokeWidth="3.5" />
        </>
      );
    default:
      return null;
  }
}

function Eyes({ eyes }: { eyes: Eyes }) {
  switch (eyes) {
    case "dots":
      return (
        <>
          <circle cx="38" cy="52" r="5.5" fill={INK} />
          <circle cx="62" cy="52" r="5.5" fill={INK} />
          <circle cx="39.8" cy="50.2" r="1.8" fill="#fff" />
          <circle cx="63.8" cy="50.2" r="1.8" fill="#fff" />
        </>
      );
    case "big":
      return (
        <>
          <ellipse cx="37" cy="50" rx="9" ry="10" fill="#fff" stroke={INK} strokeWidth="3" />
          <ellipse cx="63" cy="50" rx="9" ry="10" fill="#fff" stroke={INK} strokeWidth="3" />
          <circle cx="39" cy="52" r="4.5" fill={INK} />
          <circle cx="61" cy="52" r="4.5" fill={INK} />
        </>
      );
    case "happy":
      return (
        <>
          <path d="M31 53 Q37 44 43 53" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
          <path d="M57 53 Q63 44 69 53" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
        </>
      );
    case "cyclops":
      return (
        <>
          <circle cx="50" cy="49" r="13" fill="#fff" stroke={INK} strokeWidth="3.5" />
          <circle cx="52" cy="51" r="6.5" fill={INK} />
          <circle cx="54.5" cy="48.5" r="2" fill="#fff" />
        </>
      );
    case "wink":
      return (
        <>
          <circle cx="38" cy="51" r="5.5" fill={INK} />
          <path d="M56 52 Q62 46 68 52" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
        </>
      );
  }
}

function Mouth({ mouth }: { mouth: Mouth }) {
  switch (mouth) {
    case "smile":
      return <path d="M40 67 Q50 76 60 67" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />;
    case "grin":
      return (
        <>
          <path d="M37 64 Q50 84 63 64 Z" fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <path d="M41 65 H59 V68 Q50 70 41 68 Z" fill="#fff" />
        </>
      );
    case "o":
      return <ellipse cx="50" cy="70" rx="5.5" ry="7" fill={INK} />;
    case "tongue":
      return (
        <>
          <path d="M39 66 Q50 78 61 66" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
          <path d="M47 71 Q48 80 53 79 Q57 78 55 70" fill="#FF7AA8" stroke={INK} strokeWidth="3" />
        </>
      );
    case "fang":
      return (
        <>
          <path d="M39 66 Q50 75 61 66" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
          <path d="M44 69 L46.5 75 L49 70.5 Z" fill="#fff" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        </>
      );
  }
}

export const Avatar = memo(function Avatar({
  index,
  size = 64,
  className = "",
  title,
}: {
  index: number;
  size?: number | string;
  className?: string;
  title?: string;
}) {
  const spec = AVATARS[((index % AVATARS.length) + AVATARS.length) % AVATARS.length]!;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title ?? spec.name}
    >
      <TopperBack topper={spec.topper} color={spec.color} />
      <Body shape={spec.shape} color={spec.color} shade={spec.shade} />
      <TopperFront topper={spec.topper} />
      <ellipse cx="27" cy="64" rx="5" ry="3" fill="#FF7AA8" opacity="0.55" />
      <ellipse cx="73" cy="64" rx="5" ry="3" fill="#FF7AA8" opacity="0.55" />
      <Eyes eyes={spec.eyes} />
      <Mouth mouth={spec.mouth} />
    </svg>
  );
});

/** The anonymous "who wrote this?" silhouette. */
export function MysteryAvatar({ size = 64, className = "" }: { size?: number | string; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label="Mystery author">
      <path
        d="M17 58 a33 33 0 0 1 66 0 v28 q-5.5 7 -11 0 q-5.5 7 -11 0 q-5.5 7 -11 0 q-5.5 7 -11 0 q-5.5 7 -11 0 q-5.5 7 -11 0 z"
        fill="#3A2C78"
        stroke="#0B0720"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <text x="50" y="74" textAnchor="middle" fontSize="44" fontWeight="900" fill="#FFD23F" fontFamily="Fredoka, sans-serif">
        ?
      </text>
    </svg>
  );
}

export function avatarColor(index: number): string {
  return AVATARS[((index % AVATARS.length) + AVATARS.length) % AVATARS.length]!.color;
}
