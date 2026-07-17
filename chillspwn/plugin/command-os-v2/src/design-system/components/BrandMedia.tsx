import { assetUrl } from "../../lib/assetUrl";

export function CommandCenterAmbient() {
  const ambient768Avif = assetUrl("brand-v2/optimized/ambient-command-center-768.avif");
  const ambient1280Avif = assetUrl("brand-v2/optimized/ambient-command-center-1280.avif");
  const ambient1920Avif = assetUrl("brand-v2/optimized/ambient-command-center-1920.avif");
  const ambient1280Webp = assetUrl("brand-v2/optimized/ambient-command-center-1280.webp");
  const ambient1920Webp = assetUrl("brand-v2/optimized/ambient-command-center-1920.webp");
  return (
    <picture className="os-brand-media os-brand-media--command" aria-hidden="true">
      <source
        type="image/avif"
        srcSet={`${ambient768Avif} 756w, ${ambient1280Avif} 1260w, ${ambient1920Avif} 1890w`}
        sizes="(max-width: 820px) 100vw, calc(100vw - 232px)"
      />
      <source
        type="image/webp"
        srcSet={`${ambient1280Webp} 1260w, ${ambient1920Webp} 1890w`}
        sizes="(max-width: 820px) 100vw, calc(100vw - 232px)"
      />
      <img
        src={ambient1280Webp}
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
  const onboardingAvif = assetUrl("brand-v2/optimized/onboarding-journeys-1344.avif");
  const onboardingWebp = assetUrl("brand-v2/optimized/onboarding-journeys-1344.webp");
  return (
    <picture className="os-brand-media os-brand-media--journeys" aria-hidden="true">
      <source type="image/avif" srcSet={onboardingAvif} />
      <source type="image/webp" srcSet={onboardingWebp} />
      <img
        src={onboardingWebp}
        width="1344"
        height="768"
        alt=""
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
}
