import localFont from "next/font/local";
const inter = localFont({ src: "./fonts/inter.woff2", variable: "--font-inter", display: "swap", weight: "100 900", preload: false });
const geist = localFont({ src: "./fonts/geist.woff2", variable: "--font-geist", display: "swap", weight: "100 900", preload: false });
const plex = localFont({ src: "./fonts/ibmplexsans.woff2", variable: "--font-plex", display: "swap", weight: "100 900", preload: false });
const manrope = localFont({ src: "./fonts/manrope.woff2", variable: "--font-manrope", display: "swap", weight: "100 900", preload: false });
const source = localFont({ src: "./fonts/sourcesans3.woff2", variable: "--font-source", display: "swap", weight: "100 900", preload: false });
const literata = localFont({ src: "./fonts/literata.woff2", variable: "--font-literata", display: "swap", weight: "100 900", preload: false });
const mono = localFont({ src: "./fonts/jetbrainsmono.woff2", variable: "--font-jetbrains", display: "swap", weight: "100 900", preload: false });
export const fontVariables = [inter, geist, plex, manrope, source, literata, mono].map(font => font.variable).join(" ");
export const fontFamilies: Record<string, string> = {
  inter: inter.style.fontFamily, geist: geist.style.fontFamily, "ibm-plex-sans": plex.style.fontFamily,
  manrope: manrope.style.fontFamily, "source-sans-3": source.style.fontFamily,
  literata: literata.style.fontFamily, "jetbrains-mono": mono.style.fontFamily,
};
