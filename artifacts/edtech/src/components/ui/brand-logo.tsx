import { APP_ICON_PATH, APP_NAME } from "@/lib/brand";

type BrandLogoProps = {
  className?: string;
  imageClassName?: string;
  labelClassName?: string;
  showLabel?: boolean;
  variant?: "icon" | "wordmark";
};

export function BrandLogo({
  className = "",
  imageClassName = "",
  labelClassName = "",
  showLabel = false,
  variant = "wordmark",
}: BrandLogoProps) {
  if (variant === "icon") {
    return (
      <div className={`flex items-center gap-2.5 ${className}`.trim()}>
        <div className="relative flex h-12 w-12 items-center justify-center overflow-visible">
          <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(circle,_rgba(255,181,71,0.18)_0%,_rgba(59,130,246,0.08)_58%,_transparent_78%)] blur-md" />
          <img
            src={APP_ICON_PATH}
            alt={`${APP_NAME} icon`}
            loading="eager"
            decoding="async"
            className={`relative z-10 h-11 w-11 object-contain drop-shadow-[0_8px_14px_rgba(15,23,42,0.08)] ${imageClassName}`.trim()}
          />
        </div>
        {showLabel ? (
          <span className={`text-lg font-black tracking-tight text-[#111827] ${labelClassName}`.trim()}>{APP_NAME}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 ${className}`.trim()}>
      <div className="relative flex h-14 w-14 items-center justify-center overflow-visible">
        <div className="absolute inset-[10%] rounded-full bg-[radial-gradient(circle,_rgba(255,181,71,0.16)_0%,_rgba(59,130,246,0.08)_58%,_transparent_78%)] blur-lg" />
        <img
          src={APP_ICON_PATH}
          alt={`${APP_NAME} icon`}
          loading="eager"
          decoding="async"
          className={`relative z-10 h-12 w-12 object-contain drop-shadow-[0_10px_16px_rgba(15,23,42,0.08)] ${imageClassName}`.trim()}
        />
      </div>
      <div className={`leading-[0.96] ${labelClassName}`.trim()}>
        <span className="text-[1.45rem] font-black tracking-[-0.045em] text-[#233B7A] sm:text-[1.72rem]">Rank</span>
        <span className="text-[1.45rem] font-black tracking-[-0.045em] text-[#FF8A1F] sm:text-[1.72rem]">Pulse</span>
      </div>
      {showLabel ? <span className="sr-only">{APP_NAME}</span> : null}
    </div>
  );
}
