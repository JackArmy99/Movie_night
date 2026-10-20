import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f1115",
        }}
      >
        {/* Drawn, not a ★ character: a glyph would need a font download at build time. */}
        <svg width="62%" height="62%" viewBox="0 0 24 24">
          <path fill="#f5b942" d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21.2l1.6-7L2 9.5l7.1-.6z" />
        </svg>
      </div>
    ),
    size,
  );
}
