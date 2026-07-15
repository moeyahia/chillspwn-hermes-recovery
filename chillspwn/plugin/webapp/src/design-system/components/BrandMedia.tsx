export function CommandCenterAmbient() {
  return (
    <picture className="os-brand-media os-brand-media--command" aria-hidden="true">
      <source
        type="image/avif"
        srcSet="/brand-v2/optimized/ambient-command-center-768.avif 756w, /brand-v2/optimized/ambient-command-center-1280.avif 1260w, /brand-v2/optimized/ambient-command-center-1920.avif 1890w"
        sizes="(max-width: 820px) 100vw, calc(100vw - 232px)"
      />
      <source
        type="image/webp"
        srcSet="/brand-v2/optimized/ambient-command-center-1280.webp 1260w, /brand-v2/optimized/ambient-command-center-1920.webp 1890w"
        sizes="(max-width: 820px) 100vw, calc(100vw - 232px)"
      />
      <img
        src="/brand-v2/optimized/ambient-command-center-1280.webp"
        width="1260"
        height="720"
        alt=""
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
}

export function JourneyAmbient() {
  return (
    <picture className="os-brand-media os-brand-media--journeys" aria-hidden="true">
      <source type="image/avif" srcSet="/brand-v2/optimized/onboarding-journeys-1344.avif" />
      <source type="image/webp" srcSet="/brand-v2/optimized/onboarding-journeys-1344.webp" />
      <img
        src="/brand-v2/optimized/onboarding-journeys-1344.webp"
        width="1344"
        height="768"
        alt=""
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
}
