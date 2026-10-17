/** Blue tick for selfie-verified people. */
export default function Tick({ user }) {
  if (!user?.verified) return null;
  return (
    <span className="tick" title="Verified with a live selfie" aria-label="Verified">
      ✓
    </span>
  );
}
