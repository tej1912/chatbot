import React, { useState } from 'react';

export interface LogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  whiteText?: boolean;
  iconOnly?: boolean;
  layout?: 'horizontal' | 'stacked';
}

export const SmartBusinessLogo: React.FC<LogoProps> = ({
  className = '',
  size = 'md',
  whiteText = false,
  iconOnly = false,
  layout = 'horizontal',
}) => {
  const [imgError, setImgError] = useState(false);

  // Scale dimensions in pixels
  const iconPixelSize =
    size === 'xs'
      ? 28
      : size === 'sm'
      ? 36
      : size === 'lg'
      ? 48
      : size === 'xl'
      ? 60
      : 42;

  const brandTextSize =
    size === 'xs'
      ? 'text-[13px]'
      : size === 'sm'
      ? 'text-[15px]'
      : size === 'lg'
      ? 'text-[20px]'
      : size === 'xl'
      ? 'text-[25px]'
      : 'text-[17px]';

  const subTextSize =
    size === 'xs'
      ? 'text-[11px]'
      : size === 'sm'
      ? 'text-[12.5px]'
      : size === 'lg'
      ? 'text-[16px]'
      : size === 'xl'
      ? 'text-[20px]'
      : 'text-[14px]';

  return (
    <div
      className={`inline-flex items-center ${
        layout === 'stacked' ? 'flex-col text-center' : 'flex-row'
      } gap-2.5 sm:gap-3 select-none ${className}`}
    >
      {/* Direct Smart.png Logo Image as uploaded */}
      {!imgError ? (
        <img
          src="/smart.png"
          alt="SmartBusiness Solutions"
          width={iconPixelSize}
          height={iconPixelSize}
          className="shrink-0 rounded-xl object-contain drop-shadow-sm transition-transform hover:scale-105 duration-200"
          style={{ width: `${iconPixelSize}px`, height: `${iconPixelSize}px` }}
          onError={() => setImgError(true)}
          referrerPolicy="no-referrer"
        />
      ) : (
        <svg
          width={iconPixelSize}
          height={iconPixelSize}
          viewBox="0 0 1000 1000"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="shrink-0 drop-shadow-sm"
        >
          <defs>
            <linearGradient id="fallbackSmartGrad" x1="88%" y1="8%" x2="12%" y2="92%">
              <stop offset="0%" stopColor="#7D077E" />
              <stop offset="50%" stopColor="#4B1095" />
              <stop offset="100%" stopColor="#114FD8" />
            </linearGradient>
          </defs>
          <rect x="24" y="24" width="952" height="952" rx="220" fill="url(#fallbackSmartGrad)" />
          <g stroke="#FFFFFF" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <polygon points="690,235.0 780,287.0 780,401.0 690,349.0" />
            <polygon points="310,765.0 220,713.0 220,599.0 310,651.0" />
            <path d="M 690,235.0 L 500,125.0 L 220,287.0 L 220,447.0 L 780,553.0 L 780,713.0 L 500,875.0 L 310,765.0" />
            <path d="M 690,273.0 L 500,163.0 L 250,307.3 L 250,427.3 L 750,572.7 L 750,692.7 L 500,837.0 L 310,727.0" />
            <path d="M 690,311.0 L 500,201.0 L 280,327.7 L 280,407.7 L 720,592.3 L 720,672.3 L 500,799.0 L 310,689.0" />
            <path d="M 690,349.0 L 500,239.0 L 310,348.0 L 310,388.0 L 690,612.0 L 690,652.0 L 500,761.0 L 310,651.0" />
          </g>
        </svg>
      )}

      {/* Brand Typography matching image.png */}
      {!iconOnly && (
        <div
          className={`flex flex-col justify-center leading-none ${
            layout === 'stacked' ? 'items-center mt-2' : ''
          }`}
        >
          <span
            className={`font-bold tracking-tight font-sans ${brandTextSize} ${
              whiteText ? 'text-white' : 'text-slate-900'
            }`}
          >
            SmartBusiness
          </span>
          <span
            className={`font-bold tracking-tight mt-0.5 ${subTextSize} ${
              whiteText ? 'text-indigo-300' : 'text-[#7C3AED]'
            }`}
          >
            Solutions
          </span>
        </div>
      )}
    </div>
  );
};
