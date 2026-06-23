"use client";

/** The companion's voice — one calm serif sentence at the top of the dashboard. */
export default function CompanionBanner({ message }: { message: string }) {
  return (
    <p className="voice text-2xl leading-snug text-text sm:text-[1.7rem]">{message}</p>
  );
}
