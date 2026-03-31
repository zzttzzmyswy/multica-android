import { Instrument_Serif, Noto_Serif_SC } from "next/font/google";
import { LocaleProvider } from "@/features/landing/i18n";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-serif",
});

const notoSerifSC = Noto_Serif_SC({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-serif-zh",
});

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${instrumentSerif.variable} ${notoSerifSC.variable} h-full overflow-x-hidden overflow-y-auto bg-white`}>
      <LocaleProvider>{children}</LocaleProvider>
    </div>
  );
}
